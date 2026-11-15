// Your figures where you stand (E3.6): while walking, the light and the Earth of the point under your feet. Pure: no three.js,
// no DOM. The grid of masks only covers a square around the site (E2.0), so out of it the figures stay and a notice shows.
import { flagFigures } from './flag-drag.js';

/** While walking the figures are computed at most once per second; when you stop, at once. */
export const WALK_INTERVAL_MS = 1000;

/** Whether a point (km, scene) is inside the grid of masks. */
export const insideGrid = (grid, x, z) => Math.abs(x) <= grid.extentKm / 2 && Math.abs(z) <= grid.extentKm / 2;

/**
 * @param {{grid:object, series:object, intervalMs?:number}} options
 * @returns {{update:(x:number, z:number, nowMs:number, stopped?:boolean) => null | {status:'outside'} | {status:'figures'|'inside', at:{x:number,z:number}, mask:object, series:object}}}
 *   `update` returns null when there is nothing new: the same state, or too soon while walking. `outside`: you left the grid
 *   (said once, the figures stay); `inside`: you are back (the notice goes away); `figures`: the new figures of the point.
 */
export function createFootFigures({ grid, series, intervalMs = WALK_INTERVAL_MS }) {
  let outside = false, lastAt = -Infinity;
  return {
    update(x, z, nowMs, stopped = false) {
      if (!insideGrid(grid, x, z)) {
        if (outside) return null;
        outside = true;
        return { status: 'outside' };
      }
      const back = outside;
      if (!back && !stopped && nowMs - lastAt < intervalMs) return null;
      outside = false;
      lastAt = nowMs;
      const { at, mask, series: over } = flagFigures(grid, series, x, z, { exact: true });
      return { status: back ? 'inside' : 'figures', at, mask, series: over };
    },
  };
}
