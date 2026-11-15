// 3D sky from the site (issue #62): the relief around the observer with the Sun and the Earth where the 2D sky
// draws them. three.js scene, loaded on demand (import map in index.html, as in viewpoint/). The camera is the observer's
// eye, so azimuth and elevation mean the same as in the 2D chart; the geometry comes from sky3d-geometry.js.
// Heights can be exaggerated: every elevation tangent (relief, Sun, Earth) is multiplied by the same factor, which
// keeps what hides what. The ×3 is only of this 3D view: the 2D chart has no fixed factor (#335).
// Only standard three.js materials (Lambert, Basic, Sprite, Points) and no shadow maps: nothing GPU-specific. The ground
// is the Mirador's (#393): its Lambert with the regolith of viewpoint/src/terrain-material.js (grain, small craters and
// the shoulder before the tone mapping), the same ACES tone and lights (shared/render/lighting.js, #339), and the detail laid on the ground plane, so the
// ×3 of the heights does not stretch it.
// It only builds the stage (canvas and labels) and answers to its controls: the buttons are of whoever shows it
// (sky-view.js).
import { buildSkyMesh, dirAzEl, meshProblem, lightDir, LOLA_CELL_KM, lowestShownDeg, sunDiscFraction } from './sky3d-geometry.js';
import { createTerrainLook } from '../../../viewpoint/src/terrain-material.js'; // the Mirador's ground
import { pixelRatio, readSignals, resolveQuality } from '../../../shared/render/quality.js';
import { earthMapPixels, SIDEREAL_DAY_MS } from '../../../shared/render/earth.js';
import { useRealEarth } from '../../../shared/render/earth-texture.js';
import { t } from './i18n.js';
import { overRelief, skyStateLabel } from './sky-visibility.js';
import { belowFor, starField } from '../../../shared/render/stars.js';
import { EARTH_DIAMETER_DEG, PLANNER_SKY_MAGNIFY, radiusAt, SUN_CORE_STOP, SUN_DIAMETER_DEG, sunSpriteWidth } from '../../../shared/render/sky-bodies.js';
import { theme } from './theme.js';
import { AMBIENT, BOUNCE, EARTH, earthLightElevation, earthLightIntensity, SUN, TONE_MAPPING } from '../../../shared/render/lighting.js';

const WALL_COLOR = 0x6f7175;
// The lights are those of the Mirador and the cabin (shared/render/lighting.js, #339); only the exposure is this view's.
// Without shadow maps the Sun lights by the share of its disc over the relief.
const EXPOSURE = 0.7; // the stretched slopes face the Sun more than the real ones: lower, so the lit ground stays under 120 sRGB
// The step of the mesh under each pixel, km: max(LOLA grid, cellPerKm · distance), as the regolith needs it (#393).
const CELL_GLSL = 'max( uSkyCellMin, uSkyCellPerKm * length( vSurfP.xz ) )';
const FOV = { min: 10, max: 75, start: 40 };
export const EXAGGERATION = 3; // heights ×3 by default (3D only); one button switches to true scale
const PITCH = { min: -30, max: 60 };
const COMPASS = [['N', 0], ['E', 90], ['S', 180], [t('tour.sky3d.west'), 270]];

/** Can this browser create a WebGL context? Checked before three.js tries, so a browser without it logs no error. */
export function hasWebGL() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // free the probe context at once
    return true;
  } catch { return false; }
}

function sunTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(SUN_CORE_STOP, 'rgba(255,253,246,1)');
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

// The common star field (shared/render/stars.js, #340), down past the lowest point of the mask stretched ×EXAGGERATION
// (the most the relief can be stretched): the terrain hides what it must and no black strip is left above it.
function starsOf(THREE, mask, radius) {
  const { positions, colors } = starField(radius, { below: belowFor(lowestShownDeg(mask, EXAGGERATION)) });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.2, sizeAttenuation: false, vertexColors: true, toneMapped: false }));
}

function meshOf(THREE, { positions, indices }, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

const el = (tag, className, text) => { const e = document.createElement(tag); e.className = className; if (text) e.textContent = text; return e; };

/**
 * Builds the 3D sky inside `host` (an empty element). Rejects if three.js cannot be loaded or WebGL cannot start.
 * @returns {Promise<object>}
 *   setScene({ mask, relief, series }): the site (horizon mask of 360°, relief of the port or null, hourly series).
 *   setInstant(i): moves the Sun and the Earth to series[i].
 *   stage: the element with the canvas; it can be moved to another parent (the WebGL context goes with it).
 *   setFill(on): the canvas takes the height of the stage instead of the fixed `height` (for the enlarged view).
 *   step(dir), zoomBy(factor), lookAt('sun'|'earth'), setStretch(on), key(name): the controls, for buttons and keys.
 * `onLost` is called if the browser takes the WebGL context away.
 */
export async function createSky3d(host, { height = 300, onLost } = {}) {
  if (!hasWebGL()) throw new Error(t('tour.sky3d.noWebgl'));
  const THREE = await import('three');

  host.textContent = '';
  const stage = el('div', 'sky3d__stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'sky3d__canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  const ARIA_BASE = t('tour.sky3d.label');
  canvas.setAttribute('aria-label', ARIA_BASE);
  const labels = el('div', 'sky3d__labels');
  labels.setAttribute('aria-hidden', 'true');
  stage.append(canvas, labels);
  host.append(stage);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE[TONE_MAPPING];
  renderer.toneMappingExposure = EXPOSURE;
  // Quality level alto, medio or bajo, as in the home (#145): only the pixel ratio changes, set for the size of the
  // block (or of the enlarged view) on every render.
  const quality = resolveQuality({ params: new URLSearchParams(location.search), signals: readSignals(renderer.getContext(), navigator) });
  const qualityPixelRatio = (w, h) => pixelRatio(quality.level, w, h, window.devicePixelRatio || 1, quality.values.pr);
  // The tracks take the colours of the Sun and Earth labels from the tokens (styles/tokens.css, #334).
  const { mapSun, mapEarth } = theme();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(FOV.start, 1, 0.0004, 400);

  // Airless Moon: a weak fill so the relief in shadow can still be read, and the Sun as the only real light.
  // The Earth adds a faint bluish light from its own direction (earthshine), which gives the dark relief its shape.
  // The bounce of the lit slopes, as in the Mirador and the cabin, keeps the relief that hides the Sun above the black sky.
  scene.add(new THREE.AmbientLight(AMBIENT.color, AMBIENT.intensity));
  const sunLight = new THREE.DirectionalLight(SUN.color, 0);
  const earthLight = new THREE.DirectionalLight(EARTH.color, 0); // off until the Earth is placed
  const bounceLight = new THREE.DirectionalLight(BOUNCE.color, BOUNCE.intensity);
  scene.add(sunLight, sunLight.target, earthLight, earthLight.target, bounceLight, bounceLight.target);

  // The regolith (one crater per cell in «bajo», as in the Mirador), in the shared colour (TERRAIN_COLOR of
  // terrain-material.js, which is REGOLITH). Its detail stops under the step of the rings, which grows with the distance:
  // two uniforms say how (setScene).
  const cell = { uSkyCellMin: { value: LOLA_CELL_KM }, uSkyCellPerKm: { value: 0.15 } };
  const look = createTerrainLook({
    level: quality.level, cell: CELL_GLSL, cacheKey: '-sky3d',
    extend(shader) {
      Object.assign(shader.uniforms, cell);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSkyCellMin;\nuniform float uSkyCellPerKm;');
    },
  });
  const terrainMaterial = look.material(LOLA_CELL_KM);
  // The wall (the relief beyond the rings, as a silhouette) is the same ground, a little darker, seen from both sides.
  const wallMaterial = look.material(LOLA_CELL_KM);
  wallMaterial.color.set(WALL_COLOR);
  wallMaterial.side = THREE.DoubleSide;
  // Only the lit relief goes through the tone mapping: the Sun, the Earth, the stars and the tracks keep their colours
  // (toneMapped: false), as before #339.
  const sunMaterial = new THREE.SpriteMaterial({ map: sunTexture(THREE), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const sun = new THREE.Sprite(sunMaterial);
  // The Earth with oceans, continents, ice and clouds (shared/render/earth.js), not a flat blue ball.
  const earthCanvas = document.createElement('canvas'); earthCanvas.width = 512; earthCanvas.height = 256;
  earthCanvas.getContext('2d').putImageData(new ImageData(earthMapPixels(512, 256), 512, 256), 0, 0);
  const earthMap = new THREE.CanvasTexture(earthCanvas); earthMap.colorSpace = THREE.SRGBColorSpace;
  useRealEarth(earthMap, { onChange: () => render() }); // Blue Marble once loaded; the procedural map until then (#487)
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.MeshBasicMaterial({ map: earthMap, toneMapped: false }));
  scene.add(sun, earth);

  const tag = (className, text) => { const t = el('span', `sky3d__label ${className}`, text); labels.append(t); return t; };
  const sunTag = tag('sky3d__label--sun', t('tour.sky3d.sun')), earthTag = tag('sky3d__label--earth', t('tour.sky3d.earth'));
  const compassTags = COMPASS.map(([name]) => tag('sky3d__label--compass', name));

  let terrain = null, wall = null, stars = null, tracks = [], data = null, index = 0, bodyDistance = 100;
  let yaw = 0, pitch = 4, fov = FOV.start, aimed = false, disposed = false, stretch = EXAGGERATION, fill = false;
  /** Height of the picture, in CSS px: the fixed one of the block or, enlarged, whatever the stage measures. */
  const viewHeight = () => (fill && stage.clientHeight) || (typeof height === 'function' ? height() : height); // a function: sized by the view

  const drop = obj => { if (!obj) return; scene.remove(obj); obj.geometry.dispose(); if (obj.isPoints) obj.material.dispose(); };
  /** Direction of (azimuth, elevation) in the scene, with the heights stretched like the relief. Not a unit vector. */
  const skyDir = (az, elev) => { const d = dirAzEl(az, elev); return { x: d.x, y: d.y * stretch, z: d.z }; };
  const shownElevation = elev => Math.atan(stretch * Math.tan((elev * Math.PI) / 180)) * (180 / Math.PI);
  const place = (obj, body) => { const d = skyDir(body.az, body.el); obj.position.set(d.x * bodyDistance, d.y * bodyDistance, d.z * bodyDistance); };

  function trackOf(series, key, color) {
    const positions = new Float32Array(Math.ceil(series.length / 2) * 3);
    for (let i = 0, n = 0; i < series.length; i += 2, n += 3) {
      const d = skyDir(series[i][key].az, series[i][key].el);
      positions.set([d.x * bodyDistance, d.y * bodyDistance, d.z * bodyDistance], n);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.55, toneMapped: false }));
  }

  /** Returns the reason the terrain could not be built ('nonFinite' | 'empty') or null; then the sky is drawn without it (no terrain, wall, stars or compass tags; the Sun and the Earth stay). */
  function setScene({ mask, relief, series }) {
    const mesh = buildSkyMesh({ mask, relief });
    const problem = meshProblem(mesh);
    if (problem) console.warn(`Cielo 3D: no se puede construir el terreno (${problem})`);
    [terrain, wall, stars, ...tracks].forEach(drop);
    terrain = wall = stars = null;
    const radiusKm = problem ? 100 : mesh.radiusKm; // a broken mesh may carry a NaN radius: bodies and camera use a fixed one
    if (!problem) {
      terrain = meshOf(THREE, mesh.terrain, terrainMaterial);
      wall = meshOf(THREE, mesh.wall, wallMaterial);
      terrain.scale.y = wall.scale.y = stretch;
      look.track(terrain); look.track(wall); // the size of a pixel, for the regolith
      cell.uSkyCellPerKm.value = mesh.cellPerKm;
      // The Sun, the Earth and the stars sit behind the wall, so the relief hides them through the depth buffer.
      stars = starsOf(THREE, mask, radiusKm * 4);
    }
    bodyDistance = radiusKm * 3;
    tracks = [trackOf(series, 'sun', mapSun), trackOf(series, 'earth', mapEarth)];
    scene.add(...[terrain, wall, stars].filter(Boolean), ...tracks);
    camera.far = radiusKm * 8;
    // Angular sizes (shared/render/sky-bodies.js): the Sun's disc (0.53°, the bright core of the sprite) and the Earth
    // (1.9°), both drawn ×PLANNER_SKY_MAGNIFY so they can be found at a glance and the Earth stays 3.6 times wider (#342).
    // The relief stretch (×3) does not reach them: only terrain and wall scale. Their centres are what the data gives.
    const sunWidth = sunSpriteWidth(bodyDistance, SUN_DIAMETER_DEG * PLANNER_SKY_MAGNIFY);
    sun.scale.set(sunWidth, sunWidth, 1);
    earth.scale.setScalar(radiusAt(bodyDistance, EARTH_DIAMETER_DEG * PLANNER_SKY_MAGNIFY));
    data = { mask, series, bare: Boolean(problem) };
    setInstant(index);
    return problem;
  }

  function setInstant(i) {
    index = i;
    if (!data) return;
    const k = data.series[Math.min(i, data.series.length - 1)];
    place(sun, k.sun); place(earth, k.earth);
    earth.rotation.y = (i * 36e5 / SIDEREAL_DAY_MS) * 2 * Math.PI; // the series goes hour by hour: the Earth turns with it
    // The lights come from where the Sun and the Earth really are (lightDir), not from their stretched place in the
    // picture: stretching the heights must not light the flat ground more (#339). The Earth's light follows the same
    // rule as in the Mirador and the cabin (lighting.js): raised over the horizon, and off once the Earth sets.
    const d = lightDir(k.sun), e = lightDir({ az: k.earth.az, el: earthLightElevation(k.earth.el) });
    sunLight.position.set(d.x, d.y, d.z);
    earthLight.position.set(e.x, e.y, e.z);
    earthLight.intensity = earthLightIntensity(k.earth.el);
    const b = dirAzEl(k.sun.az + 180, BOUNCE.elevationDeg); // from the side opposite to the Sun, whether it is hidden or not
    bounceLight.position.set(b.x, b.y, b.z);
    // No shadow maps: the Sun lights the scene by the share of its disc above the relief at the site.
    sunLight.intensity = SUN.intensity * sunDiscFraction(k.sun.margin);
    look.setSun(d); // the regolith follows the real Sun, the one that lights it
    if (!aimed) { aimed = true; yaw = k.sun.az; pitch = Math.max(2, Math.min(25, shownElevation(k.sun.el) + 5)); }
    render();
  }

  function positionTag(node, az, elev, text) {
    const d = skyDir(az, elev);
    const v = new THREE.Vector3(d.x, d.y, d.z).project(camera);
    const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    node.hidden = !visible;
    if (!visible) return;
    node.style.left = `${((v.x + 1) / 2) * 100}%`;
    node.style.top = `${((1 - v.y) / 2) * 100}%`;
    if (text) node.textContent = text;
  }

  function render() {
    if (disposed) return;
    const w = stage.clientWidth || 300, h = viewHeight();
    const ratio = qualityPixelRatio(w, h);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    const look = dirAzEl(yaw, pitch);
    camera.lookAt(look.x, look.y, look.z);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    if (!data) return;
    const k = data.series[Math.min(index, data.series.length - 1)];
    const sunSeen = overRelief(k.sun), earthSeen = overRelief(k.earth);
    positionTag(sunTag, k.sun.az, k.sun.el, t(sunSeen ? 'tour.sky3d.sun' : 'tour.sky3d.sunHidden'));
    positionTag(earthTag, k.earth.az, k.earth.el, t(earthSeen ? 'tour.sky3d.earth' : 'tour.sky3d.earthHidden'));
    // The labels are aria-hidden: the state of both bodies reaches a screen reader through the canvas label (#337).
    const ariaLabel = `${ARIA_BASE} ${skyStateLabel(k)}`;
    if (canvas.getAttribute('aria-label') !== ariaLabel) canvas.setAttribute('aria-label', ariaLabel);
    COMPASS.forEach(([, az], n) => { if (data.bare) compassTags[n].hidden = true; else positionTag(compassTags[n], az, data.mask[az] + fov / (10 * stretch)); }); // no relief, no tags over it
  }

  // ---- Controls: drag and keyboard here; the buttons call the same functions. Rendering is on demand, no loop. ----
  const turn = (dYaw, dPitch) => { yaw = (((yaw + dYaw) % 360) + 360) % 360; pitch = Math.max(PITCH.min, Math.min(PITCH.max, pitch + dPitch)); render(); };
  const zoom = factor => { fov = Math.max(FOV.min, Math.min(FOV.max, fov * factor)); render(); };
  const lookAt = key => {
    if (!data) return;
    const b = data.series[Math.min(index, data.series.length - 1)][key];
    yaw = b.az; pitch = Math.max(PITCH.min, Math.min(PITCH.max, shownElevation(b.el) + 3)); render();
  };
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const perPixel = fov / viewHeight(); // degrees per pixel: the scene follows the pointer
    turn(-(e.clientX - drag.x) * perPixel, (e.clientY - drag.y) * perPixel);
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  /** Applies a key (arrows, + and −). Says whether it was one of them. */
  const key = name => {
    const step = fov / 10;
    const keys = {
      ArrowLeft: () => turn(-step, 0), ArrowRight: () => turn(step, 0), ArrowUp: () => turn(0, step / 2), ArrowDown: () => turn(0, -step / 2),
      '+': () => zoom(0.8), '=': () => zoom(0.8), '-': () => zoom(1.25), '−': () => zoom(1.25),
    };
    if (!keys[name]) return false;
    keys[name]();
    return true;
  };
  canvas.addEventListener('keydown', e => { if (key(e.key)) e.preventDefault(); });
  /** Heights ×EXAGGERATION (true) or true scale (false). */
  const setStretch = on => {
    stretch = on ? EXAGGERATION : 1;
    if (!data) return;
    if (terrain) terrain.scale.y = wall.scale.y = stretch; // bare scene (no terrain): only the tracks
    tracks.forEach(drop);
    tracks = [trackOf(data.series, 'sun', mapSun), trackOf(data.series, 'earth', mapEarth)];
    scene.add(...tracks);
    setInstant(index);
  };
  const setFill = on => { fill = on; render(); };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => render()) : null;
  observer?.observe(stage);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); onLost?.(); });

  function dispose() {
    disposed = true;
    observer?.disconnect();
    [terrain, wall, stars, ...tracks].forEach(drop);
    earth.geometry.dispose();
    [terrainMaterial, wallMaterial, sunMaterial, earth.material].forEach(m => m.dispose());
    sunMaterial.map.dispose();
    renderer.dispose();
    stage.remove(); // it may be outside the host, in the enlarged view
    host.textContent = '';
  }

  /** Where a direction of the sky falls on the canvas, as fractions of its width and height (for checks). */
  const project = (az, elev) => {
    const d = skyDir(az, elev), v = new THREE.Vector3(d.x, d.y, d.z).project(camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, inFront: v.z < 1 };
  };
  return {
    stage, setScene, setInstant, render, dispose, lookAt, project, key, setStretch, setFill,
    /** Factor the heights are multiplied by: EXAGGERATION or 1 (true scale). */
    get stretch() { return stretch; },
    get stretched() { return stretch !== 1; },
    /** A quarter of the field of view to the left (-1) or to the right (1). */
    step: dir => turn((dir * fov) / 4, 0),
    zoomBy: zoom,
    view: () => ({ yaw, pitch, fov }),
  };
}
