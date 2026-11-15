// Deep polar note (#437), against the real API on an ephemeral port, no doubles: south of 85°S the API warns
// `deep_polar_uncertainty` with terrain, and the mission service says so for the Shackleton connecting ridge and not
// for IM-2 (84.8°S); with the simulated engine there is no warning. Under `node --test` the backend has no DEM: the
// catalogue masks (backend/terrain/masks) give the terrain. The note itself, in Spanish and in English.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../data/src/server.ts';
import { configureMasks, loadCatalogMasks } from '../../backend/src/horizon.ts';
import { apiVisibility } from '../js/adapters/visibility-api.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { createMissionService } from '../js/application/mission-service.js';
import { deepPolarNote } from '../js/common/ui.js';
import { t } from '../js/common/i18n.js';
import { SITES } from '../js/engine/catalog.js';

const DAY_MS = 864e5;
const ridge = SITES.find(s => s.id === 'shackleton-rim'), im2 = SITES.find(s => s.id === 'im2-objetivo');
const RANGE = { fromMs: Date.UTC(2027, 0, 10), toMs: Date.UTC(2027, 0, 20), panelHeightM: 2, antennaHeightM: 2 };

let server, baseUrl;
before(async () => {
  configureMasks({ diskCache: false });
  loadCatalogMasks(fileURLToPath(new URL('../../backend/terrain', import.meta.url)));
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

test('con la API, la cresta de Shackleton lleva el aviso del polo profundo e IM-2 no', async () => {
  const ms = createMissionService({ visibility: { ...apiVisibility({ baseUrl }), source: async () => 'api' }, sites: [ridge, im2] });
  await ms.prepare(RANGE);
  assert.equal(ms.horizonModel(ridge.id), 'mask', 'la cresta tiene relieve (máscara del catálogo)');
  assert.equal(ms.deepPolar(ridge), true);
  assert.equal(ms.horizonModel(im2.id), 'mask', 'IM-2 también tiene relieve: sin aviso por estar al norte de 85°S');
  assert.equal(ms.deepPolar(im2), false);
});

test('un punto abierto como sitio propio al sur de 85°S lleva el aviso', async () => {
  const ms = createMissionService({ visibility: { ...apiVisibility({ baseUrl }), source: async () => 'api' }, sites: [ridge] });
  await ms.prepare(RANGE);
  const mission = { days: 3, batteryHours: 50, minEarthPct: 10 };
  const p = await ms.point({ id: 'p1', name: 'P1', lat: ridge.lat, lon: ridge.lon }, RANGE.fromMs + DAY_MS, mission);
  assert.equal(p.deepPolar, true);
});

test('con el motor simulado no hay aviso', async () => {
  const ms = createMissionService({ visibility: fakeVisibility, sites: [ridge, im2] });
  await ms.prepare(RANGE);
  assert.equal(ms.deepPolar(ridge), false);
  assert.equal(ms.deepPolar(im2), false);
});

test('la nota: texto corto, enlace a «Cómo sabemos que es correcto» y oculta salvo que toque', () => {
  const on = deepPolarNote(t('common.deepPolar.text'), t('common.deepPolar.link'), { id: 'x', on: true });
  assert.match(on, /^<p class="deep-polar-note" id="x">Al sur de 85°S .*<a href="#sources">Cómo sabemos que es correcto<\/a><\/p>$/);
  assert.match(deepPolarNote('a', 'b'), / hidden>/);
});

test('la nota en inglés (?lang=en)', () => {
  // The language is fixed when i18n.js loads: ask a fresh process.
  const code = `globalThis.document = { documentElement: { lang: '' } }; globalThis.location = { search: '?lang=en', hash: '' };
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {} } });
    const { t } = await import(${JSON.stringify(new URL('../js/common/i18n.js', import.meta.url).href)});
    console.log(JSON.stringify([t('common.deepPolar.text'), t('common.deepPolar.link')]));`;
  const [text, link] = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }));
  assert.match(text, /^South of 85°S /);
  assert.equal(link, 'How we know it is right');
});
