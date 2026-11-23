import { providerCooldownMs } from '../space/cooldown.js';
import {
  readResponseTextCapped,
  readResponseBytesCapped,
} from '../common/http.js';
import {
  CELESTRAK_GROUPS,
  MCCANTS_CLASSIFIED_URL,
  adsbPointUrl,
  celestrakGroupUrl,
  cneosFireballUrl,
  fetchUpstream,
  launchLibraryUpcomingUrl,
} from './sources.js';
import {
  compactFireballs,
  compactLaunches,
  extractZipEntry,
  mergeGroups,
  parseGpCsv,
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
        const objects = mergeGroups(groups);
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

  return {
    catalog,
    launches,
    fireballs,
    aircraft,
    cache,
    status: () => [
      ...[...celestrak.values()].map((f) => f.status()),
      classified.status(),
      launches.status(),
      fireballs.status(),
      aircraft.status(),
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
