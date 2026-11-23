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
  };
}

test('the panel shows the sky in plain words with large tap targets and text size', async () => {
  const c = controls();
  const wrapper = mount(Panel, { props: { view: view(), controls: c } });
  assert.match(wrapper.text(), /Over My House/);
  assert.match(wrapper.text(), /What was that\?/);
  assert.match(wrapper.text(), /ISS \(ZARYA\)/);
  assert.match(wrapper.text(), /How this works/);
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
