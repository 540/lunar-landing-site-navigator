// Whether the Sun reaches you where you stand on foot (E3, #181). Pure: no three.js. Units in km, as the scene.
//
// Your own suit is drawn apart from the world (the "view model"), so it gets no shadow from the relief's shadow map: walk
// into the shadow of a ridge and the suit would still shine. This walks the relief from your chest towards the Sun and
// says how much of its disc shows (it is half a degree across, and at the pole it grazes the horizon, so often only part
// of it does). It reads the same relief as the shadow map, flat as the scene, without the curvature of the Moon.
import { dirAzEl } from './direction.js';

/** Angular radius of the Sun seen from the Moon (°). */
export const SUN_RADIUS_DEG = 0.267;
/** How far the relief is searched towards the Sun (km): the region is 40 km across. */
export const SEARCH_KM = 30;

/**
 * Elevation (°) of the relief seen from `from` along `az`: the highest angle of the ground over the steps of the walk,
 * which grow geometrically (2 m first, then 4 %), so near bumps and far ridges both count.
 * @param {{x:number, y:number, z:number}} from
 * @param {number} az azimuth in the scene (core/direction.js)
 * @param {(x:number, z:number) => number} groundAt
 * @param {number} [maxKm]
 */
export function horizonElevation(from, az, groundAt, maxKm = SEARCH_KM) {
  const d = dirAzEl(az, 0);
  let best = -90;
  for (let s = 0.002; s <= maxKm; s *= 1.04) {
    const h = groundAt(from.x + d.x * s, from.z + d.z * s);
    best = Math.max(best, Math.atan2(h - from.y, s) * 180 / Math.PI);
  }
  return best;
}

/**
 * Fraction (0..1) of the Sun's disc over the relief seen from `from`: the part of the disc above the horizon at its
 * azimuth, taken as a circle cut by a level line.
 * @param {{az:number, el:number}} sun
 */
export function sunFraction(from, sun, groundAt, maxKm = SEARCH_KM) {
  const top = sun.el + SUN_RADIUS_DEG, horizon = horizonElevation(from, sun.az, groundAt, maxKm);
  if (horizon >= top) return 0;
  if (horizon <= sun.el - SUN_RADIUS_DEG) return 1;
  // area of the circular segment above the line, over the area of the disc
  const h = (top - horizon) / SUN_RADIUS_DEG; // 0..2, height of the segment in radii
  const a = Math.acos(1 - h);
  return (a - (1 - h) * Math.sin(a)) / Math.PI;
}
