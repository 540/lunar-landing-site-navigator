// Language of the planner (E8, #283): t('key', …) over the dictionaries of web/js/i18n/, and the formatters of
// shared/format/ (#343) bound to the language in use. Switching language reloads the page, so `lang` is fixed for the
// life of the page. Under node (tests) there is no page: Spanish.
import { translator, LOCALES } from '../../../shared/i18n/lang.js';
import { initLang } from '../../../shared/i18n/page.js';
import { deg, pct, km, m, coords } from '../../../shared/format/number.js';
import { days, hours, date, dateTime, dayMonth, dayMonthTime } from '../../../shared/format/time.js';
import { DICTS } from '../i18n/index.js';

export { isoDay } from '../../../shared/format/time.js';
// The one fmtNum of shared/format/ (#343), «6,5», «1.234», «−1,5»: fmtNum(x, max = 1, min = 0) in the language of the
// page, which initLang writes to <html lang>.
export { fmtNum } from '../../../shared/format/number.js';
export const lang = typeof document === 'undefined' || typeof location === 'undefined' ? 'es' : initLang(); // tests may stub only `document`
export const locale = LOCALES[lang];
export const t = translator(DICTS, lang);
/** Degrees with one decimal: «1,1°» / «1.1°». */
export const fmtDeg = (x, max = 1, min = max) => deg(lang, x, max, min);
/** A percentage (0–100): «12 %» / «12%». */
export const fmtPct = (x, max = 0) => pct(lang, x, max);
/** Kilometres and metres: «12,3 km», «120 m». */
export const fmtKm = (x, max = 1) => km(lang, x, max);
export const fmtM = (x, max = 0) => m(lang, x, max);
/** A point: «89,45° S, 12,3° O». */
export const fmtCoords = (point, max = 2, min = 0) => coords(lang, point, max, min);
/** Days, «2,5 d», and a duration in hours without «0 h»: «2 d», «2 d 3 h», «5 h». */
export const fmtDays = (d, max = 1) => days(lang, d, max);
export const fmtHours = h => hours(lang, h);
/** UTC dates: «15 ene 2027», «15 ene 2027 · 00:00 UTC», «15 ene», «15 ene · 00:00 UTC». */
export const fmtDate = when => date(lang, when);
export const fmtDateTime = when => dateTime(lang, when);
export const fmtDayMonth = when => dayMonth(lang, when);
export const fmtDayMonthTime = when => dayMonthTime(lang, when);
