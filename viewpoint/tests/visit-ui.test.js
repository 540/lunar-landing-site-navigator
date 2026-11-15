// E6.1 · The wiring of the guided visit (visit-ui.js) over a minimal fake document, a fake view and a fake flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMaskGrid, expectedMaskBytes } from '../src/core/mask-grid.js';

function fakeDocument() {
  const els = new Map();
  let focused = null;
  const make = id => {
    const listeners = {};
    return {
      id, textContent: '', hidden: false, dataset: {}, style: {}, attrs: {}, listeners, children: [],
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      replaceChildren(...c) { this.children = c; },
      focus() { focused = this; },
      fire(type, ev = {}) { const e = { key: '', prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...ev }; for (const fn of listeners[type] || []) fn(e); return e; },
    };
  };
  return { els, focused: () => focused, createElement: () => make(), getElementById: id => { if (!els.has(id)) els.set(id, make(id)); return els.get(id); } };
}
globalThis.document = fakeDocument();
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { setupVisit } = await import('../src/visit-ui.js');
const { UI } = await import('../src/texts.js');

const META = { file: 'masks.bin', extentKm: 2, stepKm: 0.1, cols: 21, rows: 21, azimuths: 4, encoding: 'int16-le', observerHeightM: 2, demVersion: 'test' };
function gridOf(horizon) {
  const buf = new Uint8Array(expectedMaskBytes(META)), dv = new DataView(buf.buffer);
  for (let row = 0; row < META.rows; row++) for (let col = 0; col < META.cols; col++) {
    const h = horizon(col * META.stepKm - META.extentKm / 2, row * META.stepKm - META.extentKm / 2);
    for (let k = 0; k < 4; k++) dv.setInt16(((row * META.cols + col) * 4 + k) * 2, Math.round(h * 100), true);
  }
  return decodeMaskGrid(META, buf);
}
const N = 24 * 62 + 1;
const flat = (el, fraction) => ({ az: Array(N).fill(90), el: Array(N).fill(el), visibleFraction: Array(N).fill(fraction) });
const series = { start: '2027-01-15T00:00:00Z', stepMinutes: 60, count: N, sun: flat(2, 1), earth: flat(2, 1) };
const chapter = { id: 'move-the-flag', region: 'test', start: '2027-01-15', view: 'drone', minDifference: 0.05, options: [{ id: 'almost-nothing', from: 0.05 }, { id: 'a-little', from: 0.1 }, { id: 'a-lot', from: 0.3 }], action: { type: 'move-flag-to-contrast', radiusKm: 0.5 } };
const darkAt300 = () => gridOf((x, z) => (Math.abs(x - 0.3) < 0.05 && Math.abs(z) < 0.05 ? 20 : -5));

function setup({ grid = darkAt300(), hasGrid = true, foot = false, chapters = [chapter], start = { x: 0, z: 0 } } = {}) {
  globalThis.document = fakeDocument();
  let at = { ...start };
  const site = { x: 0, z: 0 }, locked = [];
  const footState = { active: foot };
  const view = { flagAt: () => at, moveFlag: (x, z) => { at = { x, z }; }, foot: footState };
  const placed = [];
  // The fake flag does what flag-ui.js does: a trip is refused on foot, a jump is not.
  const flag = { setLocked: reason => locked.push(reason), place: async (to, opts = {}) => { placed.push({ to, ...opts }); if (footState.active && !opts.jump) return false; view.moveFlag(to.x, to.z); return true; } };
  let date = { start: '2026-12-01', offsetDays: 3 };
  const dates = [];
  let tutorialEnded = 0;
  const visit = setupVisit({
    chapters, view, flag, site, hasGrid, getSeries: () => series, getGrid: () => grid,
    getDate: () => date, setDate: d => { date = d; dates.push(d); }, endTutorial: () => { tutorialEnded++; },
  });
  const el = id => document.getElementById(id);
  return { visit, view, el, placed, locked, footState, getDate: () => date, tutorialEnded: () => tutorialEnded, at: () => at };
}
const click = node => node.fire('click');
const tick = () => new Promise(r => setImmediate(r));

test('the visit button opens the card, ends the tutorial and moves the date to the chapter', () => {
  const t = setup();
  assert.equal(t.el('visit-btn').hidden, false);
  click(t.el('visit-btn'));
  assert.equal(t.el('visit').hidden, false);
  assert.equal(t.el('visit-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(t.tutorialEnded(), 1);
  assert.deepEqual(t.getDate(), { start: '2027-01-15', offsetDays: 0 });
  assert.match(t.el('visit-status').textContent, /capítulo 1 de 1/);
  assert.equal(t.visit.isOpen(), true);
});

test('options and levels carry aria-pressed; revealing disables the options', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  const levels = t.el('visit-levels').children;
  assert.equal(levels.filter(b => b.getAttribute('aria-pressed') === 'true').length, 1);
  click(levels[2]);
  assert.deepEqual(levels.map(b => b.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  click(t.el('visit-options').children[2]);
  assert.equal(t.el('visit-options').children[2].getAttribute('aria-pressed'), 'true');
  assert.equal(t.el('visit-options').children[0].getAttribute('aria-pressed'), 'false');
  click(t.el('visit-reveal'));
  await tick();
  assert.ok(t.el('visit-options').children.every(b => b.getAttribute('aria-disabled') === 'true'));
  assert.equal(t.el('visit-result').hidden, false);
  assert.match(t.el('visit-verdict').textContent, /Acertaste/);
});

test('without a grid, while it loads, or on foot, the reveal says why and is aria-disabled', () => {
  let t = setup({ hasGrid: false });
  click(t.el('visit-btn'));
  assert.equal(t.el('visit-note').textContent, UI.visit.noGrid);
  assert.equal(t.el('visit-skip').getAttribute('aria-disabled'), 'true');
  t = setup({ grid: null });
  click(t.el('visit-btn'));
  assert.equal(t.el('visit-note').textContent, UI.visit.loading);
  t = setup({ foot: true });
  click(t.el('visit-btn'));
  assert.equal(t.el('visit-note').textContent, UI.visit.needDrone);
});

test('exiting restores the saved date, the flag and the focus on the button', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  click(t.el('visit-skip'));
  await tick();
  assert.notDeepEqual(t.at(), { x: 0, z: 0 }, 'the flag travelled to the contrast point');
  click(t.el('visit-exit'));
  assert.deepEqual(t.at(), { x: 0, z: 0 });
  assert.deepEqual(t.getDate(), { start: '2026-12-01', offsetDays: 3 });
  assert.equal(document.focused(), t.el('visit-btn'));
  assert.equal(t.el('visit').hidden, true);
  assert.equal(t.el('visit-btn').getAttribute('aria-expanded'), 'false');
});

test('exiting on foot still puts the flag back, with a jump', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  click(t.el('visit-skip'));
  await tick();
  t.footState.active = true; // the visitor went down on foot to look
  click(t.el('visit-exit'));
  assert.deepEqual(t.at(), { x: 0, z: 0 });
  assert.equal(t.placed.at(-1).jump, true);
});

test('close() from outside (the tutorial) closes the visit', () => {
  const t = setup();
  click(t.el('visit-btn'));
  t.visit.close({ focus: false });
  assert.equal(t.visit.isOpen(), false);
  assert.equal(t.el('visit').hidden, true);
});

test('Escape folds the card, and once folded leaves; it does not reach window listeners', () => {
  const t = setup();
  click(t.el('visit-btn'));
  const first = t.el('visit').fire('keydown', { key: 'Escape' });
  assert.equal(first.prevented, true);
  assert.equal(first.stopped, true);
  assert.equal(t.el('visit').dataset.folded, 'true');
  assert.equal(t.visit.isOpen(), true);
  const second = t.el('visit').fire('keydown', { key: 'Escape' });
  assert.equal(second.stopped, true);
  assert.equal(t.visit.isOpen(), false);
  assert.equal(document.focused(), t.el('visit-btn'));
  assert.equal(t.el('visit').fire('keydown', { key: 'a' }).stopped, false);
});

test('the reveal takes the flag to the destination and the focus to the result (E6.1)', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  click(t.el('visit-skip'));
  await tick();
  assert.ok(Math.hypot(t.at().x - 0.3, t.at().z) < 0.11, 'the flag is at the dark point of the grid');
  assert.deepEqual(t.placed.at(-1).to, t.at());
  assert.equal(document.focused(), t.el('visit-result'));
  assert.equal(t.el('visit-result').hidden, false);
});

test('without a point that changes the light, the note says so and the phase is not revealed (E6.1)', async () => {
  const t = setup({ grid: gridOf(() => -5) });
  click(t.el('visit-btn'));
  click(t.el('visit-skip'));
  await tick();
  assert.equal(t.el('visit-note').textContent, UI.visit.noPoint);
  assert.equal(t.el('visit-note').hidden, false);
  assert.equal(t.el('visit-result').hidden, true);
  assert.deepEqual(t.at(), { x: 0, z: 0 });
  assert.equal(t.el('visit-status').textContent, UI.visit.noPoint);
});

test('choosing a chapter dot keeps the focus on the (rebuilt) dot (E6.1)', () => {
  const t = setup({ chapters: [chapter, { ...chapter }] });
  click(t.el('visit-btn'));
  click(t.el('visit-dots').children[1]);
  assert.equal(document.focused(), t.el('visit-dots').children[1]);
  assert.equal(t.el('visit-dots').children[1].getAttribute('aria-current'), 'step');
  click(t.el('visit-dots').children[0]);
  assert.equal(document.focused(), t.el('visit-dots').children[0]);
});

test('opening takes the flag to the site and exiting puts it back where the visitor had it, with the date', async () => {
  const t = setup({ start: { x: -0.4, z: 0.2 } });
  click(t.el('visit-btn'));
  await tick();
  assert.deepEqual(t.at(), { x: 0, z: 0 }, 'the chapter starts at the site');
  click(t.el('visit-exit'));
  assert.deepEqual(t.at(), { x: -0.4, z: 0.2 });
  assert.deepEqual(t.getDate(), { start: '2026-12-01', offsetDays: 3 });
});

test('with the visit open the flag controls, «Mejor punto cercano» and the start date are disabled with their reason, and come back on exit', () => {
  const t = setup();
  const date = t.el('start-date');
  click(t.el('visit-btn'));
  assert.deepEqual(t.locked, [UI.visit.locked]);
  assert.equal(date.disabled, true);
  assert.equal(date.getAttribute('aria-disabled'), 'true');
  assert.equal(date.title, UI.visit.locked);
  click(t.el('visit-exit'));
  assert.deepEqual(t.locked, [UI.visit.locked, null]);
  assert.equal(date.disabled, false);
  assert.equal(date.getAttribute('aria-disabled'), null);
});

// The verdict follows the measured change of light (here a dark spot at 300 m makes it ~1; the thresholds are checked in visit.test.js).
test('the verdict follows the measured difference (above and below each threshold) and with no point it grades nothing', async () => {
  // difference ~1: «Mucho» is right, «Un poco» wrong
  let t = setup();
  click(t.el('visit-btn'));
  click(t.el('visit-options').children[1]);
  click(t.el('visit-reveal'));
  await tick();
  assert.match(t.el('visit-verdict').textContent, /No era «Un poco»: la respuesta es «Mucho»/);
  // no point reaches the minimum: nothing is revealed or graded
  t = setup({ grid: gridOf(() => -5) });
  click(t.el('visit-btn'));
  click(t.el('visit-options').children[2]);
  click(t.el('visit-reveal'));
  await tick();
  assert.equal(t.el('visit-result').hidden, true);
  assert.equal(t.el('visit-note').textContent, UI.visit.noPoint);
});
