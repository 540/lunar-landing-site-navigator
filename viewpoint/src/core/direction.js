// Azimuth/elevation (degrees) to a unit direction in the scene.
// Convention of the prototype (docs/mirador-polo-sur/index.html, dirAzEl): x east, y up, azimuth 0° towards -z.
// Pure and without three.js, so it can be tested with node:test. E0.5 will replace or extend it with SceneFrame.
const D2R = Math.PI / 180;

export function dirAzEl(az, el) {
  const a = az * D2R;
  const e = el * D2R;
  return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: -Math.cos(e) * Math.cos(a) };
}
