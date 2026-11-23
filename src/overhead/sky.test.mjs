import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aircraftInSky,
  buildCatalog,
  identify,
  localPosition,
  passesBetween,
  skyNow,
  starlinkTrains,
} from './sky.js';
import { lookAt, observerGd } from './satellites.js';
import { sunElevation } from './astro.js';
import { compassPoint, heightBand } from './compass.js';
import { FIXTURE_HOME, FIXTURE_NOW, FIXTURE_ROWS } from './testFixtures.mjs';

const catalog = buildCatalog({ objects: [...FIXTURE_ROWS, FIXTURE_ROWS[0]] }, { nowMs: FIXTURE_NOW });

/**
 * The first minute in two days when the ISS is up, lit and the sky dark,
 * from the first of a few places where that happens (it depends on the
 * season which places see it this week).
 */
function firstIssSighting() {
  const iss = catalog.objects.find((o) => o.id === '25544');
  const places = [FIXTURE_HOME, { lat: 40.7, lon: -74 }, { lat: 51.5, lon: 0 }, { lat: -33.9, lon: 151.2 }, { lat: 35.7, lon: 139.7 }, { lat: -23.5, lon: -46.6 }];
  for (const home of places) {
    const observer = { gd: observerGd(home.lat, home.lon) };
    for (let t = FIXTURE_NOW; t < FIXTURE_NOW + 2 * 86400000; t += 60000) {
      if (sunElevation(home.lat, home.lon, t) > -6) continue;
      const look = lookAt(iss, observer, t);
      if (look.el > 30 && look.sunlit) return { t, look, home };
    }
  }
  return null;
}

test('the catalog keeps one record per object and counts kinds', () => {
  assert.equal(catalog.objects.length, 4);
  assert.deepEqual(catalog.counts, { station: 2, rocket: 1, starlink: 1 });
});

test('the live sky lists planets, stars and what is above the horizon', () => {
  const sky = skyNow(catalog, FIXTURE_HOME, FIXTURE_NOW);
  assert.equal(sky.sun.darkness, 'day');
  assert.equal(sky.planets.length, 5);
  assert.ok(sky.stars.length > 5);
  assert.equal(sky.counts.total, 4);
  for (const o of sky.objects) assert.ok(o.el >= 10);
  // In daylight nothing counts as visible.
  assert.equal(sky.counts.seeable, 0);
});

test('passes are found in the dark and Starlink trains need several satellites', () => {
  const seen = firstIssSighting();
  assert.ok(seen, 'the ISS is seen from one of the test places within two days');
  const passes = passesBetween(catalog, seen.home, seen.t - 10 * 60000, seen.t + 10 * 60000);
  const iss = passes.find((p) => p.id === '25544');
  assert.ok(iss, 'the ISS pass is listed');
  assert.ok(iss.maxEl >= 30);
  assert.ok(iss.bestMag < 1, `ISS brightness ${iss.bestMag}`);
  assert.deepEqual(starlinkTrains(passes), []);
  const fake = Array.from({ length: 6 }, (_, i) => ({ kind: 'starlink', intlDes: '2026-256A', start: i * 30000, end: i * 30000 + 240000, startDir: 'W', endDir: 'E', maxEl: 50, bestMag: 3 }));
  assert.equal(starlinkTrains(fake)[0].count, 6);
});

test('What was that? names the ISS when the description fits', () => {
  const seen = firstIssSighting();
  const result = identify(catalog, seen.home, {
    time: seen.t,
    direction: compassPoint(seen.look.az),
    height: heightBand(seen.look.el),
    moving: 'moved',
  });
  assert.equal(result.candidates[0].id, '25544');
  assert.notEqual(result.verdict, 'none');
  assert.ok(result.candidates[0].reasons.length >= 3);
});

test('What was that? says honestly when nothing fits', () => {
  // Midday, looking low in the north for a moving faint light.
  const result = identify(catalog, FIXTURE_HOME, {
    time: FIXTURE_NOW,
    direction: 'N',
    height: 'low',
    moving: 'E',
    brightness: 'faint',
    blinking: false,
  });
  assert.equal(result.verdict, 'none');
  assert.ok(result.hints.length > 0);
});

test('a still light matches a planet or star, and planes come from ADS-B', () => {
  const night = Date.UTC(2026, 10, 24, 4, 0);
  const still = identify(catalog, FIXTURE_HOME, { time: night, moving: 'still' });
  assert.ok(['planet', 'star', 'moon'].includes(still.candidates[0].kind));
  const adsb = { ac: [{ hex: 'abc123', flight: 'SWA1234 ', lat: 29.65, lon: -98.3, alt_geom: 9000, gs: 250, track: 90, t: 'B737' }] };
  const planes = aircraftInSky(adsb, FIXTURE_HOME, { atMs: night, snapshotMs: night });
  assert.equal(planes.length, 1);
  assert.equal(planes[0].name, 'SWA1234');
  const pick = identify(catalog, FIXTURE_HOME, {
    time: night,
    direction: compassPoint(planes[0].az),
    height: heightBand(planes[0].el),
    moving: 'E',
    blinking: true,
  }, { aircraft: adsb, aircraftAt: night });
  assert.equal(pick.candidates[0].kind, 'aircraft');
  const p = localPosition(FIXTURE_HOME, FIXTURE_HOME.lat + 1, FIXTURE_HOME.lon, 0);
  assert.ok(Math.abs(p.groundKm - 111) < 2);
  assert.ok(p.az < 1 || p.az > 359);
});
