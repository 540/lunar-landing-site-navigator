// Panel and antenna heights of the mission (issue #66): they travel through the visibility port to /v1/windows,
// /v1/track and /v1/best-landings, they change the result, and the services keep the data of each pair apart.
// Real API on an ephemeral port, no doubles: a synthetic DEM in memory where a few metres change the near horizon.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../data/src/server.ts';
import { configureMasks } from '../../backend/src/horizon.ts';
import { configureDem, llToXY, makeGrid } from '../../backend/src/terrain/dem.ts';
import { apiVisibility } from '../js/adapters/visibility-api.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { createMissionService, describeHeights } from '../js/application/mission-service.js';
import { createReplanService, rangeFor } from '../js/application/replan-service.js';
import { DEFAULT_HEIGHT_M, heightsKey, heightsOf, parseHeight } from '../js/ports/visibility.js';

const DAY_MS = 864e5;
// Flat floor with a 30 m step 1 km around the site: from 2 m the step hides the low Sun and Earth, from 40 m it does not.
const SITE = { id: 'step', name: 'Escalón', short: 'Escalón', lat: -89.5, lon: 0 };
const FROM = Date.UTC(2027, 0, 10), TO = FROM + 14 * DAY_MS;
const LOW = { panelHeightM: 2, antennaHeightM: 2 }, TALL_PANEL = { panelHeightM: 40, antennaHeightM: 2 }, TALL_ANTENNA = { panelHeightM: 2, antennaHeightM: 40 };

let server, baseUrl;
const requests = []; // every URL asked to the API, to see the heights arrive
const realFetch = globalThis.fetch;
before(async () => {
  configureMasks({ diskCache: false });
  const [cx, cy] = llToXY(SITE.lat, SITE.lon);
  const res = 60, half = 20000, n = Math.round((2 * half) / res), a = new Float32Array(n * n), X0 = cx - half, Y0 = cy + half;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = Math.hypot(X0 + (i + 0.5) * res - cx, Y0 - (j + 0.5) * res - cy) > 1000 ? 30 : 0;
  configureDem({ grids: [makeGrid({ name: 'step', res, X0, Y0, w: n, h: n, a })] });
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = (url, ...rest) => { requests.push(new URL(String(url))); return realFetch(url, ...rest); };
});
after(async () => {
  globalThis.fetch = realFetch;
  configureDem({ grids: [] });
  await new Promise((resolve) => server.close(resolve));
});

const total = (list) => list.reduce((sum, [a, b]) => sum + (b - a), 0);
const lastTo = (path) => requests.filter((u) => u.pathname === path).at(-1);
const sentHeights = (u) => [u.searchParams.get('panelHeightM'), u.searchParams.get('antennaHeightM')];

describe('las alturas llegan a la API y cambian el resultado', () => {
  test('/v1/windows: el panel decide el Sol y la antena, la Tierra', async () => {
    const api = apiVisibility({ baseUrl });
    const low = await api.loadWindows(SITE, FROM, TO, LOW);
    assert.deepEqual(sentHeights(lastTo('/v1/windows')), ['2', '2']);
    assert.equal(low.site.horizonModel, 'mask');

    const tallPanel = await api.loadWindows(SITE, FROM, TO, TALL_PANEL);
    assert.deepEqual(sentHeights(lastTo('/v1/windows')), ['40', '2']);
    assert.ok(total(tallPanel.sun) > total(low.sun), `con el panel a 40 m hay más Sol (${total(tallPanel.sun)} frente a ${total(low.sun)})`);
    assert.deepEqual(tallPanel.earth, low.earth, 'la Tierra no depende del panel');

    const tallAntenna = await api.loadWindows(SITE, FROM, TO, TALL_ANTENNA);
    assert.deepEqual(sentHeights(lastTo('/v1/windows')), ['2', '40']);
    assert.ok(total(tallAntenna.earth) > total(low.earth), 'con la antena a 40 m se ve más la Tierra');
    assert.deepEqual(tallAntenna.sun, low.sun, 'el Sol no depende de la antena');
  });

  test('sin alturas la petición es la de antes y el resultado, el de 2 m', async () => {
    const api = apiVisibility({ baseUrl });
    const plain = await api.loadWindows(SITE, FROM, TO);
    assert.deepEqual(sentHeights(lastTo('/v1/windows')), [null, null]);
    const low = await api.loadWindows(SITE, FROM, TO, LOW);
    assert.deepEqual([plain.sun, plain.earth], [low.sun, low.earth]);
  });

  test('/v1/track: el cielo hora a hora usa el horizonte de cada altura', async () => {
    const api = apiVisibility({ baseUrl });
    const low = await api.loadSky(SITE, FROM, FROM + 2 * DAY_MS, LOW);
    const tall = await api.loadSky(SITE, FROM, FROM + 2 * DAY_MS, TALL_PANEL);
    assert.deepEqual(sentHeights(lastTo('/v1/track')), ['40', '2']);
    assert.equal(lastTo('/v1/horizon').searchParams.get('observerHeightM'), '40', 'la silueta dibujada es la del panel');
    assert.equal(tall.series.length, low.series.length);
    assert.ok(tall.series.every((k, i) => k.sun.horizon < low.series[i].sun.horizon), 'desde 40 m el escalón queda más bajo para el Sol');
    assert.deepEqual(tall.series.map((k) => k.earth), low.series.map((k) => k.earth), 'la Tierra sigue en 2 m');
  });

  test('/v1/best-landings: el ranking del servidor recibe las mismas alturas', async () => {
    const api = apiVisibility({ baseUrl });
    const cond = { sites: [SITE], from: FROM, to: FROM + 2 * DAY_MS, days: 5, batteryHours: 12, minEarthPct: 60, priority: 'energy' };
    const low = await api.loadBestLandings({ ...cond, ...LOW });
    const tall = await api.loadBestLandings({ ...cond, ...TALL_PANEL });
    assert.deepEqual(sentHeights(lastTo('/v1/best-landings')), ['40', '2']);
    assert.ok(tall.options[0].metrics.sunFraction > low.options[0].metrics.sunFraction, 'más Sol con el panel alto');
  });
});

describe('los servicios guardan los datos de cada par de alturas por separado', () => {
  const mission = { days: 5, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48 };
  const range = { fromMs: FROM, toMs: FROM + 6 * DAY_MS };

  test('Planificar y Avanzado: otras alturas no están listas, se cargan y cambian las cifras', async () => {
    const api = apiVisibility({ baseUrl });
    const service = createMissionService({ visibility: { ...api, source: async () => 'api' }, sites: [SITE] });
    assert.equal(service.heightsEffect(), null);
    await service.prepare({ ...range, ...LOW });
    assert.ok(service.isReady({ ...range, ...LOW }));
    assert.ok(service.isReady(range), 'sin alturas son las de por defecto');
    assert.ok(!service.isReady({ ...range, ...TALL_PANEL }), 'las ventanas de 2 m no valen para un panel a 40 m');
    assert.equal(service.heightsEffect(), 'applied');
    const low = service.judge(SITE, FROM, mission).r;

    const before = requests.length;
    await service.prepare({ ...range, ...TALL_PANEL });
    assert.ok(requests.length > before, 'vuelve a pedir las ventanas');
    assert.deepEqual(service.heights, TALL_PANEL);
    assert.ok(service.isReady({ ...range, ...TALL_PANEL }) && !service.isReady({ ...range, ...LOW }));
    const tall = service.judge(SITE, FROM, mission).r;
    assert.ok(tall.pctSun > low.pctSun, `más tiempo con Sol con el panel a 40 m (${tall.pctSun} % frente a ${low.pctSun} %)`);
    assert.equal(tall.pctEarth, low.pctEarth);

    // The sky drawn is the one of the loaded heights, and each pair has its own cache entry.
    const sky = await new Promise((resolve) => { const hit = service.sky(SITE, FROM, 2, resolve); if (hit) resolve(hit); });
    assert.deepEqual(sentHeights(lastTo('/v1/track')), ['40', '2']);
    await service.prepare({ ...range, ...LOW });
    const skyLow = await new Promise((resolve) => { const hit = service.sky(SITE, FROM, 2, resolve); if (hit) resolve(hit); });
    assert.deepEqual(sentHeights(lastTo('/v1/track')), ['2', '2']);
    assert.ok(sky.series[0].sun.horizon < skyLow.series[0].sun.horizon);
  });

  test('Replanificar: el rango lleva las alturas y el servicio las pide', async () => {
    const service = createReplanService({ visibility: apiVisibility({ baseUrl }), sites: [SITE] });
    const input = { originalLandingMs: FROM, notAfterMs: FROM + 5 * DAY_MS, days: 5 };
    const low = rangeFor({ ...input, heights: LOW }), tall = rangeFor({ ...input, heights: TALL_PANEL });
    await service.prepare(low);
    assert.ok(service.isReady(low) && service.isReady(rangeFor(input)) && !service.isReady(tall));
    const lowSun = total(service.windows(SITE.id).sun);
    await service.prepare(tall);
    assert.deepEqual(sentHeights(lastTo('/v1/windows')), ['40', '2']);
    assert.ok(service.isReady(tall) && !service.isReady(low));
    assert.ok(total(service.windows(SITE.id).sun) > lowSun);
  });

  test('con el motor simulado las alturas no cambian nada y la interfaz lo dice', async () => {
    const site = { id: 'shackleton-rim', name: 'Cresta', lat: -89.45, lon: -137.3 };
    const low = await fakeVisibility.loadWindows(site, FROM, TO, LOW), tall = await fakeVisibility.loadWindows(site, FROM, TO, TALL_PANEL);
    assert.deepEqual([tall.sun, tall.earth], [low.sun, low.earth]);
    const service = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites: [site] });
    await service.prepare({ ...range, ...TALL_PANEL });
    assert.equal(service.heightsEffect(), 'simulated');
    assert.match(describeHeights(service.heightsEffect()), /datos de ejemplo no se usan estas alturas/);
    assert.match(describeHeights('no-terrain'), /no tiene el relieve LOLA/);
  });
});

test('las alturas del formulario: por defecto 2 m, dentro de los límites de la API', () => {
  assert.equal(DEFAULT_HEIGHT_M, 2);
  assert.deepEqual(heightsOf({}), { panelHeightM: 2, antennaHeightM: 2 });
  assert.deepEqual(heightsOf(undefined), { panelHeightM: 2, antennaHeightM: 2 });
  assert.equal(parseHeight(''), 2);
  assert.equal(parseHeight('abc'), 2);
  assert.equal(parseHeight('0'), 0, 'cero es una altura válida, no «vacío»');
  assert.equal(parseHeight('7.5'), 7.5);
  assert.equal(parseHeight('250'), 100);
  assert.equal(parseHeight('-3'), 0);
  assert.equal(heightsKey({ panelHeightM: '10', antennaHeightM: 2 }), heightsKey({ panelHeightM: 10, antennaHeightM: '2' }));
  assert.notEqual(heightsKey(LOW), heightsKey(TALL_PANEL));
  assert.notEqual(heightsKey(TALL_PANEL), heightsKey(TALL_ANTENNA));
});
