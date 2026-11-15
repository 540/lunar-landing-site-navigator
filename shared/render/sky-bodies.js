// Angular sizes of the Sun and the Earth seen from the Moon (#336), and how large each view draws them (#342), shared by
// the Mirador (viewpoint/src/scene.js), the game's cabin (rolegame/src/cabin/scene.js), the 3D sky of the planner
// (web/js/common/sky3d.js), its 2D charts (charts.js, sky-polar.js, the map of views/advanced.js) and the lander
// (lander/src/site.js). Pure: no three.js and no DOM.

/** Apparent diameter of the Sun's disc, in degrees. */
export const SUN_DIAMETER_DEG = 0.53;
/** Apparent diameter of the Earth seen from the Moon, in degrees (1.80° to 2.05° along the orbit; 1.9° on average). */
export const EARTH_DIAMETER_DEG = 1.9;

/**
 * Magnification of both bodies in the 3D sky of the planner, so they can be found at a glance. The same for both: the
 * Earth stays 3.6 times wider than the Sun. The relief exaggeration (×3) does not apply to them.
 */
export const PLANNER_SKY_MAGNIFY = 1.5;
/** Magnification of both bodies in the lander, so they read through a cabin window. */
export const LANDER_MAGNIFY = 2;

/**
 * Radius, in CSS px, of the Sun and Earth markers of the 2D charts (2D sky, compass, map of Advanced). The same for both:
 * at those scales a true-size disc would lie about whether the body clears the relief, so they are markers, not to scale.
 */
export const BODY_MARKER_RADIUS_PX = 6;

/**
 * Whether two body markers overlap on screen (centres closer than two radii). Then the one drawn on top, the Earth, is
 * drawn as a ring (its 2 px stroke, no fill), so the Sun underneath still shows even when they coincide (#342).
 * `a` and `b` are `{ x, y }` in CSS px.
 */
export function markersOverlap(a, b, radius = BODY_MARKER_RADIUS_PX) {
  return Math.hypot(a.x - b.x, a.y - b.y) < 2 * radius;
}

/**
 * Width of the Sun's glow sprite (sunTexture) in the Mirador and the cabin, as a share of its distance: their halo, the
 * same as before #342. Its disc at SUN_DIAMETER_DEG is a sprite of its own (sunDiscTexture of sky-meshes.js).
 */
export const SUN_GLOW_SHARE = 0.09;

/**
 * Where the bright core of the Sun's sprite ends (sunTexture of sky-meshes.js and its copy in sky3d.js), as a fraction of the gradient radius: the
 * core is that share of the sprite's width. The glow around it is the halo.
 */
export const SUN_CORE_STOP = 0.085;

/** Radius that a body of `diameterDeg` apparent diameter has at `distance` (same unit as `distance`). */
export function radiusAt(distance, diameterDeg) {
  return distance * Math.tan(diameterDeg / 2 * Math.PI / 180);
}

/**
 * Width of the Sun's sprite at `distance` so that its bright core is `diameterDeg` wide (the real Sun by default), for a
 * gradient whose core ends at `coreStop` (SUN_CORE_STOP by default; the lander's sprite has its own).
 */
export function sunSpriteWidth(distance, diameterDeg = SUN_DIAMETER_DEG, coreStop = SUN_CORE_STOP) {
  return 2 * radiusAt(distance, diameterDeg) / coreStop;
}
