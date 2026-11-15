// Energy of the solar panel with its orientation (#254), against the real API on an ephemeral port, no doubles: the
// adapter gives what /v1/rank gives for the same site, dates and panel; a horizontal panel at the Shackleton connecting
// ridge gets a few per cent; and no verdict depends on the orientation. Under `node --test` the terrain is off.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../data/src/server.ts';
import { configureMasks } from '../../backend/src/horizon.ts';
import { apiVisibility } from '../js/adapters/visibility-api.js';
import { autoVisibility } from '../js/adapters/visibility-auto.js';
import { createMissionService } from '../js/application/mission-service.js';
import { PANELS } from '../js/engine/panel.js';
import { SITES } from '../js/engine/catalog.js';

const DAY_MS = 864e5;
const ridge = SITES.find(s => s.id === 'shackleton-rim');
const T0 = Date.UTC(2027, 0, 24, 12), DAYS = 10; // the Sun grazes the horizon of the pole these days

let server, baseUrl;
before(async () => {
  configureMasks({ diskCache: false });
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

async function rank(panel) {
  const q = new URLSearchParams({ sites: `${ridge.lat}:${ridge.lon}`, start: new Date(T0).toISOString(), days: String(DAYS), panel, terrain: '1', panelHeightM: '2', antennaHeightM: '2' });
  const res = await fetch(`${baseUrl}/v1/rank?${q}`);
  assert.equal(res.status, 200);
  return (await res.json()).results[0].metrics.meanSunDiskFraction;
}

test('la energía del adaptador es la de la API para el mismo sitio, fechas y panel', async () => {
  const api = apiVisibility({ baseUrl });
  for (const panel of PANELS) {
    const e = await api.loadEnergy({ lat: ridge.lat, lon: ridge.lon, fromMs: T0, days: DAYS, panel, panelHeightM: 2, antennaHeightM: 2 });
    assert.equal(e.energy, await rank(panel), panel);
    assert.equal(e.panel, panel);
  }
});

test('con panel horizontal en la Cresta de conexión de Shackleton la energía cae a unos pocos puntos porcentuales', async () => {
  const api = apiVisibility({ baseUrl });
  const at = panel => api.loadEnergy({ lat: ridge.lat, lon: ridge.lon, fromMs: T0, days: DAYS, panel });
  const [tracking, vertical, horizontal] = await Promise.all(PANELS.map(at));
  assert.ok(tracking.energy > 0.2, `seguidor: ${tracking.energy}`);
  assert.ok(vertical.energy > 0.99 * tracking.energy, 'vertical giratorio: casi lo mismo que el seguidor');
  assert.ok(horizontal.energy > 0 && horizontal.energy < 0.05 * tracking.energy, `horizontal: ${horizontal.energy} frente a ${tracking.energy}`);
  assert.ok(horizontal.energy < 0.05, 'unos pocos puntos porcentuales');
});

test('el servicio de misión da la energía con las alturas cargadas; con cualquier orientación, el veredicto es el mismo', async () => {
  const ms = createMissionService({ visibility: { ...apiVisibility({ baseUrl }), source: async () => 'api' }, sites: [ridge] });
  const cond = { sites: [ridge], from: T0 - 3 * DAY_MS, to: T0 + 3 * DAY_MS, days: DAYS, batteryHours: 12, minEarthPct: 50, priority: 'energy', panelHeightM: 2, antennaHeightM: 2 };
  await ms.prepare({ fromMs: cond.from - DAY_MS, toMs: cond.to + (DAYS + 2) * DAY_MS, panelHeightM: 2, antennaHeightM: 2 });
  assert.equal((await ms.energy(ridge, T0, DAYS, 'horizontal')).energy, await rank('horizontal'));
  const shape = r => r.options.map(o => [o.site.id, o.landing, o.verdict.code, o.result.pctSun, o.result.maxDarkHours, o.score]);
  const tracking = shape(await ms.search({ ...cond, panel: 'tracking' }));
  for (const panel of ['vertical-rotating', 'horizontal']) assert.deepEqual(shape(await ms.search({ ...cond, panel })), tracking, panel);
  assert.deepEqual(shape(await ms.search(cond)), tracking, 'sin orientación, lo de siempre');
});

test('la web pide la energía por el adaptador que usa (autoVisibility): la de la API, y con el motor simulado dice que la necesita', async () => {
  const { visibility } = autoVisibility(new URLSearchParams({ api: baseUrl }));
  const e = await visibility.loadEnergy({ lat: ridge.lat, lon: ridge.lon, fromMs: T0, days: DAYS, panel: 'horizontal', panelHeightM: 2, antennaHeightM: 2 });
  assert.equal(e.energy, await rank('horizontal'));
  const fake = autoVisibility(new URLSearchParams({ data: 'fake' })).visibility;
  await assert.rejects(fake.loadEnergy({ lat: ridge.lat, lon: ridge.lon, fromMs: T0, days: DAYS, panel: 'horizontal' }), /La energía del panel necesita la API de datos/);
});
