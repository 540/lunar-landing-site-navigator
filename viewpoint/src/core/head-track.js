// Your head and your eyes, from the camera (E3, #181): MediaPipe's face landmarker gives 478 points of the face (with the
// irises) and how much each eye looks in, out, up and down. Turning your head or your eyes turns the view, as the head
// trackers of flight simulators do: amplified, so a small turn in front of the screen looks well to the side. Pure.
//
// Frames. The points are normalised to the image (x to the right, y down, z away from the camera, in units of the width).
// The camera faces you, so the right of the image is your left. The head is read in your own frame: yaw > 0 turning to
// your left, pitch > 0 looking up. The view turns the other way round in azimuth (core/direction.js: it grows to the
// right), so the offset for the camera has yaw > 0 to your right.
import { oneEuro } from './one-euro.js';

/** Points of MediaPipe's face mesh. Left and right are yours (the image shows them the other way round). */
export const FACE = {
  noseTip: 1, forehead: 10, chin: 152, rightCheek: 234, leftCheek: 454,
  rightEyeOuter: 33, rightEyeInner: 133, leftEyeInner: 362, leftEyeOuter: 263,
  rightIris: 468, leftIris: 473,
};
/** The rings of the eyes and the irises, drawn over the camera image. */
export const EYE_RINGS = {
  right: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  left: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
  rightIris: [468, 469, 470, 471, 472],
  leftIris: [473, 474, 475, 476, 477],
};

/** How the view follows: degrees of view per degree of head, the reach of the eyes and how much of it the view takes. */
export const HEAD_GAIN = 2;
export const EYE_RANGE_DEG = 30;
export const EYE_GAIN = 0.6;
/** Under this (head degrees) the view does not move: the small sway of a head at rest. */
export const DEAD_ZONE_DEG = 1.5;
/** Past this view offset the body keeps turning that way (°/s per degree past it), so you can turn round with your head. */
export const TURN_FROM_DEG = 65;
export const TURN_RATE = 2.2;
export const LIMIT = { yaw: 100, pitch: 55 };
/** Seconds of the start whose average is your head at rest. */
export const CALIBRATE_S = 0.8;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const deg = r => r * 180 / Math.PI;

/**
 * The head from the face points: yaw > 0 turning to your left, pitch > 0 looking up (degrees), in the frame of the camera.
 * @param {{x:number,y:number,z:number}[]} points normalised landmarks
 * @param {number} aspect width / height of the image (the points are normalised to each side)
 * @returns {{yaw:number, pitch:number}|null}
 */
export function headAngles(points, aspect = 4 / 3) {
  if (!points || points.length < 455) return null;
  // into a frame with x to your left (the right of the image), y up, z towards the camera (your forward), in widths
  const P = i => ({ x: points[i].x * aspect, y: -points[i].y, z: -points[i].z * aspect });
  const across = sub(P(FACE.leftCheek), P(FACE.rightCheek)); // to your left
  const up = sub(P(FACE.forehead), P(FACE.chin));
  const f = cross(across, up); // the way the face looks
  const l = Math.hypot(f.x, f.y, f.z);
  if (l < 1e-9) return null;
  return { yaw: deg(Math.atan2(f.x, f.z)), pitch: deg(Math.atan2(f.y, Math.hypot(f.x, f.z))) };
}

/**
 * Where the eyes look, from the blendshapes of the face landmarker (ARKit names, of your eyes): yaw > 0 to your left,
 * pitch > 0 up, each −1..1. Without blendshapes, from where the irises sit between the corners of the eyes.
 * @param {{categoryName:string, score:number}[]|null} shapes
 * @param {{x:number,y:number,z:number}[]|null} points
 * @returns {{yaw:number, pitch:number}|null}
 */
export function eyeGaze(shapes, points = null) {
  if (shapes?.length) {
    const s = Object.fromEntries(shapes.map(c => [c.categoryName, c.score]));
    const v = n => s[n] ?? 0;
    // to your left: your left eye looks out and your right eye looks in
    const yaw = (v('eyeLookOutLeft') + v('eyeLookInRight') - v('eyeLookInLeft') - v('eyeLookOutRight')) / 2;
    const pitch = (v('eyeLookUpLeft') + v('eyeLookUpRight') - v('eyeLookDownLeft') - v('eyeLookDownRight')) / 2;
    return { yaw: Math.max(-1, Math.min(1, yaw)), pitch: Math.max(-1, Math.min(1, pitch)) };
  }
  if (!points || points.length < 478) return null;
  // the iris between the inner (0) and the outer (1) corner of each eye; 0.5 looks ahead
  const along = (iris, inner, outer) => { const a = points[inner].x, b = points[outer].x; return (points[iris].x - a) / ((b - a) || 1e-9); };
  const left = along(FACE.leftIris, FACE.leftEyeInner, FACE.leftEyeOuter), right = along(FACE.rightIris, FACE.rightEyeInner, FACE.rightEyeOuter);
  // your left eye towards its outer corner, or your right eye towards its inner one, look to your left
  const yaw = ((left - 0.5) - (right - 0.5)) * 2;
  return { yaw: Math.max(-1, Math.min(1, yaw)), pitch: 0 };
}

const dead = (v, z) => (Math.abs(v) <= z ? 0 : v - Math.sign(v) * z);
const clamp = (v, m) => Math.max(-m, Math.min(m, v));

/**
 * The view offset over time: calibrates your head at rest over the first moment, then gives how far to turn the view
 * from where your gaze is (yaw > 0 to the right, pitch > 0 up, degrees) and how fast to keep turning the body.
 */
export function createHeadTracker() {
  const f = { yaw: oneEuro({ minCutoff: 0.8, beta: 0.05 }), pitch: oneEuro({ minCutoff: 0.8, beta: 0.05 }), eyeYaw: oneEuro({ minCutoff: 0.6, beta: 0.3 }), eyePitch: oneEuro({ minCutoff: 0.6, beta: 0.3 }) };
  let neutral = null, sum = { yaw: 0, pitch: 0, t: 0 }, last = { yaw: 0, pitch: 0, turn: 0, head: null };
  return {
    /**
     * @param {{yaw:number,pitch:number}|null} head headAngles
     * @param {{yaw:number,pitch:number}|null} eyes eyeGaze
     * @returns {{yaw:number, pitch:number, turn:number, head:{yaw:number,pitch:number}|null, calibrating:boolean}}
     */
    update(head, eyes, dt) {
      if (!head) { last = { ...last, head: null }; return { ...last, calibrating: !neutral }; }
      const h = { yaw: f.yaw.filter(head.yaw, dt), pitch: f.pitch.filter(head.pitch, dt) };
      if (!neutral) {
        sum = { yaw: sum.yaw + h.yaw * dt, pitch: sum.pitch + h.pitch * dt, t: sum.t + dt };
        if (sum.t >= CALIBRATE_S) neutral = { yaw: sum.yaw / sum.t, pitch: sum.pitch / sum.t };
        last = { yaw: 0, pitch: 0, turn: 0, head: { yaw: 0, pitch: 0 } };
        return { ...last, calibrating: true };
      }
      const rel = { yaw: h.yaw - neutral.yaw, pitch: h.pitch - neutral.pitch };
      const e = eyes ? { yaw: f.eyeYaw.filter(eyes.yaw, dt), pitch: f.eyePitch.filter(eyes.pitch, dt) } : { yaw: 0, pitch: 0 };
      // your left is the view's negative azimuth
      const yaw = clamp(-(dead(rel.yaw, DEAD_ZONE_DEG) * HEAD_GAIN + e.yaw * EYE_RANGE_DEG * EYE_GAIN), LIMIT.yaw);
      const pitch = clamp(dead(rel.pitch, DEAD_ZONE_DEG) * HEAD_GAIN + e.pitch * EYE_RANGE_DEG * EYE_GAIN, LIMIT.pitch);
      const turn = yaw > TURN_FROM_DEG ? (yaw - TURN_FROM_DEG) * TURN_RATE : yaw < -TURN_FROM_DEG ? (yaw + TURN_FROM_DEG) * TURN_RATE : 0;
      last = { yaw, pitch, turn, head: rel };
      return { ...last, calibrating: false };
    },
    /** Your head as it is now becomes the one at rest (over the next moment). */
    recalibrate() { neutral = null; sum = { yaw: 0, pitch: 0, t: 0 }; Object.values(f).forEach(x => x.reset()); },
    get calibrated() { return !!neutral; },
  };
}
