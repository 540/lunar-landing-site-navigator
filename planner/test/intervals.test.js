import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clip, containing, gaps, intersect, longest, nextAfter, totalMs } from '../src/intervals.js';

test('clip recorta al rango y descarta lo que queda fuera', () => {
  assert.deepEqual(clip([[0, 10], [20, 30], [40, 50]], 5, 45), [[5, 10], [20, 30], [40, 45]]);
  assert.deepEqual(clip([[0, 10]], 10, 20), []);
});

test('intersect devuelve solo los tramos comunes', () => {
  assert.deepEqual(intersect([[0, 10], [20, 30]], [[5, 25]]), [[5, 10], [20, 25]]);
  assert.deepEqual(intersect([[0, 10]], [[10, 20]]), [], 'tocarse en un punto no es coincidir');
  assert.deepEqual(intersect([[0, 100]], [[10, 20], [30, 40], [90, 120]]), [[10, 20], [30, 40], [90, 100]]);
  assert.deepEqual(intersect([], [[0, 10]]), []);
});

test('gaps devuelve los huecos dentro del rango, incluidos los de los extremos', () => {
  assert.deepEqual(gaps([[10, 20], [30, 40]], 0, 50), [[0, 10], [20, 30], [40, 50]]);
  assert.deepEqual(gaps([[0, 50]], 10, 40), []);
  assert.deepEqual(gaps([], 10, 40), [[10, 40]]);
  assert.deepEqual(gaps([[0, 15], [35, 60]], 10, 40), [[15, 35]], 'los intervalos se recortan antes de buscar huecos');
});

test('totalMs y longest', () => {
  assert.equal(totalMs([[0, 10], [20, 25]]), 15);
  assert.deepEqual(longest([[0, 10], [20, 45], [50, 60]]), [20, 45]);
  assert.equal(longest([]), null);
});

test('containing incluye el inicio y excluye el final; nextAfter salta el que ya ha empezado', () => {
  const iv = [[10, 20], [30, 40]];
  assert.deepEqual(containing(iv, 10), [10, 20]);
  assert.equal(containing(iv, 20), null);
  assert.equal(containing(iv, 25), null);
  assert.deepEqual(nextAfter(iv, 10), [30, 40]);
  assert.equal(nextAfter(iv, 35), null);
});
