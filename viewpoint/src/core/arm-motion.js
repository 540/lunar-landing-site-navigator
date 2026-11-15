// How your arms move inside the suit (E3, #181), so they are not stiff: each joint follows its target through a damped
// spring, as a real arm does, with the inertia of the arm and the suit. Pure: no three.js, no DOM.
//
// The targets add up what moves an arm when you walk on the Moon:
// - the swing of the stride, against the legs (the left arm with the right leg), larger in the lope, with the elbow
//   bending a little more as the arm comes forward;
// - inertia: when you speed up the arms lag back, when you brake they go on forward; when you turn they lag to the side;
// - in the air they rise and open a little for balance, and they drop back when you land;
// - standing, you breathe: the shoulders rise and fall a little, every few seconds (not with «reduce motion»).
// A hanging arm is a pendulum, and a pendulum swings slower in low gravity (ω ∝ √g): on the Moon at about 0.4 of its
// frequency on Earth. The suit damps it (pressure and joints): it settles in a swing or two, not in one.
// Angles in radians, added to the posture of the model: pitch > 0 forward, roll > 0 outwards, flex > 0 bends the elbow.
import { WALK_SPEED_KMS, RUN_SPEED_KMS } from './walk.js';

const EARTH_ARM_HZ = 1.0; // a relaxed arm swings about once a second on Earth
const MOON_FACTOR = Math.sqrt(1.62 / 9.81); // ≈ 0.41
/** Springs: natural frequency (rad/s) and damping ratio (1 = no overshoot). */
export const SPRINGS = {
  shoulder: { omega: 2 * Math.PI * EARTH_ARM_HZ * MOON_FACTOR * 1.6, zeta: 0.42 }, // stiffened a little by the suit
  roll: { omega: 2 * Math.PI * EARTH_ARM_HZ * MOON_FACTOR * 1.8, zeta: 0.5 },
  elbow: { omega: 2 * Math.PI * EARTH_ARM_HZ * MOON_FACTOR * 2.4, zeta: 0.55 },
};
const SWING = { walk: 0.16, run: 0.3 };
const ELBOW_SWING = 0.18;
const ACCEL_LAG = 90; // rad per (km/s²): 1 m/s² of push swings the arms back about 5°
const TURN_LAG = 0.0015; // rad per (°/s) of turning
const AIR = { pitch: 0.3, roll: 0.16, flex: 0.2 };
const BREATH = { hz: 0.22, pitch: 0.025, roll: 0.012, flex: 0.02 };
const MAX_DT = 1 / 120; // substeps, so the springs stay stable at any frame rate
/**
 * The relaxed posture, added to the model's: the Z-2 model stands with its arms raised forward and open, like a mannequin.
 * Relaxed in a pressurised suit the upper arms hang lower and closer to the body, and the elbows stay bent (the suit's
 * neutral position), so the gloves rest in front of the belly, low in the view, as the hands of first-person games.
 */
// With the shoulder in the scye bearing (core/suit-rig.js) the upper arms hang almost straight down and the elbows keep
// the slight bend of a pressurised suit: looking down as far as the suit lets you, the gloves show at the bottom edge.
export const ARM_REST = { pitch: -0.45, roll: -0.15, flex: 0.65 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = v => clamp(v, 0, 1);

/**
 * Targets of the joints for this moment.
 * @param {{phase:number, speed:number, air:number, accel?:number, yawRate?:number, time?:number, breathe?:boolean}} s
 *   phase of the stride; speed (km/s); air: height of a jump (km); accel: forward acceleration (km/s²); yawRate (°/s,
 *   positive turning right); time (s) for breathing
 * @returns {{pitch:[number,number], roll:[number,number], flex:[number,number]}} [left, right]
 */
export function armTargets({ phase = 0, speed = 0, air = 0, accel = 0, yawRate = 0, time = 0, breathe = true }) {
  const walking = clamp01(speed / WALK_SPEED_KMS);
  const loping = clamp01((speed - WALK_SPEED_KMS) / (RUN_SPEED_KMS - WALK_SPEED_KMS));
  const swing = air > 0 ? 0 : walking * (SWING.walk + (SWING.run - SWING.walk) * loping);
  const offset = 0.5 - 0.3 * loping; // as the legs of core/suit-pose.js
  const legL = Math.sin(2 * Math.PI * phase), legR = Math.sin(2 * Math.PI * (phase + offset));
  const lag = clamp(-accel * ACCEL_LAG, -0.25, 0.25);
  const turn = clamp(yawRate * TURN_LAG, -0.12, 0.12);
  const inAir = air > 0 ? 1 : 0;
  const b = breathe ? Math.sin(2 * Math.PI * BREATH.hz * time) : 0;
  const b2 = breathe ? Math.sin(2 * Math.PI * BREATH.hz * 1.37 * time + 1.1) : 0; // a second, slower rhythm: never exactly the same
  const side = (leg, sign, breathPhase) => {
    const forward = swing * leg; // the left arm goes with the right leg: the caller passes the other leg
    return {
      pitch: forward + lag + inAir * AIR.pitch + BREATH.pitch * breathPhase,
      // turning right, the arms lag to the left: outwards for the left arm, inwards for the right
      roll: inAir * AIR.roll + sign * turn + BREATH.roll * breathPhase + 0.04 * loping,
      flex: ELBOW_SWING * Math.max(0, forward) / SWING.run + inAir * AIR.flex + BREATH.flex * breathPhase,
    };
  };
  const L = side(legR, 1, b), R = side(legL, -1, 0.7 * b + 0.3 * b2);
  return { pitch: [L.pitch, R.pitch], roll: [L.roll, R.roll], flex: [L.flex, R.flex] };
}

/** One damped spring per joint channel: x'' = ω²(target − x) − 2ζω x'. */
function springStep(x, v, target, { omega, zeta }, dt) {
  const a = omega * omega * (target - x) - 2 * zeta * omega * v;
  v += a * dt; // semi-implicit Euler: stable with the substeps
  return [x + v * dt, v];
}

/** Arms with inertia. update() returns the angles, and whether they still move (so the scene knows to redraw). */
export function createArmMotion() {
  const channels = ['pitch', 'roll', 'flex'];
  const spring = { pitch: SPRINGS.shoulder, roll: SPRINGS.roll, flex: SPRINGS.elbow };
  const x = { pitch: [0, 0], roll: [0, 0], flex: [0, 0] }, v = { pitch: [0, 0], roll: [0, 0], flex: [0, 0] };
  let time = 0;
  return {
    /** @param {number} dt seconds  @param {object} s as armTargets, without time */
    update(dt, s) {
      time += dt;
      const target = armTargets({ ...s, time });
      let left = Math.min(dt, 0.1);
      while (left > 1e-9) {
        const h = Math.min(MAX_DT, left);
        for (const c of channels) for (const i of [0, 1]) [x[c][i], v[c][i]] = springStep(x[c][i], v[c][i], target[c][i], spring[c], h);
        left -= h;
      }
      const moving = channels.some(c => [0, 1].some(i => Math.abs(v[c][i]) > 1e-4 || Math.abs(target[c][i] - x[c][i]) > 1e-4));
      return { pitch: [...x.pitch], roll: [...x.roll], flex: [...x.flex], moving };
    },
    /** Back to rest at once (going down on foot). */
    reset() { for (const c of channels) { x[c] = [0, 0]; v[c] = [0, 0]; } time = 0; },
  };
}
