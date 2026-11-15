// Orientation of the solar panel as part of the spacecraft (#254): the rule C13, the example spacecraft, the link, the
// history, the CSV and the simulated engine, which does not compute the energy. Pure: no API (panel-energy.test.js has it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PANELS, DEFAULT_PANEL, panelOf, panelName, panelFormula, panelUselessAt, maxSunElevationDeg, horizontalMaxPct } from '../js/engine/panel.js';
import { checkCoherence, blockers } from '../js/engine/coherence.js';
import { PROFILES, SITES } from '../js/engine/catalog.js';
import { parseMission, linkSearch, viewerUrl, planUrl, MISSION_KEYS } from '../../viewpoint/src/core/mission-link.js';
import { missionEntry } from '../js/common/mission-history.js';
import { siteComparisonCsv, SITE_COMPARISON_HEADERS } from '../js/application/csv-export.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { createMissionService } from '../js/application/mission-service.js';

const ridge = SITES.find(s => s.id === 'shackleton-rim');
const apollo = SITES.find(s => s.id === 'apollo15');
const SHIP = { days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48, transitDays: 8, panelHeightM: 2, antennaHeightM: 2 };

test('las tres orientaciones del motor, con su nombre y su factor; por defecto, el seguidor', () => {
  assert.deepEqual(PANELS, ['tracking', 'vertical-rotating', 'horizontal']);
  assert.equal(DEFAULT_PANEL, 'tracking');
  assert.deepEqual(PANELS.map(panelName), ['Seguidor de dos ejes', 'Vertical giratorio', 'Horizontal fijo']);
  assert.deepEqual(PANELS.map(panelFormula), ['1', 'cos(el)', 'max(0, sen(el))']);
  assert.equal(panelOf('vertical-fixed'), null, 'un panel vertical fijo no está modelado: no se ofrece');
  assert.equal(panelOf(undefined), null);
});

test('C13: panel horizontal a más de 80° de latitud → aviso con la cifra; nunca bloquea', () => {
  const issues = checkCoherence({ ...SHIP, panel: 'horizontal', siteLatDeg: ridge.lat });
  const c13 = issues.find(i => i.id === 'C13');
  assert.ok(c13, 'aparece el aviso');
  assert.equal(c13.level, 'warn');
  assert.equal(c13.field, 'panel');
  assert.match(c13.message, /no sube de 2,1° .* como mucho un 3,7 %/);
  assert.match(c13.message, new RegExp(`${Math.abs(ridge.lat).toFixed(1).replace('.', ',')}°`));
  assert.match(c13.source, /Astrobotic/);
  assert.equal(blockers(issues).length, 0, 'no bloquea la búsqueda: solo informa');
});

test('C13: la cifra es la de la latitud del sitio, no la del polo', () => {
  // The Sun peaks at 90° − |lat| + 1.54°: 11.4° at IM-1, 5.5° at Malapert, 2.1° at the Shackleton ridge.
  for (const [id, sun, pct] of [['im1', '11,4', '19,8'], ['malapert', '5,5', '9,7'], ['shackleton-rim', '2,1', '3,7']]) {
    const site = SITES.find(s => s.id === id);
    const c13 = checkCoherence({ ...SHIP, panel: 'horizontal', siteLatDeg: site.lat }).find(i => i.id === 'C13');
    assert.ok(c13, id);
    assert.match(c13.message, new RegExp(`no sube de ${sun}° .* como mucho un ${pct} %`), id);
  }
  assert.equal(maxSunElevationDeg(-80.13).toFixed(1), '11.4');
  assert.equal(horizontalMaxPct(-86).toFixed(1), '9.7');
});

test('C13 no salta con seguidor, con panel vertical, lejos del polo ni sin sitio', () => {
  for (const panel of ['tracking', 'vertical-rotating']) assert.ok(!checkCoherence({ ...SHIP, panel, siteLatDeg: ridge.lat }).some(i => i.id === 'C13'), panel);
  assert.ok(!checkCoherence({ ...SHIP, panel: 'horizontal', siteLatDeg: apollo.lat }).some(i => i.id === 'C13'));
  assert.ok(!checkCoherence({ ...SHIP, panel: 'horizontal', siteLatDeg: -80 }).some(i => i.id === 'C13'), 'justo en 80°, no');
  assert.ok(!checkCoherence({ ...SHIP, panel: 'horizontal' }).some(i => i.id === 'C13'));
  assert.ok(panelUselessAt('horizontal', 85) && panelUselessAt('horizontal', -85) && !panelUselessAt('horizontal', NaN));
});

test('las tres naves de ejemplo declaran su orientación, una que el motor conoce', () => {
  for (const p of PROFILES) assert.ok(panelOf(p.panel), `${p.id}: ${p.panel}`);
  // Panels on the side, as polar spacecraft carry them: none of them is horizontal.
  assert.ok(PROFILES.every(p => p.panel !== 'horizontal'));
});

const PLAN = { siteId: 'shackleton-rim', t0: Date.UTC(2027, 0, 24, 12), days: 10, batteryHours: 12, minEarthPct: 60, profile: 'custom' };

test('el enlace del plan lleva la orientación, ida y vuelta', () => {
  assert.ok(MISSION_KEYS.includes('panel'), 'Plan la quita de su URL al leerla');
  const url = viewerUrl({ ...PLAN, panel: 'horizontal' }, '');
  assert.match(url, /[?&]panel=horizontal(&|$)/);
  assert.equal(parseMission(url.split('?')[1]).panel, 'horizontal');
  assert.equal(parseMission(planUrl({ ...PLAN, panel: 'vertical-rotating' }, '').split('?')[1].replace('#plan', '')).panel, 'vertical-rotating');
  // An orientation the engine does not know, or none: nothing (Plan takes the spacecraft's, or a tracker).
  assert.ok(!('panel' in parseMission(viewerUrl({ ...PLAN, panel: 'vertical-fixed' }, '').split('?')[1])));
  assert.ok(!('panel' in parseMission(viewerUrl(PLAN, '').split('?')[1])));
  // From the result of a search: the orientation of its conditions.
  const c = { from: Date.UTC(2027, 0, 20), to: Date.UTC(2027, 0, 30), profile: 'custom', panel: 'horizontal' };
  assert.equal(linkSearch({ conditions: c, fixedSite: false }).panel, 'horizontal');
  assert.ok(!('panel' in linkSearch({ conditions: { ...c, panel: 'sideways' }, fixedSite: false })));
});

test('el historial guarda la orientación y descarta la que no conoce', () => {
  const m = { ...PLAN, savedAt: 1, verdict: 'viable', panelHeightM: 2, antennaHeightM: 2 };
  assert.equal(missionEntry({ ...m, panel: 'horizontal' }).panel, 'horizontal');
  assert.ok(!('panel' in missionEntry({ ...m, panel: 'sideways' })));
  assert.ok(!('panel' in missionEntry(m)));
});

test('el CSV de la comparación lleva la orientación, con su factor; sin ella, la de un seguidor', () => {
  const col = SITE_COMPARISON_HEADERS.indexOf('Orientación del panel');
  assert.ok(col > 0);
  const option = { site: ridge, landing: PLAN.t0, verdict: { code: 'viable', reason: '' }, result: { pctSun: 50, maxDarkHours: 0, pctEarth: 60, maxNoEarthHours: 0 }, robustness: null, viableInWindow: true, landings: [] };
  const conditions = { ...SHIP, from: Date.UTC(2027, 0, 20), to: Date.UTC(2027, 0, 30) };
  const row = (c) => siteComparisonCsv({ options: [option], conditions: c, points: () => 50 }).split(/\r?\n/)[1];
  assert.match(row({ ...conditions, panel: 'horizontal' }), /Horizontal fijo \(max\(0, sen\(el\)\)\)/);
  assert.match(row(conditions), /Seguidor de dos ejes \(1\)/);
});

test('con el motor simulado no hay energía del panel: lo dice, como las alturas', async () => {
  const ms = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites: [ridge] });
  await ms.prepare({ fromMs: PLAN.t0, toMs: PLAN.t0 + 10 * 864e5 });
  assert.equal(ms.heightsEffect(), 'simulated');
  await assert.rejects(ms.energy(ridge, PLAN.t0, 10, 'horizontal'), /La energía del panel necesita la API de datos/);
});
