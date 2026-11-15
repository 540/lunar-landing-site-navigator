// Light on the ground of the cabin (J12.5 #301, J12.7 #303), in three.js: the «Earth visible» layer laid on the relief
// (blue zones with a glowing rim and the 24 h forecast in stripes) and the rover's headlights with their cone in the
// dust. The decisions are in moments.js; this module only draws them (the rover's own shadow is drawn per pixel on the
// ground by scene.js with ownShadowGlsl).
import * as THREE from 'three';
import { earthGroundTexels } from './moments.js';

// ---- Blue zones on the ground ----

/**
 * The texture of the layer over the game grid (`n` cells, `halfKm` from the centre to an edge) and its uniforms.
 * `set(now, soon)` lays the lists of cells; `set(null)` hides the layer (expert, or the layer is off).
 */
export function makeEarthGround(n, halfKm) {
  const tex = new THREE.DataTexture(earthGroundTexels(n), n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const uniforms = {
    uEarth: { value: tex },
    uEarthHalf: { value: halfKm },
    uEarthOn: { value: 0 },
    uEarthTime: { value: 0 },
  };
  return {
    uniforms,
    set(now, soon = []) {
      if (!now) { uniforms.uEarthOn.value = 0; return; }
      tex.image.data.set(earthGroundTexels(n, now, soon));
      tex.needsUpdate = true;
      uniforms.uEarthOn.value = 1;
    },
  };
}

/**
 * Lays the layer on a ground material (in its onBeforeCompile): the world position goes to the fragment, which tints
 * the blue zones, draws a thin bright rim on their edge (the 0.5 contour of the filtered cells, one or two pixels wide
 * at any distance) with a soft glow, and stripes on the zones that will see the Earth within a day. It is added after
 * tone mapping, so it reads in shadow too: seeing the Earth does not depend on the Sun.
 */
export function tintEarth(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vEarthXZ;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEarthXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec2 vEarthXZ;
uniform sampler2D uEarth;
uniform float uEarthHalf, uEarthOn, uEarthTime;`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
if (uEarthOn > 0.5) {
  vec2 eUv = (vEarthXZ + uEarthHalf) / (2.0 * uEarthHalf);
  if (eUv.x > 0.0 && eUv.x < 1.0 && eUv.y > 0.0 && eUv.y < 1.0) {
    vec4 e = texture2D(uEarth, eUv);
    vec3 blue = vec3(0.31, 0.62, 0.94);
    float fill = smoothstep(0.35, 0.65, e.r);
    float w = fwidth(e.r) * 1.6 + 1e-4;
    float line = exp(-pow((e.r - 0.5) / w, 2.0)) * step(0.01, e.r);
    float glow = pow(clamp(1.0 - abs(e.r - 0.5) * 2.0, 0.0, 1.0), 3.0) * step(0.01, e.r);
    float pulse = 0.8 + 0.2 * sin(uEarthTime * 2.1);
    float soon = smoothstep(0.35, 0.65, e.g) * (1.0 - fill);
    float stripe = step(0.6, fract((vEarthXZ.x + vEarthXZ.y) * 80.0));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.8 + blue * 0.07, fill * 0.7);
    gl_FragColor.rgb += blue * (line * 0.75 * pulse + glow * 0.18 + fill * 0.025) + blue * soon * stripe * 0.06;
  }
}`);
}

// ---- Headlights ----

function coneTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,240,215,1)'); g.addColorStop(0.35, 'rgba(255,240,215,.35)'); g.addColorStop(1, 'rgba(255,240,215,0)');
  x.fillStyle = g; x.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The two headlights at the rover's nose, in the rover's group (km, around the ground under the driver): a spot light
 * that lights the ground ahead (no shadow map, cheap) and, when `cone`, a faint additive cone of light in the dust.
 * `eyeKm` is the driver's eye over the ground (the hood is modelled around it). `set(on, intensity)`.
 */
export function makeHeadlights(eyeKm, { cone = true } = {}) {
  const group = new THREE.Group();
  const nose = new THREE.Vector3(0, eyeKm - 0.00112, -0.00284);
  const spot = new THREE.SpotLight(0xffeccc, 0, 0.09, 0.52, 0.65, 0);
  spot.position.copy(nose);
  spot.target.position.set(0, -0.0006, -0.035);
  group.add(spot, spot.target);
  let beam = null;
  if (cone) {
    const length = 0.03, radius = 0.011;
    const geo = new THREE.ConeGeometry(radius, length, 32, 1, true);
    geo.rotateX(Math.PI / 2); // apex backwards …
    geo.translate(0, 0, -length / 2); // … at the nose, opening forwards
    const mat = new THREE.MeshBasicMaterial({ map: coneTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    beam = new THREE.Mesh(geo, mat);
    beam.position.copy(nose);
    beam.rotation.x = -0.035; // a little towards the ground
    beam.frustumCulled = false;
    group.add(beam);
  }
  return {
    group,
    set(on) {
      spot.intensity = on ? 30 : 0;
      spot.visible = on;
      if (beam) { beam.visible = on; beam.material.opacity = on ? 0.09 : 0; }
    },
  };
}
