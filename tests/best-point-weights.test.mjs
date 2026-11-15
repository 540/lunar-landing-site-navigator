// E2.5 · The weights of the client are those of the engine. The client cannot import the backend, so the check lives here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCORE_WEIGHTS } from '../viewpoint/src/core/best-point.js';
import { DEFAULT_WEIGHTS } from '../backend/src/search.ts';
import { SCORE_WEIGHTS as USE_CASE_WEIGHTS } from '../backend/src/useCases.ts';

test('E2.5 · SCORE_WEIGHTS of the client are DEFAULT_WEIGHTS of the engine (energy and comm), and nothing else weighs', () => {
  assert.equal(SCORE_WEIGHTS.energy, DEFAULT_WEIGHTS.energy);
  assert.equal(SCORE_WEIGHTS.comm, DEFAULT_WEIGHTS.comm);
  for (const [k, v] of Object.entries(DEFAULT_WEIGHTS)) if (!(k in SCORE_WEIGHTS)) assert.equal(v, 0, `${k} weighs in the engine`);
  assert.equal(SCORE_WEIGHTS.energy + SCORE_WEIGHTS.comm, 1);
  assert.equal(USE_CASE_WEIGHTS.energy, SCORE_WEIGHTS.energy);
  assert.equal(USE_CASE_WEIGHTS.comm, SCORE_WEIGHTS.comm);
});
