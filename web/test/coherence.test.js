// Coherence of the spacecraft's requirements (#252): each rule fires and does not, the example spacecraft pass, the
// blocks that can be skipped and those that cannot, and that whatever is skipped the API never gets a value it rejects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCoherence, applySkips, blockers, skipsFor, skippedRules, skippedNote, THRESHOLDS, CRAFT_CLASSES } from '../js/engine/coherence.js';
import { PROFILES } from '../js/engine/catalog.js';
import { API_LIMITS, MAX_HEIGHT_M } from '../js/ports/visibility.js';
import { apiVisibility } from '../js/adapters/visibility-api.js';
import { siteComparisonCsv, SITE_COMPARISON_HEADERS, SKIPPED_RULES_HEADER } from '../js/application/csv-export.js';
import { viewerUrl, planUrl, parseMission, linkSearch } from '../../viewpoint/src/core/mission-link.js';
import { missionEntry } from '../js/common/mission-history.js';

// A believable small lander: no rule fires on it.
const OK = { days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48, transitDays: 8, panelHeightM: 2, antennaHeightM: 2, craftClass: 'small-lander' };
const ids = ship => checkCoherence({ ...OK, ...ship });
const fired = (ship, id, level) => ids(ship).some(i => i.id === id && (!level || i.level === level));

test('la nave de referencia no dispara ninguna regla', () => assert.deepEqual(checkCoherence(OK), []));

test('las tres naves de ejemplo pasan las mismas reglas sin ningún bloqueo ni aviso', () => {
  for (const p of PROFILES) {
    const ship = { ...p, panelHeightM: 2, antennaHeightM: 2 };
    assert.deepEqual(blockers(checkCoherence(ship)), [], p.id);
    assert.deepEqual(checkCoherence(ship), [], p.id);
    assert.ok(CRAFT_CLASSES.some(c => c.id === p.craftClass), `${p.id} tiene clase de nave`);
  }
});

// Each rule: [id, level, a case that fires it, a case that does not].
const CASES = [
  ['C0', 'block', { days: 45 }, { days: 30 }],
  ['C0', 'block', { days: 0.25 }, { days: 0.5 }],
  ['C0', 'block', { batteryHours: 800 }, { batteryHours: 300 }],
  ['C0', 'block', { maxEarthGapHours: 721, minEarthPct: 0, days: 30 }, { maxEarthGapHours: 48 }],
  ['C0', 'block', { panelHeightM: 150 }, { panelHeightM: 2 }],
  ['C1', 'block', { days: 0 }, { days: 1 }],
  ['C1', 'block', { transitDays: -1 }, { transitDays: 5 }],
  ['C1', 'block', { antennaHeightM: 0 }, { antennaHeightM: 2 }],
  ['C1', 'block', { minEarthPct: 120 }, { minEarthPct: 100, maxEarthGapHours: 0 }],
  ['C1', 'block', { batteryHours: -2 }, { batteryHours: 0 }],
  ['C2', 'warn', { days: 1, batteryHours: 30 }, { days: 2, batteryHours: 30 }],
  ['C3', 'warn', { days: 1, maxEarthGapHours: 30, minEarthPct: undefined }, { days: 2, maxEarthGapHours: 30 }],
  ['C4', 'block', { days: 10, minEarthPct: 90, maxEarthGapHours: 30 }, { days: 10, minEarthPct: 80, maxEarthGapHours: 30 }],
  ['C5', 'block', { transitDays: 2 }, { transitDays: 3 }],
  ['C5', 'warn', { transitDays: 151 }, { transitDays: 140 }],
  ['C6', 'warn', { panelHeightM: 3 }, { panelHeightM: 2.5 }],
  ['C6', 'warn', { craftClass: 'medium-lander', antennaHeightM: 6 }, { craftClass: 'medium-lander', antennaHeightM: 5 }],
  ['C6', 'warn', { craftClass: 'rover', panelHeightM: 21 }, { craftClass: 'crewed', panelHeightM: 21 }],
  ['C6', 'block', { craftClass: 'crewed', panelHeightM: 56 }, { craftClass: 'crewed', panelHeightM: 55 }],
  ['C7', 'warn', { panelHeightM: 0.5 }, { panelHeightM: 1 }],
  ['C8', 'warn', { days: 30, batteryHours: 354 }, { days: 30, batteryHours: 353 }],
  ['C9', 'warn', { days: 10, batteryHours: 73 }, { days: 10, batteryHours: 72 }],
  ['C10', 'warn', { minEarthPct: 20 }, { minEarthPct: 25 }],
  ['C11', 'warn', { days: 8, maxEarthGapHours: 20, minEarthPct: 50 }, { days: 7, maxEarthGapHours: 20, minEarthPct: 50 }],
  ['C12', 'warn', { craftClass: 'crewed', days: 8, maxEarthGapHours: 30 }, { craftClass: 'crewed', days: 7, maxEarthGapHours: 30 }],
  ['C12', 'warn', { craftClass: 'small-lander', days: 15 }, { craftClass: 'small-lander', days: 15, batteryHours: 354 }],
];
for (const [id, level, yes, no] of CASES) {
  test(`${id} (${level}): salta con ${JSON.stringify(yes)} y no con ${JSON.stringify(no)}`, () => {
    assert.ok(fired(yes, id, level), `${id} debería saltar`);
    assert.ok(!fired(no, id, level), `${id} no debería saltar`);
  });
}

test('un bloqueo dice qué dos datos chocan y con qué valores; cada mensaje lleva su fuente', () => {
  const c4 = ids({ days: 10, minEarthPct: 90, maxEarthGapHours: 30 }).find(i => i.id === 'C4');
  assert.match(c4.message, /máximo sin Tierra seguido \(30 h\)/);
  assert.match(c4.message, /Tierra mínima \(90 %\)/);
  assert.deepEqual(c4.fields.slice(0, 2), ['maxEarthGapHours', 'minEarthPct']);
  for (const [, , yes] of CASES) for (const i of ids(yes)) assert.ok(i.source && i.message && i.title, `${i.id} sin fuente o sin texto`);
});

test('fuera de los límites de la API (C0) el mensaje dice el límite: 45 días, 150 m y 800 h no se recortan', () => {
  for (const [ship, limit] of [[{ days: 45 }, /de 0,5 a 30 d/], [{ panelHeightM: 150 }, /de 0 a 100 m/], [{ batteryHours: 800 }, /de 0 a 720 h/]]) {
    const b = blockers(ids(ship));
    assert.equal(b.length, 1);
    assert.match(b[0].message, limit);
    assert.match(b[0].source, /\/v1\//);
  }
});

test('C1 y C0 no se pueden saltar; el resto de bloqueos sí', () => {
  for (const [id, level, yes] of CASES) {
    if (level !== 'block') continue;
    const b = ids(yes).find(i => i.id === id);
    assert.equal(b.skippable, !['C0', 'C1'].includes(id), id);
    const after = applySkips([b], new Set([b.key]));
    assert.equal(blockers(after).length, b.skippable ? 0 : 1, id);
  }
});

test('saltar un bloqueo lo deja como aviso «saltado»; si cambia uno de sus datos, el bloqueo vuelve', () => {
  const ship = { ...OK, days: 10, minEarthPct: 90, maxEarthGapHours: 30 };
  const c4 = checkCoherence(ship).find(i => i.id === 'C4'), skipped = new Set([c4.key]);
  const after = applySkips(checkCoherence(ship), skipped);
  assert.deepEqual(blockers(after), []);
  assert.deepEqual(skippedRules(after), [{ id: 'C4', title: c4.title }]);
  assert.equal(after.find(i => i.id === 'C4').level, 'warn');
  for (const change of [{ days: 11 }, { minEarthPct: 95 }, { maxEarthGapHours: 31 }]) {
    assert.equal(blockers(applySkips(checkCoherence({ ...ship, ...change }), skipped)).length, 1, JSON.stringify(change));
  }
  // A value no rule crosses does not bring it back.
  assert.deepEqual(blockers(applySkips(checkCoherence({ ...ship, batteryHours: 13 }), skipped)), []);
});

test('skipsFor: los ids de un enlace vuelven a saltar esas reglas, nunca C0 ni C1', () => {
  const ship = { ...OK, transitDays: 2, days: 45 };
  const keys = skipsFor(checkCoherence(ship), ['C5', 'C0', 'C1']);
  const after = applySkips(checkCoherence(ship), keys);
  assert.deepEqual(blockers(after).map(i => i.id), ['C0']);
  assert.deepEqual(skippedRules(after).map(r => r.id), ['C5']);
});

test('los umbrales viven en un solo sitio, cada uno con su fuente; los rangos de C0, junto a MAX_HEIGHT_M con su ruta', () => {
  for (const [k, t] of Object.entries(THRESHOLDS)) assert.ok(Number.isFinite(t.value) && t.source.length > 10, k);
  for (const [k, l] of Object.entries(API_LIMITS)) assert.ok(l.min <= l.max && /\/v1\/|terrain=1/.test(l.routes), k);
  assert.equal(MAX_HEIGHT_M, API_LIMITS.panelHeightM.max);
});

test('las reglas solo miran la entrada: no cambian ningún valor de la nave', () => {
  const ship = { ...OK, days: 10, minEarthPct: 90, maxEarthGapHours: 30 }, copy = { ...ship };
  checkCoherence(ship);
  assert.deepEqual(ship, copy);
});

// With any combination of skipped rules, what leaves for the API is inside its ranges: no request gets a 400.
test('con cualquier combinación de reglas saltadas, lo que sale hacia /v1/best-landings, /v1/windows y /v1/light-map está en los rangos de la API', async () => {
  const VALUES = {
    days: [-1, 0, 0.25, 0.5, 1, 7, 15, 30, 31, 45],
    batteryHours: [-1, 0, 50, 100, 400, 720, 800],
    minEarthPct: [-5, 0, 20, 60, 100, 120],
    maxEarthGapHours: [undefined, -1, 0, 20, 100, 720, 800],
    transitDays: [undefined, 0, 2, 8, 200],
    panelHeightM: [-1, 0, 0.5, 2, 30, 60, 100, 150],
    antennaHeightM: [0, 2, 60, 150],
  };
  // A sample of combinations, every value of every field at least once against the rest, with every skippable block skipped.
  const ships = [];
  for (const [f, vs] of Object.entries(VALUES)) for (const v of vs) for (const base of [OK, { ...OK, days: 1, minEarthPct: 95, maxEarthGapHours: 30, transitDays: 1 }]) ships.push({ ...base, [f]: v });
  for (let k = 0; k < 400; k++) ships.push(Object.fromEntries(Object.entries(VALUES).map(([f, vs], j) => [f, vs[(k * (j + 3) + j) % vs.length]])));
  const inRange = (k, v) => !API_LIMITS[k] || (v >= API_LIMITS[k].min && v <= API_LIMITS[k].max);
  const urls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { urls.push(new URL(String(url))); return new Response('{}', { status: 500 }); };
  try {
    const api = apiVisibility({ baseUrl: 'http://api.test' });
    const site = { id: 's', name: 's', lat: -89.5, lon: 0 }, from = Date.UTC(2027, 0, 1);
    let searched = 0;
    for (const ship of ships) {
      const all = checkCoherence(ship), every = new Set(all.filter(i => i.skippable).map(i => i.key));
      if (blockers(applySkips(all, every)).length) continue; // C0 or C1: Plan does not search
      searched++;
      // What Plan sends: the values typed, untrimmed (planConditions).
      await api.loadBestLandings({ sites: [site], from, to: from + 864e5, priority: 'balanced', ...ship }).catch(() => {});
      await api.loadWindows(site, from, from + 864e5, ship).catch(() => {});
      await api.loadLightMap({ lat: site.lat, lon: site.lon, radiusKm: 5, spacingKm: 1, fromMs: from, ...ship }).catch(() => {});
    }
    assert.ok(searched > 50, `se buscó con ${searched} naves`);
    const checked = new Set();
    for (const u of urls) for (const [k, v] of u.searchParams) if (API_LIMITS[k]) { checked.add(k); assert.ok(inRange(k, +v), `${u.pathname}: ${k}=${v}`); }
    assert.deepEqual([...checked].sort(), Object.keys(API_LIMITS).sort());
  } finally { globalThis.fetch = realFetch; }
});

test('el CSV de un plan con reglas saltadas dice cuáles; sin saltos, no cambia', () => {
  const option = { site: { id: 's', name: 'Sitio', lat: -89, lon: 0 }, landing: Date.UTC(2027, 0, 2), verdict: { code: 'viable', reason: '' },
    result: { noData: true }, robustness: null, viableInWindow: 0, landings: [] };
  const conditions = { days: 10, batteryHours: 12, minEarthPct: 90, maxEarthGapHours: 30, from: Date.UTC(2027, 0, 1), to: Date.UTC(2027, 0, 3), panelHeightM: 2, antennaHeightM: 2 };
  const plain = siteComparisonCsv({ options: [option], conditions, points: () => 0 });
  assert.ok(!plain.includes(SKIPPED_RULES_HEADER));
  assert.equal(plain.split('\r\n')[0].replace(/^﻿/, '').split(';').length, SITE_COMPARISON_HEADERS.length);
  const skipped = siteComparisonCsv({ options: [option], conditions: { ...conditions, skippedRules: [{ id: 'C4', title: 'Hueco sin Tierra frente al % mínimo' }] }, points: () => 0 });
  assert.ok(skipped.includes(SKIPPED_RULES_HEADER));
  assert.match(skipped, /Calculado con 1 regla de coherencia saltada: C4/);
});

test('skippedNote: «Calculado con N regla(s)…» con la lista; nada sin saltos', () => {
  assert.equal(skippedNote([]), '');
  assert.equal(skippedNote(undefined), '');
  assert.match(skippedNote([{ id: 'C4', title: 'A' }, { id: 'C5', title: 'B' }]), /^Calculado con 2 reglas de coherencia saltadas: C4 \(A\), C5 \(B\)\.$/);
});

test('el enlace del plan y el historial llevan las reglas saltadas, y solo si las hay', () => {
  const conditions = { profile: 'custom', from: Date.UTC(2027, 0, 1), to: Date.UTC(2027, 0, 9), skippedRules: [{ id: 'C4', title: 'x' }, { id: 'C5', title: 'y' }] };
  const plan = { siteId: 'malapert', t0: Date.UTC(2027, 0, 3), days: 10, batteryHours: 12, minEarthPct: 90, maxEarthGapHours: 30, ...linkSearch({ conditions }) };
  assert.deepEqual(plan.skippedRules, ['C4', 'C5']);
  for (const url of [viewerUrl(plan, ''), planUrl(plan, '')]) {
    assert.match(url, /skip=C4%2CC5/);
    assert.deepEqual(parseMission(new URL(url, 'http://x/web/').search).skippedRules, ['C4', 'C5']);
  }
  const none = { ...plan, ...linkSearch({ conditions: { ...conditions, skippedRules: [] } }) };
  delete none.skippedRules;
  assert.ok(!viewerUrl(none, '').includes('skip='));
  assert.equal(parseMission(new URL(viewerUrl(none, ''), 'http://x/web/').search).skippedRules, undefined);
  assert.equal(parseMission('?site=malapert&t0=2027-01-03T00:00:00Z&days=10&skip=C4,<b>,C99x').skippedRules.join(), 'C4');
  assert.deepEqual(missionEntry({ ...plan, verdict: 'viable', searchSiteId: null }).skippedRules, ['C4', 'C5']);
  assert.equal('skippedRules' in missionEntry({ ...none, verdict: 'viable', searchSiteId: null }), false);
});
