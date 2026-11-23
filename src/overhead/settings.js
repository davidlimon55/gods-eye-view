/**
 * Over My House settings, kept in this browser only (localStorage): the home
 * spot, where to look from, and the text size. Nothing here is sent to the
 * server except the coordinates needed to ask for nearby planes.
 */

export const SETTINGS_KEY = 'gev:over-my-house:v1';

/** Used only until a home is set: downtown San Antonio, TX. */
export const DEFAULT_HOME = Object.freeze({
  lat: 29.4241,
  lon: -98.4936,
  // i18n-ignore
  label: 'San Antonio, TX (default)',
  source: 'default',
});

export const TEXT_SIZES = Object.freeze(['small', 'normal', 'large', 'xl']);
/** Root font size (px) per text size; tap targets scale with it (em units). */
export const TEXT_SIZE_PX = Object.freeze({
  small: 16,
  normal: 18,
  large: 21,
  xl: 25,
});

const DEFAULTS = Object.freeze({
  home: null,
  observer: 'home',
  textSize: 'normal',
  sizerOn: true,
});

/** Round a coordinate to 4 decimals (~11 m): plenty for the sky, less exact for privacy. */
export function roundCoordinate(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

/** A clean home object, or null when the numbers are not a real place. */
export function cleanHome(home) {
  const lat = Number(home?.lat);
  const lon = Number(home?.lon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  )
    return null;
  return {
    lat: roundCoordinate(lat),
    lon: roundCoordinate(lon),
    label: String(home?.label || '').slice(0, 120),
    source: ['gps', 'search', 'typed', 'default'].includes(home?.source)
      ? home.source
      : 'typed',
  };
}

/** Read the saved settings; anything broken falls back to defaults. */
export function readSettings(storage = safeStorage()) {
  let saved = {};
  try {
    saved = JSON.parse(storage?.getItem(SETTINGS_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  return {
    home: cleanHome(saved.home),
    observer: saved.observer === 'here' ? 'here' : 'home',
    textSize: TEXT_SIZES.includes(saved.textSize)
      ? saved.textSize
      : DEFAULTS.textSize,
    sizerOn: saved.sizerOn !== false,
  };
}

/** Save settings; returns false when this browser blocks storage. */
export function writeSettings(settings, storage = safeStorage()) {
  try {
    storage?.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        home: cleanHome(settings.home),
        observer: settings.observer === 'here' ? 'here' : 'home',
        textSize: TEXT_SIZES.includes(settings.textSize)
          ? settings.textSize
          : DEFAULTS.textSize,
        sizerOn: settings.sizerOn !== false,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
