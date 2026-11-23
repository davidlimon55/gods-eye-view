import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_DELAY_MS, createOverMyHouse } from './controller.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}

const SKY = {
  objects: [
    { id: '25544', name: 'ISS (ZARYA)', kind: 'station', az: 10, el: 50 },
    { id: 'c37162', name: 'USA 224', kind: 'classified', az: 11, el: 50 },
  ],
  aircraft: [{ id: 'ac-a40ca4', kind: 'aircraft', callsign: 'DAL2009', lat: 29.44, lon: -98.55, track: 40, az: 70, el: 20 }],
};

function setup() {
  const fetched = [];
  const posted = [];
  let last = null;
  const worker = {
    postMessage({ id, type }) {
      posted.push(type);
      queueMicrotask(() => worker.onmessage({ data: { id, ok: true, result: type === 'load' ? { total: 2, counts: {}, sources: [] } : type === 'now' ? SKY : { window: null, passes: [], trains: [] } } }));
    },
    terminate() {},
  };
  const storage = memoryStorage();
  const omh = createOverMyHouse({
    publish: (view) => (last = view),
    createWorker: () => worker,
    storage,
    documentRef: null,
    navigatorRef: null,
    fetchImpl: async (path) => {
      fetched.push(path);
      if (path.startsWith('/api/overhead/routes')) return new Response(JSON.stringify({ route: { known: true, from: { code: 'ATL' }, to: { code: 'SAT' } } }));
      if (path.startsWith('/api/overhead/object')) return new Response(JSON.stringify({ found: true, loaded: true, owner: 'US' }));
      return new Response(JSON.stringify({ ac: [], items: [] }));
    },
  });
  return { omh, fetched, posted, storage, view: () => last };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('selecting looks up a plane route or a satellite catalog entry once, and steps through a crowded spot', async () => {
  const { omh, fetched, view } = setup();
  await omh.open();
  omh.select(['ac-a40ca4', '25544', 'c37162']);
  await tick();
  assert.equal(view().selectedId, 'ac-a40ca4');
  assert.equal(view().details.value.known, true);
  assert.ok(fetched.some((p) => p === '/api/overhead/routes?cs=DAL2009&lat=29.4&lon=-98.5&track=40'));
  omh.selectNext();
  await tick();
  assert.equal(view().selectedId, '25544');
  assert.equal(view().details.value.owner, 'US');
  omh.selectNext();
  await tick();
  assert.ok(fetched.includes('/api/overhead/object?id=37162'));
  omh.selectNext();
  assert.equal(view().selectedId, 'ac-a40ca4');
  const before = fetched.length;
  await tick();
  assert.equal(fetched.length, before, 'the route answer is reused');
  omh.close();
  omh.destroy();
});

test('filters are saved in the browser and Show all turns every group back on', async () => {
  const { omh, storage, view } = setup();
  omh.setAllFilters(false);
  omh.setFilter('unidentified', true);
  assert.equal(Object.values(view().settings.filters).filter(Boolean).length, 1);
  // Quick taps are written once, a moment after the last one.
  assert.equal(storage.data.size, 0);
  await new Promise((r) => setTimeout(r, SAVE_DELAY_MS + 50));
  assert.match([...storage.data.values()][0], /"unidentified":true/);
  omh.setAllFilters(true);
  assert.ok(Object.values(view().settings.filters).every(Boolean));
  // Closing the page writes at once.
  omh.destroy();
  assert.match([...storage.data.values()][0], /"unidentified":true,"planets":true/);
});

test('a filter tap publishes new settings at once and never re-runs the sky maths or the network', async () => {
  const { omh, fetched, posted, view } = setup();
  await omh.open();
  await tick();
  const before = view();
  const postedBefore = posted.length;
  const fetchedBefore = fetched.length;
  const started = performance.now();
  for (let i = 0; i < 50; i++) {
    omh.setFilter('planes', i % 2 === 1);
    omh.setAllFilters(i % 3 === 0);
  }
  const perTap = (performance.now() - started) / 100;
  await tick();
  assert.equal(posted.length, postedBefore, 'no worker call (orbit propagation) on a filter tap');
  assert.equal(fetched.length, fetchedBefore, 'no network call on a filter tap');
  // The view gets a fresh settings and filters object, so it can tell the
  // chips changed (the old in-place change left them stuck).
  omh.setFilter('stars', false);
  assert.notEqual(view().settings, before.settings);
  assert.notEqual(view().settings.filters, before.settings.filters);
  assert.equal(view().settings.filters.stars, false);
  // The sky itself is the same object: nothing was worked out again.
  assert.equal(view().sky, before.sky);
  assert.ok(perTap < 5, `a filter tap took ${perTap.toFixed(3)} ms in the owner`);
  omh.destroy();
});

test('other settings are replaced too, never changed in place', () => {
  const { omh, view } = setup();
  const first = view().settings;
  omh.setTextSize('xl');
  assert.notEqual(view().settings, first);
  assert.equal(first.textSize, 'normal');
  assert.equal(view().settings.textSize, 'xl');
  omh.destroy();
});
