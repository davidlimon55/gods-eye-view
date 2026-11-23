import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HIT_RADIUS,
  MAX_ZOOM,
  clampView,
  compassLetterAt,
  nearestPoint,
  toScreen,
  zoomAbout,
} from './skyView.js';
import { miles, milesWords } from './words.js';

test('distances read in miles: one decimal under 10, whole from 10 up', () => {
  assert.equal(miles(11.3), '7');
  assert.equal(miles(10.9), '6.8');
  assert.equal(miles(0.7), '0.4');
  assert.equal(miles(547), '340');
  assert.equal(miles(16.09), '10');
  assert.equal(miles(Number.NaN), '');
  assert.equal(milesWords(1.609), '1 mile');
  assert.equal(milesWords(547), '340 miles');
  assert.equal(milesWords(undefined), '');
});

test('zooming keeps the point under the fingers in place and stays in range', () => {
  const cx = 200;
  const cy = 200;
  const r = 174;
  const start = { zoom: 1, panX: 0, panY: 0 };
  const sx = 260;
  const sy = 150;
  const next = zoomAbout(start, 3, sx, sy, cx, cy, r);
  assert.equal(next.zoom, 3);
  // The sky point that was under (sx, sy) is still there.
  const [x, y] = toScreen(next, cx, cy, sx, sy);
  assert.ok(Math.abs(x - sx) < 1e-9 && Math.abs(y - sy) < 1e-9);
  assert.equal(zoomAbout(start, 50, cx, cy, cx, cy, r).zoom, MAX_ZOOM);
  assert.deepEqual(zoomAbout(next, 0.2, cx, cy, cx, cy, r), {
    zoom: 1,
    panX: 0,
    panY: 0,
  });
});

test('panning stops once the horizon edge reaches its 1x spot', () => {
  assert.deepEqual(clampView({ zoom: 1, panX: 80, panY: -40 }, 100), {
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  assert.deepEqual(clampView({ zoom: 2, panX: 500, panY: -500 }, 100), {
    zoom: 2,
    panX: 100,
    panY: -100,
  });
});

test('a tap picks the nearest dot within the hit radius', () => {
  const points = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 112, y: 100 },
  ];
  assert.equal(nearestPoint(points, 109, 100).id, 'b');
  assert.equal(nearestPoint(points, 100 - HIT_RADIUS + 1, 100).id, 'a');
  assert.equal(nearestPoint(points, 100, 100 + HIT_RADIUS + 2), null);
});

test('compass letters stay on their own side when zoomed', () => {
  const size = 400;
  const view = { zoom: 4, panX: 120, panY: -90 };
  const n = compassLetterAt('N', view, 200, 200, 174, size);
  const s = compassLetterAt('S', view, 200, 200, 174, size);
  const e = compassLetterAt('E', view, 200, 200, 174, size);
  const w = compassLetterAt('W', view, 200, 200, 174, size);
  assert.ok(n[1] < s[1], 'N above S');
  assert.ok(w[0] < e[0], 'W left of E');
  for (const [x, y] of [n, s, e, w]) {
    assert.ok(x >= 0 && x <= size && y >= 0 && y <= size);
  }
});

test('a tap on a crowded spot lists every dot under it, bright and near first, gray ones included', async () => {
  const { pointsNear } = await import('./skyView.js');
  const points = [
    { id: 'gray-close', x: 100, y: 100, tier: 1, mag: 7 },
    { id: 'bright', x: 110, y: 100, tier: 0, mag: 2 },
    { id: 'brighter', x: 112, y: 100, tier: 0, mag: 1 },
    { id: 'far', x: 200, y: 200, tier: 0, mag: 0 },
    { id: 'bright', x: 110, y: 101, tier: 0, mag: 2 },
  ];
  assert.deepEqual(pointsNear(points, 100, 100).map((p) => p.id), ['brighter', 'bright', 'gray-close']);
  // A lone gray dot can be tapped.
  assert.deepEqual(pointsNear([{ id: 'g', x: 50, y: 50, tier: 1 }], 60, 55).map((p) => p.id), ['g']);
  assert.deepEqual(pointsNear(points, 400, 400), []);
});
