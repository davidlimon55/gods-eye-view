import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moonPosition,
  moonPhase,
  nextDarkWindow,
  planetPosition,
  skyDarkness,
  sunElevation,
  sunPosition,
  equatorialToHorizontal,
} from './astro.js';

// Reference values: JPL Horizons, geocentric astrometric RA/Dec (J2000) and
// apparent magnitude for 2026-11-23 00:00 UT (fetched 2026-11-23).
const AT = Date.UTC(2026, 10, 23, 0, 0);
const HORIZONS = {
  mercury: [219.2959, -12.9605, -0.56],
  venus: [202.3172, -9.1339, -4.89],
  mars: [151.3159, 13.9995, 0.63],
  jupiter: [148.5174, 13.5754, -2.14],
  saturn: [8.233, 0.7045, 0.57],
};
const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tolerance ${tol})`);

test('planets land within a few tenths of a degree of JPL Horizons', () => {
  for (const [planet, [ra, dec, mag]] of Object.entries(HORIZONS)) {
    const p = planetPosition(planet, AT);
    near(p.ra, ra, 0.3, `${planet} RA`);
    near(p.dec, dec, 0.3, `${planet} Dec`);
    near(p.magnitude, mag, 0.5, `${planet} magnitude`);
  }
});

test('the Sun and Moon match Horizons closely enough to name them', () => {
  // The Sun formula gives apparent coordinates of date (0.37° of precession
  // away from J2000 in 2026).
  const sun = sunPosition(AT);
  near(sun.ra, 238.1598, 0.6, 'Sun RA');
  near(sun.dec, -20.2159, 0.3, 'Sun Dec');
  const moon = moonPosition(AT);
  near(moon.ra, 33.9299, 0.8, 'Moon RA');
  near(moon.dec, 18.6921, 0.6, 'Moon Dec');
  assert.ok(moonPhase(AT).illuminated > 0.9, 'nearly full Moon on 2026-11-23');
});

test('San Antonio gets dark around 6 pm CST on 2026-11-23', () => {
  const noonCst = Date.UTC(2026, 10, 23, 18, 0);
  const dark = nextDarkWindow(29.5966, -98.3686, noonCst);
  const startCst = (dark.start - Date.UTC(2026, 10, 23, 0, 0)) / 3600000 - 6;
  const endCst = (dark.end - Date.UTC(2026, 10, 24, 0, 0)) / 3600000 - 6;
  near(startCst, 18.0, 0.25, 'civil dusk (hours CST)');
  near(endCst, 6.66, 0.25, 'civil dawn (hours CST)');
  assert.equal(skyDarkness(sunElevation(29.5966, -98.3686, noonCst)), 'day');
  assert.equal(skyDarkness(-20), 'night');
  assert.equal(skyDarkness(-8), 'dusk');
  assert.equal(skyDarkness(-3), 'twilight');
});

test('Polaris sits due north at the observer latitude', () => {
  const h = equatorialToHorizontal(37.955, 89.264, 29.5966, -98.3686, AT);
  near(h.el, 29.6, 1.0, 'Polaris height');
  assert.ok(h.az < 2 || h.az > 358, `Polaris azimuth ${h.az}`);
});
