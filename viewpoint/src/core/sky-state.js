// Light and Earth at the flag (E1, #121), read from series-2027.json. Pure: no fetch, no DOM.
// The source of truth is `visibleFraction` of the series: the engine already computed it with the LOLA mask of the site,
// so the client never compares the series with the mask again.

const HOUR_MS = 3600e3;

/** Position of a date in the series, in samples (fractional). */
const positionOf = (series, date) => (date.getTime() - Date.parse(series.start)) / (series.stepMinutes * 60e3);
const dateOf = (series, pos) => new Date(Date.parse(series.start) + pos * series.stepMinutes * 60e3);

/** Visible fraction (0..1) of the disc of `body` ('sun' | 'earth') at `date`: linear between two hourly samples. */
export function fractionAt(series, body, date) {
  const pos = positionOf(series, date);
  if (!Number.isFinite(pos) || pos < 0 || pos > series.count - 1) throw new RangeError(`The date ${date.toISOString()} is outside the series`);
  const i = Math.min(Math.floor(pos), series.count - 2);
  const f = pos - i;
  const v = series[body].visibleFraction;
  return v[i] + (v[i + 1] - v[i]) * f;
}

/** State of the Sun from its visible fraction: ≥ 0.99 in view, > 0 half hidden, 0 hidden (E1.1). */
export function sunState(fraction) {
  if (fraction >= 0.99) return 'visible';
  return fraction > 0 ? 'partial' : 'hidden';
}

/** State of the Earth: in view as soon as part of the disc shows, like the `center`… criteria of the API (E1.2). */
export const earthState = fraction => (fraction > 0 ? 'visible' : 'hidden');

/**
 * Next set (when the body is seen now) or next rise (when it is not) of `body` between `date` and `until` (E1.4).
 * A body is seen in a sample when its visibleFraction is > 0, as the windows of the engine (limb mode). The change is
 * placed halfway between the last sample of one state and the first of the other: at most half a step off.
 * @returns {{type: 'set'|'rise', date: Date, hours: number} | {type: 'none', seen: boolean}} `none`: no change before `until`.
 */
export function nextChange(series, body, date, until) {
  const seen = fractionAt(series, body, date) > 0;
  const v = series[body].visibleFraction;
  const last = Math.min(series.count - 1, Math.floor(positionOf(series, until)));
  for (let k = Math.max(1, Math.ceil(positionOf(series, date))); k <= last; k++) {
    if ((v[k] > 0) !== seen) {
      const at = new Date(Math.max(date.getTime(), dateOf(series, k - 0.5).getTime()));
      return { type: seen ? 'set' : 'rise', date: at, hours: (at.getTime() - date.getTime()) / HOUR_MS };
    }
  }
  return { type: 'none', seen };
}

/**
 * Metrics of the flag over a period (E1.3), with the names of `RankResult.metrics` of the API and the same rules as the
 * engine (evaluateCell in backend/src/search.ts): one sample per hour from `start` to `start + days` (both included),
 * a body is seen when its visibleFraction is > 0, and the streaks count samples × step.
 * @returns {{meanSunDiskFraction:number, sunTimeFraction:number, earthTimeFraction:number, sunAndEarthTimeFraction:number,
 *   longestNightHours:number, longestEarthOutageHours:number}}
 */
export function periodMetrics(series, start, days) {
  const first = Math.round(positionOf(series, start));
  const stepH = series.stepMinutes / 60;
  const n = Math.round(days * 24 / stepH) + 1;
  if (first < 0 || first + n > series.count) throw new RangeError(`The period from ${start.toISOString()} does not fit in the series`);
  const sun = series.sun.visibleFraction, earth = series.earth.visibleFraction;
  let energy = 0, sunN = 0, earthN = 0, bothN = 0, night = 0, maxNight = 0, noEarth = 0, maxNoEarth = 0;
  for (let i = first; i < first + n; i++) {
    const s = sun[i] > 0, e = earth[i] > 0;
    energy += sun[i];
    if (s) { sunN++; night = 0; } else if (++night > maxNight) maxNight = night;
    if (e) { earthN++; noEarth = 0; } else if (++noEarth > maxNoEarth) maxNoEarth = noEarth;
    if (s && e) bothN++;
  }
  return {
    meanSunDiskFraction: energy / n,
    sunTimeFraction: sunN / n,
    earthTimeFraction: earthN / n,
    sunAndEarthTimeFraction: bothN / n,
    longestNightHours: maxNight * stepH,
    longestEarthOutageHours: maxNoEarth * stepH,
  };
}
