// Reads the ephemeris series (viewpoint/data/<site>/series-2027.json) at any instant. Pure: no fetch, no DOM.
// Between two hourly samples it interpolates linearly; azimuths take the short way round (359° → 1° passes 360°/0°, not 180°).
import { deg } from '../../../shared/format/number.js';

const norm360 = deg => ((deg % 360) + 360) % 360;

function lerp(a, b, f) {
  return a + (b - a) * f;
}

function lerpAz(a, b, f) {
  const diff = ((b - a + 540) % 360) - 180; // signed short-way difference, in [-180, 180)
  return norm360(a + diff * f);
}

export function seriesEnd(series) {
  return new Date(Date.parse(series.start) + (series.count - 1) * series.stepMinutes * 60000);
}

export function sampleAt(series, date) {
  const stepMs = series.stepMinutes * 60000;
  const pos = (date.getTime() - Date.parse(series.start)) / stepMs;
  if (!Number.isFinite(pos) || pos < 0 || pos > series.count - 1) {
    throw new RangeError(`The date ${date.toISOString()} is outside the series`);
  }
  const i = Math.min(Math.floor(pos), series.count - 2);
  const f = pos - i;
  const at = body => ({
    az: lerpAz(body.az[i], body.az[i + 1], f),
    el: lerp(body.el[i], body.el[i + 1], f),
  });
  return { sun: at(series.sun), earth: at(series.earth) };
}

/** Sun and Earth angles, with up to two decimals (shared/format/, #343): «0,39°» / «0.39°». */
export const formatDeg = (value, lang = 'es') => deg(lang, value, 2);
