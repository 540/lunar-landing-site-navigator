// The battery of the own spacecraft (#253): the hours without the Sun come out of it (engine/battery.js), the same
// formula as the engine's batteryFor (backend/src/night.ts), and rules B1–B6 of the coherence look at it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BATTERY_DEFAULTS, autonomyHours, batteryMass, describeBattery, roundHours } from '../js/engine/battery.js';
import { checkCoherence, applySkips, blockers, skipsFor, skippedRules, BATTERY_FIELDS } from '../js/engine/coherence.js';
import { BATTERY_DEFAULTS as ENGINE_DEFAULTS, batteryFor } from '../../backend/src/night.ts';
import { viewerUrl, planUrl, parseMission, linkSearch } from '../../viewpoint/src/core/mission-link.js';
import { missionEntry } from '../js/common/mission-history.js';
import { EXPLANATIONS_ES } from '../js/common/explanations.js';

const COMPASS = { capacityWh: 20000, depthOfDischarge: 0.9, survivalLoadW: 46 };

test('20 000 Wh, DoD 0,9 y 46 W dan ~391 h (el caso de COMPASS)', () => {
  assert.ok(Math.abs(autonomyHours(COMPASS) - 391.3) < 0.05);
  assert.equal(describeBattery(COMPASS).hours, 391.3);
});

test('los valores por defecto son los del motor (BATTERY_DEFAULTS de backend/src/night.ts)', () => {
  assert.deepEqual({ ...BATTERY_DEFAULTS }, { ...ENGINE_DEFAULTS });
});

test('la cuenta de la web y la de batteryFor dan lo mismo para los mismos datos', () => {
  for (const capacityWh of [500, 5420, 20000, 46800]) for (const depthOfDischarge of [0.5, 0.8, 0.9, 1])
    for (const survivalLoadW of [5, 46, 100, 300]) for (const whPerKg of [108, 200, 270]) {
      const hours = autonomyHours({ capacityWh, depthOfDischarge, survivalLoadW });
      // The battery a night of those hours asks for is the one described: the same energy drawn and the same pack.
      const engine = batteryFor(hours, { survivalLoadW, whPerKg, depthOfDischarge });
      const mass = batteryMass({ capacityWh, whPerKg });
      const what = JSON.stringify({ capacityWh, depthOfDischarge, survivalLoadW, whPerKg });
      assert.ok(Math.abs(engine.kWh * 1000 - capacityWh * depthOfDischarge) < 1, what);
      assert.ok(Math.abs(engine.kg - mass.batteryKg) < 0.01, what);
    }
});

test('con dos de Wh, kg y Wh/kg se deduce la tercera; solo con Wh, la masa sale de la energía específica por defecto', () => {
  assert.deepEqual(batteryMass({ capacityWh: 20000, batteryKg: 100 }), { capacityWh: 20000, whPerKg: 200, batteryKg: 100, deduced: 'whPerKg', defaulted: false });
  assert.deepEqual(batteryMass({ capacityWh: 20000, whPerKg: 160 }), { capacityWh: 20000, whPerKg: 160, batteryKg: 125, deduced: 'batteryKg', defaulted: false });
  assert.deepEqual(batteryMass({ batteryKg: 100, whPerKg: 150 }), { capacityWh: 15000, whPerKg: 150, batteryKg: 100, deduced: 'capacityWh', defaulted: false });
  assert.deepEqual(batteryMass({ capacityWh: 10000 }), { capacityWh: 10000, whPerKg: 200, batteryKg: 50, deduced: 'batteryKg', defaulted: true });
  // The capacity deduced from the mass gives the hours too.
  assert.equal(describeBattery({ batteryKg: 100, whPerKg: 150, depthOfDischarge: 0.9, survivalLoadW: 45 }).hours, 300);
});

test('una carga de 0 W o una profundidad de descarga fuera de (0, 1] no dan horas: ni Infinity ni NaN', () => {
  for (const b of [{ ...COMPASS, survivalLoadW: 0 }, { ...COMPASS, survivalLoadW: -5 }, { ...COMPASS, depthOfDischarge: 0 },
    { ...COMPASS, depthOfDischarge: 1.2 }, { ...COMPASS, capacityWh: undefined }, { ...COMPASS, survivalLoadW: undefined }, {}]) {
    const d = describeBattery(b);
    assert.equal(d.hours, null, JSON.stringify(b));
    for (const v of Object.values(d)) assert.ok(v === null || typeof v !== 'number' || Number.isFinite(v), JSON.stringify(d));
  }
  assert.equal(describeBattery({ capacityWh: 1000, batteryKg: 0 }).batteryKg, 5); // a mass of 0 is not given: 1000 Wh ÷ 200 Wh/kg
  assert.equal(roundHours(391.304), 391.3);
});

// A believable small lander described by its battery: no rule fires on it.
const ship = (battery = {}, extra = {}) => {
  const b = { batteryWh: 2000, batteryLoadW: 100, batteryDod: 0.8, ...battery };
  const hours = describeBattery({ capacityWh: b.batteryWh, depthOfDischarge: b.batteryDod, survivalLoadW: b.batteryLoadW, whPerKg: b.batteryWhPerKg, batteryKg: b.batteryKg }).hours;
  return { days: 10, minEarthPct: 60, maxEarthGapHours: 48, transitDays: 8, panelHeightM: 2, antennaHeightM: 2, craftClass: 'small-lander',
    autonomy: 'battery', ...b, batteryHours: hours ?? undefined, ...extra };
};
const fired = (s, id, level) => checkCoherence(s).some(i => i.id === id && (!level || i.level === level));

test('la nave de referencia con batería no dispara ninguna regla', () => {
  assert.equal(ship().batteryHours, 16);
  assert.deepEqual(checkCoherence(ship()), []);
});

// Each rule: [id, level, a case that fires it, a case that does not].
const CASES = [
  ['B1', 'warn', ship({ batteryWhPerKg: 250 }), ship({ batteryWhPerKg: 220 })],
  ['B1', 'warn', ship({ batteryWhPerKg: 70 }), ship({ batteryWhPerKg: 80 })],
  ['B1', 'warn', ship({ batteryKg: 30 }), ship({ batteryKg: 10 })], // deduced: 2000 / 30 ≈ 67 Wh/kg; 2000 / 10 = 200
  ['B1', 'block', ship({ batteryWhPerKg: 310 }), ship({ batteryWhPerKg: 300 })],
  ['B1', 'block', ship({ batteryKg: 5 }), ship({ batteryKg: 10 })], // deduced: 400 Wh/kg
  ['B2', 'block', ship({ batteryDod: 0 }), ship({ batteryDod: 0.5 })],
  ['B2', 'block', ship({ batteryDod: 1.1 }), ship({ batteryDod: 1 })],
  ['B2', 'warn', ship({ batteryDod: 0.95 }), ship({ batteryDod: 0.9 })],
  ['B2', 'warn', ship({ batteryDod: 0.4 }), ship({ batteryDod: 0.5 })],
  ['B3', 'block', ship({ batteryLoadW: 0 }), ship({ batteryLoadW: 5 })],
  ['B3', 'warn', ship({ batteryLoadW: 4 }), ship({ batteryLoadW: 5 })],
  ['B3', 'warn', ship({ batteryLoadW: 310 }), ship({ batteryLoadW: 310 }, { craftClass: 'crewed' })],
  ['B4', 'warn', ship({}, { dryMassKg: 60 }), ship({}, { dryMassKg: 70 })], // 10 kg of pack (2000 Wh ÷ 200 Wh/kg)
  ['B4', 'block', ship({}, { dryMassKg: 19 }), ship({}, { dryMassKg: 20 })],
  ['B5', 'block', ship({ batteryKg: 10, batteryWhPerKg: 180 }), ship({ batteryKg: 10, batteryWhPerKg: 195 })],
  ['B6', 'warn', ship({ batteryWh: 20000, batteryDod: 0.9, batteryLoadW: 46 }, { days: 30 }), ship({ batteryWh: 20000, batteryDod: 0.9, batteryLoadW: 60 }, { days: 30 })],
];
for (const [id, level, yes, no] of CASES) {
  test(`${id} (${level}): salta y no salta`, () => {
    assert.ok(fired(yes, id, level), `${id} debería saltar con ${JSON.stringify(yes)}`);
    assert.ok(!fired(no, id, level), `${id} no debería saltar con ${JSON.stringify(no)}`);
  });
}

test('B6 dice la masa que implica la noche lunar; con la batería no se repite C8', () => {
  const s = ship({ batteryWh: 20000, batteryDod: 0.9, batteryLoadW: 46 }, { days: 30 });
  const b6 = checkCoherence(s).find(i => i.id === 'B6');
  assert.match(b6.message, /391,3 h/);
  assert.match(b6.message, /100 kg/); // 20 000 Wh ÷ 200 Wh/kg
  assert.ok(!fired(s, 'C8'));
  assert.ok(fired({ ...s, autonomy: undefined }, 'C8')); // the same hours typed: C8, as before
  assert.ok(!fired({ ...s, autonomy: undefined }, 'B6'));
});

test('B1, B4 y B5 se pueden saltar; B2 y B3 (valores con los que la fórmula no da nada), no', () => {
  for (const [s, id, skippable] of [[ship({ batteryWhPerKg: 310 }), 'B1', true], [ship({}, { dryMassKg: 19 }), 'B4', true],
    [ship({ batteryKg: 10, batteryWhPerKg: 180 }), 'B5', true], [ship({ batteryDod: 1.1 }), 'B2', false], [ship({ batteryLoadW: 0 }), 'B3', false]]) {
    const all = checkCoherence(s), block = all.find(i => i.id === id && i.level === 'block');
    assert.equal(block.skippable, skippable, id);
    const after = applySkips(all, skipsFor(all, [id]));
    assert.equal(blockers(after).some(i => i.id === id), !skippable, id);
    if (skippable) assert.deepEqual(skippedRules(after).map(r => r.id), [id]);
  }
});

test('una batería que da más de 720 h no deja buscar y dice por qué, con la cuenta; no se puede saltar', () => {
  const s = ship({ batteryWh: 40000, batteryDod: 0.9, batteryLoadW: 46 }, { days: 30 });
  assert.equal(s.batteryHours, 782.6);
  const b = blockers(checkCoherence(s));
  assert.deepEqual(b.map(i => i.id), ['C0']);
  assert.equal(b[0].skippable, false);
  assert.match(b[0].message, /40\.000 Wh × 0,9 \/ 46 W = 782,6 h/);
  assert.match(b[0].message, /720 h/);
  assert.ok(b[0].fields.includes('batteryWh'), 'cambiar la capacidad le afecta');
});

test('una carga de 0 W no deja ningún NaN ni Infinity en los mensajes', () => {
  const s = ship({ batteryLoadW: 0 });
  assert.equal(s.batteryHours, undefined);
  for (const i of checkCoherence(s)) assert.doesNotMatch(i.message, /NaN|Infinity|∞/);
});

test('cada aviso de la batería enseña su fuente', () => {
  for (const [, , yes] of CASES) for (const i of checkCoherence(yes)) assert.ok(i.source && i.message && i.title, `${i.id} sin fuente o sin texto`);
  assert.deepEqual(BATTERY_FIELDS, ['batteryWh', 'batteryLoadW', 'batteryDod', 'batteryWhPerKg', 'batteryKg', 'dryMassKg']);
});

test('el enlace del plan conserva la batería, no solo las horas, y las reglas B saltadas; el historial también', () => {
  const battery = { capacityWh: 20000, survivalLoadW: 46, depthOfDischarge: 0.9, dryMassKg: 1500 };
  const plan = { siteId: 'shackleton', t0: Date.parse('2027-03-10T12:00:00Z'), days: 14, batteryHours: 391.3, minEarthPct: 50, profile: 'custom',
    skippedRules: ['B4', 'C5'], battery };
  const url = viewerUrl(plan, '');
  assert.match(url, /bwh=20000/);
  assert.match(url, /bload=46/);
  assert.match(url, /bdod=0.9/);
  assert.match(url, /dry=1500/);
  assert.doesNotMatch(url, /bkg=|bspec=/);
  const back = parseMission(url.split('?')[1]);
  assert.deepEqual(back.battery, battery);
  assert.deepEqual(back.skippedRules, ['B4', 'C5']);
  assert.deepEqual(parseMission(planUrl(back, '').split('?')[1].split('#')[0]).battery, battery);
  // Without a battery, nothing new in the link.
  assert.doesNotMatch(viewerUrl({ ...plan, battery: undefined, skippedRules: [] }, ''), /bwh|bload|bdod|dry=/);
  assert.equal(parseMission(viewerUrl({ ...plan, battery: undefined }, '').split('?')[1]).battery, undefined);
  // The search of the plan carries it (the history records linkSearch), and the history keeps it.
  const search = linkSearch({ conditions: { profile: 'custom', from: Date.parse('2027-03-01'), to: Date.parse('2027-03-20'), battery, skippedRules: [] }, fixedSite: false });
  assert.deepEqual(search.battery, battery);
  const entry = missionEntry({ ...plan, ...search, savedAt: 1, verdict: 'viable' });
  assert.deepEqual(entry.battery, battery);
  assert.deepEqual(entry.skippedRules, ['B4', 'C5']);
  assert.equal(missionEntry({ ...plan, battery: { capacityWh: 'x' } }).battery, undefined);
});

test('el modo explicación cuenta que la masa es solo del pack, y el paso 2 lo enseña', () => {
  const card = EXPLANATIONS_ES.battery;
  assert.match(card.tells, /solo la del pack/);
  assert.match(card.tells, /sin electrónica, sin panel extra para recargar y sin márgenes/);
  assert.match(card.calc, /Wh × profundidad de descarga \/ W/);
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /id="plan-battery-group"[^>]*data-explain="battery"/);
});
