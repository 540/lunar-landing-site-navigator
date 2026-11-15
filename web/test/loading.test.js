// Loading screen of the planner (#443): no flicker on a quick answer, a note on a slow one, the error with a retry,
// and an older wait that ends never hides a newer one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startLoading } from '../js/common/loading.js';

function fakeDoc() {
  const el = () => {
    const attrs = {}, classes = new Set();
    return { hidden: true, textContent: '', onclick: null, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }, attr: k => attrs[k],
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), has: c => classes.has(c) } };
  };
  const els = { 'data-loading': el(), 'data-loading-slow': el(), 'data-loading-error': el(), 'data-loading-retry': el() };
  return { els, getElementById: id => els[id] };
}

test('a quick answer shows nothing: no flicker', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = fakeDoc(), busy = fakeDoc().els['data-loading'];
  const wait = startLoading(busy, doc);
  t.mock.timers.tick(200);
  wait.done();
  t.mock.timers.tick(5000);
  assert.equal(doc.els['data-loading'].hidden, true);
  assert.equal(busy.attr('aria-busy'), undefined);
});

test('a slow answer shows the loader, then why it takes long, and hides it at the end', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = fakeDoc(), busy = fakeDoc().els['data-loading'];
  const wait = startLoading(busy, doc);
  t.mock.timers.tick(300);
  assert.equal(doc.els['data-loading'].hidden, false);
  assert.equal(busy.attr('aria-busy'), 'true');
  assert.equal(doc.els['data-loading-slow'].hidden, true);
  t.mock.timers.tick(4000);
  assert.equal(doc.els['data-loading-slow'].hidden, false);
  wait.done();
  assert.equal(doc.els['data-loading'].hidden, true);
  assert.equal(busy.attr('aria-busy'), undefined);
});

test('a failure shows the error and a retry that runs the search again', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = fakeDoc();
  let retried = 0;
  startLoading(null, doc).fail('No se han podido cargar los datos de visibilidad: API caída', () => { retried++; });
  assert.equal(doc.els['data-loading'].hidden, false);
  assert.equal(doc.els['data-loading'].classList.has('is-error'), true);
  assert.match(doc.els['data-loading-error'].textContent, /API caída/);
  assert.equal(doc.els['data-loading-retry'].hidden, false);
  doc.els['data-loading-retry'].onclick();
  assert.equal(retried, 1);
  assert.equal(doc.els['data-loading'].hidden, true);
  // The next wait starts clean: no error left on it.
  const next = startLoading(null, doc);
  assert.equal(doc.els['data-loading'].classList.has('is-error'), false);
  assert.equal(doc.els['data-loading-error'].hidden, true);
  next.done();
});

test('an older wait that ends does not hide a newer one', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = fakeDoc();
  const older = startLoading(null, doc);
  const newer = startLoading(null, doc);
  t.mock.timers.tick(300);
  older.done();
  assert.equal(doc.els['data-loading'].hidden, false);
  newer.done();
  assert.equal(doc.els['data-loading'].hidden, true);
});
