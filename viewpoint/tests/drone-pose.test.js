// Initial pose of the drone and «Restablecer» (E2.3, #154).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRONE_DISTANCE_KM, DRONE_HEIGHT_KM, FLAG_AIM_KM, dronePose, glidePose } from '../src/core/drone-pose.js';
import { limitCamera } from '../src/core/camera-limits.js';
import { TEXTS } from '../src/texts.js';

const hills = (x, z) => 0.4 * Math.sin(x / 3) + 0.3 * Math.cos(z / 2); // a rolling relief, in km
const flag = { x: 1.2, z: -0.7 };
const SUN_AZ = 229.72; // the API parity example

test('dronePose: beside the Sun, at the drone distance from the flag and looking at it', () => {
  const { position: p, target: t } = dronePose(flag, SUN_AZ, hills);
  assert.ok(Math.abs(Math.hypot(p.x - flag.x, p.z - flag.z) - DRONE_DISTANCE_KM) < 1e-12);
  assert.deepEqual(t, { x: flag.x, y: hills(flag.x, flag.z) + FLAG_AIM_KM, z: flag.z });
  assert.equal(p.y, Math.max(hills(flag.x, flag.z), hills(p.x, p.z)) + DRONE_HEIGHT_KM);
  // Square to the Sun: the horizontal direction to the drone is perpendicular to the Sun's azimuth.
  const a = SUN_AZ * Math.PI / 180, sun = { x: Math.sin(a), z: -Math.cos(a) };
  assert.ok(Math.abs((p.x - flag.x) * sun.x + (p.z - flag.z) * sun.z) < 1e-12);
});

test('dronePose: the drone stays above a ground higher than the flag', () => {
  const ridge = (x) => (x < -2 ? 3 : 0); // a plateau 3 km high to the west
  const { position: p } = dronePose({ x: 0, z: 0 }, 180, ridge); // Sun to the south: the drone goes to the west, 5 km away
  assert.ok(p.x < -2);
  assert.equal(p.y, 3 + DRONE_HEIGHT_KM);
});

test('dronePose: the same inputs always give the same pose', () => {
  assert.deepEqual(dronePose(flag, SUN_AZ, hills), dronePose(flag, SUN_AZ, hills));
});

test('Restablecer: after turning, panning and zooming, the camera ends exactly in the initial pose', () => {
  const initial = dronePose(flag, SUN_AZ, hills);
  // Move the camera as the controls would: turn around the target, pan both, zoom in; each step within the limits.
  let pose = initial;
  const move = (position, target) => {
    const { position: p, target: t } = limitCamera(position, target, hills, 40);
    pose = { position: p, target: t };
  };
  const turn = (ang) => {
    const { position: p, target: t } = pose, dx = p.x - t.x, dz = p.z - t.z;
    move({ x: t.x + dx * Math.cos(ang) - dz * Math.sin(ang), y: p.y, z: t.z + dx * Math.sin(ang) + dz * Math.cos(ang) }, t);
  };
  const pan = (ox, oz) => move({ ...pose.position, x: pose.position.x + ox, z: pose.position.z + oz }, { ...pose.target, x: pose.target.x + ox, z: pose.target.z + oz });
  const zoom = (f) => {
    const { position: p, target: t } = pose;
    move({ x: t.x + (p.x - t.x) * f, y: t.y + (p.y - t.y) * f, z: t.z + (p.z - t.z) * f }, t);
  };
  turn(1.1); pan(-3.3, 2.7); zoom(0.49); turn(-0.4);
  assert.notDeepEqual(pose, initial);

  // The glide goes from the moved pose to the initial one; its first frame is the moved pose and its last the initial one.
  const from = pose;
  assert.deepEqual(glidePose(from, initial, 0), from);
  const mid = glidePose(from, initial, 0.5);
  assert.notDeepEqual(mid, initial);
  assert.deepEqual(glidePose(from, initial, 1), initial);
  // With «reduce motion» there is no glide: one step at k = 1, the same exact pose.
  assert.deepEqual(glidePose(from, initial, 1), dronePose(flag, SUN_AZ, hills));
  // The initial pose is inside the limits: the clamp of the controls does not move it.
  assert.equal(limitCamera(initial.position, initial.target, hills, 40).moved, false);
});

test('glidePose: smooth, monotonic and without sharing objects with the poses it reads', () => {
  const a = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
  const b = { position: { x: 10, y: 4, z: -2 }, target: { x: 1, y: 1, z: 1 } };
  let last = -Infinity;
  for (let k = 0; k <= 1; k += 0.05) {
    const x = glidePose(a, b, k).position.x;
    assert.ok(x >= last);
    last = x;
  }
  const end = glidePose(a, b, 1);
  end.position.x = 99;
  assert.equal(b.position.x, 10);
});

test('Restablecer: texts in the dictionary, a tutorial step and a button with an accessible name', () => {
  assert.equal(TEXTS.resetView.text, 'Restablecer');
  assert.ok(TEXTS.resetView.label.startsWith(TEXTS.resetView.text)); // the name for screen readers contains the visible text
  assert.ok(TEXTS.tutorialSteps.some(s => s.target === '#reset-view'));
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const button = html.match(/<button[^>]*id="reset-view"[^>]*>/)?.[0];
  assert.ok(button, 'the button is in the page');
  assert.match(button, /type="button"/);
  assert.doesNotMatch(button, /tabindex="-1"/); // reachable with Tab
  assert.match(html, /id="reset-view-label"/);
});
