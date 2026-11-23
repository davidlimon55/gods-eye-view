import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { installVueDom } from '../../../../testSupport/vueDom.mjs';

let mount;
let Panel;
let uninstall;
before(async () => {
  uninstall = installVueDom();
  ({ mount } = await import('@vue/test-utils'));
  Panel = (await import('./OverMyHousePanel.vue')).default;
});
after(() => uninstall());

function view(overrides = {}) {
  return {
    open: true,
    loading: false,
    error: null,
    settings: { home: null, observer: 'home', textSize: 'large', sizerOn: true },
    observer: { lat: 29.4241, lon: -98.4936, kind: 'default' },
    here: null,
    locating: false,
    locateError: null,
    catalog: { total: 3, counts: {}, sources: [] },
    sky: {
      time: 0,
      sun: { el: -20, darkness: 'night' },
      moon: { az: 90, el: 40, illuminated: 50, waxing: true },
      planets: [{ id: 'jupiter', name: 'Jupiter', az: 100, el: 30, mag: -2.2 }],
      stars: [],
      aircraft: [],
      objects: [{ id: '25544', name: 'ISS (ZARYA)', kind: 'station', az: 45, el: 50, mag: -2, visible: true, heading: 90, heightKm: 420 }],
      counts: { above: 1, seeable: 1, aircraft: 0, total: 3 },
    },
    tonight: { window: null, passes: [], trains: [] },
    launches: [{ id: 'l', name: 'Falcon 9', net: '2026-11-24T02:00:00Z', lat: 28.5, lon: -80.6, location: 'Cape Canaveral', webcast: 'https://example.com/x' }],
    fireballs: [],
    identify: { busy: false, result: null, error: null },
    selectedId: null,
    searchBusy: false,
    searchError: null,
    compass: { active: false, heading: null, el: null, error: null },
    textSizes: ['small', 'normal', 'large', 'xl'],
    ...overrides,
  };
}

function controls() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    open: record('open'),
    close: record('close'),
    locate: record('locate'),
    searchPlace: record('searchPlace'),
    setObserver: record('setObserver'),
    setTextSize: record('setTextSize'),
    setSizerOn: record('setSizerOn'),
    runIdentify: record('runIdentify'),
    startCompass: record('startCompass'),
    stopCompass: record('stopCompass'),
    select: record('select'),
    selectNext: record('selectNext'),
    setFilter: record('setFilter'),
    setAllFilters: record('setAllFilters'),
  };
}

test('the panel shows the sky in plain words with large tap targets and text size', async () => {
  const c = controls();
  const wrapper = mount(Panel, { props: { view: view(), controls: c } });
  assert.match(wrapper.text(), /Over My House/);
  assert.match(wrapper.text(), /What was that\?/);
  assert.match(wrapper.text(), /ISS \(ZARYA\)/);
  assert.match(wrapper.text(), /How this works/);
  // A plain line under the map says what the marks mean.
  assert.match(wrapper.get('.omh-legend').text(), /middle is straight overhead.*edge is the horizon.*Orange arrows are planes.*Green dots are satellites.*gray dots are too dim.*Yellow dots are planets.*Tap any dot/);
  // Distances are miles; the launch here is about 1,000 miles away.
  assert.match(wrapper.text(), /\d+ mi to the east/);
  assert.doesNotMatch(wrapper.text(), /\bkm\b/);
  assert.match(wrapper.text(), /about half a mile/);
  assert.doesNotMatch(wrapper.text(), /Hark/);
  // The map's zoom buttons are real buttons with names.
  for (const name of ['Zoom in', 'Zoom out', 'Reset the map'])
    assert.ok(wrapper.find(`button[aria-label="${name}"]`).exists(), name);
  assert.match(wrapper.get('section.omh').attributes('style'), /--omh-size: 21px/);
  // Secondary sections start closed; "Right now" starts open.
  const sections = wrapper.findAll('details.omh-sec');
  assert.equal(sections[0].attributes('open'), '');
  assert.equal(sections[1].attributes('open'), undefined);
  // Every link that leaves the app opens a new tab without an opener.
  for (const link of wrapper.findAll('a[href^="http"]')) {
    assert.equal(link.attributes('target'), '_blank');
    assert.equal(link.attributes('rel'), 'noopener');
  }
  wrapper.unmount();
});

test('What was that? sends what the person chose', async () => {
  const c = controls();
  const wrapper = mount(Panel, { props: { view: view(), controls: c } });
  const ne = wrapper.findAll('button').find((b) => b.text() === 'NE');
  await ne.trigger('click');
  const find = wrapper.findAll('button').find((b) => b.text() === 'Find it');
  await find.trigger('click');
  const [name, query] = c.calls.find((call) => call[0] === 'runIdentify');
  assert.equal(name, 'runIdentify');
  assert.equal(query.direction, 'NE');
  assert.equal(query.moving, 'moved');
  assert.ok(Math.abs(query.time - Date.now()) < 5000);
  wrapper.unmount();
});

test('results say honestly when nothing fits', () => {
  const wrapper = mount(Panel, {
    props: {
      view: view({ identify: { busy: false, error: null, result: { verdict: 'none', candidates: [], hints: [] } } }),
      controls: controls(),
    },
  });
  assert.match(wrapper.text(), /Nothing in our lists fits well/);
  assert.match(wrapper.text(), /meteor/);
  wrapper.unmount();
});

test('the size buttons can be switched off', () => {
  const wrapper = mount(Panel, {
    props: { view: view({ settings: { home: null, observer: 'home', textSize: 'normal', sizerOn: false } }), controls: controls() },
  });
  assert.equal(wrapper.find('.omh-sizer').exists(), false);
  wrapper.unmount();
});

test('the selected thing shows its height in miles', () => {
  const wrapper = mount(Panel, { props: { view: view({ selectedId: '25544' }), controls: controls() } });
  assert.match(wrapper.get('.omh-card').text(), /About 261 mi up/);
  wrapper.unmount();
});

const PLANE = { id: 'ac-a40ca4', kind: 'aircraft', name: 'DAL2009', hex: 'a40ca4', callsign: 'DAL2009', reg: 'N360DN', type: 'A321', desc: '', az: 70, el: 20, distanceKm: 8, altitudeFt: 2300, track: 40, speedKt: 197, verticalFpm: -384, lat: 29.44, lon: -98.55 };

test('a tapped plane shows airline, flight, route, type, registration, speed, heading and a map link', () => {
  const sky = { ...view().sky, aircraft: [PLANE], counts: { above: 1, seeable: 1, aircraft: 1, total: 3 } };
  const route = { known: true, from: { code: 'ATL', city: 'Atlanta' }, to: { code: 'SAT', city: 'San Antonio' } };
  const wrapper = mount(Panel, { props: { view: view({ sky, selectedId: PLANE.id, details: { id: PLANE.id, kind: 'route', value: route } }), controls: controls() } });
  const text = wrapper.get('.omh-card').text();
  for (const want of ['Delta Air Lines flight 2009', 'Atlanta (ATL) → San Antonio (SAT)', 'Airbus A321', 'N360DN', '227 mph', 'Flying toward the northeast', 'Descending', '2300 ft up'])
    assert.ok(text.includes(want), want);
  const link = wrapper.get('.omh-card a');
  assert.equal(link.attributes('href'), 'https://globe.adsb.lol/?icao=a40ca4');
  assert.equal(link.attributes('target'), '_blank');
  wrapper.unmount();
  const unknown = mount(Panel, { props: { view: view({ sky, selectedId: PLANE.id, details: { id: PLANE.id, kind: 'route', value: { known: false, reason: 'implausible' } } }), controls: controls() } });
  assert.match(unknown.get('.omh-card').text(), /Route not known/);
  unknown.unmount();
});

test('a tapped satellite shows its catalog facts, and crowded spots offer the next one', async () => {
  const iss = { ...view().sky.objects[0], speedKms: 7.66, sunlit: true };
  const sky = { ...view().sky, objects: [iss, { id: '81001', name: '', kind: 'analyst', az: 46, el: 50, visible: false, sunlit: false, heightKm: 800 }] };
  const info = { found: true, loaded: true, type: 'PAY', status: '+', owner: 'ISS', launchDate: '1998-11-20', launchSite: 'TYMSC' };
  const c = controls();
  const wrapper = mount(Panel, {
    props: { view: view({ sky, selectedId: '25544', selectedGroup: ['25544', '81001'], details: { id: '25544', kind: 'object', value: info } }), controls: c },
  });
  const text = wrapper.get('.omh-card').text();
  for (const want of ['NORAD 25544', 'November 20, 1998, from Baikonur, Kazakhstan', 'About 261 mi up', 'About 17,100 mph', 'In sunlight', '1 other object here'])
    assert.ok(text.includes(want), want);
  assert.equal(wrapper.get('.omh-card a').attributes('href'), 'https://www.n2yo.com/satellite/?s=25544');
  await wrapper.findAll('button').find((b) => b.text() === 'Show the next one').trigger('click');
  assert.ok(c.calls.some((call) => call[0] === 'selectNext'));
  wrapper.unmount();
  const gray = mount(Panel, { props: { view: view({ sky, selectedId: '81001' }), controls: controls() } });
  const grayText = gray.get('.omh-card').text();
  assert.match(grayText, /Not identified/);
  assert.match(grayText, /analyst object/);
  assert.match(grayText, /Earth’s shadow/);
  gray.unmount();
});

test('filter chips show counts, turn groups off, and Show all resets', async () => {
  const c = controls();
  const wrapper = mount(Panel, { props: { view: view(), controls: c } });
  const chips = wrapper.findAll('.omh-filters button');
  assert.deepEqual(chips.map((b) => b.text().replace(/\s+\d+$/, '')), ['All', 'Planes', 'Satellites (working)', 'Starlink', 'Rocket bodies', 'Debris', 'Classified', 'Not identified', 'Planets and Moon', 'Stars']);
  assert.match(chips[2].text(), /Satellites \(working\)\s+1/);
  assert.equal(chips[0].attributes('aria-pressed'), 'true');
  await chips[7].trigger('click');
  assert.deepEqual(c.calls.find((call) => call[0] === 'setFilter'), ['setFilter', 'unidentified', false]);
  await chips[0].trigger('click');
  assert.deepEqual(c.calls.find((call) => call[0] === 'setAllFilters'), ['setAllFilters', false]);
  wrapper.unmount();
  const only = Object.fromEntries(['planes', 'satellites', 'starlink', 'rocket', 'debris', 'classified', 'unidentified', 'planets', 'stars'].map((k) => [k, k === 'unidentified']));
  const filtered = mount(Panel, { props: { view: view({ settings: { home: null, observer: 'home', textSize: 'normal', sizerOn: true, filters: only } }), controls: c } });
  assert.doesNotMatch(filtered.get('.omh-list').exists() ? filtered.get('.omh-list').text() : '', /ISS/);
  const showAll = filtered.findAll('button').find((b) => b.text() === 'Show all');
  await showAll.trigger('click');
  assert.deepEqual(c.calls.filter((call) => call[0] === 'setAllFilters').pop(), ['setAllFilters', true]);
  filtered.unmount();
});
