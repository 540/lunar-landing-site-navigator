// The best point near the flag (E2.5): the point of the grid of masks (E2.0) with the most light and Earth over the period in
// view. Pure: no three.js, no DOM. The score is the one of the engine (scoreMetrics in backend/src/search.ts, with the default
// weights and a panel that follows the Sun): 100 · (energy · 0.7 + comm · 0.3), `energy` the mean visible fraction of the Sun's
// disc and `comm` the fraction of time with the Earth in view, over the same samples as the bars of the panel.
import { maskAt, discFraction } from './mask-grid.js';
import { APPARENT_RADIUS_DEG, nearestGridPoint } from './flag-drag.js';

/**
 * Weights of the score, the defaults of the engine (`DEFAULT_WEIGHTS` in backend/src/search.ts, already normalized to sum 1).
 * The client cannot import the engine: tests/best-point-weights.test.mjs checks they are the same.
 */
export const SCORE_WEIGHTS = Object.freeze({ energy: 0.7, comm: 0.3 });

/** Two scores closer than this are a tie (the nearest point to the flag wins). */
const TIE = 1e-9;

/** Index of the first sample of the period and how many samples it has (one per step, both ends included), as `periodMetrics`. */
export function periodSamples(series, start, days) {
  const first = Math.round((start.getTime() - Date.parse(series.start)) / (series.stepMinutes * 60e3));
  const count = Math.round(days * 24 * 60 / series.stepMinutes) + 1;
  if (first < 0 || first + count > series.count) throw new RangeError(`The period from ${start.toISOString()} does not fit in the series`);
  return { first, count };
}

/**
 * Light and Earth over `mask` in the samples `first … first + count − 1`: `sunTime` and `earthTime` (fractions of time, what the
 * bars show), `energy` (mean visible fraction of the Sun's disc) and the `score` (0..100).
 */
export function scoreOverMask(series, mask, { first, count }, radii = APPARENT_RADIUS_DEG) {
  const { az: sunAz, el: sunEl } = series.sun, { az: earthAz, el: earthEl } = series.earth;
  let energy = 0, sunN = 0, earthN = 0;
  for (let i = first; i < first + count; i++) {
    const s = discFraction(mask, sunAz[i], sunEl[i], radii.sun);
    energy += s;
    if (s > 0) sunN++;
    if (discFraction(mask, earthAz[i], earthEl[i], radii.earth) > 0) earthN++;
  }
  energy /= count;
  const earthTime = earthN / count;
  return { energy, sunTime: sunN / count, earthTime, score: 100 * (SCORE_WEIGHTS.energy * energy + SCORE_WEIGHTS.comm * earthTime) };
}

/** The same figures for a point of the scene (km): the mask interpolated at it, as on the drop of the flag. */
export function scoreAt(grid, series, period, x, z) {
  return { ...scoreOverMask(series, maskAt(grid, x, z), period), x, z };
}

/**
 * The point of the grid with the highest score over the period; on a tie, the nearest to `from` (the flag's position).
 * Visits the grid row by row and, whenever `budgetMs` have gone by since the last pause, awaits `pause()` (default: a macrotask),
 * so a long search does not freeze the page. `onProgress(done, total)` is called at each pause.
 * @returns {Promise<{x:number, z:number, score:number, energy:number, sunTime:number, earthTime:number}>}
 */
export async function findBestPoint(grid, series, period, from, { budgetMs = 12, pause = () => new Promise(r => setTimeout(r, 0)), now = () => performance.now(), onProgress } = {}) {
  const origin = nearestGridPoint(grid, from.x, from.z);
  const half = grid.extentKm / 2;
  let best = null, bestDist = Infinity, since = now();
  for (let row = 0; row < grid.rows; row++) {
    const z = row * grid.stepKm - half;
    for (let col = 0; col < grid.cols; col++) {
      const x = col * grid.stepKm - half;
      const figures = scoreAt(grid, series, period, x, z);
      const dist = Math.hypot(x - origin.x, z - origin.z);
      if (!best || figures.score > best.score + TIE || (figures.score >= best.score - TIE && dist < bestDist)) { best = figures; bestDist = dist; }
    }
    if (now() - since > budgetMs) {
      onProgress?.(row + 1, grid.rows);
      await pause();
      since = now();
    }
  }
  return best;
}

/** What the visitor gains by moving from `before` to `after` (figures of `scoreOverMask`): points of time with Sun and with Earth. */
export function improvement(before, after) {
  return { sun: (after.sunTime - before.sunTime) * 100, earth: (after.earthTime - before.earthTime) * 100, score: after.score - before.score };
}
