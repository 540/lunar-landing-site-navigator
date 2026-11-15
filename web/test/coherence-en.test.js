// Coherence of the requirements in English (#252, #283): with ?lang=en the messages, sources, classes, the note of
// skipped rules and the CSV column come out in English. Its own file: the language is fixed when i18n.js loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { documentElement: { lang: '' } };
globalThis.location = { search: '?lang=en', hash: '' };
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {} }, configurable: true });

const { lang } = await import('../js/common/i18n.js');
const { checkCoherence, skippedNote, CRAFT_CLASSES, THRESHOLDS, ruleTitle } = await import('../js/engine/coherence.js');
const { siteComparisonCsv, SKIPPED_RULES_HEADER } = await import('../js/application/csv-export.js');

const SPANISH = /[áéíóúñ¿¡]| y |todo lo que|Bloquea|Aviso|Lógica|Calculado|regla|saltada|Sin indicar|Tripulado|Lander pequeño/;

test('en inglés, los mensajes, títulos y fuentes de las reglas no llevan español', () => {
  assert.equal(lang, 'en');
  const ships = [
    { days: 10, minEarthPct: 60, maxEarthGapHours: 100, transitDays: 2 },
    { days: 45, batteryHours: 400, panelHeightM: 60, antennaHeightM: 0.5, transitDays: 200 },
    { days: 10, batteryHours: 100, minEarthPct: 10, maxEarthGapHours: 12, panelHeightM: 30, craftClass: 'crewed' },
    { days: 20, batteryHours: 300, panelHeightM: 3, antennaHeightM: 6, craftClass: 'small-lander' },
    { days: 0, minEarthPct: 120, batteryHours: -1 },
    { days: 10, panelHeightM: 150 }, // C0 of a height: its source names the routes with terrain=1
  ];
  const ids = new Set();
  for (const ship of ships) for (const i of checkCoherence(ship)) {
    ids.add(i.id);
    for (const text of [i.message, i.title, i.source]) assert.doesNotMatch(text, SPANISH, `${i.id}: ${text}`);
  }
  assert.ok(ids.size >= 10, [...ids].join());
  assert.match(checkCoherence(ships[0]).find(i => i.id === 'C4').message, /clashes with the minimum Earth \(60 %\)/);
  for (const c of CRAFT_CLASSES) assert.doesNotMatch(c.name, SPANISH);
  for (const t of Object.values(THRESHOLDS)) assert.doesNotMatch(t.source, SPANISH);
  assert.equal(ruleTitle('C4'), 'Earth outage versus the minimum %');
});

test('en inglés, la nota de reglas saltadas y la columna del CSV van en inglés', () => {
  assert.equal(skippedNote([{ id: 'C4', title: ruleTitle('C4') }]), 'Computed with 1 skipped coherence rule: C4 (Earth outage versus the minimum %).');
  assert.match(skippedNote([{ id: 'C4' }, { id: 'C5' }]), /^Computed with 2 skipped coherence rules: C4 \(.+\), C5 \(Feasible transit\)\.$/);
  const option = { site: { id: 's', name: 'Site', lat: -89, lon: 0 }, landing: Date.UTC(2027, 0, 2), verdict: { code: 'viable', reason: '' },
    result: { noData: true }, robustness: null, viableInWindow: 0, landings: [] };
  const conditions = { days: 10, batteryHours: 12, minEarthPct: 90, maxEarthGapHours: 30, from: Date.UTC(2027, 0, 1), to: Date.UTC(2027, 0, 3),
    panelHeightM: 2, antennaHeightM: 2, skippedRules: [{ id: 'C4', title: ruleTitle('C4') }] };
  const csv = siteComparisonCsv({ options: [option], conditions, points: () => 0 });
  assert.equal(SKIPPED_RULES_HEADER, 'Skipped coherence rules');
  assert.ok(csv.includes(SKIPPED_RULES_HEADER));
  assert.match(csv, /Computed with 1 skipped coherence rule: C4/);
  assert.doesNotMatch(csv, /Reglas de coherencia|Calculado con/);
});
