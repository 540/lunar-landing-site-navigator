// Terrain: synthetic DEMs (no network nor real cache), on-demand masks, evals with `terrain` and behaviour without a DEM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { R_M, bilinear, configureDem, demVersion, layersFor, llToXY, makeGrid, xyToLL } from '../src/terrain/dem.ts';
import { buildMask, computeHorizon, dipDeg } from '../src/terrain/horizonMask.ts';
import { configureMasks, getMask, horizonElevation, loadCatalogMasks, maskFor, terrainStatus } from '../src/horizon.ts';
import { evaluateCandidate, evaluateRobust, prepareSamples, resolveScenario } from '../evals/lib.ts';
import { fingerprint } from '../evals/fingerprint.ts';
import { searchGrid } from '../src/search.ts';
import { snapshot } from '../src/service.ts';
import { getSite } from '../src/sites.ts';
import { rank, search } from '../src/useCases.ts';
import type { TerrainRequest } from '../src/useCases.ts';
import type { Grid, RawScenario } from '../src/types.ts';

const D2R = Math.PI / 180;
/** Synthetic grid centred on the pole: +-halfKm, `res` m/px, height z(x, y) in metres. */
function synthetic(res: number, halfKm: number, z: (x: number, y: number) => number, name: string = 'synth'): Grid {
  const n = Math.round((2 * halfKm * 1000) / res), a = new Float32Array(n * n);
  const X0 = -halfKm * 1000, Y0 = halfKm * 1000;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = z(X0 + (i + 0.5) * res, Y0 - (j + 0.5) * res);
  return makeGrid({ name, res, X0, Y0, w: n, h: n, a });
}
const SCEN = { name: 't', region: { latMin: -90, latMax: -88, lonMin: -180, lonMax: 180 }, dates: ['2027-01-10'], missionDays: 14, stepMinutes: 120 } satisfies RawScenario;

configureMasks({ diskCache: false });

test('proyección: ida y vuelta lat/lon ↔ x/y, y el polo en el origen', () => {
  const [x, y] = llToXY(-85, 30);
  const [lat, lon] = xyToLL(x, y);
  assert.ok(Math.abs(lat + 85) < 1e-9 && Math.abs(lon - 30) < 1e-9);
  assert.ok(Math.hypot(...llToXY(-90, 77)) < 1e-6);
  // lon 0 -> +y; lon 90 E -> +x
  assert.ok(Math.abs(llToXY(-89, 0)[0]) < 1e-6 && llToXY(-89, 0)[1] > 0 && llToXY(-89, 90)[0] > 0);
});

test('bilinear: interpola entre centros de píxel y da NaN fuera', () => {
  const g = makeGrid({ res: 100, X0: 0, Y0: 200, w: 2, h: 2, a: Float32Array.from([0, 10, 20, 30]) });
  assert.equal(bilinear(g, 50, 150), 0);
  assert.equal(bilinear(g, 100, 150), 5);
  assert.equal(bilinear(g, 100, 100), 15);
  assert.ok(Number.isNaN(bilinear(g, 500, 100)));
});

test('llano: la máscara es la depresión geométrica del horizonte, −acos(R/(R+h))', () => {
  const g = synthetic(200, 60, () => 0);
  const [lat, lon] = xyToLL(5000, 3000);
  for (const h of [2, 100]) {
    const hz = computeHorizon(lat, lon, [{ g, maxD: 50000 }], { nAz: 72, observerHeightM: h, grow: 0 });
    for (const e of hz.el) assert.ok(Math.abs(e + dipDeg(h)) < 0.01, `h=${h}: ${e} vs ${-dipDeg(h)}`);
    assert.equal(hz.miss, 0);
  }
  assert.ok(Math.abs(dipDeg(100) - 0.6147) < 1e-3);
});

test('una montaña: ángulo esperado CON curvatura, en el azimut correcto (0 = norte, horario)', () => {
  const H = 2000, site: [number, number] = [0, 30000];
  const cases: [[number, number], number][] = [[[0, 50000], 0], [[20000, 30000], 90]];
  for (const [peak, azExpected] of cases) {
    const g = synthetic(100, 70, (x, y) => H * Math.exp(-((x - peak[0]) ** 2 + (y - peak[1]) ** 2) / (2 * 1500 ** 2)));
    const [lat, lon] = xyToLL(...site);
    const [plat, plon] = xyToLL(...peak);
    // exact angular distance observer-peak and apparent elevation over the sphere
    const c = Math.sin(lat * D2R) * Math.sin(plat * D2R) + Math.cos(lat * D2R) * Math.cos(plat * D2R) * Math.cos((plon - lon) * D2R);
    const delta = Math.acos(c);
    const expected = Math.atan(((R_M + H) * Math.cos(delta) - (R_M + 2)) / ((R_M + H) * Math.sin(delta))) / D2R;
    const flat = Math.atan(H / (delta * R_M)) / D2R; // what it would be without curvature
    const hz = computeHorizon(lat, lon, [{ g, maxD: 60000 }], { nAz: 720, observerHeightM: 2 });
    const kMax = hz.el.indexOf(Math.max(...hz.el));
    const az = kMax * 0.5;
    assert.ok(Math.min(Math.abs(az - azExpected), 360 - Math.abs(az - azExpected)) <= 1.5, `azimut del máximo ${az}, esperado ${azExpected}`);
    assert.ok(Math.abs(hz.el[kMax] - expected) < 0.03, `elevación ${hz.el[kMax]} vs ${expected}`);
    assert.ok(flat - hz.el[kMax] > 0.2, 'la curvatura debe bajar la cima respecto a tierra plana');
    // nothing in the opposite direction: horizon dip at 2 m
    assert.ok(Math.abs(hz.el[(kMax + 360) % 720] + dipDeg(2)) < 0.02);
  }
});

test('mallas anidadas y elección por cobertura: fina cerca, gruesa lejos; el modo rápido no usa la fina', () => {
  const bowl = (x: number, y: number): number => (Math.hypot(x, y) > 8000 ? 1500 : 0);
  const coarse = synthetic(240, 200, bowl, 'coarse'), fine = synthetic(20, 12, bowl, 'fine');
  const v = configureDem({ grids: [coarse, fine] });
  assert.match(v ?? '', /^lola-[0-9a-f]{12}$/);
  assert.equal(demVersion(), v);
  const precise = layersFor(-89.99, 0, 'precise')!, fast = layersFor(-89.99, 0, 'fast')!;
  assert.deepEqual(precise.layers.map((l) => l.g.name), ['fine', 'coarse']);
  assert.deepEqual(fast.layers.map((l) => l.g.name), ['coarse']);
  assert.equal(layersFor(-70, 0, 'precise'), null); // outside every grid
  const mp = buildMask(-89.99, 0, { resolution: 'precise' })!, mf = buildMask(-89.99, 0, { resolution: 'fast' })!;
  assert.equal(mp.el.length, 720); assert.equal(mf.el.length, 360);
  assert.equal(mp.demVersion, v); assert.equal(mp.observerHeightM, 2);
  assert.ok(mp.coverage > 0.9 && mp.coverage < 1); // precise mode looks up to 300 km and the grid ends at 200
  assert.equal(mf.coverage, 1);
  // 1500 m wall at ~8 km: about 10.5 deg; both modes agree within the coarse grid resolution
  const mean = (m: { el: number[] }): number => m.el.reduce((a, b) => a + b, 0) / m.el.length;
  assert.ok(Math.abs(mean(mp) - 10.5) < 0.6, `preciso ${mean(mp)}`);
  assert.ok(Math.abs(mean(mf) - mean(mp)) < 0.8, `rápido ${mean(mf)} vs preciso ${mean(mp)}`);
  assert.ok(mp.el.every((e) => Math.round(e * 100) / 100 === e), 'valores en centésimas de grado');
});

test('maskFor: caché en memoria y en disco, idéntica bit a bit a la recién calculada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terrain-'));
  try {
    configureDem({ grids: [synthetic(240, 200, (x, y) => 800 * Math.sin(x / 9000) * Math.cos(y / 7000))] });
    configureMasks({ diskCache: true, dir });
    const a = maskFor(-89.2, 40.1234567, 2, 'fast')!;
    assert.equal(terrainStatus().computed, 1);
    assert.equal(maskFor(-89.2, 40.1234567, 2, 'fast'), a); // memory
    assert.equal(terrainStatus().fromMemory, 1);
    configureMasks({}); // clears memory, keeps the disk
    const b = maskFor(-89.2, 40.1234567, 2, 'fast')!;
    assert.equal(terrainStatus().fromDisk, 1);
    assert.equal(terrainStatus().computed, 0);
    assert.deepEqual(Array.from(b.el), Array.from(a.el));
    assert.equal(b.heightM, a.heightM);
    assert.notDeepEqual(Array.from(maskFor(-89.2, 40.1234567, 10, 'fast')!.el), Array.from(a.el)); // another height, another mask
    assert.equal(horizonElevation(a, 0), a.el[0]);
  } finally {
    configureMasks({ diskCache: false, dir: null });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('evals con terrain: la máscara se aplica al centro y a TODOS los vecinos de robustez', () => {
  // 6 km radius bowl with 3000 m walls around (-89.5, 0): inside, neither the Sun nor the Earth is visible.
  const [cx, cy] = llToXY(-89.5, 0);
  configureDem({ grids: [synthetic(240, 150, (x, y) => (Math.hypot(x - cx, y - cy) > 6000 ? 3000 : 0))] });
  configureMasks({ diskCache: false });
  const flat = resolveScenario(SCEN);
  const withT = resolveScenario({ ...SCEN, terrain: { enabled: true }, robustness: { radiusKm: 1, directions: 8, rings: 1 } });
  assert.deepEqual(withT.terrain, { enabled: true, observerHeightM: 2, resolution: 'fast', demVersion: demVersion() });
  const samples = prepareSamples(flat), cell = { lat: -89.5, lon: 0 };
  const f = evaluateCandidate(cell, flat, samples);
  assert.ok(f.metrics.energy > 0.2 && !('horizon' in f));
  const cache = new Map();
  const r = evaluateRobust(cell, withT, samples, cache);
  assert.equal(cache.size, 9);
  for (const ev of cache.values()) {
    assert.equal(ev.horizon, 'mask');
    assert.equal(ev.metrics.energy, 0);
    assert.equal(ev.metrics.earthFraction, 0);
  }
  assert.equal(r.score, 0);
  assert.equal(terrainStatus().computed, 9);
  // the fingerprint changes with terrain and with the DEM version (product + window of each cached grid)
  const h1 = fingerprint(withT).scenarioHash;
  assert.notEqual(h1, fingerprint(flat).scenarioHash);
  configureDem({ grids: [synthetic(240, 120, () => 0)] });
  assert.notEqual(fingerprint(resolveScenario({ ...SCEN, terrain: { enabled: true }, robustness: { radiusKm: 1, directions: 8, rings: 1 } })).scenarioHash, h1);
});

test('sin terrain nada cambia: mismo escenario resuelto y mismas métricas aunque haya DEM', () => {
  configureDem({ grids: [synthetic(240, 150, () => 2500)] });
  const s = resolveScenario(SCEN);
  assert.ok(!('terrain' in s));
  assert.ok(!('terrain' in resolveScenario({ ...SCEN, terrain: { enabled: false } })));
  const withDem = evaluateCandidate({ lat: -89.5, lon: 0 }, s, prepareSamples(s));
  configureDem({ grids: [] });
  assert.deepEqual(evaluateCandidate({ lat: -89.5, lon: 0 }, s, prepareSamples(s)), withDem);
  const g = searchGrid({ latMin: -90, latMax: -89, lonMin: -180, lonMax: 180 }, { startMs: Date.parse('2027-01-10T00:00:00Z'), endMs: Date.parse('2027-01-12T00:00:00Z'), stepMs: 3600e3, mode: 'limb', spacingKm: 15, refine: 0, refineTop: 1, top: 3 });
  assert.ok(!('terrain' in g) && g.note.startsWith('Sin relieve') && !('horizon' in g.cells[0]));
});

test('sin DEM en caché: terrain no rompe nada, horizonte a 0° y aviso', () => {
  configureDem({ grids: [] });
  configureMasks({ diskCache: false });
  assert.equal(demVersion(), null);
  const warn = console.warn; const msgs: string[] = []; console.warn = (m: string) => msgs.push(m);
  try {
    assert.equal(maskFor(-89.5, 0), null);
    assert.equal(maskFor(-89.4, 0), null);
  } finally { console.warn = warn; }
  assert.equal(msgs.length, 1); // a single warning
  assert.match(msgs[0], /fetch-dem/);
  const flat = resolveScenario(SCEN), withT = resolveScenario({ ...SCEN, terrain: { enabled: true, observerHeightM: 10, resolution: 'precise' } });
  assert.equal(withT.terrain!.demVersion, null);
  const samples = prepareSamples(flat);
  const a = evaluateCandidate({ lat: -89.5, lon: 0 }, flat, samples), b = evaluateCandidate({ lat: -89.5, lon: 0 }, withT, samples);
  assert.equal(b.horizon, 'sphere');
  assert.deepEqual(b.metrics, a.metrics);
  assert.equal(b.score, a.score);
  assert.throws(() => resolveScenario({ ...SCEN, terrain: { enabled: true, resolution: 'ultra' } }), /resolution/);
  assert.throws(() => resolveScenario({ ...SCEN, terrain: { enabled: true, observerHeightM: -1 } }), /observerHeightM/);
});

test('catálogo: las máscaras precalculadas se cargan y las usa snapshot (horizon.type = mask)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terrain-'));
  try {
    fs.mkdirSync(path.join(dir, 'masks'));
    const mask = { id: 'shackleton-rim', lat: -89.45, lon: -137, heightM: 1954.5, observerHeightM: 2, stepDeg: 0.5, el: new Array(720).fill(3), source: 'test LOLA', demVersion: 'lola-test', resolution: 'precise', coverage: 1 };
    fs.writeFileSync(path.join(dir, 'masks', 'shackleton-rim.json'), JSON.stringify(mask));
    fs.writeFileSync(path.join(dir, 'masks', 'shackleton-rim.h10.json'), JSON.stringify({ ...mask, observerHeightM: 10, el: new Array(720).fill(1) }));
    fs.writeFileSync(path.join(dir, 'masks', 'broken.json'), '{not json');
    assert.equal(getMask('shackleton-rim'), null); // under node --test the real catalog is not loaded
    assert.equal(loadCatalogMasks(dir), 1);
    const snap = snapshot(getSite('shackleton-rim')!, Date.parse('2027-01-10T00:00:00Z'));
    assert.equal(snap.site.horizon.type, 'mask');
    assert.equal(snap.site.horizon.type === 'mask' && snap.site.horizon.demVersion, 'lola-test');
    assert.equal(snap.bodies.sun.horizonElevationDeg, 3);
    assert.equal(snapshot(getSite('apollo11')!, Date.parse('2027-01-10T00:00:00Z')).site.horizon.type, 'sphere');
    assert.equal(loadCatalogMasks(dir, 10), 1);
    assert.equal(getMask('shackleton-rim')!.el[0], 1);
  } finally {
    loadCatalogMasks(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(getMask('shackleton-rim'), null);
});

test('caso de uso search con terrain y observerHeightM; terrainStatus informa del estado', () => {
  const [cx, cy] = llToXY(-89.5, 0);
  configureDem({ grids: [synthetic(240, 150, (x, y) => (Math.hypot(x - cx, y - cy) > 6000 ? 3000 : 0))] });
  configureMasks({ diskCache: false });
  const startMs = Date.parse('2027-01-10T00:00:00Z');
  const q = (terrain?: TerrainRequest) => search({ region: { latMin: -89.6, latMax: -89.4, lonMin: -10, lonMax: 10 }, spacingKm: 3, refine: 0, startMs, days: 3, terrain }).grid;
  const flat = q(), t = q({ observerHeightM: 10 });
  assert.ok(!('terrain' in flat));
  assert.deepEqual(t.terrain, { enabled: true, observerHeightM: 10, resolution: 'fast', demVersion: demVersion() });
  assert.ok(t.cells.every((c) => c.horizon === 'mask'));
  assert.ok(t.cells.some((c) => c.metrics.energy === 0) && flat.cells.every((c) => c.metrics.energy > 0));
  assert.match(t.note, /relieve LOLA/);
  // fast mode at −89.5° with a DEM: the polar warning; the hybrid horizon is off in fast mode unless asked for
  assert.match(t.note, /modo rápido cerca del polo.*406 horas.*terrainResolution=precise/);
  assert.match(t.note, /sin rayo directo/);
  const tr = q({ observerHeightM: 10, refineDeg: 0.1 });
  assert.deepEqual(tr.terrain, { enabled: true, observerHeightM: 10, resolution: 'fast', demVersion: demVersion(), refineDeg: 0.1 });
  assert.match(tr.note, /rayo directo en el acimut exacto cuando el margen es menor que 0,1°/);
  assert.throws(() => q({ observerHeightM: 500 }), /observerHeightM/);
  assert.throws(() => q({ observerHeightM: 2, refineDeg: 3 }), /refineDeg/);
  const sites = rank({ sites: [getSite('shackleton-rim')!, getSite('apollo11')!], startMs, days: 3, terrain: { observerHeightM: 2 } }).ranking;
  assert.equal(sites.terrain!.resolution, 'precise');
  assert.doesNotMatch(sites.note, /modo rápido cerca del polo/);
  assert.match(sites.note, /horizonte híbrido/);
  assert.equal(sites.top.find((c) => c.id === 'apollo11')!.horizon, 'sphere');
  const st = terrainStatus();
  assert.equal(st.demVersion, demVersion()); assert.ok(st.computed > 0);
  configureDem({ grids: [] });
});
