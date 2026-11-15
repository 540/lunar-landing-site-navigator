// On foot in virtual reality (WebXR, #396): what the headset, the controllers and the hands give, turned into what the
// walk, the suit and the watch take. Pure: plain numbers and {x, y, z}, no three.js, no WebXR objects.
//
// Frames. The headset gives poses in metres in its own space ('local-floor': y up from the floor, −z ahead when the
// session starts). The scene is in km with azimuth 0° towards −z (core/direction.js). A «rig» places that space in the
// scene: at a point of the ground, turned by an azimuth, scaled ×0.001 (metres to km).
import { joystickInput } from './walk.js';

const DEG = 180 / Math.PI;
/** Metres to km: the scale of the rig. */
export const M_TO_KM = 0.001;

/** Azimuth (°, 0 towards −z, 90 towards +x) and elevation (°) of a direction. */
export function azEl(d) {
  const h = Math.hypot(d.x, d.z);
  return { az: ((Math.atan2(d.x, -d.z) * DEG) + 360) % 360, el: Math.atan2(d.y, h) * DEG };
}

/** The direction −z of a rotation (a quaternion {x, y, z, w}): where a pose looks. */
export function forwardOf(q) {
  const { x, y, z, w } = q;
  return { x: -2 * (x * z + w * y), y: -2 * (y * z - w * x), z: -(1 - 2 * (x * x + y * y)) };
}

/** A point of the headset's space (metres) turned by the rig's azimuth (°) and scaled to km, as an offset in the scene. */
export function toScene(p, rigAz) {
  const a = -rigAz / DEG, c = Math.cos(a), s = Math.sin(a); // the rig turns about y by −azimuth
  return { x: (p.x * c + p.z * s) * M_TO_KM, y: p.y * M_TO_KM, z: (-p.x * s + p.z * c) * M_TO_KM };
}

/** A direction of the headset's space turned by the rig's azimuth (no scale). */
export function dirToScene(d, rigAz) {
  const a = -rigAz / DEG, c = Math.cos(a), s = Math.sin(a);
  return { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
}

/**
 * Where the rig goes so the head is over where you are: you are where your head is (walking in the room moves you too),
 * and the rig carries the rest. `person` (km) is where your head is in the scene, `head` its pose in the headset's space.
 * @returns {{x:number, z:number}} the origin of the rig in the scene (km); its height is the ground under you
 */
export function rigOrigin(person, head, rigAz) {
  const o = toScene({ x: head.x, y: 0, z: head.z }, rigAz);
  return { x: person.x - o.x, z: person.z - o.z };
}

/** How far the head moved in the room since the last frame, in the scene (km): it moves you too. */
export function roomStep(prev, head, rigAz) {
  if (!prev) return { x: 0, z: 0 };
  const d = toScene({ x: head.x - prev.x, y: 0, z: head.z - prev.z }, rigAz);
  return { x: d.x, z: d.z };
}

/**
 * The left stick: to walk, as the touch joystick of E3.5 (core/walk.js joystickInput): at full tilt you run. The stick's
 * y is negative forward. Under the dead zone of the joystick, nothing (sticks drift a little at rest).
 */
export const stickInput = (x, y) => joystickInput(x, y, 1);

/**
 * Turning with the right stick in steps (snap turn), which does not make you sick as a smooth turn can: one step when the
 * stick passes `threshold` to a side, and another only after it goes back under `release`.
 */
export function createSnapTurn({ stepDeg = 30, threshold = 0.7, release = 0.3 } = {}) {
  let armed = true;
  return {
    /** @returns {number} degrees to turn now (positive to the right), usually 0 */
    update(x) {
      if (Math.abs(x) < release) { armed = true; return 0; }
      if (armed && Math.abs(x) >= threshold) { armed = false; return Math.sign(x) * stepDeg; }
      return 0;
    },
  };
}

/**
 * A plain gamepad in the headset (standard mapping: a DualShock 4 with the PS VR, an Xbox pad), for visors without VR
 * controllers: left stick to walk, right stick to turn, the bottom button (✕, A) to jump, the top one (△, Y) for the watch.
 * @param {{axes:number[], pressed:boolean[]}|null} pad
 * @returns {{left:{x,y}, right:{x,y}, jump:boolean, watch:boolean}|null}
 */
export function padInput(pad) {
  if (!pad) return null;
  const a = i => pad.axes[i] ?? 0;
  return { left: { x: a(0), y: a(1) }, right: { x: a(2), y: a(3) }, jump: !!pad.pressed[0], watch: !!pad.pressed[3] };
}

/** The joints of a WebXR hand in the order of MediaPipe's 21 points of a hand (core/hand-track.js). */
export const XR_HAND_JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

/**
 * The 21 points of a hand from its WebXR joints, or null if any is missing (the hand is half out of sight).
 * @param {(name:string) => ({x:number,y:number,z:number}|null)} jointAt
 */
export function handLandmarks(jointAt) {
  const out = [];
  for (const name of XR_HAND_JOINTS) { const p = jointAt(name); if (!p) return null; out.push(p); }
  return out;
}

/**
 * Fingers from a controller, when there are no tracked hands: the trigger bends the index, the grip the other three, and
 * the thumb rests on the stick or the buttons when it touches them. In the shape of core/hand-track.js (two joints a finger).
 * @param {{trigger?:number, squeeze?:number, thumb?:boolean}} c values 0..1 of the trigger and the grip; thumb: touching
 */
export function controllerCurls({ trigger = 0, squeeze = 0, thumb = false }) {
  const bend = (v, a, b) => [0.15 + v * a, 0.1 + v * b];
  return [thumb ? [0.5, 0.45] : [0.15, 0.1], bend(trigger, 1.15, 1.25), bend(squeeze, 1.3, 1.4), bend(squeeze, 1.3, 1.4), bend(squeeze, 1.25, 1.35)];
}

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * How much the left wrist is held as to read a watch: in front of the eyes (within 35° of where you look), near (under
 * 45 cm) and a little below them (from 0 to 35 cm). All in metres of the headset's space.
 * @param {{position:{x,y,z}, forward:{x,y,z}}} head
 * @param {{x:number,y:number,z:number}|null} wrist
 * @returns {number} 0..1, for core/body-track.js createWatchGesture
 */
export function watchScore(head, wrist) {
  if (!wrist) return 0;
  const d = { x: wrist.x - head.position.x, y: wrist.y - head.position.y, z: wrist.z - head.position.z };
  const dist = Math.hypot(d.x, d.y, d.z);
  if (dist < 1e-6) return 0;
  const f = head.forward, fl = Math.hypot(f.x, f.y, f.z) || 1;
  const cos = (d.x * f.x + d.y * f.y + d.z * f.z) / (dist * fl);
  const ahead = smooth(Math.cos(45 / DEG), Math.cos(30 / DEG), cos);
  const near = 1 - smooth(0.4, 0.5, dist);
  const below = smooth(-0.4, -0.33, d.y) * (1 - smooth(0.02, 0.08, d.y));
  return ahead * near * below;
}

/** The height of your eyes over the floor (m), from the first moments in the headset: their median, so a nod does not count. */
export function createEyeHeight({ samples = 45, fallback = 1.6 } = {}) {
  const seen = [];
  let height = null;
  return {
    update(y) {
      if (height !== null || !(y > 0.5 && y < 2.5)) return height ?? fallback;
      seen.push(y);
      if (seen.length >= samples) { const s = [...seen].sort((a, b) => a - b); height = s[s.length >> 1]; }
      return height ?? fallback;
    },
    get value() { return height ?? fallback; },
  };
}
