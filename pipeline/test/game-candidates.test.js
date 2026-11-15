import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTables } from '../../rolegame/src/engine/index.js';
import {
  candidateRules, candidateStarts, earthRiseHour, earthRiseOk, exitCells, padCells, searchCandidates, rankCandidates,
  rejection, relaxAdvice, spread, CANDIDATE_DEFAULTS,
} from '../game-candidates.mjs';

const levels = JSON.parse(readFileSync(new URL('../../rolegame/data/levels.json', import.meta.url), 'utf8'));
const configs = JSON.parse(readFileSync(new URL('../game-scenarios.json', import.meta.url), 'utf8'));

// Synthetic world: 6 × 6 cells of 1 km, 48 h, flat. Dark until hour 24 and lit after it; the Earth shows up from
// hour 20 at cell 35 (unless `earthFrom` says otherwise).
const N = 6, HOURS = 48, CELL_M = 1000;
function world({ litAt0 = [], earthFrom = 20 } = {}) {
  const sun = new Uint8Array(HOURS * N * N);
  const bits = new Uint8Array(Math.ceil((HOURS * N * N) / 8));
  for (let h = 0; h < HOURS; h++) for (let c = 0; c < N * N; c++) {
    const o = h * N * N + c;
    sun[o] = h >= 24 || (h === 0 && litAt0.includes(c)) ? 255 : 0;
    if (h >= earthFrom && c === 35) bits[o >> 3] |= 1 << (o & 7);
  }
  return createTables(sun.buffer, { grid: { n: N, cellM: CELL_M }, hours: HOURS }, undefined, bits.buffer);
}

// Fake solver: margins chosen per pad, so the ranking can be tested without playing the levels.
const ok = (b, t = 20) => ({ winnable: true, trivial: false, batteryMargin: b, timeMarginH: t });
const all = (r) => ({ beg: r, mid: r, exp: r });
const BY_PAD = {
  5: all(ok(3)), // (5, 0): worst margin 3
  30: all(ok(10)), // (0, 5): worst margin 10
  27: { ...all(ok(40)), mid: { ...ok(40), trivial: true } }, // (3, 4): a trivial level
  22: { ...all(ok(40)), exp: { winnable: false, trivial: false, batteryMargin: null, timeMarginH: null } }, // (4, 3): exp not won
};
const fakeSolve = ({ scenario }) => BY_PAD[scenario.pad.y * N + scenario.pad.x] ?? all(ok(20));
const rules = { ...CANDIDATE_DEFAULTS, edge: 0, padKm: [5, 5.05], earthRise: [0.25, 0.75], batteryMargin: { beg: [0, 90], mid: [0, 90], exp: [0, 90] }, timeMargin: { beg: [0, 90], mid: [0, 90], exp: [0, 90] }, dates: 3, starts: 1, pads: 4 };
const run = (r = rules, dates = [{ startUtc: '2027-01-01T00:00:00.000Z', tables: world() }]) =>
  searchCandidates({ dates, levels, rules: r, cellM: CELL_M, solve: fakeSolve });

test('de dos plataformas, la de más margen en el peor nivel va antes; trivial y no ganable no salen', () => {
  const { ranked, tried } = run();
  assert.equal(tried, 4);
  assert.deepEqual(ranked.map((c) => c.pad), [30, 5]);
  assert.equal(ranked[0].minBattery, 10);
  assert.equal(ranked[1].minBattery, 3);
});

test('una salida al Sol en la hora 0 no es candidata', () => {
  const t = world({ litAt0: [0, 7] });
  const exits = exitCells(t);
  assert.ok(!exits.includes(0) && !exits.includes(7));
  assert.ok(exits.includes(1));
  const { ranked } = run(rules, [{ startUtc: '2027-01-01T00:00:00.000Z', tables: t }]);
  for (const c of ranked) assert.notEqual(c.exit, 0);
});

test('los rangos salen de game-scenarios.json y cambiarlos cambia los candidatos', () => {
  for (const cfg of configs) assert.ok(cfg.candidates, `${cfg.id} sin candidates`);
  const fromFile = candidateRules(configs[0]);
  assert.deepEqual(fromFile.padKm, configs[0].candidates.padKm);
  assert.deepEqual(fromFile.earthRise, configs[0].candidates.earthRise);
  const t = world();
  assert.equal(padCells(t, 0, CELL_M, [5, 5.05]).length, 4);
  assert.equal(padCells(t, 0, CELL_M, [1, 1.1]).length, 2);
  // The Earth rises at hour 20 of 48 (42 %): inside [25 %, 75 %], outside [50 %, 75 %].
  assert.equal(run().dates, 1);
  assert.equal(run({ ...rules, earthRise: [0.5, 0.75] }).dates, 0);
  // Margins out of the scenario's range for a level drop the candidate.
  assert.deepEqual(run({ ...rules, batteryMargin: { beg: [5, 90], mid: [0, 90], exp: [0, 90] } }).ranked.map((c) => c.pad), [30]);
  // Too much time to spare is «too easy»: the time margin has a maximum per level.
  assert.deepEqual(run({ ...rules, timeMargin: { beg: [0, 15], mid: [0, 90], exp: [0, 90] } }).ranked.length, 0);
  // Cells near the border are left out.
  assert.deepEqual(padCells(t, 0, CELL_M, [5, 5.05], 1), [22, 27]);
});

test('dos ejecuciones dan la misma lista en el mismo orden', () => {
  const a = run();
  const b = run();
  assert.deepEqual(a.ranked.map((c) => [c.startUtc, c.exit, c.pad]), b.ranked.map((c) => [c.startUtc, c.exit, c.pad]));
  const list = [
    { startUtc: '2027-02-01T00:00:00.000Z', exit: 2, pad: 9, solved: all(ok(10, 5)) },
    { startUtc: '2027-01-01T00:00:00.000Z', exit: 2, pad: 9, solved: all(ok(10, 5)) },
    { startUtc: '2027-01-01T00:00:00.000Z', exit: 1, pad: 9, solved: all(ok(10, 8)) },
  ];
  assert.deepEqual(rankCandidates(list, rules).map((c) => [c.startUtc.slice(5, 7), c.exit]), [['01', 1], ['01', 2], ['02', 2]]);
});

test('fechas: la regla del Sol de toda la misión y la Tierra asomando, cada dateStepH horas', () => {
  const sunEl = Array.from({ length: 120 }, (_, h) => (h < 10 || h >= 100 ? 0 : 1));
  const earthEl = Array.from({ length: 120 }, (_, h) => (h === 70 ? 1 : -1));
  assert.deepEqual(candidateStarts(sunEl, earthEl, 48, { sunMinEl: 0.5, dateStepH: 12 }), [24, 36, 48]); // from 12 the Earth (hour 70) falls outside the mission
  assert.deepEqual(candidateStarts(sunEl, earthEl, 48, { sunMinEl: 0.5, dateStepH: 24 }), [24, 48]);
  assert.equal(earthRiseHour(world()), 20);
  assert.equal(earthRiseHour(world({ earthFrom: 99 })), null);
  assert.equal(earthRiseOk(null, 48, [0, 1]), false);
});

test('sin candidatos, el script dice qué filtro relajar en vez de relajarlo', () => {
  const none = run({ ...rules, batteryMargin: { beg: [50, 90], mid: [50, 90], exp: [50, 90] } });
  assert.equal(none.ranked.length, 0);
  assert.match(relaxAdvice(none), /candidates\.batteryMargin/);
  assert.match(relaxAdvice({ reasons: { earthRise: 3 }, dates: 0, tried: 0 }), /candidates\.earthRise/);
  assert.equal(rejection(all(ok(10)), rules), null);
  assert.deepEqual(spread([1, 2, 3, 4, 5], 2), [1, 5]);
});

// ---- Figures of the scenario for the texts (J9.4) ----

test('scenarioFacts: ventana de la Tierra, giro del Sol en 48 h y altura máxima, de una serie sintética de 336 h', async () => {
  const { scenarioFacts } = await import('../game-scenario.mjs');
  const n = 2, hours = 336, azb = 72;
  const earth = new Uint8Array(Math.ceil((hours * n * n) / 8));
  for (let h = 30; h <= 300; h++) { const o = h * n * n + 1; earth[o >> 3] |= 1 << (o & 7); }
  const series = {
    sunAz: Array.from({ length: hours }, (_, h) => (350 + h * 0.5) % 360), // crosses north: 0.5° per hour
    sunEl: Array.from({ length: hours }, (_, h) => (h === 100 ? 1.23 : 0.8)),
    earthEl: Array.from({ length: hours }, (_, h) => -2 + (h / (hours - 1)) * 6.4),
  };
  const M = new Float32Array(n * n * azb);
  M[0 * azb + 0] = 12.34; // north of the exit
  M[0 * azb + 18] = 40; // east: does not count
  M[0 * azb + 63] = 14.06; // 315°: counts
  const f = scenarioFacts({ series, earth, n, hours, start: { x: 0, y: 0 }, pad: { x: 1, y: 1 }, cellM: 300, M, azb });
  assert.equal(f.earthFirstDay, 2);
  assert.equal(f.earthLastDay, 13);
  assert.equal(f.sunAzPer48hDeg, 24);
  assert.equal(f.sunMaxElDeg, 1.2);
  assert.deepEqual(f.earthElRangeDeg, [-2, 4.4]);
  assert.equal(f.startMaskNorthDeg, 14.1);
  assert.equal(f.padKm, Math.hypot(1, 1) * 0.3);
  const never = scenarioFacts({ series, earth: new Uint8Array(earth.length), n, hours, start: { x: 0, y: 0 }, pad: { x: 1, y: 1 }, cellM: 300, M, azb });
  assert.equal(never.earthFirstDay, null);
});
