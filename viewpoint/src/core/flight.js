// Flight between the drone and the ground on foot (E7.1, #496). Pure: no three.js, no DOM.
// Units in km, x east, y up. A pose is {position, target, fov, near}.

/** Duration (ms) of the flight: about a second and a half. */
export const FLIGHT_MS = 1500;
/** Duration (ms) of the fade to black and back that replaces the flight. */
export const FADE_MS = 400;
/** The flight never goes lower than this over the ground (1 m, under the eye height on foot: 1.7 m). */
export const FLIGHT_MARGIN_KM = 0.001;
/** How much the arc rises over the straight line, as a fraction of the horizontal distance covered. */
export const ARC_LIFT = 0.2;

/**
 * How to change view: «fade» (fade to black, switch, fade back) with «reduce motion» or on the low quality level,
 * «fly» otherwise.
 * @param {{reduceMotion?: boolean, qualityLevel?: string}} s
 * @returns {'fly'|'fade'}
 */
export const flightMode = ({ reduceMotion = false, qualityLevel = 'medio' } = {}) =>
  reduceMotion || qualityLevel === 'bajo' ? 'fade' : 'fly';

/**
 * Whether a change of view flies (or fades) or happens at once: only when the caller does not ask to cut
 * (`withFlight: false`, the mission viewer that opens on foot, «Restablecer» on foot, the headsets' own entry) and
 * neither virtual reality nor the PS VR is on or being entered.
 * @param {{withFlight?: boolean, inXR?: boolean, inPSVR?: boolean}} s
 */
export const shouldFly = ({ withFlight = true, inXR = false, inPSVR = false } = {}) => withFlight && !inXR && !inPSVR;

const smooth = k => k * k * (3 - 2 * k);
const mix = (a, b, e) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e });
const clone = p => ({ position: { ...p.position }, target: { ...p.target }, fov: p.fov, near: p.near });

/**
 * Pose at progress k (0 to 1) of the flight from `from` to `to`, in either direction. k ≤ 0 is `from` and k ≥ 1 is `to`
 * exactly. In between the camera follows an arc (the straight line plus a rise that peaks half way) and never goes
 * below the ground plus FLIGHT_MARGIN_KM; the near plane changes in a geometric progression (so the depth precision
 * stays proportional to the distance to the ground), and the field of view linearly.
 * @param {{position:{x,y,z}, target:{x,y,z}, fov:number, near:number}} from
 * @param {{position:{x,y,z}, target:{x,y,z}, fov:number, near:number}} to
 * @param {number} k
 * @param {(x:number, z:number) => number} groundAt
 */
export function flightPose(from, to, k, groundAt) {
  if (!(k > 0)) return clone(from);
  if (k >= 1) return clone(to);
  const e = smooth(k);
  const position = mix(from.position, to.position, e);
  const run = Math.hypot(to.position.x - from.position.x, to.position.z - from.position.z);
  position.y += ARC_LIFT * run * Math.sin(Math.PI * e);
  position.y = Math.max(position.y, groundAt(position.x, position.z) + FLIGHT_MARGIN_KM);
  const target = mix(from.target, to.target, e);
  return { position, target, fov: from.fov + (to.fov - from.fov) * e, near: from.near * (to.near / from.near) ** e };
}

/** Geometric progression of the scale of what is exaggerated from the drone (flag): `from` at k = 0, `to` at k = 1. */
export const flightScale = (from, to, k) => from * (to / from) ** smooth(Math.min(1, Math.max(0, k)));

/** Where the flight changes what is drawn only in two states (astronaut, rockets): after the half. */
export const pastHalf = k => k >= 0.5;

/** Opacity (0 to 1) of the black veil at progress k of the fade: up to 1 at the half, and back. */
export const fadeAlpha = k => 1 - Math.abs(1 - 2 * Math.min(1, Math.max(0, k)));

/**
 * One change of view at a time: a request while another runs is ignored (it neither restarts it nor leaves it half
 * done). `start()` says whether it took the turn; `finish()` frees it.
 */
export function createFlightLock() {
  let running = false;
  return {
    get running() { return running; },
    start() { if (running) return false; running = true; return true; },
    finish() { running = false; },
  };
}
