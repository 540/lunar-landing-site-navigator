// Your gestures through the camera (E3, #181): arms, the watch, fingers, head and eyes, with made-up landmarks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oneEuro } from '../src/core/one-euro.js';
import { armDirections, watchPose, createWatchGesture, clearOfTorso, TORSO_BOX, torsoFrame } from '../src/core/body-track.js';
import { headAngles, eyeGaze, createHeadTracker, HEAD_GAIN, CALIBRATE_S, TURN_FROM_DEG } from '../src/core/head-track.js';
import { fingerCurls, whichHand, createHandTracker } from '../src/core/hand-track.js';
import { findFingers, handWeights } from '../src/core/hand-rig.js';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);

// A pose in your own frame (x to your left, y up, z forward, metres) turned into MediaPipe's world landmarks (x to the
// right of the image, y down, z away from the camera), as the camera in front of you sees it.
function pose(joints, turnDeg = 0) {
  const r = turnDeg * Math.PI / 180, world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  for (const [i, [x, y, z]] of Object.entries(joints)) {
    const tx = x * Math.cos(r) + z * Math.sin(r), tz = -x * Math.sin(r) + z * Math.cos(r); // you turned to your left by turnDeg
    world[i] = { x: tx, y: -y, z: -tz, visibility: 1 };
  }
  return world;
}
const TORSO = { 11: [0.18, 0.5, 0], 12: [-0.18, 0.5, 0], 23: [0.1, 0, 0], 24: [-0.1, 0, 0] };
const ARMS_DOWN = { ...TORSO, 13: [0.2, 0.22, 0], 15: [0.2, -0.04, 0.02], 14: [-0.2, 0.22, 0], 16: [-0.2, -0.04, 0.02] };
const LEFT_OUT = { ...ARMS_DOWN, 13: [0.46, 0.5, 0], 15: [0.72, 0.5, 0] }; // left arm straight out to your side
const WATCH = { ...ARMS_DOWN, 13: [0.36, 0.32, 0.1], 15: [0.08, 0.37, 0.3] }; // left forearm across in front of the chest

test('one euro: a still signal settles, a jump is followed without lag', () => {
  const f = oneEuro({ minCutoff: 1, beta: 0.5 });
  let v = 0;
  for (let i = 0; i < 60; i++) v = f.filter(i % 2 ? 0.01 : -0.01, 1 / 30); // shake at rest
  assert.ok(Math.abs(v) < 0.005, 'the shake is smoothed');
  for (let i = 0; i < 15; i++) v = f.filter(1, 1 / 30);
  assert.ok(v > 0.9, `a real move is followed (${v})`);
});

test('arms: your left arm is the astronaut\'s left arm, read against your own chest even if you stand turned', () => {
  const out = armDirections(pose(LEFT_OUT));
  close(out.left.upper.x, 1, 1e-9); // out to your left: +x of the suit
  close(out.left.fore.x, 1, 1e-9);
  close(out.right.upper.y, -1, 0.01); // the right one hangs down
  // turned 30° to the camera, the same pose reads the same against your chest
  const turned = armDirections(pose(LEFT_OUT, 30));
  close(turned.left.upper.x, 1, 1e-9); close(turned.left.upper.z, 0, 1e-9);
  assert.equal(out.left.weight, 1);
  // an arm the camera barely sees is not followed
  const hidden = pose(LEFT_OUT); hidden[15].visibility = 0.2;
  assert.equal(armDirections(hidden).left.weight, 0);
  assert.equal(armDirections([]), null);
  close(torsoFrame(pose(TORSO)).width, 0.36, 1e-9);
});

test('watch: the forearm raised across the chest is the gesture; arms down, an arm out or looking up are not', () => {
  assert.ok(watchPose(pose(WATCH)) > 0.8, `watch pose → ${watchPose(pose(WATCH))}`);
  assert.equal(watchPose(pose(ARMS_DOWN)), 0);
  assert.equal(watchPose(pose(LEFT_OUT)), 0);
  assert.ok(watchPose(pose(WATCH), { pitch: 25 }) < 0.05, 'looking up, you are not reading a watch');
  assert.ok(watchPose(pose(WATCH), { pitch: -15 }) > 0.8);
});

test('watch gesture: on after holding the pose a moment, off after leaving it a little longer, no flicker', () => {
  const g = createWatchGesture({ onAfter: 0.35, offAfter: 0.6 });
  const run = (score, seconds) => { let up; for (let t = 0; t < seconds; t += 0.05) up = g.update(score, 0.05); return up; };
  assert.equal(run(1, 0.2), false, 'a glimpse is not enough');
  assert.equal(run(0, 0.1), false);
  assert.equal(run(1, 0.5), true);
  assert.equal(run(0, 0.3), true, 'a moment out of the pose keeps it up');
  assert.equal(run(0, 0.5), false);
});

test('a followed hand never goes into the chest of the suit: it is pushed out to the front or the side', () => {
  const inside = clearOfTorso({ x: 0.05, y: 0.3, z: 0.2 });
  assert.equal(inside.z, TORSO_BOX.front);
  const side = clearOfTorso({ x: 0.22, y: 0.3, z: 0 });
  assert.equal(side.x, TORSO_BOX.halfWidth);
  const out = { x: 0.1, y: 0.3, z: 0.4 };
  assert.equal(clearOfTorso(out), out);
});

// A face looking at the camera, turned `yaw` degrees to your left and `pitch` up (normalised image points).
function face(yaw = 0, pitch = 0) {
  const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180;
  // in your frame (x left, y up, z to the camera), then to the image (x right of the image = your left, y down, z away)
  const put = (i, x, yy, z) => {
    const x1 = x * Math.cos(y) + z * Math.sin(y), z1 = -x * Math.sin(y) + z * Math.cos(y);
    const y2 = yy * Math.cos(p) + z1 * Math.sin(p), z2 = -yy * Math.sin(p) + z1 * Math.cos(p);
    pts[i] = { x: 0.5 + x1 / (4 / 3), y: 0.5 - y2, z: -z2 / (4 / 3) };
  };
  put(454, 0.1, 0, 0); put(234, -0.1, 0, 0); put(10, 0, 0.14, 0.02); put(152, 0, -0.14, 0.02);
  return pts;
}

test('head: turning to your left and looking up read as such', () => {
  const ahead = headAngles(face());
  close(ahead.yaw, 0, 1e-6); close(ahead.pitch, 0, 1e-6);
  close(headAngles(face(20, 0)).yaw, 20, 1e-6);
  close(headAngles(face(0, 15)).pitch, 15, 1e-6);
  assert.equal(headAngles(null), null);
});

test('eyes: the blendshapes of your eyes give where they look; without them, the irises between the corners', () => {
  const s = (o) => Object.entries(o).map(([categoryName, score]) => ({ categoryName, score }));
  close(eyeGaze(s({ eyeLookOutLeft: 0.8, eyeLookInRight: 0.8 })).yaw, 0.8, 1e-9); // to your left
  close(eyeGaze(s({ eyeLookInLeft: 0.6, eyeLookOutRight: 0.6 })).yaw, -0.6, 1e-9);
  close(eyeGaze(s({ eyeLookUpLeft: 0.5, eyeLookUpRight: 0.5 })).pitch, 0.5, 1e-9);
  // irises: your left eye on the right of the image, its inner corner nearer the middle
  const pts = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  Object.assign(pts, { 362: { x: 0.55, y: 0.4, z: 0 }, 263: { x: 0.65, y: 0.4, z: 0 }, 133: { x: 0.45, y: 0.4, z: 0 }, 33: { x: 0.35, y: 0.4, z: 0 } });
  pts[473] = { x: 0.62, y: 0.4, z: 0 }; pts[468] = { x: 0.42, y: 0.4, z: 0 }; // both moved to the right of the image: your left
  assert.ok(eyeGaze(null, pts).yaw > 0.3);
});

test('head tracker: calibrates your head at rest, then amplifies its turns, and past a point keeps turning the body', () => {
  const t = createHeadTracker();
  let out;
  for (let k = 0; k < 40; k++) out = t.update({ yaw: 5, pitch: -3 }, null, 1 / 30); // your head at rest is a bit turned
  assert.equal(t.calibrated, true);
  assert.ok(Math.abs(out.yaw) < 0.5 && Math.abs(out.pitch) < 0.5, 'at rest, the view does not move');
  for (let k = 0; k < 90; k++) out = t.update({ yaw: 5 + 15, pitch: -3 }, null, 1 / 30); // 15° to your left
  close(out.yaw, -(15 - 1.5) * HEAD_GAIN, 0.6); // the view turns left (negative azimuth), amplified
  assert.equal(out.turn, 0);
  for (let k = 0; k < 90; k++) out = t.update({ yaw: 5 - 40, pitch: -3 }, null, 1 / 30); // far to your right
  assert.ok(out.yaw > TURN_FROM_DEG && out.turn > 0, 'past the edge the body keeps turning right');
  assert.ok(CALIBRATE_S < 40 / 30);
});

// A hand: the wrist at the origin, the fingers straight along +y, or bent `bend` radians at each joint.
function hand(bend = 0) {
  const pts = [{ x: 0, y: 0, z: 0 }];
  const xs = [-0.04, -0.02, 0, 0.02, 0.04];
  for (let f = 0; f < 5; f++) {
    let p = { x: xs[f], y: 0.08, z: 0 }, dir = 0;
    pts.push({ ...p });
    for (let j = 0; j < 3; j++) { dir += bend; p = { x: p.x, y: p.y + 0.03 * Math.cos(dir), z: p.z + 0.03 * Math.sin(dir) }; pts.push({ ...p }); }
  }
  return pts;
}

test('fingers: straight read 0, a fist reads a strong bend at both joints', () => {
  const straight = fingerCurls(hand(0));
  for (const [a, b] of straight) { close(a, 0, 1e-6); close(b, 0, 1e-6); }
  const fist = fingerCurls(hand(0.9));
  for (const [a, b] of fist.slice(1)) { assert.ok(a > 0.9 && b > 1.2, `${a} ${b}`); }
  assert.equal(fingerCurls(null), null);
});

test('fingers: each hand seen is yours by the wrist of the pose next to it; without a pose, by the mirrored label', () => {
  const pose2d = []; pose2d[15] = { x: 0.7, y: 0.6 }; pose2d[16] = { x: 0.3, y: 0.6 };
  assert.deepEqual(whichHand([[{ x: 0.32, y: 0.62 }], [{ x: 0.68, y: 0.6 }]], pose2d), ['right', 'left']);
  assert.deepEqual(whichHand([[{ x: 0.5, y: 0.5 }]], null, ['Left']), ['right']);
  const t = createHandTracker({ forgetAfter: 0.4 });
  let out = t.update([{ side: 'left', world: hand(0.5) }], 1 / 30);
  assert.equal(out.left.weight, 1); assert.equal(out.right, null);
  for (let k = 0; k < 20; k++) out = t.update([], 1 / 30);
  assert.equal(out.left, null, 'a hand lost for a moment lets the glove go back to rest');
});

test('glove: five fingers are found on its surface, the thumb first, and each bends from its knuckle', () => {
  // a palm (a grid) and five tubes (chains) out of it: four along the far edge, the thumb out of the side near the wrist
  const points = [], neighbours = [], link = (a, b) => { neighbours[a].add(b); neighbours[b].add(a); };
  const add = p => { points.push(p); neighbours.push(new Set()); return points.length - 1; };
  const grid = [];
  for (let r = 0; r <= 8; r++) { grid.push([]); for (let c = 0; c <= 6; c++) { const k = add([c * 0.012, r * 0.012, 0]); grid[r].push(k); if (c) link(k, grid[r][c - 1]); if (r) link(k, grid[r - 1][c]); } }
  const chain = (from, start, step, n) => { let prev = from; for (let i = 1; i <= n; i++) { const k = add(start.map((v, d) => v + step[d] * i)); link(prev, k); prev = k; } };
  for (const c of [0, 2, 4, 6]) chain(grid[8][c], [c * 0.012, 0.096, 0], [0, 0.01, 0], 8); // fingers, 8 cm
  chain(grid[2][0], [0, 0.024, 0], [-0.01, 0.004, 0], 5); // the thumb, short, out of the side
  const seeds = grid[0];
  const r = findFingers(points, neighbours, seeds);
  assert.ok(r, 'five fingers');
  assert.equal(r.fingers.length, 5);
  assert.ok(r.fingers[0].reach < r.fingers[1].reach, 'the thumb, first, is the one nearest the wrist');
  const bones = { hand: 0, fingers: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]] };
  assert.deepEqual(handWeights(-1, 0, bones), { index: [0, 0], weight: [1, 0] });
  assert.deepEqual(handWeights(2, 0.3, bones), { index: [5, 5], weight: [1, 0] });
  assert.equal(handWeights(2, 0.9, bones).index[0], 6);
});

import { hingePose } from '../src/core/arm-ik.js';

test('arm as a hinge: the elbow only bends in the plane of the arm, and a straight arm keeps the plane it had', () => {
  const u0 = { x: 0, y: -1, z: 0 }, f0 = { x: 0, y: -Math.SQRT1_2, z: Math.SQRT1_2 }; // rest: forearm 45° forward
  // apply a pose: turn by the frames (columns from → to), then bend about the axis
  const turn = (h, v) => {
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const c = h.from.map(e => dot(e, v));
    return { x: h.to[0].x * c[0] + h.to[1].x * c[1] + h.to[2].x * c[2], y: h.to[0].y * c[0] + h.to[1].y * c[1] + h.to[2].y * c[2], z: h.to[0].z * c[0] + h.to[1].z * c[1] + h.to[2].z * c[2] };
  };
  const rot = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a), d = v.x * k.x + v.y * k.y + v.z * k.z; const x = { x: k.y * v.z - k.z * v.y, y: k.z * v.x - k.x * v.z, z: k.x * v.y - k.y * v.x }; return { x: v.x * c + x.x * s + k.x * d * (1 - c), y: v.y * c + x.y * s + k.y * d * (1 - c), z: v.z * c + x.z * s + k.z * d * (1 - c) }; };
  // arm out to the side, forearm up: the upper arm and the forearm land exactly where asked
  const u = { x: 1, y: 0, z: 0 }, f = { x: 0, y: 1, z: 0 };
  const h = hingePose(u0, f0, u, f);
  const U = turn(h, u0), F = turn(h, rot(f0, h.axis, h.bend));
  close(U.x, 1, 1e-9); close(F.y, 1, 1e-9); close(F.x, 0, 1e-9);
  close(h.bend, Math.PI / 2 - Math.PI / 4, 1e-9);
  // straight: the plane is the one it had, not a random one
  const straight = hingePose(u0, f0, u, u, h.plane);
  close(straight.plane.x * h.plane.x + straight.plane.y * h.plane.y + straight.plane.z * h.plane.z, 1, 1e-9);
});
