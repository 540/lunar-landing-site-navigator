import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTables } from '../../rolegame/src/engine/index.js';
import { solveLevel, solveLevels, assertSolvable, solverJson, replay, isTrivial, marginsTable } from '../game-solver.mjs';
import { SCENARIO_DIR, OUT_DIR } from '../game-scenario.mjs';

// Synthetic world of the story: 6 × 6 flat cells, 48 h, start (0, 0), pad (5, 0).
const N = 6, HOURS = 48;
const scenario = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 0, y: 0 }, pad: { x: 5, y: 0 } };
// need: 0 because this world has no earth.bin (the story's level predates the packages of J3).
const level = { need: 0, bat0: 20, deadline: 48, charge: 5, loadSun: 0.7, loadDark: 1.2, moveE: 1.6, minBat: 15, panelMin: 0, maxSlope: 26, slopeCost: 12 };
const tables = (sunFrom) => {
  const sun = new Uint8Array(HOURS * N * N);
  for (let h = 0; h < HOURS; h++) sun.fill(h >= sunFrom ? 255 : 0, h * N * N, (h + 1) * N * N);
  return createTables(sun.buffer, scenario);
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} != ${b}`);

test('sombra hasta la hora 10 y Sol después: ganable, no trivial, y las acciones se reproducen con el motor', () => {
  const t = tables(10);
  const r = solveLevel({ scenario, level, tables: t });
  assert.equal(r.winnable, true);
  assert.equal(r.trivial, false, 'directo llega a la hora 5 con un 6 %');
  const end = replay({ scenario, level, tables: t }, r.actions);
  assert.equal(end.over, 'win');
  near(end.battery - level.minBat, r.batteryMargin);
  near(level.deadline - end.t, r.timeMarginH);
  assert.deepEqual(r.route[0], scenario.start);
  assert.deepEqual(r.route.at(-1), scenario.pad);
  assert.ok(r.actions.every((a) => ['move', 'wait'].includes(a.type)));
  for (let i = 1; i < r.actions.length; i++) assert.notEqual(r.actions[i].type, r.actions[i - 1].type, 'acciones seguidas fundidas');
});

test('todo en sombra: no ganable, y la validación lanza un error que nombra el nivel', () => {
  const r = solveLevel({ scenario, level, tables: tables(HOURS) });
  assert.equal(r.winnable, false);
  assert.throws(() => assertSolvable({ beg: r }, { beg: level }), /El nivel beg no se puede ganar: ninguna secuencia llega a ASCENSO con un 15 % antes del día 2/);
});

test('con 85 % y todo al Sol el nivel es trivial y el pipeline lo rechaza', () => {
  const easy = { ...level, bat0: 85 };
  const t = tables(0);
  assert.equal(isTrivial({ scenario, level: easy, tables: t }), true);
  const r = solveLevel({ scenario, level: easy, tables: t });
  assert.equal(r.trivial, true);
  assert.throws(() => assertSolvable({ mid: r }, { mid: easy }), /El nivel mid es trivial/);
});

test('mismas tablas, mismo solver.json byte a byte', () => {
  const a = solverJson(solveLevels({ scenario, levels: { beg: level }, tables: tables(10) }));
  const b = solverJson(solveLevels({ scenario, levels: { beg: level }, tables: tables(10) }));
  assert.equal(a, b);
  assert.match(marginsTable(JSON.parse(a)), /beg\s+sí\s+no/);
});

test('el resolutor importa el motor de rolegame/src/engine/ y no define reglas propias', () => {
  const src = readFileSync(new URL('../game-solver.mjs', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/rolegame\/src\/engine\/index\.js'/);
  for (const name of ['pass', 'move', 'wait', 'stepCost', 'transmit']) {
    assert.doesNotMatch(src, new RegExp(`function ${name}\\b|const ${name}\\s*=`), name);
  }
});

test('procedural-shackleton: los tres niveles se ganan, ninguno es trivial y la jugada subida se reproduce', () => {
  const solved = JSON.parse(readFileSync(new URL('solver.json', SCENARIO_DIR), 'utf8'));
  const levels = JSON.parse(readFileSync(new URL('levels.json', OUT_DIR), 'utf8'));
  const read = (f) => { const b = readFileSync(new URL(f, SCENARIO_DIR)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  const sc = JSON.parse(readFileSync(new URL('scenario.json', SCENARIO_DIR), 'utf8'));
  const t = createTables(read('sun.bin'), sc, read('cells.bin'), read('earth.bin'));
  assert.deepEqual(Object.keys(solved), ['beg', 'mid', 'exp']);
  assert.doesNotThrow(() => assertSolvable(solved, levels));
  for (const [id, r] of Object.entries(solved)) {
    const end = replay({ scenario: sc, level: levels[id], tables: t }, r.actions);
    assert.equal(end.over, 'win', id);
    assert.equal(end.sent, levels[id].need, id);
    near(end.battery - levels[id].minBat, r.batteryMargin);
  }
});
