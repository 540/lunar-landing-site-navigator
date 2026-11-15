// Plan's requirements: a value outside its field's limits is not searched with (it used to be clamped in silence, so
// the summary said «99 d» while the plan used 30).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldProblem } from '../js/common/mission-text.js';
import { es, en } from '../js/i18n/plan.js';

const days = { min: '1', max: '30' };

test('un valor dentro de los límites del campo vale', () => {
  for (const v of ['1', '6.5', '30']) assert.equal(fieldProblem(v, days), null, v);
});

test('fuera de los límites, dice cuáles son', () => {
  assert.deepEqual(fieldProblem('99', days), { kind: 'range', min: 1, max: 30 });
  assert.deepEqual(fieldProblem('0', days), { kind: 'range', min: 1, max: 30 });
  assert.deepEqual(fieldProblem('-5', { min: '0', max: '' }), { kind: 'min', min: 0, max: Infinity });
  assert.deepEqual(fieldProblem('150', { min: '', max: '100' }), { kind: 'max', min: -Infinity, max: 100 });
});

test('un campo obligatorio vacío falta; uno opcional vacío vale, pero no uno con texto', () => {
  assert.deepEqual(fieldProblem('', days), { kind: 'missing' });
  assert.equal(fieldProblem('  ', { min: '0', max: '720', required: false }), null);
  assert.deepEqual(fieldProblem('abc', { min: '0', max: '180', required: false }), { kind: 'missing' });
});

test('sin límites (un campo sin min ni max), cualquier número vale', () => {
  assert.equal(fieldProblem('-1e6'), null);
});

test('cada requisito y cada problema tiene su texto en los dos idiomas', () => {
  for (const id of ['days', 'battery', 'earth', 'earth-gap', 'transit']) {
    assert.ok(es[`plan.req.label.${id}`] && en[`plan.req.label.${id}`], id);
  }
  for (const kind of ['missing', 'range', 'min', 'max']) assert.match(es[`plan.req.${kind}`], /^\{label\}: /, kind);
});
