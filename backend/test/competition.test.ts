// Evals competition: agent parsing and deterministic rule auditing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgents, auditRuns } from '../evals/competition.ts';
import { openDb, saveRun } from '../evals/db.ts';
import { resolveScenario } from '../evals/lib.ts';
import { runScenario } from '../evals/run.ts';
import type { RawScenario } from '../src/types.ts';

test('parseAgents: herramienta:modelo:estrategia, con validación', () => {
  const a = parseAgents('claude:haiku:grid, opencode:provider/model-x:data');
  assert.equal(a.length, 2);
  assert.deepEqual(a[1], { n: 2, tool: 'opencode', model: 'provider/model-x', strategy: 'data' });
  // Models of Chinese origin: rejected (NASA Space Apps terms).
  for (const m of ['provider/deepseek-v4-flash', 'provider/qwen3.6', 'provider/glm5.3-flash', 'x/Kimi-K2', 'x/MiniMax-M2']) {
    assert.throws(() => parseAgents(`opencode:${m}:data`), /no permitido/, m);
  }
  assert.doesNotThrow(() => parseAgents('claude:sonnet:data,claude:haiku:grid'));
  assert.throws(() => parseAgents('gpt:x:grid'), /Herramienta desconocida/);
  assert.throws(() => parseAgents('claude:haiku:made-up'), /Estrategia desconocida/);
  assert.throws(() => parseAgents('claude:haiku'), /mal formado/);
});

test('auditRuns: detecta parámetros cambiados, exceso de candidatos y de ejecuciones', () => {
  const bench: RawScenario = {
    name: 'b', region: { latMin: -90, latMax: -86, lonMin: -180, lonMax: 180 }, dates: ['2027-01-10'], missionDays: 2,
    stepMinutes: 180, constraints: {}, search: { spacingKm: 80, maxIterations: 1 },
  };
  const db = openDb(':memory:');
  const save = (raw: RawScenario, label: string): number => { const { summary, iterations } = runScenario(raw, { label }); return saveRun(db, summary, iterations); };
  save(bench, 'x-a1-ok1');
  save(bench, 'x-a1-ok2');
  save({ ...bench, weights: { energy: 1 } }, 'x-a1-cheat');
  save({ ...bench, robustness: { radiusKm: 1 } }, 'x-a1-robust');
  const r = auditRuns(db, 'x-a1-', resolveScenario(bench), { maxRuns: 1, maxCandidates: 1e9 });
  const reasons = Object.fromEntries(r.invalid.map((x) => [x.label, x.reason]));
  assert.match(reasons['x-a1-cheat'], /weights_json/);
  assert.match(reasons['x-a1-robust'], /robustness/);
  assert.match(reasons['x-a1-ok2'], /> 1/); // too many runs
  assert.deepEqual(r.validIds.length, 1);
  const r2 = auditRuns(db, 'x-a1-', resolveScenario(bench), { maxRuns: 10, maxCandidates: 1 });
  assert.ok(r2.invalid.some((x) => /candidatos/.test(x.reason)));
  db.close();
});
