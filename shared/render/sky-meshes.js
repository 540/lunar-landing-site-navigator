// Meshes of the lunar sky shared by the 3D scenes (J12.1, #297): the Sun's glow, the Earth globe with its halo and the
// stars. Moved from viewpoint/src/scene.js (the Mirador) so the cabin of the role-playing game draws the same sky.
// Their sizes are in sky-bodies.js (pure).
import * as THREE from 'three';
import { earthMapPixels } from './earth.js';
import { useRealEarth } from './earth-texture.js';
import { SUN_CORE_STOP } from './sky-bodies.js';
import { starField } from './stars.js';

export function sunTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(SUN_CORE_STOP, 'rgba(255,253,246,1)');
  // Dimmed right past the core (#342): with the ×6 and ACES of the Mirador and the cabin, a brighter stop here would
  // read as part of the disc and widen it past SUN_DIAMETER_DEG. The halo further out is unchanged.
  g.addColorStop(0.11, 'rgba(255,232,190,.35)');
  g.addColorStop(0.2, 'rgba(255,205,140,.22)');
  g.addColorStop(0.45, 'rgba(255,180,100,.07)');
  g.addColorStop(1, 'rgba(255,160,60,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The Sun's disc alone (#342): white and opaque to its edge, with a soft rim, so a sprite of the disc's width draws it at
 * that size. The glow (sunTexture) goes on its own sprite around it.
 */
export function sunDiscTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.9, 'rgba(255,253,246,1)');
  g.addColorStop(1, 'rgba(255,253,246,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The Earth seen from the pole: a globe with oceans, continents, ice and clouds (shared/render/earth.js) that turns
// once a sidereal day with the time of the scene, lit by the Sun (its night side dark) and with a thin blue halo.
// `EARTH_RADIUS` is its size in the units of the scene (the Mirador: its real ~1.9°, radiusAt of sky-bodies.js).
const EARTH_TILT = 23.44 * Math.PI / 180;
// `onTexture` runs when the Blue Marble replaces the procedural map, so a scene that renders on demand can redraw.
export function makeEarthGlobe(EARTH_RADIUS, { onTexture } = {}) {
  const map = document.createElement('canvas');
  map.width = 512; map.height = 256;
  map.getContext('2d').putImageData(new ImageData(earthMapPixels(512, 256), 512, 256), 0, 0);
  const texture = new THREE.CanvasTexture(map);
  texture.colorSpace = THREE.SRGBColorSpace;
  useRealEarth(texture, { onChange: onTexture }); // Blue Marble when it loads; the procedural map above until then and if it fails (#487)
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, opacity: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() {
        vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 sunDir; uniform float opacity;
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() {
        vec3 n = normalize(vN);
        float day = smoothstep(-0.08, 0.25, dot(n, sunDir));
        float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 2.5);
        vec3 c = texture2D(map, vUv).rgb * (0.04 + 0.96 * day) + vec3(0.35, 0.55, 1.0) * rim * 0.7 * day;
        gl_FragColor = vec4(c, opacity);
        #include <colorspace_fragment>
      }`,
    transparent: true, fog: false,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 48, 32), material);
  const axis = new THREE.Group(); axis.rotation.z = EARTH_TILT; axis.add(globe);
  // the halo: a soft blue ring around the globe, always facing the camera
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), halo = x.createRadialGradient(64, 64, 40, 64, 64, 64);
  halo.addColorStop(0, 'rgba(110,170,255,.45)'); halo.addColorStop(1, 'rgba(110,170,255,0)');
  x.fillStyle = halo; x.fillRect(0, 0, 128, 128);
  const haloTex = new THREE.CanvasTexture(c); haloTex.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  glow.scale.set(EARTH_RADIUS * 3.2, EARTH_RADIUS * 3.2, 1);
  const g = new THREE.Group(); g.add(glow, axis);
  g.userData = { globe, material, glow };
  return g;
}

// The common star field (stars.js, #340) on a sphere of `radius`: `below` takes it under the horizon (belowFor),
// `share` keeps only part of it (a low quality level).
export function starPoints(radius, { size = 1.6, below = 0, share = 1 } = {}) {
  const { positions, colors } = starField(radius, { below, share });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, fog: false }));
}
