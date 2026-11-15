// Light and Earth at the flag (E1, #121): state, ring, period metrics and next set, against the series and the engine.
// The engine (backend/src) is only imported here, to check parity: the client never imports it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fractionAt, sunState, earthState, nextChange, periodMetrics } from '../src/core/sky-state.js';
import { RING, radiusFor, ringPoint, profilePoints, profilePath, trailPaths, wedgePath } from '../src/core/horizon-ring.js';
import { sampleAt } from '../src/core/series.js';
import { loadCatalogMasks } from '../../backend/src/horizon.ts';
import { getSite } from '../../backend/src/sites.ts';
import { evaluatePeriod, sunEarth, visibilityWindows, SCORE_WEIGHTS } from '../../backend/src/useCases.ts';
import { sampleVectors } from '../../backend/src/service.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const seriesOf = id => read(`viewpoint/data/${id}/series-2027.json`);
const maskOf = id => read(`viewpoint/data/${id}/mask.json`);
const shackleton = seriesOf('shackleton-rim');
const mouton = seriesOf('im2-objetivo');
const DAY_MS = 864e5;
const HOUR_MS = 36e5;
const at = iso => new Date(iso);
const indexOf = (series, iso) => (Date.parse(iso) - Date.parse(series.start)) / HOUR_MS;

// The engine turns the terrain off under `node --test`: load the catalogue masks explicitly, as the pipeline does.
loadCatalogMasks(path.join(ROOT, 'backend/terrain'), 2);
const TERRAIN = { enabled: true, resolution: 'precise' };

// ---- E1.1: the state of the Sun and the ring ----

test('E1.1 · the state of the Sun at three instants of 2027 is the one of sun.visibleFraction', () => {
  const cases = [
    ['2027-02-11T16:00:00Z', 'visible'], // fraction 1 (with the Sun at −0,18°: the horizon there is lower)
    ['2027-02-16T15:00:00Z', 'partial'], // fraction 0,77
    ['2027-03-17T13:00:00Z', 'hidden'], // fraction 0
  ];
  for (const [iso, state] of cases) {
    const fraction = shackleton.sun.visibleFraction[indexOf(shackleton, iso)];
    assert.equal(fractionAt(shackleton, 'sun', at(iso)), fraction, iso);
    assert.equal(sunState(fractionAt(shackleton, 'sun', at(iso))), state, iso);
  }
});

test('E1.1 · thresholds of the Sun: ≥ 0,99 in view, > 0 half, 0 hidden', () => {
  assert.equal(sunState(1), 'visible');
  assert.equal(sunState(0.99), 'visible');
  assert.equal(sunState(0.989), 'partial');
  assert.equal(sunState(0.001), 'partial');
  assert.equal(sunState(0), 'hidden');
});

test('E1.1 · between two samples the fraction is linear', () => {
  const i = indexOf(shackleton, '2027-02-16T15:00:00Z');
  const v = shackleton.sun.visibleFraction;
  const half = fractionAt(shackleton, 'sun', at('2027-02-16T15:30:00Z'));
  assert.ok(Math.abs(half - (v[i] + v[i + 1]) / 2) < 1e-12);
});

for (const id of ['shackleton-rim', 'im2-objetivo']) {
  test(`E1.1 · ${id}: the drawn profile is the region mask, 720 azimuths, not resampled`, () => {
    const mask = maskOf(id);
    const points = profilePoints(mask);
    assert.equal(points.length, 720);
    for (const k of [0, 1, 179, 360, 719]) {
      const p = ringPoint(k * mask.stepDeg, mask.el[k]);
      assert.deepEqual(points[k], p);
    }
    assert.equal((profilePath(mask).match(/[ML]/g) || []).length, 720);
  });
}

test('E1.1 · the ring: north up, east right; higher means closer to the centre', () => {
  const c = RING.centre;
  const n = ringPoint(0, 0), e = ringPoint(90, 0), s = ringPoint(180, 0), w = ringPoint(270, 0);
  assert.ok(Math.abs(n.x - c) < 1e-9 && n.y < c);
  assert.ok(e.x > c && Math.abs(e.y - c) < 1e-9);
  assert.ok(Math.abs(s.x - c) < 1e-9 && s.y > c);
  assert.ok(w.x < c);
  assert.equal(radiusFor(0), RING.horizonR);
  assert.ok(radiusFor(1) < radiusFor(0) && radiusFor(0) < radiusFor(-1));
  assert.equal(radiusFor(90), RING.minR);
  assert.equal(radiusFor(-90), RING.maxR);
});

test('E1.1 · the trail splits the dots where the body is seen and where it is not', () => {
  const { seen, hidden } = trailPaths(shackleton, 'sun', at('2027-03-01T00:00:00Z'), 60);
  const dots = s => (s.match(/h0/g) || []).length;
  assert.equal(dots(seen) + dots(hidden), 60 * 12 + 1);
  assert.ok(dots(seen) > 0 && dots(hidden) > 0);
});

test('E1.1 · the camera wedge is a closed sector', () => {
  assert.match(wedgePath(45, 30), /^M100 100L[\d.]+ [\d.]+A94 94 0 0 1 [\d.]+ [\d.]+Z$/);
  assert.match(wedgePath(45, 120), /A94 94 0 1 1/);
});

// ---- E1.2: the Earth ----

test('E1.2 · the Earth at three instants of 2027: position and state from the series', () => {
  const cases = [['2027-02-11T16:00:00Z', 'visible'], ['2027-02-20T22:00:00Z', 'hidden'], ['2027-07-01T12:00:00Z', null]];
  for (const [iso, expected] of cases) {
    const i = indexOf(shackleton, iso);
    const fraction = shackleton.earth.visibleFraction[i];
    const state = earthState(fractionAt(shackleton, 'earth', at(iso)));
    assert.equal(state, fraction > 0 ? 'visible' : 'hidden', iso);
    if (expected) assert.equal(state, expected, iso);
    const { earth } = sampleAt(shackleton, at(iso));
    assert.ok(Math.abs(earth.az - shackleton.earth.az[i]) < 1e-9 && Math.abs(earth.el - shackleton.earth.el[i]) < 1e-9, iso);
  }
});

test('E1.2 · in 60 days the Earth sways by the libration, it is not a fixed point', () => {
  const i0 = indexOf(shackleton, '2027-03-01T00:00:00Z');
  const az = shackleton.earth.az.slice(i0, i0 + 1441), el = shackleton.earth.el.slice(i0, i0 + 1441);
  assert.ok(Math.max(...az) - Math.min(...az) > 5, 'azimut');
  assert.ok(Math.max(...el) - Math.min(...el) > 5, 'elevación');
  // And on the ring it covers more than a few pixels.
  const points = az.map((a, k) => ringPoint(a, el[k]));
  const spread = Math.hypot(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)));
  assert.ok(spread > 20, `${spread}`);
});

// ---- E1.3: the bars of the period ----

/** Longest gap between the windows of a body inside [start, end], in hours (windows of the API use case). */
function longestGapHours(windows, startMs, endMs) {
  let cursor = startMs, max = 0;
  for (const w of windows) {
    max = Math.max(max, Date.parse(w.start) - cursor);
    cursor = Date.parse(w.end);
  }
  return Math.max(max, endMs - cursor) / HOUR_MS;
}

test('E1.3 · parity with the windows use case of the engine with terrain (shackleton-rim, 60 days of 2027)', () => {
  const startMs = Date.parse('2027-03-01T00:00:00Z'), endMs = startMs + 60 * DAY_MS;
  const m = periodMetrics(shackleton, new Date(startMs), 60);
  const site = getSite('shackleton-rim');
  const { windows: w, horizonModel } = visibilityWindows({ site, startMs, endMs, terrain: TERRAIN, night: {} });
  assert.equal(horizonModel, 'mask');
  // One-hour samples against the engine's own: each change can move up to one step.
  const fractionTol = 0.005, hoursTol = 1;
  assert.ok(Math.abs(m.sunTimeFraction - w.sun.fractionOfTime) <= fractionTol, `sol ${m.sunTimeFraction} ≠ ${w.sun.fractionOfTime}`);
  assert.ok(Math.abs(m.earthTimeFraction - w.earth.fractionOfTime) <= fractionTol, `tierra ${m.earthTimeFraction} ≠ ${w.earth.fractionOfTime}`);
  assert.ok(Math.abs(m.sunAndEarthTimeFraction - w.sunAndEarth.fractionOfTime) <= fractionTol, 'sol y tierra');
  assert.ok(Math.abs(m.longestNightHours - w.night.longestNightHours) <= hoursTol, `noche ${m.longestNightHours} ≠ ${w.night.longestNightHours}`);
  const outage = longestGapHours(w.earth.windows, startMs, endMs);
  assert.ok(Math.abs(m.longestEarthOutageHours - outage) <= hoursTol, `sin Tierra ${m.longestEarthOutageHours} ≠ ${outage}`);
  // The mean visible fraction of the disc, from the same evaluation as rank (one sample per hour, as the series).
  const { metrics } = evaluatePeriod(site, sampleVectors(startMs, endMs, HOUR_MS), { mode: 'limb', stepMs: HOUR_MS, weights: SCORE_WEIGHTS, terrain: TERRAIN });
  assert.ok(Math.abs(m.meanSunDiskFraction - metrics.energy) <= fractionTol, `disco ${m.meanSunDiskFraction} ≠ ${metrics.energy}`);
  assert.ok(Math.abs(m.longestEarthOutageHours - metrics.longestNoEarthH) <= hoursTol, 'sin Tierra (rank)');
});

test('E1.3 · computed in less than 50 ms', () => {
  const t0 = performance.now();
  for (let d = 0; d < 10; d++) periodMetrics(shackleton, new Date(Date.parse('2027-01-01T00:00:00Z') + d * 30 * DAY_MS), 60);
  assert.ok((performance.now() - t0) / 10 < 50);
});

test('E1.3 · shackleton-rim and im2-objetivo give clearly different values in the same period', () => {
  const start = at('2027-03-01T00:00:00Z');
  const a = periodMetrics(shackleton, start, 60), b = periodMetrics(mouton, start, 60);
  assert.ok(Math.abs(a.sunTimeFraction - b.sunTimeFraction) > 0.2, 'luz');
  assert.ok(Math.abs(a.earthTimeFraction - b.earthTimeFraction) > 0.2, 'tierra');
  assert.ok(Math.abs(a.longestNightHours - b.longestNightHours) > 48, 'noche');
});

test('E1.3 · a period that does not fit in the series is rejected', () => {
  assert.throws(() => periodMetrics(shackleton, at('2027-12-01T00:00:00Z'), 60), RangeError);
});

// ---- E1.4: the countdown ----

test('E1.4 · the next set matches the engine (nextSet, with terrain) within 1 h', () => {
  const end = at('2027-12-31T23:00:00Z');
  let checked = 0;
  for (const [id, series] of [['shackleton-rim', shackleton], ['im2-objetivo', mouton]]) {
    for (const iso of ['2027-02-11T16:00:00Z', '2027-03-06T00:00:00Z', '2027-05-20T08:00:00Z', '2027-09-02T12:00:00Z']) {
      const { bodies } = sunEarth({ site: getSite(id), dateMs: Date.parse(iso), terrain: TERRAIN }).snapshot;
      for (const body of ['sun', 'earth']) {
        const next = nextChange(series, body, at(iso), end);
        const engine = bodies[body];
        if (next.type === 'set' && engine.visible && engine.nextSet) {
          const diffH = Math.abs(next.date - Date.parse(engine.nextSet)) / HOUR_MS;
          assert.ok(diffH < 1, `${id} ${body} ${iso}: ${next.date.toISOString()} ≠ ${engine.nextSet}`);
          checked++;
        }
        if (next.type === 'rise' && !engine.visible && engine.nextRise) {
          assert.ok(Math.abs(next.date - Date.parse(engine.nextRise)) / HOUR_MS < 1, `${id} ${body} ${iso} (salida)`);
        }
      }
    }
  }
  assert.ok(checked >= 3, `solo ${checked} puestas comparadas`);
});

test('E1.4 · when the body does not set in the period, it says so instead of a number', () => {
  // Shackleton, from 2027-02-11 16:00 the Sun is up for days: one day later is still before its set.
  const from = at('2027-02-11T16:00:00Z');
  const next = nextChange(shackleton, 'sun', from, new Date(from.getTime() + HOUR_MS * 2));
  assert.deepEqual(next, { type: 'none', seen: true });
});
