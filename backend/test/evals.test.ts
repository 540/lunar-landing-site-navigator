// Evals harness: determinism, constraints, aggregation and convergence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMetrics, checkConstraints, resolveScenario } from '../evals/lib.ts';
import { runScenario } from '../evals/run.ts';
import { row } from '../evals/db.ts';
import type { Constraints, CountRow, LatLon, Metrics, RawScenario } from '../src/types.ts';

const SMALL = {
  name: 'test-polo',
  region: { latMin: -90, latMax: -86, lonMin: -180, lonMax: 180 },
  dates: ['2027-01-10', '2027-01-24'],
  missionDays: 5,
  stepMinutes: 120,
  constraints: { minEnergy: 0.5 },
  search: { spacingKm: 40, maxIterations: 3 },
  baselines: ['shackleton-rim', 'does-not-exist'],
} satisfies RawScenario;

test('resolveScenario: valores por defecto, pesos normalizados y validación', () => {
  const s = resolveScenario(SMALL);
  assert.equal(s.aggregate, 'worst');
  assert.equal(Math.round(Object.values(s.weights).reduce((a, b) => a + b, 0) * 1e9), 1e9);
  assert.throws(() => resolveScenario({ ...SMALL, constraints: { madeUp: 1 } as Constraints }), /Restricción desconocida/); // invalid on purpose
  assert.throws(() => resolveScenario({ ...SMALL, dates: [] }), /dates/);
});

test('aggregateMetrics: el peor caso toma mínimos de fracciones y máximos de noches', () => {
  const a = { energy: 0.9, sunFraction: 1, earthFraction: 0.2, bothFraction: 0.2, longestNightH: 0, longestNoEarthH: 100, longestBothH: 30 };
  const b = { energy: 0.5, sunFraction: 0.6, earthFraction: 0.8, bothFraction: 0.5, longestNightH: 50, longestNoEarthH: 10, longestBothH: 60 };
  const w = aggregateMetrics([a, b], 'worst');
  assert.equal(w.energy, 0.5);
  assert.equal(w.earthFraction, 0.2);
  assert.equal(w.longestNightH, 50);
  assert.equal(w.longestNoEarthH, 100);
  assert.equal(aggregateMetrics([a, b], 'mean').energy, 0.7);
});

test('checkConstraints: devuelve los incumplimientos', () => {
  // Only the metrics the constraints read.
  assert.deepEqual(checkConstraints({ energy: 0.9, longestNightH: 10 } as Metrics, { minEnergy: 0.8, maxLongestNightH: 24 }), []);
  assert.equal(checkConstraints({ energy: 0.5, longestNightH: 30 } as Metrics, { minEnergy: 0.8, maxLongestNightH: 24 }).length, 2);
});

test('runScenario: determinista, la mejor puntuación no empeora entre iteraciones y hay baselines', () => {
  const a = runScenario(SMALL);
  const b = runScenario(SMALL);
  assert.deepEqual(a.summary.best, b.summary.best);
  const scores = a.iterations.map((r) => r.best.score);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] >= scores[i - 1] || a.iterations[i].best.feasible > a.iterations[i - 1].best.feasible);
  assert.equal(a.summary.baselines.length, 2);
  const unknown = a.summary.baselines.find((x) => x.id === 'does-not-exist');
  assert.ok(unknown && 'error' in unknown && unknown.error);
  assert.ok(a.summary.best.perDate.length === 2);
});

test('base de datos: guarda la ejecución completa y las vistas de métricas responden', async () => {
  const { openDb, saveRun, METRIC_VIEWS } = await import('../evals/db.ts');
  const db = openDb(':memory:');
  const { summary, iterations } = runScenario(SMALL);
  const id = saveRun(db, summary, iterations);
  const nCand = row<CountRow>(db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE run_id = ?'), id)!.n;
  assert.equal(nCand, summary.totalEvaluated);
  assert.equal(row<CountRow>(db.prepare('SELECT COUNT(*) AS n FROM candidate_dates'))!.n, nCand * SMALL.dates.length);
  assert.equal(row<CountRow>(db.prepare('SELECT COUNT(*) AS n FROM iterations WHERE run_id = ?'), id)!.n, iterations.length);
  for (const view of Object.keys(METRIC_VIEWS)) db.prepare(`SELECT * FROM ${view}`).all();
  const rob = row<{ dates: number }>(db.prepare('SELECT dates FROM v_best_robustness WHERE id = ?'), id)!;
  assert.equal(rob.dates, SMALL.dates.length);
  // Second identical run → delta 0 and 0 km.
  saveRun(db, { ...summary, runId: summary.runId + '-b' }, iterations);
  const last = row<{ delta_score: number; moved_km: number }>(db.prepare('SELECT delta_score, moved_km FROM v_run_deltas ORDER BY id DESC LIMIT 1'))!;
  assert.equal(last.delta_score, 0);
  assert.equal(last.moved_km, 0);
  db.close();
});

test('modo points: evalúa exactamente los puntos dados (ids del catálogo o lat/lon) y los ordena', () => {
  const { summary, iterations } = runScenario({
    name: 'test-points', dates: ['2027-01-10'], missionDays: 3, stepMinutes: 120,
    points: ['shackleton-rim', { lat: 0.674, lon: 23.473, name: 'Apollo 11 a mano' }],
  });
  assert.equal(iterations.length, 1);
  assert.equal(summary.totalEvaluated, 2);
  assert.equal(summary.top.length, 2);
  assert.ok(summary.top[0].score >= summary.top[1].score);
  assert.throws(() => runScenario({ name: 'x', dates: ['2027-01-10'], points: ['does-not-exist'] }), /Sitio desconocido/);
});

test('rescore: con los pesos originales reproduce las puntuaciones guardadas', async () => {
  const { openDb, saveRun } = await import('../evals/db.ts');
  const { rescore } = await import('../evals/rescore.ts');
  const { normalizeWeights } = await import('../src/search.ts');
  const db = openDb(':memory:');
  const { summary, iterations, resolved } = runScenario(SMALL);
  saveRun(db, summary, iterations);
  const r = rescore(db, { scenario: SMALL.name, weights: normalizeWeights(resolved.weights) });
  for (const c of r.ranked) assert.ok(Math.abs(c.score - c.oldScore) < 0.001, `${c.score} vs ${c.oldScore}`);
  assert.equal(r.ranked[0].rank, 1);
  db.close();
});

test('peor fecha REAL: las métricas del agregado son las de una fecha concreta, no una mezcla', () => {
  const { summary, iterations } = runScenario({ ...SMALL, constraints: {} });
  for (const c of iterations.flatMap((r) => r.candidates!)) {
    const d = c.perDate.find((x) => x.date === c.worstDate);
    assert.ok(d, 'worstDate debe ser una de las fechas');
    for (const k of ['energy', 'earthFraction', 'bothFraction', 'longestNightH'] as const) assert.equal(c.metrics[k], Math.round(d[k] * 1e4) / 1e4);
    assert.equal(c.score, Math.min(...c.perDate.map((x) => x.score)));
  }
  assert.ok(summary.best.worstDate);
});

test('robustez espacial: la puntuación robusta nunca supera la nominal y exige que cumplan los vecinos', async () => {
  const { neighborsAround } = await import('../evals/lib.ts');
  const pts = neighborsAround({ lat: -80, lon: 10 }, 2, 8, 2);
  assert.equal(pts.length, 16);
  const R = 1737.4, D = Math.PI / 180;
  const dist = (a: LatLon, b: LatLon): number => R * Math.acos(Math.min(1, Math.sin(a.lat * D) * Math.sin(b.lat * D) + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.cos((b.lon - a.lon) * D)));
  for (const p of pts.slice(8)) assert.ok(Math.abs(dist({ lat: -80, lon: 10 }, p) - 2) < 0.05, 'anillo exterior a 2 km');
  // Near the pole the ring stays within [-90, 90].
  for (const p of neighborsAround({ lat: -89.99, lon: 0 }, 2, 8, 1)) assert.ok(p.lat >= -90 && p.lat <= 90);

  const base = { ...SMALL, constraints: { minEnergy: 0.3 }, search: { spacingKm: 60, maxIterations: 2 } };
  const nominal = runScenario(base).iterations.flatMap((r) => r.candidates!);
  const robust = runScenario({ ...base, robustness: { radiusKm: 5 } }).iterations.flatMap((r) => r.candidates!);
  const byKey = new Map(nominal.map((c) => [`${c.lat},${c.lon}`, c]));
  let compared = 0;
  for (const c of robust) {
    const n = byKey.get(`${c.lat},${c.lon}`);
    if (!n) continue;
    compared++;
    assert.equal(c.nominalScore, n.score);
    assert.ok(c.score <= n.score + 1e-9);
    if (c.feasible) assert.ok(n.feasible);
    assert.equal(c.robustness!.points, 9);
  }
  assert.ok(compared > 0);
});
