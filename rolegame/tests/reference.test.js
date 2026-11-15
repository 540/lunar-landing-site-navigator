// J7.3: the reference route of the solver and the lowest battery of the game.
import { test } from 'node:test';
import { levelsFor } from '../src/scenario-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, pass, wait, move, pathTo } from '../src/engine/index.js';
import { referenceFor, replayReference, compareWithReference } from '../src/reference.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data/procedural-shackleton');
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const solver = JSON.parse(readFileSync(join(dir, 'solver.json'), 'utf8'));
const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const real = createTables(buf('sun.bin'), scenario, buf('cells.bin'), buf('earth.bin'));

// Small world: dark for 10 h, then sunny.
const N = 3, HOURS = 100;
const small = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 0, y: 0 }, pad: { x: 2, y: 2 } };
const sun = new Uint8Array(HOURS * N * N);
for (let h = 10; h < HOURS; h++) for (let c = 0; c < N * N; c++) sun[h * N * N + c] = 255;
const tables = createTables(sun.buffer, small);
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('minBattery es la batería más baja vista en pass, wait y move, sin cambiar nada más', () => {
  const g = newGame(small, levels.beg, tables);
  assert.equal(g.minBattery, levels.beg.bat0);
  const a = wait(g, 20);
  let seen = g.battery;
  for (let s = g, k = 0; k < 40; k++) { s = wait(s, 0.5); seen = Math.min(seen, s.battery); }
  near(a.minBattery, seen, 1e-9);
  assert.ok(a.minBattery < levels.beg.bat0 - 10);
  assert.ok(a.battery > a.minBattery);
  const b = move(pass(g, 4), pathTo(g, { x: 1, y: 1 }));
  assert.ok(b.minBattery <= b.battery && b.minBattery < levels.beg.bat0);
  // Same battery, clock and end as without the field.
  const { minBattery: _m, ...rest } = wait(g, 20);
  const { minBattery: _n, ...again } = wait({ ...g, minBattery: undefined }, 20);
  assert.deepEqual({ ...rest, tables: 0 }, { ...again, tables: 0 });
});

test('referenceFor: null sin el nivel, sin ganar o sin acciones; si no, la ruta y las acciones', () => {
  const example = { beg: { winnable: true, route: [{ x: 0, y: 0 }, { x: 1, y: 1 }], actions: [{ type: 'wait', hours: 2 }], timeMarginH: 3 } };
  assert.equal(referenceFor(example, 'mid'), null);
  assert.equal(referenceFor({ beg: { ...example.beg, winnable: false } }, 'beg'), null);
  assert.equal(referenceFor({ beg: { ...example.beg, actions: undefined } }, 'beg'), null);
  assert.equal(referenceFor({ beg: { ...example.beg, route: [] } }, 'beg'), null);
  assert.equal(referenceFor(null, 'beg'), null);
  assert.deepEqual(referenceFor(example, 'beg'), example.beg && { route: example.beg.route, actions: example.beg.actions, timeMarginH: 3 });
});

test('con el solver.json real, la reproducción gana cada nivel con los márgenes del resolutor', () => {
  for (const id of ['beg', 'mid', 'exp']) {
    const ref = referenceFor(solver, id);
    assert.ok(ref, id);
    const end = replayReference(scenario, levels[id], real, ref);
    assert.equal(end.over, 'win', id);
    near(end.t, levels[id].deadline - solver[id].timeMarginH);
    near(end.battery - levels[id].minBat, solver[id].batteryMargin);
    assert.ok(end.minBattery <= end.battery);
    assert.equal(end.event, null, 'sin evento');
  }
});

test('compareWithReference: porcentaje entero, reloj del panel y si llegó', () => {
  const won = { over: 'win', t: 270, battery: 30, minBattery: 9.4 };
  const solverEnd = { t: 210.5, minBattery: 23.9 };
  const cmp = compareWithReference(won, solverEnd);
  assert.deepEqual(cmp, { player: { minBattery: 9, day: 12, hour: 6, arrived: true }, solver: { minBattery: 23, day: 9, hour: 18 } });
  assert.equal(texts('es').clock(cmp.player.day, cmp.player.hour), 'Día 12 · 06:00');
  assert.equal(compareWithReference({ ...won, over: 'battery' }, solverEnd).player.arrived, false);
});

test('cada escenario con solver.json se reproduce con sus márgenes (también LOLA)', () => {
  const ids = JSON.parse(readFileSync(join(root, 'data/scenarios.json'), 'utf8')).scenarios;
  for (const id of ids) {
    const d = join(root, 'data', id);
    const sc = JSON.parse(readFileSync(join(d, 'scenario.json'), 'utf8'));
    const solved = JSON.parse(readFileSync(join(d, 'solver.json'), 'utf8'));
    const b = (f) => { const x = readFileSync(join(d, f)); return x.buffer.slice(x.byteOffset, x.byteOffset + x.length); };
    const t = createTables(b('sun.bin'), sc, b('cells.bin'), b('earth.bin'));
    for (const lv of ['beg', 'mid', 'exp']) {
      const ref = referenceFor(solved, lv);
      if (!ref) continue;
      // #313: the levels this scenario plays (Mons Mouton shortens the deadline), as the solver used them.
      const level = levelsFor(levels, sc)[lv];
      const end = replayReference(sc, level, t, ref);
      assert.equal(end.over, 'win', `${id} ${lv}`);
      near(end.t, level.deadline - solved[lv].timeMarginH);
    }
  }
});
