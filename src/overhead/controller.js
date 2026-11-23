/**
 * Over My House owner: keeps the settings, talks to the worker and the
 * /api/overhead routes, and publishes one plain view object for the Vue view
 * to render. Framework-free (no Vue, no Pinia, no Cesium).
 */
import {
  DEFAULT_HOME,
  cleanHome,
  readSettings,
  writeSettings,
  TEXT_SIZES,
} from './settings.js';

const NOW_EVERY_MS = 4000;
const AIRCRAFT_EVERY_MS = 20000;
const TONIGHT_EVERY_MS = 30 * 60000;

/**
 * @param {{publish: (view: object) => void, createWorker?: () => Worker,
 *   fetchImpl?: typeof fetch, documentRef?: Document, navigatorRef?: Navigator,
 *   storage?: Storage, now?: () => number, openAtStart?: boolean}} options
 */
export function createOverMyHouse({
  publish,
  createWorker = () =>
    new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
  fetchImpl = (...args) => globalThis.fetch(...args),
  documentRef = globalThis.document,
  navigatorRef = globalThis.navigator,
  storage,
  now = () => Date.now(),
  openAtStart = false,
} = {}) {
  const settings = readSettings(storage);
  const state = {
    open: false,
    loading: false,
    error: null,
    settings,
    here: null,
    locating: false,
    locateError: null,
    catalog: null,
    sky: null,
    tonight: null,
    launches: [],
    fireballs: [],
    aircraftAt: null,
    aircraftState: null,
    identify: { busy: false, result: null, error: null },
    selectedId: null,
    searchBusy: false,
    searchError: null,
    compass: { active: false, heading: null, el: null, error: null },
  };
  let compassListener = null;
  let worker = null;
  let nextId = 1;
  const pending = new Map();
  let aircraft = null;
  let timers = [];
  let catalogPromise = null;
  let destroyed = false;

  const emit = () => {
    if (destroyed) return;
    publish?.({
      ...state,
      observer: observer(),
      textSizes: TEXT_SIZES,
    });
  };

  function observer() {
    if (state.settings.observer === 'here' && state.here)
      return { ...state.here, kind: 'here' };
    if (state.settings.home) return { ...state.settings.home, kind: 'home' };
    return { ...DEFAULT_HOME, kind: 'default' };
  }

  function ask(type, args = {}) {
    if (!worker) {
      worker = createWorker();
      worker.onmessage = ({ data }) => {
        const entry = pending.get(data?.id);
        if (!entry) return;
        pending.delete(data.id);
        if (data.ok) entry.resolve(data.result);
        else entry.reject(new Error(data.error));
      };
      worker.onerror = () => {
        for (const entry of pending.values())
          entry.reject(new Error('worker failed'));
        pending.clear();
      };
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, ...args });
    });
  }

  async function getJson(path) {
    const response = await fetchImpl(path, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function loadCatalog() {
    if (!catalogPromise) {
      state.loading = true;
      emit();
      catalogPromise = ask('load', { url: '/api/overhead/catalog' })
        .then((info) => {
          state.catalog = info;
          state.error = null;
        })
        .catch(() => {
          state.error = 'catalog';
          catalogPromise = null;
        })
        .finally(() => {
          state.loading = false;
          emit();
        });
    }
    return catalogPromise;
  }

  async function refreshNow() {
    if (!state.open || !state.catalog || hidden()) return;
    try {
      state.sky = await ask('now', {
        home: observer(),
        ms: now(),
        aircraft,
        aircraftAt: state.aircraftAt,
      });
      emit();
    } catch {
      /* the next tick tries again */
    }
  }

  async function refreshAircraft() {
    if (!state.open || hidden()) return;
    const where = observer();
    try {
      const data = await getJson(
        `/api/overhead/aircraft?lat=${where.lat.toFixed(2)}&lon=${where.lon.toFixed(2)}`,
      );
      aircraft = { ac: data.ac ?? [] };
      state.aircraftAt = data.at ?? now();
      state.aircraftState = data.state ?? null;
    } catch {
      state.aircraftState = 'ERROR';
    }
    emit();
  }

  async function refreshTonight() {
    if (!state.catalog) return;
    try {
      state.tonight = await ask('tonight', { home: observer(), from: now() });
      emit();
    } catch {
      /* keep the last answer */
    }
  }

  async function refreshEvents() {
    const [launches, fireballs] = await Promise.allSettled([
      getJson('/api/overhead/launches'),
      getJson('/api/overhead/fireballs'),
    ]);
    if (launches.status === 'fulfilled')
      state.launches = launches.value.items ?? [];
    if (fireballs.status === 'fulfilled')
      state.fireballs = fireballs.value.items ?? [];
    emit();
  }

  function hidden() {
    return documentRef?.visibilityState === 'hidden';
  }

  function startTimers() {
    stopTimers();
    timers = [
      setInterval(refreshNow, NOW_EVERY_MS),
      setInterval(refreshAircraft, AIRCRAFT_EVERY_MS),
      setInterval(refreshTonight, TONIGHT_EVERY_MS),
    ];
  }

  function stopTimers() {
    for (const timer of timers) clearInterval(timer);
    timers = [];
  }

  async function open() {
    if (state.open) return;
    state.open = true;
    emit();
    if (state.settings.observer === 'here' && !state.here) void locate();
    startTimers();
    void refreshAircraft();
    void refreshEvents();
    await loadCatalog();
    await refreshNow();
    void refreshTonight();
  }

  function close() {
    state.open = false;
    stopTimers();
    emit();
  }

  function save() {
    writeSettings(state.settings, storage);
    emit();
  }

  function observerChanged() {
    aircraft = null;
    state.tonight = null;
    state.identify = { busy: false, result: null, error: null };
    emit();
    void refreshAircraft().then(refreshNow);
    void refreshTonight();
  }

  /** Ask the phone or computer where it is (needs the person's OK). */
  function locate({ asHome = false } = {}) {
    if (!navigatorRef?.geolocation) {
      state.locateError = 'unsupported';
      emit();
      return Promise.resolve(false);
    }
    state.locating = true;
    state.locateError = null;
    emit();
    return new Promise((resolve) => {
      navigatorRef.geolocation.getCurrentPosition(
        (position) => {
          const spot = cleanHome({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            label: '',
            source: 'gps',
          });
          state.locating = false;
          state.here = spot;
          if (asHome) {
            // i18n-ignore
            state.settings.home = { ...spot, label: 'My location' };
            state.settings.observer = 'home';
            save();
          }
          observerChanged();
          resolve(true);
        },
        (error) => {
          state.locating = false;
          state.locateError = error?.code === 1 ? 'denied' : 'failed';
          emit();
          resolve(false);
        },
        { enableHighAccuracy: false, maximumAge: 5 * 60000, timeout: 15000 },
      );
    });
  }

  async function searchPlace(text) {
    const query = String(text || '')
      .trim()
      .slice(0, 200);
    if (!query) return false;
    state.searchBusy = true;
    state.searchError = null;
    emit();
    try {
      // "29.59, -98.37" typed as numbers needs no lookup.
      const typed =
        /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(
          query,
        );
      if (typed) {
        const home = cleanHome({
          lat: typed[1],
          lon: typed[2],
          label: query,
          source: 'typed',
        });
        if (!home) throw new Error('bad numbers');
        setHome(home);
        return true;
      }
      const data = await getJson(`/api/geocode?q=${encodeURIComponent(query)}`);
      const hit = data?.results?.[0];
      const home = cleanHome({
        lat: hit?.geometry?.location?.lat,
        lon: hit?.geometry?.location?.lng,
        label: hit?.formatted_address || query,
        source: 'search',
      });
      if (!home) throw new Error('not found');
      setHome(home);
      return true;
    } catch {
      state.searchError = 'notFound';
      emit();
      return false;
    } finally {
      state.searchBusy = false;
      emit();
    }
  }

  function setHome(home) {
    const clean = cleanHome(home);
    if (!clean) return;
    state.settings.home = clean;
    state.settings.observer = 'home';
    save();
    observerChanged();
  }

  function setObserver(kind) {
    state.settings.observer = kind === 'here' ? 'here' : 'home';
    save();
    if (kind === 'here' && !state.here) void locate();
    else observerChanged();
  }

  function setTextSize(size) {
    if (!TEXT_SIZES.includes(size)) return;
    state.settings.textSize = size;
    save();
  }

  function setSizerOn(on) {
    state.settings.sizerOn = Boolean(on);
    save();
  }

  async function runIdentify(query) {
    state.identify = { busy: true, result: null, error: null };
    emit();
    try {
      await loadCatalog();
      const result = await ask('identify', {
        home: observer(),
        query,
        aircraft,
        aircraftAt: state.aircraftAt,
        launches: state.launches,
      });
      state.identify = { busy: false, result, error: null, query };
    } catch {
      state.identify = { busy: false, result: null, error: 'failed' };
    }
    emit();
  }

  /**
   * Read the phone's compass and tilt while the person points the top of
   * the phone at where they saw the light. iPhone asks for permission first,
   * which must start from a tap.
   */
  async function startCompass() {
    const windowRef = documentRef?.defaultView ?? globalThis;
    const Orientation = windowRef?.DeviceOrientationEvent;
    if (!Orientation) {
      state.compass = {
        active: false,
        heading: null,
        el: null,
        error: 'unsupported',
      };
      emit();
      return false;
    }
    try {
      if (typeof Orientation.requestPermission === 'function') {
        const answer = await Orientation.requestPermission();
        if (answer !== 'granted') throw new Error('denied');
      }
    } catch {
      state.compass = {
        active: false,
        heading: null,
        el: null,
        error: 'denied',
      };
      emit();
      return false;
    }
    stopCompass();
    compassListener = (event) => {
      const heading = Number.isFinite(event.webkitCompassHeading)
        ? event.webkitCompassHeading
        : event.absolute && Number.isFinite(event.alpha)
          ? (360 - event.alpha) % 360
          : null;
      // The top edge of the phone points where the person looked: beta 0 is
      // the phone level (aimed at the horizon), 90 is aimed straight up.
      const beta = Number(event.beta);
      const el = Number.isFinite(beta) ? Math.max(0, Math.min(90, beta)) : null;
      state.compass = {
        active: true,
        heading: heading === null ? null : Math.round(heading),
        el: el === null ? null : Math.round(el),
        error: heading === null ? 'noHeading' : null,
      };
      emit();
    };
    const type =
      'ondeviceorientationabsolute' in windowRef
        ? 'deviceorientationabsolute'
        : 'deviceorientation';
    windowRef.addEventListener(type, compassListener);
    compassListener.type = type;
    compassListener.target = windowRef;
    state.compass = { active: true, heading: null, el: null, error: null };
    emit();
    return true;
  }

  function stopCompass() {
    if (compassListener)
      compassListener.target.removeEventListener(
        compassListener.type,
        compassListener,
      );
    compassListener = null;
    if (state.compass.active) {
      state.compass = { ...state.compass, active: false };
      emit();
    }
  }

  function select(id) {
    state.selectedId = id || null;
    emit();
  }

  const onVisibility = () => {
    if (!hidden()) void refreshNow();
  };
  documentRef?.addEventListener?.('visibilitychange', onVisibility);

  emit();
  if (openAtStart) void open();

  return {
    open,
    close,
    locate,
    searchPlace,
    setHome,
    setObserver,
    setTextSize,
    setSizerOn,
    runIdentify,
    startCompass,
    stopCompass,
    select,
    destroy() {
      destroyed = true;
      stopCompass();
      stopTimers();
      documentRef?.removeEventListener?.('visibilitychange', onVisibility);
      worker?.terminate?.();
      worker = null;
    },
  };
}
