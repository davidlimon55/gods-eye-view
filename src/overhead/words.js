/**
 * Plain-English wording for the Over My House feature. Templates hold
 * {placeholders}; values fill them. The feature is written in simple
 * English (about a 6th-grade reading level) and is not translated, so it
 * never loads the app's translation catalogs and its light page stays small.
 */

/** Fill {placeholders} in an English template. */
export function wording(template, values = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, key) =>
    values[key] === undefined || values[key] === null
      ? ''
      : String(values[key]),
  );
}

/** Kilometres in one statute mile's worth: 1 km = 0.621371 mi. */
export const MILES_PER_KM = 0.621371;

/**
 * A distance in km as a plain miles number for people: one decimal under
 * 10 miles ("6.8", "0.4"), whole miles from 10 up ("340"). The maths stays
 * in km everywhere; only the words shown to people use miles.
 */
export function miles(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return '';
  const mi = Math.abs(n) * MILES_PER_KM;
  if (mi < 10) {
    const one = Math.round(mi * 10) / 10;
    return one >= 10 ? '10' : String(one);
  }
  return String(Math.round(mi));
}

/** "1 mile", "6.8 miles", "340 miles" for a distance in km. */
export function milesWords(km) {
  const n = miles(km);
  if (n === '') return '';
  return n === '1' ? '1 mile' : `${n} miles`;
}

/** Words for compass point ids. */
export const DIRECTION_WORDS = Object.freeze({
  N: 'north',
  NE: 'northeast',
  E: 'east',
  SE: 'southeast',
  S: 'south',
  SW: 'southwest',
  W: 'west',
  NW: 'northwest',
});

/** "northeast (NE)" for a compass id, or the id itself. */
export function directionWord(id) {
  return DIRECTION_WORDS[id] ?? String(id ?? '');
}

/** Short clock time in the viewer's own time zone. */
export function clock(ms, locale) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Short day and clock time in the viewer's own time zone. */
export function dayClock(ms, locale) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString(locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
