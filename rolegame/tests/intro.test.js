// J5: introduction and trials (pure decisions and the figures they reveal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables } from '../src/engine/index.js';
import { TRIALS, introSteps, nextPhase, stepIndex, answerTrial, optionState, introHour, shadowChange, batteryCurves,
  earthWindow, missionDay, miniTexts, EARTH_TRIAL_HOUR, trialById } from '../src/intro.js';
import { earthCells } from '../src/earth-layer.js';
import { padDistanceKm } from '../src/hint.js';
import { windWord } from '../src/mission-hint.js';
import { bearing } from '../../web/js/common/sky-polar.js';
import { TEXTS } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data/procedural-shackleton');
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const series = JSON.parse(readFileSync(join(dir, 'series.json'), 'utf8'));
const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const real = createTables(buf('sun.bin'), scenario, buf('cells.bin'), buf('earth.bin'));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// ---- J5.1 ----

test('sin pruebas la barra es Aterrizaje y Atascados, y la introducción lleva a la misión', () => {
  assert.deepEqual(introSteps([]), ['landing', 'play']);
  assert.equal(nextPhase('landing', []), 'play');
});

test('con tres pruebas la barra tiene 5 pasos y nextPhase las recorre en orden', () => {
  assert.deepEqual(introSteps(TRIALS), ['landing', 'shadows', 'power', 'earth', 'play']);
  assert.equal(nextPhase('landing'), 'shadows');
  assert.equal(nextPhase('shadows'), 'power');
  assert.equal(nextPhase('power'), 'earth');
  assert.equal(nextPhase('earth'), 'play');
  assert.equal(nextPhase('play'), 'play');
});

test('stepIndex: el final cuenta como la misión', () => {
  assert.equal(stepIndex('end'), stepIndex('play'));
  assert.equal(stepIndex('play'), 4);
  assert.equal(stepIndex('landing'), 0);
});

test('el texto de la introducción da la distancia del escenario (5,6 km), no un número escrito', () => {
  const km = padDistanceKm(scenario, scenario.grid.cellM);
  assert.match(TEXTS.introText(km, TRIALS.length), /a 5,6 km, pero no despegará sin permiso/);
  // J3.6: what the packages are for.
  assert.match(TEXTS.introText(km, 0), /control de misión necesita tu informe del terreno/);
  assert.match(TEXTS.introText(km, 3), /tres pruebas rápidas/);
  assert.doesNotMatch(TEXTS.introText(km, 0), /prueba/);
  assert.match(TEXTS.introText(1.25, 3), /a 1,3 km/);
  const src = readFileSync(join(root, 'src/texts.js'), 'utf8');
  assert.doesNotMatch(src, /400 m|6 km/);
});

test('cada paso de la barra y cada prueba tienen sus textos', () => {
  for (const id of introSteps(TRIALS)) assert.equal(typeof TEXTS.steps[id], 'string', id);
  for (const t of TRIALS) {
    const tx = TEXTS.trials[t.key];
    assert.equal(tx.options.length, 3, t.id);
    for (const k of ['name', 'title', 'question', 'reveal']) assert.equal(typeof tx[k], 'string', `${t.id}.${k}`);
    assert.ok(t.answer >= 0 && t.answer < 3);
  }
  assert.equal(TEXTS.trialKicker(1, 3, TEXTS.trials.shadows.name), 'Prueba 1 de 3 · Sombras');
  assert.equal(TEXTS.trialKicker(3, 3, TEXTS.trials.earth.name), 'Prueba 3 de 3 · Comunicaciones');
});

// ---- J5.2 ----

const shadows = trialById('shadows');

test('answerTrial: ok con 1, ko con 0 y 2, shown con −1', () => {
  assert.equal(answerTrial(shadows, 1), 'ok');
  assert.equal(answerTrial(shadows, 0), 'ko');
  assert.equal(answerTrial(shadows, 2), 'ko');
  assert.equal(answerTrial(shadows, -1), 'shown');
});

test('optionState tras elegir 0 y tras «Enséñamelo»', () => {
  assert.deepEqual([0, 1, 2].map((k) => optionState(shadows, 0, k)), ['ko', 'ok', null]);
  assert.deepEqual([0, 1, 2].map((k) => optionState(shadows, -1, k)), [null, 'ok', null]);
  assert.deepEqual([0, 1, 2].map((k) => optionState(shadows, 1, k)), [null, 'ok', null]);
});

test('introHour: 48 h en 4,2 s, acotada', () => {
  assert.equal(introHour(0), 0);
  assert.equal(introHour(2100), 24);
  assert.equal(introHour(4200), 48);
  assert.equal(introHour(9000), 48);
  assert.equal(introHour(-50), 0);
});

test('shadowChange en el escenario real: 350 celdas pasan a Sol y 201 a sombra entre 0 h y 48 h', () => {
  assert.deepEqual(shadowChange(real, 0, 48), { toSun: 350, toShadow: 201 });
  assert.equal(TEXTS.shadowChange(350, 201), 'En 48 h, 350 celdas han pasado a tener Sol y 201 han pasado a sombra.');
});

test('el escenario enseña lo que dice la prueba: cambia al menos el 10 % de las celdas en 48 h', () => {
  const { toSun, toShadow } = shadowChange(real, 0, 48);
  assert.ok(toSun + toShadow >= 0.1 * real.n * real.n, `${toSun + toShadow}`);
});

// ---- J5.3 ----

test('batteryCurves (principiante) salen del motor', () => {
  const { sun, dark } = batteryCurves(levels.beg);
  assert.equal(sun.length, 25);
  assert.equal(dark.length, 25);
  near(sun[0], 60); near(dark[0], 60);
  near(sun[9], 98.7);
  near(sun[10], 100); near(sun[24], 100);
  near(dark[10], 48);
  near(dark[24], 31.2);
});

test('batteryCurves (intermedio) sigue a los datos del nivel', () => {
  const { sun, dark } = batteryCurves(levels.mid);
  near(dark[24], 12);
  near(sun[24], 100);
});

test('batteryCurves es determinista y no toca las tablas del escenario', () => {
  const before = real.sunFrac(0, 0);
  assert.deepEqual(batteryCurves(levels.beg), batteryCurves(levels.beg));
  assert.equal(real.sunFrac(0, 0), before);
});

test('el minigráfico y la frase usan los valores redondeados de las curvas', () => {
  const curves = batteryCurves(levels.beg);
  const m = miniTexts(curves, TEXTS);
  assert.equal(m.label, 'En 24 h, al Sol la batería pasa de 60 % a 100 %; en sombra, de 60 % a 31 %.');
  assert.equal(m.sun, 'al sol 100 %');
  assert.equal(m.dark, 'en sombra 31 %');
  assert.equal(TEXTS.powerTenHours(curves.dark[0], curves.dark[10]), 'Con tu rover, 10 h en sombra lo dejan del 60 % al 48 %.');
  const mid = miniTexts(batteryCurves(levels.mid), TEXTS);
  assert.match(mid.label, /de 60 % a 12 %/);
});

// ---- J5.4 ----

function earthOnly(n, hours, visible) {
  const sc = { grid: { n, cellM: 250 }, hours };
  const bits = new Uint8Array(Math.ceil((hours * n * n) / 8));
  for (let h = 0; h < hours; h++) for (let c = 0; c < n * n; c++) {
    const o = h * n * n + c;
    if (visible(h, c)) bits[o >> 3] |= 1 << (o & 7);
  }
  return createTables(new Uint8Array(hours * n * n).buffer, sc, undefined, bits.buffer);
}

test('earthWindow en el escenario real: de la hora 0 a la 244, del día 1 al día 11', () => {
  const w = earthWindow(real);
  assert.deepEqual(w, { first: 0, last: 244 });
  assert.equal(TEXTS.earthWindowText(missionDay(w.first), missionDay(w.last)),
    'En esta partida, la Tierra se ve desde algún punto del mapa del día 1 al día 11.');
});

test('earthWindow con datos sintéticos: de la hora 30 a la 100 son los días 2 a 5; sin Tierra, nada', () => {
  const w = earthWindow(earthOnly(2, 200, (h, c) => c === 3 && h >= 30 && h <= 100));
  assert.deepEqual(w, { first: 30, last: 100 });
  assert.deepEqual([missionDay(w.first), missionDay(w.last)], [2, 5]);
  assert.equal(earthWindow(earthOnly(2, 50, () => false)), null);
});

test('el rumbo de la revelación sale de la serie (hoy, sureste) y ningún texto de las pruebas dice «norte»', () => {
  const wind = windWord(bearing(series.earth.az[EARTH_TRIAL_HOUR]).wind);
  assert.equal(wind, 'sureste');
  assert.equal(TEXTS.earthBearingText(wind), 'En este sitio la Tierra está al sureste, rozando el horizonte.');
  const all = JSON.stringify(TEXTS.trials);
  assert.doesNotMatch(all, /norte/);
});

test('tras la tercera prueba se entra en la misión y la barra marca Tierra hecha y Atascados actual', () => {
  assert.equal(nextPhase('earth'), 'play');
  const steps = introSteps(TRIALS);
  const i = stepIndex('play');
  assert.equal(steps[i], 'play');
  assert.ok(steps.indexOf('earth') < i);
});

test('en EARTH_TRIAL_HOUR hay celdas que ven la Tierra y celdas que no', () => {
  const count = earthCells(real, EARTH_TRIAL_HOUR).length;
  assert.equal(count, 1470);
  assert.ok(count > 0 && count < real.n * real.n);
  assert.equal(TEXTS.earthCellsText(count, real.n * real.n), 'Desde 1.470 de 2.304 celdas se ve la Tierra.');
});
