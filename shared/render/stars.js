// Star field of the 3D scenes (G1.2b, #286; one field for all of them, #340). Used by the Mirador
// (viewpoint/src/scene.js, through starPoints of sky-meshes.js), the cabin of the role-playing game
// (rolegame/src/cabin/scene.js, idem), the 3D sky of the planner (web/js/common/sky3d.js) and the lander
// (lander/src/scene/world.js). Not by the home, the game's globe (rolegame/src/moon3d.js) or the 2D background
// (web/js/common/sky.js), which are another kind of view.
// Pure: no three.js and no DOM; each scene builds its own THREE.Points (size) from these arrays.
// Same density (STAR_DENSITY per steradian) and brightness (starBrightness) everywhere. Deterministic (Park–Miller
// generator, seed 5): the same sky on every visit.

/** Stars per steradian of sky. */
export const STAR_DENSITY = 300;

/** Degrees the field goes on below the lowest point of the sky a scene can show (#340). */
export const STAR_MARGIN_DEG = 2;

const SEED = 5;
const parkMiller = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/**
 * Number of stars for STAR_DENSITY over the sky from the zenith down to `below` (the sine of the lowest elevation,
 * as in starPositions): the band from u = -below to u = 1 spans 2π(1 + below) steradians.
 */
export const starCount = (below = 0) => Math.round(STAR_DENSITY * 2 * Math.PI * (1 + below));

/** Brightness (0.25 to 1) of a star from a uniform draw r in [0, 1]: most faint, a few bright. */
export const starBrightness = (r) => 0.25 + r ** 4 * 0.75;

/**
 * `below` that takes the field down past `lowestDeg`, the lowest elevation (degrees, negative under the horizon) that
 * a scene can show, plus STAR_MARGIN_DEG. 0 if nothing under the horizon can be seen; 1 at most (the whole sphere).
 */
export function belowFor(lowestDeg, marginDeg = STAR_MARGIN_DEG) {
  const deg = Math.min(90, Math.max(0, marginDeg - lowestDeg));
  return lowestDeg >= 0 ? 0 : Math.sin(deg * Math.PI / 180);
}

/**
 * Positions of `count` stars on a sphere of `radius` around the origin, y up.
 * `below`: share of the sky under the horizon that also gets stars (u = rnd() * (1 + below) - below, with u the
 * sine of the elevation). 0: upper hemisphere only.
 * @returns {Float32Array} count × 3 positions (x, y, z)
 */
export function starPositions(count, radius, { below = 0, seed = SEED } = {}) {
  const positions = new Float32Array(count * 3);
  const rnd = parkMiller(seed);
  for (let i = 0; i < count; i++) {
    const u = rnd() * (1 + below) - below;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    positions.set([radius * s * Math.cos(th), radius * u, radius * s * Math.sin(th)], i * 3);
  }
  return positions;
}

/**
 * Grey colours (r = g = b = starBrightness) of `count` stars, for a THREE.PointsMaterial with vertexColors. Their own
 * generator, so the positions do not change with them.
 * @returns {Float32Array} count × 3 colours
 */
export function starColors(count, { seed = SEED } = {}) {
  const colors = new Float32Array(count * 3);
  const rnd = parkMiller(seed * 7 + 1);
  for (let i = 0; i < count; i++) colors.fill(starBrightness(rnd()), i * 3, i * 3 + 3);
  return colors;
}

/**
 * The field of a scene: starCount(below) stars (times `share`, the cut of a low quality level) on a sphere of
 * `radius`, with their colours.
 * @returns {{count: number, positions: Float32Array, colors: Float32Array}}
 */
export function starField(radius, { below = 0, share = 1, seed = SEED } = {}) {
  const count = Math.round(starCount(below) * share);
  return { count, positions: starPositions(count, radius, { below, seed }), colors: starColors(count, { seed }) };
}
