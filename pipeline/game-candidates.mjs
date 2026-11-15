// Candidates of a game (J9.3): start date, exit and pad of a scenario, chosen with the solver of J9.1.
// The rule for the dates, the distance to the pad, the window in which the Earth must rise and the battery margins
// per level are data of the scenario (pipeline/game-scenarios.json, `candidates`), not constants of this code.
// Product picks one of the three best and writes its startUtc, start and pad in game-scenarios.json; then
// game-scenario.mjs regenerates the scenario. This script never writes into the repo.
// Usage: node pipeline/game-candidates.mjs --scenario <id> [--json <file>]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, pathTo } from '../rolegame/src/engine/index.js';
import { solveLevels, isTrivial } from './game-solver.mjs';

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Defaults of `candidates` when a scenario leaves a field out (every one is REVISAR with product).
 * The solver's best play waits to charge, so its battery margin is nearly always the most possible (100 − minBat):
 * it only tells «by the skin of its teeth» (the minimum). Whether a level is too easy shows in its time margin,
 * so `timeMargin` has both a minimum and a maximum.
 */
export const CANDIDATE_DEFAULTS = {
  dateStepH: 24,
  padKm: [4, 7],
  earthRise: [0.25, 0.75],
  edge: 2,
  batteryMargin: { beg: [10, 100], mid: [5, 100], exp: [5, 100] },
  timeMargin: { beg: [24, 170], mid: [12, 96], exp: [6, 72] },
  dates: 3,
  starts: 2,
  pads: 2,
};

/** `candidates` of a scenario config with the defaults filled in. */
export function candidateRules(cfg) {
  const c = cfg.candidates ?? {};
  return {
    ...CANDIDATE_DEFAULTS, ...c,
    batteryMargin: { ...CANDIDATE_DEFAULTS.batteryMargin, ...c.batteryMargin },
    timeMargin: { ...CANDIDATE_DEFAULTS.timeMargin, ...c.timeMargin },
  };
}

/**
 * Start hours (indices into an hourly series) where the Sun stays above `sunMinEl`, without relief, for the whole
 * mission and the Earth is above the horizon at some hour (the rule of pickStart), sampled every `dateStepH`.
 */
export function candidateStarts(sunEl, earthEl, hours, { sunMinEl, dateStepH }) {
  const total = sunEl.length;
  const ok = new Array(total).fill(false);
  let run = 0;
  for (let i = total - 1; i >= 0; i--) { run = sunEl[i] > sunMinEl ? run + 1 : 0; ok[i] = run >= hours; }
  const out = [];
  for (let i = 0; i + hours <= total; i += dateStepH) {
    if (!ok[i]) continue;
    let earth = false;
    for (let h = i; h < i + hours && !earth; h++) earth = earthEl[h] > 0;
    if (earth) out.push(i);
  }
  return out;
}

/** First hour the Earth is in sight from some cell of the map, or null. */
export function earthRiseHour(tables) {
  for (let h = 0; h < tables.hours; h++) for (let i = 0; i < tables.n * tables.n; i++) if (tables.seesEarth(i, h)) return h;
  return null;
}

/**
 * Whether the first sight of the Earth falls in the central window [from, to] of the mission (fractions of
 * `hours`; the search passes the shortest deadline of the levels, the mission the expert plays).
 */
export const earthRiseOk = (rise, hours, [from, to]) => rise !== null && rise >= from * hours && rise <= to * hours;

const lit = (tables, i, h) => tables.sunFrac(i, h) > 0.5;

/** Mean Sun fraction of a cell over the first `span` hours: the lower, the darker the exit. */
export function darkness(tables, i, span = 24) {
  let sum = 0;
  for (let h = 0; h < span; h++) sum += tables.sunFrac(i, h);
  return sum / span;
}

/** Whether a cell is at least `edge` cells away from the border of the map (the border has its horizon cut). */
export const inside = (n, i, edge) => { const x = i % n, y = Math.floor(i / n); return x >= edge && y >= edge && x < n - edge && y < n - edge; };

/** Exits: cells in shade at hour 0 («aquí casi no llega el Sol»), off the border, darkest first (ties by index). */
export function exitCells(tables, edge = 0) {
  const out = [];
  for (let i = 0; i < tables.n * tables.n; i++) if (!lit(tables, i, 0) && inside(tables.n, i, edge)) out.push(i);
  return out
    .map((i) => ({ i, d: darkness(tables, i) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((c) => c.i);
}

/** Distance in km between two cells. */
export const cellKm = (n, a, b, cellM) => (Math.hypot((a % n) - (b % n), Math.floor(a / n) - Math.floor(b / n)) * cellM) / 1000;

/** Pads for an exit: within [minKm, maxKm] of it, off the border and neither always lit nor always in shade. */
export function padCells(tables, exit, cellM, [minKm, maxKm], edge = 0) {
  const out = [];
  for (let i = 0; i < tables.n * tables.n; i++) {
    if (!inside(tables.n, i, edge)) continue;
    const km = cellKm(tables.n, exit, i, cellM);
    if (km < minKm || km > maxKm) continue;
    let sun = false, shade = false;
    for (let h = 0; h < tables.hours && !(sun && shade); h++) { if (lit(tables, i, h)) sun = true; else shade = true; }
    if (sun && shade) out.push(i);
  }
  return out;
}

const cellOf = (n, i) => ({ x: i % n, y: Math.floor(i / n) });

/**
 * Cheap filter of an (exit, pad) pair before the solver: the pad can be reached under every level's maxSlope and
 * no level is trivial.
 */
export function cheapOk(base, levels, tables) {
  for (const level of Object.values(levels)) {
    const game = { scenario: base, level, tables };
    if (!pathTo(newGame(base, level, tables), base.pad)) return false;
    if (isTrivial(game)) return false;
  }
  return true;
}

/** `count` items spread evenly over a list (first, last and in between), in list order. */
export function spread(list, count) {
  if (list.length <= count) return list.slice();
  if (count === 1) return [list[Math.floor(list.length / 2)]];
  return Array.from({ length: count }, (_, k) => list[Math.round((k * (list.length - 1)) / (count - 1))]);
}

/**
 * Why a solved combination does not pass (Spanish, for the console), or null when it passes: every level won,
 * none trivial, each battery margin within the scenario's [min, max] for that level.
 */
export function rejection(solved, rules) {
  for (const [id, r] of Object.entries(solved)) {
    if (!r.winnable) return `${id} no se gana`;
    if (r.trivial) return `${id} es trivial`;
    const [lo, hi] = rules.batteryMargin[id] ?? [-Infinity, Infinity];
    if (r.batteryMargin < lo) return `${id}: margen de batería ${round(r.batteryMargin)} < ${lo}`;
    if (r.batteryMargin > hi) return `${id}: margen de batería ${round(r.batteryMargin)} > ${hi}`;
    const [tlo, thi] = rules.timeMargin?.[id] ?? [-Infinity, Infinity];
    if (r.timeMarginH < tlo) return `${id}: margen de tiempo ${round(r.timeMarginH)} < ${tlo}`;
    if (r.timeMarginH > thi) return `${id}: margen de tiempo ${round(r.timeMarginH)} > ${thi}`;
  }
  return null;
}

/** Worst (smallest) battery and time margins of the levels. */
const worst = (solved, key) => Math.min(...Object.values(solved).map((r) => r[key]));

/**
 * Orders the candidates that pass: by the smallest battery margin of the three levels (higher first), then by the
 * smallest time margin (higher first), then by date, exit and pad (deterministic).
 */
export function rankCandidates(list, rules) {
  return list
    .filter((c) => rejection(c.solved, rules) === null)
    .map((c) => ({ ...c, minBattery: worst(c.solved, 'batteryMargin'), minTime: worst(c.solved, 'timeMarginH') }))
    .sort((a, b) => b.minBattery - a.minBattery || b.minTime - a.minTime
      || a.startUtc.localeCompare(b.startUtc) || a.exit - b.exit || a.pad - b.pad);
}

/**
 * The whole search on already built worlds: `dates` is [{ startUtc, tables }] (tables of the scenario's relief at
 * that date). Returns { ranked, tried, reasons } where `reasons` counts why the rest fell, to say which filter to
 * relax when nothing passes. `solve` defaults to the solver of J9.1 (tests pass a fake one).
 */
export function searchCandidates({ dates, levels, rules, cellM, solve = solveLevels }) {
  const reasons = { earthRise: 0, noExit: 0, noPad: 0, cheap: 0, solver: {} };
  // The mission is as long as the shortest deadline of the levels (every level has to fit the Earth's rise).
  const span = (d) => Math.min(d.tables.hours, ...Object.values(levels).map((l) => l.deadline));
  // Dates whose Earth rises closest to the middle of the mission go first.
  const usable = [];
  for (const d of dates) {
    const rise = earthRiseHour(d.tables);
    if (!earthRiseOk(rise, span(d), rules.earthRise)) { reasons.earthRise++; continue; }
    usable.push({ ...d, rise });
  }
  usable.sort((a, b) => Math.abs(a.rise / span(a) - 0.5) - Math.abs(b.rise / span(b) - 0.5) || a.startUtc.localeCompare(b.startUtc));
  const tried = [];
  for (const d of usable.slice(0, rules.dates)) {
    const { tables } = d;
    const n = tables.n;
    let exits = 0;
    for (const exit of exitCells(tables, rules.edge)) {
      if (exits >= rules.starts) break;
      const pads = padCells(tables, exit, cellM, rules.padKm, rules.edge)
        .filter((pad) => cheapOk({ grid: { n, cellM }, hours: tables.hours, start: cellOf(n, exit), pad: cellOf(n, pad) }, levels, tables));
      if (!pads.length) { reasons.noPad++; continue; }
      exits++;
      for (const pad of spread(pads, rules.pads)) {
        const scenario = { grid: { n, cellM }, hours: tables.hours, start: cellOf(n, exit), pad: cellOf(n, pad) };
        const solved = solve({ scenario, levels, tables });
        const why = rejection(solved, rules);
        if (why) { const key = why.replace(/ [\d,.]+ ([<>]) [\d,.]+$/, ' $1 límite'); reasons.solver[key] = (reasons.solver[key] ?? 0) + 1; }
        tried.push({ startUtc: d.startUtc, rise: d.rise, exit, pad, km: cellKm(n, exit, pad, cellM), solved });
      }
    }
    if (!exits) reasons.noExit++;
  }
  return { ranked: rankCandidates(tried, rules), tried: tried.length, all: tried, reasons, dates: usable.length };
}

/** Which filter to relax when nothing passes (Spanish): the one that dropped the most. Never relaxed by itself. */
export function relaxAdvice({ reasons, dates, tried }) {
  if (!dates) return `Ninguna fecha pasa la franja en que debe asomar la Tierra (${reasons.earthRise} descartadas): prueba a ampliar candidates.earthRise.`;
  if (!tried) return 'Ninguna pareja salida-plataforma pasa el filtro barato (alcanzable en todos los niveles y no trivial): prueba a ampliar candidates.padKm.';
  const worstReason = Object.entries(reasons.solver).sort((a, b) => b[1] - a[1])[0];
  if (!worstReason) return 'Ninguna combinación resuelta pasa: prueba a subir candidates.starts o candidates.pads.';
  const [why, count] = worstReason;
  const advice = /no se gana/.test(why) ? 'adelantar candidates.earthRise o acortar candidates.padKm'
    : `ajustar ${/tiempo/.test(why) ? 'candidates.timeMargin' : 'candidates.batteryMargin'} de ese nivel o ampliar candidates.padKm`;
  return `El motivo más frecuente es «${why}» (${count} de ${tried}): prueba a ${advice}.`;
}

/** Console table of the best candidates, in Spanish. */
export function candidatesTable(ranked, n, levelIds) {
  const fmt = (v) => v.toLocaleString('es-ES', { maximumFractionDigits: 1 });
  const head = ['#', 'Fecha UTC', 'Salida', 'Plataforma', 'Distancia', ...levelIds.map((id) => `${id} batería / tiempo`), 'Tierra asoma'];
  const rows = [head, ...ranked.map((c, k) => [
    String(k + 1), c.startUtc.slice(0, 16).replace('T', ' '),
    `(${c.exit % n}, ${Math.floor(c.exit / n)})`, `(${c.pad % n}, ${Math.floor(c.pad / n)})`, `${fmt(c.km)} km`,
    ...levelIds.map((id) => `${fmt(c.solved[id].batteryMargin)} % / ${fmt(c.solved[id].timeMarginH)} h`),
    `día ${Math.floor(c.rise / 24) + 1}`,
  ])];
  const w = head.map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  return rows.map((r) => r.map((v, c) => v.padEnd(w[c])).join('  ')).join('\n');
}

/** JSON of the candidates (what --json writes): exit and pad as {x, y}, margins per level. */
export const candidatesJson = (ranked, n) => JSON.stringify(ranked.map((c) => ({
  startUtc: c.startUtc,
  start: cellOf(n, c.exit),
  pad: cellOf(n, c.pad),
  km: round(c.km, 2),
  earthRiseDay: Math.floor(c.rise / 24) + 1,
  levels: Object.fromEntries(Object.entries(c.solved).map(([id, r]) => [id, { batteryMargin: r.batteryMargin, timeMarginH: r.timeMarginH }])),
})), null, 2) + '\n';

/** World of a scenario already written in rolegame/data/<id>/: heights and the 72-azimuth masks, in degrees. */
export function worldFromData(dir, { n, azb }) {
  const buf = (f) => readFileSync(new URL(f, dir));
  const c = buf('cells.bin'), m = buf('masks.bin');
  const H = new Float32Array(c.buffer.slice(c.byteOffset, c.byteOffset + c.length));
  const raw = new Int16Array(m.buffer.slice(m.byteOffset, m.byteOffset + m.length));
  const M = new Float32Array(n * n * azb);
  for (let k = 0; k < M.length; k++) M[k] = raw[k] / 100;
  return { H, M };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gs = await import('./game-scenario.mjs');
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const id = arg('--scenario') ?? gs.SCENARIO_ID;
  const cfg = gs.scenarioConfig(id);
  const rules = candidateRules(cfg);
  const dir = gs.scenarioDir(id);
  const W = worldFromData(dir, { n: gs.N, azb: gs.AZB });
  const t0 = performance.now();
  const [from, to] = cfg.startRule?.search ?? [gs.SEARCH_START, gs.SEARCH_END_EXCLUSIVE];
  const startMs = Date.parse(from);
  const total = Math.round((Date.parse(to) - startMs) / gs.HOUR_MS);
  const s = gs.hourlySeries(startMs, total, cfg.siteId);
  const starts = candidateStarts(s.sunEl, s.earthEl, gs.HOURS, { sunMinEl: cfg.startRule?.sunMinEl ?? gs.SUN_MIN_EL, dateStepH: rules.dateStepH });
  const nn = gs.N * gs.N;
  const dates = starts.map((i) => {
    const sun = new Uint8Array(gs.HOURS * nn);
    const earth = new Uint8Array(Math.ceil((gs.HOURS * nn) / 8));
    for (let h = 0; h < gs.HOURS; h++) {
      const sunH = { az: s.sunAz[i + h], el: s.sunEl[i + h] }, earthH = { az: s.earthAz[i + h], el: s.earthEl[i + h] };
      for (let c = 0; c < nn; c++) {
        const o = h * nn + c;
        sun[o] = Math.round(gs.sunFrac(W, c, sunH) * 255);
        if (gs.earthVis(W, c, earthH)) earth[o >> 3] |= 1 << (o & 7);
      }
    }
    const scenario = { grid: { n: gs.N, cellM: gs.CELL_M }, hours: gs.HOURS };
    return { startUtc: new Date(startMs + i * gs.HOUR_MS).toISOString(), tables: createTables(sun.buffer, scenario, W.H.buffer.slice(0), earth.buffer) };
  });
  console.log(`${id}: ${dates.length} fechas cumplen la regla del Sol y la Tierra (cada ${rules.dateStepH} h).`);
  const levels = gs.scenarioLevels(cfg);
  const result = searchCandidates({ dates, levels, rules, cellM: gs.CELL_M });
  const best = result.ranked.slice(0, 3);
  console.log(`${result.dates} fechas con la Tierra asomando entre el ${rules.earthRise[0] * 100} % y el ${rules.earthRise[1] * 100} % del plazo más corto (${Math.min(...Object.values(levels).map((l) => l.deadline))} h); ${result.tried} combinaciones resueltas en ${Math.round((performance.now() - t0) / 1000)} s.`);
  if (!best.length) {
    console.log(`Ningún candidato pasa los filtros. ${relaxAdvice(result)}`);
    const all = result.all.map((c) => ({ ...c, minBattery: Math.min(...Object.values(c.solved).map((r) => r.batteryMargin ?? -Infinity)), minTime: Math.min(...Object.values(c.solved).map((r) => r.timeMarginH ?? -Infinity)) }));
    console.log('Combinaciones resueltas (ninguna pasa):');
    console.log(candidatesTable(all.filter((c) => Object.values(c.solved).every((r) => r.winnable)), gs.N, Object.keys(levels)));
    process.exitCode = 1;
  } else {
    console.log(candidatesTable(best, gs.N, Object.keys(levels)));
    console.log('Para elegir uno: copia su fecha (startUtc), salida (start) y plataforma (pad) en pipeline/game-scenarios.json y regenera el escenario con game-scenario.mjs.');
  }
  const out = arg('--json');
  if (out) writeFileSync(out, candidatesJson(best, gs.N));
}
