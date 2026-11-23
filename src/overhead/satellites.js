/**
 * Satellites, rocket bodies and debris for the Over My House view: build
 * SGP4 records from CelesTrak's OMM rows (or classic TLE lines for the
 * hobbyist classified file), and answer "where is it in my sky, is the Sun
 * lighting it, and about how bright is it?".
 *
 * Portable: no DOM, no Cesium. Used by the browser worker, the server alert
 * job and the tests.
 */
import {
  json2satrec,
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  ecfToLookAngles,
  degreesToRadians,
} from 'satellite.js';
import { sunPosition } from './astro.js';

const RAD = 180 / Math.PI;
const EARTH_RADIUS_KM = 6378.137;

/** Plain-word labels for object kinds (English; the UI translates). */
export const KIND_LABELS = Object.freeze({
  station: 'Space station',
  starlink: 'Starlink satellite',
  payload: 'Satellite',
  rocket: 'Old rocket stage',
  debris: 'Space junk (debris)',
  classified: 'Secret satellite (tracked by hobbyists)',
  analyst: 'Unnamed tracked object',
});

/** Column order of the compact rows the server sends (see server/providers/overhead). */
export const OMM_ROW_FIELDS = Object.freeze([
  'NORAD_CAT_ID',
  'OBJECT_NAME',
  'OBJECT_ID',
  'KIND',
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
  // 'b' when the object is on CelesTrak's ~100 brightest list, 'r' when it
  // was launched in the last 30 days (both optional).
  'FLAGS',
]);

/**
 * Sort an object into a kind from its name and the CelesTrak group it came
 * from. Names follow the USSF catalogue: "R/B" marks a rocket body, "DEB"
 * debris.
 * @param {string} name
 * @param {string} [group]
 */
export function classifyObject(name, group = '') {
  const upper = String(name || '').toUpperCase();
  if (group === 'classified') return 'classified';
  // The stations group also lists small satellites thrown out from them.
  if (group === 'stations' && /^(ISS|CSS|TIANGONG|TIANHE)\b/.test(upper))
    return 'station';
  if (/\bR\/B\b|R\/B\(|ROCKET BODY/.test(upper)) return 'rocket';
  if (
    /\bDEB\b|DEBRIS|\bCOOLANT\b|\bFRAGMENT/.test(upper) ||
    /-debris$/.test(group)
  )
    return 'debris';
  if (upper.startsWith('STARLINK')) return 'starlink';
  if (group === 'analyst' || !upper.trim()) return 'analyst';
  return 'payload';
}

/**
 * Rough "standard magnitude" (brightness at 1000 km, half lit) by kind and
 * name. These are deliberately simple; the UI calls the result "about".
 * Named values follow commonly quoted observing figures (Heavens-Above,
 * McCants' quicksat notes).
 */
export function standardMagnitude(
  name,
  kind,
  { brightList = false, recentLaunch = false } = {},
) {
  const upper = String(name || '').toUpperCase();
  if (/^ISS \(ZARYA\)|^ISS$/.test(upper)) return -1.8;
  if (/^CSS \(TIANHE\)|TIANGONG/.test(upper)) return -0.5;
  if (/^HST$|HUBBLE/.test(upper)) return 2.2;
  if (/SL-16 R\/B/.test(upper)) return 2.0;
  if (
    /SL-8 R\/B|SL-3 R\/B|SL-14 R\/B|CZ-4B R\/B|CZ-2C R\/B|H-2A R\/B/.test(upper)
  )
    return 4.0;
  switch (kind) {
    case 'station':
      return 3.0;
    case 'starlink':
      // New trains still low and tumbling are much brighter than the
      // operational shell with its dimming visors.
      return recentLaunch ? 4.0 : 6.0;
    case 'rocket':
      return brightList ? 4.0 : 4.5;
    case 'payload':
      return brightList ? 4.0 : 5.5;
    case 'classified':
      return 5.0;
    case 'debris':
      return 9.0;
    default:
      return 8.0;
  }
}

/**
 * Build one tracked object from a compact OMM row.
 * @returns {?{id: string, name: string, intlDes: string, kind: string, satrec: object, stdMag: number, recent: boolean, mmPerDay: number}}
 */
export function objectFromOmmRow(row) {
  if (!Array.isArray(row) || row.length < OMM_ROW_FIELDS.length - 1)
    return null;
  const omm = Object.fromEntries(OMM_ROW_FIELDS.map((key, i) => [key, row[i]]));
  let satrec;
  try {
    satrec = json2satrec({ ...omm, ELEMENT_SET_NO: 999 });
  } catch {
    return null;
  }
  if (
    !satrec ||
    satrec.error ||
    !Number.isFinite(satrec.no) ||
    !Number.isFinite(satrec.ecco)
  )
    return null;
  const id = String(omm.NORAD_CAT_ID);
  const intlDes = String(omm.OBJECT_ID || '');
  const flags = String(omm.FLAGS || '');
  const epochMs = Date.parse(
    String(omm.EPOCH).endsWith('Z') ? omm.EPOCH : `${omm.EPOCH}Z`,
  );
  const recent = flags.includes('r');
  const kind = String(omm.KIND || classifyObject(omm.OBJECT_NAME));
  return {
    id,
    name: String(omm.OBJECT_NAME || '').trim() || `Object ${id}`,
    intlDes,
    kind,
    satrec,
    epochMs,
    recent,
    bright: flags.includes('b'),
    mmPerDay: Number(omm.MEAN_MOTION),
    stdMag: standardMagnitude(omm.OBJECT_NAME, kind, {
      brightList: flags.includes('b'),
      recentLaunch: recent,
    }),
  };
}

/** Build one object from a classic three-line element set. */
export function objectFromTle(name, line1, line2, kind = 'classified') {
  let satrec;
  try {
    satrec = twoline2satrec(line1, line2);
  } catch {
    return null;
  }
  if (
    !satrec ||
    satrec.error ||
    !Number.isFinite(satrec.no) ||
    !Number.isFinite(satrec.ecco)
  )
    return null;
  const id = String(line1.slice(2, 7)).trim();
  // satrec.jdsatepoch is the element set's epoch as a Julian Date.
  const epochMs = Number.isFinite(satrec.jdsatepoch)
    ? (satrec.jdsatepoch + (satrec.jdsatepochF ?? 0) - 2440587.5) * 86400000
    : NaN;
  const cleanName = String(name || '').trim() || `Object ${id}`;
  return {
    id: `${kind === 'classified' ? 'c' : ''}${id}`,
    name: cleanName,
    intlDes: '',
    kind,
    satrec,
    epochMs,
    recent: false,
    bright: false,
    mmPerDay: satrec.no * (1440 / (2 * Math.PI)),
    stdMag: standardMagnitude(cleanName, kind),
  };
}

/**
 * Whether an element set is still fresh enough to place the object: low
 * orbits drift by whole degrees within weeks, high ones more slowly.
 */
export function elementsFresh(object, nowMs = Date.now()) {
  if (!Number.isFinite(object?.epochMs)) return true;
  const ageDays = Math.abs(nowMs - object.epochMs) / 86400000;
  return object.mmPerDay > 6 ? ageDays <= 30 : ageDays <= 120;
}

/** Observer in the form satellite.js wants (radians, km). */
export function observerGd(latDeg, lonDeg, heightKm = 0.2) {
  return {
    latitude: degreesToRadians(latDeg),
    longitude: degreesToRadians(lonDeg),
    height: heightKm,
  };
}

/**
 * Whether the Sun lights a point in ECI (km). Cylindrical shadow model:
 * behind the Earth (relative to the Sun) and within one Earth radius of the
 * Sun-Earth line means shadow. Good to a few seconds at shadow entry.
 */
export function isSunlit(eci, sunUnit) {
  const dot = eci.x * sunUnit[0] + eci.y * sunUnit[1] + eci.z * sunUnit[2];
  if (dot > 0) return true;
  const px = eci.x - dot * sunUnit[0];
  const py = eci.y - dot * sunUnit[1];
  const pz = eci.z - dot * sunUnit[2];
  return Math.hypot(px, py, pz) > EARTH_RADIUS_KM;
}

/**
 * Estimated visual magnitude from a standard magnitude, the range and the
 * phase angle (Sun-object-observer), with a diffuse-sphere phase law
 * normalised to 1 at 90°.
 */
export function estimateMagnitude(stdMag, rangeKm, phaseRad) {
  const f = Math.max(
    1e-3,
    (Math.PI - phaseRad) * Math.cos(phaseRad) + Math.sin(phaseRad),
  );
  return stdMag - 15 + 2.5 * Math.log10((rangeKm * rangeKm) / f);
}

/**
 * Where an object is in the observer's sky at one time.
 * @param {object} object From objectFromOmmRow / objectFromTle.
 * @param {{gd: object, ecfObserver?: object}} observer gd from observerGd.
 * @param {number} ms Time.
 * @param {{sunUnit?: number[], gmst?: number}} [cache] Per-time values shared across objects.
 * @returns {?{az: number, el: number, rangeKm: number, sunlit: boolean, mag: number, eci: object}}
 */
export function lookAt(object, observer, ms, cache = {}) {
  const date = new Date(ms);
  let pv;
  try {
    pv = propagate(object.satrec, date);
  } catch {
    return null;
  }
  const eci = pv?.position;
  if (!eci || !Number.isFinite(eci.x)) return null;
  const gmst = cache.gmst ?? gstime(date);
  const ecf = eciToEcf(eci, gmst);
  const look = ecfToLookAngles(observer.gd, ecf);
  const el = look.elevation * RAD;
  const az = (((look.azimuth * RAD) % 360) + 360) % 360;
  const rangeKm = look.rangeSat;
  const sunUnit = cache.sunUnit ?? sunPosition(ms).unit;
  const sunlit = isSunlit(eci, sunUnit);
  let mag = Infinity;
  if (sunlit) {
    // Observer position in ECI from the ECF look: obs = sat - range vector.
    const obsEci = observerEci(observer.gd, gmst);
    const toObs = [obsEci.x - eci.x, obsEci.y - eci.y, obsEci.z - eci.z];
    const len = Math.hypot(...toObs) || 1;
    const cosPhase =
      (toObs[0] * sunUnit[0] + toObs[1] * sunUnit[1] + toObs[2] * sunUnit[2]) /
      len;
    const phase = Math.acos(Math.max(-1, Math.min(1, cosPhase)));
    mag = estimateMagnitude(object.stdMag, rangeKm, phase);
  }
  return {
    az,
    el,
    rangeKm,
    sunlit,
    mag,
    eci,
    heightKm: Math.hypot(eci.x, eci.y, eci.z) - EARTH_RADIUS_KM,
  };
}

/** Observer's ECI position (km) for a GMST angle (radians). */
export function observerEci(gd, gmst) {
  const a = 6378.137;
  const f = 1 / 298.26;
  const e2 = 2 * f - f * f;
  const sinLat = Math.sin(gd.latitude);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const r = (N + gd.height) * Math.cos(gd.latitude);
  const theta = gd.longitude + gmst;
  return {
    x: r * Math.cos(theta),
    y: r * Math.sin(theta),
    z: (N * (1 - e2) + gd.height) * sinLat,
  };
}

/**
 * Which way something drifts across the sky, as a compass bearing in degrees
 * (where it is heading over the ground-plane projection of the sky dome).
 * @param {{az: number, el: number}} a Earlier position.
 * @param {{az: number, el: number}} b Later position.
 */
export function skyHeading(a, b) {
  const proj = ({ az, el }) => {
    const r = (90 - el) / 90;
    return [r * Math.sin(az / RAD), r * Math.cos(az / RAD)];
  };
  const [x1, y1] = proj(a);
  const [x2, y2] = proj(b);
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return (((Math.atan2(dx, dy) * RAD) % 360) + 360) % 360;
}

/** Degrees between two sky points. */
export function angularDistance(a, b) {
  const toVec = ({ az, el }) => [
    Math.cos(el / RAD) * Math.sin(az / RAD),
    Math.cos(el / RAD) * Math.cos(az / RAD),
    Math.sin(el / RAD),
  ];
  const u = toVec(a);
  const v = toVec(b);
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) * RAD;
}
