import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILTER_KEYS, SETTINGS_KEY, cleanFilters, cleanHome, readSettings, writeSettings } from './settings.js';
import { FILTER_IDS } from './details.js';

const ALL_ON = Object.fromEntries(FILTER_KEYS.map((k) => [k, true]));

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
}

test('settings default to no home, normal text and the size buttons on', () => {
  assert.deepEqual(readSettings(memoryStorage()), {
    home: null,
    observer: 'home',
    textSize: 'normal',
    sizerOn: true,
    filters: ALL_ON,
  });
  assert.deepEqual(readSettings(memoryStorage({ [SETTINGS_KEY]: '{broken' })).textSize, 'normal');
});

test('settings round-trip and reject bad values', () => {
  const storage = memoryStorage();
  assert.ok(
    writeSettings({ home: { lat: 29.59661234, lon: -98.36861234, label: 'Home', source: 'gps' }, observer: 'here', textSize: 'xl', sizerOn: false }, storage),
  );
  assert.deepEqual(readSettings(storage), {
    home: { lat: 29.5966, lon: -98.3686, label: 'Home', source: 'gps' },
    observer: 'here',
    textSize: 'xl',
    sizerOn: false,
    filters: ALL_ON,
  });
  assert.equal(cleanHome({ lat: 91, lon: 0 }), null);
  assert.equal(cleanHome({ lat: 'x', lon: 0 }), null);
  assert.equal(cleanHome({ lat: 10, lon: 10, source: '<script>' }).source, 'typed');
  const throwing = { setItem() { throw new Error('blocked'); } };
  assert.equal(writeSettings({}, throwing), false);
});

test('map filters start all on, are remembered, and ignore unknown keys', () => {
  assert.deepEqual([...FILTER_KEYS], [...FILTER_IDS]);
  const storage = memoryStorage();
  const onlyUnknown = Object.fromEntries(FILTER_KEYS.map((k) => [k, k === 'unidentified']));
  writeSettings({ textSize: 'normal', filters: { ...onlyUnknown, evil: true } }, storage);
  const read = readSettings(storage);
  assert.deepEqual(read.filters, onlyUnknown);
  assert.equal('evil' in read.filters, false);
  assert.deepEqual(cleanFilters({ planes: 'no' }), ALL_ON);
});
