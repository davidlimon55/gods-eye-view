/**
 * Zoom, pan and tap maths for the round sky map (SkyChart.vue). Kept apart
 * from the canvas so it can be tested without a browser.
 *
 * The map is drawn in "base" coordinates (the whole sky fits the canvas at
 * 1x, centre cx/cy, horizon radius r). A view is { zoom, panX, panY } in CSS
 * pixels: screen = centre + (base - centre) * zoom + pan. Dots, arrows and
 * labels are drawn at a fixed size on top, so they never grow with zoom.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
/** How far (CSS px) a finger or mouse may move and still count as a tap. */
export const TAP_SLOP = 10;
/** How close (CSS px) a tap must land to a dot to pick it. */
export const HIT_RADIUS = 24;

export function clampZoom(zoom) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Keep the sky on screen: at 1x there is no pan, and when zoomed in the pan
 * stops once the horizon edge reaches where it sits at 1x.
 */
export function clampView(view, r) {
  const zoom = clampZoom(view.zoom);
  const limit = Math.max(0, r * (zoom - 1));
  // `+ 0` turns -0 into 0 so a reset view compares equal.
  const clamp = (v) => Math.min(limit, Math.max(-limit, Number(v) || 0)) + 0;
  return { zoom, panX: clamp(view.panX), panY: clamp(view.panY) };
}

/** Screen point for a base-coordinate point. */
export function toScreen(view, cx, cy, x, y) {
  return [
    cx + (x - cx) * view.zoom + view.panX,
    cy + (y - cy) * view.zoom + view.panY,
  ];
}

/**
 * Zoom to `nextZoom` while the sky point under screen point (sx, sy) stays
 * under it (the pinch midpoint, the mouse, or the map centre for buttons).
 */
export function zoomAbout(view, nextZoom, sx, sy, cx, cy, r) {
  const zoom = clampZoom(nextZoom);
  const k = zoom / view.zoom;
  return clampView(
    {
      zoom,
      panX: sx - cx - (sx - cx - view.panX) * k,
      panY: sy - cy - (sy - cy - view.panY) * k,
    },
    r,
  );
}

/** The point nearest (x, y) within `radius`, or null. */
export function nearestPoint(points, x, y, radius = HIT_RADIUS) {
  let best = null;
  for (const point of points) {
    const d = Math.hypot(point.x - x, point.y - y);
    if (d <= radius && (!best || d < best.d)) best = { ...point, d };
  }
  return best;
}

/**
 * Every point within `radius` of (x, y), best first, for taps on crowded
 * spots. Brighter marks win (`tier` 0: things you can see, planes, planets;
 * 1: dim gray dots), then the nearer one (in 8px steps, so a finger that is
 * a little off still gets the bright dot), then the brighter magnitude.
 * Duplicate ids (a match ring on top of its dot) are listed once.
 */
export function pointsNear(points, x, y, radius = HIT_RADIUS) {
  const seen = new Map();
  for (const point of points) {
    const d = Math.hypot(point.x - x, point.y - y);
    if (d > radius) continue;
    const prev = seen.get(point.id);
    const tier = point.tier ?? 0;
    if (!prev || tier < prev.tier || (tier === prev.tier && d < prev.d))
      seen.set(point.id, { ...point, d, tier });
  }
  return [...seen.values()].sort(
    (a, b) =>
      a.tier - b.tier ||
      Math.floor(a.d / 8) - Math.floor(b.d / 8) ||
      (a.mag ?? 99) - (b.mag ?? 99) ||
      a.d - b.d,
  );
}

/**
 * Where to draw a compass letter: at the horizon point in its direction,
 * pulled inside the canvas (by `margin`) when zoom pushes it off screen.
 * Pulling in along one axis keeps the letter on the correct side, so N is
 * always toward the top, E to the right, S below and W to the left.
 */
export function compassLetterAt(letter, view, cx, cy, r, size, margin = 14) {
  const reach = r * view.zoom + 13;
  const ox = cx + view.panX;
  const oy = cy + view.panY;
  const clamp = (v) => Math.min(size - margin, Math.max(margin, v));
  switch (letter) {
    case 'N':
      return [clamp(ox), clamp(oy - reach)];
    case 'S':
      return [clamp(ox), clamp(oy + reach)];
    case 'E':
      return [clamp(ox + reach), clamp(oy)];
    case 'W':
      return [clamp(ox - reach), clamp(oy)];
    default:
      return [ox, oy];
  }
}
