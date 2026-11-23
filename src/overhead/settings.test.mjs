import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_KEY, cleanHome, readSettings, writeSettings } from './settings.js';

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
  });
  assert.equal(cleanHome({ lat: 91, lon: 0 }), null);
  assert.equal(cleanHome({ lat: 'x', lon: 0 }), null);
  assert.equal(cleanHome({ lat: 10, lon: 10, source: '<script>' }).source, 'typed');
  const throwing = { setItem() { throw new Error('blocked'); } };
  assert.equal(writeSettings({}, throwing), false);
});
