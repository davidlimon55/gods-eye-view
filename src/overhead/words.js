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
