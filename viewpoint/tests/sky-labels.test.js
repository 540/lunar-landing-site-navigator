// Labels of the Sun and the Earth in the mission viewer (V1.3): whole inside the view and clear of the zoom buttons.
import test from 'node:test';
import assert from 'node:assert/strict';
import { labelPlacement } from '../src/core/sky-labels.js';

const view = { width: 1440, height: 900, labelWidth: 100, rightReserve: 72 };

test('a body off the right edge keeps its whole label inside the view and clear of the zoom buttons', () => {
  const at = labelPlacement({ x: 5000, y: 500 }, view);
  assert.equal(at.x + view.labelWidth / 2, view.width - view.rightReserve);
  assert.equal(at.edge, true);
  assert.equal(at.arrow, 'right');
});

test('on a phone the label never reaches past the right edge, so the page does not get wider', () => {
  const phone = { width: 390, height: 844, labelWidth: 112, rightReserve: 72 };
  const at = labelPlacement({ x: 9999, y: 300 }, phone);
  assert.ok(at.x + phone.labelWidth / 2 <= phone.width);
});

test('a body off the left edge is held at the margin, pointing left', () => {
  const at = labelPlacement({ x: -300, y: 500 }, view);
  assert.equal(at.x - view.labelWidth / 2, 24);
  assert.equal(at.arrow, 'left');
});

test('a body well inside the view keeps its label over the disc, without arrow', () => {
  assert.deepEqual(labelPlacement({ x: 700, y: 300 }, view), { x: 700, y: 300, edge: false, arrow: null });
});

test('the label stays under the top bar and over the HUD', () => {
  assert.equal(labelPlacement({ x: 700, y: 10 }, view).y, 112);
  assert.equal(labelPlacement({ x: 700, y: 890 }, view).y, 900 * 0.55);
});
