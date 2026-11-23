<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  HIT_RADIUS,
  MAX_ZOOM,
  MIN_ZOOM,
  TAP_SLOP,
  clampView,
  compassLetterAt,
  pointsNear,
  toScreen,
  zoomAbout,
} from '../../../../overhead/skyView.js';
import { filterOf } from '../../../../overhead/details.js';

// A round map of the sky over the house, drawn on a canvas: the centre is
// straight overhead, the edge is the horizon, north is up and east is to the
// right (like a map lying on the ground). Bright dots are things you could
// see now; faint grey dots are up there but dark or too dim; orange arrows
// are planes. Numbered rings mark "What was that?" matches. Tapping near a
// dot selects it (gray ones too) and gets a white ring; when several sit
// under the finger, the brightest and nearest comes first and the rest are
// passed along so the card can step through them. The show/hide filters
// (`filters`) hide whole groups from the drawing and from taps.
//
// Zoom: pinch, the mouse wheel, or the + / − buttons; drag (one finger or
// the mouse) pans once zoomed in. At 1x a one-finger drag is left to the
// page so it still scrolls. Dots and labels keep their size at any zoom.
const props = defineProps({
  sky: { type: Object, default: null },
  matches: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  /** The direction the person said they looked, as a bearing, or null. */
  lookAz: { type: Number, default: null },
  label: { type: String, required: true },
  /** Show/hide groups by filter id (src/overhead/details.js); missing means shown. */
  filters: { type: Object, default: () => ({}) },
});
const shown = (thing) => props.filters?.[filterOf(thing)] !== false;
const emit = defineEmits(['select']);
const canvas = ref(null);
const frame = ref(null);
let resize = null;
let points = [];
let geometry = { cx: 0, cy: 0, r: 0, size: 0 };
const view = ref({ zoom: 1, panX: 0, panY: 0 });
const zoomed = computed(() => view.value.zoom > 1.001);
let pending = 0;
let tween = 0;

function project(az, el, cx, cy, r) {
  const d = (Math.max(0, 90 - el) / 90) * r;
  const a = (az * Math.PI) / 180;
  return toScreen(view.value, cx, cy, cx + d * Math.sin(a), cy - d * Math.cos(a));
}

function schedule() {
  if (pending) return;
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf !== 'function') {
    draw();
    return;
  }
  pending = raf(() => {
    pending = 0;
    draw();
  });
}

function setView(next) {
  view.value = clampView(next, geometry.r || 1);
  schedule();
}

function draw() {
  const el = canvas.value;
  const box = frame.value;
  if (!el || !box) return;
  const size = Math.max(220, Math.min(box.clientWidth, 560));
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  if (el.width !== Math.round(size * dpr)) {
    el.width = Math.round(size * dpr);
    el.height = Math.round(size * dpr);
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
  }
  const ctx = el.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26;
  geometry = { cx, cy, r, size };
  // A resize can shrink the room to pan in.
  const fitted = clampView(view.value, r);
  if (fitted.zoom !== view.value.zoom || fitted.panX !== view.value.panX || fitted.panY !== view.value.panY)
    view.value = fitted;
  const { zoom } = view.value;
  const [ox, oy] = toScreen(view.value, cx, cy, cx, cy);
  const R = r * zoom;
  points = [];
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  // Round mask so zoomed content never spills past the map's corners.
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  const dark = props.sky?.sun?.darkness;
  ctx.fillStyle = dark === 'day' ? '#1d3a5c' : dark === 'twilight' ? '#14213d' : '#05070f';
  ctx.beginPath();
  ctx.arc(ox, oy, R, 0, Math.PI * 2);
  ctx.fill();
  // Height rings at 30° and 60° and the compass cross.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (const h of [30, 60]) {
    ctx.beginPath();
    ctx.arc(ox, oy, ((90 - h) / 90) * R, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(ox - R, oy);
  ctx.lineTo(ox + R, oy);
  ctx.moveTo(ox, oy - R);
  ctx.lineTo(ox, oy + R);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ox, oy, R, 0, Math.PI * 2);
  ctx.stroke();
  // The direction the person looked, as a soft wedge.
  if (Number.isFinite(props.lookAz)) {
    const a = ((props.lookAz - 90) * Math.PI) / 180;
    ctx.fillStyle = 'rgba(255, 214, 102, 0.14)';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.arc(ox, oy, R, a - Math.PI / 6, a + Math.PI / 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawSky(ctx, cx, cy, r);
  ctx.restore();
  // Compass letters last, pinned inside the canvas when zoomed, with a dark
  // outline so they read on top of the sky.
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle = '#fff';
  for (const letter of ['N', 'E', 'S', 'W']) {
    const [x, y] = compassLetterAt(letter, view.value, cx, cy, r, size);
    ctx.strokeText(letter, x, y);
    ctx.fillText(letter, x, y);
  }
}

function drawSky(ctx, cx, cy, r) {
  const sky = props.sky;
  if (!sky) return;
  for (const star of props.filters?.stars === false ? [] : (sky.stars ?? [])) {
    const [x, y] = project(star.az, star.el, cx, cy, r);
    ctx.fillStyle = 'rgba(220,230,255,0.75)';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, 3 - star.mag), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = '13px system-ui, sans-serif';
  const planetsOn = props.filters?.planets !== false;
  for (const planet of planetsOn ? (sky.planets ?? []) : []) {
    if (planet.el < 0) continue;
    const [x, y] = project(planet.az, planet.el, cx, cy, r);
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(planet.name, x, y - 12);
    points.push({ id: `planet-${planet.name}`, x, y, tier: 0, mag: planet.mag });
  }
  if (planetsOn && sky.moon && sky.moon.el > 0) {
    const [x, y] = project(sky.moon.az, sky.moon.el, cx, cy, r);
    ctx.fillStyle = '#f4f1de';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('Moon', x, y - 16);
  }
  // Up there but not lit or too faint: small grey dots. Every one can be
  // tapped (tier 1, so a bright dot on the same spot wins the tap).
  for (const object of sky.objects ?? []) {
    if (object.visible || !shown(object)) continue;
    const [x, y] = project(object.az, object.el, cx, cy, r);
    ctx.fillStyle = 'rgba(170,180,200,0.6)';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    points.push({ id: object.id, x, y, tier: 1, mag: object.mag });
  }
  for (const object of sky.objects ?? []) {
    if (!object.visible || !shown(object)) continue;
    const [x, y] = project(object.az, object.el, cx, cy, r);
    const selected = object.id === props.selectedId;
    ctx.fillStyle = object.kind === 'classified' ? '#ff7bd5' : object.kind === 'station' ? '#7df9ff' : '#8dff8a';
    ctx.beginPath();
    ctx.arc(x, y, selected ? 7 : Math.max(3, 6 - (object.mag ?? 5)), 0, Math.PI * 2);
    ctx.fill();
    if (Number.isFinite(object.heading)) {
      const a = (object.heading * Math.PI) / 180;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 14 * Math.sin(a), y - 14 * Math.cos(a));
      ctx.stroke();
    }
    if (selected) {
      ctx.fillStyle = '#fff';
      ctx.fillText(object.name, x, y - 14);
    }
    points.push({ id: object.id, x, y, tier: 0, mag: object.mag });
  }
  for (const plane of props.filters?.planes === false ? [] : (sky.aircraft ?? [])) {
    const [x, y] = project(plane.az, plane.el, cx, cy, r);
    const a = (((plane.track ?? 0) * Math.PI) / 180);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = '#ffa53b';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    points.push({ id: plane.id, x, y, tier: 0, mag: -1 });
  }
  props.matches.forEach((match, index) => {
    if (!Number.isFinite(match.az) || !Number.isFinite(match.el)) return;
    const [x, y] = project(match.az, Math.max(0, match.el), cx, cy, r);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(String(index + 1), x + 18, y - 12);
    points.push({ id: match.id, x, y, tier: 0, mag: match.mag ?? 0 });
  });
  // The selected thing gets a white ring (with a dark edge for contrast).
  const picked = props.selectedId ? points.find((p) => p.id === props.selectedId) : null;
  const pickedObject = picked ? (sky.objects ?? []).find((o) => o.id === picked.id && !o.visible) : null;
  if (pickedObject) {
    ctx.fillStyle = '#fff';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(pickedObject.name || 'Not identified', picked.x, picked.y - 22);
  }
  if (picked) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.arc(picked.x, picked.y, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}

// ---- Taps, pinch, drag and wheel ----
const pointers = new Map();
let gesture = null;
// The wheel zooms only once the mouse has clicked the map (or with Ctrl, which
// is also what a laptop trackpad pinch sends), so scrolling the page past the
// map never gets caught by it.
let wheelReady = false;
function onPointerLeave(event) {
  if (event.pointerType === 'mouse' && !pointers.size) wheelReady = false;
}

function local(event) {
  const rect = canvas.value?.getBoundingClientRect();
  if (!rect) return null;
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pinchState() {
  const [a, b] = [...pointers.values()];
  return {
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    mx: (a.x + b.x) / 2,
    my: (a.y + b.y) / 2,
  };
}

function onPointerDown(event) {
  const at = local(event);
  if (!at) return;
  stopTween();
  if (event.pointerType === 'mouse') wheelReady = true;
  pointers.set(event.pointerId, at);
  if (pointers.size === 1) {
    gesture = { kind: 'tap', startX: at.x, startY: at.y, lastX: at.x, lastY: at.y, moved: false };
    // Hold on to the pointer only when we will use the drag: a mouse, or a
    // finger once zoomed. At 1x a finger drag belongs to the page scroll.
    if (event.pointerType === 'mouse' || zoomed.value) canvas.value?.setPointerCapture?.(event.pointerId);
  } else if (pointers.size === 2) {
    gesture = { kind: 'pinch', moved: true, ...pinchState() };
  } else if (gesture) {
    gesture.moved = true;
  }
}

function onPointerMove(event) {
  if (!pointers.has(event.pointerId) || !gesture) return;
  const at = local(event);
  if (!at) return;
  pointers.set(event.pointerId, at);
  const { cx, cy, r } = geometry;
  if (gesture.kind === 'pinch' && pointers.size >= 2) {
    const next = pinchState();
    // Zoom about where the fingers were, then follow their midpoint.
    let v = zoomAbout(view.value, view.value.zoom * (next.dist / gesture.dist), gesture.mx, gesture.my, cx, cy, r);
    v = clampView({ ...v, panX: v.panX + next.mx - gesture.mx, panY: v.panY + next.my - gesture.my }, r);
    Object.assign(gesture, next);
    setView(v);
    return;
  }
  if (gesture.kind !== 'tap' && gesture.kind !== 'drag') return;
  if (!gesture.moved && Math.hypot(at.x - gesture.startX, at.y - gesture.startY) > TAP_SLOP) {
    gesture.moved = true;
    if (zoomed.value) gesture.kind = 'drag';
  }
  if (gesture.kind === 'drag') {
    setView({ ...view.value, panX: view.value.panX + at.x - gesture.lastX, panY: view.value.panY + at.y - gesture.lastY });
  }
  gesture.lastX = at.x;
  gesture.lastY = at.y;
}

function onPointerUp(event) {
  if (!pointers.has(event.pointerId)) return;
  const at = local(event);
  pointers.delete(event.pointerId);
  const g = gesture;
  if (pointers.size === 0) gesture = null;
  else if (g && g.kind === 'pinch') {
    // One finger left after a pinch: keep it as a drag, never a tap.
    const [rest] = [...pointers.values()];
    gesture = { kind: zoomed.value ? 'drag' : 'done', startX: rest.x, startY: rest.y, lastX: rest.x, lastY: rest.y, moved: true };
  }
  if (!g || g.kind !== 'tap' || g.moved || !at || pointers.size) return;
  if (event.type === 'pointercancel') return;
  const near = pointsNear(points, at.x, at.y, HIT_RADIUS);
  emit('select', near.length ? near.map((p) => p.id) : null);
}

function onWheel(event) {
  const at = local(event);
  if (!at) return;
  const { cx, cy, r } = geometry;
  if (!wheelReady && !event.ctrlKey) return;
  // Scrolling down at 1x is left to the page, so the map never traps it.
  if (!zoomed.value && event.deltaY > 0) {
    if (event.ctrlKey) event.preventDefault();
    return;
  }
  event.preventDefault();
  stopTween();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
  const factor = Math.exp((-event.deltaY * unit) / (event.ctrlKey ? 100 : 400));
  setView(zoomAbout(view.value, view.value.zoom * factor, at.x, at.y, cx, cy, r));
}

// Safari and some Android browsers would zoom or scroll the whole page on
// a two-finger touch; stop that only while two or more fingers are down.
function onTouch(event) {
  if (event.touches && event.touches.length > 1) event.preventDefault();
}
function onGesture(event) {
  event.preventDefault();
}

// ---- Buttons ----
function reducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}
function stopTween() {
  if (tween) globalThis.cancelAnimationFrame?.(tween);
  tween = 0;
}
function animateTo(target) {
  stopTween();
  const from = { ...view.value };
  const raf = globalThis.requestAnimationFrame;
  if (reducedMotion() || typeof raf !== 'function') {
    setView(target);
    return;
  }
  const start = globalThis.performance?.now?.() ?? Date.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 180);
    const e = 1 - (1 - t) * (1 - t);
    view.value = clampView(
      {
        zoom: from.zoom + (target.zoom - from.zoom) * e,
        panX: from.panX + (target.panX - from.panX) * e,
        panY: from.panY + (target.panY - from.panY) * e,
      },
      geometry.r || 1,
    );
    draw();
    tween = t < 1 ? raf(step) : 0;
  };
  tween = raf(step);
}
function zoomBy(factor) {
  const { cx, cy, r } = geometry;
  animateTo(zoomAbout(view.value, view.value.zoom * factor, cx, cy, cx, cy, r));
}
function resetView() {
  animateTo({ zoom: 1, panX: 0, panY: 0 });
}

onMounted(() => {
  draw();
  if (typeof ResizeObserver === 'function' && frame.value) {
    resize = new ResizeObserver(() => draw());
    resize.observe(frame.value);
  }
  const el = canvas.value;
  if (el) {
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouch, { passive: false });
    el.addEventListener('touchmove', onTouch, { passive: false });
    el.addEventListener('gesturestart', onGesture);
  }
});
onBeforeUnmount(() => {
  resize?.disconnect();
  stopTween();
  if (pending) globalThis.cancelAnimationFrame?.(pending);
  const el = canvas.value;
  if (el) {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('touchstart', onTouch);
    el.removeEventListener('touchmove', onTouch);
    el.removeEventListener('gesturestart', onGesture);
  }
});
watch(() => [props.sky, props.matches, props.selectedId, props.lookAz], schedule);
watch(() => ({ ...props.filters }), schedule);
</script>

<template>
  <!-- English only for now, like the rest of Over My House (docs/OVER-MY-HOUSE.md). -->
  <div ref="frame" class="omh-chart" lang="en" translate="no">
    <canvas
      ref="canvas"
      role="img"
      :aria-label="props.label"
      :class="{ 'omh-zoomed': zoomed }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
    ></canvas>
    <div class="omh-zoom" role="group" aria-label="Zoom the sky map">
      <button type="button" class="omh-zoom-btn" aria-label="Zoom in" title="Zoom in" :disabled="view.zoom >= MAX_ZOOM - 0.001" @click="zoomBy(1.6)">+</button>
      <button type="button" class="omh-zoom-btn" aria-label="Zoom out" title="Zoom out" :disabled="view.zoom <= MIN_ZOOM + 0.001" @click="zoomBy(1 / 1.6)">−</button>
      <button type="button" class="omh-zoom-btn omh-zoom-reset" aria-label="Reset the map" title="Reset the map" :disabled="!zoomed && !view.panX && !view.panY" @click="resetView()">Reset</button>
    </div>
  </div>
</template>

<style scoped>
.omh-chart {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
}
canvas {
  /* At 1x one finger still scrolls the page (pan-y); two-finger pinches are
     kept for the map by the touch handlers. Zoomed in, the map takes every
     touch so a drag pans it. */
  touch-action: pan-y;
  cursor: pointer;
  max-width: 100%;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
canvas.omh-zoomed {
  touch-action: none;
  cursor: grab;
}
.omh-zoom {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.omh-zoom-btn {
  min-width: 52px;
  min-height: 52px;
  padding: 0 14px;
  border-radius: 12px;
  border: 2px solid rgba(255, 255, 255, 0.7);
  background: #10182b;
  color: #fff;
  font: inherit;
  font-size: 1.5em;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}
.omh-zoom-reset {
  font-size: 1em;
}
.omh-zoom-btn:focus-visible {
  outline: 3px solid #ffd166;
  outline-offset: 2px;
}
.omh-zoom-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
@media (prefers-reduced-motion: no-preference) {
  .omh-zoom-btn {
    transition: background-color 120ms ease;
  }
}
.omh-zoom-btn:not(:disabled):hover {
  background: #1d2a48;
}
</style>
