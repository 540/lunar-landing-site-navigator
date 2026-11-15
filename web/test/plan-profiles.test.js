// Plan's step 1 with the user's own spacecraft (#251), over a fake DOM: the card, choosing it, editing a requirement
// by hand and opening a plan from its link. And step 2 with the coherence of the requirements (#252): blocks, warnings,
// «Continuar de todos modos», the class of spacecraft, and the skips and class a link or the history bring back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROFILES } from '../js/engine/catalog.js';

/** An element with just what plan.js touches; listeners are kept to fire them. */
function element(id) {
  const listeners = {}, attrs = {}, classes = new Set();
  let value = '';
  return {
    get value() { return value; }, set value(v) { value = String(v ?? ''); }, // like an <input>: always a string
    id, textContent: '', innerHTML: '', hidden: false, disabled: false, dataset: {}, style: {}, children: [],
    offsetWidth: 0, listeners, attrs,
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c), on),
    },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener() {}, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: k => { delete attrs[k]; },
    getAttribute: k => attrs[k] ?? null, appendChild() {}, after() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, focus() { focused = id; }, scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    getContext: () => null,
  };
}
let focused = null; // the id of the last element focused
const elements = new Map();
const byId = id => elements.get(id) ?? elements.set(id, element(id)).get(id);
globalThis.document = {
  getElementById: byId, querySelector: () => element('any'), querySelectorAll: () => [], addEventListener() {},
  createElement: () => element('new'), documentElement: element('html'), body: element('body'),
};
globalThis.location = { hash: '', search: '' };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
Object.defineProperty(globalThis, 'localStorage', { value: null, configurable: true });
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });

const { initPlanForm, openMission, runSearch, paintSkipped } = await import('../js/views/plan.js');
const { createMissionService } = await import('../js/application/mission-service.js');
const { fakeVisibility } = await import('../js/adapters/visibility-fake.js');
const { state, services } = await import('../js/common/state.js');
const { viewerUrl, parseMission } = await import('../../viewpoint/src/core/mission-link.js');
const { missionEntry } = await import('../js/common/mission-history.js');
// Never ready: the calendar waits for the data and no search runs, which these tests do not need. It counts the loads
// asked for, to tell whether a search (or the calendar) went for the data.
let loads = 0;
services.mission = { isReady: () => false, prepare: () => { loads++; return new Promise(() => {}); }, heightsEffect: () => null };

const FIELDS = ['plan-days', 'plan-battery', 'plan-earth', 'plan-earth-gap', 'plan-transit'];
const fields = () => FIELDS.map(id => byId(id).value);
/** The cards of step 1 as rendered: id, role and whether they are checked. */
const cards = () => [...byId('plan-profiles').innerHTML.matchAll(/<button type="button" class="option" role="(\w+)" aria-checked="(\w+)" data-id="([\w-]+)"/g)]
  .map(([, role, checked, id]) => ({ id, role, checked: checked === 'true' }));
const checked = () => cards().filter(c => c.checked).map(c => c.id);
/** A click on the card of that profile, as the browser delivers it to the #plan-profiles listener. */
function clickCard(id) {
  const card = { dataset: { id } };
  const target = { closest: sel => (sel === '.option' ? card : null) };
  byId('plan-profiles').listeners.click.forEach(fn => fn({ target }));
}
/** Typing in a requirement field. */
function type(id, value) {
  byId(id).value = value;
  byId(id).listeners.input.forEach(fn => fn({ target: byId(id) }));
}
function fresh() {
  state.searchResult = null;
  initPlanForm();
}

test('la cuarta tarjeta «Nave propia» está en el radiogroup como las otras tres y se elige igual', () => {
  fresh();
  assert.match(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /id="plan-profiles" role="radiogroup"/);
  assert.deepEqual(cards().map(c => c.id), [...PROFILES.map(p => p.id), 'custom']);
  assert.ok(cards().every(c => c.role === 'radio'));
  assert.deepEqual(checked(), []);
  clickCard('custom');
  assert.equal(state.form.profile, 'custom');
  assert.deepEqual(checked(), ['custom']);
  assert.deepEqual(fields(), ['', '', '', '', '']); // the requirements, empty to type them in
});

test('elegir una nave de ejemplo rellena sus requisitos y cambiar uno a mano marca «Nave propia»', () => {
  fresh();
  const p = PROFILES[0];
  clickCard(p.id);
  assert.deepEqual(checked(), [p.id]);
  assert.deepEqual(fields().map(Number), [p.days, p.batteryHours, p.minEarthPct, p.maxEarthGapHours, p.transitDays]);
  type('plan-days', String(p.days + 2));
  assert.equal(state.form.profile, 'custom');
  assert.deepEqual(checked(), ['custom']);
  assert.equal(byId('plan-days').value, String(p.days + 2)); // what was typed stays
  // Announced once to screen readers, on the switch; the next keystrokes leave it as it is.
  const notice = 'Has cambiado un requisito: la nave pasa a ser «Nave propia».';
  assert.equal(byId('plan-profile-live').textContent, notice);
  byId('plan-profile-live').textContent = 'read';
  type('plan-days', String(p.days + 3));
  assert.equal(byId('plan-profile-live').textContent, 'read');
  // Choosing a card clears it, so a new switch is announced again.
  clickCard(p.id);
  assert.equal(byId('plan-profile-live').textContent, '');
  type('plan-battery', String(p.batteryHours + 1));
  assert.equal(byId('plan-profile-live').textContent, notice);
});

test('pulsar «Nave propia» cuando ya está elegida no borra los requisitos escritos', () => {
  fresh();
  const p = PROFILES[0];
  clickCard(p.id);
  type('plan-days', '12');
  const typed = fields();
  clickCard('custom'); // the card already checked, to move on
  assert.deepEqual(fields(), typed);
  assert.deepEqual(checked(), ['custom']);
  // Typed from an empty «Nave propia» too.
  fresh();
  clickCard('custom');
  ['7', '30', '45', '', ''].forEach((v, i) => type(FIELDS[i], v));
  clickCard('custom');
  assert.deepEqual(fields(), ['7', '30', '45', '', '']);
});

test('un enlace sin tránsito toma el de la nave de ejemplo que nombra, aunque se cambiara un requisito', () => {
  state.searchResult = null;
  const p = PROFILES[2], t0 = Date.UTC(2027, 10, 17, 12);
  const link = { siteId: 'malapert', t0, days: p.days, batteryHours: p.batteryHours, minEarthPct: p.minEarthPct,
    maxEarthGapHours: p.maxEarthGapHours, profile: p.id, from: '2027-11-10', to: '2027-11-24', pickBest: true };
  initPlanForm(link);
  assert.equal(state.form.profile, p.id);
  assert.equal(byId('plan-transit').value, String(p.transitDays));
  assert.deepEqual(checked(), [p.id]);
  initPlanForm({ ...link, days: p.days + 1 });
  assert.equal(state.form.profile, 'custom');
  assert.equal(byId('plan-transit').value, String(p.transitDays));
  assert.deepEqual(checked(), ['custom']);
});

// ---------------- Coherence of the requirements (#252) ----------------
const checks = id => byId(`${id}-checks`).innerHTML;
const step = () => String(byId('view-plan').dataset.step);
const next = () => byId('plan-step-next').listeners.click.forEach(fn => fn());
/** A click on «Continuar de todos modos» under that field, as the browser delivers it to the #plan-step-2 listener. */
function skip(id) {
  const key = checks(id).match(/data-skip="([^"]+)"/)?.[1];
  assert.ok(key, `${id} tiene el botón de salto`);
  const button = { dataset: { skip: key.replaceAll('&quot;', '"').replaceAll('&amp;', '&') } };
  byId('plan-step-2').listeners.click.forEach(fn => fn({ target: { closest: sel => (sel === '[data-skip]' ? button : null) } }));
}
/** «Nave propia» with these requirements, on step 2. */
function ownShip(days, battery, earth, gap = '') {
  fresh();
  clickCard('custom');
  next();
  [['plan-days', days], ['plan-battery', battery], ['plan-earth', earth], ['plan-earth-gap', gap]].forEach(([id, v]) => type(id, v));
}
// 10 days with 60 % of Earth: at most 96 h without it in all; a 100 h gap cannot happen (C4, a block that can be skipped).
const CLASH = { siteId: 'malapert', t0: Date.UTC(2027, 10, 17, 12), days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 100,
  profile: 'custom', from: '2027-11-10', to: '2027-11-24', pickBest: true };

test('con un bloqueo el paso 2 no avanza, «Siguiente» lo explica y el mensaje dice qué datos chocan', () => {
  ownShip('10', '12', '60', '100');
  assert.equal(step(), '2');
  next();
  assert.equal(step(), '2');
  assert.match(byId('plan-step-error').textContent, /no pueden darse/);
  // The message says it blocks in words, not only by its colour, with both values and its source.
  assert.match(checks('plan-earth-gap'), /data-level="block"><b>Bloquea:<\/b> El máximo sin Tierra seguido \(100 h\) choca con la Tierra mínima \(60 %\)/);
  assert.match(checks('plan-earth-gap'), /C4 · Fuente: Lógica/);
  // Its button says which rule it skips.
  assert.match(checks('plan-earth-gap'), /aria-label="Continuar de todos modos: saltar la regla C4, Hueco sin Tierra frente al % mínimo"/);
  // The field is invalid, and the other two it crosses point to its message too.
  assert.equal(byId('plan-earth-gap').getAttribute('aria-invalid'), 'true');
  assert.ok(byId('plan-earth-gap').classList.contains('has-block'));
  for (const id of ['plan-earth', 'plan-days']) {
    assert.deepEqual(byId(id).getAttribute('aria-describedby').split(' '), [`${id}-checks`, 'plan-earth-gap-checks']);
    assert.equal(byId(id).getAttribute('aria-invalid'), 'false');
  }
});

test('«Continuar de todos modos» deja seguir, devuelve el foco al campo y el bloqueo vuelve al cambiar un dato que cruza', () => {
  ownShip('10', '12', '60', '100');
  focused = null;
  skip('plan-earth-gap');
  assert.equal(focused, 'plan-earth-gap'); // the button is gone: back to its field
  assert.match(checks('plan-earth-gap'), /data-level="warn"><b>Regla saltada\.<\/b>/);
  assert.doesNotMatch(checks('plan-earth-gap'), /data-skip/);
  assert.equal(byId('plan-earth-gap').getAttribute('aria-invalid'), 'false');
  next();
  assert.equal(step(), '3');
  // Another value in one of the three requirements it crosses (here the % of Earth): the block is back.
  type('plan-earth', '65');
  assert.match(checks('plan-earth-gap'), /<b>Bloquea:<\/b>.*data-skip/s);
  assert.equal(byId('plan-earth-gap').getAttribute('aria-invalid'), 'true');
  // And going back to the skipped values blocks again too: the skip was forgotten.
  type('plan-earth', '60');
  assert.match(checks('plan-earth-gap'), /<b>Bloquea:<\/b>.*data-skip/s);
});

test('C0 y C1 bloquean sin botón y dicen el límite; un aviso se marca como aviso y no impide seguir', () => {
  Object.assign(byId('plan-days'), { min: '0.5', max: '30' }); // the input's own limits, as in index.html
  ownShip('45', '12', '60');
  assert.match(checks('plan-days'), /<b>Bloquea:<\/b> Días en superficie: 45 d está fuera de lo que admite la API de datos, de 0,5 a 30 d\./);
  assert.doesNotMatch(checks('plan-days'), /data-skip/);
  // Said once, under the field: not again in the requirements' own error line (#395), and the field is invalid.
  assert.equal(byId('plan-req-error').textContent, '');
  assert.equal(byId('plan-days').getAttribute('aria-invalid'), 'true');
  next();
  assert.equal(step(), '2');
  type('plan-days', '0');
  assert.match(checks('plan-days'), /<b>Bloquea:<\/b> Días en superficie tiene que ser mayor que 0/);
  assert.doesNotMatch(checks('plan-days'), /data-skip/);
  type('plan-days', '10');
  assert.equal(checks('plan-days'), '');
  type('plan-battery', '100'); // C9: unusual, not impossible
  assert.match(checks('plan-battery'), /data-level="warn"><b>Aviso:<\/b> Aguantar 100 h sin Sol es poco habitual/);
  assert.match(checks('plan-battery'), /C9 · Fuente: VIPER/);
  next();
  assert.equal(step(), '3');
});

test('el selector de clase de nave solo se ve con «Nave propia» y la clase cambia los avisos', () => {
  fresh();
  clickCard(PROFILES[0].id);
  assert.equal(byId('plan-class-field').hidden, true);
  assert.equal(byId('plan-class').value, PROFILES[0].craftClass);
  clickCard('custom');
  assert.equal(byId('plan-class-field').hidden, false);
  type('plan-panel-height', '30');
  assert.match(checks('plan-panel-height'), /pasa de 20 m/);
  byId('plan-class').value = 'crewed';
  byId('plan-class').listeners.change.forEach(fn => fn());
  assert.equal(checks('plan-panel-height'), ''); // a crewed spacecraft may be that tall
});

test('con un bloqueo sin saltar no se busca; con la regla saltada, sí', async () => {
  initPlanForm(CLASH);
  state.searchResult = null;
  loads = 0;
  await runSearch();
  assert.equal(loads, 0);
  skip('plan-earth-gap');
  let cond = null;
  services.mission.search = c => { cond = c; return new Promise(() => {}); };
  services.mission.prepare = () => { loads++; return Promise.resolve(); };
  services.mission.isReady = () => true;
  try {
    runSearch();
    await new Promise(r => setTimeout(r, 0));
    assert.ok(loads > 0);
    // The search carries the skipped rule: the result, the CSV and the link say it from there.
    assert.deepEqual(cond.skippedRules, [{ id: 'C4', title: 'Hueco sin Tierra frente al % mínimo' }]);
    assert.equal(cond.maxEarthGapHours, 100); // what is typed, untrimmed
    // The mission service keeps them in the result, and the note under the date says which.
    const real = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites: cond.sites });
    await real.prepare({ fromMs: cond.from - 864e5, toMs: cond.to + 20 * 864e5 });
    const res = await real.search(cond);
    assert.deepEqual(res.conditions.skippedRules, cond.skippedRules);
    paintSkipped(res.conditions);
    assert.equal(byId('res-skipped').hidden, false);
    assert.match(byId('res-skipped').textContent, /^Calculado con 1 regla de coherencia saltada: C4 \(Hueco sin Tierra frente al % mínimo\)\.$/);
    // A plan without skips shows nothing new.
    paintSkipped((await real.search({ ...cond, skippedRules: [] })).conditions);
    assert.equal(byId('res-skipped').hidden, true);
    assert.equal(byId('res-skipped').textContent, '');
  } finally {
    services.mission = { isReady: () => false, prepare: () => { loads++; return new Promise(() => {}); }, heightsEffect: () => null };
  }
});

test('un enlace trae las reglas saltadas y la clase de nave, también de ida y vuelta por el visor 3D', () => {
  state.searchResult = null;
  initPlanForm(CLASH); // without ?skip=: blocked, the form stops at the requirements
  assert.equal(step(), '2');
  assert.match(checks('plan-earth-gap'), /<b>Bloquea:<\/b>/);
  const link = { ...CLASH, skippedRules: ['C4'], craftClass: 'crewed', days: 10 };
  const back = parseMission(viewerUrl(link, '').split('?')[1]);
  assert.deepEqual(back.skippedRules, ['C4']);
  assert.equal(back.craftClass, 'crewed');
  initPlanForm(back);
  assert.equal(byId('plan-class').value, 'crewed');
  assert.match(checks('plan-earth-gap'), /<b>Regla saltada\.<\/b>/);
  assert.match(checks('plan-days'), /C12/); // 10 days is long for a crewed mission: the class is the one of the plan
  assert.equal(step(), '4'); // nothing blocks: it goes to the last step
  // A class Plan does not know is left out.
  assert.equal(parseMission('site=malapert&t0=2027-11-17T12:00:00Z&days=10&class=starship').craftClass, undefined);
});

test('una misión del historial restaura las reglas saltadas y la clase de nave', () => {
  state.searchResult = null;
  initPlanForm();
  const entry = missionEntry({ ...CLASH, searchSiteId: null, panelHeightM: 30, antennaHeightM: 2, savedAt: 1, verdict: 'go',
    skippedRules: ['C4'], craftClass: 'crewed' });
  assert.equal(entry.craftClass, 'crewed');
  openMission(entry); // the search waits for data that never comes
  assert.equal(byId('plan-class').value, 'crewed');
  assert.match(checks('plan-earth-gap'), /<b>Regla saltada\.<\/b>/);
  assert.equal(checks('plan-panel-height'), ''); // 30 m is no warning for a crewed spacecraft
  assert.equal(missionEntry({ ...entry, craftClass: 'starship' }).craftClass, undefined);
});

// ---------------- The battery of the own spacecraft (#253) ----------------
/** «Nave propia» on step 2 with its autonomy «Con la batería». */
function batteryShip(days = '14', earth = '50') {
  ownShip(days, '', earth);
  byId('plan-autonomy').value = 'battery';
  byId('plan-autonomy').listeners.change.forEach(fn => fn());
}

test('el modo «batería» solo se ofrece con «Nave propia» y sale con los valores por defecto del motor', () => {
  fresh();
  clickCard(PROFILES[0].id);
  assert.equal(byId('plan-autonomy-field').hidden, true);
  assert.equal(byId('plan-battery-group').hidden, true);
  clickCard('custom');
  assert.equal(byId('plan-autonomy-field').hidden, false);
  assert.equal(byId('plan-autonomy').value, 'hours');
  assert.equal(byId('plan-battery').readOnly, false);
  batteryShip();
  assert.equal(byId('plan-battery-group').hidden, false);
  assert.equal(byId('plan-battery').readOnly, true);
  assert.equal(byId('plan-battery-load').value, '100');
  assert.equal(byId('plan-battery-dod').value, '0.9');
  assert.equal(byId('plan-battery-spec').placeholder, '200');
  // Without a capacity there are no hours, and the step says what is missing.
  assert.equal(byId('plan-battery').value, '');
  next();
  assert.equal(step(), '2');
  // Choosing an example spacecraft goes back to its hours.
  clickCard(PROFILES[0].id);
  assert.equal(byId('plan-autonomy').value, 'hours');
  assert.equal(byId('plan-battery').readOnly, false);
  assert.equal(byId('plan-battery').value, String(PROFILES[0].batteryHours));
});

test('con «batería», cada uno de los tres datos recalcula las horas y enseña la cuenta', () => {
  batteryShip('30');
  type('plan-battery-wh', '20000');
  type('plan-battery-load', '46');
  assert.equal(byId('plan-battery').value, '391.3'); // the case of COMPASS
  assert.equal(byId('plan-battery-calc').textContent, 'Calculado con la batería: 20.000 Wh × 0,9 / 46 W = 391,3 h.');
  assert.match(byId('plan-battery-mass').textContent, /^Masa del pack: 100 kg \(20\.000 Wh ÷ 200 Wh\/kg, la energía específica por defecto\)\. Solo el pack: sin electrónica/);
  assert.match(checks('plan-battery'), /B6/); // a whole lunar night on the battery, with its mass
  type('plan-battery-dod', '0.8');
  assert.equal(byId('plan-battery').value, '347.8');
  type('plan-battery-wh', '10000');
  assert.equal(byId('plan-battery').value, '173.9');
  next();
  assert.equal(step(), '3');
});

test('una batería de más de 720 h no deja buscar y dice por qué; una carga de 0 W no da Infinity ni NaN', async () => {
  batteryShip('30');
  type('plan-battery-wh', '40000');
  type('plan-battery-load', '46');
  assert.equal(byId('plan-battery').value, '782.6');
  assert.match(checks('plan-battery'), /<b>Bloquea:<\/b> La batería da 40\.000 Wh × 0,9 \/ 46 W = 782,6 h: más de las 720 h/);
  assert.doesNotMatch(checks('plan-battery'), /data-skip/);
  next();
  assert.equal(step(), '2');
  type('plan-battery-load', '0');
  assert.match(checks('plan-battery-load'), /<b>Bloquea:<\/b>.*B3/s);
  assert.doesNotMatch(checks('plan-battery-load'), /data-skip/);
  for (const id of ['plan-battery', 'plan-battery-calc', 'plan-battery-mass', 'plan-battery-checks', 'plan-battery-load-checks', 'plan-req-error']) {
    assert.doesNotMatch(`${byId(id).value} ${byId(id).textContent} ${byId(id).innerHTML}`, /NaN|Infinity/, id);
  }
  assert.equal(byId('plan-battery').value, '');
  loads = 0;
  await runSearch();
  assert.equal(loads, 0); // no search with that battery
});

test('B1, B4 y B5 ofrecen «Continuar de todos modos»; la profundidad de descarga fuera de 0–1, no', () => {
  batteryShip();
  type('plan-battery-wh', '2000');
  type('plan-battery-spec', '350');
  assert.match(checks('plan-battery-spec'), /aria-label="Continuar de todos modos: saltar la regla B1, Energía específica del pack"/);
  skip('plan-battery-spec');
  assert.match(checks('plan-battery-spec'), /<b>Regla saltada\.<\/b>/);
  type('plan-battery-spec', '');
  type('plan-dry-mass', '15');
  assert.match(checks('plan-battery-kg'), /aria-label="Continuar de todos modos: saltar la regla B4/);
  type('plan-dry-mass', '');
  type('plan-battery-kg', '10');
  type('plan-battery-spec', '150');
  assert.match(checks('plan-battery-wh'), /aria-label="Continuar de todos modos: saltar la regla B5/);
  type('plan-battery-spec', '');
  type('plan-battery-dod', '1.5');
  assert.match(checks('plan-battery-dod'), /<b>Bloquea:<\/b>.*B2/s);
  assert.doesNotMatch(checks('plan-battery-dod'), /data-skip/);
  assert.equal(byId('plan-battery-dod').getAttribute('aria-invalid'), 'true');
});

test('la búsqueda manda solo las horas a la API y lleva la batería para el enlace; un enlace vuelve con la batería', async () => {
  batteryShip('30');
  type('plan-battery-wh', '20000');
  type('plan-battery-load', '46');
  type('plan-dry-mass', '1500');
  byId('plan-from').value = '2027-11-10'; byId('plan-to').value = '2027-11-24';
  let cond = null;
  services.mission = { isReady: () => true, prepare: () => Promise.resolve(), heightsEffect: () => null, search: c => { cond = c; return new Promise(() => {}); } };
  try {
    runSearch();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(cond.batteryHours, 391.3);
    assert.deepEqual(cond.battery, { capacityWh: 20000, survivalLoadW: 46, depthOfDischarge: 0.9, dryMassKg: 1500 });
    for (const k of ['batteryWh', 'batteryDod', 'batteryLoadW', 'autonomy', 'dryMassKg']) assert.ok(!(k in cond), k);
  } finally {
    services.mission = { isReady: () => false, prepare: () => { loads++; return new Promise(() => {}); }, heightsEffect: () => null };
  }
  // The link of the plan keeps the battery, not only its hours: Plan opens it in «batería» mode and works them out again.
  const back = parseMission(viewerUrl({ siteId: 'malapert', t0: Date.UTC(2027, 10, 17, 12), days: 30, batteryHours: 391.3, minEarthPct: 50,
    profile: 'custom', from: '2027-11-10', to: '2027-11-24', battery: cond.battery }, '').split('?')[1]);
  state.searchResult = null;
  initPlanForm(back);
  assert.equal(byId('plan-autonomy').value, 'battery');
  assert.equal(byId('plan-battery-wh').value, '20000');
  assert.equal(byId('plan-dry-mass').value, '1500');
  assert.equal(byId('plan-battery').value, '391.3');
  // The history too.
  initPlanForm();
  openMission(missionEntry({ ...back, searchSiteId: null, savedAt: 1, verdict: 'go' }));
  assert.equal(byId('plan-autonomy').value, 'battery');
  assert.equal(byId('plan-battery').value, '391.3');
  // A plan without a battery opens in «horas».
  initPlanForm({ ...back, battery: undefined });
  assert.equal(byId('plan-autonomy').value, 'hours');
  assert.equal(byId('plan-battery').value, '391.3');
});
