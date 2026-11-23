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
 * @param {{maxAgeDays?: number, nowMs?: number}} [options] Stale element
 *   sets (older than maxAgeDays) are dropped; SGP4 drifts badly after weeks.
 */
export function mergeGroups(
  groups,
  { maxAgeDays = 30, nowMs = Date.now() } = {},
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
    const flags = `${bright.has(id) ? 'b' : ''}${recent.has(id) ? 'r' : ''}`;
    out.push([
      Number(id),
      String(r.OBJECT_NAME || '').trim(),
      String(r.OBJECT_ID || ''),
      classifyObject(r.OBJECT_NAME, group),
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
