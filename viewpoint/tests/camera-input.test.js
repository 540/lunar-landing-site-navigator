// Input rules of the tour camera (E2.1, #152): form controls keep the keys, double tap detection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoubleTapDetector, isFormTarget, modalOpen } from '../src/core/camera-input.js';

test('isFormTarget: form controls and editable elements keep the keys; the page does not', () => {
  for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']) assert.equal(isFormTarget({ tagName }), true);
  assert.equal(isFormTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isFormTarget({ tagName: 'CANVAS' }), false);
  assert.equal(isFormTarget(document_body()), false);
  assert.equal(isFormTarget(null), false);
});
function document_body() { return { tagName: 'BODY' }; }

test('modalOpen: an open dialog («Fuentes») or the visible tutorial take the keys from the camera', () => {
  const docWith = matches => ({ querySelector: sel => (matches.some(m => sel.split(',').map(s => s.trim()).includes(m)) ? {} : null) });
  assert.equal(modalOpen(docWith(['dialog[open]:not(#options)'])), true);
  // The non modal options drawer does not take the keys from the camera
  assert.equal(modalOpen(docWith(['dialog[open]'])), false);
  assert.equal(modalOpen(docWith(['.tour:not([hidden])'])), true);
  assert.equal(modalOpen(docWith([])), false);
  assert.equal(modalOpen(null), false);
});

const tap = (d, id, x, y, t) => { d.handle({ type: 'down', id, x, y, t }); return d.handle({ type: 'up', id, x, y, t: t + 40 }); };

test('double tap: two quick taps close together', () => {
  const d = createDoubleTapDetector();
  assert.equal(tap(d, 1, 100, 100, 0), false);
  assert.equal(tap(d, 1, 105, 102, 150), true);
});

test('double tap: two slow taps are not one', () => {
  const d = createDoubleTapDetector();
  tap(d, 1, 100, 100, 0);
  assert.equal(tap(d, 1, 100, 100, 600), false);
});

test('double tap: two distant taps are not one', () => {
  const d = createDoubleTapDetector();
  tap(d, 1, 100, 100, 0);
  assert.equal(tap(d, 1, 200, 100, 150), false);
});

test('double tap: a drag is not a tap', () => {
  const d = createDoubleTapDetector();
  tap(d, 1, 100, 100, 0);
  d.handle({ type: 'down', id: 1, x: 100, y: 100, t: 100 });
  assert.equal(d.handle({ type: 'up', id: 1, x: 160, y: 100, t: 140 }), false);
  assert.equal(tap(d, 1, 100, 100, 200), false); // the first tap was forgotten
});

test('double tap: a tap plus a pinch is not a double tap', () => {
  const d = createDoubleTapDetector();
  tap(d, 1, 100, 100, 0);
  d.handle({ type: 'down', id: 1, x: 100, y: 100, t: 100 });
  d.handle({ type: 'down', id: 2, x: 200, y: 100, t: 110 });
  assert.equal(d.handle({ type: 'up', id: 1, x: 100, y: 100, t: 140 }), false);
  assert.equal(d.handle({ type: 'up', id: 2, x: 200, y: 100, t: 150 }), false);
});

test('double tap: a cancel forgets the first tap', () => {
  const d = createDoubleTapDetector();
  tap(d, 1, 100, 100, 0);
  d.handle({ type: 'cancel', id: 1 });
  assert.equal(tap(d, 1, 100, 100, 150), false);
});

test('double tap: the dblclick echo of a touch is recognised for a while', () => {
  const d = createDoubleTapDetector();
  tap(d, 1, 100, 100, 1000);
  assert.equal(d.isTouchEcho(1500), true);
  assert.equal(d.isTouchEcho(3000), false);
});
