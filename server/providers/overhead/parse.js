import { inflateRawSync } from 'node:zlib';
import { classifyObject } from '../../../src/overhead/satellites.js';

/** CelesTrak GP CSV columns this feature reads. */
const GP_COLUMNS = Object.freeze([
  'NORAD_CAT_ID',
  'OBJECT_NAME',
  'OBJECT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
]);

/** Split one CSV line, honouring double quotes (names can contain commas). */
export function splitCsvLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

/**
 * Parse a CelesTrak GP CSV body into plain records. Throws when the header
 * is missing (an error page, a block notice), so the caller keeps its cache.
 */
export function parseGpCsv(body) {
  const lines = String(body || '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length || !lines[0].startsWith('OBJECT_NAME,'))
    throw new Error('no GP CSV header');
  const header = splitCsvLine(lines[0]);
  const index = Object.fromEntries(
    GP_COLUMNS.map((key) => [key, header.indexOf(key)]),
  );
  if (Object.values(index).some((i) => i < 0))
    throw new Error('GP CSV header missing columns');
  const records = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const record = {};
    for (const key of GP_COLUMNS) record[key] = cells[index[key]];
    const numbers = GP_COLUMNS.filter(
      (key) => !['OBJECT_NAME', 'OBJECT_ID', 'EPOCH'].includes(key),
    );
    if (numbers.some((key) => !Number.isFinite(Number(record[key])))) continue;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(record.EPOCH)) continue;
    records.push(record);
  }
  return records;
}

/**
 * Merge GP records from several groups into the compact rows the browser
 * reads (src/overhead/satellites.js OMM_ROW_FIELDS), one row per object.
 * @param {Map<string, object[]>} groups group id -> records
 * @param {{maxAgeDays?: number, nowMs?: number, satcat?: ?object}} [options]
 *   Stale element sets (older than maxAgeDays) are dropped; SGP4 drifts badly
 *   after weeks. With the SATCAT lookup (parseSatcatCsv), its object type
 *   corrects the kind (a "payload" name the catalog calls debris is debris),
 *   and flags mark objects it lists as unknown ('u') or does not list ('n').
 */
export function mergeGroups(
  groups,
  { maxAgeDays = 30, nowMs = Date.now(), satcat = null } = {},
) {
  const bright = new Set(
    (groups.get('visual') ?? []).map((r) => String(r.NORAD_CAT_ID)),
  );
  const recent = new Set(
    (groups.get('last-30-days') ?? []).map((r) => String(r.NORAD_CAT_ID)),
  );
  const rows = new Map();
  for (const [group, records] of groups) {
    for (const r of records) {
      const id = String(r.NORAD_CAT_ID);
      const epoch = Date.parse(`${r.EPOCH}Z`);
      if (!Number.isFinite(epoch) || nowMs - epoch > maxAgeDays * 86400000)
        continue;
      const previous = rows.get(id);
      // Keep the newest element set, and the most specific group for its
      // kind ('active' and 'last-30-days' say nothing about what it is).
      const generic = (g) =>
        g === 'active' || g === 'last-30-days' || g === 'visual';
      const keptGroup = previous && generic(group) ? previous.group : group;
      if (previous && previous.epoch >= epoch) {
        previous.group = keptGroup;
        continue;
      }
      rows.set(id, { group: keptGroup, epoch, r });
    }
  }
  const out = [];
  for (const [id, { group, r }] of rows) {
    let flags = `${bright.has(id) ? 'b' : ''}${recent.has(id) ? 'r' : ''}`;
    let kind = classifyObject(r.OBJECT_NAME, group);
    if (satcat && kind !== 'analyst') {
      const entry = satcat[String(Number(id))];
      const type = Array.isArray(entry) ? entry[0] : null;
      if (!type) flags += 'n';
      else if (type === 'UNK') {
        flags += 'u';
        kind = 'unknown';
      } else if (type === 'R/B' && kind !== 'rocket') kind = 'rocket';
      else if (type === 'DEB' && kind !== 'debris') kind = 'debris';
    }
    out.push([
      Number(id),
      String(r.OBJECT_NAME || '').trim(),
      String(r.OBJECT_ID || ''),
      kind,
      r.EPOCH,
      Number(r.MEAN_MOTION),
      Number(r.ECCENTRICITY),
      Number(r.INCLINATION),
      Number(r.RA_OF_ASC_NODE),
      Number(r.ARG_OF_PERICENTER),
      Number(r.MEAN_ANOMALY),
      Number(r.BSTAR),
      Number(r.MEAN_MOTION_DOT),
      Number(r.MEAN_MOTION_DDOT),
      flags,
    ]);
  }
  return out;
}

/**
 * Parse a three-line element file into [name, line1, line2] entries,
 * checking each line's modulo-10 checksum.
 */
export function parseTle(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ''));
  const out = [];
  for (let i = 0; i < lines.length - 2; i += 1) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (
      l1?.startsWith('1 ') &&
      l2?.startsWith('2 ') &&
      !name.startsWith('1 ') &&
      !name.startsWith('2 ')
    ) {
      if (l1.length >= 68 && l2.length >= 68) out.push([name.trim(), l1, l2]);
      i += 2;
    }
  }
  return out;
}

/**
 * Extract one file from a zip archive (stored or deflated), bounded in size.
 * Reads the central directory, so a lying local header cannot redirect it.
 * @param {Buffer} zip
 * @param {string} wanted File name inside the archive.
 * @param {number} [maxBytes]
 */
export function extractZipEntry(zip, wanted, maxBytes = 4 * 1024 * 1024) {
  const buf = Buffer.isBuffer(zip) ? zip : Buffer.from(zip);
  // End of central directory record: last 22..65557 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('bad zip directory');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    if (size > maxBytes || compressedSize > maxBytes)
      throw new Error('zip entry too large');
    if (buf.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error('bad zip entry');
    const dataStart =
      localOffset +
      30 +
      buf.readUInt16LE(localOffset + 26) +
      buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return data.toString('utf8');
    if (method === 8)
      return inflateRawSync(data, { maxOutputLength: maxBytes }).toString(
        'utf8',
      );
    throw new Error('unsupported zip compression');
  }
  throw new Error('zip entry not found');
}

/** Compact launches from a Launch Library 2 (normal mode) answer. */
export function compactLaunches(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .map((l) => ({
      id: String(l.id || ''),
      name: String(l.name || '').slice(0, 160),
      net: String(l.net || ''),
      status: String(l.status?.abbrev || l.status?.name || '').slice(0, 40),
      provider: String(l.launch_service_provider?.name || '').slice(0, 120),
      pad: String(l.pad?.name || '').slice(0, 120),
      location: String(l.pad?.location?.name || '').slice(0, 160),
      lat: Number(l.pad?.latitude),
      lon: Number(l.pad?.longitude),
      webcast: safeHttpsUrl(l.vid_urls?.[0]?.url || l.url),
    }))
    .filter((l) => l.id && Number.isFinite(Date.parse(l.net)));
}

/** Compact fireballs from the CNEOS API (fields named in its answer). */
export function compactFireballs(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const at = (row, key) => row[fields.indexOf(key)];
  return (Array.isArray(payload?.data) ? payload.data : [])
    .map((row) => {
      const lat =
        Number(at(row, 'lat')) * (at(row, 'lat-dir') === 'S' ? -1 : 1);
      const lon =
        Number(at(row, 'lon')) * (at(row, 'lon-dir') === 'W' ? -1 : 1);
      return {
        date: `${String(at(row, 'date') || '').replace(' ', 'T')}Z`,
        lat,
        lon,
        altKm: at(row, 'alt') === null ? null : Number(at(row, 'alt')),
        energy: Number(at(row, 'energy')),
        impactKt: Number(at(row, 'impact-e')),
      };
    })
    .filter(
      (f) =>
        Number.isFinite(Date.parse(f.date)) &&
        Number.isFinite(f.lat) &&
        Number.isFinite(f.lon),
    );
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** SATCAT CSV columns this feature keeps (celestrak.org/satcat/satcat-format.php). */
const SATCAT_COLUMNS = Object.freeze([
  'NORAD_CAT_ID',
  'OBJECT_TYPE',
  'OPS_STATUS_CODE',
  'OWNER',
  'LAUNCH_DATE',
  'LAUNCH_SITE',
  'DECAY_DATE',
]);

/**
 * Parse CelesTrak's SATCAT CSV into a compact lookup of objects still in
 * orbit: `{ "25544": ["PAY", "+", "ISS", "1998-11-20", "TYMSC"] }`.
 * Decayed objects are dropped (they can never be over the house), which
 * keeps the cached copy to a few MB. Throws when the header is missing.
 */
export function parseSatcatCsv(body) {
  const text = String(body || '');
  const firstBreak = text.indexOf('\n');
  const header = splitCsvLine(
    (firstBreak < 0 ? text : text.slice(0, firstBreak)).replace(/\r$/, ''),
  );
  const index = Object.fromEntries(
    SATCAT_COLUMNS.map((key) => [key, header.indexOf(key)]),
  );
  if (Object.values(index).some((i) => i < 0))
    throw new Error('no SATCAT CSV header');
  const out = {};
  let count = 0;
  let start = firstBreak + 1;
  while (start > 0 && start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    start = end + 1;
    if (!line) continue;
    const cells = splitCsvLine(line);
    const id = String(cells[index.NORAD_CAT_ID] || '').trim();
    if (!/^\d{1,9}$/.test(id)) continue;
    if (String(cells[index.DECAY_DATE] || '').trim()) continue;
    const clip = (key, n) =>
      String(cells[index[key]] || '')
        .trim()
        .slice(0, n);
    out[String(Number(id))] = [
      clip('OBJECT_TYPE', 4),
      clip('OPS_STATUS_CODE', 2),
      clip('OWNER', 6),
      clip('LAUNCH_DATE', 10),
      clip('LAUNCH_SITE', 6),
    ];
    count += 1;
  }
  if (!count) throw new Error('empty SATCAT');
  return out;
}

const NM_KM = 1.852;

/** Great-circle distance in km. */
function gcKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) *
      Math.cos(lat2 * r) *
      Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing (degrees) from one point to another. */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x =
    Math.cos(lat1 * r) * Math.sin(lat2 * r) -
    Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (((Math.atan2(y, x) / r) % 360) + 360) % 360;
}

/** Cross-track distance (km) of a point from the great circle A->B, and whether it lies between them. */
function crossTrackKm(p, a, b) {
  const d13 = gcKm(a.lat, a.lon, p.lat, p.lon) / 6371;
  const t13 = (bearingDeg(a.lat, a.lon, p.lat, p.lon) * Math.PI) / 180;
  const t12 = (bearingDeg(a.lat, a.lon, b.lat, b.lon) * Math.PI) / 180;
  const xt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * 6371;
  const along = Math.acos(Math.cos(d13) / Math.cos(xt / 6371)) * 6371;
  return { xt: Math.abs(xt), along };
}

/**
 * One airport as the page needs it.
 * @returns {?{code: string, icao: string, city: string, name: string, country: string, lat: number, lon: number}}
 */
function compactAirport(a) {
  const lat = Number(a?.lat);
  const lon = Number(a?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const clip = (v, n) => String(v ?? '').slice(0, n);
  return {
    code: clip(a.iata || a.icao, 4),
    icao: clip(a.icao, 4),
    city: clip(a.location, 80),
    name: clip(a.name, 120),
    country: clip(a.countryiso2, 2),
    lat,
    lon,
  };
}

/**
 * Turn one adsb.lol / VRS route record into the leg this plane is flying.
 * A record can list several stops (KATL-KSAT-KATL); the leg chosen is the
 * one the plane sits near (within 50 nautical miles or 20% of the leg, the
 * same rule adsb.lol's own `plausible` flag uses) and is heading toward.
 * Returns `{known: false, reason}` when there is no route or it does not
 * fit where the plane is.
 * @param {object} record
 * @param {{lat?: number, lon?: number, track?: number}} [plane]
 */
export function compactRoute(record, plane = {}) {
  const callsign = String(record?.callsign || '').slice(0, 8);
  const airports = (Array.isArray(record?._airports) ? record._airports : [])
    .slice(0, 8)
    .map(compactAirport)
    .filter(Boolean);
  const base = {
    callsign,
    airline: String(record?.airline_code || '').slice(0, 4),
    number: String(record?.number || '').slice(0, 8),
  };
  if (
    airports.length < 2 ||
    String(record?.airport_codes || 'unknown') === 'unknown'
  )
    return { ...base, known: false, reason: 'unknown' };
  if (record?.plausible === false)
    return { ...base, known: false, reason: 'implausible' };
  const lat = Number(plane.lat);
  const lon = Number(plane.lon);
  const legs = [];
  for (let i = 0; i < airports.length - 1; i += 1)
    legs.push([airports[i], airports[i + 1]]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    // No position to check: only a one-leg route is safe to show.
    if (legs.length !== 1)
      return { ...base, known: false, reason: 'implausible' };
    return { ...base, known: true, from: legs[0][0], to: legs[0][1] };
  }
  const p = { lat, lon };
  const track = Number(plane.track);
  let best = null;
  for (const [a, b] of legs) {
    const legKm = gcKm(a.lat, a.lon, b.lat, b.lon);
    const limit = Math.max(50 * NM_KM, 0.2 * legKm);
    const nearA = gcKm(a.lat, a.lon, lat, lon);
    const nearB = gcKm(b.lat, b.lon, lat, lon);
    const { xt, along } = crossTrackKm(p, a, b);
    const between = along <= legKm + limit;
    const fits = nearA <= limit || nearB <= limit || (xt <= limit && between);
    if (!fits) continue;
    // Heading toward this leg's destination scores better.
    let turn = 90;
    if (Number.isFinite(track) && nearB > 5) {
      const want = bearingDeg(lat, lon, b.lat, b.lon);
      turn = Math.abs(((track - want + 540) % 360) - 180);
    }
    const score = xt / limit + turn / 90;
    const nearEnd = nearA <= limit || nearB <= limit;
    if (!best || score < best.score) best = { score, a, b, turn, nearEnd };
  }
  // Out in the middle of a leg and flying away from where it goes: wrong route.
  if (!best || (!best.nearEnd && best.turn > 120))
    return { ...base, known: false, reason: 'implausible' };
  return { ...base, known: true, from: best.a, to: best.b };
}
