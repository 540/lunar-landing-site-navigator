// The point of the chapter «Mueve la bandera» (E6.1): the point of the grid of masks, close to the flag, where the light of the
// period is most different from the flag's. Pure: no DOM, no three.js. The figures come from `periodMetrics` over the series with
// the mask of each point, which is what the bars of the panel show, so the reveal and the bars cannot disagree.
import { maskAt } from './mask-grid.js';
import { seriesOverMask } from './flag-drag.js';
import { scoreOverMask } from './best-point.js';
import { periodMetrics } from './sky-state.js';

/** How far from the flag the chapter looks (km): «unos cientos de metros». */
export const SEARCH_RADIUS_KM = 0.5;
/** The light has to differ at least this much (share of the period with Sun) for the point to say anything. */
export const MIN_SUN_DIFFERENCE = 0.1;

/**
 * The grid point within `radiusKm` of `from` whose share of time with Sun over the period differs most from the share at `from`;
 * on a tie, the nearest. Null if no point differs by `minDifference`.
 * @param {object} grid mask grid (core/mask-grid.js)
 * @param {object} series series of the region
 * @param {{first:number, count:number}} period samples of the period (`periodSamples`)
 * @param {{x:number, z:number}} from where the flag is (km)
 * @returns {{x:number, z:number, distanceKm:number, difference:number}|null} `difference`: signed, after − before
 */
export function pickContrastPoint(grid, series, period, from, { radiusKm = SEARCH_RADIUS_KM, minDifference = MIN_SUN_DIFFERENCE } = {}) {
  const here = scoreOverMask(series, maskAt(grid, from.x, from.z), period).sunTime;
  const half = grid.extentKm / 2;
  let best = null;
  for (let row = 0; row < grid.rows; row++) {
    const z = row * grid.stepKm - half;
    for (let col = 0; col < grid.cols; col++) {
      const x = col * grid.stepKm - half;
      const distanceKm = Math.hypot(x - from.x, z - from.z);
      if (distanceKm > radiusKm + 1e-9) continue;
      const difference = scoreOverMask(series, maskAt(grid, x, z), period).sunTime - here;
      const better = !best || Math.abs(difference) > Math.abs(best.difference) + 1e-9
        || (Math.abs(Math.abs(difference) - Math.abs(best.difference)) <= 1e-9 && distanceKm < best.distanceKm);
      if (better) best = { x, z, distanceKm, difference };
    }
  }
  return best && Math.abs(best.difference) >= minDifference ? best : null;
}

/** The metrics of the bars (`periodMetrics`) for the flag at (x, z): the mask interpolated at the point, as on the drop. */
export function metricsAt(grid, series, start, days, x, z) {
  return periodMetrics(seriesOverMask(series, maskAt(grid, x, z)), start, days);
}

/**
 * What the reveal shows: the metrics before (at `from`) and after (at `to`) and the distance between them in metres.
 * @returns {{before:object, after:object, distanceM:number}}
 */
export function revealFigures(grid, series, start, days, from, to) {
  return { before: metricsAt(grid, series, start, days, from.x, from.z), after: metricsAt(grid, series, start, days, to.x, to.z), distanceM: Math.hypot(to.x - from.x, to.z - from.z) * 1000 };
}
