// Lossless DEM packing (src/terrain/demPack.ts, #129): bit for bit round trip, and a terrain cache of .ldp files gives the
// same grids, horizons and shared buffers as the same cache in .f32.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PACKED_EXT, packGrid, packedSize, unpackGrid } from '../src/terrain/demPack.ts';
import { configureDem, demVersion, gridsCovering, listGrids, loadSharedGrids } from '../src/terrain/dem.ts';
import { buildMask } from '../src/terrain/horizonMask.ts';

const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

/** Smooth relief with noise, like a DEM: heights of thousands of metres with arbitrary float bits. */
function relief(w: number, h: number, seed = 1): Float32Array {
  const a = new Float32Array(w * h);
  let s = seed;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a[j * w + i] = 3000 * Math.sin(i / 17) * Math.cos(j / 23) - 1500 + rnd() * 3;
  return a;
}

test('ida y vuelta bit a bit: relieve, valores extremos, NaN, −0 e infinitos', () => {
  const a = relief(97, 61);
  a.set([NaN, -0, 0, Infinity, -Infinity, 3.4e38, -3.4e38, 1e-45, -1e-45, -9127.1142578125], 500);
  const packed = packGrid(a, 97, 61);
  assert.deepEqual(packedSize(packed), { w: 97, h: 61 });
  assert.ok(sameBits(unpackGrid(packed), a));
  const out = new Float32Array(new SharedArrayBuffer(a.byteLength));
  assert.equal(unpackGrid(packed, out), out);
  assert.ok(sameBits(out, a));
});

test('rejillas degeneradas: una fila, una columna, un píxel', () => {
  for (const [w, h] of [[50, 1], [1, 50], [1, 1]]) {
    const a = relief(w, h, w + h);
    assert.ok(sameBits(unpackGrid(packGrid(a, w, h)), a), `${w}×${h}`);
  }
});

test('comprime el relieve y rechaza lo que no es una rejilla empaquetada', () => {
  const a = relief(400, 400);
  assert.ok(packGrid(a, 400, 400).length < 0.75 * a.byteLength);
  assert.throws(() => unpackGrid(Buffer.from('no es un LDP1 de verdad')), /LDP1/);
  assert.throws(() => packGrid(a, 399, 400), /399×400/);
});

// The same synthetic cache twice: one in .f32 and one in .ldp.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dempack-'));
after(() => { configureDem({ grids: [] }); fs.rmSync(root, { recursive: true, force: true }); });
const res = 240, n = 300, half = (n * res) / 2;
const heights = relief(n, n, 7);
const meta = { product: 'LDEM_SINTETICO', res, X0: -half, Y0: half, c0: 0, r0: 0, w: n, h: n };
for (const kind of ['f32', 'ldp'] as const) {
  const cache = path.join(root, kind, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'synth.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(cache, kind === 'f32' ? 'synth.f32' : `synth${PACKED_EXT}`), kind === 'f32' ? Buffer.from(heights.buffer) : packGrid(heights, n, n));
}

test('la caché en .ldp da las mismas rejillas, versión y horizontes que en .f32', () => {
  const [raw, packed] = (['f32', 'ldp'] as const).map((kind) => {
    const version = configureDem({ dir: path.join(root, kind) });
    const [grid] = gridsCovering(0, 0);
    return { version, grids: listGrids(), a: grid.a, bin: grid.bin, horizon: buildMask(-89.6, 40, { resolution: 'fast' }) };
  });
  assert.ok(raw.version);
  assert.equal(packed.version, raw.version);
  assert.deepEqual(packed.grids, raw.grids);
  assert.match(packed.bin!, /\.ldp$/);
  assert.ok(sameBits(packed.a, raw.a));
  assert.ok(raw.horizon && raw.horizon.el.some((e) => e !== 0), 'el horizonte sale del DEM sintético');
  assert.deepEqual(packed.horizon, raw.horizon);
});

test('el pool comparte la rejilla desempaquetada en un SharedArrayBuffer', async () => {
  const buffers = await loadSharedGrids(path.join(root, 'ldp'));
  const [sab] = Object.values(buffers);
  assert.ok(sab instanceof SharedArrayBuffer);
  assert.ok(sameBits(new Float32Array(sab), heights));
});

test('una .ldp de otro tamaño que su .json no se usa', () => {
  const dir = path.join(root, 'bad');
  fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cache', 'synth.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'cache', `synth${PACKED_EXT}`), packGrid(relief(10, 10), 10, 10));
  assert.equal(configureDem({ dir }), null);
  assert.equal(demVersion(), null);
});
