#!/usr/bin/env node
// "Golden" results: stored reference for fixed scenarios. `npm test` fails if the result changes.
//
//   node evals/golden.ts update   # regenerates the reference (ONLY when the result change is intentional)
//   node evals/golden.ts check    # compares without writing (same as the test)
//
// If the golden test fails: either you changed the computation on purpose (review the diff and run `update`),
// or something stopped being deterministic (another Node version, dependencies, …).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readScenario, runScenario } from './run.ts';
import type { Candidate, TopCandidate } from '../src/types.ts';

/** What a golden file pins (test/fixtures/golden/<name>.json). */
export interface Golden {
  scenario: string;
  resultHash: string;
  scenarioHash: string;
  generatedWith: { node: string; astronomyEngine: string };
  best: Candidate;
  top: TopCandidate[];
  totalEvaluated: number;
  iterations: number;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'test', 'fixtures', 'golden');
export const GOLDEN_SCENARIOS = ['polo-sur-10-puntos', 'polo-sur-verano-2027'];

/** Part of the result that is pinned (no timings or run ids). */
export function goldenOf(name: string): Golden {
  const raw = readScenario(path.join(HERE, 'scenarios', `${name}.json`));
  const { summary } = runScenario(raw);
  return {
    scenario: name,
    resultHash: summary.fingerprint.resultHash,
    scenarioHash: summary.fingerprint.scenarioHash,
    generatedWith: { node: summary.fingerprint.nodeVersion, astronomyEngine: summary.fingerprint.engineVersion },
    best: summary.best,
    top: summary.top,
    totalEvaluated: summary.totalEvaluated,
    iterations: summary.iterations,
  };
}

export const goldenFile = (name: string): string => path.join(OUT, `${name}.json`);

/** Stored reference of a golden scenario. */
export const readGolden = (name: string): Golden => JSON.parse(fs.readFileSync(goldenFile(name), 'utf8')) as Golden;

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] ?? 'check';
  let failed = 0;
  for (const name of GOLDEN_SCENARIOS) {
    const g = goldenOf(name);
    if (mode === 'update') {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(goldenFile(name), JSON.stringify(g, null, 2) + '\n');
      console.log(`✔ ${name}: referencia guardada (resultado ${g.resultHash})`);
    } else {
      const ref = readGolden(name);
      const ok = ref.resultHash === g.resultHash;
      if (!ok) failed++;
      console.log(`${ok ? '✔' : '✖'} ${name}: referencia ${ref.resultHash} · ahora ${g.resultHash}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
