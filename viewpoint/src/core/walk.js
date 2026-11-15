// Walking on foot (E3.2 #183, E3.3 #184, E3.5 #186), as an astronaut really moves on the Moon. Pure: no three.js, no DOM.
// Units in km and seconds; x east, z south, yaw an azimuth of the scene (core/direction.js).
//
// The physics, with real values:
// - Speeds of the Apollo moonwalks: about 1 m/s walking and 2.2 m/s in the "lope", the bounding run of Apollo 16 and 17.
// - Grip: what you can push against the ground is friction × weight, and the weight is a sixth of the Earth's. So you
//   speed up and brake slowly (about 1 m/s²): starting and stopping take a second or two, and you slide a little.
// - In the air there is nothing to push against: you keep your horizontal speed until you land.
// - A jump in the suit: about half a metre high, a second and a half in the air.
import { dirAzEl } from './direction.js';
import { clampToRegion } from './camera-limits.js';

export const WALK_SPEED_KMS = 0.001; // 1 m/s
export const RUN_SPEED_KMS = 0.0022; // 2.2 m/s, the lope
/** Gravity of the Moon: 1.62 m/s², a sixth of the Earth's. */
export const MOON_GRAVITY_KMS2 = 0.00162;
/** Friction of the boots on the regolith (about 0.6): with the lunar weight, at most ~1 m/s² of push or braking. */
export const GRIP = 0.6;
export const TRACTION_KMS2 = GRIP * MOON_GRAVITY_KMS2;
/** Steeper than this you do not go up: you stop. */
export const MAX_SLOPE_DEG = 30;
/** Take-off speed of a jump in the suit: 1.3 m/s, so about 0.5 m high and 1.6 s in the air. */
export const JUMP_SPEED_KMS = 0.0013;
/** Length of a step (km): it sets the rhythm of the gait, one rise and fall of the eyes per step. */
export const STRIDE_KM = { walk: 0.0008, run: 0.0016 };
/** How far ahead the slope is read (km): wider than one step, so a frame rate does not change it. */
const SLOPE_PROBE_KM = 0.002;
/** A walk to a point ends here: close enough and nearly still. */
const ARRIVE_KM = 0.0002;
const ARRIVE_SPEED_KMS = 0.0003;
/** Joystick: beyond this tilt it runs; up to it, it walks, with the speed growing with the tilt. */
export const JOY_RUN_FROM = 0.9;
/** A move input weaker than this counts as none (a resting joystick). */
const DEAD_ZONE = 0.05;

/** A person standing still at (x, z), looking at `yaw`. */
export const standAt = (x, z, yaw = 0) => ({ x, z, yaw, vx: 0, vz: 0, vy: 0, air: 0, walkTo: null, phase: 0 });

/** The input of the held keys (lower case; 'shift' for Shift). Arrows look; they do not walk. */
export function keysToInput(held) {
  const has = k => held.has(k);
  return {
    forward: (has('w') ? 1 : 0) - (has('s') ? 1 : 0),
    right: (has('d') ? 1 : 0) - (has('a') ? 1 : 0),
    run: has('shift'),
  };
}

/**
 * The input of the virtual joystick, the same as the keys: tilted fully up is W, fully right is D; at the edge it runs
 * (Shift). Screen coordinates: dy grows downwards.
 */
export function joystickInput(dx, dy, radius) {
  const len = Math.hypot(dx, dy) / radius;
  if (!(len > DEAD_ZONE)) return { forward: 0, right: 0, run: false };
  const tilt = Math.min(1, len);
  const run = tilt > JOY_RUN_FROM;
  const k = (run ? 1 : tilt / JOY_RUN_FROM) / len; // unit vector at the run threshold and beyond
  return { forward: -dy / radius * k, right: dx / radius * k, run };
}

/** The input of two sources together (keys and joystick): the vectors add, and running if either runs. */
export const mergeInputs = (a, b) => ({ forward: a.forward + b.forward, right: a.right + b.right, run: a.run || b.run });

/** True if the input asks to move: it cancels a walk to a point. */
export const isMoving = input => Math.hypot(input.forward, input.right) > DEAD_ZONE;

/** Slope (degrees) of the ground going from (x, z) along the unit direction (dx, dz): positive uphill. */
export function slopeAhead(x, z, dx, dz, groundAt, probe = SLOPE_PROBE_KM) {
  const rise = groundAt(x + dx * probe, z + dz * probe) - groundAt(x, z);
  return Math.atan2(rise, probe) * 180 / Math.PI;
}

/** Horizontal speed (km/s). */
export const speedOf = s => Math.hypot(s.vx, s.vz);

/** The velocity the person wants now: from the keys or the joystick, or towards the point of a walk (braking in time). */
function wantedVelocity(state, input, walkTo) {
  if (isMoving(input)) {
    const f = dirAzEl(state.yaw, 0), r = dirAzEl(state.yaw + 90, 0);
    const dx = f.x * input.forward + r.x * input.right, dz = f.z * input.forward + r.z * input.right;
    const norm = Math.hypot(dx, dz);
    const speed = (input.run ? RUN_SPEED_KMS : WALK_SPEED_KMS) * Math.min(1, norm);
    return { vx: dx / norm * speed, vz: dz / norm * speed };
  }
  if (walkTo) {
    const ex = walkTo.x - state.x, ez = walkTo.z - state.z, dist = Math.hypot(ex, ez);
    if (dist === 0) return { vx: 0, vz: 0 };
    // As fast as walking, but no faster than what still lets you stop at the point with the grip you have.
    const speed = Math.min(WALK_SPEED_KMS, Math.sqrt(2 * TRACTION_KMS2 * dist));
    return { vx: ex / dist * speed, vz: ez / dist * speed };
  }
  return { vx: 0, vz: 0 };
}

/**
 * One step of the person.
 * @param {{x:number, z:number, yaw:number, vx:number, vz:number, vy:number, air:number, walkTo:{x:number,z:number}|null, phase:number}} state
 * @param {{forward:number, right:number, run:boolean, jump?:boolean, goTo?:{x:number,z:number}|null}} input
 *   forward and right in [-1, 1] (keys or joystick); goTo starts a walk to that point (a click on the ground)
 * @param {number} dt seconds
 * @param {(x:number, z:number) => number} groundAt
 * @param {{extentKm:number, maxSlopeDeg?:number}} limits
 * @returns the new state (the old one is not changed)
 */
export function step(state, input, dt, groundAt, { extentKm, maxSlopeDeg = MAX_SLOPE_DEG }) {
  let { x, z, vx = 0, vz = 0, vy, air, walkTo, phase = 0 } = state;
  if (input.goTo) walkTo = clampToRegion({ x: input.goTo.x, y: 0, z: input.goTo.z }, extentKm);
  if (isMoving(input)) walkTo = null;
  const onGround = air === 0 && vy === 0;

  // On the ground the boots push towards the wanted velocity, at most with the grip; in the air nothing changes it.
  if (onGround) {
    const want = wantedVelocity({ ...state, x, z }, input, walkTo);
    const ex = want.vx - vx, ez = want.vz - vz, gap = Math.hypot(ex, ez), most = TRACTION_KMS2 * dt;
    if (gap <= most) { vx = want.vx; vz = want.vz; } else { vx += ex / gap * most; vz += ez / gap * most; }
  }

  const speed = Math.hypot(vx, vz);
  if (speed > 0) {
    const ux = vx / speed, uz = vz / speed, len = speed * dt;
    // A wall steeper than the limit stops you (and ends a walk to a point); in the air it does not.
    if (onGround && slopeAhead(x, z, ux, uz, groundAt, Math.max(len, SLOPE_PROBE_KM)) > maxSlopeDeg) {
      vx = vz = 0; walkTo = null;
    } else {
      const p = clampToRegion({ x: x + vx * dt, y: 0, z: z + vz * dt }, extentKm);
      if (p.x !== x + vx * dt) vx = 0; // the edge of the region stops you on that axis
      if (p.z !== z + vz * dt) vz = 0;
      x = p.x; z = p.z;
      // The gait: one rise and fall of the eyes per step (only while walking on the ground).
      if (onGround) phase = (phase + len / (speed > (WALK_SPEED_KMS + RUN_SPEED_KMS) / 2 ? STRIDE_KM.run : STRIDE_KM.walk)) % 1;
    }
  } else phase = 0;

  if (walkTo) {
    const dist = Math.hypot(walkTo.x - x, walkTo.z - z);
    if (dist <= ARRIVE_KM && Math.hypot(vx, vz) <= ARRIVE_SPEED_KMS && air === 0) { x = walkTo.x; z = walkTo.z; vx = vz = 0; walkTo = null; }
  }

  // Jump: only from the ground. Exact under constant gravity, so the frame rate does not change the flight.
  if (input.jump && onGround) vy = JUMP_SPEED_KMS;
  if (air > 0 || vy > 0) {
    air += vy * dt - MOON_GRAVITY_KMS2 * dt * dt / 2;
    vy -= MOON_GRAVITY_KMS2 * dt;
    if (air <= 0) { air = 0; vy = 0; }
  }
  return { x, z, yaw: state.yaw, vx, vz, vy, air, walkTo, phase };
}

/**
 * How much the eyes rise over their standing height with the gait (km): a soft bounce per step that grows with the
 * speed, a few centimetres walking and about ten in the lope. Zero standing still, in the air or with reduced motion.
 */
export function gaitBob(state) {
  if (state.air > 0) return 0;
  const speed = Math.hypot(state.vx ?? 0, state.vz ?? 0);
  if (speed === 0) return 0;
  const amplitude = Math.min(0.0001, speed * 0.045); // 4.5 cm at 1 m/s, 10 cm in the lope
  return amplitude * (1 - Math.cos(2 * Math.PI * (state.phase ?? 0))) / 2;
}
