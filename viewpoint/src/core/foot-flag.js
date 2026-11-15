// The flag on foot (E3.6): it is planted where it was, you can pick it up when you are near and carry it on your right arm,
// and plant it again at your feet. Pure: no three.js, no DOM. The rocket and the astronaut never move on foot.
//   planted: it stands on the ground and the figures are those of its point; walking does not change them
//   reach:   planted, and you are within a few metres of it: «Coger la bandera» shows
//   carried: on your arm; the figures are those of where you stand (core/foot-figures.js)
import { dirAzEl } from './direction.js';

/** How close you must be to pick the flag up (km): a few metres. */
export const REACH_KM = 0.004;
/** Where the flag is planted in front of you (km): at your feet, clear of your boots. */
export const PLANT_AHEAD_KM = 0.0008;

/**
 * @param {{carried:boolean, me:{x:number,z:number}, flag:{x:number,z:number}, reachKm?:number}} s positions in km
 * @returns {'planted'|'reach'|'carried'}
 */
export function flagState({ carried, me, flag, reachKm = REACH_KM }) {
  if (carried) return 'carried';
  return Math.hypot(me.x - flag.x, me.z - flag.z) <= reachKm ? 'reach' : 'planted';
}

/** What the action (key F, the button) does in a state: pick up, plant, or nothing (the flag is out of reach). */
export const actionOf = state => (state === 'reach' ? 'grab' : state === 'carried' ? 'plant' : null);

/**
 * Presses the action. Planting needs to be inside the grid of masks, so the flag has figures where it stays.
 * @returns {{carried:boolean, did:'grab'|'plant'|null, blocked?:'outside'}}
 */
export function press(state, { insideGrid }) {
  const action = actionOf(state);
  if (action === 'grab') return { carried: true, did: 'grab' };
  if (action === 'plant') return insideGrid ? { carried: false, did: 'plant' } : { carried: true, did: null, blocked: 'outside' };
  return { carried: false, did: null };
}

/** Going up to the drone: a flag on your arm is planted where you are. */
export const climb = ({ carried }) => ({ carried: false, plant: carried });

/** The point where the flag is planted: a little ahead of you, where you look (km, scene). */
export function plantPoint({ x, z, yaw }, aheadKm = PLANT_AHEAD_KM) {
  const d = dirAzEl(yaw ?? 0, 0);
  return { x: x + d.x * aheadKm, z: z + d.z * aheadKm };
}

/** How far the astronaut and the rockets must shift when they go to a flag point: measured from where they stand, not from the flag. */
export const piecesDelta = (pieces, x, z) => ({ dx: x - pieces.x, dz: z - pieces.z });

/**
 * Bookkeeping of the flag and the pieces (astronaut, rockets) in the scene. Planting on foot moves only the flag; the next
 * moveFlag shifts the pieces from where they stand.
 * @param {{flag:{x:number,z:number}, pieces:{x:number,z:number}}} st
 */
export const plantOnly = (st, x, z) => ({ flag: { x, z }, pieces: { ...st.pieces } });
export const moveWithPieces = (st, x, z) => ({ flag: { x, z }, pieces: { x, z }, ...piecesDelta(st.pieces, x, z) });
