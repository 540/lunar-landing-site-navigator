// The cabin of the rover in 3D (J12.1, #297): the Mirador's LOLA relief seen from the driver's seat, with the Sun and
// the Earth of the scenario series, long shadows, the rover's hood in front and dust when it turns on itself.
// Only loaded with a dynamic import() from panel.js, in full map mode on a LOLA scenario: the light mode never asks
// for three.js. The pure decisions are in logic.js and dust.js; the relief helpers come from the Mirador.
import * as THREE from 'three';
import { dirAzEl } from '../../../viewpoint/src/core/direction.js';
import { buildLevels, buildTerrainArrays, fitShadowFrustum, shadowBounds, surfaceHeightAt } from '../../../viewpoint/src/core/relief.js';
import { blendFineHeights, buildRingArrays, matchSeamNormals } from '../../../viewpoint/src/core/far-relief.js';
import { earthSpin } from '../../../shared/render/earth.js';
import { sunTexture, sunDiscTexture, makeEarthGlobe, starPoints } from '../../../shared/render/sky-meshes.js';
import { EARTH_DIAMETER_DEG, radiusAt, SUN_DIAMETER_DEG, SUN_GLOW_SHARE } from '../../../shared/render/sky-bodies.js';
import { AMBIENT, BOUNCE, EARTH, earthLightElevation, earthLightIntensity, SUN, TONE_MAPPING } from '../../../shared/render/lighting.js';
import { EYE_KM, DESCENT_MS, descentPose, stepLook, stepSuspension, breathing, cabinEffects, headingToYaw } from './logic.js';
import { createDust, emitDust, stepDust } from './dust.js';
import { lightFromMap, sunFromMapChunk } from './light-glsl.js';
import { stabilise, jumped, rigHeight, settling } from './light.js';
import { createTerrainLook } from '../../../viewpoint/src/terrain-material.js'; // the Mirador's ground, as on foot there
import { createAscentVehicle } from './ascent-vehicle.js';
import { launchAt, launchSettle, stillAltitudeKm } from './launch.js';
import { gameColors } from '../palette.js';
import { makeEarthGround, tintEarth, makeHeadlights } from './ground-light.js';
import { roverShadow, riseFlash, lookAtBearing, ownShadowGlsl, ownShadowUniforms, RISE_MS } from './moments.js';

const SKY_RADIUS = 5000;
const SUN_DISTANCE = 4000;
// The Earth at its real ~1.9°, as in the Mirador (#336).
const EARTH_RADIUS = radiusAt(SUN_DISTANCE, EARTH_DIAMETER_DEG);
// The Sun's disc at its real 0.53°, a sprite of its own, as in the Mirador (#342); its glow and the wide halo, as they were.
const SUN_DISC_WIDTH = 2 * radiusAt(SUN_DISTANCE, SUN_DIAMETER_DEG);
const SUN_GLOW_WIDTH = SUN_DISTANCE * SUN_GLOW_SHARE;
// The lights are those of the Mirador and the 3D sky (shared/render/lighting.js, #339), and the exposure the Mirador's
// (viewpoint/src/scene.js), so the ground looks the same as on foot there (#403). The fix of J12.1 had lowered the cabin's
// because the near ground burnt white; since #393 the regolith's shoulder before the tone mapping (surface-detail.js,
// TONE) keeps the lit ground grey, and the lower light only made it dull and flat.
const EXPOSURE = 0.75;
const SHADOW_BIAS_TEXELS = 3;
const SHADOW_MIN_GRAZING_DEG = 0.3;
const MOON_RADIUS_KM = 1737.4;

// Shader pieces shared by the ground materials.
// Curvature of the Moon, drawn only: the vertices sink by d²/2R from the eye, so the edge of the region (20 km away,
// 115 m down) hides behind the nearer relief instead of drawing a straight crest. Lighting and shadows keep the flat
// positions (they are computed before this in three.js), so the shadow map still matches.
const CURVED_PROJECT = `vec3 curvedP = transformed;
{ vec2 dEye = (modelMatrix * vec4(transformed, 1.0)).xz - uEye.xz; curvedP.y -= dot(dEye, dEye) / (2.0 * ${MOON_RADIUS_KM.toFixed(1)}); }
vec4 mvPosition = modelViewMatrix * vec4(curvedP, 1.0);
gl_Position = projectionMatrix * mvPosition;`;

function curveGround(shader, uniforms) {
  shader.uniforms.uEye = uniforms.uEye;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uEye;')
    .replace('#include <project_vertex>', CURVED_PROJECT);
}
const D2R = Math.PI / 180;

function terrainMesh(level, holeKm, material, normals) {
  const { positions, indices } = buildTerrainArrays(level, level.heights, holeKm);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// The front of the rover, in metres around the driver's eye (the group is scaled to km): what the driver sees at the
// bottom of the view. A bevelled bonnet with the orange stripe and two seams, raised fender tops on both sides, the
// nose bumper with its two lamps (lit in shadow), the front wheels under the fenders (seen when looking down) and,
// behind the driver, the high-gain antenna that talks to the Earth.
function makeRover() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.45, metalness: 0.1 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8c8983, roughness: 0.6, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.85, metalness: 0.2 });
  const orange = new THREE.MeshStandardMaterial({ color: gameColors().sun, roughness: 0.4, metalness: 0.05, emissive: 0x2a1600 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 0 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  // Bonnet: a rounded trapezoid seen from above (narrower at the nose), extruded and bevelled, sloping down to the front.
  const top = new THREE.Shape();
  top.moveTo(-0.95, 0.5); top.lineTo(0.95, 0.5); top.lineTo(0.82, -1.85);
  top.quadraticCurveTo(0.8, -2.15, 0.5, -2.2); top.lineTo(-0.5, -2.2); top.quadraticCurveTo(-0.8, -2.15, -0.82, -1.85); top.closePath();
  const bonnetGeo = new THREE.ExtrudeGeometry(top, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 4, curveSegments: 10 });
  bonnetGeo.rotateX(Math.PI / 2); // shape y → −z, extruded downwards
  const bonnet = add(bonnetGeo, white, 0, -0.86, -0.55);
  bonnet.rotation.x = -0.075;
  // Stripe and seams on the bonnet.
  const stripe = add(new THREE.BoxGeometry(0.09, 0.01, 2.55), orange, 0, -0.795, -1.55); stripe.rotation.x = -0.075;
  for (const z of [-1.1, -2.0]) { const seam = add(new THREE.BoxGeometry(1.7, 0.012, 0.012), dark, 0, -0.8 + (z + 0.55) * 0.075, z); seam.rotation.x = -0.075; }
  // Fender tops: long rounded humps along both sides, a little higher than the bonnet.
  for (const sx of [-1, 1]) {
    const hump = add(new THREE.CapsuleGeometry(0.07, 2.0, 6, 14), grey, sx * 0.98, -0.86, -1.45);
    hump.rotation.x = Math.PI / 2 - 0.075; hump.scale.set(1, 1, 0.75);
    // Front wheels under the fenders: a dark tyre with a light hub.
    const tyre = add(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 28), dark, sx * 1.05, -1.85, -2.05); tyre.rotation.z = Math.PI / 2;
    const hub = add(new THREE.CylinderGeometry(0.14, 0.14, 0.32, 16), grey, sx * 1.05, -1.85, -2.05); hub.rotation.z = Math.PI / 2;
  }
  // Nose: a dark bumper and two lamps.
  const bumper = add(new THREE.CapsuleGeometry(0.07, 1.4, 4, 12), dark, 0, -1.05, -2.78); bumper.rotation.z = Math.PI / 2;
  [-0.55, 0.55].forEach((x) => { const l = add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 18), lampMat, x, -1.12, -2.83); l.rotation.x = Math.PI / 2; });
  // A short whip antenna on the left front corner, with an orange tip.
  add(new THREE.CylinderGeometry(0.006, 0.01, 0.75, 8), dark, -0.95, -0.45, -1.5);
  add(new THREE.SphereGeometry(0.022, 10, 8), orange, -0.95, -0.07, -1.5);
  // High-gain antenna behind the driver, on the right: seen when looking back over the shoulder.
  // Below and behind the eye (J12.7): looking over the shoulder at the rover's shadow, it must not fill the view.
  add(new THREE.CylinderGeometry(0.02, 0.025, 0.7, 10), grey, 0.95, -0.85, 1.45);
  const dish = add(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }), 0.95, -0.45, 1.47);
  dish.rotation.x = -1.15;
  g.scale.setScalar(0.001);
  g.userData.lamps = lampMat;
  return g;
}

// Sprites of the Sun's flare, drawn in screen space on top of the scene (an orthographic overlay): a cheap stand-in
// for post-processing. They line up from the Sun through the centre of the view and fade as the Sun leaves it.
function flareTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  if (kind === 'ring') {
    const g = x.createRadialGradient(64, 64, 34, 64, 64, 60);
    g.addColorStop(0, 'rgba(255,210,150,0)'); g.addColorStop(0.6, 'rgba(255,210,150,.35)'); g.addColorStop(1, 'rgba(255,210,150,0)');
    x.fillStyle = g;
  } else if (kind === 'streak') {
    const g = x.createLinearGradient(0, 64, 128, 64);
    g.addColorStop(0, 'rgba(255,220,170,0)'); g.addColorStop(0.5, 'rgba(255,230,190,.8)'); g.addColorStop(1, 'rgba(255,220,170,0)');
    x.fillStyle = g; x.fillRect(0, 60, 128, 8); x.globalCompositeOperation = 'destination-in';
    const v = x.createRadialGradient(64, 64, 0, 64, 64, 64); v.addColorStop(0, '#fff'); v.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = v;
  } else {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(180,200,255,.5)'); g.addColorStop(1, 'rgba(180,200,255,0)');
    x.fillStyle = g;
  }
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Builds the cabin on `canvas` for a loaded Mirador region ({ meta, heights, far, detail }).
 * `level`: quality level ('alto' | 'medio' | 'bajo'); `isReduced()`: reduced motion now.
 * Returns the handle that panel.js drives.
 */
export function createCabin(canvas, { meta, heights: fineHeights, far = null, detail = [] }, { level = 'medio', isReduced = () => false, mapLight = null, isStable = () => true, earthGrid = null } = {}) {
  const fx = cabinEffects(level);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: level !== 'bajo', logarithmicDepthBuffer: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = level === 'bajo' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE[TONE_MAPPING];
  renderer.toneMappingExposure = EXPOSURE;
  renderer.setPixelRatio(Math.min(fx.pixelRatio, window.devicePixelRatio || 1));
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const ring = far && meta.far ? far : null;
  const levels = buildLevels(meta, ring ? blendFineHeights(meta, fineHeights, ring) : fineHeights, detail);
  const groundAt = (x, z) => surfaceHeightAt(levels, x, z);

  const shared = { uEye: { value: new THREE.Vector3() } };
  // The Sun of the map and the rules on the ground (fix of J12.1): the horizon per pixel of the scenario over the game
  // grid. mapLight = { url, meta, penumbra, halfKm }; until the atlas arrives, the region's shadow map stays.
  const hz = {
    uHorizon: { value: null }, uHzShape: { value: new THREE.Vector4(1, 1, 1, 1) }, uHzCode: { value: new THREE.Vector2(0, 1) },
    uSunAzEl: { value: new THREE.Vector2(0, -90) }, uHzOn: { value: 0 }, uHzHalf: { value: mapLight?.halfKm ?? 1 },
    uHzPenumbra: { value: mapLight?.penumbra === false ? 0 : 1 }, uHzFix: { value: null },
  };
  // Per-cell corrections (light.js, cellCorrections): 128 = none until the panel sends them.
  const fixN = mapLight?.n ?? 1;
  const fixData = new Uint8Array(fixN * fixN * 4).fill(128);
  const fixTex = new THREE.DataTexture(fixData, fixN, fixN, THREE.RGBAFormat);
  fixTex.magFilter = fixTex.minFilter = THREE.NearestFilter;
  fixTex.needsUpdate = true;
  hz.uHzFix.value = fixTex;
  if (mapLight) {
    new THREE.TextureLoader().load(mapLight.url, (tex) => {
      tex.flipY = false; tex.generateMipmaps = false;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      const m = mapLight.meta;
      hz.uHorizon.value = tex;
      hz.uHzShape.value.set(m.size, m.directions, m.cols, m.rows);
      hz.uHzCode.value.set(m.offset, m.step);
      hz.uHzOn.value = 1;
      dirty = true;
    });
  }
  // The «Earth visible» layer laid on the ground (J12.5): the game grid over the relief, from earthGrid { n, halfKm }.
  const earthGround = earthGrid ? makeEarthGround(earthGrid.n, earthGrid.halfKm) : null;
  // The rover's own long shadow (J12.7), per pixel on the ground (moments.js, ownShadowGlsl): only the Sun's light.
  const own = { uOwnAt: { value: new THREE.Vector2() }, uOwnDir: { value: new THREE.Vector2() }, uOwnLen: { value: 0 } };
  const OWN_GLSL = ownShadowGlsl();
  // The ground is the Mirador's on foot (#403): the same LOLA levels, the same material (terrain-material.js) with its
  // regolith (grain, small craters and stones under the step of each level, the shoulder before the tone mapping) and
  // the same quality rule. On it the cabin adds only what the game needs: the curvature of the Moon, the light of the map
  // (sun.bin) instead of the shadow map inside the grid, the rover's own shadow and the «Earth visible» layer.
  const terrain = createTerrainLook({
    level,
    cacheKey: `-cabin${earthGround ? '-earth' : ''}`,
    extend(shader) {
      curveGround(shader, shared); // after the regolith: it keeps the line the regolith adds after <project_vertex>
      lightFromMap(shader, hz);
      Object.assign(shader.uniforms, own);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${OWN_GLSL}`)
        .replace('#include <lights_fragment_begin>', sunFromMapChunk(THREE.ShaderChunk.lights_fragment_begin)
          .replace('directLight.color *= hzLit;', 'directLight.color *= hzLit * ownShadow(vMapXZ);'));
      if (earthGround) tintEarth(shader, earthGround.uniforms);
    },
  });
  terrain.setFoot(true); // as on foot in the Mirador, with «Textura fina» on
  const meshes = levels.map((lv, k) => terrainMesh(lv, lv.extentKm && levels[k + 1] ? levels[k + 1].extentKm : 0, terrain.material(lv.extentKm / (lv.grid.cols - 1)), lv.normals));
  meshes.forEach((m) => terrain.track(m));
  scene.add(...meshes);
  if (ring) {
    const { positions, indices } = buildRingArrays(meta, ring);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    matchSeamNormals(meta, levels[0].normals, positions, geo.attributes.normal.array);
    const ringMesh = new THREE.Mesh(geo, terrain.material(meta.far.extentKm / (meta.far.grid.cols - 1)));
    terrain.track(ringMesh);
    ringMesh.receiveShadow = true;
    scene.add(ringMesh);
  }
  scene.add(starPoints(SKY_RADIUS, { size: 1.4, share: level === 'bajo' ? 0.5 : 1 })); // half of them in «bajo»

  // Light: the grazing Sun with its shadow map (redrawn only when the Sun moves), the bounce of the lit slopes from the
  // other side and the faint light of the Earth.
  scene.add(new THREE.AmbientLight(AMBIENT.color, AMBIENT.intensity));
  const sunLight = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  sunLight.castShadow = true;
  const side = Math.min(fx.shadowMap, renderer.capabilities.maxTextureSize);
  sunLight.shadow.mapSize.set(side, side);
  sunLight.shadow.normalBias = 0;
  sunLight.shadow.autoUpdate = false;
  scene.add(sunLight, sunLight.target);
  const bounds = shadowBounds(levels);
  const bounce = new THREE.DirectionalLight(BOUNCE.color, BOUNCE.intensity);
  const earthFill = new THREE.DirectionalLight(EARTH.color, 0);
  scene.add(bounce, bounce.target, earthFill, earthFill.target);

  const sunMat = new THREE.SpriteMaterial({ map: sunTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  sunMat.color.setRGB(6, 5.6, 5);
  const sun = new THREE.Sprite(sunMat);
  sun.scale.set(SUN_GLOW_WIDTH, SUN_GLOW_WIDTH, 1);
  const sunDiscMat = new THREE.SpriteMaterial({ map: sunDiscTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  sunDiscMat.color.setRGB(6, 5.6, 5);
  const sunDisc = new THREE.Sprite(sunDiscMat);
  sunDisc.scale.set(SUN_DISC_WIDTH, SUN_DISC_WIDTH, 1);
  // A wide, faint halo around the Sun: the glare a camera sees at a low Sun.
  const haloMat = new THREE.SpriteMaterial({ map: sunTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35, fog: false });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(SUN_DISTANCE * 0.5, SUN_DISTANCE * 0.5, 1);
  scene.add(sun, sunDisc, halo);
  const earth = makeEarthGlobe(EARTH_RADIUS, { onTexture: () => { dirty = true; } });
  scene.add(earth);
  // The Earth over the horizon but hidden by the relief for the engine (earth.bin): drawn faint, with a hollow ring.
  const earthRing = hollowRing(EARTH_RADIUS * 2.6);
  earth.add(earthRing);
  // Guide line on the ground ahead of the rover (J12): green, yellow or red with the slope of the cell it enters.
  // A dashed ribbon 0.7 m wide laid on the ground (a 1 px line is lost at a grazing angle).
  const GUIDE_MAX = 32;
  const guideGeo = new THREE.BufferGeometry();
  guideGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GUIDE_MAX * 6 * 3), 3));
  guideGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GUIDE_MAX * 6 * 3), 3));
  const guide = new THREE.Mesh(guideGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  guide.frustumCulled = false;
  guide.visible = false;
  scene.add(guide);
  // A faint blue glow around the Earth when it is up, which flares when it rises over the relief (J12.7).
  const earthGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTexture('blob'), color: 0x8fc0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
  earthGlow.scale.set(EARTH_RADIUS * 9, EARTH_RADIUS * 9, 1);
  scene.add(earthGlow);
  let earthUp = false, riseAt = null;

  // Camera rig: the rover (yaw), the driver's head inside it (look), the camera (breathing).
  const rover = new THREE.Group();
  const head = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.0003, SKY_RADIUS * 2);
  camera.rotation.order = 'YXZ';
  head.rotation.order = 'YXZ';
  const hood = makeRover();
  hood.position.y = EYE_KM; // the hood is modelled around the driver's eye
  head.position.y = EYE_KM;
  rover.add(hood, head);
  head.add(camera);
  scene.add(rover);
  // The ascent vehicle on its pad (J12.8, #398): seen from afar by its beacon, and its lift-off on a win.
  const ascent = createAscentVehicle(THREE, { groundAt: (x, z) => groundAt(x, z), quality: level });
  scene.add(ascent.group);
  const followQ = new THREE.Quaternion(), restQ = new THREE.Quaternion(), aimV = new THREE.Vector3(), padV = new THREE.Vector3();
  let launchT0 = null;
  // During the lift-off the camera turns to follow the stage and, at the end, to the Earth it is going back to.
  // The still frame of the lift-off (reduced motion, #398): the stage in the air, its height set by the distance,
  // and the camera turned straight at it (it can be behind the rover, beyond the head's turn) until the player looks.
  let stillOn = false, stillAlt = null;
  function aimStill() {
    const base = ascent.padAt();
    if (!base) { camera.quaternion.copy(restQ); return; }
    const alt = stillAltitudeKm(Math.hypot(base.x - roverAt.x, base.z - roverAt.z));
    if (stillAlt === null || Math.abs(alt - stillAlt) > 0.004) { stillAlt = alt; ascent.still(alt); }
    rover.updateMatrixWorld(true);
    ascent.stageAt(aimV);
    camera.quaternion.copy(restQ);
    camera.lookAt(aimV);
  }
  function aimLaunch(now) {
    if (launchT0 === null && stillOn) { aimStill(); return; }
    if (launchT0 === null) { camera.quaternion.copy(restQ); return; }
    const ms = now - launchT0;
    const at = launchAt(ms);
    rover.updateMatrixWorld(true);
    // In, while it boards and climbs; out again once it is gone (after a look at the Earth, if it is up), so the
    // view does not stay on an empty sky and the player gets the controls back (#398).
    const settle = launchSettle(ms, earth.position.y > 0);
    if (settle >= 1) { launchT0 = null; camera.quaternion.copy(restQ); return; }
    const turnIn = Math.min(1, ms / 900) * (1 - settle);
    ascent.stageAt(aimV);
    // Frame the pad and the stage together while it is low: aim between them, then at the stage as it climbs.
    const base = ascent.padAt();
    if (base) aimV.lerp(padV.set(base.x, base.y + 0.004, base.z), 0.45 * (1 - Math.min(1, at.altitudeKm / 0.25)));
    // At the end, towards home: the Earth, if it is over the horizon (else the camera stays on the stage).
    if ((at.phase === 'climb' || at.phase === 'gone') && earth.position.y > 0) aimV.lerp(earth.position, Math.max(0, (at.k - 0.7) / 0.3) * 0.85);
    camera.quaternion.copy(restQ);
    camera.lookAt(aimV);
    followQ.copy(camera.quaternion);
    camera.quaternion.copy(restQ).slerp(followQ, turnIn * turnIn * (3 - 2 * turnIn));
  }
  // Headlights in the rover (J12.5): a spot on the ground ahead and, above «bajo», a cone of light in the dust.
  const lights = makeHeadlights(EYE_KM, { cone: level !== 'bajo' });
  rover.add(lights.group);
  let skyNow = null, lampsOn = false;
  // Where the head turns by itself (looking at the shadow, framing the postcard): degrees, eased in each frame.
  let aim = null;

  // Dust: a pool of grains drawn as points.
  const dust = createDust(fx.dust);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dust.pos, 3));
  const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xc4beb2, size: 0.00016, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }));
  dustPts.frustumCulled = false;
  scene.add(dustPts);

  // Flare overlay in screen space.
  const overlay = new THREE.Scene();
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const flares = fx.flare ? [
    { kind: 'streak', at: 0, size: 1.1, alpha: 0.55 },
    { kind: 'ring', at: 0.45, size: 0.22, alpha: 0.35 },
    { kind: 'blob', at: 0.8, size: 0.09, alpha: 0.45 },
    { kind: 'ring', at: 1.3, size: 0.32, alpha: 0.25 },
    { kind: 'blob', at: 1.7, size: 0.14, alpha: 0.3 },
  ].map((f) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTexture(f.kind), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    overlay.add(s); return { ...f, sprite: s };
  }) : [];

  // ---- state ----
  let roverAt = { x: 0, z: 0, heading: 0 };
  let look = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0 };
  // Driving (J12.2): speed (m/s) and turn rate (rad/s) of the car, the suspension and a short shake.
  let motion = { speed: 0, turnRate: 0 };
  let susp = { y: NaN, v: 0 };
  let stab = null;
  let stabTarget = null; // what the stabiliser is heading for (to keep drawing until it settles)
  let placedAt = null; // where the rig was placed last frame, to tell driving from a jump
  let shakeUntil = 0;
  let onFrame = null;
  let descent = null; // { t0 } while the camera comes down from the map
  let sunVisible = true;
  let sunDir = new THREE.Vector3(0, 1, 0);
  let running = false, frame = 0, last = 0, dirty = true;
  const t0 = performance.now();
  let lastDt = 1 / 60;

  function setSky({ sun: s, earth: e }, tMs, { sunLit = true, earthSeen = true } = {}) {
    const d = dirAzEl(s.az, s.el);
    sunDir.set(d.x, d.y, d.z);
    terrain.setSun(d);
    const f = fitShadowFrustum(bounds, d);
    Object.assign(sunLight.shadow.camera, { left: f.left, right: f.right, top: f.top, bottom: f.bottom, near: f.near, far: f.far });
    sunLight.shadow.camera.updateProjectionMatrix();
    const texelKm = (f.top - f.bottom) / sunLight.shadow.mapSize.y;
    const grazing = Math.max(Math.abs(s.el), SHADOW_MIN_GRAZING_DEG) * D2R;
    sunLight.shadow.bias = -(SHADOW_BIAS_TEXELS * texelKm / Math.tan(grazing)) / (f.far - f.near);
    sunLight.position.set(d.x * f.distance, d.y * f.distance, d.z * f.distance);
    sunLight.shadow.needsUpdate = true;
    const back = dirAzEl(s.az + 180, BOUNCE.elevationDeg);
    bounce.position.set(back.x, back.y, back.z);
    sun.position.set(d.x * SUN_DISTANCE, d.y * SUN_DISTANCE, d.z * SUN_DISTANCE);
    halo.position.copy(sun.position);
    sunDisc.position.copy(sun.position);
    hz.uSunAzEl.value.set(s.az, s.el);
    sunVisible = sunLit;
    hood.userData.lamps.emissiveIntensity = sunLit ? 0 : 1.2;
    skyNow = { sun: s, earth: e };
    lampsOn = !sunLit;
    lights.set(lampsOn);
    // Dust in the beams: lit warm and a little bigger while the lamps are on.
    dustPts.material.color.set(lampsOn ? 0xfff0d6 : 0xc4beb2);
    dustPts.material.size = lampsOn ? 0.0002 : 0.00016;
    earthUp = e.el > 0;
    const ed = dirAzEl(e.az, e.el);
    earth.position.set(ed.x * SUN_DISTANCE, ed.y * SUN_DISTANCE, ed.z * SUN_DISTANCE);
    if (Number.isFinite(tMs)) earth.userData.globe.rotation.y = earthSpin(tMs);
    earth.userData.material.uniforms.sunDir.value.copy(sun.position).sub(earth.position).normalize();
    const fill = dirAzEl(e.az, earthLightElevation(e.el));
    earthFill.position.set(fill.x, fill.y, fill.z);
    earthFill.intensity = earthLightIntensity(e.el);
    const hidden = !earthSeen && e.el > 0;
    earth.userData.material.uniforms.opacity.value = hidden ? 0.28 : 1;
    earth.userData.glow.visible = !hidden;
    earthRing.visible = hidden;
    earthGlow.position.copy(earth.position);
    dirty = true;
  }

  // Points in scene km ({ x, z, tone }); null hides the line. Dashed: every other gap is left out.
  const TONE = { ok: [0.27, 0.75, 0.54], steep: [0.9, 0.76, 0.3], no: [0.9, 0.34, 0.29] };
  function setGuide(points) {
    if (!points || points.length < 2) { guide.visible = false; dirty = true; return; }
    const pos = guideGeo.attributes.position.array, col = guideGeo.attributes.color.array;
    const W = 0.00035; // half width, km
    let k = 0;
    for (let i = 0, q = 0; i + 1 < points.length && q < GUIDE_MAX; i += 2, q++) {
      const a = points[i], b = points[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, nx = (-dz / L) * W, nz = (dx / L) * W;
      const ya = groundAt(a.x, a.z) + 0.00012, yb = groundAt(b.x, b.z) + 0.00012;
      const quad = [[a.x - nx, ya, a.z - nz], [a.x + nx, ya, a.z + nz], [b.x + nx, yb, b.z + nz], [a.x - nx, ya, a.z - nz], [b.x + nx, yb, b.z + nz], [b.x - nx, yb, b.z - nz]];
      const tone = TONE[b.tone] ?? TONE.ok;
      for (const v of quad) { pos.set(v, k * 3); col.set(tone, k * 3); k++; }
    }
    guideGeo.setDrawRange(0, k);
    guideGeo.attributes.position.needsUpdate = true;
    guideGeo.attributes.color.needsUpdate = true;
    guide.visible = true;
    dirty = true;
  }

  function setRover({ x, z, heading, speed = 0, turnRate = 0 }) {
    roverAt = { x, z, heading };
    motion = { speed, turnRate };
    dirty = true;
  }

  // Places the rig from the rover, the turn, the look, the breathing and (while it lasts) the descent.
  function place(now) {
    // The rover's own shadow on the ground, where the Sun lights the rover (none during the descent).
    const u = ownShadowUniforms(roverAt, skyNow && !descent ? roverShadow(skyNow.sun, sunVisible) : null);
    own.uOwnAt.value.set(u.at[0], u.at[1]); own.uOwnDir.value.set(u.dir[0], u.dir[1]); own.uOwnLen.value = u.length;
    const ground = groundAt(roverAt.x, roverAt.z);
    const yaw = headingToYaw(roverAt.heading);
    const reduced = isReduced();
    const b = breathing((now - t0) / 1000, reduced);
    if (descent) {
      if (descent.t0 === null) descent.t0 = now; // the clock starts with the first frame actually drawn
      const k = Math.max(0, (now - descent.t0) / DESCENT_MS);
      const p = descentPose(k, { x: roverAt.x, z: roverAt.z, ground, yaw });
      rover.position.set(p.x, p.y - EYE_KM, p.z);
      rover.rotation.set(0, p.yaw, 0);
      head.rotation.set(p.pitch, 0, 0);
      hood.visible = k > 0.8;
      lights.group.visible = k > 0.8;
      canvas.style.opacity = String(Math.min(1, k / 0.18));
      if (k >= 1) { descent = null; canvas.style.opacity = ''; }
      return;
    }
    hood.visible = true;
    lights.group.visible = true;
    // The rover sits on the slope: a little pitch and roll from the ground ahead and to the side (1.5 m).
    const ax = -Math.sin(yaw), az = -Math.cos(yaw), L = 0.0015;
    const pitchG = Math.atan2(groundAt(roverAt.x + ax * L, roverAt.z + az * L) - groundAt(roverAt.x - ax * L, roverAt.z - az * L), 2 * L);
    const rollG = Math.atan2(groundAt(roverAt.x - az * L, roverAt.z + ax * L) - groundAt(roverAt.x + az * L, roverAt.z - ax * L), 2 * L);
    // Suspension: the cabin follows the ground through a soft spring, so bumps throw it up a little (Moon gravity).
    // A jump (a route driven from the map, a new game, the first frame): the springs and filters start on the ground.
    const jump = jumped(placedAt, roverAt);
    placedAt = { x: roverAt.x, z: roverAt.z };
    if (jump) susp = { y: ground, v: 0 };
    susp = stepSuspension(susp, ground, lastDt, reduced);
    // Leaning into the curves (more the faster it turns while rolling) and a short shake when a slope stops it.
    // Stabiliser (on by default): pitch, roll and height through a low-pass filter (~0.4 s), a smaller lean and a
    // subtle lunar bounce; with reduced motion the horizon stays level.
    const steady = isStable();
    const lean = reduced ? 0 : Math.max(-0.02, Math.min(0.02, -motion.turnRate * motion.speed * (steady ? 0.003 : 0.01)));
    const shake = !reduced && now < shakeUntil ? Math.sin(now / 18) * (steady ? 0.005 : 0.012) * ((shakeUntil - now) / 350) : 0;
    const bounceY = ground + (susp.y - ground) * (steady ? 0.35 : 1);
    stabTarget = { pitch: Math.max(-0.3, Math.min(0.3, pitchG)), roll: Math.max(-0.3, Math.min(0.3, rollG)), y: bounceY };
    stab = stabilise(stab, stabTarget, lastDt, { on: steady, reduced, jumped: jump });
    const sway = steady || reduced ? 0.4 : 1;
    rover.position.set(roverAt.x, rigHeight(stab.y + b.dy * sway, ground), roverAt.z);
    rover.rotation.set(stab.pitch + b.pitch * sway + shake, yaw, stab.roll + b.roll * sway + lean, 'YXZ');
    head.position.set(0, EYE_KM, 0);
    head.rotation.set(look.pitch * D2R, -look.yaw * D2R, 0);
    aimLaunch(now);
  }

  const v3 = new THREE.Vector3();
  function placeFlares() {
    if (!flares.length) return;
    v3.copy(sun.position).project(camera);
    const inFront = v3.z < 1;
    const off = Math.hypot(v3.x, v3.y);
    const k = inFront && sunVisible && !descent ? Math.max(0, 1 - off / 1.3) : 0;
    const aspect = camera.aspect;
    for (const f of flares) {
      const px = v3.x * (1 - f.at), py = v3.y * (1 - f.at);
      f.sprite.position.set(px, py, 0);
      f.sprite.scale.set(f.size / aspect * (f.kind === 'streak' ? 3 : 1), f.size * (f.kind === 'streak' ? 0.4 : 1), 1);
      f.sprite.material.opacity = f.alpha * k;
    }
  }

  function resize() {
    const w = canvas.clientWidth || 640, h = canvas.clientHeight || 640;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  // Frames per second of the last second (for the PR measurement and the panel's debugging).
  let fps = 0, frames = 0, fpsT = performance.now();

  function tick(now) {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    const reduced = isReduced();
    lastDt = dt;
    onFrame?.(dt);
    look = stepLook(look, dt);
    if (aim) {
      const f = reduced ? 1 : Math.min(1, dt * 3.2);
      look = { ...look, yaw: look.yaw + (aim.yaw - look.yaw) * f, pitch: look.pitch + (aim.pitch - look.pitch) * f, vYaw: 0, vPitch: 0 };
      if (Math.abs(aim.yaw - look.yaw) < 0.3 && Math.abs(aim.pitch - look.pitch) < 0.3) aim = null;
    }
    if (earthGround) earthGround.uniforms.uEarthTime.value = reduced ? 0 : (now - t0) / 1000;
    const flash = riseAt === null ? 0 : riseFlash(now - riseAt, reduced);
    if (riseAt !== null && now - riseAt > RISE_MS) riseAt = null;
    earthGlow.material.opacity = earthUp ? 0.28 + flash * 1.6 : 0;
    // Dust from the wheels while the rover rolls or turns on itself: grains thrown backwards, in parabolas.
    const spin = Math.abs(motion.turnRate), roll = Math.abs(motion.speed);
    if ((roll > 0.7 || spin > 0.2) && !reduced) {
      const yaw = headingToYaw(roverAt.heading);
      const g = groundAt(roverAt.x, roverAt.z);
      const back = motion.speed >= 0 ? roverAt.heading : roverAt.heading + Math.PI;
      for (const [sx, sz] of [[-1, 1.2], [1, 1.2], [-1, -1.2], [1, -1.2]]) {
        const x = roverAt.x + (sx * Math.cos(yaw) + sz * Math.sin(yaw)) * 0.0011;
        const z = roverAt.z + (-sx * Math.sin(yaw) + sz * Math.cos(yaw)) * 0.0011;
        const count = Math.round(Math.min(roll, 20) * 0.4 + spin * 3);
        if (count) emitDust(dust, { x, y: g + 0.00005, z, heading: back, count });
      }
    }
    const flying = stepDust(dust, dt);
    const vehicle = ascent.update(now, camera);
    dustGeo.attributes.position.needsUpdate = true;
    const moving = vehicle || launchT0 !== null || descent || aim || riseAt !== null || look.vYaw || look.vPitch || roll || spin || flying || now < shakeUntil || !reduced || settling(stab, stabTarget, { reduced });
    if (!moving && !dirty) return;
    dirty = false;
    place(now);
    placeFlares();
    camera.getWorldPosition(shared.uEye.value);
    renderer.clear();
    renderer.render(scene, camera);
    if (flares.length) renderer.render(overlay, ortho);
    frames++;
    if (now - fpsT >= 1000) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
  }

  // Cost of each effect for the PR (J12.1 asks for it measured): renders `n` frames synchronously, waiting for the GPU
  // each time, with the given effects off, and gives the mean ms per frame. Not used by the game itself.
  canvas.cabinBenchmark = (n = 60, { flare = true, regolith = true, dust: withDust = true, shadow = false } = {}) => {
    const keep = { flares: flares.map((f) => f.sprite.visible), dust: dustPts.visible };
    if (!regolith) terrain.setMicro(false);
    flares.forEach((f) => { f.sprite.visible = flare; });
    dustPts.visible = withDust;
    const gl = renderer.getContext(), px = new Uint8Array(4);
    // Reading one pixel waits for the GPU to finish the frame (gl.finish does not, on every driver).
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    place(performance.now()); placeFlares();
    renderer.render(scene, camera); sync();
    const t = performance.now();
    for (let k = 0; k < n; k++) {
      if (shadow) sunLight.shadow.needsUpdate = true;
      renderer.clear(); renderer.render(scene, camera);
      if (flares.length) renderer.render(overlay, ortho);
      sync();
    }
    const ms = (performance.now() - t) / n;
    terrain.setMicro(true);
    flares.forEach((f, i) => { f.sprite.visible = keep.flares[i]; });
    dustPts.visible = keep.dust;
    dirty = true;
    return ms;
  };

  const api = {
    groundAt, setSky, setRover, resize, setGuide,
    /** Starts the descent from the map (none with reduced motion: straight to the cabin). */
    descend() { descent = isReduced() ? null : { t0: null }; dirty = true; },
    /** Compiles the shaders and draws one frame (with the shadow map), so the descent does not start with a stall. */
    prepare() { place(performance.now()); renderer.compile(scene, camera); renderer.clear(); renderer.render(scene, camera); if (descent) descent.t0 = null; dirty = true; },
    descending: () => Boolean(descent),
    /** Per-cell corrections of the ground's light (light.js, cellCorrections), so the cabin agrees with the rules. */
    setMapFix(bytes) { if (bytes.length === fixData.length) { fixData.set(bytes); fixTex.needsUpdate = true; dirty = true; } },
    /** The ascent vehicle on the pad cell's scene position (J12.8). */
    setPad(p) { ascent.place(p); dirty = true; },
    /** Lift-off (J12.8): the camera follows the stage; none with reduced motion (the panel decides). */
    launch() { const now = performance.now(); stillOn = false; launchT0 = now; ascent.launch(now); dirty = true; },
    resetLaunch() { launchT0 = null; stillOn = false; ascent.reset(); dirty = true; },
    /** The lift-off as a still frame (reduced motion, #398): the stage in the air and the head turned up to it. */
    launchStill() { stillOn = true; stillAlt = null; aim = null; dirty = true; },
    /** How the vehicle greets the crew: 'idle' | 'waiting' | 'ready' (#398). */
    setVehicleMode(mode) { if (ascent.setMode(mode)) dirty = true; },
    launching: () => launchT0 !== null,
    /** Drag: speed of the head in degrees per second. */
    pushLook(vYaw, vPitch) { stillOn = false; look = stepLook(look, 0, { push: { vYaw, vPitch } }); dirty = true; },
    /** Arrow keys: −1 left, 1 right, 0 released (the rover turns on itself). */
    /** Called on every frame before drawing, with the seconds since the last one (the panel drives the car there). */
    setOnFrame(f) { onFrame = f; },
    /** A short shake: the rover hit a slope it cannot climb. */
    shake() { shakeUntil = performance.now() + 350; dirty = true; },
    tiltHead(deg) { stillOn = false; look = { ...look, pitch: Math.max(-35, Math.min(40, look.pitch + deg)) }; dirty = true; },
    /** The «Earth rises» moment (J12.7): the glow around the Earth flares and fades. */
    earthRise() { riseAt = performance.now(); dirty = true; },
    /** Turns the head towards the rover's own shadow (J12.7). False when there is none to see. */
    lookAtShadow() {
      const sh = skyNow ? roverShadow(skyNow.sun, sunVisible) : null;
      if (!sh) return 'none';
      const rel = lookAtBearing(sh.az, (roverAt.heading * 180) / Math.PI, 180);
      aim = { yaw: Math.max(-100, Math.min(100, rel)), pitch: -14 };
      dirty = true;
      return Math.abs(rel) > 100 ? 'behind' : 'seen';
    },
    /** Turns the head towards the ascent vehicle as the rover arrives at ASCENSO (#398). */
    lookAtVehicle() {
      const base = ascent.padAt();
      if (!base) return false;
      const az = (Math.atan2(base.x - roverAt.x, -(base.z - roverAt.z)) * 180) / Math.PI;
      const rel = lookAtBearing(az, (roverAt.heading * 180) / Math.PI, 180);
      aim = { yaw: Math.max(-100, Math.min(100, rel)), pitch: 6 };
      dirty = true;
      return true;
    },
    /** Lays the «Earth visible» layer on the ground (J12.5): lists of cells now and within 24 h, or null to hide it. */
    setEarthGround(now, soon) { earthGround?.set(now, soon); dirty = true; },
    /**
     * A still of the cabin for the postcard (J12.7): rendered at width × height with the head turned to frame the Sun
     * and the Earth, copied to a 2D canvas (WebGL clears its buffer after the frame) and the view restored.
     */
    snapshot(width = 1600, height = 900) {
      const keep = { ...look };
      if (skyNow) {
        const h = (roverAt.heading * 180) / Math.PI;
        const ds = lookAtBearing(skyNow.sun.az, h, 180), de = lookAtBearing(skyNow.earth.az, h, 180);
        const mid = Math.abs(ds - de) <= 120 ? (ds + de) / 2 : (skyNow.earth.el > 0 ? de : ds);
        look = { yaw: Math.max(-110, Math.min(110, mid)), pitch: 4, vYaw: 0, vPitch: 0 };
      }
      const size = renderer.getSize(new THREE.Vector2());
      const aspect = camera.aspect;
      renderer.setSize(width, height, false);
      camera.aspect = width / height; camera.updateProjectionMatrix();
      place(performance.now()); placeFlares();
      camera.getWorldPosition(shared.uEye.value);
      renderer.clear(); renderer.render(scene, camera);
      if (flares.length) renderer.render(overlay, ortho);
      const out = document.createElement('canvas'); out.width = width; out.height = height;
      out.getContext('2d').drawImage(renderer.domElement, 0, 0, width, height);
      renderer.setSize(size.x, size.y, false);
      camera.aspect = aspect; camera.updateProjectionMatrix();
      look = keep; dirty = true;
      return out;
    },
    centreHead() { stillOn = false; look = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0 }; dirty = true; },
    start() { if (running) return; running = true; last = 0; dirty = true; frame = requestAnimationFrame(tick); },
    stop() { running = false; cancelAnimationFrame(frame); },
    fps: () => fps,
    dispose() { this.stop(); renderer.dispose(); },
  };
  // For checks from the console and the browser tests (as cabinBenchmark): the handle the panel drives.
  canvas.cabin = api;
  return api;
}

// A thin hollow blue ring (a sprite), for the Earth when the relief hides it from the rover's cell.
function hollowRing(size) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = 'rgba(120,175,255,.9)'; x.lineWidth = 6; x.setLineDash([14, 10]);
  x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  ring.scale.set(size, size, 1);
  ring.visible = false;
  return ring;
}
