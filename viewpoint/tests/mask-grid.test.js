import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMaskGrid, maskAt, discFraction, fractionOver, horizonAtAzimuth, expectedMaskBytes } from '../src/core/mask-grid.js';
import { loadMaskGrid } from '../src/region.js';

// 3 × 3 points, 100 m apart (0.2 km square), 4 azimuths; the value of a point is 100 · (row · 3 + col) hundredths + azimuth index.
const META = { file: 'masks.bin', extentKm: 0.2, stepKm: 0.1, cols: 3, rows: 3, azimuths: 4, encoding: 'int16-le', observerHeightM: 2, demVersion: 'lola-test' };
function bytes() {
  const buf = new Uint8Array(expectedMaskBytes(META));
  const view = new DataView(buf.buffer);
  for (let p = 0; p < 9; p++) for (let k = 0; k < 4; k++) view.setInt16((p * 4 + k) * 2, (p * 100 + k) * (p === 4 ? -1 : 1), true);
  return buf;
}

test('decodeMaskGrid reads int16 little-endian hundredths of a degree, point by point', () => {
  const g = decodeMaskGrid(META, bytes());
  assert.equal(g.data.length, 36);
  assert.equal(g.stepDeg, 90);
  assert.equal(g.data[1 * 4 + 2], Math.fround(1.02));
  assert.equal(g.data[4 * 4 + 1], Math.fround(-4.01));
  assert.equal(decodeMaskGrid({ maskGrid: META }, bytes()).cols, 3);
});

test('decodeMaskGrid refuses a file of another size and another encoding', () => {
  assert.throws(() => decodeMaskGrid(META, new Uint8Array(10)), /pesa 10 bytes y se esperaban 72/);
  assert.throws(() => decodeMaskGrid({ ...META, encoding: 'int8' }, bytes()), /int16-le/);
});

test('maskAt: the mask of a node, and the bilinear mix of the four around any other point (x east, z south)', () => {
  const g = decodeMaskGrid(META, bytes());
  assert.deepEqual(Array.from(maskAt(g, -0.1, -0.1).el), [0, 0.01, 0.02, 0.03].map(Math.fround));
  assert.ok(Math.abs(maskAt(g, 0.1, -0.1).el[0] - 2) < 1e-6); // point 2 (north-east corner)
  assert.ok(Math.abs(maskAt(g, -0.1, 0.1).el[0] - 6) < 1e-6); // point 6 (south-west corner)
  // half way between points 0 and 1 (north edge): their mean
  assert.ok(Math.abs(maskAt(g, -0.05, -0.1).el[0] - 0.5) < 1e-6);
  // the middle of the first cell: the mean of points 0, 1, 3 and 4 (4 is -4)
  assert.ok(Math.abs(maskAt(g, -0.05, -0.05).el[0] - (0 + 1 + 3 - 4) / 4) < 1e-6);
  // outside the square: the nearest edge
  assert.deepEqual(Array.from(maskAt(g, -9, -9).el), Array.from(maskAt(g, -0.1, -0.1).el));
});

test('horizonAtAzimuth is linear between samples and wraps round 360°', () => {
  const mask = { el: Float32Array.of(0, 10, 20, 30), stepDeg: 90 };
  assert.equal(horizonAtAzimuth(mask, 45), 5);
  assert.equal(horizonAtAzimuth(mask, 315), 15);
  assert.equal(horizonAtAzimuth(mask, -45), 15);
});

test('discFraction: the whole disc, half of it, none, and the 0.5 − … of a limb grazing the horizon', () => {
  const flat = { el: new Float32Array(4).fill(1), stepDeg: 90 };
  assert.equal(discFraction(flat, 10, 3, 0.27), 1);
  assert.equal(discFraction(flat, 10, 1, 0.27), 0.5);
  assert.equal(discFraction(flat, 10, 0.5, 0.27), 0);
  const f = fractionOver(1.1, 0.27, 1);
  assert.ok(f > 0.5 && f < 1, String(f));
  // same values as fractionOver of backend/src/visibility.ts: segment of a disc of radius 1 at y = 0.5 → (acos .5 − .5·√.75) / π
  assert.ok(Math.abs(fractionOver(0, 1, 0.5) - (Math.acos(0.5) - 0.5 * Math.sqrt(0.75)) / Math.PI) < 1e-12);
});

test('loadMaskGrid: null without maskGrid, null (with a warning) when the file fails, the decoded grid otherwise', async () => {
  const realFetch = globalThis.fetch;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await loadMaskGrid('x', { }), null);
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    assert.equal(await loadMaskGrid('x', { maskGrid: META }), null);
    let url;
    globalThis.fetch = async u => { url = u; return { ok: true, arrayBuffer: async () => bytes().buffer }; };
    const g = await loadMaskGrid('x', { maskGrid: META });
    assert.equal(url, 'data/x/masks.bin');
    assert.equal(g.rows, 3);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
  }
});
