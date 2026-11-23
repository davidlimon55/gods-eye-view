import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angularDistance,
  classifyObject,
  elementsFresh,
  estimateMagnitude,
  isSunlit,
  lookAt,
  objectFromOmmRow,
  objectFromTle,
  observerGd,
  skyHeading,
  standardMagnitude,
} from './satellites.js';
import { FIXTURE_HOME, FIXTURE_NOW, FIXTURE_ROWS } from './testFixtures.mjs';

test('objects are sorted into plain kinds from their catalogue names', () => {
  assert.equal(classifyObject('SL-16 R/B'), 'rocket');
  assert.equal(classifyObject('FENGYUN 1C DEB'), 'debris');
  assert.equal(classifyObject('THING', 'cosmos-2251-debris'), 'debris');
  assert.equal(classifyObject('STARLINK-1234'), 'starlink');
  assert.equal(classifyObject('ISS (ZARYA)', 'stations'), 'station');
  assert.equal(classifyObject('USA 224', 'classified'), 'classified');
  assert.equal(classifyObject('', 'analyst'), 'analyst');
  assert.equal(classifyObject('GOES 16'), 'payload');
  assert.ok(standardMagnitude('ISS (ZARYA)', 'station') < 0);
  assert.ok(standardMagnitude('x', 'debris') > standardMagnitude('x', 'rocket'));
});

test('the ISS is placed about 420 km up and moves across the sky', () => {
  const iss = objectFromOmmRow(FIXTURE_ROWS[0]);
  assert.equal(iss.kind, 'station');
  assert.ok(iss.bright);
  const observer = { gd: observerGd(FIXTURE_HOME.lat, FIXTURE_HOME.lon) };
  const a = lookAt(iss, observer, FIXTURE_NOW);
  assert.ok(a.heightKm > 380 && a.heightKm < 460, `height ${a.heightKm}`);
  const b = lookAt(iss, observer, FIXTURE_NOW + 60000);
  assert.ok(Math.hypot(b.az - a.az, b.el - a.el) > 0.01);
  assert.equal(objectFromOmmRow(['bad']), null);
});

test('sunlight, shadow, brightness and motion helpers', () => {
  const sun = [1, 0, 0];
  assert.equal(isSunlit({ x: 7000, y: 0, z: 0 }, sun), true);
  assert.equal(isSunlit({ x: -7000, y: 0, z: 0 }, sun), false);
  assert.equal(isSunlit({ x: -7000, y: 7000, z: 0 }, sun), true);
  assert.ok(Math.abs(estimateMagnitude(4, 1000, Math.PI / 2) - 4) < 1e-9);
  assert.ok(estimateMagnitude(4, 2000, Math.PI / 2) > 4);
  assert.equal(Math.round(skyHeading({ az: 0, el: 30 }, { az: 0, el: 40 })), 180);
  assert.equal(skyHeading({ az: 10, el: 30 }, { az: 10, el: 30 }), null);
  assert.equal(Math.round(angularDistance({ az: 0, el: 0 }, { az: 90, el: 0 })), 90);
});

test('old element sets are flagged stale; classified TLEs parse', () => {
  const l1 = '1 25544U 98067A   26327.20353679  .00007096  00000+0  13418-3 0  9996';
  const l2 = '2 25544  51.6320 233.1644 0007426  56.0849 304.0845 15.49560282596403';
  const object = objectFromTle('ISS', l1, l2, 'classified');
  assert.equal(object.id, 'c25544');
  assert.ok(elementsFresh(object, FIXTURE_NOW));
  assert.equal(elementsFresh(object, FIXTURE_NOW + 60 * 86400000), false);
  assert.equal(objectFromTle('x', 'junk', 'junk'), null);
});
