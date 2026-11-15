// E6.1 · The guided visit: the engine, the chapters as data, the point of «Mueve la bandera», the figures of the reveal and the texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMaskGrid, expectedMaskBytes, maskAt } from '../src/core/mask-grid.js';
import { periodSamples } from '../src/core/best-point.js';
import { seriesOverMask } from '../src/core/flag-drag.js';
import { periodMetrics } from '../src/core/sky-state.js';
import { pickContrastPoint, revealFigures, metricsAt, SEARCH_RADIUS_KM } from '../src/core/visit-point.js';
import { LEVELS, rightOption, startVisit, chapterOf, bet, reveal, previous, next, chapterAt, setLevel, exit, outcome, flagTarget, parseLevel, DEFAULT_LEVEL } from '../src/core/visit.js';
import { CHAPTERS, chaptersFor } from '../src/visit-chapters.js';
import { TEXTS, texts } from '../src/texts.js';
import { seriesEnd } from '../src/core/series.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = { x: 0.1, z: -0.2 };
const option = (id, from = 0) => ({ id, from });
const chapter = (id, extra = {}) => ({ id, region: 'test', start: '2027-01-15', view: 'drone', minDifference: 0.05, options: [option('a', 0.05), option('b', 0.1), option('c', 0.3)], action: { type: 'move-flag-to-contrast', radiusKm: 0.5 }, ...extra });

// ---- the engine ----
test('E6.1 · the visit opens at the question of the first chapter, with the level and the origin', () => {
  const s = startVisit([chapter('one'), chapter('two')], { level: 'expert', origin });
  assert.deepEqual([s.active, s.index, s.phase, s.choice, s.level], [true, 0, 'question', null, 'expert']);
  assert.deepEqual(s.origin, origin);
  assert.equal(startVisit([chapter('one')], { origin, level: 'nope' }).level, DEFAULT_LEVEL);
  assert.throws(() => startVisit([], { origin }), RangeError);
});

test('E6.1 · question → bet → revealed, and the outcome follows the measured difference', () => {
  let s = startVisit([chapter('one')], { origin });
  s = bet(s, 1);
  assert.deepEqual([s.phase, s.choice], ['bet', 1]);
  assert.equal(outcome(s, 0.5), 'none'); // not revealed yet
  s = bet(s, 2); // the bet can still change before the reveal
  assert.equal(s.choice, 2);
  s = reveal(s);
  assert.equal(s.phase, 'revealed');
  assert.equal(outcome(s, 0.5), 'correct');
  assert.equal(outcome(s, 0.2), 'wrong');
  assert.equal(bet(s, 1), s, 'no betting once revealed');
  assert.equal(bet(startVisit([chapter('one')], { origin }), 7).phase, 'question', 'an option that does not exist is not a bet');
});

test('E6.1 · the right option is the one whose threshold the measured difference reaches (below and above each threshold)', () => {
  const c = chapter('one');
  const right = d => rightOption(c, d);
  assert.equal(right(0.04), -1, 'below the first threshold: none');
  assert.equal(right(0.05), 0);
  assert.equal(right(0.099), 0);
  assert.equal(right(0.1), 1);
  assert.equal(right(0.299), 1);
  assert.equal(right(0.3), 2);
  assert.equal(right(-0.6), 2, 'the sign does not matter');
  const at = (choice, d) => outcome(reveal(bet(startVisit([c], { origin }), choice)), d);
  assert.deepEqual([at(0, 0.07), at(1, 0.07), at(1, 0.15), at(2, 0.15), at(2, 0.35), at(1, 0.35)], ['correct', 'wrong', 'correct', 'wrong', 'correct', 'wrong']);
  assert.equal(at(2, 0.01), 'none', 'no point reaches the minimum: the bet is not graded');
  assert.equal(at(2, undefined), 'none');
});

test('E6.1 · «Enséñamelo sin apostar» reveals with no choice', () => {
  const s = reveal(startVisit([chapter('one')], { origin }));
  assert.deepEqual([s.phase, s.choice, outcome(s)], ['revealed', null, 'none']);
});

test('E6.1 · without what the chapter needs it cannot be revealed', () => {
  const s = startVisit([chapter('one')], { origin });
  assert.equal(reveal(s, { available: false }), s);
  const bt = bet(s, 0);
  assert.equal(reveal(bt, { available: false }), bt);
});

test('E6.1 · previous and next change the chapter, start again at the question and stop at the ends', () => {
  const chapters = [chapter('one'), chapter('two'), chapter('three')];
  let s = bet(startVisit(chapters, { origin }), 0);
  assert.equal(previous(s), s);
  s = next(s);
  assert.deepEqual([s.index, s.phase, s.choice], [1, 'question', null]);
  s = next(reveal(s));
  assert.deepEqual([s.index, s.phase], [2, 'question']);
  assert.equal(next(s), s);
  assert.equal(previous(s).index, 1);
  assert.equal(chapterAt(s, 0).index, 0);
  assert.equal(chapterAt(s, 9), s);
});

test('E6.1 · the level changes only the level', () => {
  const s = bet(startVisit([chapter('one')], { origin }), 1);
  const t = setLevel(s, 'beginner');
  assert.deepEqual([t.level, t.phase, t.choice], ['beginner', 'bet', 1]);
  assert.equal(setLevel(s, 'wizard'), s);
  assert.equal(parseLevel('expert'), 'expert');
  assert.equal(parseLevel(null), DEFAULT_LEVEL);
});

test('E6.1 · the flag is at the destination only while revealed; exiting or changing chapter restores the origin', () => {
  const dest = { x: 0.3, z: 0.3 };
  let s = startVisit([chapter('one'), chapter('two')], { origin });
  assert.deepEqual(flagTarget(s, dest), origin);
  s = reveal(bet(s, 1));
  assert.deepEqual(flagTarget(s, dest), dest);
  assert.deepEqual(flagTarget(s, null), origin, 'no destination: the origin');
  assert.deepEqual(flagTarget(next(s), dest), origin);
  const out = exit(s);
  assert.equal(out.active, false);
  assert.deepEqual(flagTarget(out, dest), origin);
  assert.equal(bet(out, 0), out, 'an exited visit takes no more transitions');
  assert.equal(next(out), out);
});

test('E6.1 · adding a test chapter to the data is enough for the engine to go through it', () => {
  const chapters = [...CHAPTERS, chapter('only-in-this-test', { options: [option('x', 0.05), option('y', 0.5)] })];
  let s = startVisit(chapters, { origin });
  const seen = [];
  for (;;) {
    seen.push(chapterOf(s).id);
    s = reveal(bet(s, 0));
    if (s.index === chapters.length - 1) break;
    s = next(s);
  }
  assert.deepEqual(seen, [...CHAPTERS.map(c => c.id), 'only-in-this-test']);
  assert.equal(outcome(s, 0.2), 'correct');
  assert.deepEqual(chaptersFor('test', [chapter('x'), chapter('y', { region: 'other' })]).map(c => c.id), ['x']);
});

// ---- the chapters as data ----
test('E6.1 · every chapter is well formed: thresholds per option, a start inside the series and a region with a grid', () => {
  assert.ok(CHAPTERS.length >= 1);
  assert.equal(new Set(CHAPTERS.map(c => c.id)).size, CHAPTERS.length);
  for (const c of CHAPTERS) {
    assert.ok(c.options.every(o => Number.isFinite(o.from)), c.id);
    assert.ok(['drone', 'foot'].includes(c.view), c.id);
    if (c.options.length && (c.measure ?? 'sun-difference') === 'sun-difference') {
      assert.ok(Number.isFinite(c.minDifference), c.id);
      assert.ok(c.options.some(o => o.from <= c.minDifference), `${c.id}: some option has to be reachable at the minimum`);
    }
    if (c.options.length) assert.equal(rightOption(c, Infinity), c.options.indexOf(c.options.reduce((a, b) => (b.from > a.from ? b : a))), `${c.id}: the highest option is reachable`);
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', c.region, 'meta.json'), 'utf8'));
    assert.ok(meta.maskGrid, `${c.region} has no grid of masks`);
    const series = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', c.region, 'series-2027.json'), 'utf8'));
    const start = new Date(`${c.start}T00:00:00Z`), end = new Date(start.getTime() + 60 * 864e5);
    assert.ok(start >= new Date(series.start) && end <= seriesEnd(series), `${c.id}: the 60 days do not fit in the series`);
  }
});

// ---- the point of the chapter, on a synthetic grid ----
const META = { file: 'masks.bin', extentKm: 2, stepKm: 0.1, cols: 21, rows: 21, azimuths: 4, encoding: 'int16-le', observerHeightM: 2, demVersion: 'test' };
function gridOf(horizon) { // horizon(x, z) in degrees (km from the centre), the same at every azimuth
  const buf = new Uint8Array(expectedMaskBytes(META));
  const view = new DataView(buf.buffer);
  for (let row = 0; row < META.rows; row++) for (let col = 0; col < META.cols; col++) {
    const h = horizon(col * META.stepKm - META.extentKm / 2, row * META.stepKm - META.extentKm / 2);
    for (let k = 0; k < 4; k++) view.setInt16(((row * META.cols + col) * 4 + k) * 2, Math.round(h * 100), true);
  }
  return decodeMaskGrid(META, buf);
}
const N = 24 * 4 + 1; // 4 days
// the Sun skims at 2° over the horizon: a horizon of 5° hides it, of 0° leaves it
const flat = (el, fraction) => ({ az: Array(N).fill(90), el: Array(N).fill(el), visibleFraction: Array(N).fill(fraction) });
const series = { start: '2027-01-15T00:00:00Z', stepMinutes: 60, count: N, sun: flat(2, 1), earth: flat(2, 1) };
const start = new Date('2027-01-15T00:00:00Z'), DAYS = 4;
const period = periodSamples(series, start, DAYS);

test('E6.1 · the point is the one of the grid with the greatest difference of light, inside the radius', () => {
  // The flag is at (0, 0), lit. A dark spot 300 m away (horizon 20°) and a darker-looking but farther one (700 m) that must not count.
  const grid = gridOf((x, z) => (Math.abs(x - 0.3) < 0.05 && Math.abs(z) < 0.05 ? 20 : Math.abs(x - 0.7) < 0.05 && Math.abs(z) < 0.05 ? 20 : -5));
  const p = pickContrastPoint(grid, series, period, { x: 0, z: 0 });
  assert.ok(Math.abs(p.x - 0.3) < 1e-9 && Math.abs(p.z) < 1e-9, `(${p.x}, ${p.z})`);
  assert.ok(Math.abs(p.distanceKm - 0.3) < 1e-9);
  assert.ok(p.difference < -0.99);
  assert.ok(p.distanceKm <= SEARCH_RADIUS_KM);
});

test('E6.1 · from a dark flag the point is the lit one; on a tie the nearest wins; the radius is respected', () => {
  const lit = gridOf((x, z) => (Math.hypot(x - 0.2, z) < 0.05 || Math.hypot(x + 0.4, z) < 0.05 ? -5 : 20));
  const p = pickContrastPoint(lit, series, period, { x: 0, z: 0 });
  assert.ok(Math.abs(p.x - 0.2) < 1e-9, 'two lit points at 200 and 400 m: the nearest');
  assert.ok(p.difference > 0.99);
  const far = gridOf((x, z) => (Math.hypot(x - 0.9, z) < 0.05 ? -5 : 20));
  assert.equal(pickContrastPoint(far, series, period, { x: 0, z: 0 }), null, 'the only lit point is out of the radius');
  assert.ok(pickContrastPoint(far, series, period, { x: 0, z: 0 }, { radiusKm: 1 }));
});

test('E6.1 · where the light is the same everywhere there is no point to show', () => {
  assert.equal(pickContrastPoint(gridOf(() => 20), series, period, { x: 0, z: 0 }), null);
  assert.equal(pickContrastPoint(gridOf(() => -5), series, period, { x: 0, z: 0 }), null);
});

test('E6.1 · the point of the chapter on the real grid of shackleton-rim is near and clearly different', () => {
  const dir = path.join(ROOT, 'data', 'shackleton-rim');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const grid = decodeMaskGrid(meta, fs.readFileSync(path.join(dir, 'masks.bin')));
  const real = JSON.parse(fs.readFileSync(path.join(dir, 'series-2027.json'), 'utf8'));
  const c = CHAPTERS[0], from = { x: 0, z: 0 };
  const p = pickContrastPoint(grid, real, periodSamples(real, new Date(`${c.start}T00:00:00Z`), 60), from, { radiusKm: c.action.radiusKm });
  assert.ok(p, 'the chapter has a point');
  assert.ok(p.distanceKm <= 0.5 && Math.abs(p.difference) >= 0.1);
});

// ---- the figures of the reveal ----
test('E6.1 · the figures of the reveal are those of periodMetrics at the point before and after', () => {
  const grid = gridOf((x, z) => (x > 0.15 ? 20 : -5));
  const from = { x: 0, z: 0 }, to = { x: 0.3, z: 0.1 };
  const f = revealFigures(grid, series, start, DAYS, from, to);
  assert.deepEqual(f.before, periodMetrics(seriesOverMask(series, maskAt(grid, from.x, from.z)), start, DAYS));
  assert.deepEqual(f.after, periodMetrics(seriesOverMask(series, maskAt(grid, to.x, to.z)), start, DAYS));
  assert.deepEqual(f.after, metricsAt(grid, series, start, DAYS, to.x, to.z));
  assert.equal(f.before.sunTimeFraction, 1);
  assert.equal(f.after.sunTimeFraction, 0);
  assert.ok(Math.abs(f.distanceM - Math.hypot(0.3, 0.1) * 1000) < 1e-9);
});

// ---- the texts ----
// The figures come in already formatted: a proxy hands every key back as «‹key›», so a text that needs a figure shows it and none is typed.
const figuresOf = (isBest = false) => new Proxy({}, { get: (_, key) => (key === 'isBest' ? isBest : `‹${String(key)}›`) });
// What every level of the reveal of a chapter has to say (E6.2 generalises the figures of the first chapter).
const SHOWS = { 'move-the-flag': ['sunBefore', 'sunAfter', 'distance'], 'long-shadows': ['elevation', 'length'], 'call-home': ['earthShare'], 'you-decide': ['mineScore'] };

for (const lang of ['es', 'en']) {
  test(`E6.1 · [${lang}] every chapter has its title, options and, in the three levels, question and reveal`, () => {
    const V = texts(lang).visit;
    for (const c of CHAPTERS) {
      const t = V.chapters[c.id];
      assert.ok(t, `no texts for ${c.id}`);
      assert.ok(t.title);
      for (const o of c.options) assert.ok(t.options[o.id], `${c.id}.${o.id}`);
      assert.deepEqual(Object.keys(t.options).sort(), c.options.map(o => o.id).sort(), `${c.id}: the options of the texts are those of the chapter`);
      for (const level of LEVELS) {
        assert.ok(t.question[level], `${c.id} question ${level}`);
        for (const isBest of [false, true]) {
          const reveal = t.reveal[level](figuresOf(isBest));
          assert.ok(reveal, `${c.id} reveal ${level}`);
          for (const key of SHOWS[c.id]) assert.ok(reveal.includes(`‹${key}›`), `${c.id} ${level}: ‹${key}› missing`);
        }
        if (c.action.type === 'move-flag-to-contrast') assert.match(t.reveal[level](figuresOf()), lang === 'es' ? /Ningún punto del polo sur tiene luz siempre/ : /No point at the south pole has light all the time/);
      }
      assert.deepEqual(Object.keys(t.question).sort(), [...LEVELS].sort());
      assert.deepEqual(Object.keys(t.reveal).sort(), [...LEVELS].sort());
    }
    for (const level of LEVELS) assert.ok(V.levels[level]);
  });

  test(`E6.1 · [${lang}] no figure is written by hand: reveals and options carry no digit, questions no percentage or distance`, () => {
    const V = texts(lang).visit;
    for (const t of Object.values(V.chapters)) {
      for (const s of [...Object.values(t.options), ...Object.values(t.reveal).flatMap(r => [r(figuresOf(false)), r(figuresOf(true))])]) assert.doesNotMatch(s, /\d/, s);
      for (const s of Object.values(t.question)) assert.doesNotMatch(s, /\d+\s?(%|m\b|km)/, s); // «60 días» is the period, not a figure of the answer
    }
  });
}

test('E6.1 · the texts of the visit have the same keys in Spanish and English', () => {
  const keys = o => (o && typeof o === 'object' ? Object.keys(o).sort().map(k => `${k}:${keys(o[k])}`).join(',') : typeof o);
  assert.equal(keys(texts('en').visit), keys(TEXTS.visit));
});
