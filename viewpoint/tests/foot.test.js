// On foot (E3, #181): camera at the eyes (E3.1), walking (E3.2), jumping and walking to a point (E3.3), compass (E3.4) and
// the touch joystick (E3.5). Pure functions of src/core/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EYE_HEIGHT_KM, PITCH_LIMIT_DEG, FOOT_NEAR_KM, footPose, arrivalAt, turn, dragLook, clampFov, FOOT_FOV_MIN_DEG, FOOT_FOV_MAX_DEG } from '../src/core/foot-camera.js';
import { WALK_SPEED_KMS, RUN_SPEED_KMS, MOON_GRAVITY_KMS2, JUMP_SPEED_KMS, TRACTION_KMS2, standAt, step, keysToInput, joystickInput, mergeInputs, isMoving, speedOf, gaitBob } from '../src/core/walk.js';
import { localNorthAt, compassReading, sideOf, octant, relativeAngle } from '../src/core/compass.js';
import { createSceneFrame } from '../src/core/scene-frame.js';
import { dirAzEl } from '../src/core/direction.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≠ ${b} (±${eps})`);
const flat = () => 1.2;
const hilly = (x, z) => 0.3 * Math.sin(x * 0.7) * Math.cos(z * 0.4) + 0.05 * Math.sin(x * 5 + z * 3);
const LIMITS = { extentKm: 40 };
const NONE = { forward: 0, right: 0, run: false };
const DT = 1 / 60;
const run = (state, input, seconds, ground = flat, limits = LIMITS) => {
  let s = state;
  for (let i = 0; i < Math.round(seconds / DT); i++) s = step(s, input, DT, ground, limits);
  return s;
};

// E3.1 · camera at the eyes

test('footPose: the eyes are 1.7 m over the ground at any point of the region', () => {
  for (let x = -20; x <= 20; x += 2.5) {
    for (let z = -20; z <= 20; z += 2.5) {
      const { position } = footPose({ x, z, yaw: 30, pitch: 5 }, hilly);
      close(position.y - hilly(x, z), EYE_HEIGHT_KM, 1e-12, `at (${x}, ${z})`);
      assert.equal(position.x, x);
      assert.equal(position.z, z);
    }
  }
  close(EYE_HEIGHT_KM * 1000, 1.7, 1e-9);
});

test('footPose: during a jump the eyes go up by its height', () => {
  const { position } = footPose({ x: 1, z: 2, yaw: 0, pitch: 0, air: 0.001 }, flat);
  close(position.y, 1.2 + EYE_HEIGHT_KM + 0.001, 1e-12);
});

test('the pitch never goes beyond 80° up and 70° down (the neck and the waist of the suit)', () => {
  assert.equal(PITCH_LIMIT_DEG, 80);
  assert.equal(turn({ yaw: 0, pitch: 70 }, 0, 50).pitch, 80);
  assert.equal(turn({ yaw: 0, pitch: -60 }, 0, -50).pitch, -70);
  assert.equal(dragLook({ yaw: 0, pitch: 0 }, 0, 100000, 60, 800).pitch, 80);
  // the look point stays within the limit even if a state asks for more
  const { position, look } = footPose({ x: 0, z: 0, yaw: 0, pitch: 89 }, flat);
  close(Math.asin(look.y - position.y) * 180 / Math.PI, 80, 1e-9);
});

test('the yaw wraps around 360°', () => {
  assert.equal(turn({ yaw: 350, pitch: 0 }, 20, 0).yaw, 10);
  assert.equal(turn({ yaw: 10, pitch: 0 }, -20, 0).yaw, 350);
});

test('arriving on foot: the gaze points at the azimuth of the Sun, with the flag in front', () => {
  const flag = { x: 2, z: -3 };
  const sun = { az: 229.72, el: 0.38 }; // the parity example of the API
  const a = arrivalAt(flag, sun);
  close(a.yaw, sun.az, 1e-9);
  close(a.pitch, sun.el, 1e-9);
  const { position, look } = footPose(a, flat);
  const az = (Math.atan2(look.x - position.x, -(look.z - position.z)) * 180 / Math.PI + 360) % 360;
  close(az, sun.az, 1e-9);
  // the flag is between you and the Sun, a few metres away
  const toFlag = { x: flag.x - a.x, z: flag.z - a.z }, d = dirAzEl(sun.az, 0);
  assert.ok(toFlag.x * d.x + toFlag.z * d.z > 0);
  assert.ok(Math.hypot(toFlag.x, toFlag.z) < 0.01);
});

test('the near plane on foot leaves the ground at your feet in view', () => {
  assert.ok(FOOT_NEAR_KM < EYE_HEIGHT_KM / 2);
});

test('field of view on foot stays within its limits', () => {
  assert.equal(clampFov(1), FOOT_FOV_MIN_DEG);
  assert.equal(clampFov(500), FOOT_FOV_MAX_DEG);
  assert.equal(clampFov(42), 42);
});

// E3.2 · walking, with the real physics of the Moon

const W = keysToInput(new Set(['w']));
const WRUN = keysToInput(new Set(['w', 'shift']));
const up = (state, input, ground = flat) => run(state, input, 4, ground); // long enough to reach the speed

test('real speeds: about 1 m/s walking and 2.2 m/s in the lope', () => {
  close(WALK_SPEED_KMS * 1000, 1, 1e-9);
  close(RUN_SPEED_KMS * 1000, 2.2, 1e-9);
});

test('on flat ground, once up to speed, 1 s walking goes the walking speed; with Shift, the running speed', () => {
  const a = up(standAt(0, 0, 90), W);
  close(run(a, W, 1).x - a.x, WALK_SPEED_KMS, 1e-9);
  const b = up(standAt(0, 0, 90), WRUN);
  close(run(b, WRUN, 1).x - b.x, RUN_SPEED_KMS, 1e-9);
});

test('the grip of 1/6 g: you speed up and brake slowly, and you slide a little when you let go', () => {
  close(TRACTION_KMS2 * 1000, 0.6 * 1.62, 1e-9); // ~1 m/s²
  const half = run(standAt(0, 0, 90), WRUN, 1);
  close(speedOf(half), TRACTION_KMS2 * 1, 1e-9); // after 1 s, not yet at the lope speed
  const moving = up(standAt(0, 0, 90), WRUN);
  const stopped = run(moving, NONE, 4);
  assert.equal(speedOf(stopped), 0);
  const slide = stopped.x - moving.x;
  close(slide, RUN_SPEED_KMS ** 2 / (2 * TRACTION_KMS2), 0.0001); // ~2.5 m to stop from the lope
});

test('A and D go sideways, S backwards; two keys at once do not go faster', () => {
  const right = up(standAt(0, 0, 0), keysToInput(new Set(['d']))); // facing north, D goes east
  close(right.vx, WALK_SPEED_KMS, 1e-9);
  const back = up(standAt(0, 0, 0), keysToInput(new Set(['s']))); // facing north, S goes south (+z)
  close(back.vz, WALK_SPEED_KMS, 1e-9);
  const diag = up(standAt(0, 0, 0), keysToInput(new Set(['w', 'd'])));
  close(speedOf(diag), WALK_SPEED_KMS, 1e-9);
});

test('facing a slope steeper than 30°, you do not go uphill; downhill you do', () => {
  const steep = x => x * Math.tan(35 * Math.PI / 180); // rises towards the east
  const upHill = run(standAt(0, 0, 90), W, 3, steep);
  assert.equal(upHill.x, 0);
  const down = run(standAt(0, 0, 270), W, 3, steep);
  assert.ok(down.x < 0);
  const gentle = x => x * Math.tan(25 * Math.PI / 180);
  assert.ok(run(standAt(0, 0, 90), W, 3, gentle).x > 0);
});

test('you do not leave the region', () => {
  const s = run(standAt(19.999, 0, 90), WRUN, 5);
  assert.equal(s.x, 20);
  const n = run(standAt(0, -19.999, 0), WRUN, 5);
  assert.equal(n.z, -20);
});

test('the arrows do not walk (they look)', () => {
  assert.equal(isMoving(keysToInput(new Set(['arrowup', 'arrowleft']))), false);
});

test('the gait: the eyes rise and fall a few centimetres per step; nothing standing still or in the air', () => {
  assert.equal(gaitBob(standAt(0, 0)), 0);
  let s = up(standAt(0, 0, 90), W), top = 0, low = Infinity;
  for (let i = 0; i < 120; i++) { s = step(s, W, DT, flat, LIMITS); top = Math.max(top, gaitBob(s)); low = Math.min(low, gaitBob(s)); }
  assert.ok(top > 0.00003 && top <= 0.0001, `bob ${top * 1000} m`);
  assert.ok(low < 0.000005);
  const air = step(s, { ...W, jump: true }, DT, flat, LIMITS);
  assert.equal(gaitBob(air), 0);
});

// E3.3 · jumping and walking to a point

test('a jump on flat ground goes up and comes back down in the time of the Moon gravity (± 5 %)', () => {
  let s = step(standAt(0, 0), { ...NONE, jump: true }, DT, flat, LIMITS);
  let t = DT, top = s.air;
  while (s.air > 0 && t < 10) { s = step(s, NONE, DT, flat, LIMITS); t += DT; top = Math.max(top, s.air); }
  const expected = 2 * JUMP_SPEED_KMS / MOON_GRAVITY_KMS2; // ~1.6 s
  assert.ok(Math.abs(t - expected) / expected <= 0.05, `${t} s in the air, expected ${expected}`);
  close(top, JUMP_SPEED_KMS ** 2 / (2 * MOON_GRAVITY_KMS2), 0.00002); // ~0.5 m, a jump in the suit
  assert.equal(s.air, 0);
  assert.equal(s.vy, 0);
});

test('no second jump in the air, and in the air you keep your horizontal speed', () => {
  const moving = up(standAt(0, 0, 90), WRUN);
  const s1 = step(moving, { ...WRUN, jump: true }, DT, flat, LIMITS);
  const s2 = step(s1, { ...NONE, jump: true }, DT, flat, LIMITS);
  assert.ok(s2.vy < s1.vy);
  const s3 = run(s2, keysToInput(new Set(['s'])), 0.5); // pressing back in the air changes nothing
  close(s3.vx, RUN_SPEED_KMS, 1e-12);
});

test('walking to a point arrives there and stops', () => {
  let s = step(standAt(0, 0), { ...NONE, goTo: { x: 0.03, z: -0.04 } }, DT, hilly, LIMITS);
  let maxSpeed = 0;
  for (let i = 0; i < 60 * 120 && s.walkTo; i++) { s = step(s, NONE, DT, hilly, LIMITS); maxSpeed = Math.max(maxSpeed, speedOf(s)); }
  assert.equal(s.walkTo, null);
  assert.equal(s.x, 0.03);
  assert.equal(s.z, -0.04);
  assert.ok(maxSpeed <= WALK_SPEED_KMS + 1e-12); // at walking speed
  const after = run(s, NONE, 1, hilly);
  assert.deepEqual([after.x, after.z], [s.x, s.z]);
});

test('a movement key cancels the walk to a point', () => {
  let s = step(standAt(0, 0, 0), { ...NONE, goTo: { x: 0.05, z: 0 } }, DT, flat, LIMITS);
  s = step(s, W, DT, flat, LIMITS);
  assert.equal(s.walkTo, null);
});

test('a walk to a point stops at a wall steeper than 30°', () => {
  const wall = x => (x > 0.01 ? (x - 0.01) * 2 : 0);
  let s = step(standAt(0, 0), { ...NONE, goTo: { x: 0.05, z: 0 } }, DT, wall, LIMITS);
  s = run(s, NONE, 30, wall);
  assert.equal(s.walkTo, null);
  assert.ok(s.x < 0.011);
});

// E3.4 · compass

const shackleton = JSON.parse(readFileSync(new URL('../data/shackleton-rim/meta.json', import.meta.url)));
const frame = createSceneFrame(shackleton.sceneFrame);

test('at the centre of the region the local north is the one of the centre', () => {
  const n = localNorthAt(frame, 0, 0);
  close(Math.min(n, 360 - n), 0, 0.01);
});

test('1 km east of the centre the local north turns what SceneFrame gives (about 3.4° at Shackleton)', () => {
  const n = localNorthAt(frame, 1, 0);
  // the meridian through the point, straight from SceneFrame: two points of the same longitude
  const { lat, lon } = frame.fromScene(1, 0);
  const a = frame.toScene(lat, lon), b = frame.toScene(lat + 0.01, lon);
  const meridian = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360;
  close(n, meridian, 0.01);
  close(n, 3.4, 0.1);
  const w = localNorthAt(frame, -1, 0);
  close(w, 360 - 3.4, 0.1);
});

test('the Sun of the compass is at the azimuth of the series from the local north of the point', () => {
  const sun = { az: 229.72, el: 0.38 };
  const r = compassReading({ frame, x: 1, z: 0, yaw: 100, sun, earth: { az: 10, el: -2 } });
  close(r.sun.az, 229.72 - localNorthAt(frame, 1, 0), 1e-9);
  close(r.sun.dial, 129.72, 1e-9); // on the dial, from where you look
  assert.equal(r.sun.up, true);
  assert.equal(r.earth.up, false);
  // at the centre the series azimuth is the local one
  const c = compassReading({ frame, x: 0, z: 0, yaw: 0, sun });
  close(c.sun.az, 229.72, 0.01);
});

test('where things are for you: ahead, left, right, behind', () => {
  assert.equal(sideOf(90, 100), 'ahead');
  assert.equal(sideOf(90, 0), 'left');
  assert.equal(sideOf(90, 180), 'right');
  assert.equal(sideOf(90, 280), 'behind');
  assert.equal(relativeAngle(350, 10), 20);
  assert.equal(octant(135), 3);
  assert.equal(octant(359), 0);
});

// E3.5 · touch joystick

test('the joystick gives the same input as the equivalent keys', () => {
  const R = 40, eq = (a, b) => { close(a.forward, b.forward, 1e-9); close(a.right, b.right, 1e-9); assert.equal(a.run, b.run); };
  eq(joystickInput(0, -0.9 * R, R), keysToInput(new Set(['w'])));
  eq(joystickInput(0, 0.9 * R, R), keysToInput(new Set(['s'])));
  eq(joystickInput(0.9 * R, 0, R), keysToInput(new Set(['d'])));
  eq(joystickInput(-0.9 * R, 0, R), keysToInput(new Set(['a'])));
  eq(joystickInput(0, -R, R), keysToInput(new Set(['w', 'shift']))); // at the edge it runs
  eq(joystickInput(0, -3 * R, R), keysToInput(new Set(['w', 'shift']))); // beyond the edge, the same
  eq(joystickInput(1, 1, R), NONE); // at rest
});

test('half a tilt walks at half the speed, in its direction', () => {
  const s = up(standAt(0, 0, 0), joystickInput(0, -0.45 * 40, 40));
  close(-s.vz, WALK_SPEED_KMS / 2, 1e-9);
  const m = mergeInputs(W, joystickInput(0, 0, 40));
  close(up(standAt(0, 0, 0), m).vz, -WALK_SPEED_KMS, 1e-9);
});

// Your own suit, seen when you look down

import { suitPose, HIP_SWING, ELBOW_REST } from '../src/core/suit-pose.js';

test('suit: standing still the legs are straight and the forearms forward, so the gloves show', () => {
  const p = suitPose({ phase: 0.3, speed: 0, air: 0 });
  assert.deepEqual(p.hip, [0, 0]);
  assert.deepEqual(p.knee, [0, 0]);
  assert.deepEqual(p.elbow, [ELBOW_REST, ELBOW_REST]);
});

test('suit: walking, the legs swing in turn within the stiffness of the suit, and the arms against them', () => {
  let maxHip = 0;
  for (let i = 0; i < 100; i++) {
    const p = suitPose({ phase: i / 100, speed: WALK_SPEED_KMS, air: 0 });
    close(p.hip[0], -p.hip[1], 1e-9); // half a stride apart
    maxHip = Math.max(maxHip, Math.abs(p.hip[0]));
    assert.ok(p.knee.every(k => k >= 0)); // knees only bend backwards
    assert.ok(Math.sign(p.shoulder[0] - p.shoulder[1]) === Math.sign(p.hip[1] - p.hip[0]) || Math.abs(p.hip[0]) < 1e-9);
  }
  close(maxHip, HIP_SWING.walk, 0.01);
});

test('suit: in the lope the legs swing more and closer together; in the air they tuck', () => {
  let maxHip = 0, maxGap = 0;
  for (let i = 0; i < 100; i++) {
    const p = suitPose({ phase: i / 100, speed: RUN_SPEED_KMS, air: 0 });
    maxHip = Math.max(maxHip, Math.abs(p.hip[0]));
    maxGap = Math.max(maxGap, Math.abs(p.hip[0] - p.hip[1]));
  }
  close(maxHip, HIP_SWING.run, 0.01);
  assert.ok(maxGap < 2 * HIP_SWING.run - 0.1);
  const air = suitPose({ phase: 0, speed: RUN_SPEED_KMS, air: 0.0003 });
  assert.ok(air.knee[0] > 0 && air.knee[0] === air.knee[1]);
});

import { pnTessellate } from '../src/core/pn-triangles.js';
import { bodyTriangles, clipBelow, rigWeights, BONE, SUIT_EYE, HELMET_CUT_Y } from '../src/core/suit-rig.js';
import { armTargets, createArmMotion, SPRINGS } from '../src/core/arm-motion.js';

const tri = (pts, nrm) => [new Float32Array(pts.flat()), new Float32Array(nrm.flat())];

test('PN triangles: level² triangles, the corners stay where they were', () => {
  const [p, n] = tri([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 0, 1], [0, 0, 1], [0, 0, 1]]);
  const out = pnTessellate(p, n, new Float32Array([0, 0, 1, 0, 0, 1]), 3);
  assert.equal(out.positions.length / 9, 9);
  const has = (x, y) => { for (let i = 0; i < out.positions.length; i += 3) if (Math.abs(out.positions[i] - x) < 1e-6 && Math.abs(out.positions[i + 1] - y) < 1e-6) return true; return false; };
  assert.ok(has(0, 0) && has(1, 0) && has(0, 1));
});

test('PN triangles: a flat triangle with its own normal stays flat', () => {
  const [p, n] = tri([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 0, 1], [0, 0, 1], [0, 0, 1]]);
  const out = pnTessellate(p, n, null, 4);
  for (let i = 2; i < out.positions.length; i += 3) close(out.positions[i], 0, 1e-9);
});

test('PN triangles: with the normals of a sphere, the patch bulges out towards the sphere (no facets)', () => {
  const pts = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // a triangle on the unit sphere, normals = the points
  const [p, n] = tri(pts, pts);
  const out = pnTessellate(p, n, null, 4);
  // the centre of the flat triangle is at 1/√3 ≈ 0.577 from the centre of the sphere; the patch comes much closer to 1
  let far = 0;
  for (let i = 0; i < out.positions.length; i += 3) far = Math.max(far, Math.hypot(out.positions[i], out.positions[i + 1], out.positions[i + 2]));
  assert.ok(far > 0.85, `max radius ${far}`);
  // and the normals stay unit
  for (let i = 0; i < out.normals.length; i += 3) close(Math.hypot(out.normals[i], out.normals[i + 1], out.normals[i + 2]), 1, 1e-6);
});

test('PN triangles: two triangles that share an edge meet on it (no cracks)', () => {
  const pts = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]];
  const a = pnTessellate(...tri([pts[0], pts[1], pts[2]], [pts[0], pts[1], pts[2]]), null, 3);
  const b = pnTessellate(...tri([pts[1], pts[0], pts[3]], [pts[1], pts[0], pts[3]]), null, 3);
  // points of a on the edge 0-1 (z = 0 there) must also be points of b
  const onEdge = arr => { const out = []; for (let i = 0; i < arr.length; i += 3) if (Math.abs(arr[i + 2]) < 1e-9) out.push([arr[i], arr[i + 1]]); return out; };
  for (const [x, y] of onEdge(a.positions)) assert.ok(onEdge(b.positions).some(([u, v]) => Math.abs(u - x) < 1e-6 && Math.abs(v - y) < 1e-6), `crack at ${x}, ${y}`);
});

test('suit rig: feet go with the knee, thighs with the hip, gloves with the elbow, the upper arm with the shoulder, the chest with the spine', () => {
  const foot = rigWeights(0.2, 0.05, 0.05);
  assert.equal(foot.index[0], BONE.kneeL); assert.equal(foot.weight[0], 1);
  const thigh = rigWeights(-0.15, 0.7, 0);
  assert.equal(thigh.index[0], BONE.hipR); assert.equal(thigh.weight[0], 1);
  const glove = rigWeights(-0.3, 1.15, 0.55);
  assert.equal(glove.index[0], BONE.elbowR); assert.equal(glove.weight[0], 1);
  const upper = rigWeights(0.32, 1.34, 0.2);
  assert.equal(upper.index[0], BONE.shoulderL); assert.equal(upper.weight[0], 1);
  const chest = rigWeights(0, 1.4, 0.2);
  assert.deepEqual(chest.index, [BONE.spine, BONE.spine]); // the chest bends with the waist
  for (const r of [foot, thigh, glove, upper, chest, rigWeights(0.12, 0.9, 0), rigWeights(0.29, 1.3, 0), rigWeights(0.3, 1.25, 0.32)]) close(r.weight[0] + r.weight[1], 1, 1e-12);
});

test('suit: the helmet goes whole, the body stays, and small hard parts are not smoothed', () => {
  // three pieces: a "helmet" (1.6–1.9 m), a "torso" reaching into it (1.0–1.8 m) and a small hard part on the chest
  const pts = [], idx = [];
  const quad = (y0, y1, z, split = 1) => {
    for (let k = 0; k < split; k++) {
      const a = y0 + (y1 - y0) * k / split, b = y0 + (y1 - y0) * (k + 1) / split, base = pts.length / 3;
      pts.push(0, a, z, 1, a, z, 0, b, z, 1, b, z);
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      if (k > 0) idx.push(base - 2, base - 1, base, base - 1, base + 1, base); // join to the strip below
    }
  };
  quad(1.6, 1.9, 0.5);                // helmet: one piece, all above 1.55
  quad(1.0, 1.8, 0, 400);             // torso: 400 bands up into the helmet, ≥ 500 triangles
  quad(1.38, 1.42, 0.3);              // a control on the chest
  const { cloth, rigid, clothPiece, rigidPiece } = bodyTriangles(new Float32Array(pts), new Uint32Array(idx));
  assert.ok(Math.min(...cloth.map(i => pts[i * 3 + 1])) < 1.01, 'the torso stays');
  assert.equal(rigid.length, 6, 'the control, whole and apart');
  assert.equal(clothPiece.length, cloth.length / 3);
  assert.equal(rigidPiece.length, rigid.length / 3);
  assert.ok(!cloth.concat(rigid).some(i => pts[i * 3 + 2] === 0.5), 'no piece of the helmet');
  assert.ok(SUIT_EYE.y > HELMET_CUT_Y, 'the eyes are above the cut, inside the helmet');
});

// A tube (the torso) from y = 0 to y = 2, of radius 1 round the y axis, made of tall triangles that cross the cut.
function tube(sides = 24) {
  const P = [], N = [], U = [];
  for (let k = 0; k < sides; k++) {
    const a0 = 2 * Math.PI * k / sides, a1 = 2 * Math.PI * (k + 1) / sides;
    const v = (a, y) => [Math.cos(a), y, Math.sin(a)], n = a => [Math.cos(a), 0, Math.sin(a)];
    // outward-facing: (a0, 0), (a0, 2), (a1, 0) and (a1, 0), (a0, 2), (a1, 2)
    for (const [a, y] of [[a0, 0], [a0, 2], [a1, 0], [a1, 0], [a0, 2], [a1, 2]]) { P.push(...v(a, y)); N.push(...n(a)); U.push(a, y); }
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(U) };
}

test('clipBelow: what crosses the cut is cut exactly on it, so the wall stays whole up to it (no hole, no sliver)', () => {
  const t = tube();
  const out = clipBelow(t, 1.2);
  let top = -1;
  for (let i = 1; i < out.positions.length; i += 3) top = Math.max(top, out.positions[i]);
  close(top, 1.2, 1e-6);
  // the area of the wall below the cut is kept: 2π·r·h of the polygon ≈ perimeter × 1.2
  let area = 0;
  for (let i = 0; i < out.positions.length; i += 9) {
    const a = [0, 1, 2].map(c => out.positions[i + c]), b = [0, 1, 2].map(c => out.positions[i + 3 + c]), d = [0, 1, 2].map(c => out.positions[i + 6 + c]);
    const u = b.map((v, c) => v - a[c]), w = d.map((v, c) => v - a[c]);
    area += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
  }
  const perimeter = 24 * 2 * Math.sin(Math.PI / 24);
  close(area, perimeter * 1.2, 1e-4);
  // normals and uvs come along: unit normals, uv v = y on the cut
  for (let i = 0; i < out.normals.length; i += 3) close(Math.hypot(out.normals[i], out.normals[i + 1], out.normals[i + 2]), 1, 1e-6);
  for (let i = 0; i < out.uvs.length / 2; i++) if (Math.abs(out.positions[i * 3 + 1] - 1.2) < 1e-9) close(out.uvs[i * 2 + 1], 1.2, 1e-6);
});

test('clipBelow: the winding of the cut triangles is kept (they still face out)', () => {
  const t = tube(12);
  const out = clipBelow(t, 1.2);
  for (let i = 0; i < out.positions.length; i += 9) {
    const a = [0, 1, 2].map(c => out.positions[i + c]), b = [0, 1, 2].map(c => out.positions[i + 3 + c]), d = [0, 1, 2].map(c => out.positions[i + 6 + c]);
    const u = b.map((v, c) => v - a[c]), w = d.map((v, c) => v - a[c]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const centre = [(a[0] + b[0] + d[0]) / 3, (a[2] + b[2] + d[2]) / 3];
    assert.ok(n[0] * centre[0] + n[2] * centre[1] > 0, 'faces out');
  }
});

// Arms with inertia

test('arms: standing still and not breathing they settle at the posture of the suit', () => {
  const arms = createArmMotion();
  let a;
  for (let i = 0; i < 600; i++) a = arms.update(1 / 60, { phase: 0, speed: 0, air: 0, breathe: false });
  for (const c of ['pitch', 'roll', 'flex']) for (const v of a[c]) close(v, 0, 1e-3);
  assert.equal(a.moving, false);
});

test('arms: walking they swing against the legs, and the swing comes with a lag (inertia), not at once', () => {
  const t = armTargets({ phase: 0.25, speed: WALK_SPEED_KMS, air: 0, breathe: false });
  // phase 0.25: the left leg is fully forward, so the right arm is forward and the left one back
  assert.ok(t.pitch[1] > 0.1 && t.pitch[0] < -0.1, JSON.stringify(t.pitch));
  const arms = createArmMotion();
  const first = arms.update(1 / 60, { phase: 0.25, speed: WALK_SPEED_KMS, air: 0, breathe: false });
  assert.ok(Math.abs(first.pitch[1]) < Math.abs(t.pitch[1]) / 5, 'one frame later it has barely started');
  let a;
  for (let i = 0; i < 60; i++) a = arms.update(1 / 60, { phase: 0.25, speed: WALK_SPEED_KMS, air: 0, breathe: false });
  assert.ok(a.pitch[1] > t.pitch[1] * 0.5, 'after a second it has got there');
});

test('arms: a pendulum in lunar gravity swings slower than on Earth, and the suit damps it (some overshoot, then still)', () => {
  const f = SPRINGS.shoulder.omega / (2 * Math.PI);
  assert.ok(f < 1, `natural frequency ${f.toFixed(2)} Hz`);
  assert.ok(SPRINGS.shoulder.zeta > 0.2 && SPRINGS.shoulder.zeta < 1);
  // a step of the target: it overshoots a little and settles
  const arms = createArmMotion();
  let peak = 0, a;
  for (let i = 0; i < 600; i++) { a = arms.update(1 / 60, { phase: 0, speed: 0, air: 0.001, breathe: false }); peak = Math.max(peak, a.pitch[0]); }
  const target = armTargets({ phase: 0, speed: 0, air: 0.001, breathe: false }).pitch[0];
  assert.ok(peak > target * 1.02, 'overshoots');
  close(a.pitch[0], target, 1e-3);
});

test('arms: speeding up they lag back, braking they go on forward; turning right they lag to the left', () => {
  const go = armTargets({ accel: 0.001, breathe: false }), brake = armTargets({ accel: -0.001, breathe: false });
  assert.ok(go.pitch[0] < 0 && go.pitch[1] < 0);
  assert.ok(brake.pitch[0] > 0 && brake.pitch[1] > 0);
  const right = armTargets({ yawRate: 60, breathe: false });
  assert.ok(right.roll[0] > 0 && right.roll[1] < 0, 'left arm out, right arm in: both to the left');
});

test('arms: breathing moves them a little, and never with reduced motion', () => {
  let maxOn = 0, maxOff = 0;
  for (let t = 0; t < 10; t += 0.1) {
    maxOn = Math.max(maxOn, Math.abs(armTargets({ time: t }).pitch[0]));
    maxOff = Math.max(maxOff, Math.abs(armTargets({ time: t, breathe: false }).pitch[0]));
  }
  assert.ok(maxOn > 0.01 && maxOn < 0.05);
  assert.equal(maxOff, 0);
});

test('arms: the frame rate does not change where they get (substeps)', () => {
  const run = fps => { const arms = createArmMotion(); let a; for (let i = 0; i < fps * 2; i++) a = arms.update(1 / fps, { phase: 0, speed: 0, air: 0.001, breathe: false }); return a.pitch[0]; };
  close(run(30), run(144), 0.01);
});

// Neck, waist and fields of view (as first-person games do)

import { NECK_DOWN_DEG, WAIST_MAX_DEG, PITCH_DOWN_LIMIT_DEG, waistBend, bentEyes, fovForAspect, clampPitch } from '../src/core/foot-camera.js';

test('neck and waist: the head looks down to 35°; further down you bend at the waist; never past 70°', () => {
  assert.equal(NECK_DOWN_DEG + WAIST_MAX_DEG, PITCH_DOWN_LIMIT_DEG);
  assert.equal(clampPitch(-90), -70);
  assert.equal(clampPitch(90), 80);
  assert.equal(waistBend(-20), 0);
  assert.equal(waistBend(-35), 0);
  assert.equal(waistBend(-50), 15);
  assert.equal(waistBend(-90), 35);
});

test('bending at the waist, the eyes go forward and down (over your chest, never into it)', () => {
  const e0 = bentEyes(0);
  close(e0.forward, 0, 1e-12); close(e0.down, 0, 1e-12);
  const e = bentEyes(35);
  assert.ok(e.forward > 0.0003 && e.forward < 0.0005, `forward ${e.forward * 1000} m`);
  assert.ok(e.down > 0.0001 && e.down < 0.0002, `down ${e.down * 1000} m`);
  // footPose: looking 70° down the eyes stand that much forward of your feet, and lower
  const flat0 = () => 0;
  const { position } = footPose({ x: 0, z: 0, yaw: 90, pitch: -70 }, flat0);
  close(position.x, e.forward, 1e-12);
  close(position.y, EYE_HEIGHT_KM - e.down, 1e-12);
});

test('wide screens: the view opens across at most 110°', () => {
  close(fovForAspect(60, 16 / 9, 110), 60, 1e-9); // 16:9 at 60° is 91° across: untouched
  const ultra = fovForAspect(60, 3.6, 110);       // 3.6:1 would be 130° across
  const across = 2 * Math.atan(Math.tan(ultra * Math.PI / 360) * 3.6) * 180 / Math.PI;
  close(across, 110, 1e-6);
});

test('reading the watch the head tilts inside the helmet: the eyes stay where the waist put them, within the neck', () => {
  const flat = () => 0, at = (pitch, headDown) => footPose({ x: 0, z: 0, yaw: 180, pitch, headDown }, flat);
  const gazeOf = ({ position: p, look: l }) => Math.atan2(l.y - p.y, Math.hypot(l.x - p.x, l.z - p.z)) * 180 / Math.PI;
  // standing straight, the head goes 22° down and the eyes do not move
  const level = at(0, 22), still = at(0, 0);
  assert.deepEqual(level.position, still.position);
  close(gazeOf(level), -22, 1e-9);
  // bent at the waist, the eyes are where the bend of the body puts them, and the head stops at the neck limit
  const bent = at(-50, 22), bentStill = at(-50, 0);
  assert.deepEqual(bent.position, bentStill.position);
  close(gazeOf(bent), -(NECK_DOWN_DEG + waistBend(-50)), 1e-9);
});

import { thirdPersonPose, THIRD_PERSON } from '../src/core/foot-camera.js';

test('third person: the camera is behind you and above, looks where you look, and never goes into the ground', () => {
  const flat = () => 0;
  // looking north (azimuth 0, towards −z): the camera is to the south (+z), above your chest
  const { position, look } = thirdPersonPose({ x: 0, z: 0, yaw: 0, pitch: 0 }, flat);
  close(position.z, THIRD_PERSON.distanceKm, 1e-12);
  assert.ok(position.y > THIRD_PERSON.chestKm);
  assert.ok(look.z < 0, 'it looks past you, ahead');
  // looking up steeply, the camera would go under the ground: it stays over it
  const low = thirdPersonPose({ x: 0, z: 0, yaw: 0, pitch: 70 }, flat);
  assert.ok(low.position.y >= THIRD_PERSON.clearKm - 1e-12);
});
