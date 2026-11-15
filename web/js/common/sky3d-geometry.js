// Geometry of the 3D sky (issue #62). Pure: no DOM and no three.js, so it runs under node:test.
//
// The scene is seen from the observer's eye (the origin), in km, with the convention of the tour
// (viewpoint/src/core/direction.js): x east, y up, azimuth 0° towards -z. Everything is placed by its apparent elevation:
// a point at horizontal distance d and elevation tangent t sits at (d·sin az, d·t, -d·cos az). So a body at
// (azimuth, elevation) and the terrain that hides it line up exactly as in the 2D sky, with no parallax.
//
// Relief (what the visibility port gives, see ports/visibility.js): the tangent of the apparent elevation of the
// terrain on rings around the site. The mesh has one spoke per degree of azimuth, like the horizon mask, and every
// vertex is clamped to the mask of its azimuth; a wall at the outer ring rises to the mask. The silhouette of the
// mesh is therefore the mask itself: the 3D relief hides exactly what the 2D horizon hides.
import { dirAzEl } from '../../../viewpoint/src/core/direction.js';

export { dirAzEl };

const D2R = Math.PI / 180;
export const MOON_RADIUS_KM = 1737.4;
export const SPOKES = 360;
export const DEFAULT_EYE_KM = 0.002;
const FOOT_RING_KM = 0.0005; // ground right under the observer, so the mesh has no hole to look through

/** Ring distances in km, in geometric progression: denser near the site. */
export function ringDistancesKm(minKm = 0.005, maxKm = 30, count = 64) {
  const ratio = Math.pow(maxKm / minKm, 1 / (count - 1));
  const d = Array.from({ length: count }, (_, j) => minKm * Math.pow(ratio, j));
  d[count - 1] = maxKm;
  return d;
}

/** Elevation tangent of a smooth Moon at `dKm` from an eye `eyeKm` above the ground (flat ground that curves away). */
export const smoothTan = (dKm, eyeKm = DEFAULT_EYE_KM) => -eyeKm / dKm - dKm / (2 * MOON_RADIUS_KM);

/** Mask (360 elevations in degrees, one per degree of azimuth) → tangents. */
const maskTangents = mask => Float64Array.from({ length: SPOKES }, (_, a) => Math.tan(mask[a] * D2R));

/**
 * Terrain mesh and horizon wall of a site.
 * @param {{mask: ArrayLike<number>, relief?: {azimuthStepDeg:number, distancesKm:ArrayLike<number>, tan:ArrayLike<number>}|null, eyeKm?: number}} input
 *   relief.tan[j * nAz + k] = elevation tangent at distancesKm[j] along azimuth k·azimuthStepDeg (NaN = no data).
 *   Without relief the ground is a smooth Moon and only the wall carries the horizon.
 * @returns {{terrain: {positions: Float32Array, indices: Uint32Array}, wall: {positions: Float32Array, indices: Uint32Array},
 *   radiusKm: number, cellPerKm: number, clamped: number, samples: number}} clamped = relief samples that were above the mask
 *   and were lowered to it; cellPerKm = cellPerKm(distances), for the regolith of sky3d.js.
 */
export function buildSkyMesh({ mask, relief = null, eyeKm = DEFAULT_EYE_KM }) {
  const limit = maskTangents(mask);
  const outer = relief ? Array.from(relief.distancesKm) : ringDistancesKm();
  const distances = [FOOT_RING_KM, ...outer.filter(d => d > FOOT_RING_KM)];
  const skipped = outer.length - (distances.length - 1);
  const nAz = relief ? Math.round(360 / relief.azimuthStepDeg) : 0;
  const rings = distances.length;
  const positions = new Float32Array(rings * SPOKES * 3);
  let clamped = 0, samples = 0;
  for (let j = 0; j < rings; j++) {
    const d = distances[j];
    for (let a = 0; a < SPOKES; a++) {
      let t = smoothTan(d, eyeKm);
      if (relief && j > 0) {
        const v = relief.tan[(j - 1 + skipped) * nAz + (Math.round(a / relief.azimuthStepDeg) % nAz)];
        if (Number.isFinite(v)) { t = v; samples++; }
      }
      if (t > limit[a]) { t = limit[a]; if (relief && j > 0) clamped++; }
      const az = a * D2R, k = (j * SPOKES + a) * 3;
      positions[k] = d * Math.sin(az);
      positions[k + 1] = d * t;
      positions[k + 2] = -d * Math.cos(az);
    }
  }
  // Two triangles per cell, counter-clockwise seen from above (+y), so the normals point up.
  const indices = new Uint32Array((rings - 1) * SPOKES * 6);
  let n = 0;
  for (let j = 0; j < rings - 1; j++) {
    for (let a = 0; a < SPOKES; a++) {
      const b = (a + 1) % SPOKES;
      const A = j * SPOKES + a, B = j * SPOKES + b, C = A + SPOKES, D = B + SPOKES;
      indices.set([A, B, C, B, D, C], n);
      n += 6;
    }
  }
  // Wall at the outer ring, from the terrain up to the mask: the relief beyond the rings, as a silhouette.
  const radiusKm = distances[rings - 1];
  const wallPositions = new Float32Array(SPOKES * 2 * 3);
  const wallIndices = new Uint32Array(SPOKES * 6);
  for (let a = 0; a < SPOKES; a++) {
    const base = ((rings - 1) * SPOKES + a) * 3;
    wallPositions.set([positions[base], positions[base + 1], positions[base + 2]], a * 6);
    wallPositions.set([positions[base], radiusKm * limit[a], positions[base + 2]], a * 6 + 3);
    const b = (a + 1) % SPOKES;
    wallIndices.set([a * 2, b * 2, a * 2 + 1, b * 2, b * 2 + 1, a * 2 + 1], a * 6); // facing the observer
  }
  return { terrain: { positions, indices }, wall: { positions: wallPositions, indices: wallIndices }, radiusKm, cellPerKm: cellPerKm(outer), clamped, samples };
}

/**
 * Why a mesh of buildSkyMesh cannot be drawn, or null if it can: a vertex that is not a number (a hole of the mask or of
 * the relief that reached the positions) or a terrain with no area at all. The 3D sky says so instead of showing no ground.
 * @returns {'nonFinite'|'empty'|null}
 */
export function meshProblem({ terrain, wall }) {
  if (![terrain.positions, wall.positions].every(p => p.every(Number.isFinite))) return 'nonFinite';
  return terrain.indices.length === 0 || terrain.positions.length === 0 ? 'empty' : null;
}

/** Finest step of the LOLA grids the relief is sampled from (20 m/px near the pole): the mesh never resolves less. */
export const LOLA_CELL_KM = 0.02;

/**
 * Grid step of the mesh per km of distance: the cells grow with the distance, along the rings (the largest jump from one
 * ring to the next over its distance) or across the spokes (1°). The regolith of the 3D sky (#393) only adds what is
 * smaller than max(LOLA_CELL_KM, cellPerKm · distance), as the Mirador does under the step of each mesh.
 */
export function cellPerKm(distancesKm) {
  let most = D2R * (360 / SPOKES);
  for (let j = 1; j < distancesKm.length; j++) if (distancesKm[j - 1] > 0) most = Math.max(most, distancesKm[j] / distancesKm[j - 1] - 1);
  return most;
}

/** Silhouette of a mesh built by buildSkyMesh: the highest elevation (degrees) of its vertices on each spoke. */
export function silhouetteDeg({ terrain, wall }) {
  const top = new Float64Array(SPOKES).fill(-90);
  const scan = (positions, spokeOf) => {
    for (let i = 0; i < positions.length / 3; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const el = Math.atan2(y, Math.hypot(x, z)) / D2R, a = spokeOf(i);
      if (el > top[a]) top[a] = el;
    }
  };
  scan(terrain.positions, i => i % SPOKES);
  scan(wall.positions, i => i >> 1);
  return top;
}

/**
 * Lowest elevation (degrees) of the sky the scene can show with the heights stretched by `stretch`: the lowest point of
 * the mask, which is the silhouette of the relief, as the stretched wall draws it. The stars go down past it (#340).
 */
export function lowestShownDeg(mask, stretch = 1) {
  let low = Infinity;
  for (const el of mask) if (el < low) low = el;
  return Math.atan(stretch * Math.tan(low * D2R)) / D2R;
}

/** Share of the Sun's disc (0–1) above the terrain, from the margin of its centre (degrees). The disc is 0.53° wide. */
export const sunDiscFraction = marginDeg => Math.min(1, Math.max(0, (marginDeg + 0.265) / 0.53));

/**
 * Direction a light comes from for a body at (azimuth, elevation): its real direction, a unit vector. The relief and the
 * bodies are drawn with their heights stretched (×EXAGGERATION in sky3d.js), but the light is not (#339): stretching the
 * picture must not raise the Sun over the ground nor light the flat regolith more. It takes no stretch factor on purpose.
 */
export const lightDir = ({ az, el }) => dirAzEl(az, el);
