// Rules engine (J0.3): newGame, pass, wait, move, transmit, check. Pure functions: every action
// returns a new state and never mutates its input. No DOM, no network; the only randomness is the
// seeded event of J6.4, drawn in newGame, so the same seed and actions always give the same game.

import { stepCost } from './paths.js';
import { rng } from './random.js';

const STEP_H = 0.5;
const EPS = 1e-6;

const cellIndex = (n, x, y) => y * n + x;
const clone = (s) => ({ ...s, route: s.route.slice(), log: s.log.slice(), sentFrom: (s.sentFrom ?? []).slice(), event: s.event && { ...s.event } });

// The event of the game (J6.4): forced with `event` ({ at, type }, null for none) or drawn from the seed
// when the level has events: at in [eventFrom, eventFrom + eventSpan), 'antenna' or 'spike' (prototype newGame).
function drawEvent(level, seed, forced) {
  if (forced !== undefined) return forced && { at: forced.at, type: forced.type, done: false };
  if (!level.event) return null;
  const r = rng(seed);
  const at = level.eventFrom + r() * level.eventSpan;
  const type = r() < 0.5 ? 'antenna' : 'spike';
  return { at, type, done: false };
}

export function newGame(scenario, level, tables, { seed = 1, event } = {}) {
  return {
    seed,
    event: drawEvent(level, seed, event),
    // Until this hour transmitting takes twice as long (antenna fault).
    antennaUntil: 0,
    log: [],
    level,
    x: scenario.start.x,
    y: scenario.start.y,
    t: 0,
    battery: level.bat0,
    // Lowest battery of the game (J7.3), only informative: no rule reads it.
    minBattery: level.bat0,
    sent: 0,
    // Cells each package was sent from (J3.6): the next one has to be level.txMinKm away from all of them.
    sentFrom: [],
    route: [{ x: scenario.start.x, y: scenario.start.y }],
    over: null,
    scenario: { n: tables.n, pad: scenario.pad },
    tables,
  };
}

function passInPlace(s, hours, extraLoad) {
  const { level, tables } = s;
  let left = hours;
  while (left > EPS && !s.over) {
    const step = Math.min(STEP_H, left);
    const f = tables.sunFrac(cellIndex(tables.n, s.x, s.y), s.t + step / 2);
    const charge = f >= level.panelMin ? level.charge * f : 0;
    const load = f > 0.5 ? level.loadSun : level.loadDark;
    s.battery = Math.min(100, s.battery + (charge - load - extraLoad) * step);
    s.t += step;
    left -= step;
    applyEvent(s);
    checkInPlace(s);
    s.minBattery = Math.min(s.minBattery ?? s.battery, s.battery);
  }
}

// In the first step that reaches event.at (prototype pass): a spike takes spikeE points of battery at once
// (it can leave it at 0); an antenna fault doubles the transmission time for antennaH hours.
function applyEvent(s) {
  const ev = s.event;
  if (!ev || ev.done || s.t < ev.at) return;
  ev.done = true;
  if (ev.type === 'spike') s.battery -= s.level.spikeE;
  else s.antennaUntil = s.t + s.level.antennaH;
  s.log.push({ t: s.t, kind: ev.type });
}

// True while the antenna fault lasts at the state's hour.
export const antennaDown = (state) => state.t < state.antennaUntil;

function checkInPlace(s) {
  if (s.over) return;
  const { level, scenario } = s;
  if (s.battery <= 0) {
    s.battery = 0;
    s.over = 'battery';
  } else if (s.x === scenario.pad.x && s.y === scenario.pad.y && s.sent >= level.need && s.battery >= level.minBat) {
    s.over = 'win';
  } else if (s.t >= level.deadline) {
    s.over = 'time';
  }
}

export function pass(state, hours, extraLoad = 0) {
  const s = clone(state);
  passInPlace(s, hours, extraLoad);
  return s;
}

// Waits in place (J2.1): half-hour steps with the same charge and load as pass (no extra load),
// checking the end after each one. With untilSun it stops at the end of the first step whose cell
// has Sun (sunFrac > 0.5), with untilEarth (J3.3) at the end of the first step whose cell sees the
// Earth; never after `hours`. A finished game comes back unchanged.
export function wait(state, hours, { untilSun = false, untilEarth = false } = {}) {
  if (state.over) return state;
  const s = clone(state);
  const cell = cellIndex(s.tables.n, s.x, s.y);
  let left = hours;
  while (left > EPS && !s.over) {
    const step = Math.min(STEP_H, left);
    passInPlace(s, step, 0);
    left -= step;
    if (untilSun && s.tables.sunFrac(cell, s.t) > 0.5) break;
    if (untilEarth && s.tables.seesEarth(cell, s.t)) break;
  }
  return s;
}

// Sends one package to the Earth (J3.1): level.txT hours in place with an extra load of txE / txT per
// hour (txE points on top of the usual load). Only when the game is on, the rover's cell sees the
// Earth now and packages are still missing; otherwise the same state comes back. Visibility is only
// checked at the start, as in the prototype. If the game ends while transmitting, nothing is sent.
// During an antenna fault (J6.4) it takes twice as long with the same extra load in total.
// Each package has to go from a different zone, level.txMinKm away from the previous ones (J3.6).
export function transmit(state) {
  const { level, tables } = state;
  if (state.over || state.sent >= level.need) return state;
  if (!tables.seesEarth(cellIndex(tables.n, state.x, state.y), state.t)) return state;
  if (nearSent(state)) return state;
  const s = clone(state);
  const hours = transmitHours(state);
  passInPlace(s, hours, level.txE / hours);
  if (!s.over) {
    s.sent += 1;
    s.sentFrom.push({ x: state.x, y: state.y });
    s.log.push({ t: s.t, kind: 'sent', n: s.sent });
    checkInPlace(s);
  }
  return s;
}

// Each package is the survey of a zone (J3.6): it has to go from a cell at least level.txMinKm (straight line
// between cell centres, cellM of the tables) from every cell a package already went from. Without txMinKm, no limit.
export function sentTooClose(state, cell) {
  const minKm = state.level.txMinKm ?? 0;
  if (minKm <= 0) return false;
  const cellKm = state.tables.cellM / 1000;
  return (state.sentFrom ?? []).some((p) => Math.hypot(p.x - cell.x, p.y - cell.y) * cellKm < minKm - EPS);
}

// True when the rover's cell is too close to where a package was already sent.
export const nearSent = (state) => sentTooClose(state, { x: state.x, y: state.y });

export function check(state) {
  const s = clone(state);
  checkInPlace(s);
  return s;
}

// Follows a path (list of neighbouring cells, as pathTo returns it; the first cell may be the
// current one). Each step takes stepCost hours: half before entering the cell, half after.
export function move(state, path) {
  const s = clone(state);
  const n = s.scenario.n;
  let from = s.y * n + s.x;
  for (const p of path) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
      throw new RangeError('path cells must have integer coordinates');
    }
    if (p.x < 0 || p.y < 0 || p.x >= n || p.y >= n) {
      throw new RangeError('path outside the grid');
    }
  }
  for (const p of path) {
    if (s.over) break;
    if (p.x === s.x && p.y === s.y) continue;
    if (Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) !== 1) {
      throw new RangeError('path steps must go to a neighbouring cell');
    }
    const to = p.y * n + p.x;
    const cost = stepCost(s.tables, s.level, from, to);
    if (cost === null) throw new RangeError('path has a step steeper than the level allows');
    passInPlace(s, cost / 2, s.level.moveE);
    if (s.over) break;
    s.x = p.x;
    s.y = p.y;
    s.route.push({ x: s.x, y: s.y });
    passInPlace(s, cost / 2, s.level.moveE);
    checkInPlace(s);
    from = to;
  }
  return s;
}

// Hours a transmission takes from this state: txT, doubled during an antenna fault.
export const transmitHours = (state) => state.level.txT * (antennaDown(state) ? 2 : 1);
