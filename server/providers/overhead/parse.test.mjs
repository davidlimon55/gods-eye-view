import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  compactFireballs,
  compactLaunches,
  extractZipEntry,
  mergeGroups,
  parseGpCsv,
  parseTle,
  splitCsvLine,
} from './parse.js';

const HEADER =
  'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT';
const ISS = 'ISS (ZARYA),1998-067A,2026-11-23T04:53:05.578656,15.49560282,.0007426,51.6320,233.1644,56.0849,304.0845,0,U,25544,999,59640,.13418E-3,.7096E-4,0';
const RB = 'SL-3 R/B,1971-028B,2026-11-23T11:53:52.417248,15.97432750,.0005212,81.2195,85.9268,17.0937,343.0510,0,U,5118,999,2939,.45877E-3,.202118E-2,.15017E-4';
const NOW = Date.UTC(2026, 10, 23, 18);

test('GP CSV parses; an error page or block notice throws so the cache is kept', () => {
  const rows = parseGpCsv(`${HEADER}\r\n${ISS}\r\n${RB}\r\nbroken,row\r\n`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].NORAD_CAT_ID, '25544');
  assert.throws(() => parseGpCsv('GP data has not updated since your last successful download'));
  assert.throws(() => parseGpCsv('OBJECT_NAME,NOPE\n'));
  assert.deepEqual(splitCsvLine('"A, B",x,"say ""hi"""'), ['A, B', 'x', 'say "hi"']);
});

test('groups merge into one row per object with kind and flags', () => {
  const stations = parseGpCsv(`${HEADER}\n${ISS}`);
  const decaying = parseGpCsv(`${HEADER}\n${RB}`);
  const rows = mergeGroups(
    new Map([
      ['active', stations],
      ['stations', stations],
      ['visual', stations],
      ['decaying', decaying],
      ['last-30-days', decaying],
    ]),
    { nowMs: NOW },
  );
  assert.equal(rows.length, 2);
  const iss = rows.find((r) => r[0] === 25544);
  assert.equal(iss[3], 'station');
  assert.equal(iss[14], 'b');
  const rb = rows.find((r) => r[0] === 5118);
  assert.equal(rb[3], 'rocket');
  assert.equal(rb[14], 'r');
  // Element sets older than 30 days are dropped.
  assert.equal(mergeGroups(new Map([['stations', stations]]), { nowMs: NOW + 40 * 86400000 }).length, 0);
});

test('TLE files parse into named three-line sets', () => {
  const text = [
    'USA 224',
    '1 37348U 11002A   26320.12345678  .00000000  00000-0  00000-0 0    01',
    '2 37348  97.9000 100.0000 0005000 100.0000 260.0000 14.80000000    01',
    'junk line',
  ].join('\n');
  const sets = parseTle(text);
  assert.equal(sets.length, 1);
  assert.equal(sets[0][0], 'USA 224');
});

/** A one-file zip archive, deflated, built the way zip tools write it. */
function zipOf(name, content) {
  const data = deflateRawSync(Buffer.from(content));
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, nameBuf, data]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, end]);
}

test('the classified zip is read through its central directory, with size caps', () => {
  const zip = zipOf('classfd.tle', 'hello satellites');
  assert.equal(extractZipEntry(zip, 'classfd.tle'), 'hello satellites');
  assert.throws(() => extractZipEntry(zip, 'other.tle'), /not found/);
  assert.throws(() => extractZipEntry(zip, 'classfd.tle', 4), /too large/);
  assert.throws(() => extractZipEntry(Buffer.from('not a zip at all, just text'), 'x'), /not a zip/);
});

test('launches and fireballs are reduced to the few fields the view needs', () => {
  const launches = compactLaunches({
    results: [
      { id: 'a', name: 'Falcon 9 | Starlink', net: '2026-11-24T02:00:00Z', status: { abbrev: 'Go' }, pad: { name: 'SLC-40', latitude: '28.56', longitude: '-80.57', location: { name: 'Cape Canaveral, FL' } }, url: 'https://ll.thespacedevs.com/x' },
      { id: '', name: 'bad' },
      { id: 'b', name: 'odd link', net: '2026-11-24T02:00:00Z', url: 'javascript:alert(1)' },
    ],
  });
  assert.equal(launches.length, 2);
  assert.equal(launches[0].lat, 28.56);
  assert.equal(launches[0].webcast, 'https://ll.thespacedevs.com/x');
  assert.equal(launches[1].webcast, null);
  const fireballs = compactFireballs({
    fields: ['date', 'energy', 'impact-e', 'lat', 'lat-dir', 'lon', 'lon-dir', 'alt', 'vel'],
    data: [['2026-10-04 03:14:45', '5.4', '0.18', '41.8', 'S', '173.1', 'W', '26.9', '13.8']],
  });
  assert.deepEqual(fireballs[0].lat, -41.8);
  assert.deepEqual(fireballs[0].lon, -173.1);
  assert.equal(fireballs[0].date, '2026-10-04T03:14:45Z');
});
