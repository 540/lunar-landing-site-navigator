import { readFileSync } from 'node:fs';
// Where the home menu puts the Mission 04 lander and the "Explorar la Luna" rocket on phones (home/src/menu-layout.mjs):
// their labels stay between the header and the dock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MENU_GAP, landerNdcX, landerNdcY, liftAboveDock, labelBelowChip, LOCK_CHIP_OFFSET, rocketLine, ROCKET_LINE_MARGIN, ROCKET_LINE_CHIP, ROCKET_LINE_MIN, ROCKET_LINE_CLEARANCE } from '../home/src/menu-layout.mjs';

const toPx = (ndc, height) => (1 - ndc) / 2 * height;

test('with room under the header the lander keeps its usual height', () => {
  assert.equal(landerNdcY({ top: .43, headerBottom: 173, reach: 34, height: 844 }), .43);
});

test('on a short phone the lander goes down until its top clears the header', () => {
  const height = 667, headerBottom = 190, reach = 34;
  const y = landerNdcY({ top: .43, headerBottom, reach, height });
  assert.ok(y < .43);
  assert.ok(Math.abs(toPx(y, height) - reach - (headerBottom + MENU_GAP)) < 1e-9);
});

test('the rocket only goes up when its label would reach the dock', () => {
  assert.equal(liftAboveDock({ labelBottom: 619, dockTop: 684 }), 0);
  assert.equal(liftAboveDock({ labelBottom: 676, dockTop: 684 }), 0);
  assert.equal(liftAboveDock({ labelBottom: 520, dockTop: 486 }), 520 - 486 + MENU_GAP);
});

test('the lander moves right only when its label would not fit on its left', () => {
  assert.equal(landerNdcX({ preferred: .1, labelWidth: 150, gap: 48, width: 375 }), .1);
  const x = landerNdcX({ preferred: -.2, labelWidth: 150, gap: 48, width: 375 });
  assert.ok(Math.abs((x + 1) / 2 * 375 - (MENU_GAP + 150 + 48)) < 1e-9);
});

test('the "Explorar la Luna" label goes under the reticle chip with MENU_GAP to spare', () => {
  const top = labelBelowChip({ rocketY: 400, chipHeight: 15, anchorTop: 420 });
  assert.equal(top, 400 + LOCK_CHIP_OFFSET + 15 + MENU_GAP);
  // the chip's real height counts: a taller chip (another language, larger text) pushes the label further down
  assert.equal(labelBelowChip({ rocketY: 400, chipHeight: 30, anchorTop: 420 }) - top, 15);
});

test('the label never goes above where it was without the chip', () => {
  assert.equal(labelBelowChip({ rocketY: 100, chipHeight: 15, anchorTop: 500 }), 500);
});

test('the measured chip offset replaces the default, so a CSS change cannot bring the overlap back', () => {
  assert.equal(labelBelowChip({ rocketY: 400, chipHeight: 15, chipOffset: 50, anchorTop: 420 }), 400 + 50 + 15 + MENU_GAP);
});

test('the rocket is joined to its label by a line that leaves the margins of the mission ticks', () => {
  const ln = rocketLine({ rocketBottom: 400, boxTop: 480, chipTop: 430, chipHeight: 15, chipShown: false });
  // the same margin at both ends: under the rocket and over the box
  assert.equal(ln.length, 80 - 2 * ROCKET_LINE_MARGIN);
  assert.equal(ROCKET_LINE_MARGIN, 8, 'the gap of .zl between a tick and its box');
  // without the chip the line is whole: the gap is empty, at its end
  assert.equal(ln.gapFrom, ln.length);
  assert.equal(ln.gapTo, ln.length);
});

test('while the reticle shows its chip, the line passes behind it and is still seen under it', () => {
  const chipTop = 420, chipHeight = 15, boxTop = chipTop + chipHeight + ROCKET_LINE_CLEARANCE;
  const ln = rocketLine({ rocketBottom: 400, boxTop, chipTop, chipHeight, chipShown: true });
  const start = 400 + ROCKET_LINE_MARGIN;
  assert.equal(ln.gapFrom, chipTop - ROCKET_LINE_CHIP - start);
  assert.equal(ln.gapTo, chipTop + chipHeight + ROCKET_LINE_CHIP - start);
  assert.equal(ln.length - ln.gapTo, ROCKET_LINE_MIN, 'the piece left between the chip and the label');
});

test('the label leaves room under the chip for the line and its margins', () => {
  const top = labelBelowChip({ rocketY: 400, chipHeight: 15, anchorTop: 420, clearance: ROCKET_LINE_CLEARANCE });
  assert.equal(top, 400 + LOCK_CHIP_OFFSET + 15 + ROCKET_LINE_CLEARANCE);
});

test('a chip outside the line leaves it whole, and a label over the rocket has no line', () => {
  const far = rocketLine({ rocketBottom: 400, boxTop: 480, chipTop: 600, chipHeight: 15, chipShown: true });
  assert.equal(far.gapFrom, far.length);
  assert.equal(rocketLine({ rocketBottom: 400, boxTop: 380, chipTop: 430, chipHeight: 15, chipShown: true }).length, 0);
});

test('the rocket label draws its tick upright, with the gap of the chip', () => {
  const html = readFileSync(new URL('../home/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /\.zl\.xr \.tick\{display:none\}/);
  assert.match(html, /\.labels \.zl\.xr \.tick\{[^}]*height:var\(--tk/);
  assert.match(html, /transparent var\(--g0[^)]*\) var\(--g1/);
});
