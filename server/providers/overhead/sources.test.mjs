import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adsbPointUrl,
  assertAllowedUpstream,
  celestrakGroupUrl,
  cneosFireballUrl,
  fetchUpstream,
  launchLibraryUpcomingUrl,
  validLatitude,
} from './sources.js';

test('only https on the listed hosts passes the SSRF guard', () => {
  assert.ok(assertAllowedUpstream('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=csv'));
  for (const bad of [
    'http://celestrak.org/',
    'https://celestrak.org.evil.example/',
    'https://user:pw@celestrak.org/',
    'https://celestrak.org:8443/',
    'https://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd',
  ])
    assert.throws(() => assertAllowedUpstream(bad), /not allowed/, bad);
});

test('URLs are built from fixed parts and validated numbers only', () => {
  assert.equal(
    celestrakGroupUrl('active').href,
    'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv',
  );
  assert.equal(
    celestrakGroupUrl('decaying').href,
    'https://celestrak.org/NORAD/elements/gp.php?SPECIAL=decaying&FORMAT=csv',
  );
  assert.throws(() => celestrakGroupUrl('../../etc'));
  assert.equal(adsbPointUrl(29.5966, -98.3686).href, 'https://api.adsb.lol/v2/point/29.60/-98.37/27');
  assert.throws(() => adsbPointUrl('1/../../x', 2));
  assert.throws(() => adsbPointUrl(95, 0));
  assert.equal(validLatitude(''), null);
  const ll2 = launchLibraryUpcomingUrl(Date.UTC(2026, 10, 23, 17, 30), Date.UTC(2026, 10, 25, 5, 10));
  assert.equal(ll2.hostname, 'll.thespacedevs.com');
  assert.equal(ll2.searchParams.get('net__gte'), '2026-11-23T17:00:00.000Z');
  assert.equal(ll2.searchParams.get('mode'), 'normal');
  assert.equal(cneosFireballUrl(Date.UTC(2026, 4, 1)).searchParams.get('date-min'), '2026-05-01');
});

test('upstream fetches refuse redirects and send a descriptive User-Agent', async () => {
  let seen;
  await fetchUpstream(new URL('https://api.adsb.lol/v2/point/1.00/2.00/27'), {
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return new Response('{}');
    },
  });
  assert.equal(seen.options.redirect, 'error');
  assert.match(seen.options.headers['User-Agent'], /over-my-house/);
  await assert.rejects(fetchUpstream('https://example.com/', { fetchImpl: async () => new Response('') }), /not allowed/);
});
