// Panel and antenna heights apart (1.6.0): `panelHeightM` (mask for the Sun) and `antennaHeightM` (mask for the Earth).
//
// As in terrain.test.ts, terrain is turned ON on purpose: LUNAR_TERRAIN_DIR points to a temporary folder with the real
// catalog masks (2 m and 10 m). /v1/rank and /v1/landing-dates use a synthetic in-memory DEM.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { validate } from './schema.ts';
import type { MediaType, OpenApiSpec } from './schema.ts';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { withoutWarnings } from './contract.ts';
import type { V1Error, V1LandingDates, V1Metrics, V1Rank, V1SunEarth, V1Terrain, V1Track, V1Warning, V1Windows } from '../src/types.ts';

type WithTerrain<T> = T & { terrain: V1Terrain };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TERRAIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-heights-'));
fs.cpSync(path.join(HERE, '..', '..', 'backend', 'terrain', 'masks'), path.join(TERRAIN_DIR, 'masks'), { recursive: true });
process.env.LUNAR_TERRAIN_DIR = TERRAIN_DIR; // before importing the engine: the catalog is loaded on import

const { createApp } = await import('../src/server.ts');
const { configureMasks } = await import('../../backend/src/horizon.ts');
const { configureDem, llToXY, makeGrid } = await import('../../backend/src/terrain/dem.ts');

const spec = parseYaml(fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const content = (route: string): MediaType => spec.paths[route].get!.responses!['200'].content['application/json'];

let server: Server, base: string;
before(async () => {
  configureMasks({ diskCache: false });
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(TERRAIN_DIR, { recursive: true, force: true });
});

const get = async <T = unknown>(p: string): Promise<{ status: number; text: string; body: T }> => {
  const res = await fetch(base + p);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as T };
};
const assertConforms = (route: string, body: unknown): void => {
  const errors = validate(spec, content(route).schema, body);
  assert.deepEqual(errors, [], `La respuesta de ${route} no cumple el esquema:\n${errors.join('\n')}`);
};

const SUN_METRICS = ['meanSunDiskFraction', 'sunTimeFraction', 'longestNightHours', 'longestNightFullHours', 'batteryKWh', 'batteryKg'] as const;
const EARTH_METRICS = ['earthTimeFraction', 'longestEarthOutageHours'] as const;
const pick = (m: V1Metrics, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, m[k as keyof V1Metrics]]));

describe('catálogo (shackleton-rim, máscaras de 2 m y 10 m)', () => {
  const W = '/v1/windows?site=shackleton-rim&start=2027-03-01&end=2027-07-01&terrain=1&fullNight=1&battery=1';

  test('windows: panel a 10 m y antena a 2 m = Sol y noche de «todo a 10 m», Tierra de «todo a 2 m»', async () => {
    const all2 = await get<WithTerrain<V1Windows>>(W), all10 = await get<WithTerrain<V1Windows>>(`${W}&observerHeightM=10`);
    const split = await get<WithTerrain<V1Windows>>(`${W}&panelHeightM=10&antennaHeightM=2`);
    assert.equal(split.status, 200, split.text);
    assertConforms('/v1/windows', split.body);
    // the height matters in this period
    assert.notDeepEqual(all10.body.sun, all2.body.sun);
    assert.notDeepEqual(all10.body.earth, all2.body.earth);
    assert.deepEqual(split.body.sun, all10.body.sun);
    assert.deepEqual(split.body.night, all10.body.night);
    assert.deepEqual(split.body.battery, all10.body.battery);
    assert.deepEqual(split.body.earth, all2.body.earth);
    assert.deepEqual({ ...split.body.terrain, note: undefined }, {
      observerHeightM: 2, panelHeightM: 10, antennaHeightM: 2, applied: true, source: 'catalog', demVersion: all2.body.terrain.demVersion, note: undefined,
    });
    assert.match(split.body.terrain.note, /Panel \(Sol\) a 10 m: .*Antena \(Tierra\) a 2 m: /);
  });

  test('con las alturas iguales a observerHeightM la respuesta es idéntica byte a byte', async () => {
    const plain = await get(W), ten = await get(`${W}&observerHeightM=10`);
    assert.equal((await get(`${W}&panelHeightM=2&antennaHeightM=2`)).text, plain.text);
    assert.equal((await get(`${W}&panelHeightM=2`)).text, plain.text);
    assert.equal((await get(`${W}&observerHeightM=10&panelHeightM=10&antennaHeightM=10`)).text, ten.text);
    // without terrain=1 they are ignored, as observerHeightM
    const flat = '/v1/windows?site=shackleton-rim&start=2027-03-01&end=2027-04-01';
    const ignored = await get<{ warnings?: V1Warning[] }>(`${flat}&panelHeightM=10&antennaHeightM=5`);
    assert.equal(withoutWarnings(ignored.text), withoutWarnings((await get(flat)).text));
    // since 1.9.0 the response says they were ignored
    assert.deepEqual(ignored.body.warnings!.filter((w) => w.code === 'ignored_parameter').map((w) => w.parameter), ['panelHeightM', 'antennaHeightM']);
  });

  test('el ejemplo panelYAntena de openapi.yaml es real', async () => {
    const r = await get('/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&terrain=1&panelHeightM=2&antennaHeightM=10');
    assert.deepEqual(r.body, content('/v1/sun-earth').examples!.panelYAntena.value);
  });

  test('sun-earth y track: cada cuerpo con su máscara', async () => {
    const S = '/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&terrain=1';
    const [s2, s10, split] = [await get<WithTerrain<V1SunEarth>>(S), await get<WithTerrain<V1SunEarth>>(`${S}&observerHeightM=10`), await get<WithTerrain<V1SunEarth>>(`${S}&panelHeightM=10`)];
    assertConforms('/v1/sun-earth', split.body);
    assert.deepEqual(split.body.sun, s10.body.sun);
    assert.deepEqual(split.body.earth, s2.body.earth);
    assert.notEqual(s10.body.sun.horizonElevationDeg, s2.body.sun.horizonElevationDeg);
    assert.equal(split.body.sunAndEarthVisible, split.body.sun.visible && split.body.earth.visible);
    assert.deepEqual([split.body.terrain.panelHeightM, split.body.terrain.antennaHeightM], [10, 2]);
    const T = '/v1/track?site=shackleton-rim&start=2027-01-15&end=2027-01-16&terrain=1';
    const [t2, t10, ts] = [await get<V1Track>(T), await get<V1Track>(`${T}&observerHeightM=10`), await get<V1Track>(`${T}&panelHeightM=10&antennaHeightM=2`)];
    assertConforms('/v1/track', ts.body);
    assert.deepEqual(ts.body.sun, t10.body.sun);
    assert.deepEqual(ts.body.earth, t2.body.earth);
  });
});

/** Flat floor with a 30 m step 1 km around (-89.5, 0): the near horizon changes with the height (synthetic, in memory). */
function stepDem() {
  const [cx, cy] = llToXY(-89.5, 0);
  const res = 60, half = 20000, n = Math.round((2 * half) / res), a = new Float32Array(n * n);
  const X0 = cx - half, Y0 = cy + half;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    a[j * n + i] = Math.hypot(X0 + (i + 0.5) * res - cx, Y0 - (j + 0.5) * res - cy) > 1000 ? 30 : 0;
  }
  return makeGrid({ name: 'step', res, X0, Y0, w: n, h: n, a });
}

describe('DEM sintético: /v1/rank y /v1/landing-dates', () => {
  before(() => { configureDem({ grids: [stepDem()] }); });
  after(() => { configureDem({ grids: [] }); });

  test('rank: métricas de Sol con el panel y de Tierra con la antena; eco de las dos alturas', async () => {
    const R = '/v1/rank?sites=-89.5:0&start=2027-01-10&days=14&terrain=1&fullNight=1&battery=1';
    const [r2, r10, rs] = [await get<WithTerrain<V1Rank>>(R), await get<WithTerrain<V1Rank>>(`${R}&observerHeightM=10`), await get<WithTerrain<V1Rank>>(`${R}&panelHeightM=10&antennaHeightM=2`)];
    assert.equal(rs.status, 200, rs.text);
    assertConforms('/v1/rank', rs.body);
    const [m2, m10, ms] = [r2, r10, rs].map((r) => r.body.results[0].metrics);
    assert.notEqual(m10.meanSunDiskFraction, m2.meanSunDiskFraction);
    assert.notEqual(m10.earthTimeFraction, m2.earthTimeFraction);
    assert.deepEqual(pick(ms, SUN_METRICS), pick(m10, SUN_METRICS));
    assert.deepEqual(pick(ms, EARTH_METRICS), pick(m2, EARTH_METRICS));
    assert.deepEqual([rs.body.terrain.panelHeightM, rs.body.terrain.antennaHeightM, rs.body.terrain.observerHeightM], [10, 2, 2]);
    assert.ok(!('panelHeightM' in r2.body.terrain));
    assert.equal((await get(`${R}&panelHeightM=2&antennaHeightM=2`)).text, r2.text);
  });

  test('landing-dates: igual, fecha a fecha', async () => {
    const L = '/v1/landing-dates?lat=-89.5&lon=0&start=2027-01-10&end=2027-01-20&days=6&terrain=1';
    const [l2, l10, ls] = [await get<WithTerrain<V1LandingDates>>(L), await get<WithTerrain<V1LandingDates>>(`${L}&observerHeightM=10`), await get<WithTerrain<V1LandingDates>>(`${L}&antennaHeightM=2&panelHeightM=10`)];
    assert.equal(ls.status, 200, ls.text);
    assertConforms('/v1/landing-dates', ls.body);
    ls.body.dates!.forEach((d, i) => {
      assert.deepEqual(pick(d.metrics, SUN_METRICS), pick(l10.body.dates![i].metrics, SUN_METRICS), d.date);
      assert.deepEqual(pick(d.metrics, EARTH_METRICS), pick(l2.body.dates![i].metrics, EARTH_METRICS), d.date);
    });
    assert.deepEqual([ls.body.terrain.panelHeightM, ls.body.terrain.antennaHeightM], [10, 2]);
    assert.equal((await get(`${L}&observerHeightM=10&panelHeightM=10`)).text, l10.text);
  });
});

describe('validación', () => {
  for (const [p, name] of [
    ['/v1/windows?site=shackleton-rim&terrain=1&panelHeightM=500', 'panelHeightM'],
    ['/v1/sun-earth?site=shackleton-rim&terrain=1&antennaHeightM=-1', 'antennaHeightM'],
    ['/v1/track?site=shackleton-rim&terrain=1&antennaHeightM=abc', 'antennaHeightM'],
    ['/v1/rank?sites=apollo11&terrain=1&panelHeightM=101', 'panelHeightM'],
    ['/v1/landing-dates?site=apollo11&terrain=1&antennaHeightM=1e9', 'antennaHeightM'],
  ] as const) {
    test(p, async () => {
      const r = await get<V1Error>(p);
      assert.equal(r.status, 400);
      assert.equal(r.body.error.code, 'invalid_parameter');
      assert.match(r.body.error.message, new RegExp(`^${name} debe ser un número`));
    });
  }
});

describe('1.12.0: aviso de altura por debajo de 1 m con relieve', () => {
  const S = '/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&terrain=1';
  const low = (r: { body: { warnings?: V1Warning[] } }): (string | undefined)[] => (r.body.warnings ?? []).filter((w) => w.code === 'low_observer_height').map((w) => w.parameter);

  test('observerHeightM, panelHeightM o antennaHeightM < 1 m: aviso con la cifra medida; no cambia el cálculo', async () => {
    const zero = await get<WithTerrain<V1SunEarth> & { warnings?: V1Warning[] }>(`${S}&observerHeightM=0`);
    assert.equal(zero.status, 200);
    assertConforms('/v1/sun-earth', zero.body);
    assert.deepEqual(low(zero), ['observerHeightM']); // panel and antenna only inherit it: one warning
    assert.match(zero.body.warnings!.find((w) => w.code === 'low_observer_height')!.message, /^observerHeightM=0 m: .*2108 h a 0 m frente a 114 h a 2 m/);
    assert.deepEqual(low(await get(`${S}&panelHeightM=0.5`)), ['panelHeightM']);
    assert.deepEqual(low(await get(`${S}&observerHeightM=0.2&antennaHeightM=3`)), ['observerHeightM']);
    assert.deepEqual(low(await get(`${S}&panelHeightM=0&antennaHeightM=0.9`)), ['panelHeightM', 'antennaHeightM']);
    assert.deepEqual(low(await get(`/v1/rank?sites=shackleton-rim&start=2027-01-01&days=1&terrain=1&antennaHeightM=0`)), ['antennaHeightM']);
    assert.deepEqual(low(await get('/v1/horizon?site=shackleton-rim&observerHeightM=0.5')), ['observerHeightM']);
    // 1 m or more, or without terrain: nothing.
    for (const p of [`${S}&observerHeightM=1`, S, '/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&observerHeightM=0', '/v1/horizon?site=shackleton-rim']) {
      assert.deepEqual(low(await get(p)), [], p);
    }
  });
});
