// E6.2 · The chapters «Sombras de kilómetros», «Llamar a casa» y «Tú decides»: their figures (pure) and their wiring (visit-ui.js) over a fake document, view, flag and timeline.
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
const { shadowLengthKm, pickShadowInstant, shadowFigures, earthFigures, earthGaze, compareWithBest, RELIEF_HEIGHT_KM, FORMULA_EXAMPLE_DEG, EARTH_RUN_DAYS } = await import('../src/core/visit-figures.js');
const { periodSamples, scoreAt, findBestPoint, improvement } = await import('../src/core/best-point.js');
const { periodMetrics } = await import('../src/core/sky-state.js');
const { CHAPTERS, chaptersFor } = await import('../src/visit-chapters.js');
const { startVisit, reveal, bet, outcome, rightOption, measureOf, isGraded, canMoveFlag, next, chapterOf } = await import('../src/core/visit.js');
const { SPEEDS } = await import('../src/core/timeline.js');
const { sampleAt } = await import('../src/core/series.js');

const N = 24 * 62 + 1;
const START = new Date('2027-01-15T00:00:00Z');
const day = d => new Date(START.getTime() + d * 864e5);
// A synthetic series: the arrays are built from a function of the sample index.
const make = ({ sunEl = () => 0.5, sunVis = () => 1, sunAz = () => 100, earthVis = () => 1, earthEl = () => 4, earthAz = () => 200 }) => ({
  start: '2027-01-15T00:00:00Z', stepMinutes: 60, count: N,
  sun: { az: Array.from({ length: N }, (_, i) => sunAz(i)), el: Array.from({ length: N }, (_, i) => sunEl(i)), visibleFraction: Array.from({ length: N }, (_, i) => sunVis(i)) },
  earth: { az: Array.from({ length: N }, (_, i) => earthAz(i)), el: Array.from({ length: N }, (_, i) => earthEl(i)), visibleFraction: Array.from({ length: N }, (_, i) => earthVis(i)) },
});
const PERIOD = periodSamples(make({}), START, 60);

// ---- pure: «Sombras de kilómetros» ----
test('E6.2 · L = h / tan(elevation): 1 km at 1.5° is 38.2 km (± 0.05)', () => {
  assert.ok(Math.abs(shadowLengthKm(1, 1.5) - 38.2) <= 0.05, String(shadowLengthKm(1, 1.5)));
  assert.equal(RELIEF_HEIGHT_KM, 1);
  assert.equal(FORMULA_EXAMPLE_DEG, 1.5);
  assert.ok(Math.abs(shadowLengthKm(2, 45) - 2) < 1e-9);
  assert.equal(shadowLengthKm(1, 0), Infinity);
});

test('E6.2 · the instant of the shadows: the highest Sun among the samples with the Sun in view, the earliest on a tie', () => {
  // the highest sample (el 3) has the Sun half hidden: it does not count; el 0.8 appears twice, the earliest wins
  const series = make({ sunEl: i => (i === 10 ? 3 : i === 100 || i === 300 ? 0.8 : i === 50 ? 0.9 : 0.1), sunVis: i => (i === 10 || i === 50 ? 0.5 : 1) });
  const at = pickShadowInstant(series, PERIOD);
  assert.equal(at.index, 100);
  assert.equal(at.elevation, 0.8);
  assert.equal(at.date.toISOString(), '2027-01-19T04:00:00.000Z');
  assert.equal(pickShadowInstant(make({ sunVis: () => 0.98 }), PERIOD), null, 'no sample with the Sun in view: no instant');
  assert.equal(pickShadowInstant(make({ sunEl: () => -1 }), PERIOD), null, 'below the horizon does not count');
  // outside the period it does not count
  assert.equal(pickShadowInstant(make({ sunEl: i => (i > PERIOD.count ? 5 : 0.4) }), PERIOD).elevation, 0.4);
});

test('E6.2 · the figures of the shadows carry the elevation of the series at the instant and the length from it', () => {
  const series = make({ sunEl: i => (i === 77 ? 1.5 : 0.2) });
  const f = shadowFigures(series, START, 60);
  assert.equal(f.elevation, 1.5);
  assert.ok(Math.abs(f.lengthKm - 38.2) <= 0.05);
  assert.ok(Math.abs(f.offsetDays - 77 / 24) < 1e-9);
  assert.equal(shadowFigures(make({ sunVis: () => 0 }), START, 60), null);
});

// ---- pure: «Llamar a casa» ----
test('E6.2 · the figures of «Llamar a casa» are those of periodMetrics for the period', () => {
  const series = make({ earthVis: i => (i % 24 < 6 ? 0 : 1) });
  const f = earthFigures(series, START, 60);
  assert.deepEqual(f.metrics, periodMetrics(series, START, 60));
  assert.ok(f.metrics.earthTimeFraction > 0.7 && f.metrics.earthTimeFraction < 0.8);
  assert.equal(f.metrics.longestEarthOutageHours, 6);
});

test('E6.2 · the Earth run goes from the first sight to the next set, or two days if it is never hidden', () => {
  const series = make({ earthVis: i => (i < 5 ? 0 : i < 30 ? 1 : 0) });
  const f = earthFigures(series, START, 60);
  assert.equal(f.run.from.toISOString(), '2027-01-15T05:00:00.000Z');
  assert.ok(Math.abs(f.run.toOffsetDays * 24 - 29.5) < 1e-9, 'it stops where the Earth stops being seen, halfway between samples');
  const always = earthFigures(make({}), START, 60);
  assert.equal(always.run.fromOffsetDays, 0);
  assert.equal(always.run.toOffsetDays, EARTH_RUN_DAYS);
  assert.equal(earthFigures(make({ earthVis: () => 0 }), START, 60).run, null);
  assert.ok(SPEEDS.length > 0);
});

test('E6.2 · the gaze at the Earth: its azimuth and elevation, and the horizon when it is below it', () => {
  const series = make({ earthEl: () => -3, earthAz: () => 123 });
  const g = earthGaze(series, day(1));
  assert.deepEqual([g.azimuth, g.elevation, g.lookElevation], [123, -3, 0]);
  assert.equal(earthGaze(make({ earthEl: () => 5 }), day(1)).lookElevation, 5);
  assert.equal(sampleAt(series, day(1)).earth.az, 123);
});

// ---- pure: «Tú decides» ----
const shaded = (x, z) => (Math.abs(x) < 0.45 && Math.abs(z) < 0.45 ? 20 : -5); // a shaded block at the centre; the rest sees everything
const litSeries = make({ sunEl: () => 2, earthEl: () => 2, sunAz: () => 90, earthAz: () => 90 });

test('E6.2 · «Tú decides» compares the score of the visitor\'s point with findBestPoint on a synthetic grid', async () => {
  const grid = gridOf(shaded);
  const c = await compareWithBest(grid, litSeries, START, 60, { x: 0, z: 0 });
  const period = periodSamples(litSeries, START, 60);
  assert.deepEqual(c.mine, scoreAt(grid, litSeries, period, 0, 0));
  const best = await findBestPoint(grid, litSeries, period, { x: 0, z: 0 });
  assert.deepEqual(c.best, best);
  assert.deepEqual(c.gain, improvement(c.mine, best));
  assert.ok(c.mine.score < 1 && c.best.score > 90, 'the shaded centre scores nothing, the best point a lot');
  assert.equal(c.isBest, false);
  const atBest = await compareWithBest(grid, litSeries, START, 60, { x: best.x, z: best.z });
  assert.equal(atBest.isBest, true);
});

// ---- the engine ----
test('E6.2 · the chapters are the four of the visit, in order, with their measure and options', () => {
  const ids = chaptersFor('shackleton-rim').map(c => c.id);
  assert.deepEqual(ids, ['move-the-flag', 'long-shadows', 'call-home', 'you-decide']);
  const by = Object.fromEntries(CHAPTERS.map(c => [c.id, c]));
  assert.deepEqual([measureOf(by['move-the-flag']), measureOf(by['long-shadows']), measureOf(by['call-home'])], ['sun-difference', 'shadow-km', 'earth-time']);
  assert.ok(CHAPTERS.every(c => c.start === '2027-01-15'));
  assert.deepEqual(by['long-shadows'].options.map(o => [o.id, o.from]), [['under-a-km', 0], ['a-few-km', 1], ['tens-of-km', 20]]);
  assert.deepEqual(by['call-home'].options.map(o => [o.id, o.from]), [['less-than-half', 0], ['more-than-half', 0.5], ['always', 0.999]]);
  assert.deepEqual([by['you-decide'].options, by['you-decide'].action], [[], { type: 'compare-with-best' }]);
  // the right option of each measure
  assert.equal(rightOption(by['long-shadows'], 0.4), 0);
  assert.equal(rightOption(by['long-shadows'], 38.2), 2);
  assert.equal(rightOption(by['call-home'], 0.6), 1);
  assert.equal(rightOption(by['call-home'], 1), 2);
  assert.equal(rightOption(by['you-decide'], 5), -1);
});

test('E6.2 · «Tú decides» has no bet: the question goes to revealed, there is no verdict and the flag may move only before', () => {
  const chapters = chaptersFor('shackleton-rim');
  let s = startVisit(chapters, { origin: { x: 0, z: 0 } });
  assert.equal(canMoveFlag(s), false, 'not in the other chapters');
  s = next(next(next(s)));
  assert.equal(chapterOf(s).id, 'you-decide');
  assert.equal(isGraded(chapterOf(s)), false);
  assert.equal(canMoveFlag(s), true);
  assert.equal(bet(s, 0), s, 'no option to bet on');
  s = reveal(s);
  assert.equal(s.phase, 'revealed');
  assert.equal(outcome(s, 5), 'none');
  assert.equal(canMoveFlag(s), false, 'once revealed the flag is locked again');
  assert.equal(s.index, s.chapters.length - 1, 'the closing chapter is the last one');
});

// ---- the wiring ----
function setup({ series = make({ sunEl: i => (i === 77 ? 0.8 : 0.1), earthVis: i => (i < 100 ? 1 : 0), earthAz: () => 200, earthEl: () => 3 }), grid = gridOf(shaded), foot = false, reduced = false, hasGrid = true, start = { x: 0, z: 0 } } = {}) {
  globalThis.document = fakeDocument();
  let at = { ...start };
  const footState = { active: foot, flying: false, calls: [], listeners: [] };
  const view = {
    flagAt: () => at, moveFlag: (x, z) => { at = { x, z }; },
    foot: {
      get active() { return footState.active; },
      get flying() { return footState.flying; },
      onModeChange(f) { footState.listeners.push(f); },
      enter(o) { footState.calls.push(['enter', o]); footState.active = true; if (o.look) footState.look = o.look; },
      exit(o) { footState.calls.push(['exit', o]); footState.active = false; },
      lookAt(yaw, pitch) { footState.calls.push(['look', yaw, pitch]); footState.look = { yaw, pitch }; },
    },
  };
  const locked = [];
  const flag = { setLocked: (reason, opts = {}) => locked.push([reason, !!opts.move]), place: async (to, opts = {}) => { view.moveFlag(to.x, to.z); return true; } };
  let date = { start: '2026-12-01', offsetDays: 3 };
  const dates = [];
  const playback = { playing: true, speedIndex: 0, runs: [], stops: 0 };
  const time = {
    get: () => ({ playing: playback.playing, speedIndex: playback.speedIndex }),
    set: p => { playback.playing = p.playing; playback.speedIndex = p.speedIndex; },
    runTo: (offsetDays, o) => { playback.runs.push([offsetDays, o]); playback.playing = true; playback.speedIndex = o.speedIndex; },
    stop: () => { playback.stops++; },
  };
  const visit = setupVisit({
    chapters: chaptersFor('shackleton-rim'), view, flag, site: { x: 0, z: 0 }, hasGrid, getSeries: () => series, getGrid: () => grid,
    getDate: () => date, setDate: d => { date = d; dates.push(d); }, endTutorial() {}, time, reducedMotion: () => reduced,
  });
  const el = id => document.getElementById(id);
  return { visit, view, el, footState, locked, playback, series, getDate: () => date, at: () => at, dates };
}
const click = node => node.fire('click');
const tick = () => new Promise(r => setImmediate(r));
// The search of the best point pauses between rows (a macrotask each): wait until the card shows the result.
const until = async (t, ms = 2000) => { for (const t0 = Date.now(); t.el('visit-result').hidden && Date.now() - t0 < ms;) await new Promise(r => setTimeout(r, 5)); };
const goTo = (t, i) => click(t.el('visit-dots').children[i]);

test('E6.2 · «Sombras de kilómetros»: the time goes to the highest Sun, it goes down on foot looking away from the Sun, and the reveal says the figures', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  goTo(t, 1);
  click(t.el('visit-options').children[1]);
  click(t.el('visit-reveal'));
  await tick();
  assert.deepEqual(t.getDate(), { start: '2027-01-15', offsetDays: 77 / 24 });
  const enter = t.footState.calls.find(c => c[0] === 'enter');
  assert.deepEqual(enter[1].look, { yaw: 280, pitch: 0 }, 'azimuth of the Sun (100) + 180, at the horizon');
  const expected = shadowLengthKm(1, 0.8);
  assert.match(t.el('visit-verdict').textContent, /No era «Unos pocos kilómetros»: la respuesta es «Decenas de kilómetros»/);
  assert.ok(expected > 20 && expected < 100);
  assert.match(t.el('visit-explain').textContent, new RegExp(`${Math.round(expected)} km`.replace('.', ',')));
  assert.match(t.el('visit-explain').textContent, /0,8°/, 'the elevation of the series at that instant');
});

test('E6.2 · the expert level of the shadows teaches the formula with the example of 1.5° → 38.2 km, and the other levels do not', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  goTo(t, 1);
  click(t.el('visit-skip'));
  await tick();
  click(t.el('visit-levels').children[2]);
  assert.match(t.el('visit-explain').textContent, /L = h \/ tan\(elevación\)/);
  assert.match(t.el('visit-explain').textContent, /1,5°/);
  assert.match(t.el('visit-explain').textContent, /38,2 km/);
  click(t.el('visit-levels').children[0]);
  assert.doesNotMatch(t.el('visit-explain').textContent, /38,2/);
});

test('E6.2 · «Llamar a casa»: it looks at the Earth, runs the time at the top speed and stops where the relief hides it; the gaze follows', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  goTo(t, 2);
  click(t.el('visit-options').children[2]);
  click(t.el('visit-reveal'));
  await tick();
  assert.equal(t.getDate().offsetDays, 0, 'the first instant with the Earth in view');
  assert.deepEqual(t.footState.calls.find(c => c[0] === 'enter')[1].look, { yaw: 200, pitch: 3 });
  const [target, opts] = t.playback.runs[0];
  assert.ok(Math.abs(target * 24 - 99.5) < 1e-9);
  assert.equal(opts.speedIndex, SPEEDS.length - 1);
  // the timeline calls timeChanged at every frame: the gaze follows the Earth
  t.footState.calls.length = 0;
  t.visit.timeChanged();
  assert.deepEqual(t.footState.calls[0], ['look', 200, 3]);
  opts.onDone();
  t.footState.calls.length = 0;
  t.visit.timeChanged();
  assert.equal(t.footState.calls.length, 0, 'it stopped following');
  // the figures are those of periodMetrics: the Earth is in view 100 of 1441 samples
  const m = periodMetrics(t.series, START, 60);
  assert.match(t.el('visit-verdict').textContent, /No era «Siempre»: la respuesta es «Menos de la mitad del tiempo»/);
  assert.equal(m.earthTimeFraction, 100 / 1441);
  assert.match(t.el('visit-explain').textContent, /7 %/);
  assert.match(t.el('visit-explain').textContent, /sin Tierra a la vista no hay enlace directo/i);
});

test('E6.2 · with «reducir movimiento» the Earth chapter jumps to the end: no flight and no time running by itself', async () => {
  const t = setup({ reduced: true });
  click(t.el('visit-btn'));
  goTo(t, 2);
  click(t.el('visit-skip'));
  await tick();
  assert.equal(t.playback.runs.length, 0);
  assert.ok(Math.abs(t.getDate().offsetDays * 24 - 99.5) < 1e-9);
  assert.equal(t.footState.calls.find(c => c[0] === 'enter')[1].flight, false);
});

test('E6.2 · without a sample with the Sun in view, or with the Earth never in view, the chapter says so and reveals nothing', async () => {
  let t = setup({ series: make({ sunVis: () => 0 }) });
  click(t.el('visit-btn'));
  goTo(t, 1);
  click(t.el('visit-skip'));
  await tick();
  assert.equal(t.el('visit-note').textContent, UI.visit.noInstant);
  assert.equal(t.el('visit-result').hidden, true);
  t = setup({ series: make({ earthVis: () => 0 }) });
  click(t.el('visit-btn'));
  goTo(t, 2);
  click(t.el('visit-skip'));
  await tick();
  assert.equal(t.el('visit-note').textContent, UI.visit.noEarth);
  assert.equal(t.footState.calls.length, 0);
});

test('E6.2 · the foot chapters do not need the grid of masks', () => {
  const t = setup({ hasGrid: false, grid: null });
  click(t.el('visit-btn'));
  goTo(t, 1);
  assert.equal(t.el('visit-note').textContent, '');
  assert.equal(t.el('visit-skip').getAttribute('aria-disabled'), 'false');
  goTo(t, 3);
  assert.equal(t.el('visit-note').textContent, UI.visit.noGrid, '«Tú decides» says it and cannot check');
  assert.equal(t.el('visit-reveal').getAttribute('aria-disabled'), 'true');
});

test('E6.2 · «Tú decides»: «Comprobar» without bet, the flag is free before and locked after, and the reveal compares with the best point', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  assert.deepEqual(t.locked.at(-1), [UI.visit.locked, false]);
  goTo(t, 3);
  assert.deepEqual(t.locked.at(-1), [UI.visit.locked, true], 'the drag and the keyboard are free in this chapter only');
  assert.equal(t.el('visit-reveal').hidden, false);
  assert.equal(t.el('visit-reveal').textContent, UI.visit.check);
  assert.equal(t.el('visit-skip').hidden, true);
  assert.equal(t.el('visit-options').hidden, true);
  assert.equal(t.el('visit-note').textContent, UI.visit.moveHint);
  const grid = gridOf(shaded);
  t.view.moveFlag(0.2, 0); // the visitor moves it (inside the shaded block)
  click(t.el('visit-reveal'));
  await until(t);
  assert.deepEqual(t.at(), { x: 0.2, z: 0 }, 'the flag stays where the visitor put it');
  assert.deepEqual(t.locked.at(-1), [UI.visit.locked, false], 'the drag is locked at the reveal');
  assert.equal(t.el('visit-result').dataset.kind, 'none');
  assert.equal(t.el('visit-verdict').textContent, UI.visit.compared);
  const c = await compareWithBest(grid, t.series, START, 60, { x: 0.2, z: 0 });
  assert.match(t.el('visit-explain').textContent, new RegExp(`${String(Math.round(c.mine.score * 10) / 10).replace('.', ',')} puntos`));
  assert.equal(t.el('visit-to-best').hidden, false);
  click(t.el('visit-to-best'));
  await tick();
  assert.deepEqual(t.at(), { x: c.best.x, z: c.best.z });
});

test('E6.2 · «Tú decides» at the best point says so and offers no trip; it is the last chapter: «Siguiente» is not available', async () => {
  const t = setup();
  const best = await findBestPoint(gridOf(shaded), t.series, periodSamples(t.series, START, 60), { x: 0, z: 0 });
  click(t.el('visit-btn'));
  goTo(t, 3);
  t.view.moveFlag(best.x, best.z);
  click(t.el('visit-reveal'));
  await until(t);
  assert.match(t.el('visit-explain').textContent, /mejor de la zona/);
  assert.equal(t.el('visit-to-best').hidden, true);
  assert.equal(t.el('visit-next').getAttribute('aria-disabled'), 'true');
});

test('E6.2 · leaving each chapter restores the view, the time and the flag (no WebGL)', async () => {
  for (const [index, reveal] of [[1, 'visit-skip'], [2, 'visit-skip'], [3, 'visit-reveal']]) {
    const t = setup({ start: { x: -0.4, z: 0.2 } });
    click(t.el('visit-btn'));
    goTo(t, index);
    t.view.moveFlag(0.1, 0.1);
    click(t.el(reveal));
    await until(t);
    if (index === 1) assert.equal(t.playback.playing, false, 'the time does not run on by itself inside the shadows chapter');
    click(t.el('visit-exit'));
    assert.deepEqual(t.at(), { x: -0.4, z: 0.2 }, `chapter ${index}: the flag`);
    assert.deepEqual(t.getDate(), { start: '2026-12-01', offsetDays: 3 }, `chapter ${index}: the date`);
    assert.deepEqual({ playing: t.playback.playing, speedIndex: t.playback.speedIndex }, { playing: true, speedIndex: 0 }, `chapter ${index}: the playback`);
    assert.equal(t.footState.active, false, `chapter ${index}: back up to the drone`);
  }
});

test('E6.2 · changing from a foot chapter to a drone one goes back up and restores the time; the visitor who was on foot stays on foot', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  goTo(t, 2);
  click(t.el('visit-skip'));
  await tick();
  assert.equal(t.footState.active, true);
  goTo(t, 3);
  assert.equal(t.footState.active, false);
  assert.deepEqual(t.getDate(), { start: '2027-01-15', offsetDays: 0 });
  assert.equal(t.playback.playing, false, 'paused inside the chapter');
  click(t.el('visit-exit'));
  assert.equal(t.playback.playing, true, 'the visitor playback comes back on exit');
  // who was on foot when opening stays on foot
  const s = setup({ foot: true });
  click(s.el('visit-btn'));
  goTo(s, 1);
  click(s.el('visit-skip'));
  await tick();
  click(s.el('visit-exit'));
  assert.equal(s.footState.active, true);
  assert.ok(!s.footState.calls.some(c => c[0] === 'exit'));
});

test('E6.2 · leaving a chapter while the flight down is still running goes back up when it lands', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  goTo(t, 2);
  click(t.el('visit-skip'));
  await tick();
  // the flight is under way: the scene is not on foot yet
  t.footState.active = false; t.footState.flying = true;
  click(t.el('visit-exit'));
  assert.ok(!t.footState.calls.some(c => c[0] === 'exit'), 'nothing to exit yet');
  t.footState.active = true; t.footState.flying = false; // it lands
  t.footState.listeners.forEach(f => f('foot'));
  assert.equal(t.footState.active, false, 'it went back up on landing');
});

test('E6.2 · the Earth run starts when the visitor lands, not during the flight down', async () => {
  const t = setup();
  // an `enter` that flies: it lands later
  t.view.foot.enter = o => { t.footState.calls.push(['enter', o]); t.footState.flying = true; if (o.look) t.footState.look = o.look; };
  click(t.el('visit-btn'));
  goTo(t, 2);
  click(t.el('visit-skip'));
  await tick();
  assert.equal(t.playback.runs.length, 0, 'the time does not run while it flies');
  t.footState.active = true; t.footState.flying = false; // it lands
  t.footState.listeners.forEach(f => f('foot'));
  assert.equal(t.playback.runs.length, 1, 'it runs once on foot');
  t.footState.calls.length = 0;
  t.visit.timeChanged();
  assert.ok(t.footState.calls.some(c => c[0] === 'look'), 'and the gaze follows');
});

test('E6.2 · cancelling the run from outside the visit stops the gaze from following the Earth', async () => {
  const t = setup();
  click(t.el('visit-btn'));
  goTo(t, 2);
  click(t.el('visit-skip'));
  await tick();
  t.playback.runs[0][1].onCancel();
  t.footState.calls.length = 0;
  t.visit.timeChanged();
  assert.equal(t.footState.calls.length, 0, 'the visitor looks where they want');
});
