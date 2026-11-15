// The real stars over the site, for the headset (#396; outside it the Mirador keeps the shared field of shared/render/stars.js): the Yale Bright Star Catalogue (viewpoint/assets/stars-bsc5.bin, made by
// pipeline/stars.mjs), each star a point where it really is at that moment (core/star-sky.js), as bright and of the colour
// it looks. One draw call for all of them: a THREE.Points with its own shader.
//
// Why not fixed pixels, as before: random points of 1.6 px, all white, read as a wall painted on a sphere; through the
// lenses of a headset each one turns into a coloured dash and flickers as you turn. Here each star is a soft round point
// (a gaussian) never under about two pixels of the picture it is drawn into, so it stays steady through any resampling;
// its brightness is its real flux, its colour its temperature, and the faint ones fade out as the eye adapts to the
// sunlit ground (limitingMagnitude). The sky turns with the time: a matrix set when the time changes, not every frame.
import * as THREE from 'three';
import { icrfToScene, bvToTemperature, temperatureToRgb, limitingMagnitude } from './core/star-sky.js';

const CATALOGUE = new URL('../assets/stars-bsc5.bin', import.meta.url).href;
/** Size of a star at the limit and its growth with brightness, in pixels of a 1080-pixel-high picture. */
const SIZE = { base: 2.2, perMag: 0.55, max: 7 };

const vertexShader = `
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uLimit;
  uniform float uPxScale;
  uniform vec3 uSize; // base, per magnitude, max
  varying vec3 vColor;
  varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float above = uLimit - aMag;                    // magnitudes brighter than the limit
    vAlpha = clamp(pow(10.0, 0.4 * above), 0.0, 1.0); // fades in over the last magnitude
    float bright = max(above, 0.0);
    gl_PointSize = vAlpha < 0.02 ? 0.0 : uPxScale * min(uSize.x + uSize.y * bright, uSize.z);
    vColor = aColor * (1.0 + 0.35 * bright);       // the brightest are brighter, not only bigger
    #include <logdepthbuf_vertex>
  }`;
const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 d = gl_PointCoord - 0.5;
    float g = exp(-dot(d, d) * 14.0);              // a soft round point, no hard edge to shimmer
    if (g < 0.02) discard;
    gl_FragColor = vec4(vColor * g * vAlpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** The stars as a THREE.Points on a sphere of `radius`, loaded from the catalogue. */
export async function loadStarField(radius) {
  const res = await fetch(CATALOGUE);
  if (!res.ok) throw new Error(`catálogo de estrellas: ${res.status}`);
  const dv = new DataView(await res.arrayBuffer());
  const n = dv.byteLength / 8;
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ra = dv.getUint16(i * 8, true) / 100 * Math.PI / 180, dec = dv.getInt16(i * 8 + 2, true) / 100 * Math.PI / 180;
    pos.set([Math.cos(dec) * Math.cos(ra) * radius, Math.cos(dec) * Math.sin(ra) * radius, Math.sin(dec) * radius], i * 3); // ICRF
    mag[i] = dv.getInt16(i * 8 + 4, true) / 100;
    col.set(temperatureToRgb(bvToTemperature(dv.getInt16(i * 8 + 6, true) / 100)), i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uLimit: { value: 6.5 }, uPxScale: { value: 1 }, uSize: { value: new THREE.Vector3(SIZE.base, SIZE.perMag, SIZE.max) } },
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: true,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;
  points.renderOrder = -1;
  // the size of a star follows the height of what it is drawn into: the screen, an eye of a headset
  const view = new THREE.Vector2();
  // the height of what is drawn into: the canvas, or the picture of an eye (a render target, for the PS VR's lenses)
  let lensScale = 1;
  points.onBeforeRender = renderer => {
    const target = renderer.getRenderTarget();
    const h = target ? target.height : renderer.getDrawingBufferSize(view).y;
    material.uniforms.uPxScale.value = Math.max(0.5, h / 1080) * (target ? lensScale : 1);
  };
  return {
    object: points,
    /** The sky of `site` ({lat, lon}, degrees) at `date`: the whole field turns to where it is then. */
    setSky(site, date) {
      const r = icrfToScene(site, date);
      points.matrix.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      points.matrixWorldNeedsUpdate = true;
    },
    /**
     * Bigger in a picture that a lens magnifies and whose colours it splits (the PS VR): there a star of two pixels
     * comes out as a red, a green and a blue dot apart. `k` times the size; 1 elsewhere.
     */
    setLensScale(k) { lensScale = k; },
    /** How many stars the eye sees, from the elevation of the Sun (core/star-sky.js limitingMagnitude). */
    setSunElevation(el) { material.uniforms.uLimit.value = limitingMagnitude(el); },
  };
}
