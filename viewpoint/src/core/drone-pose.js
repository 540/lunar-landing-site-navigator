// Initial pose of the tour camera, the drone, and the glide back to it (E2.3, #154). Pure: no three.js, no DOM.
// Units in km, x east, y up, azimuth 0° towards -z (core/direction.js).
import { dirAzEl } from './direction.js';

export const DRONE_DISTANCE_KM = 5; // horizontal distance from the flag
export const DRONE_HEIGHT_KM = 2.5; // above the ground of the flag (or of the drone, if it is higher)
export const FLAG_AIM_KM = 0.3; // the camera looks at this height above the foot of the flag

/** Duration (ms) of the glide back to the initial pose; without it with «reduce motion». */
export const RESET_MS = 600;

/**
 * Drone: to the side of the Sun's direction, so the light rakes across the relief and the shadows show. It looks down
 * at the flag. The same inputs always give the same pose, so «Restablecer» can go back to it exactly.
 * @param {{x:number,z:number}} flag position of the flag in the scene
 * @param {number} sunAz azimuth of the Sun (degrees) when the scene is created
 * @param {(x:number, z:number) => number} groundAt height of the ground at (x, z)
 * @returns {{position:{x:number,y:number,z:number}, target:{x:number,y:number,z:number}}}
 */
export function dronePose(flag, sunAz, groundAt) {
  const flagY = groundAt(flag.x, flag.z);
  const side = dirAzEl(sunAz + 90, 0);
  const x = flag.x + side.x * DRONE_DISTANCE_KM, z = flag.z + side.z * DRONE_DISTANCE_KM;
  return {
    position: { x, y: Math.max(flagY, groundAt(x, z)) + DRONE_HEIGHT_KM, z },
    target: { x: flag.x, y: flagY + FLAG_AIM_KM, z: flag.z },
  };
}

/**
 * Pose between `from` (k = 0) and `to` (k = 1), with a smooth start and end. At k ≥ 1 it is `to` itself, with no
 * rounding of the interpolation, so the last frame of the glide lands exactly on the pose.
 * @param {{position:{x:number,y:number,z:number}, target:{x:number,y:number,z:number}}} from
 * @param {{position:{x:number,y:number,z:number}, target:{x:number,y:number,z:number}}} to
 * @param {number} k progress of the glide, 0 to 1
 */
export function glidePose(from, to, k) {
  if (k >= 1) return { position: { ...to.position }, target: { ...to.target } };
  const e = k <= 0 ? 0 : k * k * (3 - 2 * k);
  const mix = (a, b) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e });
  return { position: mix(from.position, to.position), target: mix(from.target, to.target) };
}
