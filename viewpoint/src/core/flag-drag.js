// Moving the flag (E2.2): where it can go and what the light and the Earth are there. Pure: no three.js, no DOM.
// The masks come from the grid of E2.0 (core/mask-grid.js). Units in km, scene axes (x east, z south).
import { maskAt, discFraction } from './mask-grid.js';

/** Angular radius (°) of the Sun and of the Earth as the engine sees them on average (a series carries no radius). */
export const APPARENT_RADIUS_DEG = { sun: 0.267, earth: 0.95 };
/** One arrow key moves the flag one step of the grid (100 m in the catalogue grids). */
export const KEY_DIRECTIONS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

/** The point taken to the nearest edge of the square of the grid (it never leaves it). */
export function clampToGrid(grid, x, z) {
  const half = grid.extentKm / 2;
  return { x: Math.min(Math.max(x, -half), half), z: Math.min(Math.max(z, -half), half) };
}

/** The point of the grid nearest to (x, z), which is clamped first: the one whose figures are shown while dragging. */
export function nearestGridPoint(grid, x, z) {
  const p = clampToGrid(grid, x, z);
  const half = grid.extentKm / 2;
  const snap = (v, count) => Math.min(Math.max(Math.round((v + half) / grid.stepKm), 0), count - 1) * grid.stepKm - half;
  return { x: snap(p.x, grid.cols), z: snap(p.z, grid.rows) };
}

/** Mask (`{el, stepDeg}`) of the grid point nearest to (x, z): no interpolation, for the frames of a drag. */
export function nearestMask(grid, x, z) {
  const p = nearestGridPoint(grid, x, z);
  return maskAt(grid, p.x, p.z);
}

/**
 * The series with the visible fraction of the Sun and of the Earth recomputed over `mask`: the azimuth and elevation of each
 * sample are the series' own, and so is everything else. `periodMetrics`, `fractionAt` and `nextChange` read the result as they
 * read the original.
 */
export function seriesOverMask(series, mask, radii = APPARENT_RADIUS_DEG) {
  const over = body => {
    const { az, el } = series[body];
    const visibleFraction = new Array(az.length);
    for (let i = 0; i < az.length; i++) visibleFraction[i] = discFraction(mask, az[i], el[i], radii[body]);
    return { ...series[body], visibleFraction };
  };
  return { ...series, sun: over('sun'), earth: over('earth') };
}

/**
 * What the visitor sees for a flag at (x, z): the position taken into the grid, the mask (`exact`: interpolated at the point,
 * for the drop; otherwise that of the nearest grid point, for the frames of a drag) and the series over it.
 */
export function flagFigures(grid, series, x, z, { exact }) {
  const at = clampToGrid(grid, x, z);
  const mask = exact ? maskAt(grid, at.x, at.z) : nearestMask(grid, at.x, at.z);
  return { at, mask, series: seriesOverMask(series, mask) };
}

/** The flag one step of the grid in the direction of the arrow key (`key`), kept inside the grid; null for any other key. */
export function stepFlag(grid, at, key) {
  const dir = KEY_DIRECTIONS[key];
  if (!dir) return null;
  return clampToGrid(grid, at.x + dir[0] * grid.stepKm, at.z + dir[1] * grid.stepKm);
}
