import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adsbMapUrl,
  aircraftTypeWords,
  filterCounts,
  displayName,
  filterOf,
  isPlaceholderName,
  mphFromKms,
  mphFromKnots,
  n2yoUrl,
  objectDetails,
  parseCallsign,
  planeDetails,
  unidentifiedReason,
  verticalWords,
} from './details.js';

const line = (d, label) => d.lines.find(([l]) => l === label)?.[1];

test('callsigns become airline and flight number, unknown prefixes stay as the callsign', () => {
  assert.deepEqual(parseCallsign('SWA1234 '), { callsign: 'SWA1234', airline: 'Southwest Airlines', code: 'SWA', number: '1234' });
  assert.equal(parseCallsign('XYZ12').airline, null);
  assert.equal(parseCallsign('XYZ12').callsign, 'XYZ12');
  assert.equal(parseCallsign('N500GE').tail, true);
  assert.equal(parseCallsign('').callsign, '');
});

test('aircraft types read in plain words, with the code as the last resort', () => {
  assert.equal(aircraftTypeWords('B738'), 'Boeing 737-800');
  assert.equal(aircraftTypeWords('zzzz', 'PIPER PA-46 MALIBU'), 'Piper Pa-46 Malibu');
  assert.equal(aircraftTypeWords('ZZZZ'), 'ZZZZ');
});

test('units: knots and km/s to mph, climbing and descending', () => {
  assert.equal(mphFromKnots(450), 518);
  assert.equal(mphFromKnots(null), null);
  assert.equal(mphFromKms(7.66), 17100);
  assert.equal(verticalWords(1500), 'Climbing');
  assert.equal(verticalWords(-800), 'Descending');
  assert.equal(verticalWords(0), 'Flying level');
  assert.equal(verticalWords(null), '');
});

test('the plane card says who, what, where from and to, and links to the adsb.lol map', () => {
  const plane = { callsign: 'DAL2009', reg: 'N360DN', type: 'A321', hex: 'a40ca4', speedKt: 197, track: 40, verticalFpm: -384 };
  const route = { known: true, from: { code: 'ATL', city: 'Atlanta' }, to: { code: 'SAT', city: 'San Antonio' } };
  const d = planeDetails(plane, route);
  assert.equal(d.title, 'Delta Air Lines flight 2009');
  assert.equal(line(d, 'Route'), 'Atlanta (ATL) → San Antonio (SAT)');
  assert.equal(line(d, 'Plane'), 'Airbus A321');
  assert.equal(line(d, 'Registration'), 'N360DN');
  assert.equal(line(d, 'Speed'), '227 mph');
  assert.equal(line(d, 'Heading'), 'Flying toward the northeast');
  assert.equal(line(d, 'Going'), 'Descending');
  assert.equal(d.mapUrl, 'https://globe.adsb.lol/?icao=a40ca4');
  assert.equal(line(planeDetails(plane, { known: false, reason: 'implausible' }), 'Route'), 'Route not known');
  assert.equal(line(planeDetails(plane, null), 'Route'), 'Looking up the route…');
  const anon = planeDetails({ callsign: '', reg: '', hex: 'zzz' }, { known: false });
  assert.equal(anon.title, 'Not identified');
  assert.ok(anon.reason);
  assert.equal(anon.mapUrl, null);
  assert.equal(adsbMapUrl('../x'), null);
});

test('the satellite card: number, kind, owner, launch, height, speed, sunlight, can I see it', () => {
  const iss = { id: '25544', name: 'ISS (ZARYA)', kind: 'station', heightKm: 420, speedKms: 7.66, sunlit: true, visible: true, mag: -2, heading: 90 };
  const info = { found: true, loaded: true, type: 'PAY', status: '+', owner: 'ISS', launchDate: '1998-11-20', launchSite: 'TYMSC' };
  const d = objectDetails(iss, info, { darkness: 'dusk' });
  assert.equal(d.title, 'ISS (ZARYA)');
  assert.equal(line(d, 'Catalog number'), 'NORAD 25544');
  assert.match(line(d, 'What it is'), /Space station/);
  assert.equal(line(d, 'Launched'), 'November 20, 1998, from Baikonur, Kazakhstan');
  assert.equal(line(d, 'Height'), 'About 261 mi up');
  assert.equal(line(d, 'Speed'), 'About 17,100 mph');
  assert.equal(line(d, 'Sunlight'), 'In sunlight');
  assert.equal(line(d, 'Can I see it now?'), 'Yes, about as bright as a very bright star');
  assert.equal(line(d, 'Moving'), 'Toward the east');
  assert.equal(d.moreUrl, 'https://www.n2yo.com/satellite/?s=25544');
  const working = objectDetails({ id: '43013', name: 'NOAA 20', kind: 'payload', sunlit: false }, { found: true, loaded: true, type: 'PAY', status: '+', owner: 'US' });
  assert.equal(line(working, 'What it is'), 'Working satellite');
  assert.equal(line(working, 'Owner'), 'United States');
  assert.equal(line(working, 'Can I see it now?'), 'No, it is in Earth’s shadow');
  assert.equal(line(objectDetails({ id: '1', name: 'STARLINK-1', kind: 'starlink' }), 'What it is'), 'Starlink internet satellite (SpaceX)');
  const secret = objectDetails({ id: 'c37162', name: 'USA 224', kind: 'classified' });
  assert.equal(line(secret, 'What it is'), 'Classified satellite, tracked by amateur observers');
  assert.equal(line(secret, 'Catalog number'), 'NORAD 37162');
  assert.equal(n2yoUrl('c37162'), 'https://www.n2yo.com/satellite/?s=37162');
});

test('anything we cannot identify says "Not identified" with a reason, never blank', () => {
  const analyst = objectDetails({ id: '81234', name: '', kind: 'analyst' });
  assert.equal(analyst.title, 'Not identified');
  assert.match(line(analyst, 'Why'), /analyst object/);
  assert.equal(analyst.moreUrl, null);
  assert.match(unidentifiedReason({ kind: 'unknown', name: 'OBJECT A' }), /unknown/);
  assert.match(unidentifiedReason({ kind: 'payload', name: 'NEWSAT', noCatalog: true }), /not in the public satellite catalog/);
  assert.match(unidentifiedReason({ kind: 'payload', name: 'X' }, { loaded: true, found: false }), /not in the public/);
  assert.equal(unidentifiedReason({ kind: 'payload', name: 'X' }, { loaded: true, found: true, type: 'PAY' }), '');
  assert.equal(line(objectDetails({ id: '9', name: 'OBJECT B', kind: 'unknown' }), 'What it is'), 'Not identified');
});

test('every sky thing falls in one filter, and counts add up', () => {
  assert.equal(filterOf({ kind: 'aircraft' }), 'planes');
  assert.equal(filterOf({ kind: 'payload' }), 'satellites');
  assert.equal(filterOf({ kind: 'station' }), 'satellites');
  assert.equal(filterOf({ kind: 'analyst' }), 'unidentified');
  assert.equal(filterOf({ kind: 'payload', noCatalog: true }), 'unidentified');
  assert.equal(filterOf({ kind: 'moon' }), 'planets');
  const counts = filterCounts({
    objects: [{ kind: 'debris' }, { kind: 'debris' }, { kind: 'starlink' }],
    aircraft: [{}],
    planets: [{ el: 10 }, { el: -5 }],
    moon: { el: 20 },
    stars: [{ el: 5 }],
  });
  assert.equal(counts.debris, 2);
  assert.equal(counts.starlink, 1);
  assert.equal(counts.planes, 1);
  assert.equal(counts.planets, 2);
  assert.equal(counts.stars, 1);
});

test('placeholder names read "Not identified" with the catalog number under it', () => {
  for (const name of ['UNKNOWN', 'unknown object', 'TBA - TO BE ASSIGNED', 'TBA', 'TBD', 'OBJECT A', 'OBJECT ZZ', 'Object 81001', '', '  '])
    assert.equal(isPlaceholderName(name), true, JSON.stringify(name));
  for (const name of ['ISS (ZARYA)', 'STARLINK-1007', 'OBJECTIVE-1', 'SL-3 R/B', 'COSMOS 2251 DEB'])
    assert.equal(isPlaceholderName(name), false, name);
  const card = objectDetails({ id: '58100', name: 'UNKNOWN', kind: 'payload', heightKm: 500 }, null);
  assert.equal(card.title, 'Not identified');
  assert.equal(card.subtitle, 'NORAD 58100');
  assert.equal(card.unidentified, true);
  assert.deepEqual(displayName({ id: 'c37162', name: 'TBA' }), { title: 'Not identified', number: 'NORAD 37162', placeholder: true });
  // A real name stays, with no extra line.
  const iss = objectDetails({ id: '25544', name: 'ISS (ZARYA)', kind: 'station' }, null);
  assert.equal(iss.title, 'ISS (ZARYA)');
  assert.equal(iss.subtitle, '');
  // And the map's "Not identified" chip covers them.
  assert.equal(filterOf({ id: '58100', name: 'OBJECT A', kind: 'payload' }), 'unidentified');
});
