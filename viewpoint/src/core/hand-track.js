// Your fingers, from the camera (E3, #181): MediaPipe's hand landmarker gives 21 points of each hand, and here they
// become how much each finger bends, at the knuckle and further along, for the two joints of each finger of the glove
// (core/hand-rig.js). Pure: plain numbers, no DOM.

import { oneEuro } from './one-euro.js';

/** The points of each finger of MediaPipe's hand, from the thumb: the base and three more out to the tip. */
export const FINGER_POINTS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
/** The bones of the hand, drawn over the camera image. */
export const HAND_LINKS = [[0, 1], [0, 5], [5, 9], [9, 13], [13, 17], [0, 17], ...FINGER_POINTS.flatMap(([a, b, c, d]) => [[a, b], [b, c], [c, d]])];

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const angle = (u, v) => {
  const lu = Math.hypot(u.x, u.y, u.z), lv = Math.hypot(v.x, v.y, v.z);
  if (!(lu > 0 && lv > 0)) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (lu * lv))));
};

/**
 * How much each finger bends (radians, 0 straight), for the two joints of a finger of the glove: the first at the knuckle
 * takes the knuckle and a little of the next joint, the second the rest out to the tip (a real finger has three joints).
 * @param {{x:number,y:number,z:number}[]} points 21 landmarks of a hand (world landmarks: metres, any frame)
 * @returns {[number, number][]|null} from the thumb
 */
export function fingerCurls(points) {
  if (!points || points.length < 21) return null;
  const P = i => points[i];
  // Only the bend counts, not how the fingers spread: the bones are seen across the hand (along the knuckles, from the
  // little finger to the index), where the bend shows and the spread does not.
  const k = sub(P(5), P(17)), kl = Math.hypot(k.x, k.y, k.z) || 1, across = { x: k.x / kl, y: k.y / kl, z: k.z / kl };
  const flat = v => { const t = v.x * across.x + v.y * across.y + v.z * across.z; return { x: v.x - across.x * t, y: v.y - across.y * t, z: v.z - across.z * t }; };
  return FINGER_POINTS.map(([a, b, c, d], f) => {
    const bone = (u, v) => sub(P(v), P(u));
    if (f === 0) return [angle(bone(a, b), bone(b, c)), angle(bone(b, c), bone(c, d))]; // the thumb bends across the palm
    // the bone before the finger: from the wrist to its base
    const j1 = angle(flat(bone(0, a)), flat(bone(a, b))), j2 = angle(flat(bone(a, b)), flat(bone(b, c))), j3 = angle(flat(bone(b, c)), flat(bone(c, d)));
    return [j1 + 0.3 * j2, 0.7 * j2 + j3];
  });
}

/**
 * Which of your hands each detected hand is: the one whose wrist the pose sees nearer (both in the image, normalised).
 * Without a pose, by MediaPipe's handedness, which assumes a mirrored (selfie) image: "Left" is your right hand here.
 * @param {{x:number,y:number}[][]} hands the image landmarks of each detected hand (point 0 is the wrist)
 * @param {{x:number,y:number}[]|null} pose the image landmarks of the pose (15 left wrist, 16 right wrist)
 * @param {string[]} [labels] MediaPipe's handedness of each hand
 * @returns {('left'|'right')[]}
 */
export function whichHand(hands, pose, labels = []) {
  return hands.map((h, k) => {
    const w = h?.[0];
    if (pose?.[15] && pose?.[16] && w) {
      const dl = Math.hypot(w.x - pose[15].x, w.y - pose[15].y), dr = Math.hypot(w.x - pose[16].x, w.y - pose[16].y);
      return dl <= dr ? 'left' : 'right';
    }
    return labels[k] === 'Left' ? 'right' : 'left';
  });
}

/** Follows your fingers over time (One Euro on each joint); a hand not seen for a moment lets the glove go back to rest. */
export function createHandTracker({ forgetAfter = 0.4 } = {}) {
  const make = () => ({ f: FINGER_POINTS.map(() => [oneEuro({ minCutoff: 1.5, beta: 0.4 }), oneEuro({ minCutoff: 1.5, beta: 0.4 })]), curl: null, unseen: Infinity });
  const sides = { left: make(), right: make() };
  return {
    /**
     * @param {{side:'left'|'right', world:{x,y,z}[]}[]} seen the hands seen this frame
     * @returns {{left:{curl:[number,number][], weight:number}|null, right:{curl:[number,number][], weight:number}|null}}
     */
    update(seen, dt) {
      const out = {};
      for (const name of ['left', 'right']) {
        const s = sides[name], hand = seen.find(h => h.side === name);
        const curls = hand ? fingerCurls(hand.world) : null;
        if (curls) { s.curl = curls.map((c, f) => [s.f[f][0].filter(c[0], dt), s.f[f][1].filter(c[1], dt)]); s.unseen = 0; }
        else s.unseen += dt;
        // fades out over the moment after it is lost
        const weight = s.curl ? Math.max(0, 1 - s.unseen / forgetAfter) : 0;
        if (weight === 0 && s.curl) { s.curl = null; s.f.forEach(p => p.forEach(x => x.reset())); }
        out[name] = s.curl ? { curl: s.curl, weight } : null;
      }
      return out;
    },
  };
}
