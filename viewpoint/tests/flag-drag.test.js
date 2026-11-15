import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMaskGrid, maskAt, discFraction, expectedMaskBytes } from '../src/core/mask-grid.js';
import { clampToGrid, nearestGridPoint, nearestMask, seriesOverMask, flagFigures, stepFlag, APPARENT_RADIUS_DEG } from '../src/core/flag-drag.js';
import { periodMetrics } from '../src/core/sky-state.js';

// 3 × 3 points, 100 m apart, 4 azimuths. Point p has a horizon of p degrees at every azimuth (0 to 8°).
const META = { file: 'masks.bin', extentKm: 0.2, stepKm: 0.1, cols: 3, rows: 3, azimuths: 4, encoding: 'int16-le', observerHeightM: 2, demVersion: 'lola-test' };
function grid() {
  const buf = new Uint8Array(expectedMaskBytes(META));
  const view = new DataView(buf.buffer);
  for (let p = 0; p < 9; p++) for (let k = 0; k < 4; k++) view.setInt16((p * 4 + k) * 2, p * 100, true);
  return decodeMaskGrid(META, buf);
}
// Two samples an hour apart: the Sun at 3° and at 0.5° of elevation, the Earth at 3°, both towards the east.
const SERIES = {
  start: '2027-01-15T00:00:00Z', stepMinutes: 60, count: 2,
  sun: { az: [90, 90], el: [3, 0.5], visibleFraction: [1, 1] },
  earth: { az: [90, 90], el: [3, 3], visibleFraction: [1, 1] },
};

test('clampToGrid takes a point outside the grid to the nearest edge and leaves the inside alone', () => {
  const g = grid();
  assert.deepEqual(clampToGrid(g, 5, -5), { x: 0.1, z: -0.1 });
  assert.deepEqual(clampToGrid(g, -0.3, 0.02), { x: -0.1, z: 0.02 });
  assert.deepEqual(clampToGrid(g, 0.04, -0.07), { x: 0.04, z: -0.07 });
});

test('nearestGridPoint snaps to the grid and nearestMask is the mask of that point', () => {
  const g = grid();
  assert.deepEqual(nearestGridPoint(g, 0.04, 0.06), { x: 0, z: 0.1 });
  assert.deepEqual(nearestGridPoint(g, 9, 9), { x: 0.1, z: 0.1 });
  assert.equal(nearestMask(g, 0.04, 0.06).el[0], Math.fround(7)); // point 7: row 2, column 1
});

test('at the drop the figures come from the mask interpolated at the point', () => {
  const g = grid();
  const f = flagFigures(g, SERIES, 0.05, 0, { exact: true }); // half way between points 4 and 5: a 4.5° horizon
  assert.ok(Math.abs(f.mask.el[1] - 4.5) < 1e-6);
  assert.deepEqual(Array.from(f.mask.el), Array.from(maskAt(g, 0.05, 0).el));
  const r = APPARENT_RADIUS_DEG.sun;
  assert.equal(f.series.sun.visibleFraction[0], discFraction(f.mask, 90, 3, r)); // 3° over a 4.5° horizon: hidden
  assert.equal(f.series.sun.visibleFraction[0], 0);
  assert.equal(f.series.earth.visibleFraction[1], discFraction(f.mask, 90, 3, APPARENT_RADIUS_DEG.earth));
  assert.deepEqual(f.series.sun.az, SERIES.sun.az); // the rest of the series is the series'
  assert.equal(SERIES.sun.visibleFraction[0], 1); // and the original is not touched
});

test('while dragging the figures are those of the nearest grid point', () => {
  const g = grid();
  const f = flagFigures(g, SERIES, 0.06, 0, { exact: false }); // nearest point: 5 (a 5° horizon)
  assert.deepEqual(f.at, { x: 0.06, z: 0 });
  assert.equal(f.mask.el[0], Math.fround(5));
});

test('a point outside the grid is taken to the edge, with the figures of the edge', () => {
  const g = grid();
  const f = flagFigures(g, SERIES, 50, 50, { exact: true });
  assert.deepEqual(f.at, { x: 0.1, z: 0.1 });
  assert.equal(f.mask.el[0], Math.fround(8));
});

test('seriesOverMask feeds periodMetrics: a higher horizon means less light', () => {
  const g = grid();
  const flat = seriesOverMask(SERIES, maskAt(g, -0.1, -0.1)); // 0° horizon
  const high = seriesOverMask(SERIES, maskAt(g, 0.1, 0.1)); // 8° horizon
  const start = new Date(SERIES.start);
  assert.ok(periodMetrics(flat, start, 1 / 24).sunTimeFraction > periodMetrics(high, start, 1 / 24).sunTimeFraction);
  assert.equal(periodMetrics(high, start, 1 / 24).sunTimeFraction, 0);
});

test('stepFlag moves one step of the grid with the arrows, stays inside and ignores other keys', () => {
  const g = grid();
  assert.deepEqual(stepFlag(g, { x: 0, z: 0 }, 'ArrowRight'), { x: 0.1, z: 0 });
  assert.deepEqual(stepFlag(g, { x: 0, z: 0 }, 'ArrowUp'), { x: 0, z: -0.1 }); // up is north, -z
  assert.deepEqual(stepFlag(g, { x: 0.1, z: 0 }, 'ArrowRight'), { x: 0.1, z: 0 });
  assert.equal(stepFlag(g, { x: 0, z: 0 }, 'Enter'), null);
});
