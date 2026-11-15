// CSV for spreadsheets (issue #66). One format for every export of the web:
//   - UTF-8 with BOM, so Excel reads the accents;
//   - ";" between cells and a decimal comma, what a spreadsheet in Spanish opens with a double click
//     (elsewhere: import with separator ";" and decimal ","; in pandas, sep=';', decimal=',');
//   - dates in UTC, ISO 8601 (2027-04-03T12:00:00Z); booleans as sí / no; CRLF line ends (RFC 4180).
//   In English (?lang=en): ',' between cells, a decimal point and yes / no, what a spreadsheet in English expects.
// No DOM here except in downloadCsv, so the rest runs under node --test (in Spanish).
import { lang } from './i18n.js';

const EN = lang === 'en';
export const CSV_SEPARATOR = EN ? ',' : ';';
export const CSV_BOM = '﻿';

/** Instant in ms → UTC, ISO 8601, to the second. */
export const isoUtc = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Number rounded to `digits` decimals (null stays null: an empty cell). */
export const round = (v, digits = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits);

/** One cell: numbers with a decimal comma, booleans as sí / no, empty for null, undefined and NaN; text quoted when needed. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? (EN ? 'yes' : 'sí') : 'no';
  if (typeof value === 'number') return Number.isFinite(value) ? (EN ? String(value) : String(value).replace('.', ',')) : '';
  let text = String(value);
  // A text that starts like a formula would be run by the spreadsheet: make it plain text.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return (EN ? /[",\r\n]|^\s|\s$/ : /[";\r\n]|^\s|\s$/).test(text) ?`"${text.replace(/"/g, '""')}"` : text;
}

/** Headers and rows (arrays of values) → the text of the CSV file, BOM included. */
export function toCsv(headers, rows) {
  const line = cells => cells.map(csvCell).join(CSV_SEPARATOR);
  return CSV_BOM + [headers, ...rows].map(line).join('\r\n') + '\r\n';
}

/** A name → a piece of a file name: lower case, no accents, hyphens. */
export const fileSlug = name => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Instant in ms → a piece of a file name: 2027-04-03T1200Z. */
export const fileStamp = ms => new Date(ms).toISOString().slice(0, 16).replace(':', '') + 'Z';

/** Makes the browser download `text` (from toCsv) as `filename`. */
export function downloadCsv(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
