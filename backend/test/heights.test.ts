// Panel and antenna heights apart (terrain.panelHeightM for the Sun, terrain.antennaHeightM for the Earth): defaults,
// validation, scenarioHash, the engine (evaluateCell, sweep) and the search and landing-dates use cases. Synthetic DEM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureDem, demVersion, llToXY, makeGrid } from '../src/terrain/dem.ts';
import { chooseMasks, configureMasks, resolveTerrain, terrainStatus } from '../src/horizon.ts';
import { cellMasks, evaluateCell, normalizeWeights } from '../src/search.ts';
import { sampleVectors, snapshot, windows } from '../src/service.ts';
import { sweepLandingDates } from '../src/landingSweep.ts';
import { resolveScenario } from '../evals/lib.ts';
import { fingerprint } from '../evals/fingerprint.ts';
import { landingDates, search } from '../src/useCases.ts';
import type { CellResult, EvaluateOptions, Grid, GridSearch, LandingSweep, RawScenario, TerrainOption } from '../src/types.ts';

const DAY = 86400e3;
const SITE = { lat: -89.5, lon: 0 };
const START = Date.parse('2027-01-10T00:00:00Z');

/**
 * Flat floor with a 30 m step 1 km away from SITE: the near horizon is ~1.6° at 2 m and ~1.1° at 10 m, so both the Sun
 * (elevation ≲ 1.6° at 89.5° S) and the Earth change with the height.
 */
function stepDem(): Grid {
  const [cx, cy] = llToXY(SITE.lat, SITE.lon);
  const res = 60, half = 20000, n = Math.round((2 * half) / res), a = new Float32Array(n * n);
  const X0 = cx - half, Y0 = cy + half;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    a[j * n + i] = Math.hypot(X0 + (i + 0.5) * res - cx, Y0 - (j + 0.5) * res - cy) > 1000 ? 30 : 0;
  }
  return makeGrid({ name: 'step', res, X0, Y0, w: n, h: n, a });
}

configureDem({ grids: [stepDem()] });
configureMasks({ diskCache: false });

const sampled = sampleVectors(START, START + 28 * DAY, 3600e3);
const evalWith = (terrain: TerrainOption, extra: Partial<EvaluateOptions> = {}): CellResult => evaluateCell(SITE, sampled, {
  mode: 'limb', stepMs: 3600e3, weights: normalizeWeights({}), terrain: resolveTerrain({ enabled: true, resolution: 'precise', ...terrain }), ...extra,
});
const SUN_KEYS = ['energy', 'sunFraction', 'longestNightH', 'sunElevationRangeDeg'] as const;
const EARTH_KEYS = ['earthFraction', 'longestNoEarthH'] as const;
const pick = (m: CellResult['metrics'], keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, m[k as keyof typeof m]]));

test('resolveTerrain: sin alturas, o iguales a observerHeightM, el objeto es el de siempre; distintas, lleva las dos', () => {
  const base = { enabled: true, demVersion: demVersion() };
  assert.deepEqual(resolveTerrain({ enabled: true }), { ...base, observerHeightM: 2, resolution: 'fast' });
  assert.deepEqual(resolveTerrain({ enabled: true, observerHeightM: 10, panelHeightM: 10, antennaHeightM: 10 }), { ...base, observerHeightM: 10, resolution: 'fast' });
  assert.deepEqual(resolveTerrain({ enabled: true, panelHeightM: 10 }), { ...base, observerHeightM: 2, panelHeightM: 10, antennaHeightM: 2, resolution: 'fast' });
  assert.deepEqual(resolveTerrain({ enabled: true, observerHeightM: 4, antennaHeightM: 10 }), { ...base, observerHeightM: 4, panelHeightM: 4, antennaHeightM: 10, resolution: 'fast' });
  assert.equal(resolveTerrain({ enabled: false, panelHeightM: 500 }), null); // without terrain they are ignored
  assert.throws(() => resolveTerrain({ enabled: true, panelHeightM: 101 }), /terrain\.panelHeightM debe estar entre 0 y 100 m/);
  assert.throws(() => resolveTerrain({ enabled: true, antennaHeightM: -1 }), /terrain\.antennaHeightM debe estar entre 0 y 100 m/);
  assert.throws(() => resolveTerrain({ enabled: true, antennaHeightM: Number.NaN }), /antennaHeightM/);
});

test('evals: las alturas solo entran en el escenario (y en scenarioHash) si difieren de observerHeightM', () => {
  const SCEN = { name: 't', region: { latMin: -90, latMax: -88, lonMin: -180, lonMax: 180 }, dates: ['2027-01-10'], missionDays: 14, stepMinutes: 120 } satisfies RawScenario;
  const hash = (terrain: TerrainOption): string => fingerprint(resolveScenario({ ...SCEN, terrain })).scenarioHash;
  const h2 = hash({ enabled: true });
  assert.equal(hash({ enabled: true, observerHeightM: 2, panelHeightM: 2, antennaHeightM: 2 }), h2);
  assert.equal(hash({ enabled: true, panelHeightM: 2 }), h2);
  assert.notEqual(hash({ enabled: true, panelHeightM: 10 }), h2);
  assert.notEqual(hash({ enabled: true, panelHeightM: 10 }), hash({ enabled: true, antennaHeightM: 10 }));
  assert.deepEqual(resolveScenario({ ...SCEN, terrain: { enabled: true, panelHeightM: 10 } }).terrain,
    { enabled: true, observerHeightM: 2, panelHeightM: 10, antennaHeightM: 2, resolution: 'fast', demVersion: demVersion() });
  assert.throws(() => resolveScenario({ ...SCEN, terrain: { enabled: true, panelHeightM: 200 } }), /panelHeightM/);
});

test('evaluateCell: panel a 10 m y antena a 2 m = Sol de «todo a 10 m» y Tierra de «todo a 2 m»', () => {
  const opts = { fullNight: true, battery: { survivalLoadW: 100, whPerKg: 200, depthOfDischarge: 0.9 } };
  const all2 = evalWith({ observerHeightM: 2 }, opts), all10 = evalWith({ observerHeightM: 10 }, opts);
  const split = evalWith({ panelHeightM: 10, antennaHeightM: 2 }, opts);
  // the height matters here: otherwise the test would prove nothing
  assert.notEqual(all10.metrics.energy, all2.metrics.energy);
  assert.notEqual(all10.metrics.earthFraction, all2.metrics.earthFraction);
  assert.deepEqual(pick(split.metrics, [...SUN_KEYS, 'longestNightFullH', 'batteryKWh', 'batteryKg']), pick(all10.metrics, [...SUN_KEYS, 'longestNightFullH', 'batteryKWh', 'batteryKg']));
  assert.deepEqual(pick(split.metrics, EARTH_KEYS), pick(all2.metrics, EARTH_KEYS));
  assert.ok(split.metrics.bothFraction <= Math.min(split.metrics.sunFraction, split.metrics.earthFraction));
  // and the reverse
  const rev = evalWith({ panelHeightM: 2, antennaHeightM: 10 });
  assert.deepEqual(pick(rev.metrics, SUN_KEYS), pick(evalWith({ observerHeightM: 2 }).metrics, SUN_KEYS));
  assert.deepEqual(pick(rev.metrics, EARTH_KEYS), pick(evalWith({ observerHeightM: 10 }).metrics, EARTH_KEYS));
  // with the two heights equal to observerHeightM, the result is identical (bit for bit)
  assert.deepEqual(evalWith({ observerHeightM: 10, panelHeightM: 10, antennaHeightM: 10 }, opts), all10);
});

test('con las dos alturas iguales se calcula una sola máscara (el mismo objeto para el Sol y la Tierra)', () => {
  configureMasks({ diskCache: false });
  const same = cellMasks(SITE, resolveTerrain({ enabled: true, observerHeightM: 7, resolution: 'precise' }));
  assert.ok(same.sun && same.sun === same.earth);
  assert.equal(terrainStatus().computed, 1);
  const split = cellMasks(SITE, resolveTerrain({ enabled: true, observerHeightM: 7, antennaHeightM: 3, resolution: 'precise' }));
  assert.equal(split.sun, same.sun); // panel mask from the LRU cache
  assert.notEqual(split.earth, split.sun);
  assert.equal(split.earth!.observerHeightM, 3);
  assert.equal(terrainStatus().computed, 2);
  const chosen = chooseMasks(SITE, { terrain: true, panelHeightM: 5, antennaHeightM: 5, resolution: 'precise' });
  assert.equal(chosen.sun, chosen.earth);
  assert.equal(chooseMasks(SITE).sun.mask, null); // without terrain, sphere
});

test('service: snapshot y windows con earthMask usan la máscara de la antena solo para la Tierra', () => {
  const t = (h: number) => cellMasks(SITE, resolveTerrain({ enabled: true, observerHeightM: h, resolution: 'precise' })).sun;
  const site = { id: 'custom:test', name: 'test', ...SITE, custom: true as const };
  const m2 = t(2), m10 = t(10);
  const w = (sun: typeof m2, earth: typeof m2) => windows(site, START, START + 14 * DAY, { mask: sun, earthMask: earth, night: { fullNight: true } });
  const split = w(m10, m2), all10 = w(m10, m10), all2 = w(m2, m2);
  assert.deepEqual(split.sun, all10.sun);
  assert.deepEqual(split.night, all10.night);
  assert.deepEqual(split.earth, all2.earth);
  assert.notDeepEqual(all10.sun, all2.sun);
  assert.deepEqual(windows(site, START, START + 14 * DAY, { mask: m10, night: { fullNight: true } }), all10); // without earthMask, as before
  const s = snapshot(site, START + 3 * DAY, { mask: m10, earthMask: m2 });
  assert.deepEqual(s.bodies.sun, snapshot(site, START + 3 * DAY, { mask: m10 }).bodies.sun);
  assert.deepEqual(s.bodies.earth, snapshot(site, START + 3 * DAY, { mask: m2 }).bodies.earth);
});

test('barrido de fechas: Sol con la altura del panel y Tierra con la de la antena', () => {
  const sweep = (terrain: TerrainOption): LandingSweep => sweepLandingDates(SITE, {
    startMs: START, endMs: START + 10 * DAY, dateStepMs: DAY, missionDays: 6, stepMs: 3600e3, mode: 'limb', terrain: { enabled: true, ...terrain },
  });
  const all2 = sweep({ observerHeightM: 2 }), all10 = sweep({ observerHeightM: 10 }), split = sweep({ panelHeightM: 10, antennaHeightM: 2 });
  assert.deepEqual(split.terrain, { enabled: true, observerHeightM: 2, panelHeightM: 10, antennaHeightM: 2, resolution: 'precise', demVersion: demVersion() });
  assert.match(split.note, /panel a 10 m \(Sol\) y antena a 2 m \(Tierra\)/);
  split.dates.forEach((d, i) => {
    assert.deepEqual(pick(d.metrics, SUN_KEYS), pick(all10.dates[i].metrics, SUN_KEYS), d.date);
    assert.deepEqual(pick(d.metrics, EARTH_KEYS), pick(all2.dates[i].metrics, EARTH_KEYS), d.date);
    assert.deepEqual(d.sun, all10.dates[i].sun);
  });
  const noTiming = (r: LandingSweep) => ({ ...r, timingMs: null });
  assert.deepEqual(noTiming(sweep({ observerHeightM: 2, panelHeightM: 2, antennaHeightM: 2 })), noTiming(all2));
});

test('casos de uso: search y landingDates aceptan panelHeightM y antennaHeightM, y los validan', () => {
  const REGION = { latMin: -89.52, latMax: -89.48, lonMin: -1, lonMax: 1 };
  const run = (heights: { panelHeightM?: number; antennaHeightM?: number } = {}): GridSearch =>
    search({ region: REGION, spacingKm: 1, refine: 0, startMs: START, days: 6, terrain: { observerHeightM: 2, resolution: 'precise', ...heights } }).grid;
  const split = run({ panelHeightM: 10, antennaHeightM: 2 });
  assert.deepEqual(split.terrain, { enabled: true, observerHeightM: 2, panelHeightM: 10, antennaHeightM: 2, resolution: 'precise', demVersion: demVersion() });
  assert.match(split.note, /panel a 10 m \(Sol\) y antena a 2 m \(Tierra\)/);
  const strip = (g: GridSearch) => ({ ...g, timingMs: 0 });
  const plain = run();
  assert.deepEqual(strip(run({ panelHeightM: 2, antennaHeightM: 2 })), strip(plain));
  assert.ok(!('panelHeightM' in plain.terrain!));
  for (const bad of [{ panelHeightM: 500 }, { antennaHeightM: -1 }]) {
    assert.throws(() => run(bad), /(panel|antenna)HeightM debe estar entre 0 y 100/, JSON.stringify(bad));
  }
  const ld = landingDates({
    site: { id: 'custom:-89.5,0', name: 'p', lat: -89.5, lon: 0, custom: true }, startMs: START, endMs: START + 4 * DAY, dateStepMs: DAY, missionDays: 6,
    terrain: { observerHeightM: 2, panelHeightM: 10, antennaHeightM: 2 },
  });
  assert.equal(ld.sweep.terrain!.panelHeightM, 10);
  assert.equal(ld.sweep.terrain!.antennaHeightM, 2);
  assert.equal(ld.terrain!.panelHeightM, 10);
});
