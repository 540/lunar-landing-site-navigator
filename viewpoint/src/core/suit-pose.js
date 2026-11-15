// Pose of your own suit on foot (E3, #181): the angles of the joints while you stand, walk, lope or are in the air.
// Pure: no three.js. Angles in radians; a positive hip or shoulder swings the limb forward, a positive knee or elbow bends it.
//
// A pressurised suit is stiff: the legs swing less than in shirt sleeves and the arms barely move. Walking, each leg swings
// once per stride (phase 0..1 of core/walk.js); in the lope of Apollo both legs push off almost together, so their swing
// is out of phase by less than half a stride. In the air the knees tuck a little and the arms rise for balance.
import { WALK_SPEED_KMS, RUN_SPEED_KMS } from './walk.js';

/** Swing of the hips at walking speed and in the lope (rad). */
export const HIP_SWING = { walk: 0.32, run: 0.42 };
/** Arms: the suit lets them swing only a little. */
export const ARM_SWING = 0.12;
/** The neutral posture of a pressurised suit: upper arms a little forward, elbows bent, forearms in front of the belly, so you see your gloves. */
export const ELBOW_REST = 1.05;
export const SHOULDER_REST = 0.35;
const KNEE_SWING = 0.55;
const AIR_KNEE = 0.45;
const AIR_HIP = 0.2;
const AIR_ARMS = 0.25;

const clamp01 = v => Math.max(0, Math.min(1, v));

/**
 * @param {{phase:number, speed:number, air:number}} s  phase of the stride, horizontal speed (km/s), height of a jump (km)
 * @returns {{hip:[number,number], knee:[number,number], shoulder:[number,number], elbow:[number,number]}} [left, right]
 */
export function suitPose({ phase = 0, speed = 0, air = 0 }) {
  if (air > 0) {
    return { hip: [AIR_HIP, AIR_HIP], knee: [AIR_KNEE, AIR_KNEE], shoulder: [SHOULDER_REST + AIR_ARMS, SHOULDER_REST + AIR_ARMS], elbow: [ELBOW_REST, ELBOW_REST] };
  }
  // How much of the gait there is: none standing, full at walking speed; towards the lope the swing grows and the legs
  // move more together.
  const walking = clamp01(speed / WALK_SPEED_KMS);
  const loping = clamp01((speed - WALK_SPEED_KMS) / (RUN_SPEED_KMS - WALK_SPEED_KMS));
  const swing = walking * (HIP_SWING.walk + (HIP_SWING.run - HIP_SWING.walk) * loping);
  const offset = 0.5 - 0.3 * loping; // half a stride walking, less in the lope
  const a = 2 * Math.PI * phase, b = 2 * Math.PI * (phase + offset);
  const leg = t => ({ hip: swing * Math.sin(t) + 0, knee: walking * KNEE_SWING * Math.max(0, Math.sin(t + Math.PI / 2)) + 0 }); // + 0: no -0 at rest
  const L = leg(a), R = leg(b);
  // Arms against the legs: the left arm goes with the right leg.
  const arm = t => SHOULDER_REST + walking * ARM_SWING * Math.sin(t);
  return { hip: [L.hip, R.hip], knee: [L.knee, R.knee], shoulder: [arm(b), arm(a)], elbow: [ELBOW_REST, ELBOW_REST] };
}
