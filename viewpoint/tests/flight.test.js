// Flight between the drone and the ground on foot (E7.1, #496).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLIGHT_MARGIN_KM, createFlightLock, fadeAlpha, flightMode, flightPose, flightScale, pastHalf, shouldFly } from '../src/core/flight.js';
import { dronePose } from '../src/core/drone-pose.js';
import { arrivalAt, footPose, FOOT_FOV_DEG, FOOT_NEAR_KM } from '../src/core/foot-camera.js';

const flat = () => 0;
const flag = { x: 0, z: 0 };
const sun = { az: 200, el: 1.5 };
const drone = { ...dronePose(flag, sun.az, flat), fov: 50, near: 0.05 };
const a = arrivalAt(flag, sun);
const f = footPose({ ...a }, flat);
const foot = { position: f.position, target: f.look, fov: FOOT_FOV_DEG, near: FOOT_NEAR_KM };

test('flightPose: starts exactly on the departure pose and ends exactly on the arrival, both ways', () => {
  for (const [from, to] of [[drone, foot], [foot, drone]]) {
    assert.deepEqual(flightPose(from, to, 0, flat), from);
    assert.deepEqual(flightPose(from, to, 1, flat), to);
    assert.deepEqual(flightPose(from, to, -1, flat), from);
    assert.deepEqual(flightPose(from, to, 2, flat), to);
  }
});

test('flightPose: with a hill between the drone and the flag, no point goes under the ground plus the margin', () => {
  const hill = (x, z) => 0.8 * Math.exp(-((x - 2.5) ** 2 + (z - 0) ** 2) / 0.8); // a hill 800 m high on the way
  const d = { ...dronePose(flag, 180, hill), fov: 50, near: 0.05 };
  const standing = footPose(arrivalAt(flag, { az: 180, el: 0 }), hill);
  const onFoot = { position: standing.position, target: standing.look, fov: 60, near: FOOT_NEAR_KM };
  for (const [from, to] of [[d, onFoot], [onFoot, d]]) {
    for (let i = 1; i < 1000; i++) {
      const p = flightPose(from, to, i / 1000, hill).position;
      assert.ok(p.y >= hill(p.x, p.z) + FLIGHT_MARGIN_KM - 1e-12, `k=${i / 1000}`);
    }
  }
});

test('flightPose: the near plane and the field of view change without leaving their range', () => {
  for (let i = 0; i <= 20; i++) {
    const p = flightPose(drone, foot, i / 20, flat);
    assert.ok(p.near <= drone.near + 1e-12 && p.near >= foot.near - 1e-12);
    assert.ok(p.fov >= Math.min(drone.fov, foot.fov) - 1e-9 && p.fov <= Math.max(drone.fov, foot.fov) + 1e-9);
  }
});

test('flightScale: continuous between the two scales', () => {
  assert.equal(flightScale(1, 0.002, 0), 1);
  assert.ok(Math.abs(flightScale(1, 0.002, 1) - 0.002) < 1e-15);
  let prev = 1;
  for (let i = 1; i <= 100; i++) { const s = flightScale(1, 0.002, i / 100); assert.ok(s <= prev); prev = s; }
});

test('flightMode: «reduce motion» or the low quality level choose the fade', () => {
  assert.equal(flightMode({ reduceMotion: true, qualityLevel: 'alto' }), 'fade');
  assert.equal(flightMode({ reduceMotion: false, qualityLevel: 'bajo' }), 'fade');
  assert.equal(flightMode({ reduceMotion: false, qualityLevel: 'medio' }), 'fly');
  assert.equal(flightMode({ reduceMotion: false, qualityLevel: 'alto' }), 'fly');
  assert.equal(flightMode(), 'fly');
});

test('fadeAlpha: clear at both ends and black at the half', () => {
  assert.equal(fadeAlpha(0), 0);
  assert.equal(fadeAlpha(0.5), 1);
  assert.equal(fadeAlpha(1), 0);
  assert.ok(!pastHalf(0.49) && pastHalf(0.5));
});

test('createFlightLock: a second request during the flight is ignored', () => {
  const lock = createFlightLock();
  assert.equal(lock.start(), true);
  assert.equal(lock.running, true);
  assert.equal(lock.start(), false);
  assert.equal(lock.running, true);
  lock.finish();
  assert.equal(lock.running, false);
  assert.equal(lock.start(), true);
});

test('shouldFly: the headsets and the callers that ask to cut never fly', () => {
  assert.equal(shouldFly(), true);
  assert.equal(shouldFly({ withFlight: true, inXR: false, inPSVR: false }), true);
  assert.equal(shouldFly({ withFlight: false }), false); // startXR, startPSVR, «Restablecer» on foot, the mission viewer
  assert.equal(shouldFly({ inXR: true }), false);
  assert.equal(shouldFly({ inPSVR: true }), false);
});
