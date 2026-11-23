/**
 * What is over one house: the live sky snapshot, tonight's passes, Starlink
 * trains and the "What was that?" ranking. Pure functions over a catalog
 * built from the server's /api/overhead payloads; the browser runs them in a
 * worker, the alert job runs them in Node.
 *
 * Text that reaches a person is plain English (about a 6th-grade reading
 * level) with {placeholders} and a values object; the view fills it in.
 */
import { gstime } from 'satellite.js';
import {
  PLANETS,
  equatorialToHorizontal,
  moonHorizontal,
  moonPhase,
  planetPosition,
  skyDarkness,
  sunElevation,
  sunPosition,
} from './astro.js';
import { BRIGHT_STARS } from './brightStars.js';
import {
  KIND_LABELS,
  elementsFresh,
  lookAt,
  objectFromOmmRow,
  objectFromTle,
  observerGd,
  skyHeading,
} from './satellites.js';
import {
  HEIGHT_BANDS,
  bearingDifference,
  bearingOf,
  compassPoint,
  heightBand,
} from './compass.js';
import { milesWords } from './words.js';

/** Lowest height (degrees) the lists count as "overhead". */
export const MIN_ELEVATION = 10;
/** The Sun must be this far below the horizon for satellites to show. */
export const DARK_SUN_ELEVATION = -6;
/** Faintest estimated magnitude the lists call "you could see it". */
export const VISIBLE_MAGNITUDE = 4.5;

const PLANET_NAMES = Object.freeze({
  mercury: 'Mercury',
  venus: 'Venus',
  mars: 'Mars',
  jupiter: 'Jupiter',
  saturn: 'Saturn',
});

/**
 * Build the tracked-object catalog from the server's catalog payload:
 * `{objects: [compact OMM rows], classified: [[name, line1, line2]]}`.
 * Objects whose elements fail to initialise are skipped.
 */
export function buildCatalog(payload, { nowMs = Date.now() } = {}) {
  const objects = [];
  let stale = 0;
  const seen = new Set();
  for (const row of payload?.objects ?? []) {
    const object = objectFromOmmRow(row);
    if (!object || seen.has(object.id)) continue;
    seen.add(object.id);
    objects.push(object);
  }
  for (const entry of payload?.classified ?? []) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const object = objectFromTle(entry[0], entry[1], entry[2], 'classified');
    if (!object || seen.has(object.id)) continue;
    if (!elementsFresh(object, nowMs)) {
      stale += 1;
      continue;
    }
    seen.add(object.id);
    objects.push(object);
  }
  // Fallback classic element sets ([name, line1, line2, kind]) for objects
  // the OMM rows lack.
  for (const entry of payload?.tle ?? []) {
    if (!Array.isArray(entry) || entry.length < 4) continue;
    const object = objectFromTle(
      entry[0],
      entry[1],
      entry[2],
      String(entry[3]),
    );
    if (!object || seen.has(object.id) || !elementsFresh(object, nowMs))
      continue;
    seen.add(object.id);
    objects.push(object);
  }
  const counts = {};
  for (const object of objects)
    counts[object.kind] = (counts[object.kind] ?? 0) + 1;
  return { objects, counts, stale, sources: payload?.sources ?? [] };
}

/** Values shared by every object at one instant. */
function instant(ms) {
  return { gmst: gstime(new Date(ms)), sunUnit: sunPosition(ms).unit };
}

/** Whether a satellite look can be seen with the eye from a dark-enough sky. */
function seeable(look, sunEl) {
  return (
    look.sunlit &&
    look.el >= MIN_ELEVATION &&
    sunEl < DARK_SUN_ELEVATION &&
    look.mag <= VISIBLE_MAGNITUDE
  );
}

/**
 * Aircraft from an adsb.lol /v2/point answer, placed in the observer's sky.
 * `alt_geom`/`alt_baro` are feet; `gs` knots; `track` degrees.
 */
export function aircraftInSky(adsb, home, { atMs, snapshotMs } = {}) {
  const list = Array.isArray(adsb?.ac) ? adsb.ac : [];
  const out = [];
  const shiftSec =
    Number.isFinite(atMs) && Number.isFinite(snapshotMs)
      ? (atMs - snapshotMs) / 1000
      : 0;
  for (const ac of list) {
    let lat = Number(ac.lat);
    let lon = Number(ac.lon);
    const feet = Number(ac.alt_geom ?? ac.alt_baro);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(feet)
    )
      continue;
    const gs = Number(ac.gs);
    const track = Number(ac.track);
    if (shiftSec && Number.isFinite(gs) && Number.isFinite(track)) {
      const km = gs * 1.852 * (shiftSec / 3600);
      lat += (km / 111.2) * Math.cos((track * Math.PI) / 180);
      lon +=
        (km / (111.2 * Math.cos((lat * Math.PI) / 180))) *
        Math.sin((track * Math.PI) / 180);
    }
    const pos = localPosition(home, lat, lon, feet * 0.0003048);
    if (pos.el < 0) continue;
    const callsign = String(ac.flight || '').trim();
    const reg = String(ac.r || '').trim();
    const rate = Number(ac.baro_rate ?? ac.geom_rate);
    out.push({
      id: `ac-${ac.hex}`,
      kind: 'aircraft',
      name: callsign || reg || String(ac.hex || '').trim() || 'Aircraft',
      hex: /^~?[0-9a-f]{6}$/i.test(String(ac.hex || ''))
        ? String(ac.hex).toLowerCase()
        : null,
      callsign,
      reg,
      type: String(ac.t || '').trim(),
      desc: String(ac.desc || '').trim(),
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      verticalFpm: Number.isFinite(rate) ? Math.round(rate) : null,
      onGround: ac.alt_baro === 'ground',
      az: pos.az,
      el: pos.el,
      distanceKm: pos.groundKm,
      altitudeFt: Math.round(feet),
      track: Number.isFinite(track) ? track : null,
      speedKt: Number.isFinite(gs) ? Math.round(gs) : null,
    });
  }
  return out;
}

/** Az/el (degrees) and ground distance (km) of a point from the observer. */
export function localPosition(home, lat, lon, heightKm) {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (lat - home.lat) * toRad;
  const dLon = (lon - home.lon) * toRad;
  const lat1 = home.lat * toRad;
  const lat2 = lat * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const central = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const groundKm = R * central;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const az = (((Math.atan2(y, x) / toRad) % 360) + 360) % 360;
  // Height above the observer's horizontal plane, with Earth's curvature.
  const rObj = R + heightKm;
  const el =
    Math.atan2(Math.cos(central) * rObj - R, Math.sin(central) * rObj) / toRad;
  return { az, el, groundKm };
}

/**
 * The live sky over the house.
 * @param {{objects: object[]}} catalog From buildCatalog.
 * @param {{lat: number, lon: number}} home
 * @param {number} ms
 * @param {{aircraft?: object, aircraftAt?: number, limit?: number}} [options]
 */
export function skyNow(
  catalog,
  home,
  ms,
  { aircraft, aircraftAt, limit = 3000 } = {},
) {
  const gd = observerGd(home.lat, home.lon);
  const observer = { gd };
  const shared = instant(ms);
  const sunEl = sunElevation(home.lat, home.lon, ms);
  const later = ms + 10000;
  const sharedLater = instant(later);
  const above = [];
  const counts = { above: 0, seeable: 0 };
  for (const object of catalog.objects) {
    const look = lookAt(object, observer, ms, shared);
    if (!look || look.el < MIN_ELEVATION) continue;
    counts.above += 1;
    const next = lookAt(object, observer, later, sharedLater);
    const visible = seeable(look, sunEl);
    if (visible) counts.seeable += 1;
    above.push({
      id: object.id,
      name: object.name,
      kind: object.kind,
      az: look.az,
      el: look.el,
      mag: Number.isFinite(look.mag) ? round1(look.mag) : null,
      sunlit: look.sunlit,
      visible,
      rangeKm: Math.round(look.rangeKm),
      heightKm: Math.round(look.heightKm),
      speedKms: Number.isFinite(look.speedKms)
        ? Math.round(look.speedKms * 100) / 100
        : null,
      intlDes: object.intlDes,
      noCatalog: Boolean(object.noCatalog),
      heading: next ? skyHeading(look, next) : null,
    });
  }
  above.sort(
    (a, b) =>
      Number(b.visible) - Number(a.visible) ||
      (a.mag ?? 99) - (b.mag ?? 99) ||
      b.el - a.el,
  );
  const moon = moonHorizontal(home.lat, home.lon, ms);
  const phase = moonPhase(ms);
  const planets = PLANETS.map((id) => {
    const p = planetPosition(id, ms);
    const h = equatorialToHorizontal(p.ra, p.dec, home.lat, home.lon, ms);
    return {
      id,
      name: PLANET_NAMES[id],
      az: h.az,
      el: h.el,
      mag: round1(p.magnitude),
    };
  });
  const stars = BRIGHT_STARS.map((star) => {
    const h = equatorialToHorizontal(star.ra, star.dec, home.lat, home.lon, ms);
    return { name: star.name, az: h.az, el: h.el, mag: star.mag };
  }).filter((star) => star.el > 0);
  const planes = aircraft
    ? aircraftInSky(aircraft, home, { atMs: ms, snapshotMs: aircraftAt })
    : [];
  return {
    time: ms,
    sun: { el: round1(sunEl), darkness: skyDarkness(sunEl) },
    moon: {
      az: moon.az,
      el: moon.el,
      illuminated: Math.round(phase.illuminated * 100),
      waxing: phase.waxing,
    },
    planets,
    stars,
    aircraft: planes,
    objects: above.slice(0, limit),
    counts: {
      ...counts,
      aircraft: planes.length,
      total: catalog.objects.length,
    },
  };
}

/**
 * Passes over the house between two times for the brighter objects (the
 * ones a person could plausibly notice). One-minute steps; a pass is a run
 * of minutes above MIN_ELEVATION; it counts as visible when at least one of
 * those minutes is sunlit, bright enough, and the sky is dark.
 */
export function passesBetween(
  catalog,
  home,
  fromMs,
  toMs,
  { stepMs = 60000, maxStdMag = 5.5, filter } = {},
) {
  const gd = observerGd(home.lat, home.lon);
  const observer = { gd };
  const candidates = catalog.objects.filter(
    (object) =>
      object.stdMag <= maxStdMag &&
      object.mmPerDay > 2.5 &&
      (!filter || filter(object)),
  );
  const steps = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const sunEl = sunElevation(home.lat, home.lon, t);
    steps.push({
      t,
      sunEl,
      shared: sunEl < DARK_SUN_ELEVATION ? instant(t) : null,
    });
  }
  const passes = [];
  for (const object of candidates) {
    let current = null;
    const close = () => {
      if (current?.visibleMinutes > 0) passes.push(finishPass(object, current));
      current = null;
    };
    for (const step of steps) {
      if (!step.shared) {
        close();
        continue;
      }
      const look = lookAt(object, observer, step.t, step.shared);
      if (!look || look.el < MIN_ELEVATION) {
        close();
        continue;
      }
      if (!current)
        current = {
          start: step.t,
          startAz: look.az,
          maxEl: -90,
          visibleMinutes: 0,
          bestMag: Infinity,
        };
      current.end = step.t;
      current.endAz = look.az;
      if (look.el > current.maxEl) {
        current.maxEl = look.el;
        current.maxHeightKm = look.heightKm;
        current.maxAt = step.t;
        current.maxAz = look.az;
      }
      if (seeable(look, step.sunEl)) {
        current.visibleMinutes += 1;
        current.bestMag = Math.min(current.bestMag, look.mag);
      }
    }
    close();
  }
  passes.sort((a, b) => a.start - b.start);
  return passes;
}

function finishPass(object, pass) {
  return {
    id: object.id,
    name: object.name,
    kind: object.kind,
    intlDes: object.intlDes,
    recent: object.recent,
    start: pass.start,
    end: pass.end,
    maxAt: pass.maxAt,
    maxEl: Math.round(pass.maxEl),
    heightKm: Number.isFinite(pass.maxHeightKm)
      ? Math.round(pass.maxHeightKm)
      : null,
    startDir: compassPoint(pass.startAz),
    maxDir: compassPoint(pass.maxAz),
    endDir: compassPoint(pass.endAz),
    bestMag: round1(pass.bestMag),
  };
}

/**
 * Starlink "trains": several satellites from one launch crossing the sky
 * minutes apart, which look like a string of moving stars. Groups visible
 * Starlink passes by launch (international designator year-number) and
 * start time within `gapMs` of each other.
 */
export function starlinkTrains(
  passes,
  { minCount = 5, gapMs = 3 * 60000 } = {},
) {
  const byLaunch = new Map();
  for (const pass of passes) {
    if (pass.kind !== 'starlink') continue;
    const launch = String(pass.intlDes || '').slice(0, 8);
    if (!launch) continue;
    if (!byLaunch.has(launch)) byLaunch.set(launch, []);
    byLaunch.get(launch).push(pass);
  }
  const trains = [];
  for (const [launch, list] of byLaunch) {
    list.sort((a, b) => a.start - b.start);
    let group = [];
    const flush = () => {
      if (group.length >= minCount)
        trains.push({
          launch,
          count: group.length,
          start: group[0].start,
          end: group[group.length - 1].end,
          startDir: group[0].startDir,
          endDir: group[group.length - 1].endDir,
          maxEl: Math.max(...group.map((p) => p.maxEl)),
          bestMag: Math.min(...group.map((p) => p.bestMag)),
        });
      group = [];
    };
    for (const pass of list) {
      if (group.length && pass.start - group[group.length - 1].start > gapMs)
        flush();
      group.push(pass);
    }
    flush();
  }
  return trains.sort((a, b) => a.start - b.start);
}

/**
 * Score how well one sky position and motion fits what the person saw.
 * Returns 0-1 parts so the reasons can name each one.
 */
function regionFit(pos, query) {
  const band = query.height ? HEIGHT_BANDS[query.height] : null;
  let heightFit = 1;
  if (band) {
    const below = band.min - pos.el;
    const over = pos.el - band.max;
    const miss = Math.max(0, below, over);
    heightFit = Math.max(0, 1 - miss / 20);
  }
  let dirFit = 1;
  const lookAz = Number.isFinite(query.lookAz)
    ? query.lookAz
    : bearingOf(query.direction);
  if (lookAz !== null && Number.isFinite(lookAz)) {
    // Near straight up, compass direction stops meaning much.
    const slack = pos.el > 70 ? 180 : pos.el > 55 ? 50 : 30;
    const miss = Math.max(0, bearingDifference(pos.az, lookAz) - slack);
    dirFit = Math.max(0, 1 - miss / 30);
  }
  return Math.min(heightFit, dirFit);
}

function motionFit(heading, query, kind) {
  if (query.moving === 'still')
    return kind === 'planet' || kind === 'star' || kind === 'moon' ? 1 : 0.15;
  if (kind === 'planet' || kind === 'star' || kind === 'moon')
    return query.moving ? 0.05 : 0.35;
  if (query.moving === 'moved') return 0.75;
  const want = Number.isFinite(query.movingAz)
    ? query.movingAz
    : bearingOf(query.moving);
  if (want === null || !Number.isFinite(want) || heading === null) return 0.7;
  return Math.max(0, 1 - bearingDifference(heading, want) / 100);
}

function brightnessFit(mag, query) {
  if (!Number.isFinite(mag)) return 0.5;
  const ranges = { bright: [-5, 1.5], medium: [1.0, 3.5], faint: [3.0, 6.5] };
  const range = ranges[query.brightness];
  if (!range) return 1;
  const miss = Math.max(0, range[0] - mag, mag - range[1]);
  return Math.max(0, 1 - miss / 2.5);
}

function blinkFit(kind, query) {
  if (query.blinking === true)
    return kind === 'aircraft' ? 1 : kind === 'rocket' ? 0.6 : 0.35;
  if (query.blinking === false) return kind === 'aircraft' ? 0.55 : 1;
  return 1;
}

function satelliteVisibility(look, sunEl) {
  if (!look.sunlit) return 0.03;
  if (sunEl >= -0.833) return 0.05;
  const darkness = sunEl < DARK_SUN_ELEVATION ? 1 : 0.75;
  const mag = look.mag;
  const magFit =
    mag <= 2.5
      ? 1
      : mag <= 4
        ? 0.8
        : mag <= 5.5
          ? 0.45
          : mag <= 7
            ? 0.15
            : 0.03;
  return darkness * magFit;
}

const VERDICTS = Object.freeze({
  good: 'This is very likely what you saw.',
  possible: 'This could be what you saw.',
  none: 'Nothing in our lists fits well.',
});

/**
 * "What was that?": rank everything that could have been where the person
 * looked, when they looked, moving the way they said.
 *
 * @param {object} catalog From buildCatalog.
 * @param {{lat: number, lon: number}} home
 * @param {{time: number, direction?: string, lookAz?: number, height?: 'low'|'medium'|'high',
 *   moving?: string, movingAz?: number, brightness?: 'bright'|'medium'|'faint',
 *   blinking?: boolean, windowSec?: number}} query
 * @param {{aircraft?: object, aircraftAt?: number, launches?: object[]}} [extra]
 */
export function identify(catalog, home, query, extra = {}) {
  const center = Number(query.time);
  const windowSec = Math.min(600, Math.max(30, Number(query.windowSec) || 120));
  const stepMs = 10000;
  const times = [];
  for (
    let t = center - windowSec * 1000;
    t <= center + windowSec * 1000;
    t += stepMs
  )
    times.push(t);
  const gd = observerGd(home.lat, home.lon);
  const observer = { gd };
  const sunEl = sunElevation(home.lat, home.lon, center);
  const shared = times.map((t) => instant(t));
  const candidates = [];

  for (const object of catalog.objects) {
    let best = null;
    for (let i = 0; i < times.length; i += 1) {
      const look = lookAt(object, observer, times[i], shared[i]);
      if (!look || look.el < 3) continue;
      const region = regionFit(look, query);
      if (region <= 0) continue;
      const vis = satelliteVisibility(look, sunEl);
      if (vis < 0.1) continue;
      const nextT = times[i] + stepMs;
      const next = lookAt(object, observer, nextT, instant(nextT));
      const heading = next ? skyHeading(look, next) : null;
      const motion = motionFit(heading, query, object.kind);
      const bright = brightnessFit(look.mag, query);
      const blink = blinkFit(object.kind, query);
      const timeFit =
        1 - (Math.abs(times[i] - center) / (windowSec * 1000)) * 0.25;
      // How easy it was to see scales the whole score: a perfect match that
      // was too faint to notice is a poor answer.
      const score =
        (region * 0.4 + motion * 0.3 + bright * 0.3) *
        (0.25 + 0.75 * vis) *
        blink *
        timeFit;
      if (!best || score > best.score)
        best = {
          score,
          look,
          heading,
          t: times[i],
          parts: { region, motion, vis, bright },
        };
    }
    if (best && best.score > 0.25)
      candidates.push(candidateFromObject(object, best));
  }

  if (extra.aircraft) {
    for (const plane of aircraftInSky(extra.aircraft, home, {
      atMs: center,
      snapshotMs: extra.aircraftAt,
    })) {
      if (Math.abs(center - (extra.aircraftAt ?? center)) > 10 * 60000) break;
      const region = regionFit(plane, query);
      if (region <= 0 || plane.el < 2) continue;
      const heading = plane.track;
      const motion = motionFit(heading, query, 'aircraft');
      const blink = blinkFit('aircraft', query);
      const bright = query.brightness === 'faint' ? 0.7 : 1;
      const score = (region * 0.4 + motion * 0.3 + bright * 0.3) * blink;
      if (score > 0.25)
        candidates.push({
          id: plane.id,
          kind: 'aircraft',
          name: plane.name,
          score,
          time: center,
          az: plane.az,
          el: plane.el,
          heading,
          reasons: [
            reason('A plane was {dir}, {height} in your sky.', {
              dir: compassPoint(plane.az),
              height: heightWord(plane.el),
            }),
            reason('About {miles} away, flying at {feet} feet.', {
              miles: milesWords(plane.distanceKm),
              feet: plane.altitudeFt,
            }),
            ...(heading !== null
              ? [
                  reason('It was heading {dir}.', {
                    dir: compassPoint(heading),
                  }),
                ]
              : []),
            reason('Planes have blinking red, green or white lights.', {}),
          ],
          detail: plane.type,
        });
    }
  }

  for (const body of fixedSkyObjects(home, center)) {
    const region = regionFit(body, query);
    if (region <= 0 || body.el < 3) continue;
    const motion = motionFit(null, query, body.kind);
    const bright = brightnessFit(body.mag, query);
    const blink = query.blinking === true ? 0.3 : 1;
    // Daylight hides all but the Moon and Venus; twilight the fainter stars.
    const limit = sunEl > -0.833 ? -3.5 : sunEl > DARK_SUN_ELEVATION ? 1.5 : 6;
    const vis = body.mag <= limit ? 1 : 0;
    if (!vis) continue;
    const saidMoving = query.moving && query.moving !== 'still';
    const score =
      (region * 0.4 + motion * 0.3 + bright * 0.3) *
      vis *
      blink *
      (saidMoving ? 0.5 : 1);
    if (score > 0.3)
      candidates.push({
        id: `${body.kind}-${body.name}`,
        kind: body.kind,
        name: body.name,
        score,
        time: center,
        az: body.az,
        el: body.el,
        heading: null,
        reasons: [
          reason('{name} was {dir}, {height} in your sky.', {
            name: body.name,
            dir: compassPoint(body.az),
            height: heightWord(body.el),
          }),
          reason(
            'It does not move across the sky in a few minutes. It only rises and sets slowly.',
            {},
          ),
        ],
      });
  }

  for (const launch of extra.launches ?? []) {
    const net = Date.parse(launch.net);
    if (!Number.isFinite(net) || Math.abs(net - center) > 30 * 60000) continue;
    const pad = { lat: Number(launch.lat), lon: Number(launch.lon) };
    if (!Number.isFinite(pad.lat) || !Number.isFinite(pad.lon)) continue;
    const where = localPosition(home, pad.lat, pad.lon, 100);
    if (where.groundKm > 1600) continue;
    const region = regionFit(
      { az: where.az, el: Math.max(where.el, 5) },
      { ...query, height: query.height === 'high' ? 'medium' : query.height },
    );
    if (region <= 0) continue;
    candidates.push({
      id: `launch-${launch.id}`,
      kind: 'launch',
      name: launch.name,
      score: 0.4 + region * 0.3,
      time: net,
      az: where.az,
      el: where.el,
      heading: null,
      reasons: [
        reason('A rocket launched about {miles} away, toward the {dir}.', {
          miles: milesWords(where.groundKm),
          dir: compassPoint(where.az),
        }),
        reason(
          'Rocket exhaust lit by the Sun can look like a glowing, spreading cloud.',
          {},
        ),
      ],
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates
    .slice(0, 8)
    .map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 }));
  const bestScore = top[0]?.score ?? 0;
  const verdict =
    bestScore >= 0.75 ? 'good' : bestScore >= 0.55 ? 'possible' : 'none';
  return {
    verdict,
    verdictText: VERDICTS[verdict],
    candidates: verdict === 'none' ? top.slice(0, 3) : top,
    darkness: skyDarkness(sunEl),
    hints:
      verdict === 'none'
        ? [
            'It may be a satellite that is not in public lists.',
            'It may be a plane, drone or balloon that does not send a public position signal.',
            'A very quick streak is usually a meteor (shooting star).',
          ]
        : [],
  };
}

function candidateFromObject(object, best) {
  const { look, heading, t } = best;
  const reasons = [
    reason('It was {dir}, {height} in your sky.', {
      dir: compassPoint(look.az),
      height: heightWord(look.el),
    }),
  ];
  if (heading !== null)
    reasons.push(
      reason('It was moving toward the {dir}.', { dir: compassPoint(heading) }),
    );
  reasons.push(
    look.sunlit
      ? reason(
          'Sunlight was hitting it while your sky was dark, so it would shine like a moving star.',
          {},
        )
      : reason(
          'It was in Earth\u2019s shadow, so it would be hard to see.',
          {},
        ),
  );
  if (Number.isFinite(look.mag))
    reasons.push(
      reason('About as bright as a {bright} star.', {
        bright: brightWord(look.mag),
      }),
    );
  reasons.push(
    reason('{kind}, about {miles} up.', {
      kind: KIND_LABELS[object.kind] ?? KIND_LABELS.payload,
      miles: milesWords(look.heightKm),
    }),
  );
  return {
    id: object.id,
    kind: object.kind,
    name: object.name,
    score: best.score,
    time: t,
    az: look.az,
    el: look.el,
    heading,
    mag: Number.isFinite(look.mag) ? round1(look.mag) : null,
    reasons,
  };
}

/** Sun-independent bodies: the Moon, planets and bright stars at one time. */
export function fixedSkyObjects(home, ms) {
  const out = [];
  const moon = moonHorizontal(home.lat, home.lon, ms);
  out.push({
    kind: 'moon',
    name: 'The Moon',
    az: moon.az,
    el: moon.el,
    mag: -10,
  });
  for (const id of PLANETS) {
    const p = planetPosition(id, ms);
    const h = equatorialToHorizontal(p.ra, p.dec, home.lat, home.lon, ms);
    out.push({
      kind: 'planet',
      name: PLANET_NAMES[id],
      az: h.az,
      el: h.el,
      mag: p.magnitude,
    });
  }
  for (const star of BRIGHT_STARS) {
    const h = equatorialToHorizontal(star.ra, star.dec, home.lat, home.lon, ms);
    out.push({
      kind: 'star',
      name: star.name,
      az: h.az,
      el: h.el,
      mag: star.mag,
    });
  }
  return out;
}

/** "low" / "medium high" / "high" (English, translated by the view). */
export function heightWord(el) {
  const band = heightBand(el) ?? 'low';
  return { low: 'low', medium: 'medium high', high: 'high' }[band];
}

/** Brightness compared with stars, in plain words. */
export function brightWord(mag) {
  if (mag <= 0) return 'very bright';
  if (mag <= 1.5) return 'bright';
  if (mag <= 3) return 'medium';
  if (mag <= 4.5) return 'faint';
  return 'very faint';
}

function reason(text, values) {
  return { text, values };
}

function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}
