import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAircraftFeed, createFeed, createRouteFeed, statusCooldownMs } from './feeds.js';

function memoryCache() {
  const files = new Map();
  return {
    read: async (key) => files.get(key) ?? null,
    write: async (key, entry) => files.set(key, entry),
    files,
  };
}

test('a feed caches, serves stale on failure, and backs off', async () => {
  let clock = 1_000_000;
  let calls = 0;
  let fail = false;
  const feed = createFeed({
    key: 'x',
    ttlMs: 1000,
    cache: memoryCache(),
    now: () => clock,
    load: async () => {
      calls += 1;
      if (fail) throw Object.assign(new Error('no'), { status: 503, cooldownMs: 30 * 60000 });
      return { n: calls };
    },
  });
  assert.equal((await feed.get()).state, 'MISS');
  assert.equal((await feed.get()).state, 'HIT');
  assert.equal(calls, 1);
  clock += 2000;
  fail = true;
  const stale = await feed.get();
  assert.equal(stale.state, 'STALE');
  assert.deepEqual(stale.value, { n: 1 });
  assert.equal(calls, 2);
  // Within the cooldown, upstream is not asked again.
  clock += 60000;
  await feed.get();
  assert.equal(calls, 2);
  assert.equal(feed.status().error, 'HTTP 503');
});

test('one CelesTrak failure holds every group on the same gate', async () => {
  const gate = { until: 0 };
  let clock = 0;
  const failing = createFeed({ key: 'a', ttlMs: 1, cache: memoryCache(), gate, now: () => clock, load: async () => { throw Object.assign(new Error('x'), { status: 500, cooldownMs: 1800000 }); } });
  let other = 0;
  const sibling = createFeed({ key: 'b', ttlMs: 1, cache: memoryCache(), gate, now: () => clock, load: async () => (other += 1) });
  await failing.get();
  assert.equal((await sibling.get()).state, 'COOLDOWN');
  assert.equal(other, 0);
  clock += 1800001;
  assert.equal((await sibling.get()).state, 'MISS');
});

test('cooldowns follow CelesTrak and adsb.lol guidance', () => {
  const r = (status, headers = {}) => ({ status, headers: new Headers(headers) });
  assert.equal(statusCooldownMs(r(404)), 6 * 3600000);
  assert.equal(statusCooldownMs(r(403)), 6 * 3600000);
  assert.equal(statusCooldownMs(r(503)), 30 * 60000);
  assert.ok(statusCooldownMs(r(429, { 'retry-after': '1200' })) >= 20 * 60000);
});

test('aircraft lookups share rounded points and respect a daily budget', async () => {
  let clock = 0;
  const urls = [];
  const feed = createAircraftFeed({
    dailyLimit: 2,
    now: () => clock,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ ac: [{ hex: 'a' }] }));
    },
  });
  assert.equal((await feed.near(29.5966, -98.3686)).state, 'MISS');
  assert.equal((await feed.near(29.5971, -98.3689)).state, 'HIT');
  clock += 20000;
  await feed.near(29.6, -98.37);
  clock += 20000;
  const over = await feed.near(29.6, -98.37);
  assert.equal(urls.length, 2);
  assert.equal(over.state, 'STALE');
  assert.equal(feed.status().usedToday, 2);
});

const ROUTE = {
  callsign: 'SWA100',
  number: '100',
  airline_code: 'SWA',
  airport_codes: 'KDAL-KSAT',
  plausible: true,
  _airports: [
    { icao: 'KDAL', iata: 'DAL', location: 'Dallas', name: 'Dallas Love Field', lat: 32.847, lon: -96.852 },
    { icao: 'KSAT', iata: 'SAT', location: 'San Antonio', name: 'San Antonio International Airport', lat: 29.5337, lon: -98.4698 },
  ],
};

test('routes: one POST for a callsign, cached for hours, position rounded, empty answers fall back', async () => {
  let clock = 5_000_000;
  const calls = [];
  let mode = 'routeset';
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://api.adsb.lol/api/0/routeset')) {
      if (mode === 'empty') return new Response('', { status: 201 });
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify(body.planes.map((p) => (p.callsign === 'SWA100' ? ROUTE : { callsign: p.callsign, airport_codes: 'unknown', _airports: [] }))),
        { status: 200 },
      );
    }
    if (url.startsWith('https://vrs-standing-data.adsb.lol/routes/')) {
      if (url.endsWith('/NOPE1.json')) return new Response('missing', { status: 404 });
      return new Response(JSON.stringify({ ...ROUTE, callsign: 'SWA200' }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  };
  const feed = createRouteFeed({ fetchImpl, now: () => clock });
  const plane = { callsign: 'swa100', lat: 30.1234, lon: -97.8765, track: 220 };
  const first = await feed.lookup([plane]);
  assert.equal(first.routes.SWA100.known, true);
  assert.equal(first.routes.SWA100.from.city, 'Dallas');
  assert.equal(first.routes.SWA100.to.code, 'SAT');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { planes: [{ callsign: 'SWA100', lat: 30.1, lng: -97.9 }] });
  clock += 3 * 3600000;
  assert.equal((await feed.lookup([plane])).state, 'HIT');
  assert.equal(calls.length, 1);
  // Unknown routes come back as unknown, not blank.
  clock += 5000;
  assert.equal((await feed.lookup([{ callsign: 'ABC9', lat: 30, lon: -98 }])).routes.ABC9.reason, 'unknown');
  // routeset answers empty: the tapped plane's static file is read instead.
  mode = 'empty';
  clock += 5000;
  const fb = await feed.lookup([{ callsign: 'SWA200', lat: 30.1, lon: -97.9, track: 220 }]);
  assert.equal(fb.state, 'FALLBACK');
  assert.equal(fb.routes.SWA200.known, true);
  clock += 5000;
  assert.equal((await feed.lookup([{ callsign: 'NOPE1', lat: 30, lon: -98 }])).routes.NOPE1.reason, 'unknown');
  // Bad callsigns never reach a URL.
  const before = calls.length;
  assert.deepEqual((await feed.lookup([{ callsign: '../../x', lat: 30, lon: -98 }])).routes, {});
  assert.equal(calls.length, before);
});

test('routes: errors back off and say the route is unavailable', async () => {
  let clock = 1_000_000;
  let calls = 0;
  const feed = createRouteFeed({
    now: () => clock,
    fetchImpl: async () => {
      calls += 1;
      return new Response('slow down', { status: 429, headers: { 'Retry-After': '120' } });
    },
  });
  const a = await feed.lookup([{ callsign: 'UAL1', lat: 30, lon: -98 }]);
  assert.equal(a.state, 'ERROR');
  assert.equal(a.routes.UAL1.reason, 'unavailable');
  clock += 10000;
  assert.equal((await feed.lookup([{ callsign: 'UAL1', lat: 30, lon: -98 }])).state, 'COOLDOWN');
  assert.equal(calls, 1);
});
