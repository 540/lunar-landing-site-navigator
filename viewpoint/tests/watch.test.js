// The watch on the wrist and the clean suit (E3, #181): IK of the arm, what the screen says, and the texture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { twoBoneIK, length } from '../src/core/arm-ik.js';
import { watchReadout, shortDuration } from '../src/core/watch.js';
import { periodMetrics, nextChange } from '../src/core/sky-state.js';
import { cleanSuitPixels } from '../src/core/suit-texture.js';

const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≠ ${b} (±${eps})`);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('IK: the hand reaches a point within reach, with the bones at their length', () => {
  const root = { x: 0.31, y: 0.37, z: 0.05 }, target = { x: 0.07, y: 0.66, z: 0.41 };
  const { elbow, end, reached } = twoBoneIK(root, target, 0.3, 0.34, { x: 0.6, y: 0, z: 0.1 });
  assert.ok(reached);
  close(dist(end, target), 0, 1e-9);
  close(dist(root, elbow), 0.3, 1e-9);
  close(dist(elbow, end), 0.34, 1e-9);
});

test('IK: the elbow bends towards the pole (down and out for an arm)', () => {
  const root = { x: 0, y: 0, z: 0 }, target = { x: 0, y: 0, z: 0.4 };
  const down = twoBoneIK(root, target, 0.3, 0.3, { x: 0, y: -1, z: 0.2 }).elbow;
  const up = twoBoneIK(root, target, 0.3, 0.3, { x: 0, y: 1, z: 0.2 }).elbow;
  assert.ok(down.y < 0 && up.y > 0);
});

test('IK: out of reach the arm stretches along the line to the target, never longer than itself', () => {
  const root = { x: 0, y: 0, z: 0 }, target = { x: 0, y: 0, z: 5 };
  const r = twoBoneIK(root, target, 0.3, 0.34, { x: 0, y: -1, z: 0 });
  assert.equal(r.reached, false);
  assert.ok(length(r.end) <= 0.64 + 1e-9);
  close(r.end.x, 0, 1e-9); close(r.end.y, 0, 1e-9);
});

const series = JSON.parse(readFileSync(new URL('../data/shackleton-rim/series-2027.json', import.meta.url)));

test('watch: says the same as the E1 panel (states, countdown and metrics from core/sky-state.js)', () => {
  const start = new Date('2027-01-15T00:00:00Z'), date = new Date('2027-01-20T06:00:00Z');
  const r = watchReadout(series, date, start, 60);
  assert.ok(['visible', 'partial', 'hidden'].includes(r.sun.state));
  assert.ok(['visible', 'hidden'].includes(r.earth.state));
  assert.deepEqual(r.metrics, periodMetrics(series, start, 60));
  assert.deepEqual(r.sun.change, nextChange(series, 'sun', date, new Date(start.getTime() + 60 * 86400e3)));
});

test('watch: durations in short form', () => {
  assert.equal(shortDuration(0.25), '15 min');
  assert.equal(shortDuration(14.2), '14 h');
  assert.equal(shortDuration(74), '3 d 2 h');
  assert.equal(shortDuration(72), '3 d');
});

const px = (...rgb) => new Uint8ClampedArray([...rgb, 255]);

test('suit texture: grime on the fabric is cleaned to white, keeping some of the weave', () => {
  const grime = cleanSuitPixels(px(70, 60, 50)), fabric = cleanSuitPixels(px(220, 215, 205));
  assert.ok(grime[0] > 190, `grime → ${grime[0]}`);
  assert.ok(fabric[0] > grime[0], 'lighter fabric stays lighter: the weave and seams still read');
  assert.ok(Math.abs(grime[0] - grime[2]) < 12, 'neutral white, not beige');
});

test('suit texture: the red EVA stripes and blue bands stay as they are', () => {
  assert.deepEqual([...cleanSuitPixels(px(170, 20, 25))], [170, 20, 25, 255]);
  assert.deepEqual([...cleanSuitPixels(px(20, 50, 190))], [20, 50, 190, 255]);
});

test('suit texture: black bearings become dark metal grey, not white', () => {
  const b = cleanSuitPixels(px(8, 8, 8));
  assert.ok(b[0] > 50 && b[0] < 90, `bearing → ${b[0]}`);
});

// Fitting the watch to the real forearm (core/surface-fit.js)

import { radialProfile, seatRadius, bandRing, crossBasis } from '../src/core/surface-fit.js';

/** Points of an elliptic tube along z: radii a (along x) and b (along y), from z = 0 to 1. */
function tube(a, b, n = 2000) {
  const pts = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * 2 * Math.PI * 7.31, z = i / n; pts.push(a * Math.cos(t), b * Math.sin(t), z); }
  return new Float64Array(pts);
}

test('radialProfile: on a round tube every sector has its radius', () => {
  const p = radialProfile(tube(0.06, 0.06), [0, 0, 0], [0, 0, 1], 0.2, 0.8, 36);
  for (const r of p.radii) close(r, 0.06, 0.002);
});

test('radialProfile: only the stretch asked for counts (a bulge outside it is ignored)', () => {
  const pts = [...tube(0.06, 0.06), 0.2, 0, 0.95]; // a point 20 cm out, beyond the stretch
  const p = radialProfile(new Float64Array(pts), [0, 0, 0], [0, 0, 1], 0.2, 0.8, 36);
  assert.ok(Math.max(...p.radii) < 0.065);
});

test('seatRadius: a flat case over a round forearm clears it everywhere under it', () => {
  const r = 0.06, half = 0.03, p = radialProfile(tube(r, r), [0, 0, 0], [0, 0, 1], 0, 1, 72);
  const seat = seatRadius(p, 0, half, 0.001);
  // every point of the surface under the plate is below it: r·cos δ ≤ seat for |r sin δ| ≤ half
  for (let d = -Math.asin(half / r); d <= Math.asin(half / r); d += 0.01) assert.ok(r * Math.cos(d) <= seat + 1e-9);
  close(seat, r + 0.001, 0.003);
});

test('seatRadius: on an oval forearm the case sits on the wide side higher than on the narrow one', () => {
  const { u, v } = crossBasis([0, 0, 1]);
  const p = radialProfile(tube(0.075, 0.05), [0, 0, 0], [0, 0, 1], 0, 1, 72);
  const angleOfX = Math.atan2(v[0], u[0]); // the wide side (+x), as an angle from u towards v
  const wide = seatRadius(p, angleOfX, 0.02), narrow = seatRadius(p, angleOfX + Math.PI / 2, 0.02);
  assert.ok(wide > 0.073 && narrow < 0.06, `${wide} ${narrow}`);
});

test('bandRing: the strap goes round outside the surface, never inside it', () => {
  const pts = tube(0.07, 0.055), p = radialProfile(pts, [0, 0, 0], [0, 0, 1], 0.4, 0.6, 72);
  const ring = bandRing(p, 0.5, 0.0025);
  assert.equal(ring.length, 72);
  for (const [x, y] of ring) {
    // the ellipse radius in that direction
    const ang = Math.atan2(y, x), rEll = 1 / Math.hypot(Math.cos(ang) / 0.07, Math.sin(ang) / 0.055);
    assert.ok(Math.hypot(x, y) >= rEll + 0.0024, `inside at ${ang.toFixed(2)}`);
  }
});

test('suit texture: a brown stain is grime, not a colour, and leaves no edge as it fades', () => {
  // Dark brown has a high HSL saturation, like a stripe: it must still be cleaned (the grey blotches on the knees).
  const stain = cleanSuitPixels(px(70, 45, 25));
  assert.ok(stain[0] > 185, `brown stain → ${stain[0]}`);
  // Across the dark band and the chroma band the result changes smoothly: no jump between two close pixels.
  for (const [a, b] of [[px(20, 20, 20), px(24, 24, 24)], [px(150, 95, 60), px(150, 92, 56)]]) {
    const ca = cleanSuitPixels(a)[0], cb = cleanSuitPixels(b)[0];
    assert.ok(Math.abs(ca - cb) < 25, `${ca} vs ${cb}`);
  }
});

test('suit texture: the shaded navy of the blue bands stays blue, a brown of the same strength is cleaned', () => {
  const navy = cleanSuitPixels(px(12, 18, 55));
  assert.ok(navy[2] > navy[0] + 30, `navy → ${[...navy]}`);
  const brown = cleanSuitPixels(px(55, 35, 15));
  assert.ok(brown[0] > 185 && Math.abs(brown[0] - brown[2]) < 12, `brown → ${[...brown]}`);
});
