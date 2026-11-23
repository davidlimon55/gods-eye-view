<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

// A round map of the sky over the house, drawn on a canvas: the centre is
// straight overhead, the edge is the horizon, north is up and east is to the
// right (like a map lying on the ground). Bright dots are things you could
// see now; faint grey dots are up there but dark or too dim; orange arrows
// are planes. Numbered rings mark "What was that?" matches. Tapping a dot
// selects it.
const props = defineProps({
  sky: { type: Object, default: null },
  matches: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  /** The direction the person said they looked, as a bearing, or null. */
  lookAz: { type: Number, default: null },
  label: { type: String, required: true },
});
const emit = defineEmits(['select']);
const canvas = ref(null);
const frame = ref(null);
let resize = null;
let points = [];

function project(az, el, cx, cy, r) {
  const d = (Math.max(0, 90 - el) / 90) * r;
  const a = (az * Math.PI) / 180;
  return [cx + d * Math.sin(a), cy - d * Math.cos(a)];
}

function draw() {
  const el = canvas.value;
  const box = frame.value;
  if (!el || !box) return;
  const size = Math.max(220, Math.min(box.clientWidth, 560));
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  el.width = size * dpr;
  el.height = size * dpr;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  const ctx = el.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26;
  points = [];
  ctx.clearRect(0, 0, size, size);
  const dark = props.sky?.sun?.darkness;
  ctx.fillStyle = dark === 'day' ? '#1d3a5c' : dark === 'twilight' ? '#14213d' : '#05070f';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Height rings at 30° and 60° and the compass cross.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  for (const h of [30, 60]) {
    ctx.beginPath();
    ctx.arc(cx, cy, ((90 - h) / 90) * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // The direction the person looked, as a soft wedge.
  if (Number.isFinite(props.lookAz)) {
    const a = ((props.lookAz - 90) * Math.PI) / 180;
    ctx.fillStyle = 'rgba(255, 214, 102, 0.14)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a - Math.PI / 6, a + Math.PI / 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - r - 13);
  ctx.fillText('S', cx, cy + r + 13);
  ctx.fillText('E', cx + r + 13, cy);
  ctx.fillText('W', cx - r - 13, cy);

  const sky = props.sky;
  if (!sky) return;
  for (const star of sky.stars ?? []) {
    const [x, y] = project(star.az, star.el, cx, cy, r);
    ctx.fillStyle = 'rgba(220,230,255,0.75)';
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, 3 - star.mag), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = '13px system-ui, sans-serif';
  for (const planet of sky.planets ?? []) {
    if (planet.el < 0) continue;
    const [x, y] = project(planet.az, planet.el, cx, cy, r);
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(planet.name, x, y - 12);
    points.push({ id: `planet-${planet.name}`, x, y });
  }
  if (sky.moon && sky.moon.el > 0) {
    const [x, y] = project(sky.moon.az, sky.moon.el, cx, cy, r);
    ctx.fillStyle = '#f4f1de';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('Moon', x, y - 16);
  }
  // Up there but not lit or too faint: small grey dots (capped for speed).
  let faint = 0;
  for (const object of sky.objects ?? []) {
    if (object.visible || faint > 500) continue;
    faint += 1;
    const [x, y] = project(object.az, object.el, cx, cy, r);
    ctx.fillStyle = 'rgba(160,170,190,0.45)';
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  for (const object of sky.objects ?? []) {
    if (!object.visible) continue;
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
    points.push({ id: object.id, x, y });
  }
  for (const plane of sky.aircraft ?? []) {
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
    points.push({ id: plane.id, x, y });
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
    points.push({ id: match.id, x, y });
  });
}

function onPointer(event) {
  const rect = canvas.value?.getBoundingClientRect();
  if (!rect) return;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let best = null;
  for (const point of points) {
    const d = Math.hypot(point.x - x, point.y - y);
    if (d < 26 && (!best || d < best.d)) best = { ...point, d };
  }
  emit('select', best?.id ?? null);
}

onMounted(() => {
  draw();
  if (typeof ResizeObserver === 'function' && frame.value) {
    resize = new ResizeObserver(() => draw());
    resize.observe(frame.value);
  }
});
onBeforeUnmount(() => resize?.disconnect());
watch(() => [props.sky, props.matches, props.selectedId, props.lookAz], draw);
</script>

<template>
  <div ref="frame" class="omh-chart">
    <canvas ref="canvas" role="img" :aria-label="props.label" @click="onPointer"></canvas>
  </div>
</template>

<style scoped>
.omh-chart {
  display: flex;
  justify-content: center;
  width: 100%;
}
canvas {
  touch-action: manipulation;
  cursor: pointer;
  max-width: 100%;
}
</style>
