// Solver of the game levels (J9.1): checks that each level can be won and that none is trivial, with the very
// same rules engine as the browser (rolegame/src/engine/). It copies no rule: if the engine changes, the solver
// plays with the new rules.
// Search: dynamic programming over (cell, half hour, packages sent), keeping per node only the state with the
// most battery. Each node carries the cells its packages went from (J3.6), so the engine applies the 1 km rule;
// a node with less battery but a better spread of sends is dropped, which keeps the search a lower bound. It is a lower bound: a win found is a real win (it is the engine's own state); a level where it
// finds none is taken as not winnable.
// Usage: node pipeline/game-solver.mjs [--scenario <id>]   (or: npm run pipeline:game-solver)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, wait, move, transmit, pathTo, stepCost } from '../rolegame/src/engine/index.js';

export const SLOT_H = 0.5;
const EPS = 1e-6;
const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Is the level trivial? Driving straight from the start to the pad by pathTo, at hour 0 and without waiting,
 * then sending the packages right there (none when need is 0), wins.
 */
export function isTrivial({ scenario, level, tables }) {
  const s0 = newGame(scenario, level, tables);
  const path = pathTo(s0, scenario.pad);
  if (!path) return false;
  let s = move(s0, path);
  for (let k = 0; k < level.need && !s.over; k++) {
    const next = transmit(s);
    if (next === s) break;
    s = next;
  }
  return s.over === 'win';
}

// The actions of the best win, from the start: consecutive steps fused into one move, consecutive waits into one.
function actionsOf(node) {
  const steps = [];
  for (let n = node; n.parent; n = n.parent) steps.push(n);
  steps.reverse();
  const actions = [];
  for (const n of steps) {
    const last = actions[actions.length - 1];
    if (n.action === 'move') {
      if (last?.type === 'move') last.path.push({ x: n.x, y: n.y });
      else actions.push({ type: 'move', path: [{ x: n.x, y: n.y }] });
    } else if (n.action === 'wait') {
      if (last?.type === 'wait') last.hours += SLOT_H;
      else actions.push({ type: 'wait', hours: SLOT_H });
    } else {
      actions.push({ type: 'transmit' });
    }
  }
  return actions;
}

function routeOf(node) {
  const cells = [];
  for (let n = node; n; n = n.parent) if (n.action === 'move' || !n.parent) cells.push({ x: n.x, y: n.y });
  return cells.reverse();
}

/** Replays solver actions with the engine, from a new game. */
export function replay({ scenario, level, tables }, actions) {
  let s = newGame(scenario, level, tables);
  for (const a of actions) {
    if (a.type === 'move') s = move(s, a.path);
    else if (a.type === 'wait') s = wait(s, a.hours);
    else s = transmit(s);
  }
  return s;
}

/**
 * Best win of a level: { winnable, trivial, batteryMargin, timeMarginH, actions, route }. «Best» is the one with
 * most battery left over level.minBat; with the same battery, the earliest one.
 */
export function solveLevel({ scenario, level, tables }) {
  const n = tables.n;
  const need = level.need ?? 0;
  const lastSlot = Math.ceil(level.deadline / SLOT_H);
  const slots = Array.from({ length: lastSlot + 2 }, () => new Map());
  const base = newGame(scenario, level, tables);
  base.route = [];
  const root = { x: base.x, y: base.y, t: 0, battery: base.battery, sent: 0, sentFrom: [], parent: null, action: null };
  slots[0].set((base.y * n + base.x) * (need + 1), root);
  let best = null;
  const better = (a, b) => !b || a.battery > b.battery + EPS || (Math.abs(a.battery - b.battery) <= EPS && a.t < b.t - EPS);

  const offer = (parent, action, s) => {
    if (s.over === 'battery' || s.over === 'time') return;
    const node = { x: s.x, y: s.y, t: s.t, battery: s.battery, sent: s.sent, sentFrom: s.sentFrom, parent, action };
    if (s.over === 'win') {
      if (better(node, best)) best = node;
      return;
    }
    const slot = Math.floor(s.t / SLOT_H + EPS);
    if (slot >= slots.length) return;
    const key = (s.y * n + s.x) * (need + 1) + s.sent;
    const held = slots[slot].get(key);
    if (!held || s.battery > held.battery + EPS) slots[slot].set(key, node);
  };

  for (let k = 0; k < slots.length; k++) {
    for (const node of slots[k].values()) {
      const state = { ...base, x: node.x, y: node.y, t: node.t, battery: node.battery, sent: node.sent, sentFrom: node.sentFrom };
      offer(node, 'wait', wait(state, SLOT_H));
      if (node.sent < need) {
        const sent = transmit(state);
        if (sent !== state) offer(node, 'transmit', sent);
      }
      const from = node.y * n + node.x;
      for (const [dx, dy] of NEIGHBOURS) {
        const x = node.x + dx, y = node.y + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        if (stepCost(tables, level, from, y * n + x) === null) continue;
        offer(node, 'move', move(state, [{ x, y }]));
      }
    }
    slots[k] = null; // done: free the memory
  }

  const trivial = isTrivial({ scenario, level, tables });
  if (!best) return { winnable: false, trivial, batteryMargin: null, timeMarginH: null, actions: [], route: [] };
  return {
    winnable: true,
    trivial,
    batteryMargin: round(best.battery - level.minBat),
    timeMarginH: round(level.deadline - best.t),
    actions: actionsOf(best),
    route: routeOf(best),
  };
}

/** Solves every level: { [id]: solveLevel(...) }, in the order of `levels`. */
export function solveLevels({ scenario, levels, tables }) {
  const out = {};
  for (const [id, level] of Object.entries(levels)) out[id] = solveLevel({ scenario, level, tables });
  return out;
}

/** Throws, in Spanish, when a level cannot be won or is trivial: the pipeline does not publish it. */
export function assertSolvable(solved, levels) {
  const problems = [];
  for (const [id, r] of Object.entries(solved)) {
    const level = levels[id];
    const day = Math.ceil(level.deadline / 24);
    const packets = level.need > 0 ? `envía los ${level.need} paquetes y ` : '';
    if (!r.winnable) problems.push(`El nivel ${id} no se puede ganar: ninguna secuencia ${packets}llega a ASCENSO con un ${level.minBat} % antes del día ${day}.`);
    if (r.trivial) problems.push(`El nivel ${id} es trivial: yendo directo de la salida a ASCENSO al empezar${level.need > 0 ? ' y transmitiendo allí' : ''}, sin esperar, se gana.`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

/** solver.json, deterministic: same bytes on every run. */
export const solverJson = (solved) => JSON.stringify(solved, null, 1) + '\n';

/** Table of margins for the console. */
export function marginsTable(solved) {
  const rows = [['Nivel', 'Ganable', 'Trivial', 'Margen de batería', 'Margen de tiempo']];
  for (const [id, r] of Object.entries(solved)) {
    rows.push([id, r.winnable ? 'sí' : 'no', r.trivial ? 'sí' : 'no',
      r.winnable ? `${r.batteryMargin.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %` : '—',
      r.winnable ? `${r.timeMarginH.toLocaleString('es-ES', { maximumFractionDigits: 1 })} h` : '—']);
  }
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((v, c) => v.padEnd(w[c])).join('  ')).join('\n');
}

/** Tables of a scenario already written in rolegame/data/<id>/. */
export function loadScenario(dir) {
  const read = (f) => { const b = readFileSync(new URL(f, dir)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  const scenario = JSON.parse(readFileSync(new URL('scenario.json', dir), 'utf8'));
  const tables = createTables(read('sun.bin'), scenario, read('cells.bin'), read('earth.bin'));
  return { scenario, tables };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--scenario');
  const id = i > 0 ? process.argv[i + 1] : 'procedural-shackleton';
  const dataDir = new URL('../rolegame/data/', import.meta.url);
  const dir = new URL(`${id}/`, dataDir);
  const levels = JSON.parse(readFileSync(new URL('levels.json', dataDir), 'utf8'));
  const { scenario, tables } = loadScenario(dir);
  const t0 = performance.now();
  const solved = solveLevels({ scenario, levels, tables });
  const secs = (performance.now() - t0) / 1000;
  console.log(marginsTable(solved));
  console.log(`Resuelto en ${secs.toFixed(1)} s`);
  assertSolvable(solved, levels);
  writeFileSync(new URL('solver.json', dir), solverJson(solved));
  console.log(`solver.json escrito en rolegame/data/${id}/`);
}
