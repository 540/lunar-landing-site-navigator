// The figures of the chapters «Sombras de kilómetros», «Llamar a casa» and «Tú decides» (E6.2). Pure: no DOM, no three.js.
// Everything the reveals say comes from here, from the series or from the grid, so no figure is written in the texts.
import { periodSamples, scoreAt, findBestPoint, improvement } from './best-point.js';
import { periodMetrics, nextChange, fractionAt } from './sky-state.js';
import { sampleAt } from './series.js';

const DAY_MS = 86400000;
/** The Sun counts as in view from this visible fraction (the same as `sunState` of sky-state.js). */
export const SUN_VISIBLE = 0.99;
/** Height of the relief the shadow chapter asks about (km). */
export const RELIEF_HEIGHT_KM = 1;
/** The elevation of the example of the formula of the expert level (degrees): 1 / tan(1,5°) ≈ 38,2 km. */
export const FORMULA_EXAMPLE_DEG = 1.5;
/** When the Earth is not hidden in the whole period, «Llamar a casa» runs the time this many days. */
export const EARTH_RUN_DAYS = 2;

/** Length (km) of the shadow of a relief `heightKm` high with the Sun `elevationDeg` over the horizon: L = h / tan(elevation). */
export function shadowLengthKm(heightKm, elevationDeg) {
  if (!(elevationDeg > 0) || elevationDeg >= 90) return Infinity;
  return heightKm / Math.tan(elevationDeg * Math.PI / 180);
}

/**
 * The instant of «Sombras de kilómetros»: inside the period, the sample with the Sun highest among those with the Sun in view
 * (visibleFraction ≥ 0.99, elevation above the horizon); on a tie, the earliest. Null if no sample qualifies.
 * @param {object} series series of the site
 * @param {{first:number, count:number}} period samples of the period (`periodSamples`)
 * @returns {{index:number, date:Date, elevation:number, azimuth:number}|null}
 */
export function pickShadowInstant(series, { first, count }) {
  const { el, az, visibleFraction } = series.sun;
  let best = -1;
  for (let i = first; i < first + count; i++) {
    if (visibleFraction[i] < SUN_VISIBLE || !(el[i] > 0)) continue;
    if (best < 0 || el[i] > el[best] + 1e-12) best = i;
  }
  if (best < 0) return null;
  return { index: best, date: new Date(Date.parse(series.start) + best * series.stepMinutes * 60e3), elevation: el[best], azimuth: az[best] };
}

/** What the shadow chapter measures and says: the instant, the elevation of the Sun at it and the shadow of the relief. Null without an instant. */
export function shadowFigures(series, start, days) {
  const at = pickShadowInstant(series, periodSamples(series, start, days));
  return at && { ...at, offsetDays: (at.date.getTime() - start.getTime()) / DAY_MS, lengthKm: shadowLengthKm(RELIEF_HEIGHT_KM, at.elevation) };
}

/**
 * «Llamar a casa»: the figures of `periodMetrics` for the period, and the run of the scene: from the first instant with the Earth in
 * view to the next one when it stops being seen (or `EARTH_RUN_DAYS` later if it is not hidden in the period), never past the period.
 * `run` is null if the Earth is never seen.
 */
export function earthFigures(series, start, days) {
  const metrics = periodMetrics(series, start, days);
  const { first, count } = periodSamples(series, start, days);
  const end = new Date(start.getTime() + days * DAY_MS);
  let from = -1;
  for (let i = first; i < first + count; i++) if (series.earth.visibleFraction[i] > 0) { from = i; break; }
  if (from < 0) return { metrics, run: null };
  const fromDate = new Date(Date.parse(series.start) + from * series.stepMinutes * 60e3);
  const change = nextChange(series, 'earth', fromDate, end);
  const stop = change.type === 'set' ? change.date : new Date(Math.min(end.getTime(), fromDate.getTime() + EARTH_RUN_DAYS * DAY_MS));
  const offset = d => (d.getTime() - start.getTime()) / DAY_MS;
  return { metrics, run: { from: fromDate, to: stop, fromOffsetDays: offset(fromDate), toOffsetDays: offset(stop) } };
}

/** Where the Earth is at `date` ({azimuth, elevation}) and where to look at it: a negative elevation looks at the horizon. */
export function earthGaze(series, date) {
  const { az, el } = sampleAt(series, date).earth;
  return { azimuth: az, elevation: el, lookElevation: Math.max(0, el) };
}

/** The Earth is seen at `date` (any part of its disc). */
export const earthSeen = (series, date) => fractionAt(series, 'earth', date) > 0;

/**
 * «Tú decides»: the score of the point the visitor chose against the best one of the grid (`findBestPoint`) over the period, and what
 * moving there would gain (`improvement`). `isBest`: the visitor is already at the best point (or at a score no lower).
 */
export async function compareWithBest(grid, series, start, days, at, options) {
  const period = periodSamples(series, start, days);
  const mine = scoreAt(grid, series, period, at.x, at.z);
  const best = await findBestPoint(grid, series, period, at, options);
  const isBest = Math.hypot(best.x - at.x, best.z - at.z) < 1e-6 || mine.score >= best.score - 1e-9;
  return { mine, best, gain: improvement(mine, best), isBest };
}
