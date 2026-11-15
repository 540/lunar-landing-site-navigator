// E2.5 · The best point near the flag: the score against the ranking use case, the choice on a synthetic grid and the time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMaskGrid, expectedMaskBytes, maskAt } from '../src/core/mask-grid.js';
import { findBestPoint, improvement, periodSamples, scoreAt, scoreOverMask } from '../src/core/best-point.js';
import { seriesOverMask } from '../src/core/flag-drag.js';
import { periodMetrics } from '../src/core/sky-state.js';
import { loadCatalogMasks } from '../../backend/src/horizon.ts';
import { getSite } from '../../backend/src/sites.ts';
import { rank } from '../../backend/src/useCases.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const DAY_MS = 864e5;

// ---- a synthetic grid: 5 × 5 points, 100 m apart, one azimuth sample every 90°; elevation of the horizon per point ----
const META = { file: 'masks.bin', extentKm: 0.4, stepKm: 0.1, cols: 5, rows: 5, azimuths: 4, encoding: 'int16-le', observerHeightM: 2, demVersion: 'test' };
function gridOf(horizon) { // horizon(col, row) in degrees, the same at every azimuth
  const buf = new Uint8Array(expectedMaskBytes(META));
  const view = new DataView(buf.buffer);
  for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) for (let k = 0; k < 4; k++) view.setInt16(((row * 5 + col) * 4 + k) * 2, Math.round(horizon(col, row) * 100), true);
  return decodeMaskGrid(META, buf);
}
const N = 49; // 48 h
const flat = (el, fraction) => ({ az: Array(N).fill(90), el: Array(N).fill(el), visibleFraction: Array(N).fill(fraction) });
const series = { start: '2027-01-15T00:00:00Z', stepMinutes: 60, count: N, sun: flat(5, 1), earth: flat(5, 1) };
const period = { first: 0, count: N };

test('E2.5 · on a synthetic grid it picks the maximum', () => {
  // Everywhere the horizon hides Sun and Earth (elevation 5°, horizon 20°) except at col 3, row 1 (horizon -10°).
  const grid = gridOf((col, row) => (col === 3 && row === 1 ? -10 : 20));
  return findBestPoint(grid, series, period, { x: 0, z: 0 }).then(best => {
    assert.ok(Math.abs(best.x - 0.1) < 1e-9 && Math.abs(best.z + 0.1) < 1e-9, `(${best.x}, ${best.z})`);
    assert.ok(best.score > 99);
  });
});

test('E2.5 · on a tie it takes the point nearest to the flag', async () => {
  const grid = gridOf(() => -10); // the same everywhere: all tie
  const a = await findBestPoint(grid, series, period, { x: -0.2, z: 0.2 });
  assert.deepEqual([a.x, a.z], [-0.2, 0.2]);
  const b = await findBestPoint(grid, series, period, { x: 0.13, z: -0.02 });
  assert.ok(Math.abs(b.x - 0.1) < 1e-9 && Math.abs(b.z) < 1e-9);
  // two equal maxima, one nearer
  const two = gridOf((col, row) => ((col === 0 && row === 0) || (col === 4 && row === 4) ? -10 : 20));
  const c = await findBestPoint(two, series, period, { x: 0.15, z: 0.15 });
  assert.deepEqual([Math.round(c.x * 10), Math.round(c.z * 10)], [2, 2]);
});

test('E2.5 · the search yields to the page between rows when it goes over the budget', async () => {
  const grid = gridOf(() => 0);
  let pauses = 0, clock = 0;
  await findBestPoint(grid, series, period, { x: 0, z: 0 }, { budgetMs: 5, now: () => (clock += 3), pause: async () => { pauses++; } });
  assert.ok(pauses >= 2);
});

test('E2.5 · the score is that of the bars: periodMetrics over the series with the mask of the point', () => {
  const grid = gridOf((col, row) => col + row - 4);
  const real = read('viewpoint/data/shackleton-rim/series-2027.json');
  const start = new Date('2027-03-01T00:00:00Z');
  const samples = periodSamples(real, start, 60);
  const at = scoreAt(grid, real, samples, 0.1, -0.2);
  const m = periodMetrics(seriesOverMask(real, maskAt(grid, 0.1, -0.2), undefined), start, 60);
  assert.ok(Math.abs(at.energy - m.meanSunDiskFraction) < 1e-12);
  assert.ok(Math.abs(at.sunTime - m.sunTimeFraction) < 1e-12);
  assert.ok(Math.abs(at.earthTime - m.earthTimeFraction) < 1e-12);
  assert.ok(Math.abs(at.score - 100 * (0.7 * m.meanSunDiskFraction + 0.3 * m.earthTimeFraction)) < 1e-9);
});

test('E2.5 · improvement: the points of time gained and the score', () => {
  const g = improvement({ sunTime: 0.5, earthTime: 0.6, score: 50 }, { sunTime: 0.68, earthTime: 0.65, score: 60 });
  assert.ok(Math.abs(g.sun - 18) < 1e-9 && Math.abs(g.earth - 5) < 1e-9 && Math.abs(g.score - 10) < 1e-9);
});

for (const id of ['shackleton-rim', 'im2-objetivo']) {
  test(`E2.5 · ${id}: at the centre of the grid the score is that of the ranking use case (1 h step)`, async () => {
    loadCatalogMasks(path.join(ROOT, 'backend/terrain'), 2);
    const dir = path.join(ROOT, 'viewpoint/data', id);
    const meta = read(`viewpoint/data/${id}/meta.json`).maskGrid;
    const grid = decodeMaskGrid(meta, fs.readFileSync(path.join(dir, 'masks.bin')));
    const real = read(`viewpoint/data/${id}/series-2027.json`);
    const startMs = Date.parse('2027-03-01T00:00:00Z');
    const samples = periodSamples(real, new Date(startMs), 60);
    const mine = scoreAt(grid, real, samples, 0, 0);
    const { results } = rank({ sites: [getSite(id)], startMs, days: 60, terrain: { observerHeightM: 2 } });
    const engine = results[0].cell.score;
    // The series carries no disc radius (mean radii) and the grid is of 100 m: a few tenths of a point.
    console.log(`  ${id}: cliente ${mine.score.toFixed(3)}, motor ${engine}`);
    assert.ok(Math.abs(mine.score - engine) < 0.5, `${id}: cliente ${mine.score} ≠ motor ${engine}`);
  });
}

test('E2.5 · over the real grid the search takes under 500 ms and does not lose to the centre', async () => {
  const id = 'shackleton-rim';
  const grid = decodeMaskGrid(read(`viewpoint/data/${id}/meta.json`).maskGrid, fs.readFileSync(path.join(ROOT, 'viewpoint/data', id, 'masks.bin')));
  const real = read(`viewpoint/data/${id}/series-2027.json`);
  const samples = periodSamples(real, new Date('2027-03-01T00:00:00Z'), 60);
  const t0 = performance.now();
  const best = await findBestPoint(grid, real, samples, { x: 0, z: 0 });
  const ms = performance.now() - t0;
  assert.ok(best.score >= scoreAt(grid, real, samples, 0, 0).score - 1e-9);
  console.log(`  búsqueda sobre ${grid.cols}×${grid.rows} puntos: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 500, `${ms} ms`);
});
