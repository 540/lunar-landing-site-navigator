// On-foot camera of the Mirador (E3.1, #182). Pure: no three.js, no DOM. Units in km; x east, y up, z south; yaw is an
// azimuth in the scene (0° towards -z, 90° towards +x, as core/direction.js), pitch is the elevation of the gaze.
import { dirAzEl } from './direction.js';

/** Height of the eyes over the ground: 1.7 m. */
export const EYE_HEIGHT_KM = 0.0017;
/** Near plane on foot: 8 cm, so neither the ground at your feet nor your own chest is clipped (the drone uses 50 m). */
export const FOOT_NEAR_KM = 0.00008;
/**
 * How far the gaze goes. Up, 80°. Down, as in a pressurised suit: the head barely tilts inside the helmet (NECK_DOWN_DEG)
 * and, to look further down, you bend at the waist (up to WAIST_MAX_DEG more), as astronauts do. So the eyes never look
 * into your own body, and down is limited to 70°.
 */
export const PITCH_LIMIT_DEG = 80;
export const NECK_DOWN_DEG = 35;
export const WAIST_MAX_DEG = 35;
export const PITCH_DOWN_LIMIT_DEG = NECK_DOWN_DEG + WAIST_MAX_DEG;
/** Waist joint, below and a little behind the eyes (km): the eyes swing forward and down round it when you bend. */
export const WAIST_BELOW_EYES_KM = 0.00072;
export const WAIST_BEHIND_EYES_KM = 0.00008;
/**
 * Field of view on a wide screen. A camera with the same vertical field on a 21:9 or wider screen sees more than 120°
 * across, and what is near the edges (your shoulders, your arms) stretches. As in games, the view opens across up to
 * WORLD_MAX_H_DEG and no more: on wider screens the vertical field narrows instead.
 */
export const WORLD_MAX_H_DEG = 110;
/** Field of view on foot, and its limits for + and − (and the wheel or a pinch). */
export const FOOT_FOV_DEG = 60;
export const FOOT_FOV_MIN_DEG = 10;
export const FOOT_FOV_MAX_DEG = 75;
/**
 * Where you stand when you go down: this far back from the flag (on the side away from the Sun) and this far to the
 * side, so the flag is in front of you but does not hide the Sun.
 */
export const STAND_BACK_KM = 0.004;
export const STAND_SIDE_KM = 0.0025;

export const norm360 = deg => ((deg % 360) + 360) % 360;
export const clampPitch = pitch => Math.max(-PITCH_DOWN_LIMIT_DEG, Math.min(PITCH_LIMIT_DEG, pitch));

/** Vertical field of view (°) so that across a screen of this aspect it is no more than maxH degrees. */
export function fovForAspect(verticalDeg, aspect, maxHDeg) {
  const r = Math.PI / 180;
  const capped = 2 * Math.atan(Math.tan(maxHDeg * r / 2) / Math.max(1e-6, aspect)) / r;
  return Math.min(verticalDeg, capped);
}

/** How much you bend at the waist (°, forward) to look down to `pitch`: nothing while the neck is enough. */
export const waistBend = pitch => Math.max(0, Math.min(WAIST_MAX_DEG, -pitch - NECK_DOWN_DEG));

/** Where the eyes go when you bend `bendDeg` at the waist: {forward, down} (km), round the waist joint. */
export function bentEyes(bendDeg) {
  const a = bendDeg * Math.PI / 180, h = WAIST_BELOW_EYES_KM, b = WAIST_BEHIND_EYES_KM;
  // the eyes are (b forward, h up) from the joint; turning that forward by a
  return { forward: b * Math.cos(a) + h * Math.sin(a) - b, down: h - (h * Math.cos(a) - b * Math.sin(a)) };
}
export const clampFov = fov => Math.max(FOOT_FOV_MIN_DEG, Math.min(FOOT_FOV_MAX_DEG, fov));

/**
 * Eyes and the point they look at.
 * @param {{x:number, z:number, yaw:number, pitch:number, air?:number, bob?:number, headDown?:number}} state  air: height of a
 *   jump over the ground (km); bob: the rise of the eyes with the gait (core/walk.js gaitBob); headDown: degrees the head
 *   tilts down inside the helmet on top of `pitch` (reading the watch). It moves only the gaze, not the waist, and never
 *   past what the neck allows over the bend: lowering the eyes with the waist as well, the camera went down further than
 *   the body and into your own arm. lookYaw: where the head turns inside the helmet (an azimuth; by default `yaw`, where
 *   the body faces): the camera's head tracking (core/head-track.js) turns the head, not the body.
 * @param {(x:number, z:number) => number} groundAt
 * @returns {{position:{x:number,y:number,z:number}, look:{x:number,y:number,z:number}}}
 */
export function footPose({ x, z, yaw, pitch, air = 0, bob = 0, headDown = 0, lookYaw = yaw }, groundAt) {
  const p = clampPitch(pitch), bend = waistBend(p);
  // Looking down past the neck, you bend at the waist: the eyes swing forward and down.
  const bent = bentEyes(bend), ahead = dirAzEl(yaw, 0);
  const ex = x + ahead.x * bent.forward, ez = z + ahead.z * bent.forward;
  const position = { x: ex, y: groundAt(x, z) + EYE_HEIGHT_KM + Math.max(0, air) + bob - bent.down, z: ez };
  const d = dirAzEl(lookYaw, Math.max(p - Math.max(0, headDown), -(NECK_DOWN_DEG + bend)));
  return { position, look: { x: ex + d.x, y: position.y + d.y, z: ez + d.z } };
}

/**
 * Where you stand and where you look when you go down at the flag: a few metres back from it, looking at the Sun's
 * azimuth (and at its height, so it sits on the centre of the screen).
 */
export function arrivalAt(flag, sun) {
  const toSun = dirAzEl(sun.az, 0), right = dirAzEl(sun.az + 90, 0);
  return { x: flag.x - toSun.x * STAND_BACK_KM + right.x * STAND_SIDE_KM, z: flag.z - toSun.z * STAND_BACK_KM + right.z * STAND_SIDE_KM, yaw: norm360(sun.az), pitch: clampPitch(sun.el) };
}

/** Turns the gaze by (dYaw, dPitch) degrees, within the pitch limits. */
export const turn = ({ yaw, pitch }, dYaw, dPitch) => ({ yaw: norm360(yaw + dYaw), pitch: clampPitch(pitch + dPitch) });

/**
 * Drag to look: the ground follows the finger (drag right, the view turns left). Degrees per pixel = field of view over
 * the screen height, so it feels the same at any zoom.
 */
export const dragLook = (gaze, dxPx, dyPx, fovDeg, heightPx) => {
  const k = fovDeg / Math.max(1, heightPx);
  return turn(gaze, -dxPx * k, dyPx * k);
};

/** Mouse captured (pointer lock): the view follows the mouse, as in a game. */
export const lockedLook = (gaze, dxPx, dyPx, fovDeg, heightPx) => {
  const k = fovDeg / Math.max(1, heightPx);
  return turn(gaze, dxPx * k, -dyPx * k);
};

/**
 * Third person (E3, #181): the camera behind you and a little above, looking where you look, so you see the astronaut
 * from the back (to try your gestures, or to see where you walk). It orbits round your chest as your gaze turns, and it
 * never goes into the ground.
 */
export const THIRD_PERSON = { distanceKm: 0.0034, chestKm: 0.00125, aboveKm: 0.0005, aheadKm: 0.002, clearKm: 0.00025 };

/**
 * @param {{x:number, z:number, yaw:number, pitch:number, air?:number}} state yaw and pitch: where you look
 * @param {(x:number, z:number) => number} groundAt
 * @returns {{position:{x,y,z}, look:{x,y,z}}}
 */
export function thirdPersonPose({ x, z, yaw, pitch, air = 0 }, groundAt) {
  const T = THIRD_PERSON, d = dirAzEl(yaw, clampPitch(pitch));
  const chest = { x, y: groundAt(x, z) + Math.max(0, air) + T.chestKm, z };
  const position = { x: chest.x - d.x * T.distanceKm, y: chest.y - d.y * T.distanceKm + T.aboveKm, z: chest.z - d.z * T.distanceKm };
  position.y = Math.max(position.y, groundAt(position.x, position.z) + T.clearKm);
  // past you, a little ahead: you stay low in the middle and the horizon shows
  return { position, look: { x: chest.x + d.x * T.aheadKm, y: chest.y + d.y * T.aheadKm, z: chest.z + d.z * T.aheadKm } };
}
