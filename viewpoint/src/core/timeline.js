// State and arithmetic of the timeline (E0.4). Pure: no DOM, no clock.
// The visitor picks a start date and moves over a window of WINDOW_DAYS from it.

export const WINDOW_DAYS = 60;
export const SPEEDS = [0.25, 1, 4]; // days of mission per second of real time
export const DEFAULT_SPEED_INDEX = 1;
export const START_MIN = '2027-01-01'; // first precomputed day
export const START_MAX = '2027-11-01'; // last start for which the whole window fits in the series
const DAY_MS = 86400000;

// Parses a YYYY-MM-DD string as UTC midnight; null when it is not a real date.
export function parseDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text || '')) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text ? null : d;
}

// Keeps a start date inside the precomputed range; an invalid text falls back to the first day.
export function clampStart(text) {
  const d = parseDay(text);
  if (!d) return START_MIN;
  if (d < parseDay(START_MIN)) return START_MIN;
  if (d > parseDay(START_MAX)) return START_MAX;
  return text;
}

// `clamp` is the identity for a period asked live to the API (E10.2), which is not inside the precomputed range.
export function instantAt(startText, offsetDays, clamp = clampStart) {
  return new Date(parseDay(clamp(startText)).getTime() + offsetDays * DAY_MS);
}

// Moves the offset forward by dtSeconds at the given speed and wraps to the start at the end of the window.
export function advance(offsetDays, dtSeconds, speed) {
  const next = offsetDays + dtSeconds * speed;
  return next >= WINDOW_DAYS ? next % WINDOW_DAYS : Math.max(0, next);
}

// Day number shown to the visitor, 1 to WINDOW_DAYS (the far end of the slider is still day 60).
export function dayLabel(offsetDays) {
  return Math.min(Math.floor(offsetDays) + 1, WINDOW_DAYS);
}

// True when a typed start date is a real date already inside the precomputed range.
export function isStartInRange(text) {
  const d = parseDay(text);
  return d !== null && d >= parseDay(START_MIN) && d <= parseDay(START_MAX);
}

/** Start date in `?start=<date>`: the date if it is valid and inside the range, otherwise `fallback`. */
export function startFromSearch(search, fallback, isValid = isStartInRange) {
  const raw = new URLSearchParams(search).get('start');
  return raw !== null && isValid(raw) ? raw : fallback;
}

export function nextSpeedIndex(index) {
  return (index + 1) % SPEEDS.length;
}

// The mission viewer (V1.2): the window is the mission, [0, totalDays]. It does not wrap: it stops at the end.
export function advanceWithin(offsetDays, dtSeconds, speed, totalDays) {
  return Math.min(totalDays, Math.max(0, offsetDays + dtSeconds * speed));
}

// A run of the guided visit (E6.2): forward up to `target` days, without wrapping, and it is done when it gets there.
export function stepRun(offsetDays, dtSeconds, speed, target) {
  const next = Math.min(target, offsetDays + dtSeconds * speed);
  return { offsetDays: next, done: next >= target };
}

// Cancels the run in `playback` from outside the visit (play button, `time.set`): the visit hears it through `onCancel`.
export function cancelRun(playback) {
  const run = playback.runTo;
  if (!run) return false;
  playback.runTo = null;
  run.onCancel?.();
  return true;
}
