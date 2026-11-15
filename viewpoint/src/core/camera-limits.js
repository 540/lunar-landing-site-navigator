// Camera limits of the tour (E2.1, #152). Pure: no three.js, no DOM. Units in km, x east, y up, z south.

/** Near plane of the camera (km): 50 m. What is closer than this to the camera is clipped. */
export const CAMERA_NEAR_KM = 0.05;

/** Clearance (km) the camera keeps above the highest ground around it: 60 m. */
export const GROUND_MARGIN_KM = 0.06;

/** Radius (km) around the camera whose ground is considered: the corner of the near plane, near·√2. */
export const GROUND_PROBE_KM = CAMERA_NEAR_KM * Math.SQRT2;

/**
 * Lifts a position that is under the relief up to the highest ground within `probe` of it plus the margin; one above it
 * comes back unchanged. Looking at the highest point (centre and 8 around) and not only under the camera keeps steep
 * walls from reaching the near plane.
 * @param {{x:number,y:number,z:number}} pos
 * @param {(x:number, z:number) => number} groundAt height of the ground at (x, z)
 * @returns {{x:number,y:number,z:number}}
 */
export function clampAboveGround(pos, groundAt, margin = GROUND_MARGIN_KM, probe = GROUND_PROBE_KM) {
  let top = groundAt(pos.x, pos.z);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    top = Math.max(top, groundAt(pos.x + probe * Math.cos(a), pos.z + probe * Math.sin(a)));
  }
  const min = top + margin;
  return pos.y >= min ? { x: pos.x, y: pos.y, z: pos.z } : { x: pos.x, y: min, z: pos.z };
}

/** Keeps (x, z) inside the square region of side `extentKm` centred on the origin. */
export function clampToRegion(pos, extentKm) {
  const half = extentKm / 2;
  return { x: Math.min(half, Math.max(-half, pos.x)), y: pos.y, z: Math.min(half, Math.max(-half, pos.z)) };
}

/** Keeps y at or below `ceilingKm`. */
export function clampBelow(pos, ceilingKm) {
  return pos.y <= ceilingKm ? pos : { x: pos.x, y: ceilingKm, z: pos.z };
}

/**
 * Clamps the camera and the point it looks at together: inside the region, under `ceilingKm` and above the ground.
 * The ceiling holds even after a pan along the camera's up vector (screenSpacePanning), so the drone's ceiling of
 * star-floor.js is a guarantee and not an assumption (#340). Both the tour and the mission viewer use it: the mission
 * viewer's orbit goes down to 0.15 rad under the horizon of its target, so zooming out at a low angle would otherwise
 * take the camera under the relief and show the sky through the back of the ground.
 * @returns {{position:{x:number,y:number,z:number}, target:{x:number,y:number,z:number}, moved:boolean}}
 */
export function limitCamera(position, target, groundAt, extentKm, ceilingKm = Infinity) {
  const limit = v => clampAboveGround(clampBelow(clampToRegion(v, extentKm), ceilingKm), groundAt);
  const p = limit(position), t = limit(target);
  const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
  return { position: p, target: t, moved: !same(p, position) || !same(t, target) };
}
