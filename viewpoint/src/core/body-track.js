// Your arms, from the camera (E3, #181): the points of MediaPipe's pose landmarker become the directions of your upper
// arms and forearms, and the astronaut's arms take them. Pure: plain numbers in, plain numbers out, no DOM.
//
// Frames. MediaPipe's world landmarks are in metres round the hips, with the axes of the image: x to the right of the
// image, y down, z away from the camera. The camera faces you, so the right of the image is your left. Here everything
// goes into the frame of your torso, the same as the suit's model: x to your left, y up, z forward (from your right
// shoulder to the left one, from the hips to the shoulders, and their cross product). So it does not matter how you stand
// to the camera: if you turn a little, your arms are still read against your own chest.
import { oneEuro3 } from './one-euro.js';

/** Indices of MediaPipe's pose landmarks (BlazePose, 33 points). */
export const POSE = { nose: 0, leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24 };
/** The points drawn over the camera image: from the shoulders out, as the astronaut's skeleton (gesture-ui.js). */
export const ARM_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = a => Math.hypot(a.x, a.y, a.z);
const unit = a => { const l = len(a) || 1; return scale(a, 1 / l); };
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A world landmark of MediaPipe in a frame with y up and z towards the camera (your forward). */
const fromImage = p => ({ x: p.x, y: -p.y, z: -p.z });

/**
 * The frame of your torso from the world landmarks, or null if the shoulders or the hips are missing.
 * @param {{x:number,y:number,z:number,visibility?:number}[]} world
 * @returns {{origin, x, y, z, width:number}|null} origin: between the shoulders; x, y, z: unit axes; width: of the shoulders (m)
 */
export function torsoFrame(world) {
  const ls = world?.[POSE.leftShoulder], rs = world?.[POSE.rightShoulder], lh = world?.[POSE.leftHip], rh = world?.[POSE.rightHip];
  if (!ls || !rs || !lh || !rh) return null;
  const L = fromImage(ls), R = fromImage(rs), hips = scale(add(fromImage(lh), fromImage(rh)), 0.5);
  const origin = scale(add(L, R), 0.5);
  const across = sub(L, R), width = len(across);
  if (width < 1e-3) return null;
  const x = unit(across);
  const upRaw = sub(origin, hips);
  const y = unit(sub(upRaw, scale(x, dot(upRaw, x)))); // up, square to the shoulders
  const z = cross(x, y); // forward
  return { origin, x, y, z, width };
}

/** A world landmark in the frame of the torso. */
export const inTorso = (frame, p) => { const d = sub(fromImage(p), frame.origin); return { x: dot(d, frame.x), y: dot(d, frame.y), z: dot(d, frame.z) }; };

/** How sure a set of landmarks is: the lowest visibility (MediaPipe gives one per point; 1 if it gives none). */
const sureness = (...ps) => Math.min(...ps.map(p => p?.visibility ?? 1));
/** Below this visibility the arm is not followed; above the second, it is followed fully. */
export const VISIBLE = { from: 0.45, to: 0.75 };

/**
 * The directions of both arms in the frame of the torso (x left, y up, z forward), and how much to follow each one.
 * @param {{x:number,y:number,z:number,visibility?:number}[]} world MediaPipe pose world landmarks
 * @returns {{left:{upper,fore,weight:number}, right:{upper,fore,weight:number}}|null}
 */
export function armDirections(world) {
  const frame = torsoFrame(world);
  if (!frame) return null;
  const side = (s, e, w) => {
    const S = inTorso(frame, world[s]), E = inTorso(frame, world[e]), W = inTorso(frame, world[w]);
    const upper = sub(E, S), fore = sub(W, E);
    const weight = len(upper) > 1e-3 && len(fore) > 1e-3 ? smooth(VISIBLE.from, VISIBLE.to, sureness(world[s], world[e], world[w])) : 0;
    return { upper: unit(upper), fore: unit(fore), weight };
  };
  return { left: side(POSE.leftShoulder, POSE.leftElbow, POSE.leftWrist), right: side(POSE.rightShoulder, POSE.rightElbow, POSE.rightWrist) };
}

/**
 * Whether the pose is the one of looking at a watch on the left wrist: the forearm raised across in front of the chest,
 * the wrist a little under the shoulders and towards the middle, the elbow bent. With the head, it must not be looking up.
 * @param {{x:number,y:number,z:number,visibility?:number}[]} world
 * @param {{pitch:number}|null} [head] the head (core/head-track.js), if the face is seen
 * @returns {number} 0..1, how much the pose is that one
 */
export function watchPose(world, head = null) {
  const frame = torsoFrame(world);
  if (!frame) return 0;
  const p = i => inTorso(frame, world[i]);
  const s = p(POSE.leftShoulder), e = p(POSE.leftElbow), w = p(POSE.leftWrist), u = frame.width;
  const fore = sub(w, e), upper = sub(e, s);
  const sure = smooth(VISIBLE.from, VISIBLE.to, sureness(world[POSE.leftShoulder], world[POSE.leftElbow], world[POSE.leftWrist]));
  // in shoulder widths: the wrist between a shoulder width below the shoulders and a bit above them
  const height = smooth(-1.1, -0.85, (w.y - s.y) / u) * (1 - smooth(0.3, 0.5, (w.y - s.y) / u));
  // towards the middle of the chest: at least a quarter of a shoulder width in from the left shoulder
  const across = smooth(-0.1, 0.25, (s.x - w.x) / u);
  // the forearm more level than upright
  const level = 1 - smooth(0.6, 0.85, Math.abs(fore.y) / (len(fore) || 1));
  // the elbow bent (bentScore), and the head, if seen, not looking up
  const notUp = head ? 1 - smooth(5, 15, head.pitch) : 1;
  return sure * height * across * level * bentScore(upper, fore) * notUp;
}

/** 1 with the elbow bent 60° or more, 0 with the arm straight (under 35°). */
function bentScore(upper, fore) {
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(unit(upper), unit(fore))))) * 180 / Math.PI;
  return smooth(35, 60, angle);
}

/**
 * The gesture over time, with some patience so it neither flickers nor triggers by chance: on after holding the pose a
 * moment, off after leaving it a moment longer.
 * @param {{onAfter?:number, offAfter?:number, threshold?:number}} [opts] seconds, and the score that counts as the pose
 */
export function createWatchGesture({ onAfter = 0.35, offAfter = 0.6, threshold = 0.5 } = {}) {
  let up = false, held = 0;
  return {
    /** @returns {boolean} whether the watch is up */
    update(score, dt) {
      const inPose = score >= threshold;
      held = inPose === up ? 0 : held + dt;
      if (held >= (up ? offAfter : onAfter)) { up = !up; held = 0; }
      return up;
    },
    reset() { up = false; held = 0; },
    get up() { return up; },
  };
}

/**
 * Follows your arms over time: smooths the landmarks (One Euro) and gives the directions and the watch score.
 * @returns {{update:(world:object[]|null, dt:number, head?:{pitch:number}|null) => ({arms:object|null, watch:number}), reset:() => void}}
 */
export function createBodyTracker() {
  const joints = [POSE.leftShoulder, POSE.rightShoulder, POSE.leftElbow, POSE.rightElbow, POSE.leftWrist, POSE.rightWrist, POSE.leftHip, POSE.rightHip];
  const filters = new Map(joints.map(j => [j, oneEuro3({ minCutoff: 1.2, beta: 0.6 })]));
  return {
    update(world, dt, head = null) {
      if (!world) { filters.forEach(f => f.reset()); return { arms: null, watch: 0 }; }
      const smoothed = world.slice();
      for (const j of joints) {
        if (!world[j]) continue;
        const p = filters.get(j).filter(world[j], dt);
        smoothed[j] = { ...p, visibility: world[j].visibility };
      }
      return { arms: armDirections(smoothed), watch: watchPose(smoothed, head) };
    },
    reset() { filters.forEach(f => f.reset()); },
  };
}

/**
 * The hard upper torso, in the frame of the suit's spine (model metres): a box round the chest and the backpack that a
 * followed hand or elbow must not enter. Measured on the Z-2: the torso is ±0.37 m wide, from −0.22 to 0.26 m deep, and
 * from the waist to the neck ring; the arms leave it at |x| ≈ 0.3.
 */
export const TORSO_BOX = { halfWidth: 0.24, front: 0.3, back: -0.3, bottom: -0.3, top: 0.6 };

/** A point out of the torso: pushed to the nearer of its front or its side (spine frame, model metres). */
export function clearOfTorso(p) {
  const b = TORSO_BOX;
  if (Math.abs(p.x) >= b.halfWidth || p.z >= b.front || p.z <= b.back || p.y <= b.bottom || p.y >= b.top) return p;
  const toFront = b.front - p.z, toSide = b.halfWidth - Math.abs(p.x);
  return toFront <= toSide ? { ...p, z: b.front } : { ...p, x: Math.sign(p.x || 1) * b.halfWidth };
}
