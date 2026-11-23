/**
 * Plain-word details for the thing someone taps on the sky map: who flies a
 * plane, what kind of plane it is, where it is going; what a satellite is,
 * who owns it and when it launched. Small bundled tables only (no network);
 * anything not in a table falls back to the raw code, never to a blank.
 *
 * Portable: no DOM. English only, like the rest of Over My House.
 */
import { compassPoint } from './compass.js';
import { DIRECTION_WORDS, miles } from './words.js';
import { UNIDENTIFIED_KINDS } from './satellites.js';

/** 1 knot = 1.15078 statute miles per hour. */
export const MPH_PER_KNOT = 1.15078;
/** 1 km/s = 2236.94 miles per hour. */
export const MPH_PER_KMS = 2236.936;

/**
 * Airlines and other operators by the three-letter ICAO prefix of their
 * callsign (the "SWA" in SWA1234). Common US and international carriers.
 */
export const AIRLINES = Object.freeze({
  AAL: 'American Airlines',
  AAY: 'Allegiant Air',
  ABX: 'ABX Air (cargo)',
  ACA: 'Air Canada',
  AFR: 'Air France',
  AIC: 'Air India',
  AMX: 'Aeroméxico',
  ANA: 'All Nippon Airways',
  ANZ: 'Air New Zealand',
  ARG: 'Aerolíneas Argentinas',
  ASA: 'Alaska Airlines',
  ASH: 'Mesa Airlines',
  ATN: 'Air Transport International (cargo)',
  AUA: 'Austrian Airlines',
  AVA: 'Avianca',
  AWI: 'Air Wisconsin',
  BAW: 'British Airways',
  CAL: 'China Airlines',
  CCA: 'Air China',
  CES: 'China Eastern Airlines',
  CMP: 'Copa Airlines',
  CPA: 'Cathay Pacific',
  CSN: 'China Southern Airlines',
  DAL: 'Delta Air Lines',
  DLH: 'Lufthansa',
  EDV: 'Endeavor Air (Delta Connection)',
  EIN: 'Aer Lingus',
  EJA: 'NetJets',
  ELY: 'El Al',
  ENY: 'Envoy Air (American Eagle)',
  ETD: 'Etihad Airways',
  ETH: 'Ethiopian Airlines',
  EVA: 'EVA Air',
  EZY: 'easyJet',
  FDX: 'FedEx',
  FFT: 'Frontier Airlines',
  FIN: 'Finnair',
  FLE: 'Flair Airlines',
  GJS: 'GoJet Airlines (United Express)',
  GTI: 'Atlas Air (cargo)',
  HAL: 'Hawaiian Airlines',
  IBE: 'Iberia',
  ICE: 'Icelandair',
  ITY: 'ITA Airways',
  JAL: 'Japan Airlines',
  JBU: 'JetBlue',
  JIA: 'PSA Airlines (American Eagle)',
  JZA: 'Jazz (Air Canada Express)',
  KAL: 'Korean Air',
  KLM: 'KLM Royal Dutch Airlines',
  LAN: 'LATAM Airlines',
  LXJ: 'Flexjet',
  MXY: 'Breeze Airways',
  NKS: 'Spirit Airlines',
  PAC: 'Polar Air Cargo',
  PAL: 'Philippine Airlines',
  PDT: 'Piedmont Airlines (American Eagle)',
  POE: 'Porter Airlines',
  QFA: 'Qantas',
  QTR: 'Qatar Airways',
  QXE: 'Horizon Air',
  RCH: 'US Air Force (Air Mobility Command)',
  ROU: 'Air Canada Rouge',
  RPA: 'Republic Airways',
  RYR: 'Ryanair',
  SAA: 'South African Airways',
  SAS: 'Scandinavian Airlines (SAS)',
  SCX: 'Sun Country Airlines',
  SIA: 'Singapore Airlines',
  SKW: 'SkyWest Airlines',
  SWA: 'Southwest Airlines',
  SWR: 'Swiss International Air Lines',
  TAM: 'LATAM Airlines Brasil',
  TAP: 'TAP Air Portugal',
  THY: 'Turkish Airlines',
  TSC: 'Air Transat',
  UAE: 'Emirates',
  UAL: 'United Airlines',
  UPS: 'UPS Airlines',
  VIR: 'Virgin Atlantic',
  VIV: 'Viva Aerobus',
  VOI: 'Volaris',
  VXP: 'Avelo Airlines',
  WJA: 'WestJet',
});

/** Aircraft by ICAO type designator (the "t" field of an ADS-B record). */
export const AIRCRAFT_TYPES = Object.freeze({
  A139: 'AgustaWestland AW139 helicopter',
  A20N: 'Airbus A320neo',
  A21N: 'Airbus A321neo',
  A318: 'Airbus A318',
  A319: 'Airbus A319',
  A320: 'Airbus A320',
  A321: 'Airbus A321',
  A332: 'Airbus A330-200',
  A333: 'Airbus A330-300',
  A339: 'Airbus A330-900neo',
  A359: 'Airbus A350-900',
  A35K: 'Airbus A350-1000',
  A388: 'Airbus A380',
  AS50: 'Airbus AS350 helicopter',
  AT75: 'ATR 72-500',
  AT76: 'ATR 72-600',
  B06: 'Bell 206 helicopter',
  B350: 'Beechcraft King Air 350',
  B37M: 'Boeing 737 MAX 7',
  B38M: 'Boeing 737 MAX 8',
  B39M: 'Boeing 737 MAX 9',
  B3XM: 'Boeing 737 MAX 10',
  B407: 'Bell 407 helicopter',
  B712: 'Boeing 717',
  B733: 'Boeing 737-300',
  B734: 'Boeing 737-400',
  B735: 'Boeing 737-500',
  B736: 'Boeing 737-600',
  B737: 'Boeing 737-700',
  B738: 'Boeing 737-800',
  B739: 'Boeing 737-900',
  B744: 'Boeing 747-400',
  B748: 'Boeing 747-8',
  B752: 'Boeing 757-200',
  B753: 'Boeing 757-300',
  B762: 'Boeing 767-200',
  B763: 'Boeing 767-300',
  B764: 'Boeing 767-400',
  B772: 'Boeing 777-200',
  B77L: 'Boeing 777-200LR / 777 Freighter',
  B77W: 'Boeing 777-300ER',
  B788: 'Boeing 787-8 Dreamliner',
  B789: 'Boeing 787-9 Dreamliner',
  B78X: 'Boeing 787-10 Dreamliner',
  BCS1: 'Airbus A220-100',
  BCS3: 'Airbus A220-300',
  BE20: 'Beechcraft King Air 200',
  BE36: 'Beechcraft Bonanza',
  BE9L: 'Beechcraft King Air 90',
  C130: 'Lockheed C-130 Hercules',
  C17: 'Boeing C-17 Globemaster III',
  C172: 'Cessna 172 Skyhawk',
  C182: 'Cessna 182 Skylane',
  C208: 'Cessna 208 Caravan',
  C25A: 'Cessna Citation CJ2',
  C25B: 'Cessna Citation CJ3',
  C30J: 'Lockheed C-130J Super Hercules',
  C550: 'Cessna Citation II',
  C560: 'Cessna Citation V',
  C56X: 'Cessna Citation Excel',
  C68A: 'Cessna Citation Latitude',
  C700: 'Cessna Citation Longitude',
  CL30: 'Bombardier Challenger 300',
  CL35: 'Bombardier Challenger 350',
  CL60: 'Bombardier Challenger 600',
  CRJ2: 'Bombardier CRJ200',
  CRJ7: 'Bombardier CRJ700',
  CRJ9: 'Bombardier CRJ900',
  DH8D: 'De Havilland Dash 8-400',
  E170: 'Embraer 170',
  E190: 'Embraer 190',
  E195: 'Embraer 195',
  E290: 'Embraer E190-E2',
  E50P: 'Embraer Phenom 100',
  E55P: 'Embraer Phenom 300',
  E75L: 'Embraer 175',
  E75S: 'Embraer 175',
  EC35: 'Airbus H135 helicopter',
  F16: 'F-16 Fighting Falcon',
  GLEX: 'Bombardier Global Express',
  GLF4: 'Gulfstream IV',
  GLF5: 'Gulfstream V',
  GLF6: 'Gulfstream G650',
  K35R: 'Boeing KC-135 Stratotanker',
  LJ45: 'Learjet 45',
  LJ60: 'Learjet 60',
  MD11: 'McDonnell Douglas MD-11',
  P28A: 'Piper Cherokee',
  PA28: 'Piper Cherokee',
  PC12: 'Pilatus PC-12',
  R44: 'Robinson R44 helicopter',
  SF50: 'Cirrus Vision Jet',
  SR22: 'Cirrus SR22',
  T38: 'Northrop T-38 Talon (jet trainer)',
  TEX2: 'Beechcraft T-6 Texan II (trainer)',
});

/** "Boeing 737-800" for a type code, else the adsb.lol description, else the code. */
export function aircraftTypeWords(code, desc = '') {
  const key = String(code || '')
    .trim()
    .toUpperCase();
  if (AIRCRAFT_TYPES[key]) return AIRCRAFT_TYPES[key];
  const d = String(desc || '').trim();
  if (d)
    return d
      .toLowerCase()
      .replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return key;
}

/**
 * Split a callsign into airline and flight number.
 * "SWA1234" -> {airline: 'Southwest Airlines', code: 'SWA', number: '1234'}.
 * A US registration callsign ("N500GE") is a private plane.
 */
export function parseCallsign(callsign) {
  const cs = String(callsign || '')
    .trim()
    .toUpperCase();
  if (!cs) return { callsign: '', airline: null, code: null, number: null };
  if (/^N[1-9][0-9A-Z]{0,4}$/.test(cs))
    return {
      callsign: cs,
      airline: null,
      code: null,
      number: null,
      tail: true,
    };
  const m = /^([A-Z]{3})(\d{1,4}[A-Z]{0,2})$/.exec(cs);
  if (!m) return { callsign: cs, airline: null, code: null, number: null };
  return {
    callsign: cs,
    airline: AIRLINES[m[1]] ?? null,
    code: m[1],
    number: m[2],
  };
}

/** "Climbing" / "Descending" / "Level" from feet per minute. */
export function verticalWords(fpm) {
  const n = Number(fpm);
  if (fpm === null || fpm === undefined || !Number.isFinite(n)) return '';
  if (n >= 300) return 'Climbing';
  if (n <= -300) return 'Descending';
  return 'Flying level';
}

/** "northeast" for a bearing in degrees, or ''. */
export function headingWords(deg) {
  if (deg === null || deg === undefined || !Number.isFinite(Number(deg)))
    return '';
  return DIRECTION_WORDS[compassPoint(Number(deg))] ?? '';
}

/** Whole miles per hour from knots, or null. */
export function mphFromKnots(kt) {
  const n = Number(kt);
  return kt === null || kt === undefined || !Number.isFinite(n)
    ? null
    : Math.round(n * MPH_PER_KNOT);
}

/** Whole miles per hour from km/s, rounded to the nearest 100, or null. */
export function mphFromKms(kms) {
  const n = Number(kms);
  if (kms === null || kms === undefined || !Number.isFinite(n)) return null;
  return Math.round((n * MPH_PER_KMS) / 100) * 100;
}

/** "San Antonio (SAT)" for a route airport. */
export function airportWords(a) {
  if (!a) return '';
  const place = a.city || a.name || '';
  const code = a.code || a.icao || '';
  if (place && code) return `${place} (${code})`;
  return place || code;
}

/** The plane's link on the adsb.lol map (tar1090: ?icao=<hex> selects it). */
export function adsbMapUrl(hex) {
  const h = String(hex || '')
    .trim()
    .toLowerCase();
  return /^~?[0-9a-f]{6}$/.test(h)
    ? `https://globe.adsb.lol/?icao=${encodeURIComponent(h)}`
    : null;
}

/**
 * Everything the card says about one plane. `route` is the server's
 * /api/overhead/routes answer for it (or null while it loads).
 */
export function planeDetails(plane, route) {
  const cs = parseCallsign(plane?.callsign);
  const typeWords = aircraftTypeWords(plane?.type, plane?.desc);
  let title;
  if (cs.airline && cs.number) title = `${cs.airline} flight ${cs.number}`;
  else if (cs.callsign) title = cs.callsign;
  else if (plane?.reg) title = plane.reg;
  else title = 'Not identified';
  let routeText;
  if (!route) routeText = 'Looking up the route…';
  else if (route.known && route.from && route.to)
    routeText = `${airportWords(route.from)} → ${airportWords(route.to)}`;
  else routeText = 'Route not known';
  const lines = [];
  if (cs.airline) lines.push(['Airline', cs.airline]);
  else if (cs.tail) lines.push(['Airline', 'Private or small plane']);
  if (cs.callsign)
    lines.push([
      'Flight',
      cs.number && cs.code ? `${cs.code} ${cs.number}` : cs.callsign,
    ]);
  lines.push(['Route', routeText]);
  if (typeWords) lines.push(['Plane', typeWords]);
  if (plane?.reg) lines.push(['Registration', plane.reg]);
  const mph = mphFromKnots(plane?.speedKt);
  if (mph !== null) lines.push(['Speed', `${mph} mph`]);
  const dir = headingWords(plane?.track);
  if (dir) lines.push(['Heading', `Flying toward the ${dir}`]);
  const vert = verticalWords(plane?.verticalFpm);
  if (vert) lines.push(['Going', vert]);
  return {
    title,
    unidentified: title === 'Not identified',
    reason:
      title === 'Not identified'
        ? 'This plane is not sending a flight number or registration.'
        : '',
    lines,
    mapUrl: adsbMapUrl(plane?.hex),
  };
}

/** SATCAT owner codes (celestrak.org/satcat/sources.php), common ones. */
export const OWNERS = Object.freeze({
  AB: 'Arab Satellite Communications Organization',
  ABS: 'Asia Broadcast Satellite',
  AC: 'AsiaSat',
  ALG: 'Algeria',
  ARGN: 'Argentina',
  AUS: 'Australia',
  AZER: 'Azerbaijan',
  BEL: 'Belgium',
  BGD: 'Bangladesh',
  BRAZ: 'Brazil',
  CA: 'Canada',
  CHBZ: 'China and Brazil',
  CHLE: 'Chile',
  CIS: 'Russia (former USSR)',
  COL: 'Colombia',
  CZCH: 'Czech Republic',
  DEN: 'Denmark',
  EGYP: 'Egypt',
  ESA: 'European Space Agency',
  ESRO: 'European Space Research Organization',
  EUME: 'EUMETSAT (Europe)',
  EUTE: 'Eutelsat (Europe)',
  FGER: 'France and Germany',
  FIN: 'Finland',
  FR: 'France',
  FRIT: 'France and Italy',
  GER: 'Germany',
  GLOB: 'Globalstar',
  GREC: 'Greece',
  IM: 'Inmarsat',
  IND: 'India',
  INDO: 'Indonesia',
  IRAN: 'Iran',
  IRAQ: 'Iraq',
  IRID: 'Iridium',
  ISRA: 'Israel',
  ISRO: 'India (ISRO)',
  ISS: 'International Space Station partners',
  IT: 'Italy',
  ITSO: 'Intelsat',
  JPN: 'Japan',
  KAZ: 'Kazakhstan',
  LUXE: 'Luxembourg',
  MALA: 'Malaysia',
  MEX: 'Mexico',
  NATO: 'NATO',
  NETH: 'Netherlands',
  NIG: 'Nigeria',
  NKOR: 'North Korea',
  NOR: 'Norway',
  NZ: 'New Zealand',
  O3B: 'O3b Networks (SES)',
  ORB: 'ORBCOMM',
  PAKI: 'Pakistan',
  PERU: 'Peru',
  POL: 'Poland',
  POR: 'Portugal',
  PRC: 'China',
  PRES: 'China and the European Space Agency',
  QAT: 'Qatar',
  ROC: 'Taiwan',
  ROM: 'Romania',
  RP: 'Philippines',
  SAFR: 'South Africa',
  SAUD: 'Saudi Arabia',
  SEAL: 'Sea Launch',
  SES: 'SES',
  SING: 'Singapore',
  SKOR: 'South Korea',
  SPN: 'Spain',
  SWED: 'Sweden',
  SWTZ: 'Switzerland',
  TBD: 'Not decided yet',
  THAI: 'Thailand',
  TURK: 'Türkiye',
  UAE: 'United Arab Emirates',
  UK: 'United Kingdom',
  UKR: 'Ukraine',
  UNK: 'Unknown',
  US: 'United States',
  USBZ: 'United States and Brazil',
  VENZ: 'Venezuela',
  VTNM: 'Vietnam',
});

/** SATCAT launch site codes (celestrak.org/satcat/launchsites.php). */
export const LAUNCH_SITES = Object.freeze({
  AFETR: 'Cape Canaveral, Florida, USA',
  AFWTR: 'Vandenberg, California, USA',
  ALCLC: 'Alcântara, Brazil',
  ANDSP: 'Andøya Spaceport, Norway',
  BOS: 'Bowen Orbital Spaceport, Australia',
  CAS: 'Canaries airspace (air launch)',
  DLS: 'Dombarovskiy, Russia',
  ERAS: 'Eastern Range airspace (air launch), USA',
  FRGUI: 'Kourou, French Guiana',
  HGSTR: 'Hammaguir, Algeria',
  JJSLA: 'Jeju Island sea launch area, South Korea',
  JSC: 'Jiuquan, China',
  KODAK: 'Kodiak, Alaska, USA',
  KSCUT: 'Uchinoura, Japan',
  KWAJ: 'Kwajalein Atoll',
  KYMSC: 'Kapustin Yar, Russia',
  NSC: 'Naro Space Center, South Korea',
  PLMSC: 'Plesetsk, Russia',
  RLLB: 'Rocket Lab, Mahia, New Zealand',
  SCSLA: 'South China Sea launch area, China',
  SEAL: 'Sea Launch platform (at sea)',
  SEMLS: 'Semnan, Iran',
  SMTS: 'Shahrud, Iran',
  SNMLP: 'San Marco platform, Kenya',
  SPKII: 'Space Port Kii, Japan',
  SRILR: 'Sriharikota, India',
  STARB: 'Starbase, Texas, USA',
  SUBL: 'Submarine launch (at sea)',
  SVOBO: 'Svobodnyy, Russia',
  TAISC: 'Taiyuan, China',
  TANSC: 'Tanegashima, Japan',
  TYMSC: 'Baikonur, Kazakhstan',
  UNK: 'Unknown',
  VOSTO: 'Vostochny, Russia',
  WLPIS: 'Wallops Island, Virginia, USA',
  WOMRA: 'Woomera, Australia',
  WRAS: 'Western Range airspace (air launch), USA',
  WSC: 'Wenchang, China',
  XICLF: 'Xichang, China',
  YAVNE: 'Palmachim / Yavne, Israel',
  YSLA: 'Yellow Sea launch area, China',
  YUN: 'Sohae, North Korea',
});

/** N2YO's page for a catalog number (https://www.n2yo.com/satellite/?s=25544). */
export function n2yoUrl(id) {
  const n = String(id ?? '').replace(/^c/, '');
  return /^\d{1,9}$/.test(n) && Number(n) > 0
    ? `https://www.n2yo.com/satellite/?s=${Number(n)}`
    : null;
}

/** The catalog number shown to people (classified ids carry a "c" here). */
export function noradNumber(id) {
  const n = String(id ?? '').replace(/^c/, '');
  return /^\d{1,9}$/.test(n) ? String(Number(n)) : '';
}

/** "November 20, 1998" from an ISO date, or ''. */
export function dateWords(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const month = months[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : '';
}

/**
 * Why an object is "Not identified", in one short line, or '' when it is
 * identified. `info` is the /api/overhead/object answer (or null).
 */
export function unidentifiedReason(object, info) {
  const name = String(object?.name || '').trim();
  if (object?.kind === 'analyst')
    return 'The Space Force tracks it but has not matched it to a launch yet (an "analyst object").';
  if (object?.kind === 'unknown' || info?.type === 'UNK')
    return 'The official catalog lists what it is as unknown.';
  if (!name || /^Object \d+$/.test(name))
    return 'It has no public name in the catalog.';
  if (object?.noCatalog || (info && info.loaded && !info.found))
    return 'It is not in the public satellite catalog yet.';
  return '';
}

/** What a satellite-type object is, in plain words. */
export function objectKindWords(object, info) {
  if (unidentifiedReason(object, info)) return 'Not identified';
  switch (object?.kind) {
    case 'station':
      return 'Space station (people live on board)';
    case 'starlink':
      return 'Starlink internet satellite (SpaceX)';
    case 'classified':
      return 'Classified satellite, tracked by amateur observers';
    case 'rocket':
      return 'Old rocket stage (rocket body)';
    case 'debris':
      return 'Space junk (debris)';
    default: {
      const status = info?.status;
      if (['+', 'P', 'B', 'S', 'X'].includes(status))
        return 'Working satellite';
      if (status === '-') return 'Satellite (no longer working)';
      return 'Satellite';
    }
  }
}

/** "very bright" ... "very faint" for a magnitude. */
export function brightnessWords(mag) {
  if (!Number.isFinite(mag)) return '';
  if (mag <= 0) return 'very bright';
  if (mag <= 1.5) return 'bright';
  if (mag <= 3) return 'medium bright';
  if (mag <= 4.5) return 'faint';
  return 'very faint';
}

/**
 * Everything the card says about one satellite, rocket stage, piece of
 * junk or unknown object. `info` is the server's catalog answer (or null
 * while it loads); `darkness` is the sky's darkness word.
 */
export function objectDetails(object, info, { darkness } = {}) {
  const reason = unidentifiedReason(object, info);
  const rawName = String(object?.name || '').trim();
  const title =
    reason && (!rawName || /^Object \d+$/.test(rawName))
      ? 'Not identified'
      : rawName || 'Not identified';
  const lines = [];
  const number = noradNumber(object?.id);
  if (number) lines.push(['Catalog number', `NORAD ${number}`]);
  lines.push(['What it is', objectKindWords(object, info)]);
  if (reason) lines.push(['Why', reason]);
  if (info?.found) {
    if (info.owner) lines.push(['Owner', OWNERS[info.owner] ?? info.owner]);
    const launched = dateWords(info.launchDate);
    if (launched) {
      const site = info.launchSite
        ? (LAUNCH_SITES[info.launchSite] ?? info.launchSite)
        : '';
      lines.push(['Launched', site ? `${launched}, from ${site}` : launched]);
    }
  }
  if (Number.isFinite(object?.heightKm))
    lines.push(['Height', `About ${miles(object.heightKm)} mi up`]);
  const mph = mphFromKms(object?.speedKms);
  if (mph !== null)
    lines.push(['Speed', `About ${mph.toLocaleString('en-US')} mph`]);
  lines.push([
    'Sunlight',
    object?.sunlit
      ? 'In sunlight'
      : 'In Earth’s shadow (no sunlight on it now)',
  ]);
  let see;
  if (object?.visible)
    see = `Yes, about as bright as a ${brightnessWords(object.mag)} star`;
  else if (!object?.sunlit) see = 'No, it is in Earth’s shadow';
  else if (darkness === 'day' || darkness === 'twilight')
    see = 'No, your sky is too bright right now';
  else if (Number.isFinite(object?.mag))
    see = `No, too faint (${brightnessWords(object.mag)})`;
  else see = 'No, too faint';
  lines.push(['Can I see it now?', see]);
  const dir = headingWords(object?.heading);
  if (dir) lines.push(['Moving', `Toward the ${dir}`]);
  return {
    title,
    unidentified: Boolean(reason),
    reason,
    lines,
    moreUrl: object?.kind === 'analyst' ? null : n2yoUrl(object?.id),
  };
}

/** Map filters: which marks the sky map and the lists show. */
export const FILTERS = Object.freeze([
  // i18n-ignore (Over My House is English only)
  Object.freeze({ id: 'planes', label: 'Planes' }),
  // i18n-ignore (Over My House is English only)
  Object.freeze({ id: 'satellites', label: 'Satellites (working)' }),
  // i18n-ignore (Over My House is English only)
  Object.freeze({ id: 'starlink', label: 'Starlink' }),
  // i18n-ignore (Over My House is English only)
  Object.freeze({ id: 'rocket', label: 'Rocket bodies' }),
  // i18n-ignore (Over My House is English only)
  Object.freeze({ id: 'debris', label: 'Debris' }),
  // i18n-ignore (Over My House is English only)
  Object.freeze({ id: 'classified', label: 'Classified' }),
  // i18n-ignore (Over My House is English only)
  Object.freeze({ id: 'unidentified', label: 'Not identified' }),
  // i18n-ignore (Over My House is English only)
  Object.freeze({ id: 'planets', label: 'Planets and Moon' }),
  // i18n-ignore (Over My House is English only)
  Object.freeze({ id: 'stars', label: 'Stars' }),
]);
export const FILTER_IDS = Object.freeze(FILTERS.map((f) => f.id));

/** Which filter a sky object belongs to. */
export function filterOf(object) {
  switch (object?.kind) {
    case 'aircraft':
      return 'planes';
    case 'starlink':
      return 'starlink';
    case 'rocket':
      return 'rocket';
    case 'debris':
      return 'debris';
    case 'classified':
      return 'classified';
    case 'planet':
    case 'moon':
      return 'planets';
    case 'star':
      return 'stars';
    default:
      if (UNIDENTIFIED_KINDS.includes(object?.kind) || object?.noCatalog)
        return 'unidentified';
      return 'satellites';
  }
}

/** Counts per filter for the chips. */
export function filterCounts(sky) {
  const counts = Object.fromEntries(FILTER_IDS.map((id) => [id, 0]));
  if (!sky) return counts;
  for (const o of sky.objects ?? []) counts[filterOf(o)] += 1;
  counts.planes = (sky.aircraft ?? []).length;
  counts.planets =
    (sky.planets ?? []).filter((p) => p.el > 0).length +
    (sky.moon && sky.moon.el > 0 ? 1 : 0);
  counts.stars = (sky.stars ?? []).filter((s) => s.el > 0).length;
  return counts;
}
