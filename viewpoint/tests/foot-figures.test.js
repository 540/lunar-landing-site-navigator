// E3.6: your figures where you stand, over a synthetic grid of masks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMaskGrid, expectedMaskBytes } from '../src/core/mask-grid.js';
import { createFootFigures } from '../src/core/foot-figures.js';

const META = { file: 'masks.bin', extentKm: 0.2, stepKm: 0.1, cols: 3, rows: 3, azimuths: 4, encoding: 'int16-le', observerHeightM: 2, demVersion: 'lola-test' };
// The horizon rises 0°, 5°, 10° … from one point of the grid to the next (centi-degrees)
const grid = decodeMaskGrid(META, (() => {
  const buf = new Uint8Array(expectedMaskBytes(META)), dv = new DataView(buf.buffer);
  for (let p = 0; p < 9; p++) for (let k = 0; k < 4; k++) dv.setInt16((p * 4 + k) * 2, p * 500, true);
  return buf;
})());
const series = {
  start: '2027-01-15T00:00:00Z', stepMinutes: 60, count: 3,
  sun: { az: [0, 0, 0], el: [7, 7, 7], visibleFraction: [1, 1, 1] },
  earth: { az: [0, 0, 0], el: [7, 7, 7], visibleFraction: [1, 1, 1] },
};

test('stopped: the figures are those of the point where you are', () => {
  const f = createFootFigures({ grid, series });
  const a = f.update(-0.1, -0.1, 0, true), b = f.update(0.1, 0.1, 10, true);
  assert.equal(a.status, 'figures');
  assert.equal(a.series.sun.visibleFraction[0], 1); // flat horizon: Sun above it
  assert.equal(b.series.sun.visibleFraction[0], 0); // 40° horizon: hidden
  assert.deepEqual(b.at, { x: 0.1, z: 0.1 });
});

test('while walking: at most one calculation per second', () => {
  const f = createFootFigures({ grid, series });
  assert.ok(f.update(0, 0, 0));
  assert.equal(f.update(0.01, 0, 400), null);
  assert.equal(f.update(0.02, 0, 999), null);
  assert.ok(f.update(0.03, 0, 1000));
  assert.ok(f.update(0.03, 0, 1100, true), 'stopping calculates at once');
});

test('outside the grid: the notice comes once, nothing is recalculated, and it goes away on coming back', () => {
  const f = createFootFigures({ grid, series });
  assert.ok(f.update(0, 0, 0));
  assert.deepEqual(f.update(0.5, 0, 2000, true), { status: 'outside' });
  assert.equal(f.update(0.6, 0, 3000, true), null);
  const back = f.update(0.05, 0, 3100);
  assert.equal(back.status, 'inside');
  assert.equal(f.update(0.06, 0, 3200), null);
});
