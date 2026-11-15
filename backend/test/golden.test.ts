// Golden test: the result of fixed scenarios must not change by accident.
// If it changes on purpose (new model, terrain...), regenerate with `npm run eval:golden:update` and review the diff in git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GOLDEN_SCENARIOS, goldenFile, goldenOf } from '../evals/golden.ts';

for (const name of GOLDEN_SCENARIOS) {
  test(`dorado: ${name} da exactamente el resultado de referencia`, () => {
    const ref = JSON.parse(fs.readFileSync(goldenFile(name), 'utf8'));
    const now = goldenOf(name);
    assert.equal(now.scenarioHash, ref.scenarioHash, 'El escenario ha cambiado: regenera la referencia si es intencionado');
    // Readable parts first (best and top), so a failure shows WHAT changed; then the hash of all candidates.
    assert.deepEqual(now.best, ref.best);
    assert.deepEqual(now.top, ref.top);
    assert.equal(now.totalEvaluated, ref.totalEvaluated);
    assert.equal(now.resultHash, ref.resultHash, 'Algún candidato ha cambiado aunque el mejor y el top coincidan');
  });
}
