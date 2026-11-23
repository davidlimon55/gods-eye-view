import { providerCooldownMs } from '../space/cooldown.js';
import {
  readResponseTextCapped,
  readResponseBytesCapped,
} from '../common/http.js';
import {
  ADSB_ROUTESET_URL,
  CELESTRAK_GROUPS,
  CELESTRAK_SATCAT_URL,
  MCCANTS_CLASSIFIED_URL,
  cleanCallsign,
  vrsRouteUrl,
  adsbPointUrl,
  celestrakGroupUrl,
  cneosFireballUrl,
  fetchUpstream,
  launchLibraryUpcomingUrl,
} from './sources.js';
import {
  compactFireballs,
  compactLaunches,
  compactRoute,
  extractZipEntry,
  mergeGroups,
  parseGpCsv,
  parseSatcatCsv,
  parseTle,
} from './parse.js';
import { createOverheadDiskCache } from './diskCache.js';
import { classifyObject } from '../../../src/overhead/satellites.js';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

/**
 * When CelesTrak refuses our own `active` download (it allows one download
 * per update per address, and the globe's satellites layer may already have
 * taken it), reuse the TLE copy that layer keeps in .gev-cache, if it is
 * less than a day old. TLE cannot hold catalog numbers above 99999, so this
 * is a fallback only.
 */
export async function readSharedTleCache(
  group,
  {
    root = path.join(process.cwd(), '.gev-cache'),
    maxAgeMs = 86400000,
    now = Date.now(),
  } = {},
) {
  if (!['active', 'starlink'].includes(group)) return [];
  try {
    const file = path.join(root, `celestrak-${group}.json`);
    const stat = await fsp.stat(file);
    if (stat.size > 32 * 1024 * 1024) return [];
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (
      !Number.isFinite(parsed?.at) ||
      now - parsed.at > maxAgeMs ||
      typeof parsed.body !== 'string'
    )
      return [];
    return parseTle(parsed.body).map(([name, l1, l2]) => [
      name,
      l1,
      l2,
      classifyObject(name, group),
    ]);
  } catch {
    return [];
  }
}

/** An upstream answered with a status this feature must back off from. */
class UpstreamStatusError extends Error {
  constructor(response) {
    super(`upstream HTTP ${response.status}`);
    this.status = response.status;
    this.cooldownMs = statusCooldownMs(response);
  }
}

/**
 * How long to leave an upstream alone after a failed answer. CelesTrak asks
 * clients to stop on any non-200 and to wait at least 15 minutes after a 5xx;
 * a 301/403/404 does not change by asking again, so those wait 6 hours.
 */
export function statusCooldownMs(response) {
  const status = Number(response?.status);
  if ([301, 302, 403, 404, 410].includes(status)) return 6 * 3600000;
  if (status === 429) return Math.max(providerCooldownMs(response), 15 * 60000);
  if (status >= 500) return 30 * 60000;
  return 15 * 60000;
}

/**
 * One cached upstream value: memory, then disk, then a single-flight refresh
 * after `ttlMs`. A failed refresh serves the stale value and backs off.
 */
export function createFeed({
  key,
  ttlMs,
  load,
  cache,
  gate = null,
  minRetryMs = 15 * 60000,
  now = () => Date.now(),
}) {
  let entry = null;
  let diskChecked = false;
  let inflight = null;
  let cooldownUntil = 0;
  let lastError = null;

  async function current() {
    if (!entry && !diskChecked) {
      diskChecked = true;
      entry = await cache.read(key);
    }
    return entry;
  }

  async function get({ force = false } = {}) {
    const cached = await current();
    const fresh = cached && now() - cached.at < ttlMs;
    if (fresh && !force) return { ...cached, state: 'HIT' };
    if (now() < Math.max(cooldownUntil, gate?.until ?? 0))
      return cached
        ? { ...cached, state: 'STALE' }
        : { at: 0, value: null, state: 'COOLDOWN' };
    if (!inflight) {
      inflight = (async () => {
        try {
          const value = await load();
          entry = { at: now(), value };
          lastError = null;
          await cache.write(key, entry);
          return entry;
        } catch (error) {
          lastError = error?.status ? `HTTP ${error.status}` : 'fetch failed';
          cooldownUntil = now() + (error?.cooldownMs ?? minRetryMs);
          // One failed answer from a host holds every feed on that host off.
          if (gate) gate.until = Math.max(gate.until, cooldownUntil);
          console.warn(`[over-my-house] ${key} refresh failed (${lastError})`);
          return null;
        } finally {
          inflight = null;
        }
      })();
    }
    const result = await inflight;
    if (result) return { ...result, state: 'MISS' };
    return cached
      ? { ...cached, state: 'STALE' }
      : { at: 0, value: null, state: 'ERROR' };
  }

  function status() {
    return {
      key,
      at: entry?.at ?? null,
      ok: Boolean(entry) && !lastError,
      error: lastError,
      retryAt:
        Math.max(cooldownUntil, gate?.until ?? 0) > now()
          ? Math.max(cooldownUntil, gate?.until ?? 0)
          : null,
    };
  }

  return { get, status, key };
}

async function okResponse(url, options) {
  const response = await fetchUpstream(url, options);
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new UpstreamStatusError(response);
  }
  return response;
}

/**
 * Every upstream this feature reads, with its cache rules. CelesTrak GP data
 * updates every 2 hours; this caches it for 6 (CelesTrak asks for no more
 * than one download per update).
 */
export function createOverheadFeeds({
  cache = createOverheadDiskCache(),
  fetchImpl = globalThis.fetch,
} = {}) {
  // CelesTrak asks clients to stop all queries after any non-200 answer.
  const celestrakGate = { until: 0 };
  const celestrak = new Map(
    CELESTRAK_GROUPS.map((group) => [
      group.id,
      createFeed({
        key: `celestrak-${group.id}`,
        ttlMs: 6 * 3600000,
        cache,
        gate: celestrakGate,
        load: async () => {
          const response = await okResponse(celestrakGroupUrl(group.id), {
            fetchImpl,
            timeoutMs: 30000,
            accept: 'text/csv',
          });
          const body = await readResponseTextCapped(response, 24 * 1024 * 1024);
          return parseGpCsv(body);
        },
      }),
    ]),
  );

  // The whole catalog (owner, launch date and site, object type). CelesTrak
  // updates it by hand once or twice a day; this takes it once a day, and a
  // failure waits like any other CelesTrak answer (the shared gate).
  const satcat = createFeed({
    key: 'celestrak-satcat',
    ttlMs: 24 * 3600000,
    cache,
    gate: celestrakGate,
    minRetryMs: 6 * 3600000,
    load: async () => {
      const response = await okResponse(CELESTRAK_SATCAT_URL, {
        fetchImpl,
        timeoutMs: 60000,
        accept: 'text/csv',
      });
      const body = await readResponseTextCapped(response, 40 * 1024 * 1024);
      return parseSatcatCsv(body);
    },
  });

  const classified = createFeed({
    key: 'mccants-classified',
    ttlMs: 12 * 3600000,
    cache,
    load: async () => {
      const response = await okResponse(MCCANTS_CLASSIFIED_URL, {
        fetchImpl,
        accept: 'application/zip',
      });
      const bytes = await readResponseBytesCapped(response, 2 * 1024 * 1024);
      const entries = parseTle(
        extractZipEntry(Buffer.from(bytes), 'classfd.tle'),
      );
      if (!entries.length) throw new Error('no elements in classfd.tle');
      return entries;
    },
  });

  const launches = createFeed({
    key: 'launch-library-upcoming',
    // LL2's free tier allows 15 calls an hour per address; this uses one.
    ttlMs: 3600000,
    cache,
    load: async () => {
      const nowMs = Date.now();
      const response = await okResponse(
        launchLibraryUpcomingUrl(nowMs - 3 * 3600000, nowMs + 36 * 3600000),
        {
          fetchImpl,
          accept: 'application/json',
        },
      );
      return compactLaunches(
        JSON.parse(await readResponseTextCapped(response, 8 * 1024 * 1024)),
      );
    },
  });

  const fireballs = createFeed({
    key: 'cneos-fireballs',
    ttlMs: 12 * 3600000,
    cache,
    load: async () => {
      const response = await okResponse(
        cneosFireballUrl(Date.now() - 180 * 86400000),
        {
          fetchImpl,
          accept: 'application/json',
        },
      );
      return compactFireballs(
        JSON.parse(await readResponseTextCapped(response, 4 * 1024 * 1024)),
      );
    },
  });

  let merged = null;
  let catalogInflight = null;

  /** The merged catalog JSON string, rebuilt when any part changed. */
  async function catalog() {
    if (catalogInflight) return catalogInflight;
    catalogInflight = (async () => {
      const groups = new Map();
      const sources = [];
      // One group at a time: polite to CelesTrak, and the first visit after
      // a cold start is the only slow one.
      for (const [id, feed] of celestrak) {
        const result = await feed.get();
        if (Array.isArray(result.value)) groups.set(id, result.value);
        sources.push({
          id: `celestrak:${id}`,
          at: result.at || null,
          state: result.state,
          count: result.value?.length ?? 0,
        });
      }
      const cat = await satcat.get();
      sources.push({
        id: 'celestrak:satcat',
        at: cat.at || null,
        state: cat.state,
        count: cat.value ? Object.keys(cat.value).length : 0,
      });
      const secret = await classified.get();
      sources.push({
        id: 'mccants:classfd',
        at: secret.at || null,
        state: secret.state,
        count: secret.value?.length ?? 0,
      });
      let fallback = [];
      if (!groups.has('active')) {
        fallback = await readSharedTleCache('active');
        if (fallback.length)
          sources.push({
            id: 'shared:celestrak-active-tle',
            at: null,
            state: 'FALLBACK',
            count: fallback.length,
          });
      }
      const stamp = `${sources.map((s) => `${s.id}@${s.at}`).join('|')}#${fallback.length}`;
      if (merged?.stamp !== stamp) {
        const objects = mergeGroups(groups, { satcat: cat.value ?? null });
        merged = {
          stamp,
          body: JSON.stringify({
            generatedAt: new Date().toISOString(),
            sources,
            objects,
            classified: secret.value ?? [],
            tle: fallback,
          }),
          count: objects.length + (secret.value?.length ?? 0) + fallback.length,
        };
      }
      return merged;
    })().finally(() => {
      catalogInflight = null;
    });
    return catalogInflight;
  }

  const aircraft = createAircraftFeed({ fetchImpl });
  const routes = createRouteFeed({ fetchImpl });

  /**
   * Catalog facts for one object (owner, launch date and site, type, status)
   * from the cached SATCAT; never fetches more than the daily copy.
   */
  async function object(id) {
    const key = String(Number(id));
    if (!/^\d{1,9}$/.test(key)) return { found: false, loaded: false };
    const cat = await satcat.get();
    if (!cat.value) return { found: false, loaded: false };
    const row = cat.value[key];
    if (!Array.isArray(row)) return { found: false, loaded: true };
    const [type, status, owner, launchDate, launchSite] = row;
    return {
      found: true,
      loaded: true,
      id: key,
      type,
      status,
      owner,
      launchDate,
      launchSite,
    };
  }

  return {
    catalog,
    object,
    routes,
    launches,
    fireballs,
    aircraft,
    cache,
    status: () => [
      ...[...celestrak.values()].map((f) => f.status()),
      satcat.status(),
      classified.status(),
      launches.status(),
      fireballs.status(),
      aircraft.status(),
      routes.status(),
    ],
  };
}

/**
 * Live aircraft near a point from adsb.lol. Points are rounded to 0.01°
 * (~1 km) so nearby callers share an answer; each answer is kept 15 seconds,
 * and the whole server spends at most `dailyLimit` upstream calls a day
 * (adsb.lol allows 500 a day per address without a key).
 */
export function createAircraftFeed({
  fetchImpl = globalThis.fetch,
  ttlMs = 15000,
  dailyLimit = Number(process.env.OMH_ADSB_DAILY_LIMIT) > 0
    ? Math.min(480, Number(process.env.OMH_ADSB_DAILY_LIMIT))
    : 300,
  now = () => Date.now(),
} = {}) {
  const answers = new Map();
  const inflight = new Map();
  let windowStart = now();
  let used = 0;
  let cooldownUntil = 0;
  let lastError = null;

  async function near(lat, lon) {
    const url = adsbPointUrl(lat, lon);
    const key = url.pathname;
    const cached = answers.get(key);
    if (cached && now() - cached.at < ttlMs) return { ...cached, state: 'HIT' };
    if (now() - windowStart > 86400000) {
      windowStart = now();
      used = 0;
    }
    if (now() < cooldownUntil || used >= dailyLimit)
      return cached
        ? { ...cached, state: 'STALE' }
        : {
            at: 0,
            value: null,
            state: used >= dailyLimit ? 'BUDGET' : 'COOLDOWN',
          };
    if (!inflight.has(key)) {
      used += 1;
      inflight.set(
        key,
        (async () => {
          try {
            const response = await okResponse(url, {
              fetchImpl,
              timeoutMs: 12000,
              accept: 'application/json',
            });
            const parsed = JSON.parse(
              await readResponseTextCapped(response, 4 * 1024 * 1024),
            );
            const entry = {
              at: now(),
              value: {
                ac: Array.isArray(parsed?.ac) ? parsed.ac.slice(0, 400) : [],
              },
            };
            answers.set(key, entry);
            // Bound memory: keep the 32 most recent points.
            while (answers.size > 32)
              answers.delete(answers.keys().next().value);
            lastError = null;
            return entry;
          } catch (error) {
            lastError = error?.status ? `HTTP ${error.status}` : 'fetch failed';
            cooldownUntil =
              now() +
              (error?.status === 429 ? (error.cooldownMs ?? 60000) : 30000);
            return null;
          } finally {
            inflight.delete(key);
          }
        })(),
      );
    }
    const fresh = await inflight.get(key);
    if (fresh) return { ...fresh, state: 'MISS' };
    return cached
      ? { ...cached, state: 'STALE' }
      : { at: 0, value: null, state: 'ERROR' };
  }

  function status() {
    return {
      key: 'adsb-lol-point',
      at: null,
      ok: !lastError,
      error: lastError,
      retryAt: cooldownUntil > now() ? cooldownUntil : null,
      usedToday: used,
      dailyLimit,
    };
  }

  return { near, status };
}

/**
 * Flight routes (from where to where) for callsigns, from adsb.lol's free
 * routeset lookup, with adsb.lol's static VRS route files as a fallback for
 * one callsign at a time when routeset answers empty. Routes change rarely,
 * so a found route is kept 6 hours and a "no route" answer 1 hour. Whether
 * the route fits the plane is worked out here from its current position
 * (compactRoute), every time, so a cached route never goes stale that way.
 */
export function createRouteFeed({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  knownTtlMs = 6 * 3600000,
  unknownTtlMs = 3600000,
  minGapMs = 2000,
  fallbackPerHour = 120,
  maxEntries = 3000,
} = {}) {
  const records = new Map();
  let lastCall = 0;
  let cooldownUntil = 0;
  let lastError = null;
  let fallbackHour = 0;
  let fallbackUsed = 0;
  let calls = 0;

  function remember(callsign, record) {
    records.delete(callsign);
    records.set(callsign, { at: now(), record });
    while (records.size > maxEntries)
      records.delete(records.keys().next().value);
  }

  function cached(callsign) {
    const hit = records.get(callsign);
    if (!hit) return undefined;
    const ttl = hit.record ? knownTtlMs : unknownTtlMs;
    return now() - hit.at < ttl ? hit.record : undefined;
  }

  async function fromRouteset(planes) {
    const response = await okResponse(ADSB_ROUTESET_URL, {
      fetchImpl,
      timeoutMs: 12000,
      accept: 'application/json',
      json: {
        planes: planes.map((p) => ({
          callsign: p.callsign,
          // About 7 miles: enough for adsb.lol's own route check.
          lat: Math.round(p.lat * 10) / 10,
          lng: Math.round(p.lon * 10) / 10,
        })),
      },
    });
    const text = await readResponseTextCapped(response, 1024 * 1024);
    let list = null;
    try {
      list = text.trim() ? JSON.parse(text) : null;
    } catch {
      list = null;
    }
    return Array.isArray(list) ? list : null;
  }

  async function fromStandingData(callsign) {
    const hour = Math.floor(now() / 3600000);
    if (hour !== fallbackHour) {
      fallbackHour = hour;
      fallbackUsed = 0;
    }
    if (fallbackUsed >= fallbackPerHour) return undefined;
    fallbackUsed += 1;
    const response = await fetchUpstream(vrsRouteUrl(callsign), {
      fetchImpl,
      timeoutMs: 10000,
      accept: 'application/json',
    });
    if (response.status === 404) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new UpstreamStatusError(response);
    }
    return JSON.parse(await readResponseTextCapped(response, 256 * 1024));
  }

  /**
   * Routes for up to 20 planes `{callsign, lat, lon, track}`.
   * @returns {Promise<{state: string, routes: object}>} routes keyed by callsign
   */
  async function lookup(input) {
    const planes = [];
    for (const p of (Array.isArray(input) ? input : []).slice(0, 20)) {
      const callsign = cleanCallsign(p?.callsign);
      const lat = Number(p?.lat);
      const lon = Number(p?.lon);
      if (!callsign || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      planes.push({ callsign, lat, lon, track: Number(p?.track) });
    }
    const missing = planes.filter((p) => cached(p.callsign) === undefined);
    let state = missing.length ? 'MISS' : 'HIT';
    if (missing.length) {
      if (now() < cooldownUntil || now() - lastCall < minGapMs) {
        state = 'COOLDOWN';
      } else {
        lastCall = now();
        calls += 1;
        try {
          const list = await fromRouteset(missing);
          if (list) {
            for (const record of list) {
              const cs = cleanCallsign(record?.callsign);
              if (!cs) continue;
              const unknown =
                String(record?.airport_codes || 'unknown') === 'unknown';
              // adsb.lol's plausible flag is for the first plane that asked;
              // compactRoute checks again for this plane.
              const rest = { ...record };
              delete rest.plausible;
              remember(cs, unknown ? null : rest);
            }
          } else {
            // Empty answer: look up the first (tapped) plane's static file.
            const record = await fromStandingData(missing[0].callsign);
            if (record !== undefined) remember(missing[0].callsign, record);
            state = 'FALLBACK';
          }
          lastError = null;
        } catch (error) {
          lastError = error?.status ? `HTTP ${error.status}` : 'fetch failed';
          cooldownUntil =
            now() +
            (error?.status === 429 ? (error.cooldownMs ?? 60000) : 5 * 60000);
          state = 'ERROR';
        }
      }
    }
    const routes = {};
    for (const p of planes) {
      const record = cached(p.callsign);
      if (record === undefined) {
        routes[p.callsign] = {
          callsign: p.callsign,
          known: false,
          reason: 'unavailable',
        };
      } else if (record === null) {
        routes[p.callsign] = {
          callsign: p.callsign,
          known: false,
          reason: 'unknown',
        };
      } else routes[p.callsign] = compactRoute(record, p);
    }
    return { state, routes };
  }

  function status() {
    return {
      key: 'adsb-lol-routes',
      at: null,
      ok: !lastError,
      error: lastError,
      retryAt: cooldownUntil > now() ? cooldownUntil : null,
      cached: records.size,
      calls,
    };
  }

  return { lookup, status };
}
