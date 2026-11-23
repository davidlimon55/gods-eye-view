/**
 * Low-precision sky positions for the Over My House view: the Sun, the Moon,
 * the five naked-eye planets and the brightest stars, turned into compass
 * direction and height above the horizon for one observer.
 *
 * Accuracy is a few tenths of a degree, which is plenty to say "the bright
 * light low in the west is Venus". Sources:
 *  - Sun: the Astronomical Almanac's low-precision formulae (about 0.01°).
 *  - Moon: the Almanac's low-precision series (about 0.3°), with a
 *    topocentric parallax correction.
 *  - Planets: Standish, "Keplerian Elements for Approximate Positions of the
 *    Major Planets" (JPL, Table 1, valid 1800-2050), about 0.1-0.5°.
 *  - Magnitudes: simple H + distance + phase terms after Mallama & Hilton
 *    (2018), rounded; good to about half a magnitude.
 *
 * Framework-free and Cesium-free so the browser worker, the server alert job
 * and the unit tests share it.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Wrap an angle in degrees into [0, 360). */
export function wrap360(deg) {
  const out = deg % 360;
  return out < 0 ? out + 360 : out;
}

/** Julian Date (UT) of a JS time in ms. */
export function julianDate(ms) {
  return ms / 86400000 + 2440587.5;
}

/** Greenwich mean sidereal time in degrees (IAU 1982, adequate here). */
export function gmstDegrees(ms) {
  const jd = julianDate(ms);
  const d = jd - 2451545.0;
  const t = d / 36525;
  return wrap360(
    280.46061837 +
      360.98564736629 * d +
      0.000387933 * t * t -
      (t * t * t) / 38710000,
  );
}

/** Mean obliquity of the ecliptic in degrees. */
export function obliquityDegrees(ms) {
  const n = julianDate(ms) - 2451545.0;
  return 23.439 - 0.0000004 * n;
}

/** Ecliptic (lon, lat in degrees) to equatorial RA/Dec in degrees. */
export function eclipticToEquatorial(lonDeg, latDeg, oblDeg) {
  const l = lonDeg * DEG;
  const b = latDeg * DEG;
  const e = oblDeg * DEG;
  const x = Math.cos(b) * Math.cos(l);
  const y = Math.cos(b) * Math.sin(l) * Math.cos(e) - Math.sin(b) * Math.sin(e);
  const z = Math.cos(b) * Math.sin(l) * Math.sin(e) + Math.sin(b) * Math.cos(e);
  return {
    ra: wrap360(Math.atan2(y, x) * RAD),
    dec: Math.asin(Math.max(-1, Math.min(1, z))) * RAD,
  };
}

/**
 * Sun position: RA/Dec (degrees), distance (AU) and its geocentric unit
 * vector in the equatorial frame (x to the equinox, z to the pole), which is
 * close enough to the TEME frame SGP4 works in for a shadow test.
 */
export function sunPosition(ms) {
  const n = julianDate(ms) - 2451545.0;
  const L = wrap360(280.46 + 0.9856474 * n);
  const g = wrap360(357.528 + 0.9856003 * n) * DEG;
  const lambda = L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  const distanceAu =
    1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  const obl = obliquityDegrees(ms);
  const { ra, dec } = eclipticToEquatorial(lambda, 0, obl);
  const unit = [
    Math.cos(dec * DEG) * Math.cos(ra * DEG),
    Math.cos(dec * DEG) * Math.sin(ra * DEG),
    Math.sin(dec * DEG),
  ];
  return { ra, dec, distanceAu, eclipticLon: wrap360(lambda), unit };
}

/** Moon position (geocentric RA/Dec, distance in km, horizontal parallax). */
export function moonPosition(ms) {
  const T = (julianDate(ms) - 2451545.0) / 36525;
  const s = (a, b) => Math.sin((a + b * T) * DEG);
  const c = (a, b) => Math.cos((a + b * T) * DEG);
  const lon =
    218.32 +
    481267.881 * T +
    6.29 * s(135.0, 477198.87) -
    1.27 * s(259.3, -413335.36) +
    0.66 * s(235.7, 890534.22) +
    0.21 * s(269.9, 954397.74) -
    0.19 * s(357.5, 35999.05) -
    0.11 * s(186.5, 966404.03);
  const lat =
    5.13 * s(93.3, 483202.02) +
    0.28 * s(228.2, 960400.89) -
    0.28 * s(318.3, 6003.15) -
    0.17 * s(217.6, -407332.21);
  const parallax =
    0.9508 +
    0.0518 * c(135.0, 477198.87) +
    0.0095 * c(259.3, -413335.36) +
    0.0078 * c(235.7, 890534.22) +
    0.0028 * c(269.9, 954397.74);
  const distanceKm = 6378.14 / Math.sin(parallax * DEG);
  const { ra, dec } = eclipticToEquatorial(
    wrap360(lon),
    lat,
    obliquityDegrees(ms),
  );
  return { ra, dec, distanceKm, parallax, eclipticLon: wrap360(lon) };
}

/** Fraction of the Moon's disc that is lit (0 new, 1 full) and whether it is growing. */
export function moonPhase(ms) {
  const sun = sunPosition(ms);
  const moon = moonPosition(ms);
  const elong = wrap360(moon.eclipticLon - sun.eclipticLon);
  return {
    illuminated: (1 - Math.cos(elong * DEG)) / 2,
    waxing: elong < 180,
  };
}

/*
 * Standish (JPL) Table 1: a (AU), e, I, L, varpi (long. of perihelion),
 * Omega (long. of node) at J2000 and their rates per Julian century.
 */
const PLANET_ELEMENTS = Object.freeze({
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [
      0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689,
      -0.12534081,
    ],
  ],
  venus: [
    [
      0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718,
      76.67984255,
    ],
    [
      0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329,
      -0.27769418,
    ],
  ],
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [
      0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088,
      -0.29257343,
    ],
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [
      -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668,
      0.20469106,
    ],
  ],
  saturn: [
    [
      9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831,
      113.66242448,
    ],
    [
      -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216,
      -0.28867794,
    ],
  ],
});

/** Heliocentric ecliptic J2000 position of a planet in AU. */
export function heliocentric(planet, ms) {
  const T = (julianDate(ms) - 2451545.0) / 36525;
  const [base, rate] = PLANET_ELEMENTS[planet];
  const [a, e, I, L, varpi, Omega] = base.map((v, i) => v + rate[i] * T);
  const omega = varpi - Omega;
  let M = wrap360(L - varpi);
  if (M > 180) M -= 360;
  // Kepler's equation, in degrees as Standish states it.
  const eStar = e * RAD;
  let E = M + eStar * Math.sin(M * DEG);
  for (let i = 0; i < 8; i += 1) {
    const dM = M - (E - eStar * Math.sin(E * DEG));
    const dE = dM / (1 - e * Math.cos(E * DEG));
    E += dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  const xp = a * (Math.cos(E * DEG) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E * DEG);
  const co = Math.cos(omega * DEG);
  const so = Math.sin(omega * DEG);
  const cO = Math.cos(Omega * DEG);
  const sO = Math.sin(Omega * DEG);
  const cI = Math.cos(I * DEG);
  const sI = Math.sin(I * DEG);
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  ];
}

const PLANET_MAGNITUDE = Object.freeze({
  mercury: (r, d, p) =>
    -0.42 +
    5 * Math.log10(r * d) +
    0.038 * p -
    0.000273 * p * p +
    0.000002 * p * p * p,
  venus: (r, d, p) =>
    -4.4 +
    5 * Math.log10(r * d) +
    0.0009 * p +
    0.000239 * p * p -
    0.00000065 * p * p * p,
  mars: (r, d, p) => -1.52 + 5 * Math.log10(r * d) + 0.016 * p,
  jupiter: (r, d, p) => -9.4 + 5 * Math.log10(r * d) + 0.005 * p,
  // Saturn's rings change this by up to a magnitude; this is the ball alone,
  // brightened a little for the rings' typical contribution.
  saturn: (r, d, p) => -9.2 + 5 * Math.log10(r * d) + 0.044 * p,
});

/** Naked-eye planets this view shows, with plain names. */
export const PLANETS = Object.freeze([
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
]);

/** Geocentric RA/Dec (J2000, degrees), distance (AU) and magnitude of a planet. */
export function planetPosition(planet, ms) {
  const p = heliocentric(planet, ms);
  const earth = heliocentric('earth', ms);
  const g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
  const delta = Math.hypot(...g);
  const r = Math.hypot(...p);
  const earthSun = Math.hypot(...earth);
  // Phase angle (Sun-planet-Earth).
  const cosPhase =
    (r * r + delta * delta - earthSun * earthSun) / (2 * r * delta);
  const phase = Math.acos(Math.max(-1, Math.min(1, cosPhase))) * RAD;
  const lon = wrap360(Math.atan2(g[1], g[0]) * RAD);
  const lat = Math.asin(g[2] / delta) * RAD;
  // J2000 obliquity: these are J2000 ecliptic coordinates.
  const { ra, dec } = eclipticToEquatorial(lon, lat, 23.43928);
  return {
    ra,
    dec,
    distanceAu: delta,
    magnitude: PLANET_MAGNITUDE[planet](r, delta, phase),
  };
}

/**
 * Equatorial RA/Dec (degrees) to azimuth (degrees from north, clockwise) and
 * elevation (degrees) for an observer at lat/lon (degrees).
 */
export function equatorialToHorizontal(raDeg, decDeg, latDeg, lonDeg, ms) {
  const lst = gmstDegrees(ms) + lonDeg;
  const H = wrap360(lst - raDeg) * DEG;
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;
  const sinEl =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(
    -Math.sin(H) * Math.cos(dec),
    Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H),
  );
  return { az: wrap360(az * RAD), el: el * RAD };
}

/** Sun elevation in degrees for an observer. */
export function sunElevation(latDeg, lonDeg, ms) {
  const sun = sunPosition(ms);
  return equatorialToHorizontal(sun.ra, sun.dec, latDeg, lonDeg, ms).el;
}

/**
 * How dark the sky is, from the Sun's elevation: 'day' (above -0.8°),
 * 'twilight' (to -6°), 'dusk' (to -12°, satellites show best), 'night'.
 */
export function skyDarkness(sunEl) {
  if (sunEl > -0.833) return 'day';
  if (sunEl > -6) return 'twilight';
  if (sunEl > -12) return 'dusk';
  return 'night';
}

/** Moon az/el for an observer, corrected for parallax (up to ~1°). */
export function moonHorizontal(latDeg, lonDeg, ms) {
  const moon = moonPosition(ms);
  const geo = equatorialToHorizontal(moon.ra, moon.dec, latDeg, lonDeg, ms);
  return {
    az: geo.az,
    el: geo.el - moon.parallax * Math.cos(geo.el * DEG),
  };
}

/**
 * Scan forward from `fromMs` for the next times the Sun crosses `threshold`
 * degrees going down (dark starts) and going up (dark ends). Five-minute steps
 * refined to about a minute; looks at most `hours` ahead.
 */
export function nextDarkWindow(
  latDeg,
  lonDeg,
  fromMs,
  { threshold = -6, hours = 30 } = {},
) {
  const step = 5 * 60000;
  const end = fromMs + hours * 3600000;
  const refine = (a, b, rising) => {
    let lo = a;
    let hi = b;
    for (let i = 0; i < 8; i += 1) {
      const mid = (lo + hi) / 2;
      const below = sunElevation(latDeg, lonDeg, mid) < threshold;
      if (below === rising) lo = mid;
      else hi = mid;
    }
    return Math.round((lo + hi) / 2);
  };
  let prev = sunElevation(latDeg, lonDeg, fromMs) < threshold;
  let start = prev ? fromMs : null;
  for (let t = fromMs + step; t <= end; t += step) {
    const dark = sunElevation(latDeg, lonDeg, t) < threshold;
    if (dark && !prev) start = refine(t - step, t, false);
    if (!dark && prev && start !== null)
      return { start, end: refine(t - step, t, true) };
    prev = dark;
  }
  return start === null ? null : { start, end };
}
