// GraphQL with terrain: the same values as v1 with terrain=1, with the catalogue masks (real, in git) and with a
// synthetic DEM in memory (hybrid horizon, heights of panel and antenna, slope). As terrain.test.ts, LUNAR_TERRAIN_DIR
// points to a temporary folder with the catalogue masks and without the DEM cache.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { assertSameAsV1, assertWarnings, gqlData, selectAll, v1Get } from './graphql-helpers.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TERRAIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gql-terrain-'));
fs.cpSync(path.join(HERE, '..', '..', 'backend', 'terrain', 'masks'), path.join(TERRAIN_DIR, 'masks'), { recursive: true });
process.env.LUNAR_TERRAIN_DIR = TERRAIN_DIR; // before importing the engine: the catalogue is loaded on import

const { createApp } = await import('../src/server.ts');
const { configureMasks } = await import('../../backend/src/horizon.ts');
const { executeRequest } = await import('../src/graphql/executor.ts');
const { configureDem, makeGrid } = await import('../../backend/src/terrain/dem.ts');

/** Synthetic DEM centred on the south pole: flat bowl of 25 km radius surrounded by a 1500 m plateau (as terrain.test.ts). */
function syntheticDem() {
  const res = 240, half = 60000, n = Math.round((2 * half) / res), a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + (i + 0.5) * res, y = half - (j + 0.5) * res;
    a[j * n + i] = Math.hypot(x, y) > 25000 ? 1500 : 0;
  }
  return makeGrid({ name: 'synthetic', res, X0: -half, Y0: half, w: n, h: n, a });
}

let server: Server, base: string, demVersion: string | null;
before(async () => {
  configureMasks({ diskCache: false });
  demVersion = configureDem({ grids: [syntheticDem()] });
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  configureDem({ grids: [] });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(TERRAIN_DIR, { recursive: true, force: true });
});

const at = (data: unknown, ...p: string[]): never => p.reduce((o: any, k) => o[k], data) as never;
const SE = selectAll('SunEarth'), WI = selectAll('Windows'), TR = selectAll('Track'), HO = selectAll('Horizon'), RK = selectAll('Rank'), LD = selectAll('LandingDates');
const BL = selectAll('BestLandings'), LM = selectAll('LightMap');

interface Case { name: string; v1: string; route: string; query: string; path: string[]; check?: (g: any) => void }

const CASES: Case[] = [
  {
    name: 'sunEarth con la máscara del catálogo (2 m)', route: '/v1/sun-earth',
    v1: '/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&terrain=1',
    query: `{ site(id: "shackleton-rim") { sunEarth(at: "2027-01-15T00:00:00Z", terrain: {}) { ${SE} } } }`, path: ['site', 'sunEarth'],
    check: (g) => assert.equal(g.terrain.applied, true),
  },
  {
    name: 'sunEarth con la máscara del catálogo a 10 m y earthMinElevationDeg', route: '/v1/sun-earth',
    v1: '/v1/sun-earth?site=shackleton-rim&date=2027-03-01&terrain=1&observerHeightM=10&earthMinElevationDeg=1',
    query: `{ site(id: "shackleton-rim") { sunEarth(at: "2027-03-01", terrain: { enabled: true, observerHeightM: 10 }, earthMinElevationDeg: 1) { ${SE} } } }`, path: ['site', 'sunEarth'],
  },
  {
    name: 'sunEarth con el DEM: panel y antena a distinta altura y umbral del horizonte híbrido', route: '/v1/sun-earth',
    v1: '/v1/sun-earth?lat=-89.5&lon=0&date=2027-01-15&terrain=1&panelHeightM=5&antennaHeightM=2&horizonRefineDeg=0.25',
    query: `{ site(lat: -89.5, lon: 0) { sunEarth(at: "2027-01-15", terrain: { panelHeightM: 5, antennaHeightM: 2, refineDeg: 0.25 }) { ${SE} } } }`, path: ['site', 'sunEarth'],
    check: (g) => { assert.equal(g.terrain.source, 'dem'); assert.equal(g.terrain.horizonRefineDeg, 0.25); assert.equal(g.terrain.panelHeightM, 5); },
  },
  {
    name: 'windows con el DEM, noche real y batería', route: '/v1/windows',
    v1: '/v1/windows?lat=-89.5&lon=0&start=2027-01-01&end=2027-01-15&terrain=1&fullNight=1&battery=1',
    query: `{ site(lat: -89.5, lon: 0) { windows(from: "2027-01-01", to: "2027-01-15", terrain: {}, night: { fullNight: true }, battery: {}) { ${WI} } } }`, path: ['site', 'windows'],
  },
  {
    name: 'windows con la máscara del catálogo y sin horizonte híbrido', route: '/v1/windows',
    v1: '/v1/windows?site=im2-alunizaje&start=2027-01-01&end=2027-02-01&terrain=1&horizonRefine=0',
    query: `{ site(id: "im2-alunizaje") { windows(from: "2027-01-01", to: "2027-02-01", terrain: { refine: false }) { ${WI} } } }`, path: ['site', 'windows'],
  },
  {
    name: 'track con el DEM', route: '/v1/track',
    v1: '/v1/track?lat=-89.5&lon=0&start=2027-01-01&end=2027-01-04&step=2h&terrain=1',
    query: `{ site(lat: -89.5, lon: 0) { track(from: "2027-01-01", to: "2027-01-04", stepMinutes: 120, terrain: {}) { ${TR} } } }`, path: ['site', 'track'],
  },
  {
    name: 'horizon con el DEM', route: '/v1/horizon',
    v1: '/v1/horizon?lat=-89.5&lon=0&observerHeightM=5',
    query: `{ site(lat: -89.5, lon: 0) { horizon(heightM: 5) { ${HO} } } }`, path: ['site', 'horizon'],
    check: (g) => assert.ok(Math.max(...g.elevationDeg) > 1),
  },
  {
    name: 'horizon del catálogo a 10 m', route: '/v1/horizon',
    v1: '/v1/horizon?site=shackleton-rim&observerHeightM=10',
    query: `{ site(id: "shackleton-rim") { horizon(heightM: 10) { ${HO} } } }`, path: ['site', 'horizon'],
  },
  {
    name: 'rank con relieve (catálogo, DEM y esfera)', route: '/v1/rank',
    v1: '/v1/rank?sites=shackleton-rim,apollo11,-89.5:0&start=2027-01-01&days=5&terrain=1',
    query: `{ rank(sites: ["shackleton-rim", "apollo11", "-89.5:0"], from: "2027-01-01", days: 5, terrain: {}) { ${RK} } }`, path: ['rank'],
  },
  {
    name: 'rank con relieve, alturas, noche real, batería y pendiente máxima (el borde del cráter queda fuera)', route: '/v1/rank',
    v1: '/v1/rank?sites=-89.5:0,-89.176:0,shackleton-rim&start=2027-01-24&days=7&terrain=1&panelHeightM=10&antennaHeightM=2&fullNight=1&battery=1&slopeBaselineM=500&maxSlopeDeg=5&minEarthTimeFraction=0.2',
    query: `{ rank(sites: ["-89.5:0", "-89.176:0", "shackleton-rim"], from: "2027-01-24", days: 7, terrain: { panelHeightM: 10, antennaHeightM: 2 }, night: { fullNight: true }, battery: {}, slope: { baselineM: 500, maxSlopeDeg: 5 }, constraints: { minEarthTimeFraction: 0.2 }) { ${RK} } }`,
    path: ['rank'],
    check: (g) => assert.ok(g.slope.excludedSiteIds.length > 0, JSON.stringify(g.slope)),
  },
  {
    name: 'rank con pendiente sin certificar: exclude y keep (1.12.0)', route: '/v1/rank',
    v1: '/v1/rank?sites=-89.5:0,-89.176:0&start=2027-01-24&days=2&slopeBaselineM=10&maxSlopeDeg=10&slopeUncertified=keep',
    query: `{ rank(sites: ["-89.5:0", "-89.176:0"], from: "2027-01-24", days: 2, slope: { baselineM: 10, maxSlopeDeg: 10, uncertified: keep }) { ${RK} } }`,
    path: ['rank'],
    check: (g) => {
      assert.equal(g.slope.uncertified, 'keep');
      assert.ok(g.results.length === 2 && g.results.every((r: { slope: { meetsMaxSlope: null; meetsMaxSlopeReason: string; source: string } }) => r.slope.meetsMaxSlope === null && /^sin certificar/.test(r.slope.meetsMaxSlopeReason) && /^dem-/.test(r.slope.source)), JSON.stringify(g.results));
    },
  },
  {
    name: 'rank con pendiente sin certificar, por defecto fuera (slopeUncertified)', route: '/v1/rank',
    v1: '/v1/rank?sites=-89.5:0&start=2027-01-24&days=2&slopeBaselineM=10&maxSlopeDeg=10',
    query: `{ rank(sites: ["-89.5:0"], from: "2027-01-24", days: 2, slope: { baselineM: 10, maxSlopeDeg: 10 }) { ${RK} } }`,
    path: ['rank'],
    check: (g) => assert.deepEqual(g.slope.excluded, [{ siteId: 'custom:-89.5,0', reason: 'slopeUncertified', slopeDeg: g.slope.excluded[0].slopeDeg }]),
  },
  {
    name: 'sunEarth con relieve y el observador a 0 m: aviso low_observer_height (1.12.0)', route: '/v1/sun-earth',
    v1: '/v1/sun-earth?lat=-89.5&lon=0&date=2027-01-15&terrain=1&observerHeightM=0',
    query: `{ site(lat: -89.5, lon: 0) { sunEarth(at: "2027-01-15", terrain: { observerHeightM: 0 }) { ${SE} } } }`,
    path: ['site', 'sunEarth'],
    check: (g) => assert.deepEqual(g.warnings.map((w: { code: string; parameter: string }) => [w.code, w.parameter]), [['low_observer_height', 'terrain.observerHeightM']]),
  },
  {
    name: 'landingDates con el DEM y restricciones', route: '/v1/landing-dates',
    v1: '/v1/landing-dates?lat=-89.5&lon=0&start=2027-01-01&end=2027-02-01&dateStep=48h&days=10&terrain=1&maxLongestNightHours=100&minEarthTimeFraction=0.3',
    query: `{ site(lat: -89.5, lon: 0) { landingDates(from: "2027-01-01", to: "2027-02-01", dateStepHours: 48, missionDays: 10, terrain: {}, constraints: { maxLongestNightHours: 100, minEarthTimeFraction: 0.3 }) { ${LD} } } }`,
    path: ['site', 'landingDates'],
  },
  {
    name: 'landingDates con la máscara del catálogo, panel horizontal y umbral propio', route: '/v1/landing-dates',
    v1: '/v1/landing-dates?site=im1&start=2027-01-01&end=2027-01-20&terrain=1&panel=horizontal&horizonRefineDeg=0.3&observerHeightM=10',
    query: `{ site(id: "im1") { landingDates(from: "2027-01-01", to: "2027-01-20", terrain: { refineDeg: 0.3, observerHeightM: 10 }, panel: horizontal) { ${LD} } } }`, path: ['site', 'landingDates'],
  },
  {
    name: 'bestLandings con relieve (catálogo, DEM y esfera)', route: '/v1/best-landings',
    v1: '/v1/best-landings?sites=shackleton-rim,-89.5:0,apollo11&start=2027-01-01&end=2027-01-10&days=5&terrain=1',
    query: `{ bestLandings(sites: ["shackleton-rim", "-89.5:0", "apollo11"], from: "2027-01-01", to: "2027-01-10", missionDays: 5, terrain: {}) { ${BL} } }`, path: ['bestLandings'],
    check: (g) => {
      assert.deepEqual(Object.fromEntries(g.options.map((o: { siteId: string; horizonModel: string }) => [o.siteId, o.horizonModel])), { 'shackleton-rim': 'mask', 'custom:-89.5,0': 'mask', apollo11: 'sphere' });
      assert.equal(g.terrain.source, 'dem');
    },
  },
  {
    name: 'bestLandings con relieve, alturas de panel y antena, prioridad y corte de Tierra', route: '/v1/best-landings',
    v1: '/v1/best-landings?sites=-89.5:0,-89.3:45&start=2027-01-24T00:00:00Z&end=2027-01-28T00:00:00Z&days=3&batteryHours=48&minEarthPct=30&maxEarthGapHours=24&priority=early&terrain=1&panelHeightM=10&antennaHeightM=2&horizonRefine=0',
    query: `{ bestLandings(sites: ["-89.5:0", "-89.3:45"], from: "2027-01-24T00:00:00Z", to: "2027-01-28T00:00:00Z", missionDays: 3, batteryHours: 48, minEarthPct: 30, maxEarthGapHours: 24, priority: early, terrain: { panelHeightM: 10, antennaHeightM: 2, refine: false }) { ${BL} } }`,
    path: ['bestLandings'],
    check: (g) => assert.deepEqual([g.terrain.panelHeightM, g.terrain.antennaHeightM, g.mission.maxEarthGapHours], [10, 2, 24]),
  },
  {
    name: 'windows con relieve en la cresta de Shackleton (89,4°S): aviso deep_polar_uncertainty (1.23.0)', route: '/v1/windows',
    v1: '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-01-05&terrain=1',
    query: `{ site(id: "shackleton-rim") { windows(from: "2027-01-01", to: "2027-01-05", terrain: {}) { ${WI} } } }`, path: ['site', 'windows'],
    check: (g) => assert.deepEqual(g.warnings.map((w: { code: string }) => w.code), ['deep_polar_uncertainty']),
  },
  {
    name: 'windows con relieve en IM-2 (84,8°S): sin deep_polar_uncertainty', route: '/v1/windows',
    v1: '/v1/windows?site=im2-objetivo&start=2027-01-01&end=2027-01-05&terrain=1',
    query: `{ site(id: "im2-objetivo") { windows(from: "2027-01-01", to: "2027-01-05", terrain: {}) { ${WI} } } }`, path: ['site', 'windows'],
    check: (g) => assert.ok(!(g.warnings ?? []).some((w: { code: string }) => w.code === 'deep_polar_uncertainty')),
  },
  {
    name: 'windows sin relieve en la cresta de Shackleton: sin deep_polar_uncertainty', route: '/v1/windows',
    v1: '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-01-05',
    query: `{ site(id: "shackleton-rim") { windows(from: "2027-01-01", to: "2027-01-05") { ${WI} } } }`, path: ['site', 'windows'],
    check: (g) => assert.ok(!(g.warnings ?? []).some((w: { code: string }) => w.code === 'deep_polar_uncertainty')),
  },
  {
    name: 'rank con relieve: deep_polar_uncertainty nombra la cresta de Shackleton y no IM-2 (1.23.0)', route: '/v1/rank',
    v1: '/v1/rank?sites=shackleton-rim,im2-objetivo&start=2027-01-01&days=2&terrain=1',
    query: `{ rank(sites: ["shackleton-rim", "im2-objetivo"], from: "2027-01-01", days: 2, terrain: {}) { ${RK} } }`, path: ['rank'],
    check: (g) => {
      const deep = g.warnings.filter((w: { code: string }) => w.code === 'deep_polar_uncertainty');
      assert.equal(deep.length, 1);
      assert.match(deep[0].message, /^shackleton-rim: Al sur de 85°S/);
    },
  },
  {
    name: 'rank sin relieve: sin deep_polar_uncertainty', route: '/v1/rank',
    v1: '/v1/rank?sites=shackleton-rim,im2-objetivo&start=2027-01-01&days=2',
    query: `{ rank(sites: ["shackleton-rim", "im2-objetivo"], from: "2027-01-01", days: 2) { ${RK} } }`, path: ['rank'],
    check: (g) => assert.ok(!(g.warnings ?? []).some((w: { code: string }) => w.code === 'deep_polar_uncertainty')),
  },
  {
    name: 'lightMap con el DEM alrededor del polo', route: '/v1/light-map',
    v1: '/v1/light-map?radiusKm=40&spacingKm=10&start=2027-01-15T00:00:00Z&days=3&mode=full',
    query: `{ lightMap(radiusKm: 40, spacingKm: 10, from: "2027-01-15T00:00:00Z", days: 3, mode: full) { ${LM} } }`, path: ['lightMap'],
    check: (g) => {
      assert.equal(g.terrain.applied, true);
      assert.ok(g.points.withTerrain.some(Boolean) && g.points.sunTimeFraction.length === g.count, JSON.stringify(g.points.withTerrain));
    },
  },
  {
    name: 'lightMap con el DEM, centro en unas coordenadas y alturas de panel y antena', route: '/v1/light-map',
    v1: '/v1/light-map?lat=-89.5&lon=0&radiusKm=10&spacingKm=5&start=2027-01-15&days=1&panelHeightM=10&antennaHeightM=3',
    query: `{ lightMap(lat: -89.5, lon: 0, radiusKm: 10, spacingKm: 5, from: "2027-01-15", days: 1, panelHeightM: 10, antennaHeightM: 3) { ${LM} } }`, path: ['lightMap'],
    check: (g) => assert.deepEqual([g.terrain.panelHeightM, g.terrain.antennaHeightM], [10, 3]),
  },
];

describe('GraphQL da los mismos valores que la v1 (con relieve)', () => {
  for (const c of CASES) {
    test(c.name, async () => {
      const [v1, data] = await Promise.all([v1Get<Record<string, never>>(base, c.v1), gqlData(base, c.query)]);
      const g = at(data, ...c.path) as Record<string, never>;
      assertSameAsV1(g, v1);
      assertWarnings(g.warnings, v1, c.route);
      c.check?.(g);
    });
  }

  test('Site.slope con el DEM = el slope de /v1/sun-earth', async () => {
    for (const [lat, base_] of [[-89.176, 500], [-89.5, 100]] as const) {
      const v1 = await v1Get<{ slope: never }>(base, `/v1/sun-earth?lat=${lat}&lon=0&date=2027-01-15&slopeBaselineM=${base_}&maxSlopeDeg=5`);
      const data = await gqlData(base, `{ site(lat: ${lat}, lon: 0) { slope(baselineM: ${base_}, maxSlopeDeg: 5) { ${selectAll('Slope')} } } }`);
      assertSameAsV1(at(data, 'site', 'slope'), v1.slope);
    }
  });

  test('compare con relieve: cada sitio igual que /v1/landing-dates', async () => {
    const data = await gqlData(base, `{ compare(sites: ["im1", "-89.5:0"], landingDates: { from: "2027-01-01", to: "2027-01-21", dateStepHours: 72, terrain: { panelHeightM: 5 } }) { sites { landingDates { ${LD} } } } }`);
    const v1s = await Promise.all(['site=im1', 'lat=-89.5&lon=0'].map((s) => v1Get<any>(base, `/v1/landing-dates?${s}&start=2027-01-01&end=2027-01-21&dateStep=72h&terrain=1&panelHeightM=5`)));
    v1s.forEach((v1, i) => assertSameAsV1((data.compare as any).sites[i].landingDates, v1));
  });

  test('resolution: fast (solo GraphQL) usa el modo rápido y lo dice en la nota', async () => {
    const data = await gqlData(base, `{ site(lat: -89.5, lon: 0) {
      fast: landingDates(from: "2027-01-01", to: "2027-01-10", terrain: { resolution: fast }) { site { horizonModel } terrain { note horizonRefineDeg } }
      precise: landingDates(from: "2027-01-01", to: "2027-01-10", terrain: { resolution: precise }) { terrain { note horizonRefineDeg } } } }`);
    const s = data.site as any;
    assert.equal(s.fast.site.horizonModel, 'mask');
    assert.match(s.fast.terrain.note, /modo rápido/);
    assert.equal(s.fast.terrain.horizonRefineDeg, null, 'sin horizonte híbrido por defecto en modo rápido');
    assert.match(s.precise.terrain.note, /modo preciso/);
    assert.equal(s.precise.terrain.horizonRefineDeg, 0.1);
    assert.ok(demVersion);
  });
});

test('coste (1.13.0): una máscara nueva en frío cuesta ~110 puntos; ya en la caché de disco, casi nada', () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gql-cost-'));
  configureMasks({ diskCache: true, cacheDir });
  try {
    const est = (query: string): { cost: number; ok: boolean } => {
      const r = executeRequest({ query });
      return { cost: (r.body.extensions as any).cost.estimated, ok: r.status === 200 };
    };
    const q = '{ site(lat: -89.9, lon: 12.3) { horizon { azimuthStepDeg } } }';
    const cold = est(q);
    assert.ok(cold.ok);
    const warm = est(q); // the first run left the mask in the disk cache
    assert.ok(cold.cost >= 100, `en frío: ${cold.cost}`);
    assert.ok(warm.cost <= 5, `en caché: ${warm.cost}`);
    // Ten new points with terrain: ten cold masks (measured on the real DEM: 1035 ms; 1.12.0 estimated 351).
    const ten = Array.from({ length: 10 }, (_, i) => `"-89.8${i}:${i * 7}"`).join(',');
    assert.ok(est(`{ rank(sites: [${ten}], from: "2027-01-01", days: 30, terrain: {}) { results { siteId } } }`).cost > 1000);
    // bestLandings with terrain: the cold masks of its new points, as rank (other points: rank left those in the cache).
    const others = Array.from({ length: 10 }, (_, i) => `"-89.7${i}:${i * 11}"`).join(',');
    const noTerrain = est(`{ bestLandings(sites: [${others}], from: "2027-01-01", to: "2027-01-10") { tested } }`).cost;
    assert.ok(est(`{ bestLandings(sites: [${others}], from: "2027-01-01", to: "2027-01-10", terrain: {}) { tested } }`).cost > noTerrain + 1000);
    assert.ok(est(`{ bestLandings(sites: [${others}], from: "2027-01-01", to: "2027-01-10", terrain: {}) { tested } }`).cost < noTerrain + 500, 'repetida: máscaras en la caché de disco');
    // lightMap: a fast mask per point inside the DEM (~11 ms measured on the real DEM, 1.16.0); one per distinct height.
    const map = (args: string): number => est(`{ lightMap(radiusKm: 40, spacingKm: 10, from: "2027-01-15"${args}) { count } }`).cost;
    const points = 49; // lightMapCells of 40 km every 10 km
    assert.ok(map('') >= 12 * points && map('') < 15 * points, `mapa: ${map('')}`);
    assert.ok(map(', panelHeightM: 10') >= 24 * points, `dos alturas: ${map(', panelHeightM: 10')}`);
    assert.ok(est('{ lightMap(lat: -40, lon: 0, radiusKm: 40, spacingKm: 10, from: "2027-01-15") { count } }').cost < 100, 'fuera del DEM: sin máscaras');
  } finally {
    configureMasks({ diskCache: false });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
