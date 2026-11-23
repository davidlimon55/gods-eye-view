import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertConfig, composeDigest, localDateHour, sendDigest, startAlertScheduler } from './alerts.js';
import { FIXTURE_ROWS } from '../../../src/overhead/testFixtures.mjs';

const READY = {
  OMH_ALERTS_ENABLED: '1',
  OMH_ALERT_PROVIDER: 'resend',
  OMH_RESEND_API_KEY: 're_test_not_real',
  OMH_ALERT_FROM: 'Sky <sky@example.com>',
  OMH_ALERT_TO: 'a@example.com, b@example.com',
  OMH_HOME_LAT: '29.5966',
  OMH_HOME_LON: '-98.3686',
  OMH_PUBLIC_URL: 'https://globe.example.com/anything',
};

test('alerts are off unless switched on, and say what is missing', () => {
  assert.equal(alertConfig({}).enabled, false);
  assert.equal(alertConfig({}).ready, false);
  const partial = alertConfig({ OMH_ALERTS_ENABLED: '1' });
  assert.equal(partial.ready, false);
  assert.ok(partial.problems.length >= 4);
  const ready = alertConfig(READY);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.to, ['a@example.com', 'b@example.com']);
  assert.equal(ready.publicUrl, 'https://globe.example.com');
  assert.equal(ready.timeZone, 'America/Chicago');
  assert.equal(alertConfig({ ...READY, OMH_ALERT_TO: 'not an email' }).ready, false);
  assert.equal(alertConfig({ ...READY, OMH_PUBLIC_URL: 'javascript:alert(1)' }).publicUrl, null);
  const scheduler = startAlertScheduler({ feeds: {}, config: alertConfig({}) });
  assert.deepEqual(scheduler.state(), { enabled: false });
});

test('the digest is plain words with the direct link and no secrets', () => {
  const digest = composeDigest({
    catalogPayload: { objects: FIXTURE_ROWS },
    launches: [{ id: 'x', name: 'Starship Flight 12', net: new Date(Date.UTC(2026, 10, 24, 1)).toISOString(), lat: 25.997, lon: -97.157, location: 'Starbase, TX' }],
    home: { lat: 29.5966, lon: -98.3686 },
    nowMs: Date.UTC(2026, 10, 23, 22),
    publicUrl: 'https://globe.example.com',
  });
  assert.match(digest.text, /https:\/\/globe\.example\.com\/overhead\.html/);
  assert.match(digest.text, /Starship Flight 12/);
  // Starbase is about 230 miles from the San Antonio test home.
  assert.match(digest.text, /about \d+ miles to the south/);
  assert.doesNotMatch(digest.text, /\bkm\b/);
  assert.match(digest.html, /target="_blank" rel="noopener"/);
  assert.match(digest.subject, /Tonight's sky/);
  assert.doesNotMatch(`${digest.text}${digest.html}`, /re_test/);
  assert.ok(digest.items >= 1);
});

test('mail goes to the chosen provider only, and dry runs send nothing', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response('{}', { status: 200 });
  };
  const digest = { subject: 's', text: 't', html: '<p>h</p>' };
  await sendDigest(alertConfig(READY), digest, { fetchImpl });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer re_test_not_real');
  assert.deepEqual(JSON.parse(calls[0].options.body).to, ['a@example.com', 'b@example.com']);
  await sendDigest(
    alertConfig({ ...READY, OMH_ALERT_PROVIDER: 'postmark', OMH_POSTMARK_SERVER_TOKEN: 'POSTMARK_API_TEST' }),
    digest,
    { fetchImpl },
  );
  assert.equal(calls[1].url, 'https://api.postmarkapp.com/email');
  assert.equal(calls[1].options.headers['X-Postmark-Server-Token'], 'POSTMARK_API_TEST');
  assert.equal(JSON.parse(calls[1].options.body).To, 'a@example.com,b@example.com');
  const dry = await sendDigest(alertConfig({ ...READY, OMH_ALERT_DRY_RUN: '1' }), digest, { fetchImpl });
  assert.equal(dry.dryRun, true);
  assert.equal(calls.length, 2);
  await assert.rejects(sendDigest(alertConfig(READY), digest, { fetchImpl: async () => new Response('no', { status: 401 }) }), /HTTP 401/);
});

test('local date and hour follow the alert time zone', () => {
  assert.deepEqual(localDateHour(Date.UTC(2026, 10, 24, 3, 30), 'America/Chicago'), { date: '2026-11-23', hour: 21 });
});
