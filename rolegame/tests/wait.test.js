import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, pass, wait } from '../src/engine/index.js';
import { WAIT_ACTIONS, waitDisabled, waitDurationMs, waitAnnouncement, hasSun, hasEarth, UNTIL_EARTH_MAX_H } from '../src/wait.js';
import { MAX_MOVE_MS } from '../src/tap.js';
import { TEXTS } from '../src/texts.js';
import { endAnnouncement } from '../src/end.js';

const here = dirname(fileURLToPath(import.meta.url));
const levels = JSON.parse(readFileSync(join(here, '../data/levels.json'), 'utf8'));
const level = levels.beg;
const N = 3;
const HOURS = 100;
const scenario = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 0, y: 0 }, pad: { x: 2, y: 2 } };
const tables = (fill) => {
  const buf = new Uint8Array(HOURS * N * N);
  for (let h = 0; h < HOURS; h++) for (let c = 0; c < N * N; c++) buf[h * N * N + c] = fill(h, c);
  return createTables(buf.buffer, scenario);
};
const dark = tables(() => 0);
const sunny = tables(() => 255);
const sunAt5 = tables((h) => (h >= 5 ? 255 : 0));

test('los cuatro botones llevan sus textos y piden al motor lo que dice la historia', () => {
  assert.deepEqual(WAIT_ACTIONS.map((a) => TEXTS[a.label]), ['Esperar 2 h', 'Esperar 6 h', 'Hasta tener sol', 'Hasta ver la Tierra']);
  const g = newGame(scenario, level, sunAt5);
  assert.deepEqual(WAIT_ACTIONS[0].run(g), wait(g, 2));
  assert.deepEqual(WAIT_ACTIONS[1].run(g), wait(g, 6));
  assert.equal(WAIT_ACTIONS[2].run(g).t, 5);
  assert.equal(WAIT_ACTIONS[2].run(newGame(scenario, level, dark)).t, 24);
});

test('botones desactivados: con ruta planeada, rover en marcha, partida acabada o Sol ya en la celda', () => {
  const g = newGame(scenario, level, dark);
  assert.deepEqual(waitDisabled(g, { planned: false, busy: false }), { 'wait-2': false, 'wait-6': false, 'wait-sun': false, 'wait-earth': false });
  assert.deepEqual(waitDisabled(g, { planned: true, busy: false }), { 'wait-2': true, 'wait-6': true, 'wait-sun': true, 'wait-earth': true });
  assert.deepEqual(waitDisabled(g, { planned: false, busy: true }), { 'wait-2': true, 'wait-6': true, 'wait-sun': true, 'wait-earth': true });
  const over = pass(g, 200);
  assert.ok(over.over);
  assert.deepEqual(waitDisabled(over, { planned: false, busy: false }), { 'wait-2': true, 'wait-6': true, 'wait-sun': true, 'wait-earth': true });
  const lit = newGame(scenario, level, sunny);
  assert.ok(hasSun(lit));
  assert.deepEqual(waitDisabled(lit, { planned: false, busy: false }), { 'wait-2': false, 'wait-6': false, 'wait-sun': true, 'wait-earth': false });
});

test('la animación de la espera es proporcional a las horas, con 1,8 s como mucho y 0 con movimiento reducido', () => {
  assert.ok(waitDurationMs(6) > waitDurationMs(2));
  assert.ok(waitDurationMs(2) > 0);
  assert.equal(waitDurationMs(24), MAX_MOVE_MS);
  assert.equal(waitDurationMs(6, true), 0);
  assert.equal(waitDurationMs(0), 0);
});

test('el anuncio dice las horas esperadas, la batería y el reloj, o el final de partida', () => {
  const g = newGame(scenario, level, sunAt5);
  const w = wait(g, 24, { untilSun: true });
  assert.equal(waitAnnouncement(g, w, TEXTS), `Has esperado 5 h. Batería ${Math.floor(w.battery)} %, día 1 · 05:00`);
  const half = { ...g, t: 0.5 };
  assert.match(waitAnnouncement(half, wait(half, 24, { untilSun: true }), TEXTS), /^Has esperado 4,5 h\. /);
  const late = { ...newGame(scenario, level, dark), t: 30 };
  assert.match(waitAnnouncement(late, wait(late, 2), TEXTS), /día 2 · 08:00$/);
  const empty = newGame(scenario, { ...level, bat0: 1 }, dark);
  assert.equal(waitAnnouncement(empty, wait(empty, 6), TEXTS), endAnnouncement(wait(empty, 6), TEXTS));
});

// ---- «Hasta ver la Tierra» (J3.3) ----

function withEarth(sunFill, visible) {
  const sun = new Uint8Array(HOURS * N * N);
  const bits = new Uint8Array(Math.ceil((HOURS * N * N) / 8));
  for (let h = 0; h < HOURS; h++) for (let c = 0; c < N * N; c++) {
    const o = h * N * N + c;
    sun[o] = sunFill(h, c);
    if (visible(h, c)) bits[o >> 3] |= 1 << (o & 7);
  }
  return createTables(sun.buffer, scenario, undefined, bits.buffer);
}

test('«Hasta ver la Tierra» espera hasta que asoma, 24 h como mucho', () => {
  const action = WAIT_ACTIONS.find((a) => a.id === 'wait-earth');
  assert.equal(UNTIL_EARTH_MAX_H, 24);
  assert.equal(action.run(newGame(scenario, level, withEarth(() => 0, (h) => h >= 5))).t, 5);
  assert.equal(action.run(newGame(scenario, level, withEarth(() => 0, () => false))).t, 24);
});

test('waitDisabled apaga «Hasta ver la Tierra» si ya se ve, y no los otros tres por ese motivo', () => {
  const g = newGame(scenario, level, withEarth(() => 0, () => true));
  assert.ok(hasEarth(g));
  assert.deepEqual(waitDisabled(g, { planned: false, busy: false }), { 'wait-2': false, 'wait-6': false, 'wait-sun': false, 'wait-earth': true });
});

test('el anuncio avisa si en 24 h no asoma la Tierra, y no lo dice si asoma', () => {
  const never = newGame(scenario, level, withEarth(() => 0, () => false));
  const w = wait(never, 24, { untilEarth: true });
  assert.match(waitAnnouncement(never, w, TEXTS, { untilEarth: true }), /Desde aquí no se ve la Tierra en las próximas 24 h/);
  assert.doesNotMatch(waitAnnouncement(never, w, TEXTS), /Tierra/);
  const soon = newGame(scenario, level, withEarth(() => 0, (h) => h >= 5));
  assert.doesNotMatch(waitAnnouncement(soon, wait(soon, 24, { untilEarth: true }), TEXTS, { untilEarth: true }), /no se ve la Tierra/);
});
