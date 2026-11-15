// Numbers for the user (#329, #343): no padding zeros, a true minus sign (U+2212) and thousands grouping also with four
// digits («1.234», not «1234»), in the language of the screen (#283): decimal comma in Spanish, point in English.
// Every formatter takes the language (`es` or `en`; also `es-ES` or `en-GB`) as a parameter; fmtNum reads it from
// <html lang>, which shared/i18n/page.js sets before any screen renders; without a DOM (tests, Node) it is Spanish.
// Not for CSV, URLs, the API, datetime-local or logs: those keep the dot.

export const LOCALES = { es: 'es-ES', en: 'en-GB' };
const BY_LOCALE = { 'es-ES': 'es', 'en-GB': 'en' };

/** `es` or `en` from a language or a locale; anything else, `es`. */
export const langOf = lang => (lang in LOCALES ? lang : BY_LOCALE[lang] ?? 'es');
const pageLang = () => langOf(globalThis.document?.documentElement?.lang);

const FORMATS = new Map();
const format = (lang, max, min, grouping) => {
  const key = `${lang}:${max}:${min}:${grouping}`;
  if (!FORMATS.has(key)) {
    FORMATS.set(key, new Intl.NumberFormat(LOCALES[lang], {
      minimumFractionDigits: min, maximumFractionDigits: Math.max(min, max), signDisplay: 'negative', useGrouping: grouping ? 'always' : false,
    }));
  }
  return FORMATS.get(key);
};

/**
 * A number with at most `max` decimals (and at least `min`): num('es', 6.5) → «6,5»; num('es', 10) → «10»;
 * num('es', 1234) → «1.234»; num('es', -1.5) → «−1,5»; num('es', 1, 1, 1) → «1,0». In English: «6.5», «1,234», «−1.5».
 * `{ grouping: false }` drops the thousands separator, only for fixed-width readouts: num('es', 2100, 0, 0, { grouping: false }) → «2100».
 */
export const num = (lang, x, max = 1, min = 0, { grouping = true } = {}) =>
  format(langOf(lang), max, min, grouping).format(x).replace('-', '−');

/**
 * The only fmtNum (#343), always in the language of the page: fmtNum(6.5) → «6,5»; fmtNum(0.25, 2) → «0,25»;
 * fmtNum(-1.5) → «−1,5»; fmtNum(1, 1, 1) → «1,0». Its third argument is the minimum of decimals, never the language:
 * for another language, num(lang, …).
 */
export const fmtNum = (x, max = 1, min = 0) => num(pageLang(), x, max, min);

/** Degrees: deg('es', 1.25, 1, 1) → «1,3°». */
export const deg = (lang, x, max = 1, min = 0) => `${num(lang, x, max, min)}°`;

/** A percentage (0–100): «12 %» in Spanish, «12%» in English. */
export const pct = (lang, x, max = 0, min = 0) => `${num(lang, x, max, min)}${langOf(lang) === 'en' ? '' : ' '}%`;

/** Kilometres: «12,3 km». */
export const km = (lang, x, max = 1, min = 0) => `${num(lang, x, max, min)} km`;

/** Metres: «120 m». */
export const m = (lang, x, max = 0, min = 0) => `${num(lang, x, max, min)} m`;

/** A point of the Moon: «89,45° S, 12,3° E»; west is «O» in Spanish and «W» in English. */
export const coords = (lang, { lat, lon }, max = 2, min = 0) => {
  const west = langOf(lang) === 'en' ? 'W' : 'O';
  return `${deg(lang, Math.abs(lat), max, min)} ${lat < 0 ? 'S' : 'N'}, ${deg(lang, Math.abs(lon), max, min)} ${lon < 0 ? west : 'E'}`;
};
