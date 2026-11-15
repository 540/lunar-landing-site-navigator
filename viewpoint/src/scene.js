// three.js scene of the tour: the relief of the region, black sky with stars, the Sun and its raking light, the flag and a drone camera.
// Units in km, as in the prototype; x east, y up, azimuth 0° towards -z (see core/direction.js and core/scene-frame.js).
import { prefersReducedMotion } from './core/motion.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { dirAzEl } from './core/direction.js';
import { buildLevels, buildTerrainArrays, fitShadowFrustum, shadowBounds, surfaceHeightAt } from './core/relief.js';
import { CAMERA_NEAR_KM, limitCamera } from './core/camera-limits.js';
import { createDoubleTapDetector, isFormTarget, modalOpen } from './core/camera-input.js';
import { dronePose, glidePose, RESET_MS } from './core/drone-pose.js';
import { ascentPose, descentPose, ASCENT_MS, DESCENT_MS } from './core/region-transition.js';
import { blendFineHeights, buildRingArrays, matchSeamNormals } from './core/far-relief.js';
import { FOOT_NEAR_KM, FOOT_FOV_DEG, WORLD_MAX_H_DEG, arrivalAt, footPose, fovForAspect } from './core/foot-camera.js';
import { FADE_MS, FLIGHT_MS, createFlightLock, fadeAlpha, flightMode, flightPose, flightScale, pastHalf, shouldFly } from './core/flight.js';
import { VIEW_MODEL_LAYER } from './suit-body.js';
import { createFootView } from './foot-view.js';
import { sunFraction } from './core/sunlit.js';
import { PSVR_OPTICS } from './core/psvr.js';
import { referenceSpaceFor, xrRestoreSteps } from './core/xr-session.js';
import { loadStarField } from './star-field.js';
import { createTerrainLook } from './terrain-material.js';
import { pixelRatio, readSignals, resolveQuality } from '../../shared/render/quality.js';
import { browserStorage, forcedLevel, loadOptions } from './core/options.js';
import { earthSpin } from '../../shared/render/earth.js';
import { sunTexture, sunDiscTexture, makeEarthGlobe, starPoints } from '../../shared/render/sky-meshes.js';
import { EARTH_DIAMETER_DEG, radiusAt, SUN_DIAMETER_DEG, SUN_GLOW_SHARE } from '../../shared/render/sky-bodies.js';
import { belowFor } from '../../shared/render/stars.js';
import { moveWithPieces, plantOnly } from './core/foot-flag.js';
import { droneCeilingKm, lowestVisibleDeg } from './core/star-floor.js';
import { createRendererOrNotice, watchContextLoss } from '../../shared/render/lost-notice.js';
import { AMBIENT, BOUNCE, EARTH, earthLightElevation, earthLightIntensity, REGOLITH, SUN, TONE_MAPPING } from '../../shared/render/lighting.js';
import { redrawAfterRestore } from './lost.js';

const SKY_RADIUS = 5000;
const SUN_DISTANCE = 4000;
// Shadow map of the Sun, fitted to the region on every change of the Sun (fitShadowFrustum). Its side comes from the
// quality level (values.shadow, shared/render/quality.js, #145): 4096 in alto, where a texel across is about 14 m;
// with fewer, the edge of a grazing shadow breaks into teeth along the Sun's direction.
const SHADOW_BIAS_TEXELS = 3; // of height: what the soft filter reads around each point
const SHADOW_MIN_GRAZING_DEG = 0.3;
// Light (shared/render/lighting.js, #339): the Sun, the ambient, the bounce and the Earth are the ones of the cabin and the
// 3D sky; only the exposure is the Mirador's. The fills let the relief in shadow be read. Neither casts shadows, and both
// together stay far below the sunlit ground, so light and shadow still read as such (the ring of the lander and the chips
// are what say it, from the verdict).
// - Bounce: the sunlight that the lit slopes scatter back into the shadows. They face the Sun, so it comes from the side
//   opposite to it, from above the horizon.
// - Earth: its light, much brighter than it really is, from its side of the sky while it is over the horizon.
const EXPOSURE = 0.75;
const FLAG_COLOR = 0xf3a83a;
const LANDER_SHADOW_COLOR = 0x5d6670;
// Your own suit on foot has lights of its own (layer 1, the view model): the Sun of the world is 30 so the ground it grazes
// at under a degree gets sin(el) of it, but the suit faces it square on and turned white without a fold. Here the Sun is
// in the same direction at the strength of a lit white suit, dimmed by the relief between you and it (core/sunlit.js);
// the regolith lit around you bounces light up onto it, and a trace of sky fill keeps the side away from the Sun from
// going black (in the Apollo photos the suits read white even in shade). The colours are the shared ones (the Sun, the
// regolith and the ambient of shared/render/lighting.js); the strengths are the suit's own, raised with the exposure of
// #339 (0.85 → 0.75) so the suit looks as before. The ambient also makes up for its colour: the shared one is about 0.57 of
// white's luminance, so 0.3 of white at 0.85 is 0.3 × 0.85 / (0.57 × 0.75) ≈ 0.59 of it.
const BODY_SUN_INTENSITY = 3.6;
const BODY_BOUNCE = { sky: 0x1a1c20, ground: REGOLITH, intensity: 1.1 };
const BODY_AMBIENT = 0.59;
// The lamps on the sides of the helmet (EVA helmets carry two): a soft light from your eyes onto what you look at, so your
// gloves and the watch still read with the Sun behind them. A lamp of the suit, like the rover's headlights in the game:
// not a light of the environment, so it keeps its own colour.
const BODY_LAMP = { color: 0xf2f5ff, intensity: 1 };
const BODY_SHADE_STEP_KM = 0.001; // the shade at your feet is looked up again after a metre
// On foot (E3.1, #182) the flag and the rocket go back to their real size: from the drone they are about 500 times larger,
// so they read 5 km away. The flag pole is 1.1 (km) in the model: 2.2 m on foot. The rocket is 2.5 high in its model:
// 30 m on foot, standing about 60 m from the flag instead of 1.5 km.
const FOOT_FLAG_SCALE = 0.002;
const ROCKET_HEIGHT = 2.47; // in its own units (makeRocket)
const ROCKET_DRONE = { scale: 0.8, reach: 1 };
const ROCKET_FOOT = { scale: 0.03 / ROCKET_HEIGHT, reach: 0.04 };

// The Sun's glow, the Earth and the stars live in shared/render/sky-meshes.js (J12.1, #297): the game's cabin draws
// them too. The Earth at its real ~1.9° (#336).
const EARTH_RADIUS = radiusAt(SUN_DISTANCE, EARTH_DIAMETER_DEG);
// The Sun's disc at its real 0.53°, a sprite of its own, so the Earth is 3.6 times wider (#342); the glow around it, its
// halo, as it was.
const SUN_DISC_WIDTH = 2 * radiusAt(SUN_DISTANCE, SUN_DIAMETER_DEG);
const SUN_GLOW_WIDTH = SUN_DISTANCE * SUN_GLOW_SHARE;
// onTexture: the scene renders on demand, so it repaints when the Blue Marble replaces the procedural map (#487).
const makeEarth = (onTexture) => makeEarthGlobe(EARTH_RADIUS, { onTexture });
// The stars go down past the edge of the far ring seen from the drone's ceiling (core/star-floor.js, #340).
const starsOf = (meta) => starPoints(SKY_RADIUS, { below: belowFor(lowestVisibleDeg(meta, SKY_RADIUS)) });

// `normals` (optional): the ones of the DEM (core/relief.js); without them, the ones of the triangles.
// `look` and `cellKm`: the regolith material (terrain-material.js) and the grid step of this mesh, the size under which
// the material adds its illustrative detail.
function meshOf({ positions, indices }, { castShadow, normals = null, look, cellKm }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  if (normals) geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  else geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, look.material(cellKm));
  look.track(mesh);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  return mesh;
}

// The fine zone (#97): one mesh per level, coarse to fine, each with a hole where the next, finer one is drawn
// (core/relief.js stitches them). The first one is the whole region, the one the far ring meets.
const makeTerrain = (levels, look) => levels.map((level, k) => meshOf(buildTerrainArrays(level, level.heights, levels[k + 1]?.extentKm ?? 0), { castShadow: true, normals: level.normals, look, cellKm: level.extentKm / (level.grid.cols - 1) }));
// The far ring (E9.2): same material and colour as the fine mesh, with the hole of the fine zone. It casts no shadows (that is E5.2).
const makeRing = (meta, far, look) => meshOf(buildRingArrays(meta, far), { castShadow: false, look, cellKm: meta.far.extentKm / (meta.far.grid.cols - 1) });

// Flag of the site (in km, oversized so it reads from the drone): a modelled flag with the 540 banner. As on the Apollo
// flags there is no wind on the Moon, so a bar along the top holds the cloth out, and the cloth keeps the creases it
// was packed with. The ring on the ground marks the site and turns grey when the site is in shadow.
const FLAG = { poleH: 1.1, poleR: 0.016, clothW: 0.6, clothH: 0.4, texture: new URL('../assets/flag-540.jpg', import.meta.url).href };

function flagCloth(texture) {
  const { clothW: w, clothH: h } = FLAG;
  const geo = new THREE.PlaneGeometry(w, h, 40, 20);
  geo.translate(w / 2, -h / 2, 0); // hangs from its top-left corner, at the pole and the bar
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w, v = -p.getY(i) / h; // 0 at the pole and at the bar, 1 at the free corner
    // Packed creases: a few vertical folds that grow away from the pole, a softer diagonal one, and the bottom edge
    // that sags a little away from the pole (the bar holds only the top).
    const z = 0.018 * Math.sin(u * Math.PI * 3.2 + 0.6) * (0.35 + u) + 0.008 * Math.sin((u + v) * Math.PI * 5) * v;
    p.setZ(i, z);
    p.setY(i, p.getY(i) - 0.02 * u * u * v);
  }
  geo.computeVertexNormals();
  // The logo glows a little on its own, so it reads in the low polar light as it does on screen.
  const material = new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.4, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, material);
}

/** onTexture: the scene renders on demand, so it repaints once the banner's picture has arrived. */
function makeFlag(onTexture = () => {}) {
  const g = new THREE.Group();
  const { poleH, poleR, clothW } = FLAG;
  const metal = new THREE.MeshStandardMaterial({ color: 0xd6dbe2, metalness: 0.35, roughness: 0.4, emissive: 0x1c1f24 });
  const gold = new THREE.MeshStandardMaterial({ color: FLAG_COLOR, metalness: 0.5, roughness: 0.35, emissive: 0x3a2508 });
  // Pole, with a foot driven into the regolith, a collar and a knob on top.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR * 1.15, poleH, 16), metal);
  pole.position.y = poleH / 2;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(poleR * 2.6, poleR * 3.4, 0.04, 20), metal);
  foot.position.y = 0.02;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(poleR * 2.2, 16, 12), gold);
  knob.position.y = poleH + poleR * 1.6;
  // The bar that holds the cloth out, hinged on a collar near the top.
  const top = poleH - 0.03;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(poleR * 1.7, poleR * 1.7, 0.035, 16), gold);
  collar.position.y = top;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(poleR * 0.6, poleR * 0.6, clothW + 0.02, 10), metal);
  bar.rotation.z = Math.PI / 2;
  bar.position.set((clothW + 0.02) / 2, top, 0);
  const barEnd = new THREE.Mesh(new THREE.SphereGeometry(poleR * 0.9, 10, 8), gold);
  barEnd.position.set(clothW + 0.02, top, 0);
  const texture = new THREE.TextureLoader().load(FLAG.texture, onTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const cloth = flagCloth(texture);
  cloth.position.set(poleR, top - 0.005, 0);
  for (const m of [pole, foot, knob, collar, bar, barEnd, cloth]) { m.castShadow = true; m.receiveShadow = m !== cloth; }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.32, 48), new THREE.MeshBasicMaterial({ color: FLAG_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.renderOrder = 3;
  g.add(pole, foot, knob, collar, bar, barEnd, cloth, ring);
  g.userData.ring = ring;
  return g;
}

// An astronaut beside the flag (in km, at the flag's scale), built like a puppet: every limb hangs from its joint
// (shoulder, elbow, wrist, hip, knee), so a pose is a few rotations and the parts stay joined. White suit with its
// backpack, a helmet with a wrap-around gold visor, gloves and boots; the right arm raised, waving at the drone.
const ASTRONAUT_PATCH = new URL('../assets/patch-540.png', import.meta.url).href;
/** onTexture: repaint once the patch's picture has arrived (the scene renders on demand). */
function makeAstronaut(onTexture = () => {}) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0xeeece6, roughness: 0.8, emissive: 0x1c1c1c });
  const joint = new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.7, emissive: 0x141414 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x7d838c, roughness: 0.55, metalness: 0.25, emissive: 0x101010 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xe0a83e, metalness: 0.95, roughness: 0.12, emissive: 0x3d2706 });
  const orange = new THREE.MeshStandardMaterial({ color: FLAG_COLOR, roughness: 0.6, emissive: 0x2a1805 });
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  const pivot = (parent, x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; };
  // a segment that hangs down from its pivot: radius r, length len (joint to joint)
  const segment = (parent, r, len, mat = suit) => { const geo = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r), 6, 14); geo.translate(0, -len / 2, 0); return mesh(geo, mat, parent); };
  const ball = (parent, r, mat, y = 0) => mesh(new THREE.SphereGeometry(r, 16, 12), mat, parent, 0, y, 0);

  const HIP_Y = 0.27;
  // legs: thigh and shin, with knee rings and rounded boots
  for (const side of [-1, 1]) {
    const hip = pivot(g, side * 0.048, HIP_Y, 0);
    hip.rotation.z = side * 0.06;
    segment(hip, 0.045, 0.13);
    const knee = pivot(hip, 0, -0.13, 0);
    ball(knee, 0.043, joint);
    segment(knee, 0.041, 0.12);
    const boot = mesh(new THREE.CapsuleGeometry(0.038, 0.06, 4, 12), grey, knee, 0, -0.125, 0.018);
    boot.rotation.x = Math.PI / 2; boot.scale.set(1.15, 1, 0.75);
  }
  // torso: a broad chest over the waist, the belt, the display and control box with its orange stripe
  const chest = mesh(new THREE.CapsuleGeometry(0.095, 0.11, 8, 18), suit, g, 0, 0.385, 0);
  chest.scale.set(1.12, 1, 0.82);
  mesh(new THREE.CylinderGeometry(0.083, 0.083, 0.03, 24), grey, g, 0, 0.29, 0).scale.set(1.05, 1, 0.85);
  mesh(new THREE.BoxGeometry(0.1, 0.055, 0.03), grey, g, 0, 0.395, 0.078);
  mesh(new THREE.BoxGeometry(0.06, 0.01, 0.004), orange, g, 0, 0.405, 0.095);
  for (const x of [-0.025, 0, 0.025]) mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 8), orange, g, x, 0.385, 0.095).rotation.x = Math.PI / 2;
  // the 540 mission patch on the left of the chest (+x, his left), following its curve
  const patchTex = new THREE.TextureLoader().load(ASTRONAUT_PATCH, onTexture);
  patchTex.colorSpace = THREE.SRGBColorSpace;
  const patch = mesh(new THREE.CircleGeometry(0.026, 32), new THREE.MeshStandardMaterial({ map: patchTex, transparent: true, roughness: 0.7, emissive: 0xffffff, emissiveMap: patchTex, emissiveIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -2 }), g, 0.058, 0.452, 0.077);
  patch.rotation.y = 0.42; patch.castShadow = false;
  // backpack (life support), with its top unit
  mesh(new THREE.BoxGeometry(0.18, 0.24, 0.085), suit, g, 0, 0.4, -0.11);
  mesh(new THREE.BoxGeometry(0.15, 0.035, 0.07), grey, g, 0, 0.535, -0.11);
  // arms: shoulder → upper arm → elbow → forearm → wrist → glove
  // Each segment points from its joint along a direction of the body (x right, y up, z forward): the upper arm from
  // the shoulder, the forearm from the elbow. `twist` turns the hand about the forearm.
  const DOWN = new THREE.Vector3(0, -1, 0);
  const arm = (side, upperDir, foreDir, twist = 0) => {
    const sh = pivot(g, side * 0.118, 0.465, 0);
    ball(sh, 0.046, suit);
    sh.quaternion.setFromUnitVectors(DOWN, new THREE.Vector3(...upperDir).normalize());
    segment(sh, 0.036, 0.12);
    const el = pivot(sh, 0, -0.12, 0);
    ball(el, 0.034, joint);
    const fore = new THREE.Vector3(...foreDir).normalize().applyQuaternion(sh.quaternion.clone().invert());
    el.quaternion.setFromUnitVectors(DOWN, fore).multiply(new THREE.Quaternion().setFromAxisAngle(DOWN, twist));
    segment(el, 0.032, 0.11);
    const wr = pivot(el, 0, -0.11, 0);
    mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.016, 16), grey, wr);
    const glove = mesh(new THREE.BoxGeometry(0.05, 0.06, 0.028, 2, 2, 2), grey, wr, 0, -0.036, 0);
    const thumb = segment(wr, 0.011, 0.03, grey);
    thumb.position.set(side * -0.026, -0.016, 0.006); thumb.rotation.z = side * -0.6;
    return { sh, el, wr };
  };
  // He faces +z, so his right is -x. Left arm (+x): relaxed at the side, the elbow a little bent forward.
  arm(1, [0.16, -1, 0.05], [0.1, -1, 0.3]);
  // Right arm: a military salute. Upper arm out to the side and a little forward, near level; forearm back across to
  // the head, so the flat hand, palm down, ends at the temple, by the edge of the visor.
  arm(-1, [-0.86, 0.12, 0.5], [0.77, 0.64, 0.07], Math.PI / 2);
  // helmet: neck ring, white shell, the gold visor wrapping its front
  mesh(new THREE.CylinderGeometry(0.058, 0.066, 0.03, 24), grey, g, 0, 0.51, 0);
  const helmet = pivot(g, 0, 0.585, 0);
  ball(helmet, 0.088, suit);
  const visor = mesh(new THREE.SphereGeometry(0.081, 32, 20, Math.PI * 0.12, Math.PI * 0.76, Math.PI * 0.3, Math.PI * 0.36), visorMat, helmet, 0, 0.004, 0.012);
  visor.rotation.y = 0;
  return g;
}

// The spacecraft that brought them: a slim landing rocket (in km), standing on four legs with pads, with an engine
// bell, a nose cone, portholes and the orange band of 540.
// Where the four feet stand, in the rocket's own frame (before it is turned and scaled): the placement reads the
// ground under each one.
const ROCKET_FEET = [0, 1, 2, 3].map(k => { const a = Math.PI / 4 + k * Math.PI / 2; return { x: Math.cos(a) * 0.48, z: Math.sin(a) * 0.48 }; });
/** footY(k): height of foot k below the rocket's base, in its frame (0 on flat ground): each leg reaches its ground. */
function makeRocket(footY = () => 0) {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.45, metalness: 0.35, emissive: 0x161616 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.5, metalness: 0.6, emissive: 0x0c0c0c });
  const orange = new THREE.MeshStandardMaterial({ color: FLAG_COLOR, roughness: 0.5, metalness: 0.2, emissive: 0x2a1805 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.1, metalness: 0.8, emissive: 0x0a1626 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const R = 0.2, bodyH = 1.6, base = 0.32;
  add(new THREE.CylinderGeometry(0.17, 0.11, 0.2, 24, 1, true), dark, 0, base - 0.08, 0); // engine bell
  add(new THREE.CylinderGeometry(R, R, bodyH, 32), hull, 0, base + bodyH / 2, 0);
  add(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.12, 32), orange, 0, base + 0.35, 0); // the 540 band
  add(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.03, 32), dark, 0, base + bodyH - 0.25, 0);
  add(new THREE.ConeGeometry(R, 0.55, 32), hull, 0, base + bodyH + 0.275, 0); // nose
  add(new THREE.SphereGeometry(0.025, 12, 8), orange, 0, base + bodyH + 0.56, 0);
  for (const y of [base + bodyH - 0.45, base + bodyH - 0.62]) { const w = add(new THREE.CircleGeometry(0.045, 20), glass, 0, y, R + 0.002); w.castShadow = false; }
  // hatch with a ladder down to the ground
  add(new THREE.BoxGeometry(0.12, 0.2, 0.01), dark, 0, base + 0.62, R + 0.004);
  for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.08, 0.008, 0.008), dark, 0, 0.06 + k * 0.08, R + 0.04);
  // four legs: a strut out from the hull to a round pad on the ground
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, dx = Math.cos(a), dz = Math.sin(a);
    const fy = footY(k), top = new THREE.Vector3(dx * R * 0.9, base + 0.3, dz * R * 0.9), foot = new THREE.Vector3(ROCKET_FEET[k].x, fy + 0.03, ROCKET_FEET[k].z);
    const len = top.distanceTo(foot), mid = top.clone().add(foot).multiplyScalar(0.5);
    const leg = add(new THREE.CylinderGeometry(0.018, 0.022, len, 10), dark, mid.x, mid.y, mid.z);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    add(new THREE.CylinderGeometry(0.07, 0.08, 0.025, 20), dark, foot.x, fy + 0.0125, foot.z);
    const fin = add(new THREE.BoxGeometry(0.012, 0.32, 0.16), orange, dx * (R + 0.07), base + 0.28, dz * (R + 0.07));
    fin.rotation.y = -a;
  }
  return g;
}

/**
 * @param {{meta:object, heights:Float32Array, far?:Float32Array|null, detail?:(Float32Array|null)[], flag:{x:number,z:number}}} relief
 *   region relief (`detail`: the decoded grids of `meta.detail`, if any) and flag position in the scene (km)
 * @param {{explore?:boolean, foot?:boolean, notice?:{show:Function, hide:Function}|null}} options `foot` (the exploration's
 *   value by default): it can go down on foot. `notice`: the "3D not available"
 *   notice (lost.js, G1.2b #286), shown if the renderer cannot be created (then this throws) or the context is lost
 */
export function createScene(canvas, sunAz, { meta, heights: fineHeights, far = null, detail = [], flag }, { explore = false, foot: withFoot = explore, notice = null } = {}) {
  // On foot the near plane is 30 cm and the horizon 300 km away: a logarithmic depth keeps both without flicker. Only in
  // the scenes that can go down on foot.
  const makeRenderer = () => new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: withFoot });
  const renderer = notice ? createRendererOrNotice(makeRenderer, notice) : makeRenderer();
  renderer.xr.enabled = explore; // virtual reality, on foot (#396)
  // On webglcontextrestored three.js rebuilds its state: the notice goes away and the scene is drawn again, with
  // its shadow map (which is only redrawn when flagged).
  if (notice) watchContextLoss(canvas, { notice, onRestore: () => redrawAfterRestore({ light, renderer, scene, camera }) });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The slopes that face the Sun are many times brighter than the flat ground it grazes: the curve keeps both readable.
  renderer.toneMapping = THREE[TONE_MAPPING];
  renderer.toneMappingExposure = EXPOSURE;
  // Quality level alto, medio or bajo, as in the home (#145): ?q=… forces it; otherwise it follows the device.
  const quality = resolveQuality({ params: new URLSearchParams(location.search), signals: readSignals(renderer.getContext(), navigator), stored: forcedLevel(loadOptions(browserStorage())) });
  const qualityPixelRatio = (w, h) => pixelRatio(quality.level, w, h, window.devicePixelRatio || 1, quality.values.pr);
  renderer.setPixelRatio(qualityPixelRatio(window.innerWidth, window.innerHeight));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // With the far ring, the edge strip of the fine mesh blends into it, so there is no step at the seam.
  const ring = far && meta.far ? far : null;
  const heights = ring ? blendFineHeights(meta, fineHeights, ring) : fineHeights;
  // The finer grids around the site go on top of the (blended) region grid: they end far from its edge strip.
  const levels = buildLevels(meta, heights, detail);
  const groundAt = (x, z) => surfaceHeightAt(levels, x, z);
  let foot = null, footApi = null; // on foot (E3.1), only with withFoot: set up further down
  let flagY = groundAt(flag.x, flag.z); // the flag can be moved (E2.2): flag, flagY and the pieces beside it follow
  const camera = new THREE.PerspectiveCamera(60, 1, CAMERA_NEAR_KM, SKY_RADIUS * 2); // the far plane (10000 km) holds the whole ring (300 km)
  // On foot, your own body is drawn after the world with its own camera, as the "view model" of first-person games: the
  // depth is cleared first, so the ground never cuts it, and its near plane is 2 cm (the arm raised to the watch, bent at the waist, comes within 5 cm). Only the suit is on its layer.
  const VIEW_NEAR_KM = 0.00002, VIEW_FAR_KM = 0.01;
  const viewModel = new THREE.PerspectiveCamera(60, 1, VIEW_NEAR_KM, VIEW_FAR_KM);
  viewModel.layers.set(VIEW_MODEL_LAYER);
  function draw() {
    if (renderer.xr.isPresenting) { if (inXRFrame) drawXR(); return; } // the headset draws in its own loop
    if (psvr) { drawPSVR(); return; }
    renderer.render(scene, camera);
    if (!foot?.active) return;
    lightBody();
    viewModel.position.copy(camera.position);
    viewModel.quaternion.copy(camera.quaternion);
    // In third person the astronaut stands in the world: the same depth range as the world camera, and the depth of the
    // world kept, so the relief can hide it. From its eyes, its own near plane and the depth cleared.
    const outside = foot.thirdPerson, near = outside ? camera.near : VIEW_NEAR_KM, far = outside ? camera.far : VIEW_FAR_KM;
    if (viewModel.near !== near || viewModel.far !== far) { viewModel.near = near; viewModel.far = far; viewModel.updateProjectionMatrix(); }
    // The same field as the world (already capped across on wide screens): your body never slides against the ground.
    if (viewModel.fov !== camera.fov || viewModel.aspect !== camera.aspect) { viewModel.fov = camera.fov; viewModel.aspect = camera.aspect; viewModel.updateProjectionMatrix(); }
    // A colour background makes three.js clear the colour on every render (r160): off for this pass, or the world goes.
    const background = scene.background;
    scene.background = null;
    renderer.autoClear = false;
    if (!outside) renderer.clearDepth();
    renderer.render(scene, viewModel);
    renderer.autoClear = true;
    scene.background = background;
  }
  // Virtual reality (WebXR, #396). In the headset three.js draws layer 1 for the left eye only and layer 2 for the right,
  // whatever the layers of the camera: your body, on layer 1 on screen, goes to layer 0 there (suit-body.js setXRLayers),
  // and its pass is made by visibility, the world hidden, instead of by layers. Its lights, too.
  // The headset gives metres: the camera is the child of a rig scaled ×0.001 that foot-view.js places under you, so in
  // the eyes' space a metre is a metre, and the near and far planes are given in metres there.
  // far: past the Sun (4000 km) and the sky (5000 km), in metres; the logarithmic depth keeps the precision.
  const XR_NEAR_M = 0.02, XR_FAR_M = 2e7;
  const rig = new THREE.Group();
  rig.name = 'xr-rig';
  scene.add(rig);
  let inXRFrame = false, xrSaved = null, sprites = [], xrApplied = false, xrAfterEnd = null, xrEyeOffset = 0;
  const M_TO_KM_XR = 0.001; // the scale of the rig (core/xr-input.js M_TO_KM)
  const bodyLights = () => [bodySun, bodyBounce, bodyAmbient, bodyLamp];
  const drawXR = () => drawPasses(camera);
  // The world, then your body over it with the depth cleared, by visibility (in the headset the layers are the eyes').
  function drawPasses(cam) {
    const body = new Set([foot?.bodyObject, ...bodyLights()]);
    const world = scene.children.filter(o => !body.has(o) && o !== rig);
    const was = world.map(o => o.visible), bodyWas = [...body].map(o => o?.visible);
    const showBody = on => [...body].forEach((o, k) => { if (o) o.visible = on && bodyWas[k]; });
    showBody(false);
    renderer.render(scene, cam);
    if (foot?.active) {
      lightBody();
      world.forEach(o => { o.visible = false; });
      showBody(true);
      const background = scene.background;
      scene.background = null;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, cam);
      renderer.autoClear = true;
      scene.background = background;
      world.forEach((o, k) => { o.visible = was[k]; });
    }
    showBody(true);
  }
  // What the headset, the controllers and the hands give this frame, in the headset's space (metres).
  const JOINT_NAMES = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip', ...['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].flatMap(f => ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(n => `${f}-${n}`))];
  // xrEyeOffset: without a floor ('local' space) the poses are from the head's rest height, so they get a standing one
  const asPoint = p => ({ x: p.x, y: p.y + xrEyeOffset, z: p.z });
  function readXR(frame) {
    const space = renderer.xr.getReferenceSpace(), viewer = frame.getViewerPose(space);
    if (!viewer) return null;
    const t = viewer.transform;
    const data = { head: { position: asPoint(t.position), quaternion: { x: t.orientation.x, y: t.orientation.y, z: t.orientation.z, w: t.orientation.w } }, left: null, right: null };
    for (const source of frame.session.inputSources) {
      if (source.handedness !== 'left' && source.handedness !== 'right') continue;
      const c = { grip: null, joints: null, trigger: 0, squeeze: 0, thumb: false, stick: { x: 0, y: 0 }, a: false };
      const grip = source.gripSpace && frame.getPose(source.gripSpace, space);
      if (grip) c.grip = asPoint(grip.transform.position);
      if (source.hand && frame.getJointPose) {
        const joints = {};
        for (const name of JOINT_NAMES) { const j = source.hand.get(name), p = j && frame.getJointPose(j, space); if (p) joints[name] = asPoint(p.transform.position); }
        if (Object.keys(joints).length === JOINT_NAMES.length) { c.joints = joints; c.grip ??= joints.wrist; }
      }
      const pad = source.gamepad;
      if (pad) {
        // xr-standard: buttons 0 trigger, 1 grip, 3 stick, 4 A/X, 5 B/Y; axes 2 and 3 the stick
        const b = i => pad.buttons[i];
        c.trigger = b(0)?.value ?? 0; c.squeeze = b(1)?.value ?? 0;
        c.thumb = [3, 4, 5].some(i => b(i)?.touched);
        c.stick = { x: pad.axes[2] ?? 0, y: pad.axes[3] ?? 0 };
        c.a = !!b(4)?.pressed;
      }
      data[source.handedness] = c;
    }
    // A plain gamepad (a DualShock 4 with the PS VR, an Xbox pad…): visors without VR controllers bring one.
    const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p?.connected && p.mapping === 'standard');
    if (pad) data.pad = { axes: [...pad.axes], pressed: pad.buttons.map(b => !!b?.pressed) };
    return data;
  }
  let xrLast = null;
  function xrLoop(time, frame) {
    if (!frame) return;
    const dt = xrLast === null ? 0 : Math.min(0.1, (time - xrLast) / 1000);
    xrLast = time;
    const data = readXR(frame);
    if (data) foot?.xrFrame(dt, data);
    inXRFrame = true;
    draw();
    inXRFrame = false;
  }
  /**
   * Into the headset. The state of the scene (planes, rig, sprites, stars, the view on foot) is only changed once the
   * session is really there; if three.js cannot take it (a headset without the floor space, say) nothing is touched but
   * the session, which is closed, and the error goes to the caller (xr-ui.js), which leaves the normal view on foot.
   */
  async function startXR() {
    if (!explore || renderer.xr.isPresenting || xrApplied || !navigator.xr) return false;
    if (footApi?.flying) return false; // a flight between views is under way: the headset waits for it
    if (!foot.active) footApi.enter({ flight: false }); // no flight in the headset
    const catalogue = loadVrStars(); // meanwhile the session is asked for; the stars are optional
    // the floor is optional: a headset without it gives the 'local' space, with the height of a standing person added
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    const space = referenceSpaceFor(session.enabledFeatures);
    session.addEventListener('end', endXR, { once: true });
    try {
      renderer.xr.setReferenceSpaceType(space.type);
      await renderer.xr.setSession(session);
      if (!renderer.xr.isPresenting) return false; // the session ended while it was set up
      await catalogue;
      xrEyeOffset = space.eyeOffsetM;
      applyXRState();
    } catch (err) {
      if (xrApplied) endXR(); else renderer.setAnimationLoop(null);
      await session.end().catch(() => {});
      throw err;
    }
    xrLast = null;
    renderer.setAnimationLoop(xrLoop);
    xrListeners.forEach(f => f(true));
    return true;
  }
  function applyXRState() {
    xrApplied = true;
    xrSaved = { near: camera.near, far: camera.far };
    camera.near = XR_NEAR_M; camera.far = XR_FAR_M;
    camera.updateProjectionMatrix();
    rig.add(camera);
    for (const l of bodyLights()) l.layers.set(0);
    // A sprite's size is taken from its own scale, not from the view: the rig's ×0.001 would shrink the Sun and the
    // glow of the Earth a thousand times, to a dot. In the headset they grow by as much.
    sprites = [];
    scene.traverse(o => { if (o.isSprite) { sprites.push([o, o.scale.clone()]); o.scale.multiplyScalar(1 / M_TO_KM_XR); } });
    useVrStars(true);
    foot.xrStart(rig);
  }
  // The one restoration, run by the end of the session and in the order of core/xr-session.js xrRestoreSteps. Going up
  // to the drone, exit() asks for the end of the session and leaves its own part in xrAfterEnd, which runs last.
  const xrRestore = {
    'stop-loop': () => renderer.setAnimationLoop(null),
    'detach-camera': () => { rig.remove(camera); camera.scale.set(1, 1, 1); },
    'foot-planes': () => { if (xrSaved) { camera.near = xrSaved.near; camera.far = xrSaved.far; camera.updateProjectionMatrix(); } },
    'body-lights': () => { for (const l of bodyLights()) l.layers.set(VIEW_MODEL_LAYER); },
    sprites: () => { for (const [o, scale] of sprites) o.scale.copy(scale); sprites = []; },
    stars: () => useVrStars(false),
    'foot-view': () => foot?.xrEnd(), // third person and the tilt of the gaze come back
    listeners: () => xrListeners.forEach(f => f(false)),
    resize: () => resize(),
  };
  function endXR() {
    if (!xrApplied) return; // the session ended before, or while, it was being set up
    xrApplied = false;
    const after = xrAfterEnd;
    xrAfterEnd = null;
    for (const step of xrRestoreSteps({ destination: after ? 'drone' : 'foot' })) xrRestore[step]?.();
    after?.();
  }
  const xrListeners = [];

  // PlayStation VR (PS4) without WebXR (#396): psvr.js gives the head's orientation from the headset's sensor, and here
  // both eyes are drawn on the headset's screen (a monitor of the computer, full screen): each eye into its own picture,
  // from its own camera, half the distance between the eyes to each side, and then the pictures through the lenses'
  // distortion and their colour fringes (core/psvr.js PSVR_OPTICS), side by side. The walk, the watch and the arms are
  // those of WebXR (foot-view.js xrFrame), fed with the head of the sensor, standing at PSVR_EYE_M, and a plain gamepad.
  const PSVR_EYE_M = 1.65, PSVR_IPD_M = 0.064, PSVR_SUPERSAMPLE = 1.3;
  let psvr = null;
  const eyeCams = [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()];
  const lensScene = new THREE.Scene(), lensCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const lensMaterial = new THREE.ShaderMaterial({
    uniforms: { tL: { value: null }, tR: { value: null },
      k: { value: PSVR_OPTICS.k }, vp: { value: new THREE.Vector2(...PSVR_OPTICS.viewport) }, sc: { value: PSVR_OPTICS.scale * PSVR_OPTICS.viewport[0] },
      ab: { value: new THREE.Vector3(PSVR_OPTICS.aberration.r, PSVR_OPTICS.aberration.g, PSVR_OPTICS.aberration.b) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tL; uniform sampler2D tR; uniform float k[5]; uniform vec2 vp; uniform float sc; uniform vec3 ab; varying vec2 vUv;
      // Monado's panotools distortion of the PS VR (core/psvr.js lensSample)
      vec2 lens(vec2 uv, float a, float unused) {
        vec2 r = (uv * vp - vp * 0.5) / sc; float m = length(r);
        float f = k[0] + k[1] * m + k[2] * m * m + k[3] * m * m * m + k[4] * m * m * m * m;
        return (r * f * sc * a + vp * 0.5) / vp;
      }
      float inside(vec2 p) { return step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0); }
      float pick(vec2 p, bool right, int c) { vec4 t = right ? texture2D(tR, p) : texture2D(tL, p); return (c == 0 ? t.r : c == 1 ? t.g : t.b) * inside(p); }
      void main() {
        bool right = vUv.x >= 0.5; vec2 uv = vec2(right ? vUv.x * 2.0 - 1.0 : vUv.x * 2.0, vUv.y);
        gl_FragColor = vec4(pick(lens(uv, ab.r, 0.0), right, 0), pick(lens(uv, ab.g, 0.0), right, 1), pick(lens(uv, ab.b, 0.0), right, 2), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false, toneMapped: true,
  });
  lensScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lensMaterial));
  const eyeLocal = new THREE.Vector3(), headQ = new THREE.Quaternion(), rigQ = new THREE.Quaternion();
  function drawPSVR() {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const ew = Math.round(w / 2 * PSVR_SUPERSAMPLE), eh = Math.round(h * PSVR_SUPERSAMPLE);
    if (!psvr.targets || psvr.targets[0].width !== ew || psvr.targets[0].height !== eh) {
      psvr.targets?.forEach(t => t.dispose());
      psvr.targets = [0, 1].map(() => new THREE.WebGLRenderTarget(ew, eh, { type: THREE.HalfFloatType, samples: 4 }));
    }
    // the head: at the rig's place, its orientation from the sensor; each eye half the distance between them to its side
    const q = psvr.headset.orientation();
    headQ.set(q.x, q.y, q.z, q.w);
    rig.updateMatrixWorld(true);
    rig.getWorldQuaternion(rigQ);
    eyeCams.forEach((cam, i) => {
      // each eye: Monado's field (85° across, ~89° up and down), whatever the size of its picture
      cam.fov = PSVR_OPTICS.fovVDeg;
      cam.aspect = Math.tan(PSVR_OPTICS.fovHDeg / 2 * Math.PI / 180) / Math.tan(PSVR_OPTICS.fovVDeg / 2 * Math.PI / 180);
      cam.near = 0.00002; cam.far = camera.far;
      cam.updateProjectionMatrix();
      eyeLocal.set((i === 0 ? -0.5 : 0.5) * PSVR_IPD_M, 0, 0).applyQuaternion(headQ).add({ x: 0, y: PSVR_EYE_M, z: 0 });
      cam.position.copy(rig.localToWorld(eyeLocal.clone()));
      cam.quaternion.copy(rigQ).multiply(headQ);
      cam.updateMatrixWorld(true);
      renderer.setRenderTarget(psvr.targets[i]);
      drawPasses(cam);
    });
    renderer.setRenderTarget(null);
    lensMaterial.uniforms.tL.value = psvr.targets[0].texture;
    lensMaterial.uniforms.tR.value = psvr.targets[1].texture;
    renderer.render(lensScene, lensCamera);
  }
  let psvrLast = null;
  function psvrLoop(now) {
    if (!psvr) return;
    psvr.frame = requestAnimationFrame(psvrLoop);
    const dt = psvrLast === null ? 0 : Math.min(0.1, (now - psvrLast) / 1000);
    psvrLast = now;
    const q = psvr.headset.orientation();
    const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p?.connected && p.mapping === 'standard');
    if (pad?.buttons[9]?.pressed && !psvr.optionsWas) psvr.headset.recenter(); // Options recentres
    psvr.optionsWas = !!pad?.buttons[9]?.pressed;
    foot.xrFrame(dt, {
      head: { position: { x: 0, y: PSVR_EYE_M, z: 0 }, quaternion: q }, left: null, right: null,
      pad: pad ? { axes: [...pad.axes], pressed: pad.buttons.map(b => !!b?.pressed) } : null,
    });
    draw();
  }
  /** Into the PS VR: `headset` from psvr.js connectPSVR (the page must already be full screen on its screen). */
  function startPSVR(headset) {
    if (!explore || psvr || renderer.xr.isPresenting || footApi?.flying) return;
    if (!foot.active) footApi.enter({ flight: false }); // no flight in the headset
    psvr = { headset, targets: null, frame: 0, optionsWas: false };
    foot.xrStart(rig);
    for (const l of bodyLights()) l.layers.set(0);
    loadVrStars().then(() => { if (psvr) useVrStars(true); });
    psvrLast = null;
    resize();
    psvr.frame = requestAnimationFrame(psvrLoop);
    xrListeners.forEach(f => f(true));
  }
  function stopPSVR() {
    if (!psvr) return;
    cancelAnimationFrame(psvr.frame);
    psvr.targets?.forEach(t => t.dispose());
    psvr = null;
    useVrStars(false);
    for (const l of bodyLights()) l.layers.set(VIEW_MODEL_LAYER);
    foot?.xrEnd();
    xrListeners.forEach(f => f(false));
    resize();
  }

  // Drone: to the side of the Sun's direction, looking down at the flag (core/drone-pose.js). «Restablecer» goes back to it.
  const initialPose = dronePose(flag, sunAz, groundAt);
  camera.position.set(initialPose.position.x, initialPose.position.y, initialPose.position.z);
  camera.lookAt(initialPose.target.x, initialPose.target.y, initialPose.target.z);

  // The regolith look of the ground (#393): one material per mesh, each with the grid step of its relief.
  const look = createTerrainLook({ level: quality.level });
  const terrainMeshes = makeTerrain(levels, look);
  scene.add(...terrainMeshes);
  if (ring) {
    const ringMesh = makeRing(meta, ring, look);
    // The two meshes compute their normals apart: the ring takes the fine ones on the seam so the light does not draw a line there.
    const rn = ringMesh.geometry.attributes.normal;
    matchSeamNormals(meta, levels[0].normals, ringMesh.geometry.attributes.position.array, rn.array);
    rn.needsUpdate = true;
    scene.add(ringMesh);
  }
  const flagMesh = makeFlag(() => draw());
  flagMesh.position.set(flag.x, flagY, flag.z);
  // The cloth faces the drone, turned a little so the creases and the bar show (+z is its face).
  flagMesh.rotation.y = Math.atan2(camera.position.x - flag.x, camera.position.z - flag.z) + 0.45;
  scene.add(flagMesh);
  // Beside the flag, as seen from the drone: the astronaut on its right, saluting it, and the rocket that brought them a
  // little further back on its left. Each one stands on the ground under it.
  const view = Math.atan2(camera.position.x - flag.x, camera.position.z - flag.z);
  const toCam = { x: Math.sin(view), z: Math.cos(view) }, right = { x: toCam.z, z: -toCam.x };
  const place = (obj, along, toward, turn) => {
    const x = flag.x + right.x * along + toCam.x * toward, z = flag.z + right.z * along + toCam.z * toward;
    obj.position.set(x, groundAt(x, z), z); obj.rotation.y = view + turn; scene.add(obj); return obj;
  };
  const ASTRONAUT_SPOT = [0.32, 0.12, -0.2];
  const astronaut = place(makeAstronaut(() => draw()), ...ASTRONAUT_SPOT); // three quarters to the drone, so the visor shows
  // The rocket stands level on a slope, like a real lander: the body at the height of its highest foot, and every leg
  // reaching down to the ground under it. One for the drone and, in the exploration, one at its real size for on foot.
  const placeRocket = ({ scale, reach }) => {
    const along = -1.3 * reach, toward = -0.8 * reach, turn = 0.3, angle = view + turn;
    const cx = flag.x + right.x * along + toCam.x * toward, cz = flag.z + right.z * along + toCam.z * toward;
    const ground = ROCKET_FEET.map(f => groundAt(
      cx + (f.x * Math.cos(angle) + f.z * Math.sin(angle)) * scale,
      cz + (-f.x * Math.sin(angle) + f.z * Math.cos(angle)) * scale));
    const baseY = Math.max(...ground);
    const rocket = makeRocket(k => (ground[k] - baseY) / scale);
    rocket.position.set(cx, baseY, cz); rocket.rotation.y = angle; rocket.scale.setScalar(scale);
    scene.add(rocket);
    return rocket;
  };
  let droneRocket = placeRocket(ROCKET_DRONE);
  let footRocket = withFoot ? placeRocket(ROCKET_FOOT) : null;
  if (footRocket) footRocket.visible = false;
  // Outside the headset the sky is the shared field of stars, as everywhere (#340). In a headset (#396) it does not read
  // well (fixed points of 1.6 px flicker through the lenses), so while the session lasts the real stars of the site
  // (star-field.js) take its place, turned to the time of the scene (setSkyTime) and faded with the Sun's elevation.
  // The catalogue (71 KB) is only fetched the first time a headset is entered.
  const sharedStars = starsOf(ring ? meta : { ...meta, far: undefined }); // without the ring, nothing under the horizon is drawn
  scene.add(sharedStars);
  const skySite = { lat: meta.center.lat, lon: meta.center.lon };
  let starField = null, starLoad = null, skyDate = null;
  const loadVrStars = () => starLoad ??= loadStarField(SKY_RADIUS).then(field => {
    starField = field;
    field.object.visible = false;
    scene.add(field.object);
    field.setSunElevation(sunNow.el);
    if (skyDate) field.setSky(skySite, skyDate);
    return field;
  }).catch(err => { starLoad = null; console.warn('Sin catálogo de estrellas: quedan las compartidas', err); return null; });
  /** The catalogue's stars in the headset, the shared field outside it (the shared one stays if the catalogue failed). */
  function useVrStars(on) {
    const own = on && !!starField;
    sharedStars.visible = !own;
    if (starField) { starField.object.visible = own; starField.setLensScale(psvr ? 1.8 : 1); }
  }
  // The time of the scene. It draws nothing: the caller renders once per step, and the headset draws every frame.
  function setSkyTime(date) {
    skyDate = date;
    starField?.setSky(skySite, date);
  }

  // Airless pole: the Sun's side is far brighter and the rest stays dark, with only the faint fills below.
  // At 0.38° the ground receives only sin(el) of the light, hence the high intensity (r160 physical lights).
  const ambient = new THREE.AmbientLight(AMBIENT.color, AMBIENT.intensity);
  scene.add(ambient);
  const light = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  light.castShadow = true;
  const shadowMapSize = Math.min(quality.values.shadow, renderer.capabilities.maxTextureSize);
  light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  // No normal bias: pushing the ground a few metres along its normal moves a grazing shadow hundreds of metres.
  light.shadow.normalBias = 0;
  // The shadow map is redrawn only when the Sun moves (setSun), not on every render: orbiting the camera does not change it.
  // With autoUpdate off, three.js r160 does not update the shadow matrices either, so setSun must flag needsUpdate.
  light.shadow.autoUpdate = false;
  light.shadow.needsUpdate = true;
  // The shadow camera holds the fine zone, the only one that casts shadows (the far ring does not: E5.2).
  const bounds = shadowBounds(levels);
  scene.add(light, light.target);

  const bounceFill = new THREE.DirectionalLight(BOUNCE.color, BOUNCE.intensity);
  const earthFill = new THREE.DirectionalLight(EARTH.color, 0); // off until the Earth is placed
  scene.add(bounceFill, bounceFill.target, earthFill, earthFill.target);
  // Your own body, drawn on its own layer, has its own lights (BODY_*): the world's would burn it white.
  const bodySun = new THREE.DirectionalLight(SUN.color, BODY_SUN_INTENSITY);
  const bodyBounce = new THREE.HemisphereLight(BODY_BOUNCE.sky, BODY_BOUNCE.ground, BODY_BOUNCE.intensity);
  const bodyAmbient = new THREE.AmbientLight(AMBIENT.color, BODY_AMBIENT);
  const bodyLamp = new THREE.DirectionalLight(BODY_LAMP.color, BODY_LAMP.intensity);
  for (const l of [bodySun, bodyBounce, bodyAmbient, bodyLamp]) { l.layers.set(VIEW_MODEL_LAYER); scene.add(l); }
  scene.add(bodyLamp.target);
  const lampAt = new THREE.Vector3();
  scene.add(bodySun.target);
  bodySun.target.layers.set(VIEW_MODEL_LAYER);
  let bodyShade = null; // where and for which Sun the shade was last looked up
  const eyeWorld = new THREE.Vector3();
  function lightBody() {
    const p = camera.getWorldPosition(eyeWorld), chest = { x: p.x, y: p.y - 0.0004, z: p.z };
    // the lamps: from a little above the eyes, along the gaze
    bodyLamp.position.copy(p).addScaledVector(camera.up, 0.0001);
    bodyLamp.target.position.copy(p).add(camera.getWorldDirection(lampAt));
    bodyLamp.target.updateMatrixWorld();
    if (bodyShade && bodyShade.sun === sunNow && Math.hypot(chest.x - bodyShade.x, chest.z - bodyShade.z) < BODY_SHADE_STEP_KM && Math.abs(chest.y - bodyShade.y) < BODY_SHADE_STEP_KM) return;
    const lit = sunFraction(chest, sunNow, groundAt);
    bodyShade = { ...chest, sun: sunNow };
    const d = dirAzEl(sunNow.az, sunNow.el);
    bodySun.position.set(p.x + d.x, p.y + d.y, p.z + d.z);
    bodySun.target.position.copy(p);
    bodySun.target.updateMatrixWorld();
    bodySun.intensity = BODY_SUN_INTENSITY * lit;
    // in the shade the ground round you is mostly dark too: less bounce
    bodyBounce.intensity = BODY_BOUNCE.intensity * (0.35 + 0.65 * lit);
  }

  const sunMaterial = new THREE.SpriteMaterial({ map: sunTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  sunMaterial.color.setRGB(6, 5.6, 5);
  const sun = new THREE.Sprite(sunMaterial);
  sun.scale.set(SUN_GLOW_WIDTH, SUN_GLOW_WIDTH, 1);
  const sunDiscMaterial = new THREE.SpriteMaterial({ map: sunDiscTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  sunDiscMaterial.color.setRGB(6, 5.6, 5);
  const sunDisc = new THREE.Sprite(sunDiscMaterial);
  sunDisc.scale.set(SUN_DISC_WIDTH, SUN_DISC_WIDTH, 1);
  scene.add(sun, sunDisc);

  // `visible` (mission viewer): what the windows of the verdict say. A hidden Sun is drawn faded where it is.
  let sunNow = { az: sunAz, el: 0 };
  function setSun(az, el, visible = true) {
    sunNow = { az, el };
    starField?.setSunElevation(el);
    const d = dirAzEl(az, el);
    look.setSun(d);
    // The shadow camera is fitted to the region as the Sun sees it now: a thin slab when it grazes the horizon.
    const frustum = fitShadowFrustum(bounds, d);
    const shadowCamera = light.shadow.camera;
    Object.assign(shadowCamera, { left: frustum.left, right: frustum.right, top: frustum.top, bottom: frustum.bottom, near: frustum.near, far: frustum.far });
    shadowCamera.updateProjectionMatrix();
    // Along the ray, one texel of height is this much depth on flat ground. A bias along the ray barely moves the shadow.
    const texelKm = (frustum.top - frustum.bottom) / light.shadow.mapSize.y;
    const grazing = Math.max(Math.abs(el), SHADOW_MIN_GRAZING_DEG) * Math.PI / 180;
    light.shadow.bias = -(SHADOW_BIAS_TEXELS * texelKm / Math.tan(grazing)) / (frustum.far - frustum.near);
    light.position.set(d.x * frustum.distance, d.y * frustum.distance, d.z * frustum.distance); // the light comes from the Sun and points at the origin
    const back = dirAzEl(az + 180, BOUNCE.elevationDeg);
    bounceFill.position.set(back.x, back.y, back.z);
    sun.position.set(d.x * SUN_DISTANCE, d.y * SUN_DISTANCE, d.z * SUN_DISTANCE);
    sunDisc.position.copy(sun.position);
    sunMaterial.opacity = sunDiscMaterial.opacity = visible ? 1 : 0.25;
    light.shadow.needsUpdate = true;
    if (earth.visible) lightEarth(); // the Sun moved: so does the night side of the Earth
  }

  const earth = makeEarth(() => draw());
  earth.visible = false; // until it is placed: setEarth (mission viewer) or setExploreEarth (exploration)
  scene.add(earth);
  // The night side of the Earth is the one away from the Sun (both are so far that their directions are enough).
  const lightEarth = () => earth.userData.material.uniforms.sunDir.value.copy(sun.position).sub(earth.position).normalize();

  // The Earth at its azimuth and elevation. `visible`: what the windows of the verdict say; when they say it is not
  // seen it is drawn faded, even if it peeks over the drawn relief.
  // `t` (ms): the time of the scene, which turns the globe once a sidereal day.
  function setEarth(az, el, visible, t) {
    const d = dirAzEl(az, el);
    earth.position.set(d.x * SUN_DISTANCE, d.y * SUN_DISTANCE, d.z * SUN_DISTANCE);
    if (Number.isFinite(t)) earth.userData.globe.rotation.y = earthSpin(t);
    lightEarth();
    // The fill of the Earth comes from its azimuth; none with the Earth under the horizon.
    const fill = dirAzEl(az, earthLightElevation(el));
    earthFill.position.set(fill.x, fill.y, fill.z);
    earthFill.intensity = earthLightIntensity(el);
    earth.userData.material.uniforms.opacity.value = visible ? 1 : 0.25;
    earth.userData.glow.material.opacity = visible ? 1 : 0.25;
    earth.visible = true;
  }

  // The Earth of the exploration, from the drone and on foot (E1.4, #125: its label «Tierra» goes over it). Only the globe:
  // its fill light belongs to the mission viewer. `visible`: what the series says; hidden by the relief, it is faded.
  function setExploreEarth(az, el, visible = true) {
    const d = dirAzEl(az, el);
    earth.position.set(d.x * SUN_DISTANCE, d.y * SUN_DISTANCE, d.z * SUN_DISTANCE);
    earth.userData.material.uniforms.opacity.value = visible ? 1 : 0.25;
    earth.userData.glow.material.opacity = visible ? 1 : 0.25;
    lightEarth();
    earth.visible = true;
  }

  // Screen position (CSS px) of the Sun and the Earth, for their labels. null when behind the camera or not placed.
  const projected = new THREE.Vector3();
  function project(obj) {
    if (!obj.visible) return null;
    projected.copy(obj.position).project(camera);
    const behind = projected.z > 1; // behind the camera the projection mirrors: flip it, so the label points the right way
    if (behind) { projected.x = -projected.x * 1e3; projected.y = -projected.y * 1e3; }
    const w = window.innerWidth, h = window.innerHeight;
    return { x: (projected.x + 1) / 2 * w, y: (1 - projected.y) / 2 * h, onScreen: !behind && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 };
  }
  const labels = () => ({ sun: project(sun), earth: project(earth) });
  // Screen position of the astronaut's helmet (0.585 km over its feet, at its scale): where the celebration of a salute starts.
  const astronautHead = new THREE.Object3D();
  astronautHead.position.y = 0.585;
  astronaut.add(astronautHead);
  const astronautOnScreen = () => {
    astronautHead.getWorldPosition(projected).project(camera);
    if (projected.z > 1) return null;
    return { x: (projected.x + 1) / 2 * window.innerWidth, y: (1 - projected.y) / 2 * window.innerHeight, onScreen: Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 };
  };

  // Where the camera looks, as an azimuth (API convention of core/direction.js: 0° north = -z, 90° east = +x) and half its
  // horizontal field of view, for the wedge of the horizon ring (E1.1). From the camera itself, so it also follows the
  // view on foot, where the orbit target stays still.
  const lookDir = new THREE.Vector3();
  function heading() {
    camera.getWorldDirection(lookDir);
    const az = ((Math.atan2(lookDir.x, -lookDir.z) * 180 / Math.PI) + 360) % 360;
    const halfDeg = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect) * 180 / Math.PI;
    return { az, halfDeg };
  }

  // Looks from behind the lander towards a direction (the Sun or the Earth), low over the ground, so what covers it
  // in the relief shows between the lander and the sky. Drag still turns the camera around the lander.
  function lookToward(az, el) {
    // Behind and a little to the side, so the flag does not hide the sky it looks at; the target is beyond the lander.
    const d = dirAzEl(az, 0), side = dirAzEl(az + 90, 0), back = 4, up = 1.1, reach = 6;
    const x = flag.x - d.x * back + side.x * 0.8, z = flag.z - d.z * back + side.z * 0.8;
    camera.position.set(x, Math.max(flagY, groundAt(x, z)) + up, z);
    const tx = flag.x + d.x * reach, tz = flag.z + d.z * reach;
    controls.target.set(tx, flagY + 0.3 + Math.tan(Math.max(0, el) * Math.PI / 180) * (back + reach), tz);
    controls.update();
  }

  // The ring of the lander says light or shadow at the site, from the same windows as the verdict (not the shadow map).
  function setLanderLit(lit) {
    flagMesh.userData.ring.material.color.setHex(lit ? FLAG_COLOR : LANDER_SHADOW_COLOR);
  }

  // Moving the flag (E2.2). `moveFlag(x, z)` takes the flag, the astronaut and the rockets to a point of the scene (km);
  // `full` also lays the rockets level on the new ground, which builds their legs again (on the drop and with the keys: not on
  // every frame of a drag, where they are only shifted). The drone's pose is not touched: «Restablecer» only returns the camera.
  const flagHit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 8), new THREE.MeshBasicMaterial({ visible: false }));
  flagHit.position.y = 0.65; // a fat invisible pole: the real one is a few metres wide from the drone
  flagMesh.add(flagHit);
  const hitTargets = flagMesh.children.filter(c => c !== flagMesh.userData.ring);
  const dropRocket = rocket => {
    if (!rocket) return;
    const was = rocket.visible;
    scene.remove(rocket);
    // Free the GPU buffers of the old rocket: every rebuild makes new geometries and materials.
    rocket.traverse(o => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) m.dispose(); });
    return was;
  };
  // Where the astronaut and the rockets stand: with the flag, except on foot (E3.6), where the flag can be carried and planted
  // elsewhere and they stay; going up, moveFlag takes them to it.
  const pieces = { x: flag.x, z: flag.z, y: flagY };
  function moveFlag(x, z, { full = true } = {}) {
    const next = moveWithPieces({ flag, pieces }, x, z), { dx, dz } = next, y0 = pieces.y;
    flag.x = next.flag.x; flag.z = next.flag.z;
    flagY = groundAt(x, z);
    pieces.x = next.pieces.x; pieces.z = next.pieces.z; pieces.y = flagY;
    flagMesh.position.set(x, flagY, z);
    const a = astronaut.position;
    const ax = a.x + dx, az = a.z + dz;
    astronaut.position.set(ax, groundAt(ax, az), az);
    if (full) {
      const droneWas = dropRocket(droneRocket), footWas = dropRocket(footRocket);
      droneRocket = placeRocket(ROCKET_DRONE);
      droneRocket.visible = droneWas;
      if (withFoot) { footRocket = placeRocket(ROCKET_FOOT); footRocket.visible = footWas; }
    } else {
      for (const r of [droneRocket, footRocket]) if (r) r.position.set(r.position.x + dx, r.position.y + flagY - y0, r.position.z + dz);
    }
    light.shadow.needsUpdate = true;
    draw();
  }
  /** Surface point (km, scene) under a screen point, or null if it points at the sky. */
  const raycaster2 = new THREE.Raycaster();
  const pointer2 = new THREE.Vector2();
  const rayAt = (clientX, clientY, objects) => {
    const r = canvas.getBoundingClientRect();
    pointer2.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster2.setFromCamera(pointer2, camera);
    return raycaster2.intersectObjects(objects, false)[0] ?? null;
  };
  /**
   * Drag the flag with the pointer: `pointerdown` on its mesh, `pointermove` with a ray to the terrain. Only from the drone.
   * @param {{canDrag:()=>boolean, limit:(x:number,z:number)=>{x:number,z:number}, onMove:(at:{x:number,z:number})=>void,
   *   onDrop:(at:{x:number,z:number})=>void}} hooks `limit` keeps it in the grid; `onMove` is called once a frame at most.
   */
  function enableFlagDrag({ canDrag, limit, onMove, onDrop }) {
    let drag = null, pending = null, frame = 0;
    const flush = () => { frame = 0; if (pending) { const p = pending; pending = null; onMove(p); } };
    canvas.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || foot?.active || footApi?.flying || renderer.xr.isPresenting || !canDrag()) return;
      if (!rayAt(ev.clientX, ev.clientY, hitTargets)) return;
      // Before OrbitControls sees it: this gesture is for the flag.
      ev.stopImmediatePropagation();
      ev.preventDefault();
      drag = { id: ev.pointerId };
      controls.enabled = false;
      canvas.setPointerCapture?.(ev.pointerId);
      canvas.style.cursor = 'grabbing';
    }, { capture: true });
    canvas.addEventListener('pointermove', ev => {
      if (!drag || ev.pointerId !== drag.id) return;
      const hit = rayAt(ev.clientX, ev.clientY, terrainMeshes);
      if (!hit) return;
      const at = limit(hit.point.x, hit.point.z);
      moveFlag(at.x, at.z, { full: false });
      pending = at;
      if (!frame) frame = requestAnimationFrame(flush);
    });
    const end = ev => {
      if (!drag || ev.pointerId !== drag.id) return;
      drag = null;
      cancelAnimationFrame(frame); frame = 0; pending = null;
      controls.enabled = !foot?.active;
      canvas.style.cursor = '';
      canvas.releasePointerCapture?.(ev.pointerId);
      const at = { x: flag.x, z: flag.z };
      moveFlag(at.x, at.z, { full: true });
      onDrop(at);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // Drag to turn around the lander and look for the Sun or the Earth (it does not go under the ground).
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(initialPose.target.x, initialPose.target.y, initialPose.target.z);
  controls.maxPolarAngle = Math.PI / 2 + 0.15;
  controls.minDistance = 0.5;
  controls.maxDistance = meta.extentKm;
  controls.update();
  const cameraListeners = [];
  // Tour (E2.1, #152): right button or Shift + drag, and two fingers, pan; the double click centres. Neither the camera nor
  // the point it looks at go under the relief or out of the region, in the tour and in the mission viewer alike: the
  // mission's orbit dips under its target's horizon and, zoomed out, would sink the drone into the ground. Under the
  // drone's ceiling too, so the stars still reach below the far ring's edge (#340).
  let centering = null;
  let resetFrame = 0;
  let activeFlight = null; // the flight of flyPath in progress (ascent, descent or its undo)
  const stopFlight = () => { activeFlight?.stop(); activeFlight = null; };
  // A drag, a pinch or the wheel takes the camera back from the glide to the initial pose, and from a flight.
  controls.addEventListener('start', () => { cancelAnimationFrame(resetFrame); resetFrame = 0; stopFlight(); });
  const keepInBounds = () => {
    const { position: c, target: t, moved } = limitCamera(camera.position, controls.target, groundAt, meta.extentKm, droneCeilingKm(meta));
    camera.position.set(c.x, c.y, c.z);
    controls.target.set(t.x, t.y, t.z);
    if (moved) camera.lookAt(controls.target); // OrbitControls aimed before the clamp: aim again at the clamped point
  };
  controls.addEventListener('change', () => {
    if (!foot?.active) keepInBounds();
    draw();
    cameraListeners.forEach(f => f());
  });
  if (explore) {
    controls.screenSpacePanning = true;
    // Arrow keys pan, C centres. The window listens, but not while a form control has the keys (select, date, slider).
    const keyTarget = {
      addEventListener: (type, fn) => window.addEventListener(type, ev => { if (!isFormTarget(ev.target) && !modalOpen(document)) fn(ev); }),
      removeEventListener() {},
    };
    controls.listenToKeyEvents(keyTarget);
    controls.maxPolarAngle = Math.PI - 0.05; // the ground limit replaces the angle limit
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    // A drag, a pinch or the wheel takes the camera back from the centring animation.
    controls.addEventListener('start', () => { cancelAnimationFrame(centering); centering = null; });
    const centreOn = (point) => {
      stopFlight();
      cancelAnimationFrame(centering);
      cancelAnimationFrame(resetFrame);
      centering = null;
      resetFrame = 0;
      const target0 = controls.target.clone(), camera0 = camera.position.clone();
      const delta = new THREE.Vector3(point.x, point.y, point.z).sub(target0);
      const reduce = prefersReducedMotion();
      // Absolute interpolation from the start: a clamp in one frame does not build up an error.
      const place = (e) => {
        camera.position.copy(camera0).addScaledVector(delta, e);
        controls.target.copy(target0).addScaledVector(delta, e);
        controls.update();
      };
      if (reduce) { place(1); return; }
      const t0 = performance.now(), DURATION_MS = 400;
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / DURATION_MS);
        place(k * k * (3 - 2 * k));
        centering = k < 1 ? requestAnimationFrame(tick) : null;
      };
      centering = requestAnimationFrame(tick);
    };
    const centreAt = (clientX, clientY) => {
      if (footApi?.flying) return;
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(terrainMeshes, false)[0]; // the sky has nothing to hit: nothing happens
      if (hit) centreOn(hit.point);
    };
    window.addEventListener('keydown', (ev) => {
      if (foot.active) return;
      if ((ev.key === 'c' || ev.key === 'C') && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !isFormTarget(ev.target) && !modalOpen(document)) {
        centreAt(window.innerWidth / 2, window.innerHeight / 2); // the point under the centre of the screen
      }
    });
    // Mouse double click. Touch is detected by hand below: browsers (iOS Safari above all) do not always turn a double tap into dblclick.
    const taps = createDoubleTapDetector({ maxMs: 300, maxPx: 20 });
    canvas.addEventListener('dblclick', (ev) => { if (!foot.active && !taps.isTouchEcho(performance.now())) centreAt(ev.clientX, ev.clientY); });
    const touchEvent = (type) => (ev) => {
      if (ev.pointerType !== 'touch' || foot.active) return;
      if (taps.handle({ type, id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now() })) centreAt(ev.clientX, ev.clientY);
    };
    canvas.addEventListener('pointerdown', touchEvent('down'));
    canvas.addEventListener('pointerup', touchEvent('up'));
    canvas.addEventListener('pointercancel', touchEvent('cancel'));
    canvas.style.touchAction = 'none';
  }
  // On foot (E3.1, #182): the camera at the eyes of a person, at the flag. The drone pose is kept and comes back as it was.
  if (withFoot) {
    // The textures of the suit: 4096 px in alto, less on weaker devices (each one is 64 MB of video memory at 4096).
    // and the smoothing of its cloth: 9 triangles for each one in alto and medio (about 250 000), 4 in bajo (seen from 30 cm, the gloves facet with fewer).
    const suitTexture = { alto: 4096, medio: 2048, bajo: 1024 }[quality.level] ?? 2048;
    const suitSmoothing = { alto: 3, medio: 3, bajo: 2 }[quality.level] ?? 3;
    foot = createFootView({ scene, camera, canvas, terrainMeshes, groundAt, extentKm: meta.extentKm, render: () => draw(), suitTexture, suitSmoothing });
    let saved = null;
    // E7.1 (#496): one change of view at a time, flying (or fading) between the drone and the ground.
    const flight = createFlightLock();
    let flightFrame = 0, veil = null;
    const setScale = (onFoot, flagScale = onFoot ? FOOT_FLAG_SCALE : 1) => {
      flagMesh.scale.setScalar(flagScale);
      astronaut.visible = !onFoot; // on foot, the astronaut is you
      flagMesh.userData.ring.visible = !onFoot; // the ring marks the site from above; in first person it is not there
      droneRocket.visible = !onFoot;
      footRocket.visible = onFoot;
    };
    const modeListeners = [];
    /** `flight: false`: back up at once (a «Restablecer» on foot glides to the initial pose right after). */
    const exit = ({ flight: withFlight = true } = {}) => {
      if (!foot.active || flight.running) return;
      // In the headset: ask for the end of the session and finish when it has been undone (endXR, once and in order),
      // so the drone keeps ITS near plane and the camera is out of the rig.
      if (xrApplied) { xrAfterEnd = leaveFoot; renderer.xr.getSession()?.end(); return; }
      const wasPSVR = !!psvr; // the PS VR is left at once, as it is entered
      if (psvr) stopPSVR();
      if (wasPSVR || !shouldFly({ withFlight }) || !leaveWithFlight()) leaveFoot();
    };
    const leaveFoot = () => {
      foot.exit();
      setScale(false);
      camera.near = saved.near; camera.fov = saved.fov;
      camera.position.copy(saved.position);
      camera.updateProjectionMatrix();
      controls.target.copy(saved.target);
      controls.enabled = true;
      look.setFoot(false);
      controls.update();
      // OrbitControls redraws only if it sees the camera move, and it comes back to the very pose it had: draw it here,
      // or the last frame on foot (your arm, the watch) stays on the screen.
      draw();
      cameraListeners.forEach(f => f());
      modeListeners.forEach(f => f('drone'));
    };
    let pendingLook = null; // {yaw, pitch}: where to look on arriving (enter({ look }))
    const finishEnter = () => {
      setScale(true);
      camera.near = FOOT_NEAR_KM;
      camera.updateProjectionMatrix();
      look.setFoot(true);
      controls.enabled = false; // a drag on the flag mid-flight may have turned them back on
      foot.enter(arrivalAt(flag, sunNow), { onExit: exit });
      if (pendingLook) { foot.lookAt(pendingLook.yaw, pendingLook.pitch); pendingLook = null; } // the guided visit asked where to look
      modeListeners.forEach(f => f('foot'));
    };
    // Flight (E7.1, #496): what it touches is set from the progress k, so the last frame lands on the pose.
    const reduceMotion = prefersReducedMotion;
    const setCamera = (p) => {
      camera.position.set(p.position.x, p.position.y, p.position.z);
      camera.up.set(0, 1, 0);
      camera.near = p.near; camera.fov = p.fov;
      camera.updateProjectionMatrix();
      camera.lookAt(p.target.x, p.target.y, p.target.z);
      draw();
      cameraListeners.forEach(f => f());
    };
    const animate = (ms, onFrame, onDone) => {
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        onFrame(k);
        if (k < 1) flightFrame = requestAnimationFrame(tick);
        else { flightFrame = 0; onDone(); }
      };
      flightFrame = requestAnimationFrame(tick);
    };
    // Fade to black, `switchView` at the half, fade back; then the turn is free again.
    const fade = (switchView) => {
      if (!veil) {
        veil = document.createElement('div');
        veil.id = 'flight-veil';
        veil.setAttribute('aria-hidden', 'true');
        veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:50';
        document.body.appendChild(veil);
      }
      let switched = false;
      animate(FADE_MS, (k) => {
        if (!switched && pastHalf(k)) { switched = true; switchView(); }
        veil.style.opacity = String(fadeAlpha(k));
      }, () => { veil.style.opacity = '0'; flight.finish(); });
    };
    const footEyes = () => {
      const p = footPose(arrivalAt(flag, sunNow), groundAt);
      return { position: p.position, target: p.look, fov: fovForAspect(FOOT_FOV_DEG, camera.aspect, WORLD_MAX_H_DEG), near: FOOT_NEAR_KM };
    };
    const currentPose = () => ({ position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, near: camera.near });
    const flightMs = () => (flightMode({ reduceMotion: reduceMotion(), qualityLevel: quality.level }) === 'fly' ? FLIGHT_MS : 0);
    // Going down: the camera flies in an arc from the drone to the eyes at the flag. The flag shrinks in geometric
    // progression all along; the astronaut, the rockets and the ring change at the half.
    function enterWithFlight() {
      flight.start();
      if (!flightMs()) { fade(finishEnter); return; }
      const from = currentPose(), to = footEyes();
      let half = false;
      animate(FLIGHT_MS, (k) => {
        const s = flightScale(1, FOOT_FLAG_SCALE, k);
        if (!half && pastHalf(k)) { half = true; setScale(true, s); look.setFoot(true); } else flagMesh.scale.setScalar(s);
        setCamera(flightPose(from, to, k, groundAt));
      }, () => { flight.finish(); finishEnter(); });
    }
    // Going up: back to the pose of the drone it had, flying. False when it does not apply (the caller cuts).
    function leaveWithFlight() {
      if (!saved || !flight.start()) return !!saved;
      if (!flightMs()) { foot.exit(); fade(leaveFoot); return true; } // no more input on foot while it fades
      const from = currentPose(), to = saved;
      // On foot controls.target is still the drone's old point of view: look where the camera really looks.
      const dir = camera.getWorldDirection(new THREE.Vector3()), reach = camera.position.distanceTo(saved.target);
      from.target = camera.position.clone().addScaledVector(dir, reach);
      foot.exit(); // no more input on foot, and the suit is out of the view
      let half = false;
      animate(FLIGHT_MS, (k) => {
        const s = flightScale(FOOT_FLAG_SCALE, 1, k);
        if (!half && pastHalf(k)) { half = true; setScale(false, s); look.setFoot(false); } else flagMesh.scale.setScalar(s);
        setCamera(flightPose(from, to, k, groundAt));
      }, () => { flight.finish(); leaveFoot(); });
      return true;
    }
    footApi = {
      get flying() { return flight.running; },
      get active() { return foot.active; },
      /** `flight: false`: at once (the mission viewer that opens on foot). `look`: {yaw, pitch} to look at on arriving. */
      enter({ flight: withFlight = true, look: lookAtArrival = null } = {}) {
        if (foot.active || flight.running) return;
        pendingLook = lookAtArrival;
        stopFlight();
        cancelAnimationFrame(centering); centering = null;
        cancelAnimationFrame(zoomFrame);
        cancelAnimationFrame(resetFrame); resetFrame = 0;
        saved = { position: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, near: camera.near };
        controls.enabled = false;
        if (shouldFly({ withFlight, inXR: xrApplied, inPSVR: !!psvr })) { enterWithFlight(); return; }
        finishEnter();
      },
      exit,
      setJoystick: input => foot.setJoystick(input),
      jump: () => foot.jump(),
      state: () => foot.state(),
      /** Turns the gaze (the guided visit): azimuth and elevation in degrees. */
      lookAt: (yaw, pitch) => foot.lookAt(yaw, pitch),
      onModeChange: f => modeListeners.push(f),
      onStop: f => foot.onStop(f),
      onChange: f => foot.onChange(f), // every frame on which the view changes (E3.6)
      // The flag on foot (E3.6): on your right arm (`carryFlag(true)`) or planted at a point (`plantFlag`); key F.
      carryFlag(on) {
        if (on) { flagMesh.userData.restYaw = flagMesh.rotation.y; foot.carryFlag(flagMesh, true, FOOT_FLAG_SCALE); draw(); return; }
        foot.carryFlag(flagMesh, false, FOOT_FLAG_SCALE);
        scene.add(flagMesh);
        flagMesh.rotation.set(0, flagMesh.userData.restYaw ?? 0, 0);
        flagMesh.scale.setScalar(foot.active ? FOOT_FLAG_SCALE : 1);
        flagMesh.position.set(flag.x, flagY, flag.z);
        draw();
      },
      plantFlag(x, z) {
        const next = plantOnly({ flag, pieces }, x, z); // only the flag: the pieces stay where they stand
        flag.x = next.flag.x; flag.z = next.flag.z;
        flagY = groundAt(x, z);
        flagMesh.position.set(x, flagY, z);
        light.shadow.needsUpdate = true;
        draw();
      },
      onFlagKey: f => foot.onFlagKey(f),
      // The watch on the left wrist (R): raise or lower it, follow it, and its screen.
      setWatch: up => foot.setWatch(up),
      get watchUp() { return foot.watchUp; },
      onWatch: f => foot.onWatch(f),
      watchFace: foot.watchFace,
      // What the camera follows (gesture-ui.js): your arms, hands, head and eyes, and the gesture of the watch.
      setTracking: t => foot.setTracking(t),
      // Third person (V) and the skeleton the camera moves.
      setThirdPerson: on => foot.setThirdPerson(on),
      get thirdPerson() { return foot.thirdPerson; },
      onView: f => foot.onView(f),
      showSkeleton: on => foot.showSkeleton(on),
      // Virtual reality (#396): into the headset (it goes down on foot first), and whether it is on.
      startXR,
      exitXR: () => renderer.xr.getSession()?.end(),
      get inXR() { return renderer.xr.isPresenting || !!psvr; },
      // PlayStation VR without WebXR (psvr.js): into it with a connected headset, and out.
      startPSVR, stopPSVR,
      get inPSVR() { return !!psvr; },
      onXR: f => xrListeners.push(f),
    };
    foot.onChange(() => cameraListeners.forEach(f => f()));
  }

  // Zoom buttons: the camera glides towards (factor < 1) or away from (> 1) what it looks at, within the same limits
  // as the mouse wheel.
  let zoomFrame = 0;
  function zoom(factor) {
    stopFlight();
    if (footApi?.flying) return;
    cancelAnimationFrame(zoomFrame);
    cancelAnimationFrame(resetFrame);
    if (foot?.active) { foot.zoom(factor); return; }
    const offset = camera.position.clone().sub(controls.target), from = offset.length();
    const to = Math.max(controls.minDistance, Math.min(controls.maxDistance, from * factor));
    const dir = offset.normalize(), t0 = performance.now(), ms = 220;
    const step = now => {
      const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3;
      camera.position.copy(controls.target).addScaledVector(dir, from + (to - from) * e);
      controls.update(); // fires 'change': it renders and moves the labels
      if (k < 1) zoomFrame = requestAnimationFrame(step);
    };
    zoomFrame = requestAnimationFrame(step);
  }

  // Hand control (shared/hands/): the camera turns around the point it looks at, as a drag does, and moves closer or
  // further at once (zoom() glides, and here a factor arrives with every camera frame).
  const handOffset = new THREE.Vector3(), handAngles = new THREE.Spherical();
  function handMove(change) {
    if (foot?.active || footApi?.flying) return; // on foot your body moves the view, not the drone's camera
    stopFlight();
    cancelAnimationFrame(zoomFrame);
    cancelAnimationFrame(resetFrame); resetFrame = 0;
    cancelAnimationFrame(centering); centering = null;
    handAngles.setFromVector3(handOffset.copy(camera.position).sub(controls.target));
    change(handAngles);
    handAngles.phi = Math.max(Math.max(0.01, controls.minPolarAngle), Math.min(controls.maxPolarAngle, handAngles.phi));
    handAngles.radius = Math.max(controls.minDistance, Math.min(controls.maxDistance, handAngles.radius));
    camera.position.copy(controls.target).add(handOffset.setFromSpherical(handAngles));
    controls.update(); // fires 'change': it keeps the camera above the relief, renders and moves the labels
  }
  /** Turns the camera around its target: `dx` and `dy` in turns of π (1 is half a turn), to the right and down positive, as a drag. */
  const orbit = (dx, dy) => handMove(a => { a.theta -= dx * Math.PI; a.phi -= dy * Math.PI; });
  /** Multiplies the distance to the target: under 1 is closer. */
  const dolly = factor => handMove(a => { a.radius *= factor; });

  // «Restablecer» (E2.3, #154): back to the initial pose of the drone with a short glide, or at once with «reduce motion».
  // It interpolates from the pose at the start, so a clamp to the relief in one frame does not build up an error, and
  // the last frame sets the pose itself: the camera ends exactly where createScene put it.
  function resetView() {
    stopFlight();
    if (footApi?.flying) return;
    if (foot?.active) footApi.exit({ flight: false }); // on foot: back up to the drone at once, then the glide
    cancelAnimationFrame(zoomFrame);
    cancelAnimationFrame(centering);
    cancelAnimationFrame(resetFrame);
    centering = null;
    const from = { position: { ...camera.position }, target: { ...controls.target } };
    const place = (k) => {
      const { position: p, target: t } = glidePose(from, initialPose, k);
      camera.position.set(p.x, p.y, p.z);
      controls.target.set(t.x, t.y, t.z);
      controls.update(); // fires 'change': it keeps the camera above the relief, renders and moves the labels
      if (k >= 1) { // OrbitControls rebuilds the position from angles: put it back to the exact pose
        camera.position.set(p.x, p.y, p.z);
        camera.lookAt(controls.target);
        renderer.render(scene, camera);
        cameraListeners.forEach(f => f());
      }
    };
    const reduce = prefersReducedMotion();
    if (reduce) { place(1); return; }
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / RESET_MS);
      place(k);
      resetFrame = k < 1 ? requestAnimationFrame(tick) : 0;
    };
    resetFrame = requestAnimationFrame(tick);
  }

  // Region change (E7.2, #497): the camera rises over where it is and, in the new page, comes down on the new region.
  // `cancel()` glides back to where it was (only for the ascent). Both promises resolve with true when they finished.
  function placePose({ position: p, target: t }) {
    camera.position.set(p.x, p.y, p.z);
    controls.target.set(t.x, t.y, t.z);
    camera.lookAt(controls.target);
    renderer.render(scene, camera);
    cameraListeners.forEach(f => f());
  }
  function flyPath(poseAt, ms) {
    if (foot?.active) footApi.exit();
    stopFlight();
    cancelAnimationFrame(zoomFrame);
    cancelAnimationFrame(centering);
    cancelAnimationFrame(resetFrame);
    centering = null;
    let frame = 0, stopped = false;
    const t0 = performance.now();
    const done = new Promise(resolve => {
      const tick = now => {
        if (stopped) return resolve(false);
        const k = Math.min(1, (now - t0) / ms);
        placePose(poseAt(k));
        if (k < 1) frame = requestAnimationFrame(tick); else resolve(true);
      };
      placePose(poseAt(0));
      frame = requestAnimationFrame(tick);
    });
    const handle = { done, stop() { stopped = true; cancelAnimationFrame(frame); } };
    activeFlight = handle;
    done.then(() => { if (activeFlight === handle) activeFlight = null; });
    return handle;
  }
  function ascend() {
    const from = { position: { ...camera.position }, target: { ...controls.target } };
    const flight = flyPath(k => ascentPose(from, k, groundAt), ASCENT_MS);
    return {
      done: flight.done,
      cancel() { // back to where it was, from where it is
        flight.stop();
        const now = { position: { ...camera.position }, target: { ...controls.target } };
        return flyPath(k => glidePose(now, from, k), RESET_MS).done;
      },
    };
  }
  function descend() { return flyPath(k => descentPose(initialPose, k, groundAt), DESCENT_MS).done; }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(qualityPixelRatio(w, h));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    draw();
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    ...(explore && { flagAt: () => ({ x: flag.x, z: flag.z }), moveFlag, enableFlagDrag }),
    setSun, setEarth, setLanderLit, setSkyTime, labels, heading, astronautOnScreen, lookToward, zoom, orbit, dolly, resetView, ascend, descend, onCameraChange: f => cameraListeners.push(f), render: () => draw(),
    quality: { level: quality.level, source: quality.source },
    ...(footApi && { foot: footApi }),
    setExploreEarth: explore ? setExploreEarth : () => {},
    // The ground (exploration only): «Textura fina», the switch of the illustrative detail on foot (terrain-material.js).
    ...(explore && {
      ground: {
        get micro() { return look.micro; },
        setMicro(on) { look.setMicro(on); draw(); },
      },
    }),
  };
}
