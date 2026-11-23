<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue';
import UiButton from '../../../kit/UiButton.vue';
import UiCloseButton from '../../../kit/UiCloseButton.vue';
import UiSegmented from '../../../kit/UiSegmented.vue';
import UiSlider from '../../../kit/UiSlider.js';
import UiCheckbox from '../../../kit/UiCheckbox.vue';
import UiSearchField from '../../../kit/UiSearchField.vue';
import SkyChart from './SkyChart.vue';
import { COMPASS_POINTS, bearingOf, compassPoint, heightBand } from '../../../../overhead/compass.js';
import { KIND_LABELS } from '../../../../overhead/satellites.js';
import { TEXT_SIZE_PX } from '../../../../overhead/settings.js';
import { localPosition } from '../../../../overhead/sky.js';
import { wording, directionWord, clock, dayClock, miles } from '../../../../overhead/words.js';
import { createVoiceInput } from '../../../../overhead/voice.js';
import { FILTERS, filterCounts, filterOf, objectDetails, planeDetails } from '../../../../overhead/details.js';

// The Over My House panel. Everything shown is plain English (see
// src/overhead/words.js). The owner (src/overhead/controller.js) holds the
// state; this view renders it and forwards taps.
const props = defineProps({
  view: { type: Object, required: true },
  controls: { type: Object, required: true },
  /** True on the light page, where there is no globe to go back to. */
  standalone: { type: Boolean, default: false },
});

const w = wording;
const v = computed(() => props.view);
const settings = computed(() => v.value.settings);
const sky = computed(() => v.value.sky);
const observer = computed(() => v.value.observer);
const rootStyle = computed(() => ({
  '--omh-size': `${TEXT_SIZE_PX[settings.value.textSize] ?? 18}px`,
}));
const options = (pairs) => pairs.map(([value, text]) => ({ value, label: text }));

const sizeOptions = options([
  ['small', 'Small'],
  ['normal', 'Normal'],
  ['large', 'Large'],
  ['xl', 'Extra large'],
]);
const textSize = computed({
  get: () => settings.value.textSize,
  set: (value) => props.controls.setTextSize(value),
});
const sizerOn = computed({
  get: () => settings.value.sizerOn,
  set: (value) => props.controls.setSizerOn(value),
});
const lookFrom = computed({
  get: () => settings.value.observer,
  set: (value) => props.controls.setObserver(value),
});
const lookFromOptions = options([
  ['home', 'My home'],
  ['here', 'Where I am now'],
]);

const darkWords = {
  day: 'It is daytime. Satellites are hard to see until after sunset.',
  twilight: 'The Sun just set (or is about to rise). The sky is not dark yet.',
  dusk: 'Good time to look: the sky is dark and satellites are still in sunlight.',
  night: 'It is night. Some satellites are in Earth\u2019s shadow now, but many still shine.',
};

function where(az, el) {
  const band = heightBand(el);
  const height = band === 'high' ? 'high' : band === 'medium' ? 'medium high' : 'low';
  return w('{height} in the {dir}', { height, dir: directionWord(compassPoint(az)) });
}
function brightness(mag) {
  if (!Number.isFinite(mag)) return '';
  if (mag <= 0) return 'very bright';
  if (mag <= 1.5) return 'bright';
  if (mag <= 3) return 'medium bright';
  if (mag <= 4.5) return 'faint';
  return 'very faint';
}
const kindWord = (kind) =>
  kind === 'aircraft' ? 'Plane' : kind === 'planet' ? 'Planet' : kind === 'star' ? 'Star' : kind === 'moon' ? 'Moon' : kind === 'launch' ? 'Rocket launch' : KIND_LABELS[kind] ?? 'Satellite';

// ---- Show / hide filters (kept in this browser) ----
const filters = computed(() => settings.value.filters ?? {});
const shown = (thing) => filters.value[filterOf(thing)] !== false;
const allShown = computed(() => FILTERS.every((f) => filters.value[f.id] !== false));
const counts = computed(() => filterCounts(sky.value));
function toggleFilter(id) {
  props.controls.setFilter(id, filters.value[id] === false);
}
function toggleAll() {
  props.controls.setAllFilters(!allShown.value);
}

const visibleNow = computed(() => (sky.value?.objects ?? []).filter((o) => o.visible && shown(o)));
const showAllVisible = ref(false);
const listedVisible = computed(() => (showAllVisible.value ? visibleNow.value.slice(0, 60) : visibleNow.value.slice(0, 8)));
const planesNow = computed(() => (filters.value.planes === false ? [] : (sky.value?.aircraft ?? [])).slice().sort((a, b) => b.el - a.el).slice(0, 8));
const planetsUp = computed(() => (filters.value.planets === false ? [] : (sky.value?.planets ?? []).filter((p) => p.el > 0)));
const selected = computed(() => {
  const id = v.value.selectedId;
  if (!id) return null;
  return (
    (sky.value?.objects ?? []).find((o) => o.id === id) ||
    (sky.value?.aircraft ?? []).find((o) => o.id === id) ||
    (v.value.identify.result?.candidates ?? []).find((o) => o.id === id) ||
    null
  );
});
const details = computed(() => (v.value.details && v.value.details.id === v.value.selectedId ? v.value.details : null));
const card = computed(() => {
  const thing = selected.value;
  if (!thing) return null;
  if (thing.kind === 'aircraft' && 'callsign' in thing) return { plane: true, ...planeDetails(thing, details.value?.loading ? null : (details.value?.value ?? null)) };
  if (Object.hasOwn(KIND_LABELS, thing.kind) && 'sunlit' in thing) {
    const info = details.value?.loading ? null : (details.value?.value ?? null);
    return { plane: false, ...objectDetails(thing, info, { darkness: sky.value?.sun?.darkness }), loading: Boolean(details.value?.loading) };
  }
  return null;
});
const othersHere = computed(() => {
  const group = v.value.selectedGroup ?? [];
  return group.includes(v.value.selectedId) ? group.length - 1 : 0;
});
const rowName = (o) => (o.kind === 'analyst' || o.kind === 'unknown') && (!o.name || /^Object \d+$/.test(o.name)) ? 'Not identified' : o.name;

// ---- What was that? ----
const ask = reactive({
  minutesAgo: 0,
  direction: null,
  height: 'unsure',
  moving: 'moved',
  brightness: 'unsure',
  blinking: 'unsure',
  useCompass: null,
});
const whatSection = ref(null);
const whenOptions = options([
  ['0', 'Just now'],
  ['5', '5 min ago'],
  ['15', '15 min ago'],
  ['30', '30 min ago'],
  ['60', '1 hour ago'],
]);
const whenPick = computed({
  get: () => (['0', '5', '15', '30', '60'].includes(String(ask.minutesAgo)) ? String(ask.minutesAgo) : undefined),
  set: (value) => (ask.minutesAgo = Number(value)),
});
const heightOptions = options([
  ['low', 'Low'],
  ['medium', 'Halfway up'],
  ['high', 'High'],
  ['unsure', 'Not sure'],
]);
const brightOptions = options([
  ['bright', 'Very bright'],
  ['medium', 'Like a normal star'],
  ['faint', 'Faint'],
  ['unsure', 'Not sure'],
]);
const blinkOptions = options([
  ['yes', 'Blinking'],
  ['no', 'Steady'],
  ['unsure', 'Not sure'],
]);
const lookAz = computed(() => (ask.useCompass ? ask.useCompass.heading : bearingOf(ask.direction)));

function openWhat() {
  if (whatSection.value) whatSection.value.open = true;
  nextTick(() => whatSection.value?.scrollIntoView?.({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }));
}
function reducedMotion() {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
function useCompassReading() {
  const c = v.value.compass;
  if (!c?.active || !Number.isFinite(c.heading)) return;
  ask.useCompass = { heading: c.heading, el: c.el };
  ask.direction = compassPoint(c.heading);
  ask.height = heightBand(c.el ?? 0) ?? 'low';
  props.controls.stopCompass();
}
function findIt() {
  const time = Date.now() - ask.minutesAgo * 60000;
  props.controls.runIdentify({
    time,
    direction: ask.direction ?? undefined,
    lookAz: ask.useCompass?.heading,
    height: ask.height === 'unsure' ? undefined : ask.height,
    moving: ask.moving === 'unsure' ? undefined : ask.moving,
    brightness: ask.brightness === 'unsure' ? undefined : ask.brightness,
    blinking: ask.blinking === 'yes' ? true : ask.blinking === 'no' ? false : undefined,
    windowSec: ask.minutesAgo >= 15 ? 300 : 150,
  });
}
const result = computed(() => v.value.identify.result);
const verdictWords = {
  good: 'This is very likely what you saw.',
  possible: 'This could be what you saw. Check the other choices too.',
  none: 'Nothing in our lists fits well.',
};
function reasonText(reason) {
  const values = { ...reason.values };
  if (values.dir) values.dir = directionWord(values.dir);
  return w(reason.text, values);
}

// ---- Tonight ----
const tonight = computed(() => v.value.tonight);
const showAllPasses = ref(false);
const passes = computed(() => (tonight.value?.passes ?? []).slice(0, showAllPasses.value ? 60 : 10));

// ---- Launches and fireballs ----
const launches = computed(() =>
  (v.value.launches ?? []).map((l) => ({
    ...l,
    where:
      Number.isFinite(l.lat) && Number.isFinite(l.lon)
        ? localPosition(observer.value, l.lat, l.lon, 0)
        : null,
  })),
);
const fireballs = computed(() =>
  (v.value.fireballs ?? [])
    .map((f) => ({ ...f, km: localPosition(observer.value, f.lat, f.lon, 0).groundKm }))
    .slice(0, 6),
);

// ---- Settings ----
const placeText = ref('');
const voice = createVoiceInput();
const listening = ref(false);
async function speakPlace() {
  if (!voice || listening.value) return;
  listening.value = true;
  const words = await voice.listen();
  listening.value = false;
  if (words) {
    placeText.value = words;
    props.controls.searchPlace(words);
  }
}
const homeLabel = computed(() => {
  const o = observer.value;
  if (o.kind === 'here') return 'Where you are now';
  if (o.kind === 'default') return 'San Antonio, TX (until you set your home)';
  return o.label || w('{lat}, {lon}', { lat: o.lat.toFixed(3), lon: o.lon.toFixed(3) });
});
const locateWords = {
  denied: 'Location is blocked. Allow location for this site in your phone settings, or type your address.',
  failed: 'Could not find your location. Try again outside, or type your address.',
  unsupported: 'This browser cannot share location. Type your address instead.',
};
const sources = computed(() => v.value.catalog?.sources ?? []);

watch(
  () => v.value.open,
  (open) => {
    if (!open) props.controls.stopCompass();
  },
);
</script>

<template>
  <!-- English only for now (docs/OVER-MY-HOUSE.md): kept out of the i18n catalogs on purpose. -->
  <section class="omh" lang="en" translate="no" :style="rootStyle" role="dialog" aria-modal="true" aria-labelledby="omh-title">
    <header class="omh-head">
      <div class="omh-title-row">
        <h1 id="omh-title" class="omh-title">Over My House</h1>
        <UiCloseButton v-if="!props.standalone" class="omh-close" glyph="times" label="Close" @click="props.controls.close()" />
        <a v-else class="omh-link omh-globe-link" href="/">Open the globe</a>
      </div>
      <p class="omh-place">{{ w('Looking up from: {place}', { place: homeLabel }) }}</p>
      <div v-if="settings.sizerOn" class="omh-sizer">
        <span class="omh-sizer-label">Text size</span>
        <UiSegmented v-model="textSize" :options="sizeOptions" label="Text size" keyboard="radio" class="omh-seg" />
      </div>
    </header>

    <UiButton variant="primary" class="omh-big" @click="openWhat()">What was that?</UiButton>

    <p v-if="v.loading" class="omh-note">Loading about 20,000 satellites, rocket parts and space junk…</p>
    <p v-if="v.error" class="omh-note omh-warn">Could not load the satellite list. Planes, planets and stars still work. It will try again.</p>

    <details class="omh-sec" open>
      <summary>Right now</summary>
      <details class="omh-tip">
        <summary>How this works</summary>
        <p>The circle is your sky. The middle is straight up. The edge is the horizon. North is at the top, like a map. Green dots are satellites you could see now. Light blue dots are space stations. Pink dots are classified satellites that amateur observers track. Gray dots are up there but too dark or dim to see. Orange arrows are planes. Satellites shine because the Sun lights them while your sky is dark. Tap any dot, even a gray one, to see what it is. Use the buttons above the map to show or hide each kind.</p>
      </details>
      <p class="omh-note">{{ darkWords[sky?.sun?.darkness] ?? 'Working out your sky…' }}</p>
      <p v-if="sky" class="omh-count">
        {{ w('{seen} you could see now · {up} up there in total · {planes}', { seen: sky.counts.seeable, up: sky.counts.above, planes: sky.counts.aircraft === 1 ? '1 plane nearby' : w('{n} planes nearby', { n: sky.counts.aircraft }) }) }}
      </p>
      <div class="omh-filters" role="group" aria-label="Show on the map">
        <UiButton class="omh-chip omh-chip-all" :pressed="allShown" @click="toggleAll()">All</UiButton>
        <UiButton
          v-for="f in FILTERS"
          :key="f.id"
          class="omh-chip"
          :pressed="filters[f.id] !== false"
          @click="toggleFilter(f.id)"
        >{{ f.label }} <span class="omh-chip-n">{{ counts[f.id] }}</span></UiButton>
      </div>
      <UiButton v-if="!allShown" variant="action" class="omh-more" @click="props.controls.setAllFilters(true)">Show all</UiButton>
      <SkyChart
        :filters="filters"
        :sky="sky"
        :matches="result?.candidates ?? []"
        :selected-id="v.selectedId"
        :look-az="lookAz"
        label="Map of your sky. North is up and the middle is straight overhead."
        @select="(id) => props.controls.select(id)"
      />
      <p class="omh-note omh-legend">The middle is straight overhead. The edge is the horizon. Orange arrows are planes. Green dots are satellites you can see now, light blue are space stations, pink are classified satellites, and gray dots are too dim to see. Yellow dots are planets. Pinch or tap + to zoom. Tap any dot to see what it is.</p>
      <div v-if="selected" class="omh-card" aria-live="polite">
        <template v-if="card">
          <strong class="omh-card-title">{{ card.title }}</strong>
          <span>{{ card.plane ? 'Plane' : kindWord(selected.kind) }} · {{ where(selected.az, selected.el) }}</span>
          <span v-if="card.plane && Number.isFinite(selected.altitudeFt)">{{ w('{feet} ft up, {mi} mi away', { feet: selected.altitudeFt, mi: miles(selected.distanceKm) }) }}</span>
          <p v-if="card.unidentified && card.plane" class="omh-note">{{ w('Not identified: {why}', { why: card.reason }) }}</p>
          <dl class="omh-facts">
            <div v-for="[label, value] in card.lines" :key="label" class="omh-fact">
              <dt>{{ label }}</dt>
              <dd>{{ value }}</dd>
            </div>
          </dl>
          <p v-if="card.loading" class="omh-note">Looking it up in the satellite catalog…</p>
          <a v-if="card.mapUrl" class="omh-link" :href="card.mapUrl" target="_blank" rel="noopener">See it on the adsb.lol map</a>
          <a v-if="card.moreUrl" class="omh-link" :href="card.moreUrl" target="_blank" rel="noopener">More about it (N2YO)</a>
        </template>
        <template v-else>
          <strong>{{ selected.name }}</strong>
          <span>{{ kindWord(selected.kind) }} · {{ where(selected.az, selected.el) }}</span>
          <span v-if="Number.isFinite(selected.heightKm)">{{ w('About {mi} mi up', { mi: miles(selected.heightKm) }) }}</span>
        </template>
        <div v-if="othersHere > 0" class="omh-others">
          <span>{{ othersHere === 1 ? '1 other object here' : w('{n} other objects here', { n: othersHere }) }}</span>
          <UiButton variant="action" class="omh-more" @click="props.controls.selectNext()">Show the next one</UiButton>
        </div>
      </div>
      <ul v-if="listedVisible.length" class="omh-list">
        <li v-for="o in listedVisible" :key="o.id">
          <UiButton class="omh-row" @click="props.controls.select(o.id)">
            <strong>{{ rowName(o) }}</strong>
            <span>{{ kindWord(o.kind) }} · {{ where(o.az, o.el) }} · {{ brightness(o.mag) }}<template v-if="Number.isFinite(o.heading)"> · {{ w('moving toward the {dir}', { dir: directionWord(compassPoint(o.heading)) }) }}</template></span>
          </UiButton>
        </li>
      </ul>
      <p v-else-if="sky" class="omh-note">{{ allShown ? 'Nothing bright enough to see is up right now.' : 'Nothing you could see right now in the kinds you picked.' }}</p>
      <UiButton v-if="visibleNow.length > 8" variant="action" class="omh-more" @click="showAllVisible = !showAllVisible">{{ showAllVisible ? 'Show fewer' : w('Show all {n}', { n: visibleNow.length }) }}</UiButton>
      <details v-if="planesNow.length || planetsUp.length" class="omh-sub">
        <summary>Planes and planets up now</summary>
        <ul class="omh-list">
          <li v-for="p in planesNow" :key="p.id" class="omh-plain">
            <strong>{{ w('Plane {name}', { name: planeDetails(p, { known: false }).title }) }}</strong>
            <span>{{ where(p.az, p.el) }} · {{ w('{feet} ft, {mi} mi away', { feet: p.altitudeFt, mi: miles(p.distanceKm) }) }}<template v-if="p.type"> · {{ p.type }}</template></span>
          </li>
          <li v-for="p in planetsUp" :key="p.id" class="omh-plain">
            <strong>{{ p.name }}</strong>
            <span>{{ w('Planet · {where} · {bright}. Planets do not twinkle much and stay put.', { where: where(p.az, p.el), bright: brightness(p.mag) }) }}</span>
          </li>
        </ul>
      </details>
    </details>

    <details ref="whatSection" class="omh-sec">
      <summary>What was that?</summary>
      <details class="omh-tip">
        <summary>How this works</summary>
        <p>Tell us when you saw it, where you looked, and which way it moved. We check every satellite, rocket stage, piece of space junk, secret satellite, plane, planet and bright star that was in that part of your sky, and show the best matches. If nothing fits, we say so.</p>
      </details>
      <h2 class="omh-q">When did you see it?</h2>
      <UiSegmented v-model="whenPick" :options="whenOptions" label="When did you see it?" keyboard="radio" class="omh-seg omh-wrap" />
      <label class="omh-slider-label">
        <span>{{ ask.minutesAgo === 0 ? 'Just now' : w('{n} minutes ago', { n: ask.minutesAgo }) }}</span>
        <UiSlider v-model="ask.minutesAgo" :min="0" :max="120" :step="1" aria-label="Minutes ago" class="omh-slider" />
      </label>

      <h2 class="omh-q">Which way were you looking?</h2>
      <div class="omh-compass" role="group" aria-label="Which way were you looking?">
        <UiButton
          v-for="point in COMPASS_POINTS"
          :key="point.id"
          class="omh-dir"
          :pressed="ask.direction === point.id"
          :label="directionWord(point.id)"
          @click="ask.direction = ask.direction === point.id ? null : point.id; ask.useCompass = null"
        >{{ point.id }}</UiButton>
      </div>
      <div class="omh-phone">
        <UiButton v-if="!v.compass.active" variant="action" class="omh-more" @click="props.controls.startCompass()">Use my phone’s compass</UiButton>
        <template v-else>
          <p class="omh-note">Hold your phone flat like a pointer. Aim the top edge at where you saw it.</p>
          <p class="omh-count">{{ Number.isFinite(v.compass.heading) ? w('Pointing {dir}, {el}° up', { dir: directionWord(compassPoint(v.compass.heading)), el: v.compass.el ?? 0 }) : 'Waiting for the compass…' }}</p>
          <UiButton variant="primary" class="omh-more" :disabled="!Number.isFinite(v.compass.heading)" @click="useCompassReading()">Use this direction</UiButton>
        </template>
        <p v-if="v.compass.error === 'denied'" class="omh-note omh-warn">Compass is blocked. Tap a direction above instead.</p>
        <p v-if="v.compass.error === 'unsupported'" class="omh-note omh-warn">This device has no compass. Tap a direction above instead.</p>
      </div>

      <h2 class="omh-q">How high up?</h2>
      <UiSegmented v-model="ask.height" :options="heightOptions" label="How high up?" keyboard="radio" class="omh-seg omh-wrap" />

      <h2 class="omh-q">Which way did it move?</h2>
      <div class="omh-compass" role="group" aria-label="Which way did it move?">
        <UiButton
          v-for="point in COMPASS_POINTS"
          :key="point.id"
          class="omh-dir"
          :pressed="ask.moving === point.id"
          :label="w('Toward the {dir}', { dir: directionWord(point.id) })"
          @click="ask.moving = ask.moving === point.id ? 'moved' : point.id"
        >{{ point.id }}</UiButton>
      </div>
      <div class="omh-row-buttons">
        <UiButton class="omh-dir omh-wide" :pressed="ask.moving === 'moved'" @click="ask.moving = 'moved'">It moved, not sure which way</UiButton>
        <UiButton class="omh-dir omh-wide" :pressed="ask.moving === 'still'" @click="ask.moving = 'still'">It did not move</UiButton>
      </div>

      <details class="omh-sub">
        <summary>More details (optional)</summary>
        <h2 class="omh-q">How bright?</h2>
        <UiSegmented v-model="ask.brightness" :options="brightOptions" label="How bright?" keyboard="radio" class="omh-seg omh-wrap" />
        <h2 class="omh-q">Was it blinking?</h2>
        <UiSegmented v-model="ask.blinking" :options="blinkOptions" label="Was it blinking?" keyboard="radio" class="omh-seg omh-wrap" />
      </details>

      <UiButton variant="primary" class="omh-big" :disabled="v.identify.busy" @click="findIt()">{{ v.identify.busy ? 'Checking the sky…' : 'Find it' }}</UiButton>
      <p v-if="v.identify.error" class="omh-note omh-warn">Something went wrong. Please try again.</p>
      <div v-if="result" class="omh-results" aria-live="polite">
        <p class="omh-verdict">{{ verdictWords[result.verdict] }}</p>
        <p v-if="result.verdict === 'none' && result.candidates.length" class="omh-note">The closest things we found, but they are unlikely:</p>
        <ol class="omh-list">
          <li v-for="(c, index) in result.candidates" :key="c.id" class="omh-plain">
            <strong>{{ w('{n}. {name}', { n: index + 1, name: c.name }) }}</strong>
            <span>{{ kindWord(c.kind) }} · {{ dayClock(c.time) }}</span>
            <ul class="omh-reasons">
              <li v-for="(r, i) in c.reasons" :key="i">{{ reasonText(r) }}</li>
            </ul>
          </li>
        </ol>
        <ul v-if="result.verdict === 'none'" class="omh-reasons">
          <li>It may be a satellite that is not in public lists.</li>
          <li>It may be a plane, drone or balloon that does not share its position.</li>
          <li>A very quick streak is usually a meteor (a shooting star).</li>
        </ul>
      </div>
    </details>

    <details class="omh-sec">
      <summary>Tonight</summary>
      <details class="omh-tip">
        <summary>How this works</summary>
        <p>These are the brighter things that will cross your sky tonight while it is dark. "Starts" is when it climbs above the trees and roofs (10° up). A Starlink train is a line of new Starlink satellites that look like moving dots in a row.</p>
      </details>
      <p v-if="!tonight" class="omh-note">Working out tonight’s passes…</p>
      <template v-else>
        <p v-if="tonight.window" class="omh-note">{{ w('Dark enough from {start} to {end}.', { start: clock(tonight.window.start), end: clock(tonight.window.end) }) }}</p>
        <ul v-if="tonight.trains.length" class="omh-list">
          <li v-for="tr in tonight.trains" :key="tr.launch + tr.start" class="omh-plain omh-train">
            <strong>{{ w('Starlink train at {time}', { time: clock(tr.start) }) }}</strong>
            <span>{{ w('About {n} satellites in a row, from the {from} toward the {to}.', { n: tr.count, from: directionWord(tr.startDir), to: directionWord(tr.endDir) }) }}</span>
          </li>
        </ul>
        <ul v-if="passes.length" class="omh-list">
          <li v-for="p in passes" :key="p.id + p.start" class="omh-plain">
            <strong>{{ w('{time} · {name}', { time: clock(p.start), name: p.name }) }}</strong>
            <span>{{ w('{kind} · {bright} · from the {from}, highest {el}° in the {mid}, ends in the {to}', { kind: kindWord(p.kind), bright: brightness(p.bestMag), from: directionWord(p.startDir), el: p.maxEl, mid: directionWord(p.maxDir), to: directionWord(p.endDir) }) }}<template v-if="Number.isFinite(p.heightKm)"> · {{ w('about {mi} mi up', { mi: miles(p.heightKm) }) }}</template></span>
          </li>
        </ul>
        <p v-else class="omh-note">No bright passes found for tonight.</p>
        <UiButton v-if="(tonight.passes ?? []).length > 10" variant="action" class="omh-more" @click="showAllPasses = !showAllPasses">{{ showAllPasses ? 'Show fewer' : 'Show all passes' }}</UiButton>
      </template>
    </details>

    <details class="omh-sec">
      <summary>Rocket launches</summary>
      <details class="omh-tip">
        <summary>How this works</summary>
        <p>Launches from now through tomorrow, from Launch Library 2. A launch from a few hundred miles away can sometimes be seen low in the sky, especially around sunset or sunrise, when its exhaust glows in sunlight. Launch times often change.</p>
      </details>
      <ul v-if="launches.length" class="omh-list">
        <li v-for="l in launches" :key="l.id" class="omh-plain">
          <strong>{{ w('{time} · {name}', { time: dayClock(Date.parse(l.net)), name: l.name }) }}</strong>
          <span>{{ l.location || l.pad }}<template v-if="l.where"> · {{ w('{mi} mi to the {dir}', { mi: miles(l.where.groundKm), dir: directionWord(compassPoint(l.where.az)) }) }}</template><template v-if="l.status"> · {{ l.status }}</template></span>
          <a v-if="l.webcast" class="omh-link" :href="l.webcast" target="_blank" rel="noopener">More about this launch</a>
        </li>
      </ul>
      <p v-else class="omh-note">No launches listed for the next day and a half.</p>
    </details>

    <details class="omh-sec">
      <summary>Fireballs</summary>
      <details class="omh-tip">
        <summary>How this works</summary>
        <p>Big, bright meteors that government sensors spotted, from NASA’s fireball list. These reports often come weeks late, and most fireballs happen over oceans, so this list rarely matches a light you just saw.</p>
      </details>
      <ul v-if="fireballs.length" class="omh-list">
        <li v-for="f in fireballs" :key="f.date" class="omh-plain">
          <strong>{{ dayClock(Date.parse(f.date)) }}</strong>
          <span>{{ w('About {mi} mi from you', { mi: miles(f.km) }) }}</span>
        </li>
      </ul>
      <p v-else class="omh-note">No fireballs reported in the last few months.</p>
    </details>

    <details class="omh-sec">
      <summary>Settings</summary>
      <details class="omh-tip">
        <summary>How this works</summary>
        <p>Your home spot stays on this phone or computer only. The app sends only a rounded location (about half a mile) to look up planes near you. When you tap a plane, it sends that plane’s flight number to look up its route.</p>
      </details>
      <h2 class="omh-q">Look up from</h2>
      <UiSegmented v-model="lookFrom" :options="lookFromOptions" label="Look up from" keyboard="radio" class="omh-seg omh-wrap" />
      <h2 class="omh-q">Set my home</h2>
      <UiButton variant="action" class="omh-more" :disabled="v.locating" @click="props.controls.locate({ asHome: true })">{{ v.locating ? 'Finding you…' : 'Use my location as home' }}</UiButton>
      <p v-if="v.locateError" class="omh-note omh-warn">{{ locateWords[v.locateError] }}</p>
      <form class="omh-search" role="search" @submit.prevent="props.controls.searchPlace(placeText)">
        <UiSearchField v-model="placeText" label="Address or place" placeholder="Address, city, or 29.59, -98.37" class="omh-field" clear-label="Clear" />
        <UiButton v-if="voice" class="omh-mic" :pressed="listening" label="Say it out loud" @click="speakPlace()"><img src="/mic.svg" alt="" width="24" height="24" /></UiButton>
        <UiButton variant="primary" type="submit" class="omh-go" :disabled="v.searchBusy">Save</UiButton>
      </form>
      <p v-if="v.searchError" class="omh-note omh-warn">We could not find that place. Try a city name, or type numbers like 29.59, -98.37.</p>
      <h2 class="omh-q">Text size buttons</h2>
      <UiCheckbox v-model="sizerOn" class="omh-check">Show the text size buttons at the top</UiCheckbox>
      <details class="omh-sub">
        <summary>Where the data comes from</summary>
        <ul class="omh-reasons">
          <li>Satellites, rocket stages and space junk: <a class="omh-link" href="https://celestrak.org/" target="_blank" rel="noopener">CelesTrak</a> (US Space Force data).</li>
          <li>Owner, launch date and launch site: <a class="omh-link" href="https://celestrak.org/satcat/search.php" target="_blank" rel="noopener">CelesTrak satellite catalog (SATCAT)</a>.</li>
          <li>Classified satellites: <a class="omh-link" href="https://www.mmccants.org/tles/index.html" target="_blank" rel="noopener">Mike McCants’ amateur tracking</a>.</li>
          <li>Planes and flight routes: <a class="omh-link" href="https://www.adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> (ODbL). Routes come from <a class="omh-link" href="https://github.com/vradarserver/standing-data" target="_blank" rel="noopener">Virtual Radar Server standing data</a> and can be wrong.</li>
          <li>Airline and plane names come from a small list built into this page.</li>
          <li>Launches: <a class="omh-link" href="https://thespacedevs.com/llapi" target="_blank" rel="noopener">Launch Library 2</a>.</li>
          <li>Fireballs: <a class="omh-link" href="https://cneos.jpl.nasa.gov/fireballs/" target="_blank" rel="noopener">NASA/JPL CNEOS</a>.</li>
          <li v-if="v.catalog">{{ w('{n} objects loaded.', { n: v.catalog.total }) }}</li>
          <li v-for="s in sources" :key="s.id">{{ w('{id}: {count} ({state})', { id: s.id, count: s.count, state: s.state }) }}</li>
        </ul>
        <p class="omh-note">The full public list of about 30,000 objects needs a Space-Track account. CelesTrak’s free lists cover active satellites, the brightest rocket stages, recent launches, objects about to fall, and the biggest debris clouds.</p>
      </details>
    </details>
  </section>
</template>

<style scoped>
.omh {
  font-size: var(--omh-size, 18px);
  line-height: 1.45;
  color: #f4f6fb;
  background: #0b1020;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  padding: max(12px, env(safe-area-inset-top)) 14px max(24px, env(safe-area-inset-bottom));
  box-sizing: border-box;
  max-width: 760px;
  margin: 0 auto;
}
.omh * {
  box-sizing: border-box;
}
.omh-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5em;
}
.omh-title {
  font-size: 1.5em;
  margin: 0.2em 0;
}
.omh-place {
  margin: 0 0 0.5em;
  color: #c9d3ea;
}
.omh-sizer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5em;
  margin-bottom: 0.6em;
}
.omh-sizer-label {
  font-weight: 600;
}
.omh :deep(.ui-segmented) {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35em;
}
.omh :deep(.ui-segmented__item),
.omh :deep(.ui-button) {
  min-height: max(48px, 2.7em);
  min-width: max(48px, 2.7em);
  font-size: 1em;
  padding: 0.35em 0.8em;
  border-radius: 12px;
  border: 2px solid #3a4770;
  background: #141c36;
  color: #f4f6fb;
  cursor: pointer;
}
.omh :deep(.ui-segmented__item[aria-checked='true']),
.omh :deep(.ui-button[aria-pressed='true']) {
  background: #ffd166;
  color: #111;
  border-color: #ffd166;
}
.omh :deep(.ui-button--primary) {
  background: #2ec27e;
  border-color: #2ec27e;
  color: #04140b;
  font-weight: 700;
}
.omh :deep(.ui-button:disabled) {
  opacity: 0.6;
  cursor: default;
}
.omh :deep(.ui-button:focus-visible),
.omh :deep(.ui-segmented__item:focus-visible),
.omh summary:focus-visible,
.omh a:focus-visible {
  outline: 3px solid #ffd166;
  outline-offset: 2px;
}
.omh-close {
  font-size: 1.6em;
}
.omh-big {
  width: 100%;
  font-size: 1.15em !important;
  margin: 0.4em 0 0.8em;
}
.omh-sec {
  border: 1px solid #2a3558;
  border-radius: 14px;
  margin: 0.7em 0;
  padding: 0 0.8em 0.6em;
  background: #0f1630;
}
.omh-sec > summary,
.omh-sub > summary,
.omh-tip > summary {
  min-height: max(48px, 2.7em);
  display: flex;
  align-items: center;
  cursor: pointer;
  font-weight: 700;
}
.omh-sec > summary {
  font-size: 1.15em;
}
.omh-tip > summary,
.omh-sub > summary {
  font-weight: 600;
  color: #9fd3ff;
}
.omh-tip p {
  margin: 0 0 0.6em;
  color: #dbe4ff;
}
.omh-q {
  font-size: 1em;
  margin: 0.9em 0 0.4em;
}
.omh-note {
  color: #dbe4ff;
  margin: 0.4em 0;
}
.omh-warn {
  color: #ffcf8a;
}
.omh-count {
  font-weight: 600;
  margin: 0.4em 0;
}
.omh-list {
  list-style: none;
  padding: 0;
  margin: 0.4em 0;
}
.omh-list > li {
  margin: 0.35em 0;
}
.omh-row,
.omh-plain {
  display: flex !important;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  width: 100%;
  gap: 0.15em;
}
.omh-plain {
  padding: 0.5em 0.7em;
  border-radius: 12px;
  background: #141c36;
}
.omh-row span,
.omh-plain span {
  color: #c9d3ea;
}
.omh-card {
  display: flex;
  flex-direction: column;
  gap: 0.15em;
  padding: 0.6em 0.8em;
  margin: 0.5em 0;
  border-radius: 12px;
  border: 2px solid #ffd166;
}
.omh-more {
  margin: 0.4em 0;
}
.omh-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em;
  margin: 0.5em 0;
}
.omh :deep(.omh-chip) {
  border-radius: 999px;
  padding: 0.3em 0.9em;
}
.omh-chip-n {
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}
.omh-card-title {
  font-size: 1.1em;
}
.omh-facts {
  margin: 0.4em 0 0.2em;
  display: grid;
  gap: 0.25em;
}
.omh-fact {
  display: grid;
  grid-template-columns: minmax(7em, 32%) 1fr;
  gap: 0.6em;
}
.omh-fact dt {
  color: #9fd3ff;
  font-weight: 600;
}
.omh-fact dd {
  margin: 0;
}
.omh-others {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6em;
  margin-top: 0.4em;
  padding-top: 0.4em;
  border-top: 1px solid #2a3558;
}
.omh-compass {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.35em;
}
.omh-row-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35em;
  margin-top: 0.35em;
}
.omh-wide {
  flex: 1 1 12em;
}
.omh-slider-label {
  display: flex;
  flex-direction: column;
  gap: 0.3em;
  margin-top: 0.5em;
}
.omh-slider {
  width: 100%;
  min-height: 48px;
}
.omh-verdict {
  font-size: 1.1em;
  font-weight: 700;
  margin: 0.8em 0 0.3em;
}
.omh-reasons {
  margin: 0.3em 0 0.2em 1.1em;
  padding: 0;
}
.omh-reasons li {
  margin: 0.15em 0;
}
.omh-train {
  border: 2px solid #8dff8a;
}
.omh-search {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em;
  align-items: center;
  margin: 0.5em 0;
}
.omh-field {
  flex: 1 1 14em;
  display: flex;
  align-items: center;
  gap: 0.3em;
  min-height: max(48px, 2.7em);
  border: 2px solid #3a4770;
  border-radius: 12px;
  padding: 0 0.6em;
  background: #fff;
  color: #111;
}
.omh-field :deep(input) {
  font-size: 1em;
  border: 0;
  outline: none;
  width: 100%;
  min-height: 2.2em;
  background: transparent;
  color: #111;
}
.omh-mic img {
  filter: invert(1);
}
.omh-check {
  min-height: 48px;
  gap: 0.6em;
}
.omh-check :deep(input) {
  width: 28px;
  height: 28px;
}
.omh-link {
  color: #9fd3ff;
  text-decoration: underline;
  min-height: 48px;
  display: inline-flex;
  align-items: center;
}
.omh-globe-link {
  font-weight: 600;
}
@media (prefers-reduced-motion: reduce) {
  .omh * {
    transition: none !important;
    animation: none !important;
    scroll-behavior: auto !important;
  }
}
</style>
