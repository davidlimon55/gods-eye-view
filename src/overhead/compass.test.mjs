import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearingDifference, bearingOf, compassPoint, heightBand } from './compass.js';

test('compass points and height bands use plain buckets', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(44), 'NE');
  assert.equal(compassPoint(200), 'S');
  assert.equal(compassPoint(-90), 'W');
  assert.equal(compassPoint(Number.NaN), null);
  assert.equal(bearingOf('SE'), 135);
  assert.equal(bearingOf('nope'), null);
  assert.equal(heightBand(2), null);
  assert.equal(heightBand(12), 'low');
  assert.equal(heightBand(45), 'medium');
  assert.equal(heightBand(80), 'high');
  assert.equal(bearingDifference(350, 10), 20);
  assert.equal(bearingDifference(90, 270), 180);
});
