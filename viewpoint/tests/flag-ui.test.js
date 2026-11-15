// The wiring of E2.2 with a minimal fake document: the panel over a new series, and the keyboard of the flag button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMaskGrid, expectedMaskBytes } from '../src/core/mask-grid.js';

function fakeDocument() {
  const els = new Map();
  const make = () => {
    const listeners = {};
    return {
      textContent: '', hidden: false, dataset: {}, style: {}, attrs: {}, listeners,
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      removeAttribute() {}, append() {}, replaceChildren() {}, blur() { this.blurred = true; }, focus() { document.focused = this; },
      classList: { add() {}, remove() {}, toggle() {} },
    };
  };
  const created = [];
  return { els, created, createElement: () => make(), createElementNS: (ns, tag) => { const n = make(); n.tag = tag; created.push(n); return n; }, getElementById: id => { if (!els.has(id)) els.set(id, make()); return els.get(id); } };
}
globalThis.document = fakeDocument();
globalThis.window = { matchMedia: () => ({ matches: false }) };
const { setupSkyPanel } = await import('../src/sky-panel.js');
const { setupFlag } = await import('../src/flag-ui.js');

const seriesWith = horizonFraction => ({
  start: '2027-01-15T00:00:00Z', stepMinutes: 60, count: 72,
  sun: { az: Array(72).fill(90), el: Array(72).fill(3), visibleFraction: Array(72).fill(horizonFraction) },
  earth: { az: Array(72).fill(90), el: Array(72).fill(3), visibleFraction: Array(72).fill(1) },
});

test('setSource: the bars show the new series over the same period', () => {
  const sky = setupSkyPanel({ series: seriesWith(1), mask: null });
  const start = new Date('2027-01-15T00:00:00Z'), end = new Date('2027-01-17T00:00:00Z');
  sky.setPeriod(start, end);
  sky.update(new Date('2027-01-15T12:00:00Z'));
  const el = id => document.getElementById(id);
  const before = el('bar-sun-fill').style.width;
  sky.setSource({ series: seriesWith(0), mask: null });
  assert.notEqual(el('bar-sun-fill').style.width, before);
  assert.equal(el('bar-sun-fill').style.width, '0%');
  assert.equal(sky.states().sun.state, 'hidden');
});

test('setSource: with a mask the profile of the ring is drawn again', () => {
  const mask = el => ({ stepDeg: 90, el });
  const sky = setupSkyPanel({ series: seriesWith(1), mask: mask([0, 0, 0, 0]) });
  const profiles = () => document.created.filter(n => n.attrs.class === 'ring__profile' || n.attrs.class === 'ring__sky');
  const before = profiles().map(n => n.attrs.d);
  assert.equal(before.length, 2);
  sky.setSource({ series: seriesWith(1), mask: mask([10, 10, 10, 10]) });
  for (const [k, n] of profiles().entries()) assert.notEqual(n.attrs.d, before[k]);
  assert.equal(profiles()[0].attrs.d, profiles()[1].attrs.d);
  const kept = profiles().map(n => n.attrs.d);
  sky.setSource({ series: seriesWith(1), mask: null });
  assert.deepEqual(profiles().map(n => n.attrs.d), kept, 'without a mask the profile stays');
});

const META = { file: 'masks.bin', extentKm: 0.2, stepKm: 0.1, cols: 3, rows: 3, azimuths: 4, encoding: 'int16-le', observerHeightM: 2, demVersion: 'lola-test' };
const grid = () => decodeMaskGrid(META, new Uint8Array(expectedMaskBytes(META)));

function setupWithGrid(extra = {}) {
  globalThis.document = fakeDocument();
  const moved = [];
  const view = { flagAt: () => ({ x: 0, z: 0 }), moveFlag: (x, z) => moved.push([x, z]), enableFlagDrag() {}, foot: { active: false }, ...extra };
  const sky = { setSource() {}, states: () => ({ sun: { text: 'Sol visible' }, earth: { text: 'Tierra visible' } }), describe() {} };
  const flag = setupFlag({ view, frame: { fromScene: () => ({ lat: -89.5, lon: 10 }) }, sky, series: seriesWith(1), hasGrid: true, regionId: 'shackleton-rim', period: () => ({ start: new Date('2027-01-15T00:00:00Z'), days: 60 }), onChange() {} });
  document.getElementById('gl');
  flag.setGrid(grid());
  const button = document.getElementById('flag-move');
  const press = key => { const ev = { key, prevented: false, preventDefault() { this.prevented = true; } }; for (const fn of button.listeners.keydown) fn(ev); return ev; };
  return { moved, button, press };
}

test('the flag button: an arrow moves the flag one step of the grid and announces the figures', () => {
  const { moved, button, press } = setupWithGrid();
  for (const fn of button.listeners.click) fn();
  const ev = press('ArrowRight');
  assert.equal(ev.prevented, true);
  assert.deepEqual(moved, [[0.1, 0]]);
  assert.match(document.getElementById('flag-status').textContent, /Sol visible.*Tierra visible/);
});

test('the flag button: the arrows do nothing until the button is pressed', () => {
  const { moved, press } = setupWithGrid();
  assert.equal(press('ArrowRight').prevented, false);
  assert.deepEqual(moved, []);
});

test('the flag button: modifiers and other keys do nothing; Escape lets go and keeps the focus', () => {
  const { moved, button, press } = setupWithGrid();
  for (const fn of button.listeners.click) fn();
  assert.equal(press('a').prevented, false);
  for (const fn of button.listeners.keydown) fn({ key: 'ArrowUp', ctrlKey: true, preventDefault() {} });
  assert.deepEqual(moved, []);
  press('Escape');
  assert.equal(button.blurred, undefined);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(press('ArrowRight').prevented, false);
});

test('the flag button: on foot the arrows do not move the flag', () => {
  const { moved, button, press } = setupWithGrid({ foot: { active: true } });
  for (const fn of button.listeners.click) fn();
  assert.equal(press('ArrowRight').prevented, false);
  assert.deepEqual(moved, []);
});

test('the flag button: activating it toggles aria-pressed and says what the arrows do', () => {
  const { button } = setupWithGrid();
  for (const fn of button.listeners.click) fn();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.match(document.getElementById('flag-status').textContent, /100 m/);
  for (const fn of button.listeners.click) fn();
  assert.equal(button.getAttribute('aria-pressed'), 'false');
});

// ---- E2.5: «Mejor punto cercano» ----
async function setupBest({ footActive = false, hot = [1, 1], start: at0 = { x: 0, z: 0 } } = {}) {
  globalThis.document = fakeDocument();
  globalThis.window = { matchMedia: () => ({ matches: true }) }; // reduced motion: the flag jumps
  const moved = [];
  let at = at0;
  const modeListeners = [];
  const foot = { active: footActive, onModeChange: f => modeListeners.push(f) }, drag = {};
  const view = { flagAt: () => at, moveFlag: (x, z) => { at = { x, z }; moved.push([x, z]); }, enableFlagDrag(o) { Object.assign(drag, o); }, foot };
  const sky = { setSource() {}, states: () => ({ sun: { text: 'Sol visible' }, earth: { text: 'Tierra visible' } }), describe() {} };
  // Sun and Earth hidden by a 20° horizon everywhere but at the hot point (col, row of the 3 × 3 grid)
  const g = decodeMaskGrid(META, (() => {
    const buf = new Uint8Array(expectedMaskBytes(META)), dv = new DataView(buf.buffer);
    for (let p = 0; p < 9; p++) for (let k = 0; k < 4; k++) dv.setInt16((p * 4 + k) * 2, (p === hot[1] * 3 + hot[0] ? -1000 : 2000), true);
    return buf;
  })());
  let start = new Date('2027-01-15T00:00:00Z');
  const flag = setupFlag({ view, frame: { fromScene: () => ({ lat: -89.5, lon: 10 }) }, sky, series: seriesWith(1), hasGrid: true, regionId: 'shackleton-rim', period: () => ({ start, days: 2 }), onChange() {} });
  document.getElementById('gl');
  flag.setGrid(g);
  const best = document.getElementById('flag-best');
  const click = async () => { for (const fn of best.listeners.click) await fn(); };
  return { moved, best, click, foot, drag, flag, setAt: p => { at = p; }, setStart: d => { start = d; }, setMode: mode => { foot.active = mode === 'foot'; for (const f of modeListeners) f(mode); } };
}

test('the best-point button: it shows with the grid, takes the flag to the best point and says how much better it is', async () => {
  const { moved, best, click } = await setupBest({ hot: [2, 0] });
  assert.equal(best.hidden, false);
  await click();
  assert.deepEqual(moved.map(([x, z]) => [Math.round(x * 10), Math.round(z * 10)]), [[1, -1]]);
  assert.match(document.getElementById('flag-best-note').textContent, /Mejor punto: \+100 % de luz, \+100 % de Tierra/);
});

test('the best-point button: where the flag already is the best, it moves nothing and says so', async () => {
  const { moved, click } = await setupBest({ hot: [1, 1] });
  await click();
  assert.deepEqual(moved, []);
  assert.match(document.getElementById('flag-best-note').textContent, /ya está en el mejor punto/);
});

test('the best-point button: on foot it does nothing', async () => {
  const { moved, best, click } = await setupBest({ footActive: true, hot: [2, 0] });
  assert.equal(best.hidden, true);
  await click();
  assert.deepEqual(moved, []);
});

test('the best-point button: if the visitor goes on foot during the search, the flag does not move', async () => {
  const ctx = await setupBest({ hot: [2, 0] });
  const click = ctx.best.listeners.click[0]();
  ctx.foot.active = true;
  await click;
  assert.deepEqual(ctx.moved, []);
});

test('the best-point button: if the visitor drops the flag during the search, the old result is dropped', async () => {
  const ctx = await setupBest({ hot: [2, 0] });
  const click = ctx.best.listeners.click[0]();
  ctx.drag.onDrop({ x: 0, z: 0 });
  await click;
  assert.deepEqual(ctx.moved, []);
  assert.equal(document.getElementById('flag-best-note').hidden, true);
});

test('the best-point button: with the flag a few metres from the best point it moves nothing and says so', async () => {
  const ctx = await setupBest({ hot: [1, 1], start: { x: 0.0002, z: 0 } });
  await ctx.click();
  assert.deepEqual(ctx.moved, []);
  assert.match(document.getElementById('flag-best-note').textContent, /ya está en el mejor punto/);
});

test('the best-point note goes away when the flag is dragged, moved with the arrows or the period changes', async () => {
  const ctx = await setupBest({ hot: [2, 0] });
  const note = document.getElementById('flag-best-note');
  await ctx.click();
  assert.equal(note.hidden, false);
  ctx.drag.onDrop({ x: 0, z: 0 });
  assert.equal(note.hidden, true);
  await ctx.click();
  assert.equal(note.hidden, false);
  ctx.flag.periodChanged();
  assert.equal(note.hidden, true);
  await ctx.click();
  assert.equal(note.hidden, false);
  const button = document.getElementById('flag-move');
  for (const fn of button.listeners.click) fn();
  for (const fn of button.listeners.keydown) fn({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(note.hidden, true);
});

test('the best-point glide aborted by a period change or going on foot puts the flag back where it was', async () => {
  for (const abort of [ctx => ctx.flag.periodChanged(), ctx => { ctx.foot.active = true; }]) {
    const ctx = await setupBest({ hot: [2, 0] });
    globalThis.window.matchMedia = () => ({ matches: false }); // animate
    const queue = [];
    globalThis.requestAnimationFrame = fn => queue.push(fn);
    try {
      await ctx.click();
      queue.shift()(performance.now() + 100); // a frame halfway: the flag is on its way
      assert.notDeepEqual(ctx.moved.at(-1), [0, 0]);
      abort(ctx);
      queue.shift()(performance.now() + 200);
      assert.deepEqual(ctx.moved.at(-1), [0, 0]);
    } finally { delete globalThis.requestAnimationFrame; }
  }
});

test('the best-point button: the live region carries the new position and the gain in one update', async () => {
  const ctx = await setupBest({ hot: [2, 0] });
  await ctx.click();
  assert.match(document.getElementById('flag-status').textContent, /Bandera en .*Mejor punto: /);
});

// ---- E6.1: `place` for the guided visit ----
test('place: on foot a trip is refused, but a jump puts the flag back (E6.1)', async () => {
  const { moved, foot, flag } = await setupBest({ footActive: true });
  assert.equal(await flag.place({ x: 0.1, z: 0.1 }), false);
  assert.deepEqual(moved, []);
  assert.equal(await flag.place({ x: 0.1, z: 0.1 }, { jump: true }), true);
  assert.deepEqual(moved, [[0.1, 0.1]]);
  assert.equal(foot.active, true);
});

function animated() {
  globalThis.window.matchMedia = () => ({ matches: false });
  const queue = [];
  globalThis.requestAnimationFrame = fn => queue.push(fn);
  return queue;
}

test('reduced motion (E8.3): the flag glide never asks for a frame and lands at once', async () => {
  const ctx = await setupBest(); // its fake window matches «reduce»
  let frames = 0;
  globalThis.requestAnimationFrame = () => { frames++; return 0; };
  try {
    assert.equal(await ctx.flag.place({ x: 0.1, z: 0.1 }), true);
    assert.equal(frames, 0);
    assert.deepEqual(ctx.moved, [[0.1, 0.1]]);
    globalThis.window.matchMedia = () => ({ matches: false });
    ctx.flag.place({ x: -0.1, z: 0.1 });
    assert.equal(frames, 1, 'without «reduce» the same call does animate (the test can fail)');
  } finally { delete globalThis.requestAnimationFrame; }
});

test('place: the glide resolves true and leaves the flag at the destination (E6.1)', async () => {
  const ctx = await setupBest();
  const queue = animated();
  try {
    const trip = ctx.flag.place({ x: 0.1, z: 0.1 });
    queue.shift()(performance.now() + 100); // halfway
    assert.notDeepEqual(ctx.moved.at(-1), [0.1, 0.1]);
    while (queue.length) queue.shift()(performance.now() + 10_000);
    assert.equal(await trip, true);
    assert.deepEqual(ctx.moved.at(-1), [0.1, 0.1]);
  } finally { delete globalThis.requestAnimationFrame; }
});

test('place: a newer call cancels the one in flight, which resolves false and does not move the flag back (E6.1)', async () => {
  const ctx = await setupBest();
  const queue = animated();
  try {
    const first = ctx.flag.place({ x: 0.1, z: 0.1 });
    queue.shift()(performance.now() + 100);
    const second = ctx.flag.place({ x: -0.1, z: 0.1 });
    while (queue.length) queue.shift()(performance.now() + 10_000);
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(ctx.moved.at(-1), [-0.1, 0.1]);
  } finally { delete globalThis.requestAnimationFrame; }
});

test('place: going on foot during the trip puts the flag back where it was (E6.1)', async () => {
  const ctx = await setupBest();
  const queue = animated();
  try {
    const trip = ctx.flag.place({ x: 0.1, z: 0.1 });
    queue.shift()(performance.now() + 100);
    ctx.foot.active = true;
    queue.shift()(performance.now() + 200);
    assert.equal(await trip, false);
    assert.deepEqual(ctx.moved.at(-1), [0, 0]);
  } finally { delete globalThis.requestAnimationFrame; }
});

// ---- E3.6: the flag on foot ----
function setupFoot(start = { x: 0.05, z: 0 }) {
  globalThis.document = fakeDocument();
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const moved = [], sources = [], carry = [], planted = [], lis = { change: [], stop: [], mode: [], key: [] };
  const ctx = { me: { ...start, yaw: 90 }, flagAt: { x: 0, z: 0 } };
  const foot = {
    active: true, state: () => ctx.me, carryFlag: on => carry.push(on), plantFlag: (x, z) => { planted.push([x, z]); ctx.flagAt = { x, z }; },
    onChange: f => lis.change.push(f), onStop: f => lis.stop.push(f), onModeChange: f => lis.mode.push(f), onFlagKey: f => lis.key.push(f),
  };
  const view = { flagAt: () => ctx.flagAt, moveFlag: (x, z) => { ctx.flagAt = { x, z }; moved.push([x, z]); }, enableFlagDrag() {}, foot };
  const sky = { setSource: s => sources.push(s), states: () => ({ sun: { text: 'Sol' }, earth: { text: 'Tierra' } }), describe() {} };
  const flag = setupFlag({ view, frame: { fromScene: () => ({ lat: -89.5, lon: 10 }) }, sky, series: seriesWith(1), hasGrid: true, regionId: 'shackleton-rim', period: () => ({ start: new Date('2027-01-15T00:00:00Z'), days: 60 }), onChange() {} });
  flag.setGrid(grid());
  lis.mode.forEach(f => f('foot'));
  const el = id => document.getElementById(id);
  const walk = (x, z, stop = true) => { ctx.me = { ...ctx.me, x, z }; (stop ? lis.stop : lis.change).forEach(f => f()); };
  const action = () => lis.key.forEach(f => f());
  return { ctx, moved, sources, carry, planted, lis, el, walk, action };
}

test('on foot, without picking the flag up the figures do not change while you walk', () => {
  const { sources, walk, el } = setupFoot();
  walk(0.05, 0); walk(0.1, 0.05); walk(0.9, 0); // even out of the grid
  assert.equal(sources.length, 0);
  assert.equal(el('flag-note').hidden, true, 'no notice: the flag does not follow you');
  assert.equal(el('foot-flag').hidden, true, 'far from the flag there is no action');
});

test('on foot, near the flag «Coger la bandera» shows; carried, the figures follow you and the action is «Plantar»', () => {
  const { sources, carry, walk, action, el } = setupFoot();
  walk(0.002, 0);
  assert.equal(el('foot-flag').hidden, false);
  assert.equal(el('foot-flag').textContent, 'Coger la bandera');
  action();
  assert.deepEqual(carry, [true]);
  assert.equal(sources.length, 1, 'picking it up shows the figures of where you are');
  assert.equal(el('foot-flag').textContent, 'Plantar la bandera');
  walk(0.1, 0.1);
  assert.equal(sources.length, 2, 'stopped: the figures of the point where you are');
  assert.deepEqual(sources[1].mask && true, true);
  walk(0.9, 0);
  assert.equal(sources.length, 2, 'out of the grid the figures stay');
  assert.match(el('flag-note').textContent, /Fuera de la zona con horizonte calculado/);
  walk(0.05, 0);
  assert.equal(el('flag-note').hidden, true, 'back in: the notice goes away');
});

test('on foot, far from the flag it cannot be picked up', () => {
  const { carry, walk, action } = setupFoot();
  walk(0.1, 0);
  action();
  assert.deepEqual(carry, []);
});

test('on foot, planting puts the flag at your feet and it keeps its figures; outside the grid it cannot be planted', () => {
  const { sources, carry, planted, walk, action, el } = setupFoot();
  walk(0.002, 0); action(); // picked up
  walk(0.9, 0);
  action();
  assert.deepEqual(carry, [true], 'outside the grid it stays on your arm');
  assert.match(el('foot-status').textContent, /No se puede plantar/);
  walk(0.06, 0.04);
  action();
  assert.deepEqual(carry, [true, false]);
  assert.equal(planted.length, 1);
  assert.ok(Math.abs(planted[0][0] - 0.0608) < 1e-9 && Math.abs(planted[0][1] - 0.04) < 1e-9, 'a little ahead, where you look (east)');
  const n = sources.length;
  walk(0.0, 0.0); walk(-0.05, 0.05);
  assert.equal(sources.length, n, 'planted: walking does not change the figures');
});

test('going up with the flag on your arm plants it where you are, at the nearest point of the grid; planted, it stays', () => {
  const a = setupFoot();
  a.walk(0.002, 0); a.action();
  a.walk(0.9, 0);
  a.lis.mode.forEach(f => f('drone'));
  assert.deepEqual(a.carry, [true, false]);
  assert.deepEqual(a.moved, [[0.1, 0]]);
  assert.equal(a.el('foot-flag').hidden, true);

  const b = setupFoot();
  b.walk(0.05, 0.05);
  b.lis.mode.forEach(f => f('drone'));
  assert.deepEqual(b.moved, [], 'a flag you never touched does not move');
  assert.deepEqual(b.carry, []);

  const c = setupFoot();
  c.walk(0.002, 0); c.action(); c.walk(0.06, 0.04); c.action(); // picked up and planted elsewhere
  c.lis.mode.forEach(f => f('drone'));
  assert.equal(c.moved.length, 1, 'the rocket and the astronaut go to the planted flag');
  assert.deepEqual(c.moved[0], c.planted[0]);
});

test('picking the flag up from just past the edge of the grid shows and announces the notice', () => {
  const f = setupFoot({ x: 0.1, z: 0 });
  f.ctx.flagAt = { x: 0.0985, z: 0 }; // flag at the edge, within reach (4 m) of someone just outside
  f.walk(0.1015, 0, false);
  f.action();
  assert.equal(f.sources.length, 0, 'figures do not change');
  assert.match(f.el('flag-note').textContent, /Fuera de la zona con horizonte calculado/);
  assert.match(f.el('foot-status').textContent, /Fuera de la zona con horizonte calculado/);
});

test('coming back into the grid is announced in the live region', () => {
  const { walk, action, el } = setupFoot();
  walk(0.002, 0); action();
  walk(0.9, 0);
  walk(0.05, 0);
  assert.match(el('foot-status').textContent, /Vuelves a la zona con horizonte calculado/);
});

test('the focus does not fall to the body when the action button hides', () => {
  const { walk, el } = setupFoot();
  walk(0.002, 0);
  assert.equal(el('foot-flag').hidden, false);
  document.activeElement = el('foot-flag');
  walk(0.1, 0);
  assert.equal(el('foot-flag').hidden, true);
  assert.equal(document.focused, el('view-btn'));
});

test('the action is announced once when the flag comes within reach, and not rewritten while nothing changes', () => {
  const { walk, el } = setupFoot();
  walk(0.1, 0);
  assert.equal(el('foot-status').textContent, '');
  walk(0.002, 0, false);
  assert.equal(el('foot-status').textContent, 'Coger la bandera (F)');
  el('foot-status').textContent = '';
  el('foot-flag').textContent = 'x';
  walk(0.0025, 0, false);
  assert.equal(el('foot-status').textContent, '', 'same state: no new announcement');
  assert.equal(el('foot-flag').textContent, 'x', 'same state: the button is not rewritten');
});

test('going up with the focus on the action button moves it to the foot button', () => {
  const { walk, lis, el } = setupFoot();
  walk(0.002, 0);
  document.activeElement = el('foot-flag');
  lis.mode.forEach(f => f('drone'));
  assert.equal(el('foot-flag').hidden, true);
  assert.equal(document.focused, el('foot-btn'));
});

// ---- E10.1: «Comparar en el planificador» ----
test('the planner link: at the site it carries the site; moving the flag changes the href without reloading', async () => {
  const ctx = await setupBest({ hot: [2, 0] });
  const link = document.getElementById('flag-plan');
  assert.equal(link.textContent, 'Comparar en el planificador (30 días)', 'the cut is in the visible text');
  assert.match(link.href, /^\.\.\/web\/\?site=shackleton-rim&/);
  ctx.drag.onDrop({ x: 0.1, z: 0 });
  assert.match(link.href, /site=custom&lat=-89\.5&lon=10&/);
  ctx.setAt({ x: 0, z: 0 });
  ctx.drag.onDrop({ x: 0, z: 0 });
  assert.match(link.href, /site=shackleton-rim&/, 'back at the site');
});

test('the planner link: «Mejor punto cercano» and the start date update it; on foot it hides', async () => {
  const ctx = await setupBest({ hot: [2, 0] });
  const link = document.getElementById('flag-plan');
  await ctx.click();
  assert.match(link.href, /site=custom/);
  ctx.setAt({ x: 0, z: 0 });
  ctx.flag.periodChanged();
  assert.match(link.href, /site=shackleton-rim/);
  assert.equal(link.hidden, false);
  ctx.foot.active = true;
  ctx.flag.periodChanged();
  assert.equal(link.hidden, true);
});

test('the planner link: changing the start date changes t0 in the href', () => {
  return setupBest({ hot: [2, 0] }).then(ctx => {
    const link = document.getElementById('flag-plan');
    assert.match(link.href, /t0=2027-01-15/);
    ctx.setStart(new Date('2027-02-20T00:00:00Z'));
    ctx.flag.periodChanged();
    assert.match(link.href, /t0=2027-02-20/);
    assert.doesNotMatch(link.href, /t0=2027-01-15/);
  });
});

test('the planner link: the mode change hides it on foot and shows it again on «Subir al dron»', async () => {
  const ctx = await setupBest({ hot: [2, 0] });
  const link = document.getElementById('flag-plan');
  assert.equal(link.hidden, false);
  ctx.setMode('foot');
  assert.equal(link.hidden, true);
  ctx.setMode('drone');
  assert.equal(link.hidden, false);
});

test('the planner link: an arrow of the flag button changes the href to the own point', () => {
  let at = { x: 0, z: 0 };
  const { button, press } = setupWithGrid({ flagAt: () => at, moveFlag: (x, z) => { at = { x, z }; } });
  const link = document.getElementById('flag-plan');
  assert.match(link.href, /site=shackleton-rim&/);
  for (const fn of button.listeners.click) fn();
  press('ArrowRight');
  assert.match(link.href, /site=custom&lat=-89\.5&lon=10&/);
});

test('setLocked: the drag and «Mejor punto cercano» do nothing while the visit locks them, and `place` still works (E6.1)', async () => {
  const { moved, best, click, drag, flag } = await setupBest({ hot: [2, 0] });
  flag.setLocked('Con la visita abierta no se puede');
  assert.equal(drag.canDrag(), false);
  assert.equal(best.getAttribute('aria-disabled'), 'true');
  assert.equal(best.title, 'Con la visita abierta no se puede');
  await click();
  assert.deepEqual(moved, []);
  assert.equal(await flag.place({ x: 0.1, z: 0.1 }, { jump: true }), true);
  assert.deepEqual(moved, [[0.1, 0.1]]);
  flag.setLocked(null);
  assert.equal(drag.canDrag(), true);
  assert.equal(best.getAttribute('aria-disabled'), 'false');
});

test('setLocked with `move`: the drag stays free but «Mejor punto cercano» stays locked (E6.2, «Tú decides»)', async () => {
  const { best, drag, flag } = await setupBest({ hot: [2, 0] });
  flag.setLocked('Con la visita abierta no se puede', { move: true });
  assert.equal(drag.canDrag(), true);
  assert.equal(best.getAttribute('aria-disabled'), 'true');
  flag.setLocked('Con la visita abierta no se puede');
  assert.equal(drag.canDrag(), false);
  flag.setLocked(null);
  assert.equal(drag.canDrag(), true);
});
