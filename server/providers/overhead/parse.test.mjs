import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  compactFireballs,
  compactLaunches,
  compactRoute,
  extractZipEntry,
  mergeGroups,
  parseGpCsv,
  parseSatcatCsv,
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

const SATCAT = [
  'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE',
  'ISS (ZARYA),1998-067A,25544,PAY,+,ISS,1998-11-20,TYMSC,,92.9,51.6,420,415,399.05,,EA,ORB',
  'SL-3 R/B,1971-028B,5118,R/B,,CIS,1971-04-01,PLMSC,,93,81.2,600,590,,,EA,ORB',
  '"SPUTNIK 1",1957-001B,2,PAY,D,CIS,1957-10-04,TYMSC,1958-01-03,96.1,65.1,938,214,,,EA,IMP',
  'OBJECT A,2026-001A,99001,UNK,?,UNK,2026-01-05,AFETR,,95,53,550,540,,,EA,ORB',
].join('\r\n');

test('SATCAT CSV becomes a small lookup of objects still in orbit', () => {
  const cat = parseSatcatCsv(SATCAT);
  assert.deepEqual(cat['25544'], ['PAY', '+', 'ISS', '1998-11-20', 'TYMSC']);
  assert.equal(cat['2'], undefined, 'decayed objects are dropped');
  assert.equal(cat['99001'][0], 'UNK');
  assert.throws(() => parseSatcatCsv('<html>blocked</html>'), /header/);
});

test('the SATCAT corrects kinds and flags unknown and unlisted objects', () => {
  const cat = parseSatcatCsv(SATCAT);
  const unknownRow = ISS.replace('ISS (ZARYA)', 'OBJECT A').replace(',25544,', ',99001,');
  const unlisted = ISS.replace('ISS (ZARYA)', 'NEWSAT').replace(',25544,', ',99555,');
  const records = parseGpCsv([HEADER, ISS, unknownRow, unlisted].join('\n'));
  const rows = mergeGroups(new Map([['active', records]]), { nowMs: NOW, satcat: cat });
  const byId = Object.fromEntries(rows.map((r) => [r[0], r]));
  assert.equal(byId[99001][3], 'unknown');
  assert.match(byId[99001][14], /u/);
  assert.match(byId[99555][14], /n/);
  assert.doesNotMatch(byId[25544][14], /[nu]/);
});

const ATL = { name: 'Hartsfield Jackson Atlanta International Airport', icao: 'KATL', iata: 'ATL', location: 'Atlanta', countryiso2: 'US', lat: 33.6367, lon: -84.428101 };
const SAT = { name: 'San Antonio International Airport', icao: 'KSAT', iata: 'SAT', location: 'San Antonio', countryiso2: 'US', lat: 29.533701, lon: -98.469803 };
const DAL2009 = { callsign: 'DAL2009', number: '2009', airline_code: 'DAL', airport_codes: 'KATL-KSAT-KATL', _airport_codes_iata: 'ATL-SAT-ATL', _airports: [ATL, SAT, ATL] };

test('a multi-stop route picks the leg the plane is flying, by where it is and where it is heading', () => {
  // Arriving: just east of San Antonio, heading west.
  const arriving = compactRoute(DAL2009, { lat: 29.6, lon: -97.9, track: 270 });
  assert.equal(arriving.known, true);
  assert.equal(arriving.from.code, 'ATL');
  assert.equal(arriving.to.code, 'SAT');
  assert.equal(arriving.to.city, 'San Antonio');
  // Leaving San Antonio, heading east toward Atlanta.
  const leaving = compactRoute(DAL2009, { lat: 29.7, lon: -97.9, track: 75 });
  assert.equal(leaving.from.code, 'SAT');
  assert.equal(leaving.to.code, 'ATL');
});

test('routes that do not fit the plane, or are unknown, say so', () => {
  // Over Seattle: nowhere near Atlanta-San Antonio.
  assert.deepEqual(
    [compactRoute(DAL2009, { lat: 47.6, lon: -122.3, track: 90 }).known, compactRoute(DAL2009, { lat: 47.6, lon: -122.3 }).reason],
    [false, 'implausible'],
  );
  assert.equal(compactRoute({ callsign: 'X1', airport_codes: 'unknown', _airports: [] }).reason, 'unknown');
  assert.equal(compactRoute({ ...DAL2009, plausible: false }, { lat: 29.6, lon: -97.9 }).reason, 'implausible');
  // Mid-leg but flying the opposite way from the only leg.
  const oneLeg = { ...DAL2009, airport_codes: 'KATL-KSAT', _airports: [ATL, SAT] };
  assert.equal(compactRoute(oneLeg, { lat: 31.5, lon: -91.5, track: 70 }).reason, 'implausible');
  assert.equal(compactRoute(oneLeg, { lat: 31.5, lon: -91.5, track: 250 }).known, true);
});
