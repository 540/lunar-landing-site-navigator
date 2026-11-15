// Terrain slope (src/terrain/slope.ts): synthetic planes with an exact slope, baseline clamped to the DEM, the
// maxSlopeDeg constraint in the evals, the API, and the reference points of the v3 review on the real DEM (if cached).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { configureDem, llToXY, makeGrid } from '../src/terrain/dem.ts';
import { configureLdrm, ldrmVersion } from '../src/terrain/ldrm.ts';
import { slopeAt, slopeSummary } from '../src/terrain/slope.ts';
import type { SlopeGrid } from '../src/terrain/ldrm.ts';
import { evaluateCandidate, evaluateRobust, prepareSamples, resolveScenario } from '../evals/lib.ts';
import { fingerprint } from '../evals/fingerprint.ts';
import { rankSites, searchGrid } from '../src/search.ts';
import { sweepLandingDates } from '../src/landingSweep.ts';
import { search, sunEarth, visibilityWindows } from '../src/useCases.ts';
import type { Grid, RawScenario, SlopeRequest } from '../src/types.ts';

const D2R = Math.PI / 180;
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Stereographic scale at a latitude (projected m per ground m). */
const k = (lat: number): number => 2 / (1 - Math.sin(lat * D2R));

/** Synthetic grid centred on the pole: ±halfKm, `res` m/px, height z(x, y) in metres (projected coordinates). */
function synthetic(res: number, halfKm: number, z: (x: number, y: number) => number, name: string = 'synth'): Grid {
  const n = Math.round((2 * halfKm * 1000) / res), a = new Float32Array(n * n);
  const X0 = -halfKm * 1000, Y0 = halfKm * 1000;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = z(X0 + (i + 0.5) * res, Y0 - (j + 0.5) * res);
  return makeGrid({ name, res, X0, Y0, w: n, h: n, a });
}

after(() => { configureDem({ dir: null }); configureLdrm({ dir: null }); });

/** Synthetic LDRM window centred on the pole (50 m/px, ±halfKm): slope in degrees v(x, y), NaN = no data. */
function ldrmSynthetic(baselineM: number, halfKm: number, v: (x: number, y: number) => number): SlopeGrid {
  const res = 50, n = Math.round((2 * halfKm * 1000) / res), a = new Float32Array(n * n);
  const X0 = -304000, Y0 = 304000, c0 = Math.round((-halfKm * 1000 - X0) / res), r0 = Math.round((Y0 - halfKm * 1000) / res);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = v(X0 + (c0 + i + 0.5) * res, Y0 - (r0 + j + 0.5) * res);
  return { name: `ldrm${baselineM}`, product: `LDRM_80S_50MPP_ADJ_SLP_${baselineM}M`, baselineM, res, X0, Y0, c0, r0, w: n, h: n, a };
}

test('plano sintético: la pendiente es la del plano, en el suelo (sin la escala de la proyección)', () => {
  for (const deg of [0, 3, 10, 25]) {
    const t = Math.tan(deg * D2R);
    // Plane tilted along a diagonal of the map: the slope must not depend on the orientation.
    configureDem({ grids: [synthetic(20, 40, (x, y) => (t * (0.6 * x + 0.8 * y)) / k(-89))] });
    for (const [lat, lon] of [[-89, 0], [-89, 135], [-89.3, -60]]) {
      const s = slopeAt(lat, lon)!;
      // Ground gradient = projected gradient × k(lat): exact for lat −89, slightly different elsewhere.
      const expected = Math.atan(t * k(lat) / k(-89)) / D2R;
      assert.ok(Math.abs(s.slopeDeg - expected) < 1e-3, `${deg}° en (${lat}, ${lon}): ${s.slopeDeg}`);
      assert.ok(s.roughnessM! < 1e-3, 'un plano no tiene rugosidad');
      assert.equal(s.slopeBaselineM, 100);
      assert.equal(s.demResolutionM, 20);
      assert.equal(s.underestimated, false);
    }
  }
});

test('base: por debajo de 3 píxeles usa la mínima y avisa; rugosidad con relieve no plano', () => {
  const lat = -88, [x0] = llToXY(lat, 0);
  configureDem({ grids: [synthetic(240, 120, (x, y) => 0.1 * x + 30 * Math.sin((x - x0) / 150) * Math.cos(y / 170))] });
  const short = slopeAt(lat, 0)!, long = slopeAt(lat, 0, { baselineM: 2000 })!;
  assert.equal(short.underestimated, true);
  assert.equal(short.requestedBaselineM, 100);
  assert.ok(Math.abs(short.slopeBaselineM - (3 * 240) / k(lat)) < 1e-6, `base mínima = 3 píxeles en el suelo: ${short.slopeBaselineM}`);
  assert.equal(long.underestimated, false);
  assert.equal(long.slopeBaselineM, 2000);
  assert.ok(long.roughnessM! > 1, `rugosidad ${long.roughnessM}`);
  // Underestimated = uncertified: meetsMaxSlope is null with the reason, never true (nor false), whatever the value.
  for (const max of [0, 1, 89]) {
    const sum = slopeSummary(lat, 0, { maxSlopeDeg: max });
    assert.equal(sum.meetsMaxSlope, null);
    assert.equal(sum.source, 'dem-240m');
    assert.match(sum.meetsMaxSlopeReason!, /^sin certificar: la base real es de 7\d\d m \(se pidieron 100 m\)/);
  }
  // Certified (the DEM resolves the baseline): true/false, no reason.
  const ok = slopeSummary(lat, 0, { baselineM: 2000, maxSlopeDeg: 89 });
  assert.equal(ok.meetsMaxSlope, true);
  assert.ok(!('meetsMaxSlopeReason' in ok));
  assert.throws(() => slopeAt(lat, 0, { baselineM: 0 }), /slopeBaselineM debe ser un número entre/);
});

test('elige la rejilla más fina que contiene la base; sin DEM, null', () => {
  const coarse = synthetic(240, 150, (x) => 0.05 * x, 'coarse');
  const fine = synthetic(20, 10, (x) => 0.05 * x, 'fine');
  configureDem({ grids: [coarse, fine] });
  assert.equal(slopeAt(-89.99, 0)!.demResolutionM, 20); // ~300 m from the pole: inside the fine window
  assert.equal(slopeAt(-89.5, 0)!.demResolutionM, 240); // ~15 km: only the coarse grid
  assert.equal(slopeAt(-80, 0), null); // outside every grid
  configureDem({ grids: [] });
  assert.equal(slopeAt(-89.5, 0), null);
  assert.deepEqual(slopeSummary(-89.5, 0), { slopeDeg: null, slopeBaselineM: null, requestedBaselineM: 100, demResolutionM: null, underestimated: false, roughnessM: null, source: null });
  assert.deepEqual(slopeSummary(-89.5, 0, { maxSlopeDeg: 10 }), {
    slopeDeg: null, slopeBaselineM: null, requestedBaselineM: 100, demResolutionM: null, underestimated: false, roughnessM: null, source: null,
    meetsMaxSlope: false, meetsMaxSlopeReason: 'sin pendiente: el punto queda fuera del DEM LOLA en caché',
  });
});

test('rendimiento: mucho más rápida que una máscara (< 0,2 ms por punto)', () => {
  configureDem({ grids: [synthetic(20, 40, (x, y) => 0.1 * x + 0.05 * y)] });
  slopeAt(-89.5, 0);
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) slopeAt(-89.5 + i * 1e-4, i * 0.1);
  const ms = (performance.now() - t0) / 2000;
  assert.ok(ms < 0.2, `${ms.toFixed(3)} ms por punto`);
});

// Hill (cone) centred at (−89.5, 0): flat outside 3 km, 20° flanks inside. (−89.45, 0) is on the flank, 1.5 km from the top.
function hill(): Grid {
  const [cx, cy] = llToXY(-89.5, 0);
  return synthetic(20, 40, (x, y) => Math.max(0, 3000 - Math.hypot(x - cx, y - cy)) * Math.tan(20 * D2R));
}
const SCEN = { name: 't', points: [{ lat: -89.45, lon: 0 }, { lat: -89.3, lon: 0 }], dates: ['2027-01-10'], missionDays: 3, stepMinutes: 120 } satisfies RawScenario;

test('evals: maxSlopeDeg activa la pendiente (100 m) y descarta laderas; sin ella el escenario no cambia', () => {
  configureDem({ grids: [hill()] });
  const plain = resolveScenario(SCEN);
  assert.ok(!('slope' in plain), 'sin pendiente el escenario resuelto no tiene slope (scenarioHash igual)');
  const s = resolveScenario({ ...SCEN, constraints: { maxSlopeDeg: 10 } });
  assert.deepEqual(s.slope, { baselineM: 100, demVersion: s.slope!.demVersion });
  assert.notEqual(fingerprint(s).scenarioHash, fingerprint(plain).scenarioHash);
  const samples = prepareSamples(s);
  const onHill = evaluateCandidate({ lat: -89.45, lon: 0 }, s, samples), flat = evaluateCandidate({ lat: -89.3, lon: 0 }, s, samples);
  assert.ok(Math.abs(onHill.metrics.slopeDeg! - 20) < 0.1, `ladera: ${onHill.metrics.slopeDeg}`);
  assert.equal(onHill.feasible, false);
  assert.match(onHill.violations[0], /^slopeDeg=20/);
  assert.equal(flat.feasible, true);
  assert.equal(flat.metrics.slopeDeg, 0);
  assert.equal(flat.slope!.demResolutionM, 20);
  // Same metrics and score as without the slope (it is a constraint, not a score variable).
  const noSlope = evaluateCandidate({ lat: -89.3, lon: 0 }, plain, samples);
  assert.equal(flat.score, noSlope.score);
  assert.deepEqual({ ...flat.metrics, slopeDeg: undefined }, { ...noSlope.metrics, slopeDeg: undefined });
  // Robustness: a flat centre with a neighbour on the hill is not feasible.
  const robust = resolveScenario({ ...SCEN, constraints: { maxSlopeDeg: 10 }, robustness: { radiusKm: 1, directions: 8, rings: 2 } });
  // A point 3.5 km from the hill top: flat, but its 1 km ring reaches the flank.
  const r = evaluateRobust({ lat: -89.5 + 3.5 / 30.32, lon: 0 }, robust, samples);
  assert.equal(r.robustness!.points, 17);
  assert.equal(r.feasible, false);
  // slope.baselineM given without the constraint: metric only.
  const only = resolveScenario({ ...SCEN, slope: { baselineM: 200 } });
  assert.equal(only.slope!.baselineM, 200);
  assert.equal(evaluateCandidate({ lat: -89.45, lon: 0 }, only, samples).feasible, true);
  assert.throws(() => resolveScenario({ ...SCEN, slope: { baselineM: -5 } }), /slopeBaselineM/);
});

test('búsqueda y ranking: maxSlopeDeg saca las laderas del top; sin pendiente la respuesta no cambia', () => {
  configureDem({ grids: [hill()] });
  const o = { startMs: Date.parse('2027-01-10T00:00:00Z'), endMs: Date.parse('2027-01-13T00:00:00Z'), stepMs: 3 * 3600e3, mode: 'limb' as const };
  const region = { latMin: -89.62, latMax: -89.38, lonMin: -30, lonMax: 30 };
  const grid = { ...o, spacingKm: 1, refine: 0, refineTop: 3, top: 1000, minSepKm: 0 };
  const plain = searchGrid(region, grid), filtered = searchGrid(region, { ...grid, slope: { maxSlopeDeg: 10 } });
  assert.ok(!('slope' in plain) && plain.cells.every((c) => !('slope' in c)));
  assert.ok(plain.top.some((c) => Math.abs(slopeAt(c.lat, c.lon)!.slopeDeg - 20) < 0.5), 'sin filtro hay laderas en el top');
  assert.ok(filtered.top.length > 0 && filtered.top.every((c) => c.slope!.slopeDeg! <= 10));
  assert.ok(filtered.slope!.excluded! > 0);
  assert.equal(filtered.top.length, plain.top.length - filtered.slope!.excluded!);
  assert.equal(filtered.cells.length, plain.cells.length);
  const { timingMs: _a, ...p } = plain, { timingMs: _b, slope: _s, ...f } = filtered;
  assert.deepEqual(f.cells.map(({ slope, ...c }) => c), p.cells, 'mismas métricas y puntuaciones');
  const ranked = rankSites([{ lat: -89.45, lon: 0, id: 'ladera', name: 'Ladera' }, { lat: -89.3, lon: 0, id: 'llano', name: 'Llano' }], { ...o, slope: { maxSlopeDeg: 10 } });
  assert.deepEqual(ranked.top.map((c) => c.id), ['llano']);
  assert.deepEqual(ranked.slope!.excludedSites, ['ladera']);
  assert.equal(ranked.evaluated, 2);
});

test('barrido de fechas: maxSlopeDeg es una restricción del sitio (igual en todas las fechas)', () => {
  configureDem({ grids: [hill()] });
  const o = { startMs: Date.parse('2027-01-10T00:00:00Z'), endMs: Date.parse('2027-01-12T00:00:00Z'), dateStepMs: 86400e3, missionDays: 2, stepMs: 3600e3, mode: 'limb' as const };
  const steep = sweepLandingDates({ lat: -89.45, lon: 0 }, { ...o, constraints: { maxSlopeDeg: 10 } });
  assert.ok(steep.dates.every((d) => d.feasible === false));
  assert.equal(steep.slope!.meetsMaxSlope, false);
  assert.equal(steep.slope!.slopeBaselineM, 100);
  const plain = sweepLandingDates({ lat: -89.45, lon: 0 }, o);
  assert.ok(!('slope' in plain));
  assert.deepEqual(steep.dates.map((d) => d.metrics), plain.dates.map((d) => d.metrics));
});

test('casos de uso search, sunEarth y visibilityWindows: pendiente a petición y sin cambios sin ella', () => {
  configureDem({ grids: [hill()] });
  const startMs = Date.parse('2027-01-10T00:00:00Z');
  const run = (slope?: SlopeRequest) => search({ region: { latMin: -89.62, latMax: -89.38, lonMin: -30, lonMax: 30 }, spacingKm: 1, refine: 0, startMs, days: 2, minSepKm: 0, ...(slope ? { slope } : {}) }).grid;
  const plain = run(), f = run({ baselineM: 60, maxSlopeDeg: 10 });
  assert.ok(!('slope' in plain));
  assert.equal(f.slope!.baselineM, 60);
  assert.ok(f.top.length > 0 && f.top.every((c) => c.slope!.slopeDeg! <= 10 && c.slope!.meetsMaxSlope === true));
  assert.ok(f.slope!.excluded! > 0);
  assert.match(f.slope!.note, /Artemis III/);
  const at = (lat: number) => ({ id: `custom:${lat},0`, name: 'p', lat, lon: 0, custom: true });
  const snap = sunEarth({ site: at(-89.45), dateMs: startMs, slope: { baselineM: 100 } });
  assert.ok(Math.abs(snap.slope!.slopeDeg! - 20) < 0.1);
  assert.equal(sunEarth({ site: at(-89.45), dateMs: startMs }).slope, null);
  const win = visibilityWindows({ site: at(-89.3), startMs, endMs: startMs + 86400e3, slope: { baselineM: 100 } });
  assert.equal(win.slope!.slopeDeg, 0);
});

// Reference points of the v3 review (240 m DEM, central differences over ±1 pixel): 13.5°, 27.6° and 3.8°.
const REAL = path.join(HERE, '..', 'terrain');
const hasRealDem = fs.existsSync(path.join(REAL, 'cache')) && fs.readdirSync(path.join(REAL, 'cache')).some((f) => f.startsWith('LDEM_60S_240MPP'));
test('DEM LOLA real: pendientes de los puntos de referencia del benchmark v3', { skip: hasRealDem ? false : 'sin DEM LOLA en backend/terrain/cache' }, () => {
  configureDem({ dir: REAL });
  for (const [lat, lon, expected] of [[-65.31485, -3.05572, 13.5], [-72.4792, -5.64746, 27.6], [-60.75, -7.2881, 3.8]]) {
    const s = slopeAt(lat, lon, { baselineM: 240 })!;
    assert.equal(s.demResolutionM, 240);
    assert.equal(s.underestimated, true, 'el DEM de 240 m no resuelve 240 m: base mínima ~690 m');
    assert.ok(Math.abs(s.slopeDeg - expected) < 0.5, `(${lat}, ${lon}): ${s.slopeDeg.toFixed(2)}° frente a ${expected}°`);
  }
  // The v3 winner does not meet Artemis III (< 10° over 100 m): the filter discards it.
  const v3 = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'evals', 'scenarios', 'reto-polo-sur-v3.json'), 'utf8')) as RawScenario;
  const s = resolveScenario({ ...v3, terrain: null, constraints: { ...v3.constraints, maxSlopeDeg: 10 } });
  const samples = prepareSamples({ ...s, dates: s.dates.slice(0, 1), dateMs: s.dateMs.slice(0, 1) });
  const winner = evaluateCandidate({ lat: -65.31485, lon: -3.05572 }, { ...s, dates: s.dates.slice(0, 1), dateMs: s.dateMs.slice(0, 1) }, samples);
  assert.equal(winner.feasible, false);
  assert.ok(winner.violations.some((v) => v.startsWith('slopeDeg=13.')), winner.violations.join('; '));
  // The flat one (3.8° over ~690 m with the 240 m DEM) is uncertified: it does not meet maxSlopeDeg either (since 1.12.0).
  const flat = evaluateCandidate({ lat: -60.75, lon: -7.2881 }, { ...s, dates: s.dates.slice(0, 1), dateMs: s.dateMs.slice(0, 1) }, samples);
  assert.equal(flat.feasible, false);
  assert.ok(flat.violations.some((v) => /^slopeDeg=3\.\d+ \(<= 10\) sin certificar: la base real es de 6\d\d m/.test(v)), flat.violations.join('; '));
});


test('LDRM de PGDA: base 100/400/800 m con producto en caché; si no, el DEM; la fuente lo dice', () => {
  // Coarse DEM (240 m): alone, every 100 m slope would be underestimated (uncertified).
  configureDem({ grids: [synthetic(240, 150, (x) => 0.05 * x, 'coarse')] });
  // LDRM 100 m only within ±20 km of the pole, with a hole (NaN) for x > 15 km.
  configureLdrm({ grids: [ldrmSynthetic(100, 20, (x) => (x > 15000 ? NaN : 7.25))] });
  const lat = -89.5, lon = 0; // ~15 km from the pole along +y: x = 0
  const pgda = slopeAt(lat, lon)!;
  assert.equal(pgda.source, 'pgda-ldrm-100m');
  assert.equal(pgda.slopeDeg, 7.25);
  assert.equal(pgda.slopeBaselineM, 100);
  assert.equal(pgda.underestimated, false);
  assert.equal(pgda.demResolutionM, 50);
  assert.equal(pgda.roughnessM, null, 'el DEM de 240 m no resuelve 100 m: sin rugosidad');
  assert.equal(pgda.product, 'LDRM_80S_50MPP_ADJ_SLP_100M@50m');
  // Certified: true or false against maxSlopeDeg, no reason.
  assert.equal(slopeSummary(lat, lon, { maxSlopeDeg: 10 }).meetsMaxSlope, true);
  assert.equal(slopeSummary(lat, lon, { maxSlopeDeg: 5 }).meetsMaxSlope, false);
  // Another baseline (no product), ldrm: false, or a point in the hole: the DEM fit, underestimated.
  for (const r of [slopeAt(lat, lon, { baselineM: 200 })!, slopeAt(lat, lon, { ldrm: false })!, slopeAt(-89.5, 90)!]) {
    assert.equal(r.source, 'dem-240m');
    assert.equal(r.underestimated, true);
  }
  assert.equal(slopeSummary(-89.5, 90, { maxSlopeDeg: 10 }).meetsMaxSlope, null);
  // LDRM without DEM: still the official value.
  configureDem({ grids: [] });
  assert.equal(slopeAt(lat, lon)!.source, 'pgda-ldrm-100m');
  configureLdrm({ grids: [] });
  assert.equal(slopeAt(lat, lon), null);
});

test('LDRM en disco: se lee píxel a píxel de backend/terrain/cache/ldrm (sin cargarlo en memoria)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldrm-'));
  try {
    const g = ldrmSynthetic(800, 5, (x, y) => 1 + ((Math.floor((x + 304000) / 50) + Math.floor((304000 - y) / 50)) % 7));
    fs.mkdirSync(path.join(dir, 'cache', 'ldrm'), { recursive: true });
    const name = `${g.product}_c${g.c0}_r${g.r0}_${g.w}x${g.h}`;
    fs.writeFileSync(path.join(dir, 'cache', 'ldrm', `${name}.f32`), Buffer.from(g.a!.buffer));
    fs.writeFileSync(path.join(dir, 'cache', 'ldrm', `${name}.json`), JSON.stringify({ product: g.product, baselineM: 800, res: 50, X0: g.X0, Y0: g.Y0, c0: g.c0, r0: g.r0, w: g.w, h: g.h }));
    fs.writeFileSync(path.join(dir, 'cache', 'ldrm', 'roto.json'), '{'); // unreadable metadata: skipped
    configureDem({ grids: [] });
    assert.match(configureLdrm({ dir })!, /^ldrm-[0-9a-f]{12}$/);
    configureDem({ dir }); // the slope grids in cache/ldrm are never read as heights
    assert.equal(slopeAt(-89.98, 30, { baselineM: 100 }), null);
    for (const [lat, lon] of [[-89.98, 30], [-89.95, -100], [-89.9, 10]]) {
      const [x, y] = llToXY(lat, lon);
      const k = Math.floor((y > 0 ? 304000 - y : 304000 - y) / 50) - g.r0, i = Math.floor((x + 304000) / 50) - g.c0;
      assert.equal(slopeAt(lat, lon, { baselineM: 800 })!.slopeDeg, g.a![k * g.w + i], `(${lat}, ${lon})`);
    }
  } finally {
    configureLdrm({ grids: [] });
    configureDem({ grids: [] });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(ldrmVersion(), null);
});

test('sin certificar: ranking, búsqueda, evals y barrido no la dan por apta; slopeUncertified=keep la mantiene', () => {
  // Coarse DEM only: every 100 m slope is underestimated (base ~480 m at 160 m/px near the pole).
  configureDem({ grids: [synthetic(160, 150, () => 0, 'flat160')] });
  configureLdrm({ grids: [] });
  const o = { startMs: Date.parse('2027-01-10T00:00:00Z'), endMs: Date.parse('2027-01-11T00:00:00Z'), stepMs: 3 * 3600e3, mode: 'limb' as const };
  const sites = [{ lat: -89.45, lon: 0, id: 'a', name: 'A' }, { lat: -89.3, lon: 0, id: 'b', name: 'B' }];
  const ex = rankSites(sites, { ...o, slope: { maxSlopeDeg: 10 } });
  assert.deepEqual(ex.top, [], 'llano según un DEM de 160 m, pero sin certificar: fuera');
  assert.deepEqual(ex.slope!.excludedSites, ['a', 'b']);
  assert.equal(ex.slope!.uncertified, 'exclude');
  assert.equal(ex.slope!.uncertifiedCount, 2);
  const keep = rankSites(sites, { ...o, slope: { maxSlopeDeg: 10, uncertified: 'keep' } });
  assert.deepEqual(keep.top.map((c) => c.id).sort(), ['a', 'b']);
  assert.ok(keep.top.every((c) => c.slope!.meetsMaxSlope === null && /^sin certificar/.test(c.slope!.meetsMaxSlopeReason!)));
  assert.deepEqual(keep.slope!.excludedSites, []);
  assert.throws(() => rankSites(sites, { ...o, slope: { maxSlopeDeg: 10, uncertified: 'tal vez' as 'keep' } }), /slopeUncertified debe ser exclude o keep/);
  // Grid search: the same.
  const region = { latMin: -89.6, latMax: -89.3, lonMin: -20, lonMax: 20 };
  const grid = { ...o, spacingKm: 3, refine: 0, refineTop: 3, top: 1000, minSepKm: 0 };
  const sEx = searchGrid(region, { ...grid, slope: { maxSlopeDeg: 10 } }), sKeep = searchGrid(region, { ...grid, slope: { maxSlopeDeg: 10, uncertified: 'keep' } });
  assert.equal(sEx.top.length, 0);
  assert.equal(sEx.slope!.excluded, sEx.cells.length);
  assert.equal(sKeep.top.length, sKeep.cells.length);
  assert.equal(sKeep.slope!.uncertifiedCount, sKeep.cells.length);
  // Evals: a constraint violation that says why.
  const s = resolveScenario({ ...SCEN, constraints: { maxSlopeDeg: 10 } });
  const e = evaluateCandidate({ lat: -89.3, lon: 0 }, s, prepareSamples(s));
  assert.equal(e.feasible, false);
  assert.match(e.violations[0], /^slopeDeg=0 \(<= 10\) sin certificar: la base real es de 4\d\d m \(se pidieron 100 m\)/);
  // Landing-date sweep: no date is feasible.
  const sw = sweepLandingDates({ lat: -89.3, lon: 0 }, { ...o, endMs: o.startMs + 86400e3, dateStepMs: 86400e3, missionDays: 1, stepMs: 3600e3, constraints: { maxSlopeDeg: 10 } });
  assert.ok(sw.dates.every((d) => d.feasible === false));
  assert.equal(sw.slope!.meetsMaxSlope, null);
  // Search use case: slopeUncertified=keep keeps them.
  const q = (uncertified?: 'keep') => search({ region, spacingKm: 3, refine: 0, startMs: o.startMs, days: 1, minSepKm: 0, slope: { baselineM: 100, maxSlopeDeg: 10, ...(uncertified ? { uncertified } : {}) } }).grid;
  assert.equal(q().top.length, 0);
  assert.ok(q('keep').top.length > 0);
});
