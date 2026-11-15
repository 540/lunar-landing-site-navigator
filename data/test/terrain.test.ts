// Optional terrain (terrain=1) and v1 backward compatibility.
//
// Under `node --test` the backend turns terrain off by itself. Here it is turned ON on purpose: LUNAR_TERRAIN_DIR points
// to a temporary folder with the real catalog masks (backend/terrain/masks, ~48 KB, in git) and without the DEM cache
// (388 MB, outside git). The DEM, when needed, is synthetic and in memory.
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
import type { V1Health, V1Horizon, V1LandingDates, V1LightMap, V1Rank, V1SunEarth, V1Terrain, V1Track, V1Warning, V1Windows } from '../src/types.ts';

/** Responses to terrain=1 always carry `terrain`. */
type WithTerrain<T> = T & { terrain: V1Terrain };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MASKS = path.join(HERE, '..', '..', 'backend', 'terrain', 'masks');
const TERRAIN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-terrain-'));
fs.cpSync(MASKS, path.join(TERRAIN_DIR, 'masks'), { recursive: true });
process.env.LUNAR_TERRAIN_DIR = TERRAIN_DIR; // before importing the engine: the catalog is loaded on import

const { createApp } = await import('../src/server.ts');
const { configureMasks, getMask, getCatalogMask } = await import('../../backend/src/horizon.ts');
const { configureDem, makeGrid } = await import('../../backend/src/terrain/dem.ts');

const spec = parseYaml(fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const content = (route: string): MediaType => spec.paths[route].get!.responses!['200'].content['application/json'];
const exampleOf = (route: string, name?: string): unknown => {
  const c = content(route);
  return name ? c.examples![name].value : (c.examples ? Object.values(c.examples)[0].value : c.example);
};

let server: Server, base: string;
before(async () => {
  configureMasks({ diskCache: false }); // do not write mask caches during the tests
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(TERRAIN_DIR, { recursive: true, force: true });
});

/** GET with the JSON body typed as the route documents it. */
const get = async <T = unknown>(p: string): Promise<{ status: number; text: string; body: T }> => {
  const res = await fetch(base + p);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as T };
};
const assertConforms = (route: string, body: unknown): void => {
  const errors = validate(spec, content(route).schema, body);
  assert.deepEqual(errors, [], `La respuesta de ${route} no cumple el esquema:\n${errors.join('\n')}`);
};

/** In-memory synthetic DEM centred on the south pole: flat bowl of 25 km radius surrounded by a 1500 m plateau. */
function syntheticDem() {
  const res = 240, half = 60000, n = Math.round((2 * half) / res), a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + (i + 0.5) * res, y = half - (j + 0.5) * res;
    a[j * n + i] = Math.hypot(x, y) > 25000 ? 1500 : 0;
  }
  return makeGrid({ name: 'synthetic', res, X0: -half, Y0: half, w: n, h: n, a });
}

const POLAR = ['shackleton-rim', 'im2-alunizaje', 'im2-objetivo', 'im1', 'chandrayaan3'];

describe('contrato: sin terrain la respuesta no cambia aunque haya relieve disponible', () => {
  test('el relieve SÍ está disponible en este proceso (máscaras de catálogo cargadas)', () => {
    for (const id of POLAR) assert.ok(getMask(id), `${id} debería tener máscara de catálogo`);
    assert.ok(getCatalogMask('shackleton-rim', 10), 'y también la de 10 m');
  });

  test('sun-earth y windows de shackleton-rim: idénticas a los ejemplos de 1.0.0 (horizonte esférico)', async () => {
    const s = await get<V1SunEarth>('/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z');
    assert.deepEqual(s.body, exampleOf('/v1/sun-earth', 'sinRelieve'));
    assert.equal(s.text, JSON.stringify(exampleOf('/v1/sun-earth', 'sinRelieve')), 'byte a byte');
    const w = await get<V1Windows>('/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&mode=center');
    assert.deepEqual(w.body, exampleOf('/v1/windows'));
  });

  test('ningún sitio polar con máscara usa relieve sin terrain (ni con terrain=0 / false)', async () => {
    for (const id of POLAR) {
      for (const t of ['', '&terrain=0', '&terrain=false']) {
        const s = await get<V1SunEarth>(`/v1/sun-earth?site=${id}&date=2027-01-15T00:00:00Z${t}`);
        assert.equal(s.body.site.horizonModel, 'sphere', `${id}${t}`);
        assert.equal(s.body.sun.horizonElevationDeg, 0);
        assert.equal(s.body.earth.horizonElevationDeg, 0);
        assert.ok(!('terrain' in s.body));
      }
      const w = await get<V1Windows>(`/v1/windows?site=${id}&start=2027-01-01&end=2027-02-01`);
      assert.equal(w.body.site.horizonModel, 'sphere');
      assert.ok(!('terrain' in w.body));
    }
  });

  test('rank sin terrain: idéntico al ejemplo de 1.0.0 aunque haya DEM', async () => {
    configureDem({ grids: [syntheticDem()] });
    try {
      const r = await get<V1Rank>('/v1/rank?sites=all&start=2027-01-01&days=30');
      assert.deepEqual({ ...r.body, results: r.body.results.slice(0, 2) }, exampleOf('/v1/rank'));
      assert.ok(r.body.results.every((c) => !('horizonModel' in c)) && !('terrain' in r.body));
    } finally {
      configureDem({ grids: [] });
    }
  });
});

describe('terrain=1', () => {
  test('sitio con máscara de catálogo: coincide con el ejemplo conRelieve y cumple el esquema', async () => {
    const s = await get<WithTerrain<V1SunEarth>>('/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&terrain=1');
    assertConforms('/v1/sun-earth', s.body);
    assert.deepEqual(s.body, exampleOf('/v1/sun-earth', 'conRelieve'));
    assert.equal(s.body.site.horizonModel, 'mask');
    assert.equal(s.body.terrain.source, 'catalog');
  });

  test('observerHeightM=10 usa la máscara de 10 m del catálogo', async () => {
    const two = await get<WithTerrain<V1Windows>>('/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&terrain=1');
    const ten = await get<WithTerrain<V1Windows>>('/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&terrain=1&observerHeightM=10');
    assertConforms('/v1/windows', ten.body);
    assert.equal(ten.body.terrain.source, 'catalog');
    assert.equal(ten.body.terrain.observerHeightM, 10);
    assert.equal(two.body.terrain.observerHeightM, 2);
    // On top of the ridge both horizons are below 0° and the Sun windows of Jan–Mar coincide: the horizon itself differs.
    const at = (h: number) => get<WithTerrain<V1SunEarth>>(`/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&terrain=1&observerHeightM=${h}`);
    const [s2, s10] = [await at(2), await at(10)];
    assert.notEqual(s10.body.sun.horizonElevationDeg, s2.body.sun.horizonElevationDeg);
    assert.equal(s10.body.terrain.source, 'catalog');
  });

  test('horizon: devuelve la máscara del catálogo y track la usa en horizonElevationDeg', async () => {
    const h = await get<V1Horizon>('/v1/horizon?site=shackleton-rim');
    assertConforms('/v1/horizon', h.body);
    const mask = getMask('shackleton-rim')!;
    assert.equal(h.body.site.horizonModel, 'mask');
    assert.equal(h.body.terrain.source, 'catalog');
    assert.equal(h.body.azimuthStepDeg, mask.stepDeg);
    assert.deepEqual(h.body.elevationDeg, mask.el);
    assert.equal(h.body.groundHeightM, mask.heightM);
    const t = await get<V1Track>('/v1/track?site=shackleton-rim&start=2027-01-15T00:00:00Z&end=2027-01-15T06:00:00Z&terrain=1');
    assertConforms('/v1/track', t.body);
    assert.equal(t.body.times.length, 7);
    // same instant as the conRelieve example of /v1/sun-earth
    const s = exampleOf('/v1/sun-earth', 'conRelieve') as V1SunEarth;
    for (const b of ['sun', 'earth'] as const) {
      assert.equal(t.body[b].azimuthDeg[0], s[b].azimuthDeg);
      assert.equal(t.body[b].elevationDeg[0], s[b].elevationDeg);
      // track reads the mask at the azimuth already rounded to 4 decimals: it can differ in the last decimal.
      assert.ok(Math.abs(t.body[b].horizonElevationDeg[0] - s[b].horizonElevationDeg) <= 1e-4 + 1e-9, `${b}: ${t.body[b].horizonElevationDeg[0]} vs ${s[b].horizonElevationDeg}`);
    }
    const two = await get<V1Track>('/v1/track?site=shackleton-rim&start=2027-01-15T00:00:00Z&end=2027-01-15T02:00:00Z&terrain=1');
    assert.deepEqual(two.body, exampleOf('/v1/track'));
    assert.deepEqual({ ...h.body, elevationDeg: h.body.elevationDeg.slice(0, 8) }, exampleOf('/v1/horizon'));
    const flat = await get<V1Track>('/v1/track?site=shackleton-rim&start=2027-01-15T00:00:00Z&end=2027-01-15T06:00:00Z');
    assert.ok(flat.body.sun.horizonElevationDeg.every((e: number) => e === 0) && !('terrain' in flat.body));
    assert.deepEqual(flat.body.sun.elevationDeg, t.body.sun.elevationDeg, 'el relieve no mueve los astros');
  });

  test('track: radio aparente de cada disco (1.22.0, #192), con y sin relieve', async () => {
    const range = { sun: [0.25, 0.28], earth: [0.85, 1.05] } as const;
    for (const t of ['', '&terrain=1']) {
      const r = await get<V1Track>(`/v1/track?site=shackleton-rim&start=2027-01-01T00:00:00Z&end=2027-02-01T00:00:00Z&step=6h${t}`);
      assertConforms('/v1/track', r.body);
      for (const b of ['sun', 'earth'] as const) {
        const radius = r.body[b].angularRadiusDeg;
        assert.equal(radius.length, r.body.times.length, `${b}${t}: alineado con times`);
        const [lo, hi] = range[b];
        assert.ok(radius.every((x: number) => x >= lo && x <= hi), `${b}${t}: ${Math.min(...radius)}–${Math.max(...radius)} fuera de ${lo}–${hi}`);
      }
    }
  });

  test('horizon sin máscara: 360 ceros, esfera y se indica', async () => {
    configureDem({ grids: [] });
    const h = await get<V1Horizon>('/v1/horizon?lat=-89.5&lon=0');
    assertConforms('/v1/horizon', h.body);
    assert.equal(h.body.site.horizonModel, 'sphere');
    assert.equal(h.body.elevationDeg.length * h.body.azimuthStepDeg, 360);
    assert.ok(h.body.elevationDeg.every((e: number) => e === 0));
    assert.equal(h.body.groundHeightM, null);
    assert.equal(h.body.terrain.applied, false);
  });

  test('track: límites de step y de puntos', async () => {
    assert.equal((await get('/v1/track?site=apollo11&start=2027-01-01&end=2027-01-02&step=30s')).status, 400);
    assert.equal((await get('/v1/track?site=apollo11&start=2027-01-01&end=2027-02-20&step=5m')).status, 400);
    assert.equal((await get('/v1/track?site=apollo11&start=2027-01-01&end=2027-06-01')).status, 400);
    assert.equal((await get('/v1/track?site=apollo11&start=2026-01-01&end=2027-02-20&step=1d')).status, 400); // más de 400 días
    // Desde 1.15.0: paso de 1 min y hasta 400 días (los 3000 puntos siguen siendo el límite).
    assert.equal((await get('/v1/track?site=apollo11&start=2027-01-01T00:00:00Z&end=2027-01-01T06:00:00Z&step=1m')).status, 200);
    const year = await get<V1Track>('/v1/track?site=shackleton-rim&start=2026-01-01T00:00:00Z&end=2027-01-01T00:00:00Z&step=6h');
    assert.equal(year.status, 200);
    assert.equal(year.body.times.length, 1461);
  });

  test('sin DEM: coordenadas libres → horizonte esférico, sin fallar, y se indica', async () => {
    configureDem({ grids: [] });
    const s = await get<WithTerrain<V1SunEarth>>('/v1/sun-earth?lat=-89.5&lon=0&date=2027-01-15&terrain=1');
    assert.equal(s.status, 200);
    assertConforms('/v1/sun-earth', s.body);
    assert.equal(s.body.site.horizonModel, 'sphere');
    assert.deepEqual({ ...s.body.terrain, note: undefined }, { observerHeightM: 2, applied: false, source: null, demVersion: null, note: undefined });
    assert.match(s.body.terrain.note, /no tiene el DEM/);
    // another height with no catalog mask nor DEM -> sphere
    const h5 = await get<WithTerrain<V1SunEarth>>('/v1/sun-earth?site=shackleton-rim&date=2027-01-15&terrain=1&observerHeightM=5');
    assert.equal(h5.body.site.horizonModel, 'sphere');
    assert.equal(h5.body.terrain.applied, false);
  });

  test('sin DEM (1.13.0): el relieve de un sitio del catálogo no depende de la ruta ni de pedirlo por id o por coordenadas', async () => {
    configureDem({ grids: [] });
    // April 2027: on the sphere the Sun never rises at shackleton-rim (sunTimeFraction 0); its catalogue mask sees it ~73 %.
    const q = 'start=2027-04-01T00:00:00Z&terrain=1';
    const w = await get<WithTerrain<V1Windows>>(`/v1/windows?site=shackleton-rim&${q}&end=2027-05-01T00:00:00Z`);
    const r = await get<WithTerrain<V1Rank>>(`/v1/rank?sites=shackleton-rim,apollo11,-89.44027:-137.12649&${q}&days=30`);
    const l = await get<WithTerrain<V1LandingDates>>(`/v1/landing-dates?site=shackleton-rim&${q}&end=2027-04-01T00:00:00Z&days=30`);
    const lc = await get<WithTerrain<V1LandingDates>>(`/v1/landing-dates?lat=-89.44027&lon=-137.12649&${q}&end=2027-04-01T00:00:00Z&days=30`);
    assertConforms('/v1/rank', r.body);
    assertConforms('/v1/landing-dates', l.body);
    assert.equal(w.body.terrain.source, 'catalog');
    const byId = Object.fromEntries(r.body.results.map((x) => [x.siteId, x]));
    const sun = byId['shackleton-rim'].metrics.sunTimeFraction;
    assert.equal(byId['shackleton-rim'].horizonModel, 'mask');
    assert.equal(byId['custom:-89.44027,-137.12649'].metrics.sunTimeFraction, sun, 'por coordenadas, la misma máscara');
    assert.ok(Math.abs(sun - w.body.sun.summary.fractionOfTime) < 0.01, `rank ${sun} frente a windows ${w.body.sun.summary.fractionOfTime}`);
    assert.equal(l.body.dates![0].metrics.sunTimeFraction, sun);
    assert.equal(lc.body.dates![0].metrics.sunTimeFraction, sun);
    assert.equal(l.body.terrain.source, 'catalog');
    assert.equal(l.body.site.horizonModel, 'mask');
    assert.equal(r.body.terrain.source, 'catalog');
    assert.equal(r.body.terrain.applied, true);
    // apollo11 has no catalogue mask: the ranking says so in `warnings`, landing-dates of shackleton-rim does not.
    // Both carry deep_polar_uncertainty (1.23.0): shackleton-rim is south of 85°S.
    const codes = (ws?: V1Warning[]): string[] => (ws ?? []).map((x) => x.code);
    assert.deepEqual(codes(r.body.warnings), ['terrain_not_applied', 'deep_polar_uncertainty']);
    assert.match(r.body.warnings![0].message, /1 de 3 sitios/);
    assert.match(r.body.warnings![1].message, /^shackleton-rim, custom:-89\.44027,-137\.12649: Al sur de 85°S/);
    assert.deepEqual(codes(l.body.warnings), ['deep_polar_uncertainty']);
    const flat = await get<WithTerrain<V1SunEarth>>('/v1/sun-earth?site=shackleton-rim&date=2027-04-15&terrain=1&observerHeightM=5');
    assert.ok(codes(flat.body.warnings).includes('terrain_not_applied'));
    // Without terrain=1 nothing changes: no catalogue mask and no new warning.
    const plain = await get<V1Rank>('/v1/rank?sites=shackleton-rim&start=2027-04-01T00:00:00Z&days=30');
    assert.equal(plain.body.results[0].metrics.sunTimeFraction, 0);
    assert.equal(plain.body.warnings, undefined);
  });

  test('coste GraphQL (1.13.0): la máscara del catálogo no cuenta como un cálculo en frío', async () => {
    const { executeRequest } = await import('../src/graphql/executor.ts');
    const est = (query: string): number => (executeRequest({ query }).body.extensions as { cost: { estimated: number } }).cost.estimated;
    assert.ok(est('{ site(id: "shackleton-rim") { horizon { azimuthStepDeg } } }') <= 5);
    assert.ok(est('{ site(id: "shackleton-rim") { sunEarth(at: "2027-01-15", terrain: {}) { date } } }') <= 60);
  });

  test('health (1.13.0): DEM, LDRM y sitios con máscara del catálogo', async () => {
    configureDem({ grids: [] });
    const h = await get<V1Health>('/v1/health');
    assertConforms('/v1/health', h.body);
    assert.deepEqual(h.body.terrain, { dem: false, demVersion: null, slopeProducts: false, slopeProductBaselinesM: [], catalogMaskSiteIds: ['im1', 'im2-objetivo', 'im2-alunizaje', 'chandrayaan3', 'shackleton-rim'] });
    const version = configureDem({ grids: [syntheticDem()] });
    try {
      assert.equal((await get<V1Health>('/v1/health')).body.terrain!.demVersion, version);
    } finally { configureDem({ grids: [] }); }
  });

  test('con DEM (sintético): coordenadas libres usan su máscara; fuera de cobertura, esfera', async () => {
    const version = configureDem({ grids: [syntheticDem()] });
    try {
      const s = await get<WithTerrain<V1SunEarth>>('/v1/sun-earth?lat=-89.5&lon=0&date=2027-01-15&terrain=1');
      assertConforms('/v1/sun-earth', s.body);
      assert.equal(s.body.site.horizonModel, 'mask');
      assert.equal(s.body.terrain.source, 'dem');
      assert.equal(s.body.terrain.demVersion, version);
      assert.ok(s.body.sun.horizonElevationDeg > 1, `la meseta levanta el horizonte (${s.body.sun.horizonElevationDeg}°)`);
      const far = await get<WithTerrain<V1Windows>>('/v1/windows?lat=0&lon=0&start=2027-01-01&end=2027-01-05&terrain=1');
      assertConforms('/v1/windows', far.body);
      assert.equal(far.body.site.horizonModel, 'sphere');
      assert.match(far.body.terrain.note, /fuera de la cobertura/);
      const r = await get<WithTerrain<V1Rank>>('/v1/rank?sites=shackleton-rim,apollo11,-89.5:0&start=2027-01-01&days=5&terrain=1');
      assertConforms('/v1/rank', r.body);
      const model = Object.fromEntries(r.body.results.map((c) => [c.siteId, c.horizonModel]));
      assert.deepEqual(model, { 'shackleton-rim': 'mask', apollo11: 'sphere', 'custom:-89.5,0': 'mask' });
      // Since 1.8.0 the hybrid horizon is on by default with a DEM mask and the terrain object says so.
      assert.deepEqual({ ...r.body.terrain, note: undefined }, { observerHeightM: 2, applied: true, source: 'dem', demVersion: version, horizonRefineDeg: 0.1, note: undefined });
      assert.match(r.body.terrain.note, /Horizonte híbrido: rayo directo .* 0,1°/);
      assert.equal(s.body.terrain.horizonRefineDeg, 0.1);
      // horizonRefine=0 (or horizonRefineDeg=0): mask only, the terrain object as in 1.7.0; another threshold is echoed.
      for (const off of ['horizonRefine=0', 'horizonRefineDeg=0']) {
        const o = await get<WithTerrain<V1Rank>>(`/v1/rank?sites=shackleton-rim,apollo11,-89.5:0&start=2027-01-01&days=5&terrain=1&${off}`);
        assert.deepEqual({ ...o.body.terrain, note: undefined }, { observerHeightM: 2, applied: true, source: 'dem', demVersion: version, note: undefined }, off);
        assert.doesNotMatch(o.body.terrain.note, /híbrido/);
      }
      const x = await get<WithTerrain<V1SunEarth>>('/v1/sun-earth?lat=-89.5&lon=0&date=2027-01-15&terrain=1&horizonRefineDeg=0.25');
      assert.equal(x.body.terrain.horizonRefineDeg, 0.25);
      for (const bad of ['horizonRefine=2', 'horizonRefineDeg=-0.1', 'horizonRefineDeg=3']) {
        assert.equal((await get(`/v1/sun-earth?lat=-89.5&lon=0&date=2027-01-15&terrain=1&${bad}`)).status, 400, bad);
      }
    } finally {
      configureDem({ grids: [] });
    }
  });
});

describe('/v1/light-map', () => {
  test('con DEM (sintético): el fondo del cuenco pasa más tiempo a la sombra que la meseta, y la malla es la del mapa polar', async () => {
    configureDem({ grids: [syntheticDem()] });
    try {
      const r = await get<V1LightMap>('/v1/light-map?radiusKm=40&spacingKm=5&start=2027-01-15T00:00:00Z&days=5&mode=full');
      assert.equal(r.status, 200, r.text);
      assertConforms('/v1/light-map', r.body);
      const p = r.body.points, n = r.body.count;
      assert.deepEqual(r.body.centre, { latDeg: -90, lonDeg: 0 }, 'sin centro, el polo sur');
      for (const k of Object.keys(p) as (keyof V1LightMap['points'])[]) assert.equal(p[k].length, n, k);
      assert.ok(p.withTerrain.every(Boolean) && r.body.terrain.applied);
      // Polar grid: the point at (x, y) km is at the distance hypot(x, y) from the pole, towards atan2(x, y) of longitude.
      const kmPerDeg = (Math.PI / 180) * 1737.4;
      for (let i = 0; i < n; i++) {
        assert.ok(Math.abs(p.latDeg[i] - (-90 + Math.hypot(p.xKm[i], p.yKm[i]) / kmPerDeg)) < 1e-3);
        assert.ok(Math.hypot(p.xKm[i], p.yKm[i]) <= 40 + 1e-9);
      }
      const mean = (pred: (d: number) => boolean): number => {
        const v = p.sunTimeFraction.filter((_, i) => pred(Math.hypot(p.xKm[i], p.yKm[i])));
        return v.reduce((a, b) => a + b, 0) / v.length;
      };
      const bowl = mean((d) => d <= 15), plateau = mean((d) => d >= 30);
      assert.ok(bowl < plateau, `el cuenco (${bowl}) debería tener menos Sol que la meseta (${plateau})`);
    } finally {
      configureDem({ grids: [] });
    }
  });

  test('sin DEM no falla: horizonte esférico y se indica; límite de puntos', async () => {
    configureDem({ grids: [] });
    const r = await get<V1LightMap>('/v1/light-map?lat=-89.5&lon=0&radiusKm=10&spacingKm=5&start=2027-01-15&days=1');
    assert.equal(r.status, 200, r.text);
    assertConforms('/v1/light-map', r.body);
    assert.ok(r.body.points.withTerrain.every((x) => !x) && !r.body.terrain.applied);
    assert.match(r.body.terrain.note, /no tiene el DEM/);
    assert.equal((await get('/v1/light-map?radiusKm=200&spacingKm=1')).status, 400);
  });
});

describe('/v1/horizon con relief=1 (1.19.0): alturas del terreno alrededor del sitio', () => {
  const R = 1737400, D2R = Math.PI / 180;

  test('sin relief la respuesta no lleva el campo; con relief y sin DEM, relief es null', async () => {
    configureDem({ grids: [] });
    const plain = await get<V1Horizon>('/v1/horizon?site=shackleton-rim');
    assert.ok(!('relief' in plain.body));
    const h = await get<V1Horizon>('/v1/horizon?site=shackleton-rim&relief=1');
    assertConforms('/v1/horizon', h.body);
    assert.equal(h.body.relief, null);
    assert.deepEqual({ ...h.body, relief: undefined }, { ...plain.body, relief: undefined });
    assert.ok(!('relief' in (await get<V1Horizon>('/v1/horizon?site=shackleton-rim&relief=0')).body));
  });

  test('con DEM (sintético): los anillos dan la silueta de la máscara', async () => {
    configureDem({ grids: [syntheticDem()] });
    try {
      const h = await get<V1Horizon>('/v1/horizon?lat=-89.5&lon=0&reliefRadiusKm=45');
      assertConforms('/v1/horizon', h.body);
      const relief = h.body.relief!;
      assert.equal(relief.radiusKm, 45);
      assert.equal(relief.heightsM.length, relief.distancesM.length);
      assert.equal(relief.distancesM.at(-1), 45000);
      assert.ok(relief.distancesM.every((d, j) => j === 0 || d > relief.distancesM[j - 1]));
      const nAz = Math.round(360 / relief.azimuthStepDeg);
      const r0 = R + relief.groundHeightM + h.body.terrain.observerHeightM;
      let worst = 0, mean = 0;
      for (let k = 0; k < nAz; k++) {
        let best = -Infinity;
        relief.heightsM.forEach((ring, j) => {
          assert.equal(ring.length, nAz);
          const z = ring[k]!, de = relief.distancesM[j] / R;
          best = Math.max(best, ((R + z) * Math.cos(de) - r0) / ((R + z) * Math.sin(de)));
        });
        const el = Math.atan(best) / D2R;
        const mask = h.body.elevationDeg[Math.round((k * relief.azimuthStepDeg) / h.body.azimuthStepDeg)];
        // On the cliff of the plateau a ring may hit the edge a little better than the march of the mask (120 m steps).
        assert.ok(el <= mask + 0.2, `acimut ${k}: el relieve (${el.toFixed(2)}°) supera la máscara (${mask}°)`);
        worst = Math.max(worst, mask - el); mean += (mask - el) / nAz;
      }
      // The rings are sparser than the march of the mask, so they may miss the very edge of the plateau, but not by much.
      assert.ok(worst < 1.5 && mean < 0.5, `la silueta de los anillos se aleja de la máscara: máx ${worst.toFixed(2)}°, media ${mean.toFixed(2)}°`);
      assert.equal((await get('/v1/horizon?lat=-89.5&lon=0&reliefRadiusKm=500')).status, 400);
    } finally { configureDem({ grids: [] }); }
  });
});
