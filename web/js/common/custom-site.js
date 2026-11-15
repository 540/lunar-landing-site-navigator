// A point of the user's own (issue #101): coordinates typed in Plan's «¿Dónde?», judged as a site of the catalogue.
// Pure (no DOM): Plan, the app's link reader and the 3D viewer build the same site from the same coordinates.
import { t, fmtCoords as coords } from './i18n.js';

/** The site id links carry for a point of the user's own: ?site=custom&lat=…&lon=… */
export const CUSTOM_SITE_ID = 'custom';

const TEXT = {
  name: where => t('common.own.name', { where }),
  short: t('common.own.short'),
  note: t('common.own.note'),
  empty: { lat: t('common.own.emptyLat'), lon: t('common.own.emptyLon') },
  notNumber: { lat: t('common.own.notNumberLat'), lon: t('common.own.notNumberLon') },
  range: { lat: t('common.own.rangeLat'), lon: t('common.own.rangeLon') },
};
const LIMIT = { lat: 90, lon: 180 };

/** «89,45° S, 137,3° O»; in English «89.45° S, 137.3° W»: up to four decimals (shared/format, #343). */
export const fmtCoords = point => coords(point, 4);

// Accepts the decimal comma (as typed in Spanish) or point, and the typographic minus.
function parseOne(raw, field) {
  const text = String(raw ?? '').trim().replace(',', '.').replace(/[−–]/g, '-');
  if (text === '') return { error: TEXT.empty[field] };
  const v = Number(text);
  if (!Number.isFinite(v)) return { error: TEXT.notNumber[field] };
  if (Math.abs(v) > LIMIT[field]) return { error: TEXT.range[field] };
  return { value: v };
}

/**
 * Latitude and longitude as typed → { lat, lon } in degrees, or { errors: { lat?, lon? } } with the message of each field
 * that is wrong (south and west are negative).
 */
export function parseCoords(lat, lon) {
  const a = parseOne(lat, 'lat'), b = parseOne(lon, 'lon');
  if (a.error || b.error) return { errors: { ...(a.error ? { lat: a.error } : {}), ...(b.error ? { lon: b.error } : {}) } };
  return { lat: a.value, lon: b.value };
}

// Rounded to ~1 m: the same spot is the same site (and the same cached windows); other coordinates, another id.
const round = v => Math.round(v * 1e5) / 1e5;
const made = new Map();

/** The site of a point of the user's own: the same object for the same coordinates. */
export function customSite(lat, lon) {
  lat = round(lat); lon = round(lon) || 0;
  const id = `${CUSTOM_SITE_ID}~${lat}~${lon}`;
  if (!made.has(id)) {
    if (made.size > 20) made.clear();
    made.set(id, { id, name: TEXT.name(fmtCoords({ lat, lon })), short: TEXT.short, lat, lon, custom: true, own: true, note: TEXT.note });
  }
  return made.get(id);
}

/** A point typed in Plan (not a point picked on a map of Advanced, which are `custom` too). */
export const isOwnPoint = site => !!site?.own;
