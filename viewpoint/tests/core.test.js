// Pure core of the tour screen (viewpoint/src/core): azimuth/elevation to vector, and sampling of the real series.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirAzEl } from '../src/core/direction.js';
import { sampleAt, seriesEnd, formatDeg } from '../src/core/series.js';
import { dateTime } from '../../shared/format/time.js';
import { WINDOW_DAYS, SPEEDS, START_MIN, START_MAX, parseDay, clampStart, isStartInRange, startFromSearch, dayLabel, instantAt, advance, nextSpeedIndex } from '../src/core/timeline.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const series = JSON.parse(fs.readFileSync(path.join(ROOT, 'viewpoint/data/shackleton-rim/series-2027.json'), 'utf8'));
const near = (v, w) => assert.ok(Math.abs(v - w) < 1e-9, `${v} ≠ ${w}`);
const assertDir = (d, x, y, z) => { near(d.x, x); near(d.y, y); near(d.z, z); };

test('dirAzEl: azimuth 0° points to -z, 90° to +x, 180° to +z, 270° to -x', () => {
  assertDir(dirAzEl(0, 0), 0, 0, -1);
  assertDir(dirAzEl(90, 0), 1, 0, 0);
  assertDir(dirAzEl(180, 0), 0, 0, 1);
  assertDir(dirAzEl(270, 0), -1, 0, 0);
});

test('dirAzEl: elevation 90° points to +y whatever the azimuth', () => {
  assertDir(dirAzEl(0, 90), 0, 1, 0);
  assertDir(dirAzEl(123, 90), 0, 1, 0);
});

test('dirAzEl: returns a unit vector', () => {
  const d = dirAzEl(229.6, 0.39);
  near(Math.hypot(d.x, d.y, d.z), 1);
});

test('sampleAt: the fixed date gives the Sun of the API example (0.38° and 229.7°)', () => {
  const { sun } = sampleAt(series, new Date('2027-01-15T00:00:00Z'));
  assert.equal(sun.el.toFixed(2), '0.38');
  assert.equal(sun.az.toFixed(1), '229.7');
});

test('sampleAt: the first and the last hour of the series exist, the next ones do not', () => {
  assert.ok(sampleAt(series, new Date(series.start)).earth);
  const last = new Date(Date.parse(series.start) + (series.count - 1) * 3600000);
  assert.ok(sampleAt(series, last).sun);
  assert.throws(() => sampleAt(series, new Date(last.getTime() + 3600000)), RangeError);
  assert.throws(() => sampleAt(series, new Date(Date.parse(series.start) - 3600000)), RangeError);
});

const HOUR = 3600000;
const startMs = Date.parse(series.start);

test('sampleAt: at every exact hour it returns the series value', () => {
  for (const i of [0, 1, 359, 360, 4000, series.count - 2, series.count - 1]) {
    const { sun, earth } = sampleAt(series, new Date(startMs + i * HOUR));
    near(sun.az, series.sun.az[i]);
    near(sun.el, series.sun.el[i]);
    near(earth.az, series.earth.az[i]);
    near(earth.el, series.earth.el[i]);
  }
});

test('sampleAt: between two hours it lies between them (midpoint of a non-wrapping pair)', () => {
  const i = 100;
  const { sun } = sampleAt(series, new Date(startMs + i * HOUR + HOUR / 2));
  near(sun.el, (series.sun.el[i] + series.sun.el[i + 1]) / 2);
  near(sun.az, (series.sun.az[i] + series.sun.az[i + 1]) / 2);
});

test('sampleAt: the azimuth is continuous across 360° → 0° (short way round)', () => {
  const wrap = { start: '2027-01-01T00:00:00.000Z', stepMinutes: 60, count: 3,
    sun: { az: [359, 1, 1], el: [0, 0, 0] }, earth: { az: [10, 350, 350], el: [0, 0, 0] } };
  near(sampleAt(wrap, new Date(startMs + HOUR / 2)).sun.az, 0);
  near(sampleAt(wrap, new Date(startMs + HOUR / 4)).sun.az, 359.5);
  near(sampleAt(wrap, new Date(startMs + HOUR / 2)).earth.az, 0);
  const real = series.sun.az.findIndex((v, i) => i > 0 && Math.abs(v - series.sun.az[i - 1]) > 180);
  if (real > 0) { // the real series also wraps somewhere: no sample may jump
    let prev = sampleAt(series, new Date(startMs + (real - 1) * HOUR)).sun.az;
    for (let k = 1; k <= 60; k++) {
      const az = sampleAt(series, new Date(startMs + (real - 1) * HOUR + k * HOUR / 30)).sun.az;
      assert.ok(Math.min(Math.abs(az - prev), 360 - Math.abs(az - prev)) < 1, `jump ${prev} → ${az}`);
      prev = az;
    }
  }
});

test('sampleAt: rejects instants outside the series, and seriesEnd is the last hour', () => {
  assert.equal(seriesEnd(series).getTime(), startMs + (series.count - 1) * HOUR);
  assert.throws(() => sampleAt(series, new Date(seriesEnd(series).getTime() + 1)), RangeError);
  assert.throws(() => sampleAt(series, new Date(startMs - 1)), RangeError);
  assert.throws(() => sampleAt(series, new Date(NaN)), RangeError);
});

test('timeline: a start date is limited to the precomputed range and the 60-day window fits in the series', () => {
  assert.equal(clampStart('2026-12-31'), START_MIN);
  assert.equal(clampStart('2028-01-01'), START_MAX);
  assert.equal(clampStart('2027-06-15'), '2027-06-15');
  assert.equal(clampStart(''), START_MIN);
  assert.equal(parseDay('2027-02-30'), null);
  assert.ok(instantAt(START_MAX, WINDOW_DAYS) <= seriesEnd(series));
  assert.ok(sampleAt(series, instantAt(START_MAX, WINDOW_DAYS)).sun);
  assert.equal(instantAt(START_MIN, 0).toISOString(), series.start);
});

test('timeline: speed 1 advances one day per second; speeds cycle; the window wraps', () => {
  assert.deepEqual(SPEEDS, [0.25, 1, 4]);
  near(advance(0, 1, 1), 1);
  near(advance(10, 0.5, 4), 12);
  near(advance(10, 4, 0.25), 11);
  near(advance(59.5, 1, 1), 0.5);
  assert.equal(nextSpeedIndex(0), 1);
  assert.equal(nextSpeedIndex(SPEEDS.length - 1), 0);
});

test('dayLabel: day 1 at the start, day 60 at the far end of the slider, never 61', () => {
  assert.equal(dayLabel(0), 1);
  assert.equal(dayLabel(59.99), 60);
  assert.equal(dayLabel(WINDOW_DAYS), 60);
});

test('isStartInRange: accepts only real dates inside the precomputed range', () => {
  assert.equal(isStartInRange(START_MIN), true);
  assert.equal(isStartInRange(START_MAX), true);
  assert.equal(isStartInRange('0002-01-15'), false);
  assert.equal(isStartInRange('2027-11-02'), false);
  assert.equal(isStartInRange(''), false);
});

test('formatDeg and the shared dateTime: es-ES format', () => {
  assert.equal(formatDeg(0.3888), '0,39°');
  assert.equal(formatDeg(229.5968), '229,6°');
  assert.equal(dateTime('es', new Date('2027-01-15T00:00:00Z')), '15 ene 2027 · 00:00 UTC');
  assert.equal(formatDeg(-0.3888), '−0,39°');
});

const IMPORT_RE = /(?:from\s+|import\s*\(?\s*)['"]([^'"]+)['"]/g;
const FORBIDDEN_RE = /astronomy-engine|\/data\/|\/backend\//;

test('the import guard catches every way of writing an import', () => {
  const cases = [
    "import x from 'astronomy-engine';",
    'import x from "astronomy-engine";',
    "import 'astronomy-engine';",
    "const m = await import('astronomy-engine');",
    'import "../../data/src/x.js";',
  ];
  for (const src of cases) {
    const found = [...src.matchAll(IMPORT_RE)].map(m => m[1]);
    assert.equal(found.length, 1, src);
    assert.ok(FORBIDDEN_RE.test(found[0]), src);
  }
});

test('the tour client imports no ephemeris library nor anything from data/ or backend/', () => {
  const dir = path.join(ROOT, 'viewpoint/src');
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.js'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      assert.ok(!FORBIDDEN_RE.test(m[1]), `${f} imports ${m[1]}`);
    }
  }
});

test('startFromSearch: a valid ?start= is kept, anything else opens the fallback', () => {
  assert.equal(startFromSearch('?start=2027-03-02', 'X'), '2027-03-02');
  assert.equal(startFromSearch('?start=1999-01-01', 'X'), 'X');
  assert.equal(startFromSearch('?start=abc', 'X'), 'X');
  assert.equal(startFromSearch('?start=', 'X'), 'X');
  assert.equal(startFromSearch('', 'X'), 'X');
});
