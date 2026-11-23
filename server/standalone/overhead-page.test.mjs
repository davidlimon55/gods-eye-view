import test from 'node:test';
import assert from 'node:assert/strict';
import { isOverheadPage, stripCesiumTags } from './overhead-page.js';

test('the Over My House page drops the Cesium script and stylesheet', () => {
  const html =
    '<head>\n  <link rel="stylesheet" href="/cesium/Widgets/widgets.css">\n  <script src="/cesium/Cesium.js"></script>\n  <title>x</title>\n</head>';
  const out = stripCesiumTags(html);
  assert.doesNotMatch(out, /cesium/i);
  assert.match(out, /<title>x<\/title>/);
});

test('only overhead.html is treated as the light page', () => {
  assert.equal(isOverheadPage({ filename: '/repo/overhead.html' }), true);
  assert.equal(isOverheadPage({ path: '/overhead.html' }), true);
  assert.equal(isOverheadPage({ filename: '/repo/index.html' }), false);
  assert.equal(isOverheadPage({ filename: '/repo/not-overhead.html' }), false);
});
