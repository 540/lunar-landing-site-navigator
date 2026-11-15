import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tourLabels, DEFAULT_LABELS } from '../js/common/tour-labels.js';

test('sin labels, el tutorial dice «Siguiente», «Anterior» y «Saltar el tutorial», como siempre', () => {
  const L = tourLabels();
  assert.equal(L.next, 'Siguiente');
  assert.equal(L.prev, 'Anterior');
  assert.equal(L.skip, 'Saltar el tutorial');
  assert.equal(L.done, 'Entendido');
  assert.equal(L.count(2, 6), 'Tutorial · paso 2 de 6');
  assert.deepEqual(tourLabels(null), tourLabels(undefined));
});

test('con labels, cambia lo que se pasa y el resto queda en castellano', () => {
  const L = tourLabels({ next: 'Next', prev: 'Back' });
  assert.equal(L.next, 'Next');
  assert.equal(L.prev, 'Back');
  assert.equal(L.skip, DEFAULT_LABELS.skip);
});

test('en inglés, los botones del tutorial en inglés, con las mismas claves', () => {
  const L = tourLabels(null, 'en');
  assert.equal(L.next, 'Next');
  assert.equal(L.count(2, 6), 'Tutorial · step 2 of 6');
  assert.deepEqual(Object.keys(L).sort(), Object.keys(DEFAULT_LABELS).sort());
});
