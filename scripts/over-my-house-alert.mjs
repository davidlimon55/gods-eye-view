#!/usr/bin/env node
/**
 * Preview (or send) the Over My House "tonight's sky" email.
 *
 *   npm run overhead:alert                 print tonight's email, send nothing
 *   npm run overhead:alert -- --send       send it now with the OMH_* settings
 *
 * Uses the same cache folder and upstream rules as the running app
 * (.gev-cache/overhead), so it never downloads more than the app would.
 * Home comes from OMH_HOME_LAT / OMH_HOME_LON (required).
 */
import { createOverheadFeeds } from '../server/providers/overhead/feeds.js';
import { alertConfig, composeDigest, sendDigest } from '../server/providers/overhead/alerts.js';

const send = process.argv.includes('--send');
const config = alertConfig(process.env);
if (!config.home) {
  console.error('Set OMH_HOME_LAT and OMH_HOME_LON first (your home, in decimal degrees).');
  process.exit(2);
}
const feeds = createOverheadFeeds();
const catalog = await feeds.catalog();
const launches = (await feeds.launches.get()).value ?? [];
const digest = composeDigest({
  catalogPayload: JSON.parse(catalog.body),
  launches,
  home: config.home,
  timeZone: config.timeZone,
  publicUrl: config.publicUrl,
  minMag: config.minMag,
});
console.log(`Subject: ${digest.subject}\n\n${digest.text}`);
if (send) {
  if (!config.ready) {
    console.error(`Not sending: ${config.problems.join('; ')}`);
    process.exit(1);
  }
  const result = await sendDigest(config, digest);
  console.log(result.dryRun ? '\n(dry run: nothing sent)' : `\nSent to ${config.to.length} recipient(s).`);
}
