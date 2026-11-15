// Hybrid horizon: direct ray at the exact azimuth near the horizon (horizon.ts refinedMask, visibility.ts horizonAt).
// Synthetic DEMs only (no network nor real cache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { R_M, configureDem, demVersion, layersFor, llToXY, makeGrid, xyToLL } from '../src/terrain/dem.ts';
import { buildMask, computeHorizon, horizonRay, rayForMask } from '../src/terrain/horizonMask.ts';
import {
  REFINE_DEFAULT_DEG, configureMasks, fastModeWarning, maskFor, refinedMask, registerMask, getMask, resolveTerrain, terrainStatus,
} from '../src/horizon.ts';
import { fractionEdgeY, fractionOver, horizonAt, margin, visibleFraction } from '../src/visibility.ts';
import { cellMasks, evaluateCell, normalizeWeights } from '../src/search.ts';
import { sampleVectors } from '../src/service.ts';
import { resolveScenario } from '../evals/lib.ts';
import { fingerprint } from '../evals/fingerprint.ts';
import type { DiscPosition, Grid, HorizonMask, RawScenario, TerrainOption } from '../src/types.ts';

const D2R = Math.PI / 180;
configureMasks({ diskCache: false });

/** Grid centred on the pole: ±halfKm, `res` m/px, height z(x, y) in metres. */
function synthetic(res: number, halfKm: number, z: (x: number, y: number) => number, name: string = 'synth'): Grid {
  const n = Math.round((2 * halfKm * 1000) / res), a = new Float32Array(n * n);
  const X0 = -halfKm * 1000, Y0 = halfKm * 1000;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = z(X0 + (i + 0.5) * res, Y0 - (j + 0.5) * res);
  return makeGrid({ name, res, X0, Y0, w: n, h: n, a });
}

/** Point at great-circle distance dM and azimuth azDeg (0 = north, clockwise) from (lat, lon), as x/y of the projection. */
function pointAt(lat: number, lon: number, azDeg: number, dM: number): [number, number] {
  const la = lat * D2R, lo = lon * D2R, az = azDeg * D2R, de = dM / R_M;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const q = [0, 1, 2].map((i) => Math.cos(de) * up[i] + Math.sin(de) * (Math.cos(az) * north[i] + Math.sin(az) * east[i]));
  const plat = Math.asin(q[2]) / D2R, plon = Math.atan2(q[1], q[0]) / D2R;
  return llToXY(plat, plon);
}

// Rough terrain: two scales of ridges plus a plateau, coarse 240 m + fine 20 m window around the site.
const rough = (x: number, y: number): number => 400 * Math.sin(x / 2300) * Math.cos(y / 3100) + 150 * Math.sin((x + 2 * y) / 700) + (Math.hypot(x, y - 3000) > 9000 ? 900 : 0);

test('rayo directo: en los acimuts de la máscara da exactamente lo mismo que computeHorizon', () => {
  configureDem({ grids: [synthetic(240, 120, rough, 'coarse'), synthetic(20, 14, rough, 'fine')] });
  const [lat, lon] = xyToLL(1500, -2000);
  for (const resolution of ['precise', 'fast'] as const) {
    const sel = layersFor(lat, lon, resolution)!;
    const opts = { observerHeightM: 2, stepFrac: sel.cfg.stepFrac, grow: sel.cfg.grow };
    const hz = computeHorizon(lat, lon, sel.layers, { nAz: sel.cfg.nAz, ...opts });
    const { trace } = horizonRay(lat, lon, sel.layers, opts);
    for (let k = 0; k < sel.cfg.nAz; k++) assert.equal(trace((k * 360) / sel.cfg.nAz).el, hz.el[k], `${resolution} k=${k}`);
    // the mask is rounded to 0.01°: its ray at the nodes matches within half a hundredth
    const mask = buildMask(lat, lon, { resolution })!;
    const ray = rayForMask(mask)!;
    for (let k = 0; k < mask.el.length; k += 7) assert.ok(Math.abs(ray(k * mask.stepDeg) - mask.el[k]) <= 0.005 + 1e-12, `${resolution} nodo ${k}`);
  }
});

test('máscaras sin DEM detrás: sin rayo y el mismo objeto (resultados idénticos)', () => {
  configureDem({ grids: [synthetic(240, 120, rough)] });
  const hand: HorizonMask = { stepDeg: 1, el: Array.from({ length: 360 }, (_, i) => (i % 7) / 10), source: 'test' };
  registerMask('hybrid-hand', hand);
  assert.equal(rayForMask(hand), null);
  assert.equal(refinedMask(getMask('hybrid-hand')), hand);
  // catalogue-like mask of another DEM version (or with no DEM in the cache): no ray either
  const [lat, lon] = xyToLL(0, 2000);
  const m = buildMask(lat, lon)!;
  assert.equal(refinedMask({ ...m, demVersion: 'lola-000000000000' }, 0.1)!.refine, undefined);
  configureDem({ grids: [] });
  assert.equal(refinedMask(m, 0.1), m);
  assert.equal(maskFor(lat, lon), null);
});

test('el híbrido corrige un pico estrecho entre dos acimuts de la máscara', () => {
  // Flat ground (20 m px) with a single 200 m column (one pixel) 10 km away at azimuth ~0.25°: the mask rays (0° and
  // 0.5°) pass ≥ 29 m from its centre (more than a pixel) and do not see it; the exact azimuth does.
  const res = 20, half = 20;
  const [lat, lon] = xyToLL(0, 2000); // north = away from the pole: the column ends up at y ≈ 12 km
  const [px, py] = pointAt(lat, lon, 0.25, 10000);
  assert.ok(Math.abs(px) < 1000 && py > 11000 && py < 13000);
  const n = Math.round((2 * half * 1000) / res), X0 = -half * 1000, Y0 = half * 1000;
  const i0 = Math.round((px - X0) / res - 0.5), j0 = Math.round((Y0 - py) / res - 0.5);
  const fine = synthetic(res, half, () => 0, 'flat-fine');
  fine.a[j0 * n + i0] = 200;
  configureDem({ grids: [fine] });
  configureMasks({ diskCache: false });
  const mask = maskFor(lat, lon, 2, 'precise')!;
  assert.ok(mask && mask.resolution === 'precise');
  const refined = refinedMask(mask)!; // default threshold of precise mode: 0.1°
  assert.equal(refined.refine!.deg, REFINE_DEFAULT_DEG.precise);
  assert.equal(refinedMask(mask), refined); // cached: same object
  // the peak, scanning the ray between the two nodes
  let az = 0, top = -Infinity;
  for (let a = 0.02; a < 0.5; a += 0.005) { const e = refined.refine!.elevation(a); if (e > top) { top = e; az = a; } }
  const interp = mask.el[0] * (1 - az / 0.5) + mask.el[1] * (az / 0.5);
  assert.ok(Math.max(mask.el[0], mask.el[1]) < -0.02, `la máscara no ve el pico (${mask.el[0]}, ${mask.el[1]})`);
  assert.ok(top - interp > 0.1, `el rayo sí: ${top}° frente a ${interp}°`);
  // Sun whose upper limb is 0.03° above the interpolated mask: visible for the mask, hidden by the peak for the hybrid
  const r = 0.27, sun: DiscPosition = { az, el: interp + 0.03 - r, radiusDeg: r, distKm: 1.5e8 } as DiscPosition;
  assert.ok(margin(sun, mask, 'limb') > 0);
  assert.ok(margin(sun, refined, 'limb') < 0);
  assert.equal(visibleFraction(sun, refined), 0);
  assert.ok(visibleFraction(sun, mask) > 0);
  // horizonAt with no edge nearby: the mask (no ray), and far from the horizon nothing changes
  const before = terrainStatus().rays;
  const high: DiscPosition = { ...sun, el: 5 };
  assert.equal(margin(high, refined, 'limb'), margin(high, mask, 'limb'));
  assert.equal(visibleFraction(high, refined), 1);
  assert.equal(horizonAt(high, refined, 5), horizonAt(high, mask, 5));
  assert.equal(terrainStatus().rays, before);
  // the second query at the same azimuth (to 1e-4°) comes from the cache
  const hits = terrainStatus().rayHits;
  margin({ ...sun, az: az + 4e-5 }, refined, 'limb');
  assert.equal(terrainStatus().rays, before);
  assert.equal(terrainStatus().rayHits, hits + 1);
  // threshold 0 = off: the mask itself
  assert.equal(refinedMask(mask, 0), mask);
});

test('fractionEdgeY: borde de la fracción visible (1 → limbo superior, 0,5 → centro, 1 → limbo inferior)', () => {
  assert.equal(fractionEdgeY(0), 1);
  assert.equal(fractionEdgeY(1), -1);
  assert.ok(Math.abs(fractionEdgeY(0.5)) < 1e-12);
  for (const f of [0.1, 0.3, 0.9]) {
    const y = fractionEdgeY(f);
    assert.ok(Math.abs(fractionOver({ az: 0, el: 0, radiusDeg: 1 } as DiscPosition, y) - f) < 1e-9, `f=${f}`);
  }
});

test('evaluateCell: con el híbrido apagado (o en modo rápido por defecto) es idéntico a solo máscara', () => {
  configureDem({ grids: [synthetic(240, 120, rough, 'coarse'), synthetic(20, 14, rough, 'fine')] });
  configureMasks({ diskCache: false });
  const sampled = sampleVectors(Date.parse('2027-01-01T00:00:00Z'), Date.parse('2027-02-15T00:00:00Z'), 3600e3);
  const [lat, lon] = xyToLL(1500, -2000);
  const cell = { lat, lon };
  const base = { mode: 'limb' as const, stepMs: 3600e3, weights: normalizeWeights({}) };
  const run = (terrain: TerrainOption) => evaluateCell(cell, sampled, { ...base, terrain: resolveTerrain({ enabled: true, ...terrain }) });
  // refine off → the raw mask (no `refine`), and the metrics of the mask alone
  const off = resolveTerrain({ enabled: true, resolution: 'precise', refine: false })!;
  assert.equal(cellMasks(cell, off).sun!.refine, undefined);
  assert.equal(cellMasks(cell, off).sun, maskFor(lat, lon, 2, 'precise'));
  assert.deepEqual(run({ resolution: 'precise', refineDeg: 0 }), run({ resolution: 'precise', refine: false }));
  // fast: off by default; refine=true turns it on with the precise threshold
  assert.equal(cellMasks(cell, resolveTerrain({ enabled: true, resolution: 'fast' })).sun!.refine, undefined);
  assert.equal(cellMasks(cell, resolveTerrain({ enabled: true, resolution: 'fast', refine: true })).sun!.refine!.deg, 0.1);
  // precise with the hybrid: every metric within a few samples of the mask alone
  const on = run({ resolution: 'precise' }), plain = run({ resolution: 'precise', refine: false });
  assert.ok(Math.abs(on.metrics.energy - plain.metrics.energy) < 0.01);
  assert.ok(Math.abs(on.metrics.sunFraction - plain.metrics.sunFraction) < 0.01);
});

test('resolveTerrain y scenarioHash: el valor por defecto no se guarda; otro umbral o apagado, sí', () => {
  configureDem({ grids: [synthetic(240, 120, rough)] });
  const base = { enabled: true, observerHeightM: 2, demVersion: demVersion() };
  assert.deepEqual(resolveTerrain({ enabled: true, resolution: 'precise' }), { ...base, resolution: 'precise' });
  assert.deepEqual(resolveTerrain({ enabled: true, resolution: 'precise', refine: true, refineDeg: 0.1 }), { ...base, resolution: 'precise' });
  assert.deepEqual(resolveTerrain({ enabled: true, resolution: 'precise', refine: false }), { ...base, resolution: 'precise', refineDeg: 0 });
  assert.deepEqual(resolveTerrain({ enabled: true, resolution: 'precise', refineDeg: 0.3 }), { ...base, resolution: 'precise', refineDeg: 0.3 });
  assert.deepEqual(resolveTerrain({ enabled: true, resolution: 'fast', refine: false }), { ...base, resolution: 'fast' });
  assert.deepEqual(resolveTerrain({ enabled: true, resolution: 'fast', refine: true }), { ...base, resolution: 'fast', refineDeg: 0.1 });
  assert.throws(() => resolveTerrain({ enabled: true, refineDeg: -1 }), /terrain\.refineDeg/);
  assert.throws(() => resolveTerrain({ enabled: true, refineDeg: 5 }), /terrain\.refineDeg/);
  assert.throws(() => resolveTerrain({ enabled: true, refine: 'sí' as unknown as boolean }), /terrain\.refine/);
  const SCEN = { name: 't', region: { latMin: -90, latMax: -88, lonMin: -180, lonMax: 180 }, dates: ['2027-01-10'] } satisfies RawScenario;
  const hash = (terrain: TerrainOption): string => fingerprint(resolveScenario({ ...SCEN, terrain })).scenarioHash;
  assert.equal(hash({ enabled: true, resolution: 'precise', refine: true }), hash({ enabled: true, resolution: 'precise' }));
  assert.notEqual(hash({ enabled: true, resolution: 'precise', refine: false }), hash({ enabled: true, resolution: 'precise' }));
  assert.equal(hash({ enabled: true }), hash({ enabled: true, refine: false })); // fast: off by default
});

test('aviso del modo rápido: solo en rápido, con DEM y al sur de −85° o con ventana de 20 m', () => {
  configureDem({ grids: [synthetic(240, 400, () => 0, 'coarse')] });
  const fast = resolveTerrain({ enabled: true, resolution: 'fast' });
  assert.match(fastModeWarning(fast, [{ lat: -89.4, lon: 0 }])!, /406 horas.*111 h a 274 h.*terrainResolution=precise/);
  assert.equal(fastModeWarning(fast, [{ lat: -84, lon: 0 }]), null);
  assert.equal(fastModeWarning(resolveTerrain({ enabled: true, resolution: 'precise' }), [{ lat: -89.4, lon: 0 }]), null);
  // a 20 m window north of −85°: warned too
  const [x, y] = llToXY(-84, 0);
  const fine = makeGrid({ name: 'win', res: 20, X0: x - 3000, Y0: y + 3000, w: 300, h: 300, a: new Float32Array(300 * 300) });
  configureDem({ grids: [synthetic(240, 400, () => 0, 'coarse'), fine] });
  assert.ok(fastModeWarning(resolveTerrain({ enabled: true, resolution: 'fast' }), [{ lat: -84, lon: 0 }]));
  configureDem({ grids: [] });
  assert.equal(fastModeWarning(resolveTerrain({ enabled: true, resolution: 'fast' }), [{ lat: -89.4, lon: 0 }]), null);
});
