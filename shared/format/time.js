// Durations and dates for the user (#343), always in UTC. One visible date: «15 ene 2027 · 00:00 UTC», or «15 ene 2027»
// without the time. The months come from MONTHS, not from Intl (whose Spanish September is «sept» in some versions and
// «sep» in others), so every screen writes the same. ISO dates (isoDay) are only for URLs, files and the API.
import { langOf, num } from './number.js';

export const MONTHS = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

// ms, a Date or an ISO string («2027-01-15» is midnight UTC).
const toDate = when => (when instanceof Date ? when : new Date(typeof when === 'string' ? Date.parse(when) : when));
const two = n => String(n).padStart(2, '0');

/** Days: days('es', 2) → «2 d»; days('es', 2.5) → «2,5 d». */
export const days = (lang, d, max = 1) => `${num(lang, d, max)} d`;

/** A duration in whole hours, without «0 h»: «5 h», «2 d», «2 d 3 h». Not finite: «—». */
export const hours = (lang, h) => {
  if (!Number.isFinite(h)) return '—';
  const r = Math.round(h), d = Math.trunc(r / 24), rest = Math.abs(r % 24), sign = r < 0 ? '−' : '';
  if (!d) return `${sign}${num(lang, rest, 0)} h`;
  return `${sign}${num(lang, Math.abs(d), 0)} d${rest ? ` ${rest} h` : ''}`;
};

/** Day and month: «15 ene» / «15 Jan». */
export const dayMonth = (lang, when) => { const t = toDate(when); return `${t.getUTCDate()} ${MONTHS[langOf(lang)][t.getUTCMonth()]}`; };

/** The date: «15 ene 2027» / «15 Jan 2027». */
export const date = (lang, when) => `${dayMonth(lang, when)} ${toDate(when).getUTCFullYear()}`;

/** Hour and minute, UTC: «00:00 UTC». */
export const time = (lang, when) => { const t = toDate(when); return `${two(t.getUTCHours())}:${two(t.getUTCMinutes())} UTC`; };

/** Date and time: «15 ene 2027 · 00:00 UTC». */
export const dateTime = (lang, when) => `${date(lang, when)} · ${time(lang, when)}`;

/** Day and month with the time, for spans inside one year: «15 ene · 00:00 UTC». */
export const dayMonthTime = (lang, when) => `${dayMonth(lang, when)} · ${time(lang, when)}`;

/** The ISO day, «2027-01-15»: for URLs, files and the API, never for visible text. */
export const isoDay = when => toDate(when).toISOString().slice(0, 10);
