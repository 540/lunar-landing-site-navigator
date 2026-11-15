// On foot in virtual reality (#396): headset, controllers and hands, with made-up poses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { azEl, forwardOf, toScene, dirToScene, rigOrigin, roomStep, stickInput, createSnapTurn, handLandmarks, XR_HAND_JOINTS, controllerCurls, watchScore, createEyeHeight, M_TO_KM } from '../src/core/xr-input.js';
import { fingerCurls } from '../src/core/hand-track.js';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);
const quatY = deg => { const h = deg * Math.PI / 360; return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) }; };

test('xr: where a pose looks, as an azimuth of the scene', () => {
  close(azEl(forwardOf({ x: 0, y: 0, z: 0, w: 1 })).az, 0, 1e-9); // −z: azimuth 0
  close(azEl(forwardOf(quatY(-90))).az, 90, 1e-9); // turned right (negative about y): towards +x, azimuth 90
  const up = azEl({ x: 0, y: 1, z: -1 });
  close(up.el, 45, 1e-9);
});

test('xr: the rig turns the headset\'s space to an azimuth and scales metres to km', () => {
  // ahead in the headset (−z) is the rig\'s azimuth in the scene
  const ahead = dirToScene({ x: 0, y: 0, z: -1 }, 90);
  close(ahead.x, 1, 1e-12); close(ahead.z, 0, 1e-12);
  close(azEl(dirToScene({ x: 0, y: 0, z: -1 }, 230)).az, 230, 1e-9);
  const p = toScene({ x: 0, y: 1.6, z: -2 }, 0);
  close(p.y, 1.6 * M_TO_KM, 1e-15); close(p.z, -0.002, 1e-15);
});

test('xr: you are where your head is; walking in the room moves you, and the rig follows so the head stays over you', () => {
  const rigAz = 90, person = { x: 10, z: -3 };
  const head = { x: 0.5, y: 1.6, z: -0.2 };
  const o = rigOrigin(person, head, rigAz);
  const back = toScene(head, rigAz);
  close(o.x + back.x, person.x, 1e-12); close(o.z + back.z, person.z, 1e-12);
  // one metre forward in the room, facing the rig\'s azimuth (east): one metre east in the scene
  const s = roomStep({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 1.6, z: -1 }, rigAz);
  close(s.x, 0.001, 1e-12); close(s.z, 0, 1e-12);
  assert.deepEqual(roomStep(null, head, rigAz), { x: 0, z: 0 });
});

test('xr: the left stick walks as the joystick does (forward is the stick pushed away), and runs at full tilt', () => {
  const walk = stickInput(0, -0.6);
  assert.ok(walk.forward > 0 && !walk.run);
  assert.equal(stickInput(0, -1).run, true);
  assert.equal(stickInput(0.03, 0.02).forward, 0, 'a stick at rest drifts: dead zone');
});

test('xr: snap turn, one step a push, not one a frame', () => {
  const t = createSnapTurn({ stepDeg: 30 });
  assert.equal(t.update(0.9), 30);
  assert.equal(t.update(0.95), 0, 'held: no more steps');
  assert.equal(t.update(0.1), 0);
  assert.equal(t.update(-0.8), -30);
});

test('xr: a WebXR hand gives the 21 points of MediaPipe, and its fingers bend the glove the same way', () => {
  assert.equal(XR_HAND_JOINTS.length, 21);
  // an open hand: wrist at the origin, fingers straight ahead (−z)
  const at = {};
  at.wrist = { x: 0, y: 0, z: 0 };
  const fingers = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
  fingers.forEach((f, k) => {
    const x = (k - 2) * 0.02, names = k === 0 ? ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'] : ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
    names.forEach((n, j) => { at[`${f}-${n}`] = { x, y: 0, z: -0.08 - j * 0.03 }; });
  });
  const pts = handLandmarks(n => at[n] ?? null);
  assert.equal(pts.length, 21);
  for (const [a, b] of fingerCurls(pts)) { close(a, 0, 1e-6); close(b, 0, 1e-6); }
  delete at['index-finger-tip'];
  assert.equal(handLandmarks(n => at[n] ?? null), null);
});

test('xr: with controllers, the trigger bends the index and the grip the other fingers', () => {
  const open = controllerCurls({}), fist = controllerCurls({ trigger: 1, squeeze: 1, thumb: true });
  for (let f = 0; f < 5; f++) assert.ok(fist[f][0] > open[f][0] && fist[f][1] > open[f][1]);
  const point = controllerCurls({ squeeze: 1 });
  assert.ok(point[1][0] < point[2][0], 'pointing: the index straight, the others bent');
});

test('xr: the watch wakes with the left wrist in front of the eyes and a little below, not at the side or far', () => {
  const head = { position: { x: 0, y: 1.6, z: 0 }, forward: { x: 0, y: -0.3, z: -1 } };
  assert.ok(watchScore(head, { x: -0.05, y: 1.42, z: -0.3 }) > 0.8);
  assert.equal(watchScore(head, { x: -0.4, y: 1.0, z: 0 }), 0, 'hanging at the side');
  assert.equal(watchScore(head, { x: 0, y: 1.45, z: -0.7 }), 0, 'arm stretched out');
  assert.equal(watchScore(head, null), 0);
});

test('xr: the height of your eyes is the median of the first moments, so a nod does not count', () => {
  const e = createEyeHeight({ samples: 5, fallback: 1.6 });
  assert.equal(e.update(1.5), 1.6);
  for (const y of [1.52, 1.1, 1.51, 1.53]) e.update(y);
  close(e.value, 1.51, 1e-12);
  e.update(1.9);
  close(e.value, 1.51, 1e-12, 'fixed once measured');
});

import { padInput } from '../src/core/xr-input.js';

test('xr: a plain gamepad (DualShock 4 with the PS VR) walks, turns, jumps with ✕ and raises the watch with △', () => {
  const pad = { axes: [0.1, -0.9, 0.8, 0], pressed: [true, false, false, true] };
  const p = padInput(pad);
  assert.deepEqual(p.left, { x: 0.1, y: -0.9 });
  assert.equal(p.right.x, 0.8);
  assert.equal(p.jump, true); assert.equal(p.watch, true);
  assert.equal(padInput(null), null);
  assert.ok(stickInput(p.left.x, p.left.y).forward > 0, 'pushed away walks forward');
});
