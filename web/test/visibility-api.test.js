// The visibility adapter of the data API against the real API (issue #24): a server on an ephemeral port, no doubles.
// Under `node --test` the backend turns terrain off by itself, so the horizon is spherical unless a test
// configures a synthetic DEM in memory.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../data/src/server.ts';
import { windows as engineWindows } from '../../backend/src/service.ts';
import { configureMasks } from '../../backend/src/horizon.ts';
import { configureDem, makeGrid } from '../../backend/src/terrain/dem.ts';
import { intersect } from '../../planner/src/intervals.js';
import { apiVisibility } from '../js/adapters/visibility-api.js';
import { createMissionService } from '../js/application/mission-service.js';
import { createReplanService, describeHorizon, rangeFor } from '../js/application/replan-service.js';
import { SITES } from '../js/engine/catalog.js';
import { assertVisibilityPort } from '../js/ports/visibility.js';

const DAY_MS = 864e5;
const FROM = Date.UTC(2027, 2, 20), TO = Date.UTC(2027, 7, 20);

let server, baseUrl;
before(async () => {
  configureMasks({ diskCache: false }); // do not write mask caches during the tests
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

/** In-memory synthetic DEM centred on the south pole: flat bowl of 25 km radius surrounded by a 1500 m plateau. */
function syntheticDem() {
  const res = 240, half = 60000, n = Math.round((2 * half) / res), a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + (i + 0.5) * res, y = half - (j + 0.5) * res;
    a[j * n + i] = Math.hypot(x, y) > 25000 ? 1500 : 0;
  }
  return makeGrid({ name: 'synthetic', res, X0: -half, Y0: half, w: n, h: n, a });
}

const ridge = SITES.find((s) => s.id === 'shackleton-rim');
const equatorial = SITES.find((s) => s.id === 'apollo15');

describe('adaptador de visibilidad sobre /v1/windows', () => {
  test('cumple el puerto', () => {
    assertVisibilityPort(apiVisibility({ baseUrl }));
  });

  for (const site of SITES) {
    test(`${site.id}: ventanas con la forma del puerto`, async () => {
      const w = await apiVisibility({ baseUrl }).loadWindows(site, FROM, TO);
      assert.equal(w.startMs, FROM);
      assert.equal(w.endMs, TO);
      for (const key of ['sun', 'earth', 'sunAndEarth']) {
        let previousEnd = FROM;
        for (const [start, end] of w[key]) {
          assert.ok(start >= previousEnd && end > start && end <= TO, `${key}: intervalo [${start}, ${end}] desordenado, vacío o fuera del rango`);
          previousEnd = end;
        }
      }
      assert.deepEqual(w.sunAndEarth, intersect(w.sun, w.earth));
    });
  }

  test('conserva el id y el nombre de la interfaz, no el «custom:…» de la API', async () => {
    const w = await apiVisibility({ baseUrl }).loadWindows(ridge, FROM, TO);
    assert.deepEqual(w.site, { id: 'shackleton-rim', name: ridge.name, latDeg: ridge.lat, lonDeg: ridge.lon, horizonModel: 'sphere' });
  });

  test('pide relieve: con DEM en el servidor el horizonte es una máscara; con terrain desactivado, la esfera', async () => {
    configureDem({ grids: [syntheticDem()] });
    try {
      // Southern summer: over the smooth sphere the Sun circles just above the horizon of the pole.
      const summer = Date.UTC(2027, 11, 1);
      const withTerrain = await apiVisibility({ baseUrl }).loadWindows(ridge, summer, summer + 30 * DAY_MS);
      assert.equal(withTerrain.site.horizonModel, 'mask');
      const withoutTerrain = await apiVisibility({ baseUrl, terrain: false }).loadWindows(ridge, summer, summer + 30 * DAY_MS);
      assert.equal(withoutTerrain.site.horizonModel, 'sphere');
      // The plateau around the bowl hides part of the sky: less Sun than over the smooth sphere.
      const total = (list) => list.reduce((sum, [a, b]) => sum + (b - a), 0);
      assert.ok(total(withTerrain.sun) < total(withoutTerrain.sun));
    } finally {
      configureDem({ grids: [] });
    }
  });

  test('un rango de más de 366 días da las mismas ventanas que el motor en una sola pasada', async () => {
    const to = FROM + 500 * DAY_MS;
    const w = await apiVisibility({ baseUrl }).loadWindows(equatorial, FROM, to);
    const engine = engineWindows({ lat: equatorial.lat, lon: equatorial.lon }, FROM, to, { mode: 'full', mask: null });
    const intervals = (body) => body.windows.map((x) => [Date.parse(x.start), Date.parse(x.end)]);
    assert.deepEqual(w.sun, intervals(engine.sun));
    assert.deepEqual(w.earth, intervals(engine.earth));
    assert.equal(w.endMs, to);
  });

  const total = (list) => list.reduce((sum, [a, b]) => sum + (b - a), 0);

  test('banda de robustez del horizonte: las ventanas con el horizonte 0,3° más alto y más bajo, también en rangos partidos', async () => {
    const to = FROM + 500 * DAY_MS;
    const w = await apiVisibility({ baseUrl }).loadWindows(ridge, FROM, to, undefined, { band: true });
    const { deg, raised, lowered } = w.horizonBand;
    assert.equal(deg, 0.3);
    for (const key of ['sun', 'earth', 'sunAndEarth']) {
      assert.ok(total(raised[key]) <= total(w[key]) && total(w[key]) <= total(lowered[key]), key);
      assert.ok(raised[key].every(([start, end]) => start >= FROM && end <= to && end > start), key);
    }
    // Near the pole the Sun grazes the horizon: 0.3° changes its hours.
    assert.ok(total(raised.sun) < total(lowered.sun));
    // The pieces are joined like the nominal windows: the same as the engine in one pass with the horizon moved.
    const at = (el) => engineWindows({ lat: ridge.lat, lon: ridge.lon }, FROM, to, { mode: 'full', mask: { stepDeg: 360, el: [el], source: 'test' } });
    const intervals = (body) => body.windows.map((x) => [Date.parse(x.start), Date.parse(x.end)]);
    assert.deepEqual(raised.sun, intervals(at(0.3).sun));
    assert.deepEqual(lowered.earth, intervals(at(-0.3).earth));
    assert.ok(!('horizonBand' in await apiVisibility({ baseUrl, horizonBandDeg: 0 }).loadWindows(ridge, FROM, TO, undefined, { band: true })));
    assert.ok(!('horizonBand' in await apiVisibility({ baseUrl }).loadWindows(ridge, FROM, TO)), 'sin { band: true } no se pide la banda');
  });

  test('el servicio de misión da el rango de las cifras de un aterrizaje, con la cifra nominal dentro', async () => {
    const visibility = { ...apiVisibility({ baseUrl }), source: async () => 'api' };
    const service = createMissionService({ visibility, sites: [ridge] });
    const mission = { days: 14, batteryHours: 12, minEarthPct: 50, maxEarthGapHours: Infinity };
    const t = Date.UTC(2027, 0, 24, 12); // over the smooth sphere the Sun grazes the horizon of the pole these two weeks
    assert.equal(service.band(ridge, t, mission), null); // nothing loaded yet
    await service.prepare({ fromMs: t, toMs: t + 14 * DAY_MS });
    const { r } = service.judge(ridge, t, mission), band = service.band(ridge, t, mission);
    assert.equal(band.deg, 0.3);
    for (const key of ['pctSun', 'pctEarth', 'maxDarkHours']) {
      assert.ok(band[key].min <= r[key] && r[key] <= band[key].max, `${key}: ${band[key].min} ≤ ${r[key]} ≤ ${band[key].max}`);
    }
    assert.ok(band.pctSun.max > band.pctSun.min);
    assert.equal(service.band(ridge, t + 400 * DAY_MS, mission), null); // outside the loaded windows
    // Without the band (the simulated engine, or an API before 1.18) there is no range.
    const plain = createMissionService({ visibility: { ...apiVisibility({ baseUrl, horizonBandDeg: 0 }), source: async () => 'api' }, sites: [ridge] });
    await plain.prepare({ fromMs: t, toMs: t + 14 * DAY_MS });
    assert.equal(plain.band(ridge, t, mission), null);
  });

  test('modo DSN (#103): earthDsn dentro de la Tierra, también en rangos partidos, y el % de la misión en el servicio', async () => {
    const to = FROM + 400 * DAY_MS;
    const w = await apiVisibility({ baseUrl }).loadWindows(equatorial, FROM, to, undefined, { dsn: true });
    assert.deepEqual(intersect(w.earthDsn, w.earth), w.earthDsn);
    assert.ok(total(w.earthDsn) < total(w.earth) && total(w.earthDsn) > 0.5 * total(w.earth));
    assert.ok(!('earthDsn' in await apiVisibility({ baseUrl }).loadWindows(equatorial, FROM, TO)), 'sin { dsn: true } no se pide');
    const service = createMissionService({ visibility: { ...apiVisibility({ baseUrl }), source: async () => 'api' }, sites: [equatorial] });
    const mission = { days: 14, batteryHours: 300, minEarthPct: 50, maxEarthGapHours: Infinity };
    const t = Date.UTC(2027, 3, 1);
    assert.equal(service.earthDsn(equatorial, t, mission), null); // nothing loaded yet
    await service.prepare({ fromMs: t, toMs: t + 14 * DAY_MS });
    const { r, verdict } = service.judge(equatorial, t, mission), pct = service.earthDsn(equatorial, t, mission);
    assert.ok(pct > 50 && pct < r.pctEarth, `${pct} < ${r.pctEarth}`);
    // It only informs: the verdict is the same without the DSN mode.
    const plain = createMissionService({ visibility: { ...apiVisibility({ baseUrl }), loadWindows: (s, a, b, h, o) => apiVisibility({ baseUrl }).loadWindows(s, a, b, h, { ...o, dsn: false }), source: async () => 'api' }, sites: [equatorial] });
    await plain.prepare({ fromMs: t, toMs: t + 14 * DAY_MS });
    assert.deepEqual(plain.judge(equatorial, t, mission).verdict, verdict);
    assert.equal(plain.earthDsn(equatorial, t, mission), null);
  });

  test('con la API parada, falla con un mensaje que dice dónde la buscó', async () => {
    const closed = createApp();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const dead = `http://127.0.0.1:${closed.address().port}`;
    await new Promise((resolve) => closed.close(resolve));
    await assert.rejects(apiVisibility({ baseUrl: dead }).loadWindows(ridge, FROM, TO), (e) => e.message.includes(dead));
  });

  test('el servicio de Replanificar se prepara con este adaptador', async () => {
    const service = createReplanService({ visibility: apiVisibility({ baseUrl }), sites: SITES });
    const range = rangeFor({ originalLandingMs: Date.UTC(2027, 3, 3, 12), notAfterMs: Date.UTC(2027, 3, 20), days: 10 });
    assert.ok(!service.isReady(range));
    await service.prepare(range);
    assert.ok(service.isReady(range));
    assert.deepEqual(Object.keys(service.horizonModels()), SITES.map((s) => s.id));
    assert.match(describeHorizon(service.horizonModels()), /^Datos reales sobre una Luna lisa \(sin relieve\)/);
  });

  test('el origen de los datos distingue simulado, con relieve, sin relieve y mezcla', () => {
    assert.match(describeHorizon({ a: 'simulated-terrain', b: 'simulated-terrain' }), /^Datos de ejemplo/);
    assert.match(describeHorizon({ a: 'mask', b: 'mask' }), /con relieve LOLA en todos los sitios\.$/);
    assert.match(describeHorizon({ a: 'mask', b: 'sphere', c: 'sphere' }), /con relieve LOLA en 1 de 3 sitios/);
  });
});

describe('comprobación de que la API está viva', () => {
  test('con la API arrancada, check resuelve', async () => {
    const health = await apiVisibility({ baseUrl }).check();
    assert.equal(health.status, 'ok');
  });

  test('con la API parada, check rechaza: la interfaz vuelve al motor simulado', async () => {
    const closed = createApp();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const dead = `http://127.0.0.1:${closed.address().port}`;
    await new Promise((resolve) => closed.close(resolve));
    await assert.rejects(apiVisibility({ baseUrl: dead }).check());
  });
});

describe('relieve para el cielo en 3D (/v1/horizon?relief=1, issue #62)', () => {
  test('sin DEM en el servidor no hay alturas: null, y el 3D dibuja solo la silueta', async () => {
    configureDem({ grids: [] });
    assert.equal(await apiVisibility({ baseUrl }).loadRelief(ridge), null);
    assert.equal(await apiVisibility({ baseUrl, terrain: false }).loadRelief(ridge), null);
  });

  test('con DEM: elevaciones aparentes del terreno que no sobresalen de la máscara del cielo 2D', async () => {
    configureDem({ grids: [syntheticDem()] });
    try {
      const api = apiVisibility({ baseUrl }), site = { id: 'bowl', name: 'Cuenco', lat: -89.5, lon: 0 };
      const [relief, sky] = await Promise.all([api.loadRelief(site), api.loadSky(site, FROM, FROM + DAY_MS)]);
      assert.equal(relief.source, 'lola');
      assert.equal(relief.azimuthStepDeg, 1);
      assert.equal(relief.tan.length, relief.distancesKm.length * 360);
      assert.equal(relief.distancesKm.at(-1), 30);
      let rim = 0;
      for (let a = 0; a < 360; a++) {
        let best = -Infinity;
        relief.distancesKm.forEach((_, j) => { best = Math.max(best, relief.tan[j * 360 + a]); });
        const el = Math.atan(best) * 180 / Math.PI;
        assert.ok(el <= sky.horizon.mask[a] + 0.2, `acimut ${a}: relieve ${el.toFixed(2)}° sobre la máscara ${sky.horizon.mask[a]}°`);
        if (el > 1) rim++;
      }
      assert.ok(rim > 90, 'la meseta que rodea el cuenco se ve en el relieve');
    } finally { configureDem({ grids: [] }); }
  });
});
