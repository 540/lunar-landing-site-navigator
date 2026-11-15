// Mission figures as the views write them (#329). Pure: no DOM, so the tests import them as the views do.
import { fmtNum } from '../../../shared/format/number.js';

/** True when a form field's raw value is a number: an empty field is not «0». */
export const isFilled = value => String(value ?? '').trim() !== '' && Number.isFinite(+value);

/** A form field's raw value as a summary shows it: the number with a decimal comma, or «—» while it is empty. */
export const fieldText = value => (isFilled(value) ? fmtNum(+value) : '—');

/**
 * What is wrong with a form field, or null: { kind: 'missing' } (empty when required, or not a number), or out of its
 * limits ({ kind: 'range' | 'min' | 'max', min, max }). `min` and `max` are the input's own limits, as strings like the
 * DOM gives them (empty: no limit). The view words it in the language in use.
 */
export function fieldProblem(value, { min = '', max = '', required = true } = {}) {
  if (!isFilled(value)) return required || String(value ?? '').trim() ? { kind: 'missing' } : null;
  const lo = String(min).trim() === '' ? -Infinity : +min, hi = String(max).trim() === '' ? Infinity : +max;
  if (+value >= lo && +value <= hi) return null;
  return { kind: Number.isFinite(lo) && Number.isFinite(hi) ? 'range' : Number.isFinite(lo) ? 'min' : 'max', min: lo, max: hi };
}

/** Day of the mission at hour i from landing: a whole number, capped like the Mirador (Math.ceil of the days). */
export const simDay = (i, days) => Math.min(Math.ceil(days), Math.floor(i / 24) + 1);
