/**
 * Over My House worker: holds the ~20,000-object catalog and does the orbit
 * math off the page's main thread, so the sky view stays smooth on a phone.
 * Messages: {id, type: 'load'|'now'|'tonight'|'identify', ...args}; every
 * answer is {id, ok, result | error}.
 */
import {
  buildCatalog,
  identify,
  passesBetween,
  skyNow,
  starlinkTrains,
} from './sky.js';
import { nextDarkWindow } from './astro.js';

let catalog = null;

async function load({ url }) {
  // Same-origin only: the catalog route is a relative path on this server.
  const target = new URL(url, self.location.href);
  if (target.origin !== self.location.origin)
    throw new Error('catalog must be same-origin');
  const response = await fetch(target.href, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
  const payload = await response.json();
  catalog = buildCatalog(payload);
  return {
    total: catalog.objects.length,
    counts: catalog.counts,
    sources: catalog.sources,
    generatedAt: payload.generatedAt ?? null,
  };
}

function requireCatalog() {
  if (!catalog) throw new Error('catalog not loaded');
  return catalog;
}

function tonight({ home, from }) {
  const window = nextDarkWindow(home.lat, home.lon, from, {
    threshold: -6,
    hours: 30,
  });
  if (!window) return { window: null, passes: [], trains: [] };
  const passes = passesBetween(
    requireCatalog(),
    home,
    Math.max(from, window.start),
    window.end,
  );
  return {
    window,
    passes: passes.filter((p) => p.maxEl >= 20).slice(0, 120),
    trains: starlinkTrains(passes),
  };
}

const HANDLERS = {
  load,
  now: ({ home, ms, aircraft, aircraftAt }) =>
    skyNow(requireCatalog(), home, ms, { aircraft, aircraftAt }),
  tonight,
  identify: ({ home, query, aircraft, aircraftAt, launches }) =>
    identify(requireCatalog(), home, query, { aircraft, aircraftAt, launches }),
};

self.onmessage = async (event) => {
  const { id, type, ...args } = event.data ?? {};
  const handler = HANDLERS[type];
  try {
    if (!handler) throw new Error('unknown request');
    const result = await handler(args);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
