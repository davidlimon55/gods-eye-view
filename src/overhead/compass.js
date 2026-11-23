/**
 * Compass words and sky-height bands, in the plain terms the Over My House
 * view uses ("low in the NE", "moving toward the SE").
 */

/** The eight compass points, clockwise from north, with their centre bearing. */
export const COMPASS_POINTS = Object.freeze([
  Object.freeze({ id: 'N', az: 0 }),
  Object.freeze({ id: 'NE', az: 45 }),
  Object.freeze({ id: 'E', az: 90 }),
  Object.freeze({ id: 'SE', az: 135 }),
  Object.freeze({ id: 'S', az: 180 }),
  Object.freeze({ id: 'SW', az: 225 }),
  Object.freeze({ id: 'W', az: 270 }),
  Object.freeze({ id: 'NW', az: 315 }),
]);

/** Height bands above the horizon, in degrees. */
export const HEIGHT_BANDS = Object.freeze({
  low: Object.freeze({ min: 5, max: 30 }),
  medium: Object.freeze({ min: 30, max: 60 }),
  high: Object.freeze({ min: 60, max: 90 }),
});

/** Nearest compass point id for a bearing in degrees. */
export function compassPoint(az) {
  if (!Number.isFinite(az)) return null;
  const index = Math.round((((az % 360) + 360) % 360) / 45) % 8;
  return COMPASS_POINTS[index].id;
}

/** Bearing (degrees) for a compass point id, or null. */
export function bearingOf(id) {
  return COMPASS_POINTS.find((point) => point.id === id)?.az ?? null;
}

/** Height band id ('low' | 'medium' | 'high') for an elevation, or null below 5°. */
export function heightBand(el) {
  if (!Number.isFinite(el) || el < HEIGHT_BANDS.low.min) return null;
  if (el < HEIGHT_BANDS.medium.min) return 'low';
  if (el < HEIGHT_BANDS.high.min) return 'medium';
  return 'high';
}

/** Smallest difference between two bearings, 0-180. */
export function bearingDifference(a, b) {
  const d = Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  return d;
}
