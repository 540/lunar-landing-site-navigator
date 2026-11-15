// Light of the cabin's ground (fix of J12.1): the same Sun as the map and the rules. Inside the game grid, the cabin
// lights the terrain with the horizon per pixel of the map (map-horizon.png, J4.2: pixelSun of map-light.js), not with
// the shadow map of the Mirador's region, which misses the far relief: so where the engine says «in shadow» the ground
// of the cabin is in shadow too, and where it says Sun, lit. Pure here; the shader in scene.js repeats it in GLSL.
import { pixelSun } from '../map-light.js';

/** Map point (u, v, 0..1, north up) of a scene position (km, x east, z south) over a grid `halfKm` wide each side. */
export function mapUv(x, z, halfKm) {
  return { u: (x + halfKm) / (2 * halfKm), v: (z + halfKm) / (2 * halfKm) };
}

/** Sun fraction 0..1 of the cabin's ground at a scene position, from the map's horizon atlas; null outside the grid. */
export function cabinSunAt(horizon, meta, x, z, halfKm, az, el, penumbra = true) {
  const { u, v } = mapUv(x, z, halfKm);
  if (u <= 0 || u >= 1 || v <= 0 || v >= 1) return null;
  return pixelSun(horizon, meta, u, v, az, el, penumbra);
}

/**
 * Correction per cell so the cabin agrees with the rules at every cell centre: where the atlas and the engine disagree
 * on «lit» at a cell's centre (a few % of cells on real relief: the atlas has 48 directions and 47 m pixels, the cell
 * masks 72 directions), the light of that cell is shifted by the difference, so the centre gets the engine's value and
 * the pixels around it keep their detail. Elsewhere 0. `sunFracOf(i)` is the engine's sun fraction of cell i now.
 * Returns RGBA bytes (R = 128 + 127 × correction) for an n × n texture with nearest filtering.
 */
export function cellCorrections(sunFracOf, n, horizon, meta, az, el, penumbra = true) {
  const out = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i - x) / n;
    const atlas = pixelSun(horizon, meta, (x + 0.5) / n, (y + 0.5) / n, az, el, penumbra);
    const rule = sunFracOf(i);
    // Aim a little past the threshold on the engine's side, so the byte's rounding never flips «lit».
    const target = rule > 0.5 ? Math.max(rule, 0.5 + 2 / 127) : Math.min(rule, 0.5 - 2 / 127);
    const corr = (atlas > 0.5) === (rule > 0.5) ? 0 : target - atlas;
    out[i * 4] = 128 + Math.round(corr * 127);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Sun fraction of the cabin's ground at a cell centre: the atlas plus the cell's correction (as the shader does). */
export const correctedSun = (atlas, byte) => Math.min(1, Math.max(0, atlas + (byte - 128) / 127));

/**
 * The camera's stabiliser (fix of J12.2): pitch, roll and height of the cabin follow the ground through a low-pass
 * filter, so bumps do not shake the view. `s` = { pitch, roll, y } (radians, km) or null; `target` the same from the
 * ground and the suspension; `tau` the time constant in seconds (0.4 with the stabiliser on, 0.08 off).
 * With reduced motion the horizon stays level (pitch and roll 0) and the height is the ground's, unfiltered: a low-pass
 * there left the camera tens of metres under the relief after a jump, because with reduced motion the scene only
 * redraws when something changes (fix: the cabin drew the sky from under the ground at ASCENSO). After a jump of the
 * rover (`jumped`: a route driven from the map, a new game, the first frame) the rig lands on the target at once.
 */
export const STABLE_TAU = 0.4;
export const LOOSE_TAU = 0.08;
export function stabilise(s, target, dtS, { on = true, reduced = false, jumped = false } = {}) {
  if (reduced) return { pitch: 0, roll: 0, y: target.y };
  if (!s || !Number.isFinite(s.y) || jumped) return { ...target };
  const tau = on ? STABLE_TAU : LOOSE_TAU;
  const k = 1 - Math.exp(-Math.max(0, dtS) / tau);
  return {
    pitch: s.pitch + (target.pitch - s.pitch) * k,
    roll: s.roll + (target.roll - s.roll) * k,
    y: s.y + (target.y - s.y) * k,
  };
}

/** A move of the rover longer than this between two frames (km) is a jump, not driving: the rig lands at once. */
export const JUMP_KM = 0.03;
export const jumped = (prev, now) => !prev || Math.hypot(now.x - prev.x, now.z - prev.z) > JUMP_KM;

/** How far the cabin may sink into the ground on a hard bump (km): the eye never goes lower than this under it. */
export const SINK_KM = 0.0002;
/** Height of the rig (km): the filtered height, never under the ground minus SINK_KM. */
export const rigHeight = (y, ground) => Math.max(y, ground - SINK_KM);

/** True while the filtered rig still moves towards its target (the scene keeps drawing until it settles); never with
 * reduced motion, where the rig lands on its target at once. */
export const settling = (s, target, { reduced = false } = {}) => !reduced && Boolean(s) && Boolean(target) && (Math.abs(s.y - target.y) > 1e-7 || Math.abs(s.pitch - target.pitch) > 1e-4 || Math.abs(s.roll - target.roll) > 1e-4);

/** Stored choice of the stabiliser: on unless saved 'off'. */
export const STABILISER_KEY = 'llsn.stabiliser';
export const stabiliserOn = (saved) => saved !== 'off';
