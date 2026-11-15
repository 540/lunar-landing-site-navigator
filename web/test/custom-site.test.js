// A point of the user's own in Plan (issue #101): typed coordinates, validated, and judged by the same mission service
// as a catalogue site. Against the simulated engine and against the real API on an ephemeral port (no doubles).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../data/src/server.ts';
import { configureMasks } from '../../backend/src/horizon.ts';
import { apiVisibility } from '../js/adapters/visibility-api.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { createMissionService } from '../js/application/mission-service.js';
import { SITES } from '../js/engine/catalog.js';
import { customSite, parseCoords, CUSTOM_SITE_ID } from '../js/common/custom-site.js';
import { parseMission, planUrl, viewerUrl, regionNear } from '../../viewpoint/src/core/mission-link.js';

const DAY = 864e5;
const mission = { days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48 };
const from = Date.parse('2027-03-25T00:00:00Z'), to = Date.parse('2027-04-10T12:00:00Z');
const range = { fromMs: from - DAY, toMs: to + 20 * DAY };

describe('coordenadas de un punto propio', () => {
  test('acepta la coma decimal y el signo menos tipográfico', () => {
    assert.deepEqual(parseCoords('−89,45', '-137.3'), { lat: -89.45, lon: -137.3 });
    assert.deepEqual(parseCoords('90', '180'), { lat: 90, lon: 180 });
  });

  test('cada campo mal escrito dice por qué, en español', () => {
    assert.deepEqual(Object.keys(parseCoords('', '').errors), ['lat', 'lon']);
    assert.match(parseCoords('-90.5', '0').errors.lat, /de −90° .* a 90°/);
    assert.match(parseCoords('0', '181').errors.lon, /de −180° a 180°/);
    assert.match(parseCoords('sur', '0').errors.lat, /número/);
    assert.equal(parseCoords('-89', 'x').errors.lat, undefined);
  });

  test('las mismas coordenadas son el mismo sitio; otras, otro', () => {
    assert.equal(customSite(-89.45, -137.3), customSite(-89.450001, -137.3));
    assert.notEqual(customSite(-89.45, -137.3).id, customSite(-89.46, -137.3).id);
  });
});

describe('el punto viaja en el enlace', () => {
  const plan = { siteId: CUSTOM_SITE_ID, lat: -86.01, lon: 0.2, t0: Date.parse('2027-04-03T12:00:00Z'), days: 10, batteryHours: 12, minEarthPct: 60, profile: null };
  const searchOf = url => url.slice(url.indexOf('?'), url.includes('#') ? url.indexOf('#') : undefined);

  test('al visor 3D y de vuelta a Planificar, con su latitud y su longitud', () => {
    for (const url of [viewerUrl(plan), planUrl(plan)]) {
      assert.match(url, /site=custom&lat=-86\.01&lon=0\.2&/);
      assert.deepEqual(parseMission(searchOf(url)), { ...plan, maxEarthGapHours: undefined, profile: null });
    }
  });

  test('unas coordenadas imposibles hacen el enlace inválido', () => {
    assert.deepEqual(parseMission('?site=custom&lat=-95&lon=0&t0=2027-04-03T12:00:00Z&days=10'), { error: 'bad-coords' });
    assert.deepEqual(parseMission('?site=custom&t0=2027-04-03T12:00:00Z&days=10'), { error: 'bad-coords' });
  });

  test('el 3D se abre con la región del sitio que tiene cerca, y sin ninguna cerca no hay región', () => {
    assert.equal(regionNear({ lat: -86.01, lon: 0.2 }, SITES), 'malapert');
    assert.equal(regionNear({ lat: -80, lon: 60 }, SITES), null);
  });
});

/** A point of the user's own on the coordinates of each catalogue site gives the verdict and the figures of that site. */
async function sameAsCatalogue(visibility, sites) {
  const ids = new Map(sites.map(s => [s.id, customSite(s.lat, s.lon)]));
  let own = [];
  const service = createMissionService({ visibility, sites: () => [...sites, ...own] });
  await service.prepare(range);
  own = [...ids.values()]; // they join after the catalogue is loaded, as when the user types them in Plan
  assert.equal(service.isReady(range), false, 'a point that joins is not ready until its windows load');
  await service.prepare(range);
  assert.equal(service.isReady(range), true);
  for (const s of sites) {
    const p = ids.get(s.id);
    assert.equal(service.horizonModel(p.id), service.horizonModel(s.id), s.id);
    for (let t = from; t <= to; t += 24 * 3600e3) {
      assert.deepEqual(service.judge(p, t, mission), service.judge(s, t, mission), `${s.id} · ${new Date(t).toISOString()}`);
    }
    const res = await service.search({ sites: [s, p], from, to, priority: 'energy', profile: 'small-robotic', ...mission });
    const [a, b] = [s, p].map(x => res.options.find(o => o.site === x));
    assert.equal(b.landing, a.landing, `${s.id}: the same best landing`);
    assert.equal(b.verdict.code, a.verdict.code, s.id);
  }
}

describe('un punto propio con las coordenadas de un sitio da su mismo veredicto', () => {
  test('con el motor simulado', async () => {
    await sameAsCatalogue({ ...fakeVisibility, source: async () => 'fake' }, SITES.filter(s => !s.offMap));
  });

  describe('con la API de datos', () => {
    let server, baseUrl;
    before(async () => {
      configureMasks({ diskCache: false });
      server = createApp();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => new Promise(resolve => server.close(resolve)));

    test('ventanas y ranking del servidor', async () => {
      const api = apiVisibility({ baseUrl });
      await sameAsCatalogue({ ...api, source: async () => 'api' }, SITES.filter(s => ['shackleton-rim', 'malapert'].includes(s.id)));
    });
  });
});
