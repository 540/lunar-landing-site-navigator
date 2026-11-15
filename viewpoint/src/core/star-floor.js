// How low the stars of the Mirador must go (#340). Pure: no three.js, no DOM. Units in km.
// From the drone, high over the region, the edge of the far ring (E9.2) lies under the horizon: with the stars only
// from 0° up, a black strip opened between them and the relief. The field goes down past that edge instead.

/** Highest ground of the region (km): the top of the range of its height encoding. */
export const topOfRegionKm = (meta) => meta.heights.offset + 65535 * meta.heights.scale;

/**
 * Highest point of the drone (km): the camera orbits at most `extentKm` from its target (controls.maxDistance in
 * scene.js) over the highest ground. scene.js passes it to limitCamera (core/camera-limits.js) as the ceiling of the
 * camera and of its target, so a pan cannot take the drone higher.
 */
export const droneCeilingKm = (meta) => topOfRegionKm(meta) + meta.extentKm;

/**
 * Lowest elevation (degrees, negative under the horizon) at which the drone can see the edge of the far ring, at its
 * worst: from the drone's ceiling at the edge of the region, towards the nearest point of the ring's edge, as if that
 * point were the lowest of the whole ring (the bottom of its height encoding, which holds the curvature of the Moon).
 * Plus the parallax of a sky of `skyRadiusKm` around the origin, seen from up to that far from it.
 * 0 without a far ring: the relief then ends at the edge of the region and nothing under the horizon is drawn.
 */
export function lowestVisibleDeg(meta, skyRadiusKm) {
  if (!meta.far) return 0;
  const drop = droneCeilingKm(meta) - meta.far.heights.offset;
  const distance = (meta.far.extentKm - meta.extentKm) / 2;
  const half = meta.extentKm / 2, offset = Math.hypot(half, half, droneCeilingKm(meta));
  const parallax = Math.asin(Math.min(1, offset / skyRadiusKm));
  return -(Math.atan(drop / distance) + parallax) * 180 / Math.PI;
}
