// Everything outside the cabin: relief with the long shadows of the pole baked in, rocks, sky, Sun and Earth.
import * as THREE from 'three';
import { mulberry32 } from '../sim/terrain.js';
import { starField } from '../../../shared/render/stars.js';
import { sunSpriteWidth } from '../../../shared/render/sky-bodies.js';
import {
  EARTH_ANGULAR_DEG, MOON_RADIUS_M, SITE, SUN_ANGULAR_DEG, SUN_CORE_STOP_LANDER, SUN_DISC_STOPS, SUN_HALO_OPACITY,
  SUN_HALO_SHARE, SUN_HALO_STOPS, SUN_SKY_SHARE, skyVector,
} from '../site.js';

const D2R = Math.PI / 180;
const RINGS = 300, SECTORS = 280, R0 = 2.5, GROWTH = 1.0365;
export const CABIN_FLOOR_M = 3.4; // height of the cabin floor over the foot pads

export const curvatureDrop = r => (r * r) / (2 * MOON_RADIUS_M);

function canvasTexture(size, draw, { repeat = false, linear = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Regolith grain: pebbles and craterlets drawn with their shadow away from the Sun, so the tile agrees with the bake.
function grainTexture(sunX, sunZ) {
  return canvasTexture(512, (g, n) => {
    const rand = mulberry32(77);
    g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, n, n);
    const img = g.getImageData(0, 0, n, n), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = 150 + rand() * 70; d[i] = d[i + 1] = d[i + 2] = v; }
    g.putImageData(img, 0, 0);
    const blob = (x, y, r, style) => { for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) { g.fillStyle = style; g.beginPath(); g.ellipse(x + ox, y + oy, r, r, 0, 0, 7); g.fill(); } };
    for (let i = 0; i < 90; i++) {
      const x = rand() * n, y = rand() * n, r = 2 + rand() * rand() * 16;
      blob(x - sunX * r * 0.45, y - sunZ * r * 0.45, r, 'rgba(40,40,40,.55)');
      blob(x + sunX * r * 0.3, y + sunZ * r * 0.3, r * 0.9, 'rgba(235,235,235,.5)');
      blob(x, y, r * 0.78, 'rgba(150,150,150,.75)');
    }
    for (let i = 0; i < 260; i++) {
      const x = rand() * n, y = rand() * n, r = 0.8 + rand() * 2.2, len = r * 5;
      g.strokeStyle = 'rgba(20,20,20,.6)'; g.lineWidth = r * 1.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - sunX * len, y - sunZ * len); g.stroke();
      blob(x, y, r, 'rgba(245,245,245,.9)');
    }
  }, { repeat: true, linear: true });
}

function glowTexture(stops) {
  return canvasTexture(256, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    stops.forEach(([at, colour]) => grad.addColorStop(at, colour));
    g.fillStyle = grad; g.fillRect(0, 0, n, n);
  });
}

function earthTexture() {
  return canvasTexture(512, (g, n) => {
    const rand = mulberry32(2027);
    g.fillStyle = '#1b4f9c'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = i % 3 ? '#3f7a4a' : '#a58e5f';
      g.beginPath(); g.ellipse(rand() * n, n * (0.2 + rand() * 0.6), 20 + rand() * 60, 12 + rand() * 34, rand() * 3, 0, 7); g.fill();
    }
    g.fillStyle = '#f4f7fb'; g.fillRect(0, 0, n, n * 0.07); g.fillRect(0, n * 0.93, n, n * 0.07);
    for (let i = 0; i < 150; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.45})`;
      g.beginPath(); g.ellipse(rand() * n, rand() * n, 14 + rand() * 60, 3 + rand() * 9, (rand() - 0.5) * 0.9, 0, 7); g.fill();
    }
  });
}

function landerShadowTexture() {
  return canvasTexture(256, (g, n) => {
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(n / 2, n * 0.42, n * 0.17, n * 0.3, 0, 0, 7); g.fill();
    g.fillRect(n * 0.3, n * 0.62, n * 0.4, n * 0.12);
    g.lineWidth = n * 0.035; g.strokeStyle = '#000'; g.lineCap = 'round';
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(n / 2 + s * n * 0.14, n * 0.66); g.lineTo(n / 2 + s * n * 0.4, n * 0.93); g.stroke(); g.beginPath(); g.ellipse(n / 2 + s * n * 0.41, n * 0.94, n * 0.06, n * 0.02, 0, 0, 7); g.fill(); }
  });
}

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, rand = mulberry32(seed), seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.72 + rand() * 0.5);
    const k = seen.get(key);
    p.setXYZ(i, p.getX(i) * k, Math.max(-0.25, p.getY(i) * k * 0.7), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export function createWorld(terrain) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const sun = new THREE.Vector3(...skyVector(SITE.sun));
  const earthDir = new THREE.Vector3(...skyVector(SITE.earth));
  const tanEl = Math.tan(SITE.sun.elDeg * D2R), sinEl = Math.sin(SITE.sun.elDeg * D2R);
  const sunH = new THREE.Vector2(sun.x, sun.z).normalize();

  // Polar grid centred on the target: rings grow geometrically, so the detail is where the lander ends up.
  const count = (RINGS + 1) * SECTORS + 1;
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const groundAt = (x, z) => terrain.heightAt(x, z) - curvatureDrop(Math.hypot(x, z));
  const shade = (x, z, eps, cell) => {
    const h = groundAt(x, z);
    const nx = -(groundAt(x + eps, z) - groundAt(x - eps, z)) / (2 * eps), nz = -(groundAt(x, z + eps) - groundAt(x, z - eps)) / (2 * eps);
    const lit = Math.max(0, (nx * sun.x + sun.y + nz * sun.z) / Math.hypot(nx, 1, nz)) / sinEl;
    // March towards the Sun: in shadow if any relief on the way rises over the ray.
    let clear = 1;
    for (let d = Math.max(1.5, eps), k = 0; k < 44 && d < 30000; k++, d *= 1.26) {
      const margin = (h + d * tanEl - groundAt(x + sunH.x * d, z + sunH.y * d)) / (d * 0.012 + 0.15 + cell * 0.1);
      if (margin < clear) { clear = margin; if (clear <= 0) break; }
    }
    return { h, light: Math.min(2.6, lit) * Math.min(1, Math.max(0, clear)) };
  };
  const put = (i, x, z, eps, cell = 0) => {
    const { h, light } = shade(x, z, eps, cell);
    const tone = 0.235 + 0.04 * Math.sin(x * 0.0021 + z * 0.0013) + 0.025 * Math.sin(x * 0.011 - z * 0.017);
    const v = tone * (0.012 + light);
    pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
    col[i * 3] = v * 1.03; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.95;
    uv[i * 2] = x / 26; uv[i * 2 + 1] = z / 26;
  };
  put(0, 0, 0, 1);
  for (let r = 0; r <= RINGS; r++) {
    const radius = R0 * Math.pow(GROWTH, r), eps = Math.max(0.8, radius * 0.012);
    for (let s = 0; s < SECTORS; s++) {
      const a = ((s + (r % 2) * 0.5) / SECTORS) * Math.PI * 2;
      put(1 + r * SECTORS + s, Math.cos(a) * radius, Math.sin(a) * radius, eps, radius * (GROWTH - 1));
    }
  }
  const index = new Uint32Array(SECTORS * 3 + RINGS * SECTORS * 6);
  let n = 0;
  for (let s = 0; s < SECTORS; s++) { index[n++] = 0; index[n++] = 1 + (s + 1) % SECTORS; index[n++] = 1 + s; }
  for (let r = 0; r < RINGS; r++) for (let s = 0; s < SECTORS; s++) {
    const a = 1 + r * SECTORS + s, b = 1 + r * SECTORS + (s + 1) % SECTORS, c = a + SECTORS, d = b + SECTORS;
    if (r % 2) { index[n++] = a; index[n++] = d; index[n++] = c; index[n++] = a; index[n++] = b; index[n++] = d; }
    else { index[n++] = a; index[n++] = b; index[n++] = c; index[n++] = b; index[n++] = d; index[n++] = c; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  const ground = new THREE.MeshBasicMaterial({ vertexColors: true, map: grainTexture(sunH.x, sunH.y) });
  // The grain is sampled at two scales: pebbles at walking distance, craterlets from the air.
  ground.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      'diffuseColor.rgb *= texture2D( map, vMapUv ).rgb * texture2D( map, vMapUv * 0.031 ).rgb * texture2D( map, vMapUv * 0.0017 ).rgb * 3.6;');
  };
  const terrainMesh = new THREE.Mesh(geo, ground);
  terrainMesh.frustumCulled = false;
  scene.add(terrainMesh);

  scene.add(new THREE.AmbientLight(0xffffff, 0.02));
  const sunLight = new THREE.DirectionalLight(0xfff4e2, 3.2);
  sunLight.position.copy(sun);
  scene.add(sunLight);

  // Boulders around the site, each with a long shadow decal.
  const rand = mulberry32(1969), ROCKS = 520;
  const rocks = [0, 1].map(k => new THREE.InstancedMesh(rockGeometry(11 + k), new THREE.MeshLambertMaterial({ color: 0x8d8a86 }), ROCKS / 2));
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
  const shadowTex = canvasTexture(64, (g, s) => { const grad = g.createLinearGradient(0, 0, 0, s); grad.addColorStop(0, 'rgba(0,0,0,.95)'); grad.addColorStop(0.75, 'rgba(0,0,0,.9)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.beginPath(); g.ellipse(s / 2, s / 2, s * 0.46, s * 0.5, 0, 0, 7); g.fill(); });
  const rockShadows = new THREE.InstancedMesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), ROCKS);
  const dummy = new THREE.Object3D(), away = Math.atan2(-sunH.x, -sunH.y);
  for (let i = 0; i < ROCKS; i++) {
    const dist = 14 + 520 * Math.pow(rand(), 1.6), ang = rand() * Math.PI * 2, x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    const size = 0.25 + Math.pow(rand(), 3) * 2.6, y = groundAt(x, z);
    dummy.position.set(x, y, z); dummy.rotation.set(0, rand() * 7, 0); dummy.scale.set(size * (0.8 + rand() * 0.5), size * (0.6 + rand() * 0.5), size);
    dummy.updateMatrix(); rocks[i % 2].setMatrixAt(i >> 1, dummy.matrix);
    dummy.position.set(x, y + 0.04, z); dummy.rotation.set(0, away, 0); dummy.scale.set(size * 1.9, 1, size * 0.75 / tanEl);
    dummy.updateMatrix(); rockShadows.setMatrixAt(i, dummy.matrix);
  }
  rockShadows.frustumCulled = false; rockShadows.renderOrder = 1;
  rocks.forEach(r => { r.frustumCulled = false; scene.add(r); });
  scene.add(rockShadows);

  // Shadow of the lander: it races in from far away and meets the vehicle at touchdown.
  const landerShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
    new THREE.MeshBasicMaterial({ map: landerShadowTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  landerShadow.rotation.y = away; landerShadow.scale.set(11, 1, 9 / tanEl); landerShadow.renderOrder = 2;
  scene.add(landerShadow);

  const flat = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const dust = new THREE.Mesh(flat(), new THREE.MeshBasicMaterial({ map: glowTexture([[0, 'rgba(255,250,240,.0)'], [0.18, 'rgba(235,228,215,.9)'], [0.55, 'rgba(200,195,185,.35)'], [1, 'rgba(180,175,170,0)']]), transparent: true, depthWrite: false, opacity: 0 }));
  dust.renderOrder = 3; scene.add(dust);
  const spot = new THREE.Mesh(flat(), new THREE.MeshBasicMaterial({ map: glowTexture([[0, 'rgba(255,248,225,.85)'], [0.5, 'rgba(255,244,215,.3)'], [1, 'rgba(255,240,200,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  spot.renderOrder = 3; scene.add(spot);

  // Sky: follows the camera, far beyond the relief.
  const sky = new THREE.Group();
  const SKY_R = 190000;
  // The common star field (shared/render/stars.js, #340), over the whole sphere: the relief hides the lower half.
  const stars = starField(SKY_R, { below: 1 });
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(stars.positions, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(stars.colors, 3));
  sky.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false })));

  const sunSprite = (width, stops, opacity) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(stops), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity, toneMapped: false }));
    s.position.copy(sun).multiplyScalar(SKY_R * SUN_SKY_SHARE); s.scale.setScalar(width);
    sky.add(s);
  };
  // The disc's bright core is SUN_ANGULAR_DEG wide (#342); sizes and gradients in site.js.
  sunSprite(sunSpriteWidth(SKY_R * SUN_SKY_SHARE, SUN_ANGULAR_DEG, SUN_CORE_STOP_LANDER), SUN_DISC_STOPS, 1);
  sunSprite(SKY_R * SUN_HALO_SHARE, SUN_HALO_STOPS, SUN_HALO_OPACITY);

  const EARTH_D = 150000;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_D * Math.tan(EARTH_ANGULAR_DEG * D2R / 2), 48, 32), new THREE.MeshLambertMaterial({ map: earthTexture(), emissive: 0x0a1626 }));
  earth.position.copy(earthDir).multiplyScalar(EARTH_D);
  earth.rotation.set(0.4, 1.1, 0.2);
  sky.add(earth);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([[0, 'rgba(120,170,255,0)'], [0.42, 'rgba(120,170,255,0)'], [0.5, 'rgba(120,175,255,.5)'], [0.6, 'rgba(90,140,255,.12)'], [1, 'rgba(90,140,255,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.copy(earth.position); halo.scale.setScalar(earth.geometry.parameters.radius * 4.1);
  sky.add(halo);
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(70, 1, 1.2, 420000);
  const downCamera = new THREE.PerspectiveCamera(58, 4 / 3, 1.2, 60000);
  const tmp = new THREE.Vector3();

  return {
    scene, camera, downCamera, sun, earthDir, groundAt,
    /** Places what depends on the vehicle: its shadow, the dust it raises and the landing lights. */
    update({ x, y, height, throttle, lights, time }) {
      const reach = (y - groundAt(x, 0)) / tanEl;
      tmp.set(x - sunH.x * reach, 0, -sunH.y * reach);
      landerShadow.position.set(tmp.x, groundAt(tmp.x, tmp.z) + 0.08, tmp.z);
      landerShadow.material.opacity = 0.92 * Math.min(1, 1.2 - height / 1400);
      const gy = groundAt(x, 0);
      const blow = Math.max(0, 1 - height / 45) * Math.min(1, throttle * 2.2);
      dust.visible = blow > 0.01;
      dust.position.set(x, gy + 0.3, 0); dust.scale.setScalar(30 + blow * 70 + Math.sin(time * 9) * 3); dust.rotation.y = time * 0.7;
      dust.material.opacity = blow * 0.3;
      const beam = lights ? Math.max(0, 1 - height / 260) : 0;
      spot.visible = beam > 0.01;
      spot.position.set(x + 4, gy + 0.2, 0); spot.scale.setScalar(26 + height * 0.5); spot.material.opacity = beam * 0.3;
    },
  };
}
