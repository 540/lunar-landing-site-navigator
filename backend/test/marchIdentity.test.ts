// Identity of the ray-march (#414): computeHorizon and horizonRay of src/ give the same bits as the frozen reference
// (test/reference/horizonMarchReference.ts) on synthetic ridged terrain. Today it holds by construction; it is the safety
// net of the faster march (B1.2, #415). Without a real DEM nor network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOLUTIONS, configureDem, layersFor, makeGrid, xyToLL } from '../src/terrain/dem.ts';
import type { Grid, Resolution } from '../src/types.ts';
import { compareMarch, randomAzimuths, seededRandom } from './reference/marchIdentity.ts';
import type { MarchComparison } from './reference/marchIdentity.ts';
import * as ref from './reference/horizonMarchReference.ts';

const HEIGHTS = [0, 2, 2.3, 100];
const RES = Object.keys(RESOLUTIONS) as Resolution[];
const RAYS_PER_CASE = 200;

// Ridged relief: sharp crests (1 − |sin|) of random direction, wavelength and height, all from a fixed seed.
const rand = seededRandom(414);
const wave = (minAmp: number, maxAmp: number, minLen: number, maxLen: number) => {
  const dir = rand() * Math.PI, len = minLen + rand() * (maxLen - minLen), phase = rand() * 2 * Math.PI;
  const kx = (2 * Math.PI * Math.cos(dir)) / len, ky = (2 * Math.PI * Math.sin(dir)) / len, amp = minAmp + rand() * (maxAmp - minAmp);
  return (x: number, y: number): number => amp * (1 - Math.abs(Math.sin(kx * x + ky * y + phase)));
};
const broad = Array.from({ length: 6 }, () => wave(300, 1500, 5000, 60000));
const detail = Array.from({ length: 4 }, () => wave(10, 40, 200, 800));
const zCoarse = (x: number, y: number): number => broad.reduce((s, f) => s + f(x, y), -2000);
const zFine = (x: number, y: number): number => zCoarse(x, y) + detail.reduce((s, f) => s + f(x, y), 0);

/** Grid of `res` m/px whose first pixel centre is at (x0 + res/2, y0 − res/2), w × h pixels. */
function grid(name: string, res: number, x0: number, y0: number, w: number, h: number, z: (x: number, y: number) => number): Grid {
  const a = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a[j * w + i] = z(x0 + (i + 0.5) * res, y0 - (j + 0.5) * res);
  return makeGrid({ name, product: 'sintético', res, X0: x0, Y0: y0, w, h, a });
}

// Coarse layer (> 80 m): 1 km/px, ±330 km around the pole. Fine layer (≤ 80 m): 20 m/px, 12 × 12 km centred at (20, 10) km.
const COARSE = grid('gruesa', 1000, -330000, 330000, 660, 660, zCoarse);
const FINE_C = [20000, 10000];
const FINE = grid('fina', 20, FINE_C[0] - 6000, FINE_C[1] + 6000, 600, 600, zFine);
// The same fine layer with NaN holes (discs of 60–200 m radius) around the site of the hole case.
const HOLEY = (() => {
  const a = Float32Array.from(FINE.a), holes = Array.from({ length: 40 }, () => [FINE_C[0] + (rand() - 0.5) * 11000, FINE_C[1] + (rand() - 0.5) * 11000, 60 + rand() * 140]);
  for (let j = 0; j < FINE.h; j++) for (let i = 0; i < FINE.w; i++) {
    const x = FINE.X0 + (i + 0.5) * FINE.res, y = FINE.Y0 - (j + 0.5) * FINE.res;
    if (holes.some(([hx, hy, r]) => Math.hypot(x - hx, y - hy) < r && Math.hypot(hx - FINE_C[0] - 500, hy - FINE_C[1] + 500) > r + 100)) a[j * FINE.w + i] = NaN;
  }
  return makeGrid({ ...FINE, name: 'fina con huecos', a });
})();

after(() => { configureDem(); });

/** Compares src/ with the reference at (x, y) for every height and resolution; returns the comparisons by resolution. */
function check(x: number, y: number, grids: Grid[]): Record<Resolution, MarchComparison[]> {
  configureDem({ grids });
  const [lat, lon] = xyToLL(x, y);
  const out = {} as Record<Resolution, MarchComparison[]>;
  for (const resolution of RES) {
    out[resolution] = [];
    for (const observerHeightM of HEIGHTS) {
      const sel = layersFor(lat, lon, resolution);
      assert.ok(sel, `sin capas en (${x}, ${y}) ${resolution}`);
      const { nAz, stepFrac, grow } = sel.cfg;
      const r = compareMarch(lat, lon, sel.layers, { nAz, observerHeightM, stepFrac, grow }, randomAzimuths(rand, RAYS_PER_CASE));
      assert.deepEqual(r.diffs.slice(0, 5), [], `${resolution}, h=${observerHeightM} m: ${r.diffs.length} diferencias`);
      assert.ok(r.samples > 0 && r.rays >= RAYS_PER_CASE);
      out[resolution].push(r);
    }
  }
  return out;
}

const layerNames = (x: number, y: number, resolution: Resolution): string[] => layersFor(...xyToLL(x, y), resolution)!.layers.map((l) => l.g.name);

test('identidad: punto con capa fina (20 m hasta 10 km y 1 km detrás)', () => {
  configureDem({ grids: [FINE, COARSE] });
  assert.deepEqual(layerNames(FINE_C[0] + 500, FINE_C[1] - 500, 'precise'), ['fina', 'gruesa']);
  const r = check(FINE_C[0] + 500, FINE_C[1] - 500, [FINE, COARSE]);
  for (const res of RES) for (const c of r[res]) assert.equal(c.miss, 0);
});

test('identidad: punto solo con capa gruesa', () => {
  configureDem({ grids: [FINE, COARSE] });
  assert.deepEqual(layerNames(-15000, -20000, 'precise'), ['gruesa']);
  const r = check(-15000, -20000, [FINE, COARSE]);
  for (const res of RES) for (const c of r[res]) assert.equal(c.miss, 0);
});

test('identidad: punto cerca del borde de la rejilla (muestras sin dato, miss > 0)', () => {
  const r = check(300000, 0, [FINE, COARSE]);
  for (const res of RES) for (const c of r[res]) assert.ok(c.miss > 0 && c.miss < c.samples, `${res}: miss ${c.miss} de ${c.samples}`);
});

test('identidad: rejilla fina con huecos NaN', () => {
  assert.ok(HOLEY.a.some(Number.isNaN), 'la rejilla fina tiene huecos');
  const [x, y] = [FINE_C[0] + 500, FINE_C[1] - 500];
  configureDem({ grids: [HOLEY, COARSE] });
  assert.deepEqual(layerNames(x, y, 'precise'), ['fina con huecos', 'gruesa']);
  const r = check(x, y, [HOLEY, COARSE]);
  for (const res of RES) for (const c of r[res]) assert.equal(c.miss, 0, 'la capa gruesa rellena los huecos');
  // The rays do cross the holes: the precise mask differs from the one of the same site without holes.
  const [lat, lon] = xyToLL(x, y);
  const mask = (grids: Grid[]): number[] => {
    configureDem({ grids });
    const { layers, cfg } = layersFor(lat, lon, 'precise')!;
    return Array.from(ref.computeHorizon(lat, lon, layers, { nAz: cfg.nAz, stepFrac: cfg.stepFrac, grow: cfg.grow }).el);
  };
  assert.notDeepEqual(mask([HOLEY, COARSE]), mask([FINE, COARSE]), 'los huecos cambian la máscara');
});
