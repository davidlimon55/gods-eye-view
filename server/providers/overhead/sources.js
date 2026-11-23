/**
 * Upstream sources for the Over My House feature. Every URL the server
 * fetches is built here from a fixed host and path; nothing a browser sends
 * ever becomes part of a hostname or path (SSRF guard). Coordinates are the
 * only client values that reach a URL, and they are validated numbers.
 *
 * Every endpoint below was fetched and checked on 2026-11-23; see
 * docs/OVER-MY-HOUSE.md for terms and limits.
 */

/** Hosts this feature may contact, and nothing else. */
export const OVERHEAD_ALLOWED_HOSTS = Object.freeze([
  'celestrak.org',
  'www.mmccants.org',
  'api.adsb.lol',
  'vrs-standing-data.adsb.lol',
  'll.thespacedevs.com',
  'ssd-api.jpl.nasa.gov',
]);

export const OVERHEAD_USER_AGENT =
  'gods-eye-view-over-my-house/1.0 (+https://github.com/davidlimon55/gods-eye-view)';

/**
 * CelesTrak GP groups (CSV, the format CelesTrak asks for). `active` already
 * contains every Starlink, so the Starlink group is not fetched separately
 * (CelesTrak enforces one download per update for both).
 */
export const CELESTRAK_GROUPS = Object.freeze([
  Object.freeze({ id: 'stations', query: 'GROUP', value: 'stations' }),
  Object.freeze({ id: 'visual', query: 'GROUP', value: 'visual' }),
  Object.freeze({ id: 'active', query: 'GROUP', value: 'active' }),
  Object.freeze({ id: 'last-30-days', query: 'GROUP', value: 'last-30-days' }),
  Object.freeze({ id: 'analyst', query: 'GROUP', value: 'analyst' }),
  Object.freeze({ id: 'decaying', query: 'SPECIAL', value: 'decaying' }),
  Object.freeze({
    id: 'fengyun-1c-debris',
    query: 'GROUP',
    value: 'fengyun-1c-debris',
  }),
  Object.freeze({
    id: 'iridium-33-debris',
    query: 'GROUP',
    value: 'iridium-33-debris',
  }),
  Object.freeze({
    id: 'cosmos-2251-debris',
    query: 'GROUP',
    value: 'cosmos-2251-debris',
  }),
]);

/** CelesTrak GP query URL for one registered group. */
export function celestrakGroupUrl(group) {
  const entry = CELESTRAK_GROUPS.find((g) => g.id === group);
  if (!entry) throw new Error('unknown CelesTrak group');
  const url = new URL('https://celestrak.org/NORAD/elements/gp.php');
  url.searchParams.set(entry.query, entry.value);
  url.searchParams.set('FORMAT', 'csv');
  return url;
}

/** Mike McCants' classified-objects element file (zip holding classfd.tle). */
export const MCCANTS_CLASSIFIED_URL = new URL(
  'https://www.mmccants.org/tles/classfd.zip',
);

/** adsb.lol aircraft within 27 nautical miles (~50 km) of a point. */
export function adsbPointUrl(lat, lon, radiusNm = 27) {
  const safeLat = validLatitude(lat);
  const safeLon = validLongitude(lon);
  if (safeLat === null || safeLon === null)
    throw new Error('invalid coordinates');
  const radius = Math.max(1, Math.min(50, Math.round(Number(radiusNm))));
  return new URL(
    `https://api.adsb.lol/v2/point/${safeLat.toFixed(2)}/${safeLon.toFixed(2)}/${radius}`,
  );
}

/**
 * CelesTrak's whole satellite catalog (SATCAT) as CSV: owner, launch date,
 * launch site and object type for every catalogued object. It updates once
 * or twice a day by hand, so this is fetched at most once a day.
 */
export const CELESTRAK_SATCAT_URL = new URL(
  'https://celestrak.org/pub/satcat.csv',
);

/**
 * adsb.lol route lookup (POST {planes: [{callsign, lat, lng}]}, at most 100
 * planes). Marked `x-quota: free` in api.adsb.lol/api/openapi.json, so it does
 * not count against the 500-a-day keyless quota for /v2/.
 */
export const ADSB_ROUTESET_URL = new URL('https://api.adsb.lol/api/0/routeset');

/** A callsign as adsb.lol sends it (letters and digits), upper case, or null. */
export function cleanCallsign(value) {
  const cs = String(value ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z0-9]{2,8}$/.test(cs) ? cs : null;
}

/**
 * The static route file adsb.lol serves for one callsign (Virtual Radar
 * Server standing data, CC0), used when the routeset answer is empty.
 */
export function vrsRouteUrl(callsign) {
  const cs = cleanCallsign(callsign);
  if (!cs) throw new Error('invalid callsign');
  return new URL(
    `https://vrs-standing-data.adsb.lol/routes/${cs.slice(0, 2)}/${cs}.json`,
  );
}

/** Launch Library 2 upcoming launches between two times (normal mode has pad coordinates). */
export function launchLibraryUpcomingUrl(fromMs, toMs) {
  const url = new URL('https://ll.thespacedevs.com/2.3.0/launches/');
  // Hour boundaries, so the URL (and LL2's cache) stays stable within an hour.
  const from = new Date(Math.floor(fromMs / 3600000) * 3600000);
  const to = new Date(Math.ceil(toMs / 3600000) * 3600000);
  url.searchParams.set('net__gte', from.toISOString());
  url.searchParams.set('net__lte', to.toISOString());
  url.searchParams.set('limit', '30');
  url.searchParams.set('mode', 'normal');
  url.searchParams.set('ordering', 'net');
  return url;
}

/** NASA/JPL CNEOS fireball API: located fireballs on or after a date. */
export function cneosFireballUrl(sinceMs) {
  const url = new URL('https://ssd-api.jpl.nasa.gov/fireball.api');
  url.searchParams.set(
    'date-min',
    new Date(sinceMs).toISOString().slice(0, 10),
  );
  url.searchParams.set('req-loc', 'true');
  return url;
}

/** A latitude as a finite number in range, or null. */
export function validLatitude(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= -90 && n <= 90 ? n : null;
}

/** A longitude as a finite number in range, or null. */
export function validLongitude(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
}

/**
 * SSRF guard: only https URLs on the allowlisted hosts, on the default port,
 * with no credentials. Called on every URL before fetch.
 */
export function assertAllowedUpstream(url) {
  const parsed = url instanceof URL ? url : new URL(String(url));
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    !OVERHEAD_ALLOWED_HOSTS.includes(parsed.hostname)
  )
    throw new Error('upstream not allowed');
  return parsed;
}

/**
 * Fetch an allowlisted upstream. Redirects are refused (a redirect could
 * point anywhere, and CelesTrak asks clients to treat a 301 as an error).
 */
export async function fetchUpstream(
  url,
  { timeoutMs = 20000, accept, fetchImpl = globalThis.fetch, json } = {},
) {
  const safe = assertAllowedUpstream(url);
  return fetchImpl(safe.toString(), {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    ...(json === undefined
      ? {}
      : { method: 'POST', body: JSON.stringify(json) }),
    headers: {
      'User-Agent': OVERHEAD_USER_AGENT,
      'Accept-Encoding': 'gzip, br',
      ...(accept ? { Accept: accept } : {}),
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  });
}
