// Your own body on foot (E3, #181): NASA's Z-2 spacesuit, the prototype for walking on planetary surfaces, seen from
// inside the helmet when you look down. The model and its textures are NASA's (public domain, NASA 3D Resources),
// prepared by pipeline/suit.mjs; here the helmet is cut away (the camera is in it) and the body gets a skeleton
// (core/suit-rig.js): the legs follow the gait (core/suit-pose.js) and the arms move with inertia (core/arm-motion.js).
//
// What you see, as in a real suit: the hard upper torso and the neck ring hide most of your legs and feet; the arms come
// forward and the gloves are in front of your belly.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { pnTessellate, weldNormals } from './core/pn-triangles.js';
import { BONES, BONE, HELMET_CUT_Y, INNER_BODY, SUIT_EYE, bodyTriangles, clipBelow, clipAbove, rigWeights } from './core/suit-rig.js';
import { suitPose } from './core/suit-pose.js';
import { createArmMotion, ARM_REST } from './core/arm-motion.js';
import { twoBoneIK, hingePose } from './core/arm-ik.js';
import { clearOfTorso } from './core/body-track.js';
import { weldGraph, findFingers, handWeights, toward } from './core/hand-rig.js';
import { cleanSuitPixels } from './core/suit-texture.js';
import { pieceMask, heightToNormal, dilate, darkParts } from './core/suit-maps.js';
import { radialProfile, seatRadius, bandRing } from './core/surface-fit.js';
import { EYE_HEIGHT_KM } from './core/foot-camera.js';

const MODEL_URL = new URL('../assets/suit-z2.glb', import.meta.url).href;
/** Layer of your own body: scene.js draws it with its own camera (the "view model" of first-person games). */
export const VIEW_MODEL_LAYER = 1;
/** The flag on the right arm (E3.6): metres from its foot to where the glove holds it, how far it leans forward (degrees) and
 *  how far the hand is held out to the right (m) so the cloth stays out of the view. */
const FLAG_GRIP_M = 0.9, FLAG_LEAN_DEG = 12, FLAG_OUT_M = 0.12, GLOVE_PAST_WRIST_M = 0.07;
/** Fingers (radians): the bend of a pressurised glove at rest, the bend the Z-2's glove is modelled with, and the most. */
const GLOVE_REST_BEND = 0.25;
const GLOVE_STRAIGHT = 0.1;
const FINGER_MAX_BEND = 1.5;
/** Seconds to raise the arm to the watch (and to lower it). */
const WATCH_RAISE_S = 0.35;
/** Where the wrist goes to read the watch, from the eyes (m): ahead, up (negative: below) and to the left. */
const WATCH_VIEW = { ahead: 0.3, up: -0.11, left: 0.0 }; // within reach of the arm (0.58 m from the shoulder), bent
// The relief of the cloth (core/suit-maps.js): the slope of a full white step per pixel of a 2048 px atlas, and the side of
// the normal map (the weave does not need more; it costs a quarter of the time of 4096).
const RELIEF_STRENGTH = 1;
const NORMAL_MAX = 2048;
/** Pixels the pieces of the colour atlas grow over its white background, at 4096 px (fewer on a smaller atlas). */
const DILATE_PX = 16;

/** The pixels of an image drawn at w × h. */
function pixelsOf(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: c, ctx, data: ctx.getImageData(0, 0, w, h) };
}

/**
 * The textures of the model, made fit to be seen from 30 cm (core/suit-maps.js, core/suit-texture.js): the colour no
 * larger than `max` px a side (phones: 1024), cleaned to an EVA suit and grown over the background of the atlas, so no
 * white leaks into the seams; the height map turned into a normal map whose slopes stop at the edges of the pieces.
 * The textures keep their objects (and so the flipY and the sampler of the file); only their images change.
 * @returns {THREE.Texture|null} the normal map
 */
function prepareTextures(material, max) {
  const map = material.map, height = material.normalMap ?? material.bumpMap;
  if (!map?.image) return null;
  const side = Math.min(max, map.image.width);
  const colour = pixelsOf(map.image, side, side);
  if (height?.image) {
    // Which pieces are dark parts is decided on a 1024 px copy (the pieces are large; it is a fraction of the time).
    const small = Math.min(1024, side), k = side / small;
    const smallMask = pieceMask(pixelsOf(height.image, small, small).data.data);
    const dark = darkParts(pixelsOf(map.image, small, small).data.data, small, small, smallMask);
    const darkFull = new Uint8Array(side * side);
    for (let y = 0; y < side; y++) {
      const row = Math.min(small - 1, Math.floor(y / k)) * small;
      for (let x = 0; x < side; x++) darkFull[y * side + x] = dark[row + Math.min(small - 1, Math.floor(x / k))];
    }
    cleanSuitPixels(colour.data.data, darkFull);
    const mask = pieceMask(pixelsOf(height.image, side, side).data.data);
    dilate(colour.data.data, side, side, mask, Math.max(2, Math.round(DILATE_PX * side / 4096)));
  } else cleanSuitPixels(colour.data.data);
  colour.ctx.putImageData(colour.data, 0, 0);
  map.image = colour.canvas;
  map.needsUpdate = true;
  map.anisotropy = 8;
  if (!height?.image) return null;
  const n = Math.min(NORMAL_MAX, side), h = pixelsOf(height.image, n, n);
  const normal = heightToNormal(h.data.data, n, n, RELIEF_STRENGTH * n / 2048);
  h.ctx.putImageData(new ImageData(normal, n, n), 0, 0);
  height.image = h.canvas;
  height.colorSpace = THREE.NoColorSpace;
  height.anisotropy = 8;
  height.needsUpdate = true;
  return height;
}

// The watch on the left wrist (E3, #181), in metres: a rugged case with its screen, on a strap round the suit's forearm.
// It hangs from the forearm bone: the forearm there moves rigidly with that bone (weight 1), so what is measured on the
// model at load holds in every pose. Nothing is assumed about the forearm: its surface round the strap is measured
// (core/surface-fit.js), the strap follows it 2.5 mm out and the case sits on the highest point under it, so no piece goes
// into the cloth or into another one.
const WRIST = [0.285, 1.12, 0.55]; // end of the forearm, before the glove (model metres)
const WATCH_AT = 0.72; // along the forearm, from the elbow
const CASE = { long: 0.088, wide: 0.06, thick: 0.017, round: 0.006 }; // long: along the forearm
const STRAP = { width: 0.03, gap: 0.0025, thick: 0.003 }; // gap: from the cloth to its inside face
const SCREEN = { w: 0.076, h: 0.0475, lift: 0.0006 }; // lift: in front of the face of the case (no z-fighting)
const SEAT_GAP = 0.0008; // between the strap and the back of the case
export const WATCH_SCREEN_PX = { w: 512, h: 320 };

function makeWatch() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.45, metalness: 0.6, emissive: 0x0b0c0e });
  const face = new THREE.Group(); // the case and its screen: turned to the eyes every frame
  const caseMesh = new THREE.Mesh(new RoundedBoxGeometry(CASE.long, CASE.wide, CASE.thick, 3, CASE.round), metal);
  const canvas = document.createElement('canvas');
  canvas.width = WATCH_SCREEN_PX.w; canvas.height = WATCH_SCREEN_PX.h;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.position.z = CASE.thick / 2 + SCREEN.lift;
  // two buttons on the long side of the case, fully outside it
  for (const y of [-0.012, 0.012]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 16), metal);
    b.rotation.z = Math.PI / 2; b.position.set(CASE.long / 2 + 0.002, y, 0);
    face.add(b);
  }
  face.add(caseMesh, screen);
  g.add(face);
  return { group: g, face, strap: null, canvas, texture };
}

/** The strap: a closed band 3 mm thick that follows the measured forearm (bandRing), in the frame of the forearm bone. */
function strapGeometry(profile, tCentre) {
  const rings = [];
  for (const [dt, off] of [[-STRAP.width / 2, STRAP.gap], [STRAP.width / 2, STRAP.gap], [STRAP.width / 2, STRAP.gap + STRAP.thick], [-STRAP.width / 2, STRAP.gap + STRAP.thick]]) {
    rings.push(bandRing(profile, tCentre + dt, off));
  }
  const n = rings[0].length, pos = [], idx = [];
  for (const ring of rings) for (const p of ring) pos.push(...p);
  // four faces round the section: inside, edge, outside, edge (rings 0-1, 1-2, 2-3, 3-0)
  for (let f = 0; f < 4; f++) {
    const a = f * n, b = ((f + 1) % 4) * n;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      idx.push(a + k, b + k, a + k1, a + k1, b + k, b + k1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Position, normal and uv of these triangles of the source, plain and not indexed (three corners per triangle). */
function corners(source, triangles) {
  const read = (name, size) => {
    const a = source.attributes[name];
    if (!a) return null;
    // getX/getY/getZ: the attributes of the file are interleaved, which have no getComponent in three r160
    const get = [i => a.getX(i), i => a.getY(i), i => a.getZ(i)];
    const arr = new Float32Array(triangles.length * size);
    triangles.forEach((v, i) => { for (let c = 0; c < size; c++) arr[i * size + c] = get[c](v); });
    return arr;
  };
  return { positions: read('position', 3), normals: read('normal', 3), uvs: read('uv', 2) };
}

/**
 * The geometry of the model, in metres with y up, the eyes over the origin and the feet at 0: without the helmet (its
 * pieces gone, the torso clipped at the neck ring), the cloth curved with PN triangles (no facets on the silhouettes;
 * `smoothing` cuts per edge) and the skin of the rig.
 */
function prepareGeometry(mesh, smoothing) {
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0);
  // The file interleaves position, normal and uv in one array: read the positions out of it.
  const pos = geo.attributes.position, xyz = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { xyz[i * 3] = pos.getX(i); xyz[i * 3 + 1] = pos.getY(i); xyz[i * 3 + 2] = pos.getZ(i); }
  const { cloth, rigid, clothPart, rigidPart, helmet } = bodyTriangles(xyz, geo.index.array);
  // The cloth is curved first and clipped after, exactly at the cut: the chest stays whole up to the neck ring, with no
  // holes. Clipped first, the long triangles of the hard upper torso that reach into the helmet became slivers that the
  // curving bent each its own way, and they fanned out over the shoulders in dark streaks. One normal per position
  // shapes the patches, so the two sides of a seam (1 700 positions of the Z-2 have a different normal on each side)
  // build the same edge: no crack through which the dark lining shows.
  const cc = corners(geo, cloth);
  const curved = smoothing > 1 ? pnTessellate(cc.positions, cc.normals, cc.uvs, smoothing, weldNormals(cc.positions, cc.normals)) : cc;
  // the part of each triangle (torso, arm or body, for the skin) follows it into the level² it is cut into, and through the cut
  const per = smoothing > 1 ? smoothing * smoothing : 1;
  const soft = clipBelow({ ...curved, tags: Array.from({ length: clothPart.length * per }, (_, k) => clothPart[Math.floor(k / per)]) }, HELMET_CUT_Y);
  const r = clipBelow({ ...corners(geo, rigid), tags: rigidPart }, HELMET_CUT_Y);
  const parts = soft.tags.concat(r.tags);
  const join = (a, b) => { const out = new Float32Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(join(soft.positions, r.positions), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(join(soft.normals, r.normals), 3));
  if (soft.uvs && r.uvs) out.setAttribute('uv', new THREE.BufferAttribute(join(soft.uvs, r.uvs), 2));
  // Skin: two bones a vertex.
  const p = out.attributes.position, n = p.count, skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const w = rigWeights(p.getX(i), p.getY(i), p.getZ(i), parts[Math.floor(i / 3)]);
    skinIndex[i * 4] = w.index[0]; skinIndex[i * 4 + 1] = w.index[1];
    skinWeight[i * 4] = w.weight[0]; skinWeight[i * 4 + 1] = w.weight[1];
  }
  const hands = [0, 1].map(i => rigHand(i, p.array, skinIndex, skinWeight));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  out.translate(0, 0, -SUIT_EYE.z); // the eyes over the origin
  out.userData.hands = hands;
  // From outside (third person): the helmet and the top of the torso inside it, fixed to the torso.
  const outside = [corners(geo, helmet), clipAbove(curved, HELMET_CUT_Y), clipAbove(corners(geo, rigid), HELMET_CUT_Y)];
  const head = new THREE.BufferGeometry();
  const cat = key => { const arrays = outside.map(q => q[key]).filter(Boolean); const all = new Float32Array(arrays.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrays) { all.set(a, o); o += a.length; } return all; };
  head.setAttribute('position', new THREE.BufferAttribute(cat('positions'), 3));
  head.setAttribute('normal', new THREE.BufferAttribute(cat('normals'), 3));
  if (outside.every(q => q.uvs)) head.setAttribute('uv', new THREE.BufferAttribute(cat('uvs'), 2));
  const hn = head.attributes.position.count, hIndex = new Uint16Array(hn * 4), hWeight = new Float32Array(hn * 4);
  for (let i = 0; i < hn; i++) { hIndex[i * 4] = BONE.spine; hWeight[i * 4] = 1; }
  head.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(hIndex, 4));
  head.setAttribute('skinWeight', new THREE.Float32BufferAttribute(hWeight, 4));
  head.translate(0, 0, -SUIT_EYE.z);
  out.userData.head = head;
  return out;
}

// The hands (core/hand-rig.js): after the bones of core/suit-rig.js come, for each hand (left, then right), the hand
// itself at the wrist and two bones for each finger, from the thumb: at the knuckle and halfway to the tip.
const HAND_BONES = 11;
const handBone = i => BONES.length + i * HAND_BONES;
const fingerBones = i => [0, 1, 2, 3, 4].map(f => [handBone(i) + 1 + 2 * f, handBone(i) + 2 + 2 * f]);
/** Where the glove takes over from the forearm, past the wrist (m): the watch, before the wrist, stays on the forearm. */
const HAND_BLEND = 0.015;

/**
 * Finds the fingers of one glove (0 left, 1 right) on the final mesh and gives them their bones: the points past the
 * wrist go with the hand, and those of each finger with its two bones. Without five fingers the glove still goes with
 * the hand, stiff. Model metres, before the eyes are moved over the origin.
 * @returns {{fingers:{knuckle:number[], middle:number[], tip:number[], axis:number[]}[]|null, wrist:number[]}}
 */
function rigHand(i, positions, skinIndex, skinWeight) {
  const m = i === 0 ? 1 : -1, elbow = BONES[i === 0 ? BONE.elbowL : BONE.elbowR].at, wrist = [WRIST[0] * m, WRIST[1], WRIST[2]];
  const axis = toward(elbow, wrist), reach = Math.hypot(wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]);
  const past = p => (p[0] - elbow[0]) * axis[0] + (p[1] - elbow[1]) * axis[1] + (p[2] - elbow[2]) * axis[2] - reach;
  const g = weldGraph(positions, p => m * p[0] > 0.1 && p[1] > 0.9 && past(p) > 0);
  const seeds = [];
  g.points.forEach((p, k) => { if (past(p) < 0.006) seeds.push(k); });
  const found = seeds.length ? findFingers(g.points, g.neighbours, seeds) : null;
  const bones = { hand: handBone(i), fingers: fingerBones(i) };
  const elbowBone = i === 0 ? BONE.elbowL : BONE.elbowR;
  for (let c = 0; c < g.cornerPoint.length; c++) {
    const k = g.cornerPoint[c];
    if (k < 0) continue;
    const h = Math.min(1, past(g.points[k]) / HAND_BLEND);
    const w = found ? handWeights(found.finger[k], found.along[k], bones) : { index: [bones.hand, bones.hand], weight: [1, 0] };
    // near the wrist the palm blends from the forearm into the hand (there are no fingers there)
    const out = h < 1 && w.index[0] === bones.hand ? { index: [bones.hand, elbowBone], weight: [h, 1 - h] } : w;
    skinIndex[c * 4] = out.index[0]; skinIndex[c * 4 + 1] = out.index[1];
    skinWeight[c * 4] = out.weight[0]; skinWeight[c * 4 + 1] = out.weight[1];
  }
  if (!found) return { fingers: null, wrist };
  // Each finger bends towards the palm: the palm faces the thumb (it opposes the others), across the knuckles.
  const [thumb, index, , , little] = found.fingers;
  const across = toward(little.knuckle, index.knuckle), handDir = toward(wrist, found.fingers[2].knuckle);
  let palm = [across[1] * handDir[2] - across[2] * handDir[1], across[2] * handDir[0] - across[0] * handDir[2], across[0] * handDir[1] - across[1] * handDir[0]];
  const mid = found.fingers.slice(1).reduce((a, f) => a.map((v, c) => v + f.knuckle[c] / 4), [0, 0, 0]);
  if ((thumb.tip[0] - mid[0]) * palm[0] + (thumb.tip[1] - mid[1]) * palm[1] + (thumb.tip[2] - mid[2]) * palm[2] < 0) palm = palm.map(v => -v);
  const fingers = found.fingers.map(f => {
    const dir = toward(f.knuckle, f.tip);
    const a = [dir[1] * palm[2] - dir[2] * palm[1], dir[2] * palm[0] - dir[0] * palm[2], dir[0] * palm[1] - dir[1] * palm[0]];
    const l = Math.hypot(...a) || 1;
    return { knuckle: f.knuckle, middle: f.middle, tip: f.tip, axis: a.map(v => v / l) };
  });
  return { fingers, wrist };
}

/** The bones of core/suit-rig.js and of the hands, in the same place as the geometry (eyes over the origin). */
function makeSkeleton(hands) {
  const bones = BONES.map(b => { const bone = new THREE.Bone(); bone.name = b.name; return bone; });
  BONES.forEach((b, i) => {
    const parent = b.parent < 0 ? null : BONES[b.parent];
    if (parent) bones[i].position.set(b.at[0] - parent.at[0], b.at[1] - parent.at[1], b.at[2] - parent.at[2]);
    else bones[i].position.set(b.at[0], b.at[1], b.at[2] - SUIT_EYE.z);
    if (parent) bones[b.parent].add(bones[i]);
  });
  const child = (parent, at, from, name) => { const b = new THREE.Bone(); b.name = name; b.position.set(at[0] - from[0], at[1] - from[1], at[2] - from[2]); parent.add(b); return b; };
  hands.forEach((hand, i) => {
    const elbowAt = BONES[i === 0 ? BONE.elbowL : BONE.elbowR].at;
    const h = child(bones[i === 0 ? BONE.elbowL : BONE.elbowR], hand.wrist, elbowAt, 'hand' + i);
    bones.push(h);
    for (let f = 0; f < 5; f++) {
      const fg = hand.fingers?.[f], knuckle = fg?.knuckle ?? hand.wrist, middle = fg?.middle ?? hand.wrist;
      const first = child(h, knuckle, hand.wrist, 'finger' + i + f + 'a'), second = child(first, middle, knuckle, 'finger' + i + f + 'b');
      bones.push(first, second);
    }
  });
  return bones;
}

/**
 * @param {{maxTexture?:number, smoothing?:number, onReady?:()=>void}} opts maxTexture: side of the textures (phones: 1024);
 *   smoothing: cuts per edge of the PN triangles of the cloth (1: as modelled; 3: nine triangles each);
 *   onReady: the model has arrived (the scene renders on demand)
 */
export function makeSuitBody({ maxTexture = 4096, smoothing = 3, onReady = () => {} } = {}) {
  const root = new THREE.Group(); // in km, at the feet under the eyes, turned to where you look
  const body = new THREE.Group(); // in metres of the model, scaled so its eyes meet the camera
  body.scale.setScalar(EYE_HEIGHT_KM / SUIT_EYE.y);
  root.add(body);
  root.visible = false;
  let bones = null, loading = null, handAxes = null, fingerTips = null, headMesh = null, thirdPerson = false;
  // The skeleton the camera moves, drawn over the suit (points and lines, from the shoulders out to the fingertips).
  const skeleton = new THREE.Group();
  skeleton.visible = false;
  body.add(skeleton);
  const arms = createArmMotion();
  const watch = makeWatch(); // mounted on the forearm bone when the model arrives (fitWatch)
  watch.group.visible = false; // until the model (and its wrist) is there
  let raise = 0; // 0: arm down, 1: watch at the eyes

  function load() {
    loading ??= new GLTFLoader().loadAsync(MODEL_URL).then(gltf => {
      let source = null;
      gltf.scene.traverse(o => { if (o.isMesh && !source) source = o; });
      const geo = prepareGeometry(source, smoothing);
      const material = source.material;
      // The "normal" texture of the file is really a height map (grey, the weave of the cloth and its seams): it becomes
      // a true normal map (prepareTextures). Only the outer faces: from the eyes, the inside of the suit is your own body.
      material.normalMap = prepareTextures(material, maxTexture);
      material.normalScale.set(1, 1); // the file says 0
      material.bumpMap = null;
      material.side = THREE.FrontSide;
      material.roughness = 0.92; material.metalness = 0;
      material.needsUpdate = true;
      const mesh = new THREE.SkinnedMesh(geo, material);
      bones = makeSkeleton(geo.userData.hands);
      handAxes = geo.userData.hands.map(h => h.fingers?.map(f => new THREE.Vector3(...f.axis)) ?? null);
      fingerTips = geo.userData.hands.map(h => h.fingers?.map(f => new THREE.Vector3(f.tip[0] - f.middle[0], f.tip[1] - f.middle[1], f.tip[2] - f.middle[2])) ?? null);
      mesh.add(bones[0]);
      mesh.updateMatrixWorld(true); // the inverse bind matrices come from where the bones are now
      mesh.bind(new THREE.Skeleton(bones));
      // Drawn by the view-model camera of scene.js (layer 1), after the world: its own field of view, never cut by the
      // ground. It casts no shadow: the shadow map is drawn only when the Sun moves.
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.layers.set(VIEW_MODEL_LAYER);
      mesh.frustumCulled = false; // the bones move it; its box would not
      body.add(mesh);
      // The inside of the suit, drawn dark: its back faces, with the same skin and bones. Wherever you look into it (the
      // neck ring, the ring that held the helmet), you see your own body in its shadow, never through the suit.
      const lining = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x050506, side: THREE.BackSide }));
      lining.bind(mesh.skeleton, mesh.bindMatrix);
      lining.frustumCulled = false;
      lining.layers.set(VIEW_MODEL_LAYER);
      body.add(lining);
      // And you, filling it: looking down through the neck ring you see your own body in shadow, not the empty legs.
      const you = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), lining.material);
      you.material = new THREE.MeshBasicMaterial({ color: 0x050506 });
      you.scale.set(...INNER_BODY.radii);
      you.layers.set(VIEW_MODEL_LAYER);
      // on the spine, so it bends with the torso
      const spine = BONES[BONE.spine].at;
      you.position.set(INNER_BODY.centre[0] - spine[0], INNER_BODY.centre[1] - spine[1], INNER_BODY.centre[2] - spine[2]);
      bones[BONE.spine].add(you);
      // From outside: the helmet and the top of the torso, on the same bones (seen only in third person).
      headMesh = new THREE.SkinnedMesh(geo.userData.head, material);
      headMesh.bind(mesh.skeleton, mesh.bindMatrix);
      headMesh.frustumCulled = false;
      headMesh.layers.set(VIEW_MODEL_LAYER);
      headMesh.visible = thirdPerson;
      body.add(headMesh);
      buildSkeletonView();
      fitWatch(geo);
      watch.group.visible = true;
      mountFlag();
      onReady();
    }).catch(err => { console.error('No se ha podido cargar el traje', err); });
    return loading;
  }

  // The left arm up to read the watch: the wrist goes in front of the eyes, a little to the left and below, following where
  // the head looks (within the neck of the suit), and the elbow out and down, as you raise your arm to look at a watch.
  // Two-bone IK in the frame of the spine (core/arm-ik.js), blended with the relaxed arm by `t`.
  const qRelax = new THREE.Quaternion(), qIK = new THREE.Quaternion(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const at = name => BONES[BONE[name]].at;
  const local = (p, frame) => ({ x: p[0] - frame[0], y: p[1] - frame[1], z: p[2] - frame[2] });
  // Turns one arm (0 left, 1 right) so the elbow and the wrist point at these points (spine frame, model metres), blended
  // with the pose it has by `t`. The bones keep their length: only the directions count.
  const restDir = [0, 1].map(i => {
    const m = i === 0 ? 1 : -1, spine = at('spine');
    const S = local(at(i === 0 ? 'shoulderL' : 'shoulderR'), spine), E0 = local(at(i === 0 ? 'elbowL' : 'elbowR'), spine);
    const W0 = local([WRIST[0] * m, WRIST[1], WRIST[2]], spine);
    const upper = new THREE.Vector3(E0.x - S.x, E0.y - S.y, E0.z - S.z), fore = new THREE.Vector3(W0.x - E0.x, W0.y - E0.y, W0.z - E0.z);
    return { S, l1: upper.length(), l2: fore.length(), upper: upper.normalize(), fore: fore.normalize() };
  });
  // As a hinge (core/arm-ik.js hingePose): the upper arm turns to its direction and to the plane of the elbow, and the
  // elbow bends only in that plane, so the forearm never twists over the upper arm. The plane of each arm is kept from one
  // frame to the next for when the arm is straight.
  const planes = [null, null], mFrom = new THREE.Matrix4(), mTo = new THREE.Matrix4(), V = p => new THREE.Vector3(p.x, p.y, p.z);
  function aimArm(i, elbow, end, t) {
    const { S, upper, fore } = restDir[i];
    const shoulder = bones[i === 0 ? BONE.shoulderL : BONE.shoulderR], elbowBone = bones[i === 0 ? BONE.elbowL : BONE.elbowR];
    const u = v1.set(elbow.x - S.x, elbow.y - S.y, elbow.z - S.z).normalize(), f = v2.set(end.x - elbow.x, end.y - elbow.y, end.z - elbow.z).normalize();
    const h = hingePose(upper, fore, { x: u.x, y: u.y, z: u.z }, { x: f.x, y: f.y, z: f.z }, planes[i]);
    planes[i] = h.plane;
    mFrom.makeBasis(V(h.from[0]), V(h.from[1]), V(h.from[2])).transpose();
    mTo.makeBasis(V(h.to[0]), V(h.to[1]), V(h.to[2])).multiply(mFrom);
    qIK.setFromRotationMatrix(mTo);
    qRelax.copy(shoulder.quaternion);
    shoulder.quaternion.copy(qRelax.slerp(qIK, t));
    qIK.setFromAxisAngle(V(h.axis), h.bend);
    qRelax.copy(elbowBone.quaternion);
    elbowBone.quaternion.copy(qRelax.slerp(qIK, t));
  }

  function raiseLeftArm(t, headPitchDeg) {
    const spine = at('spine'), { S, l1, l2 } = restDir[0];
    const eye = local([0, SUIT_EYE.y, SUIT_EYE.z], spine);
    const pr = Math.max(-35, Math.min(15, headPitchDeg)) * Math.PI / 180;
    const fwd = { y: Math.sin(pr), z: Math.cos(pr) }, up = { y: Math.cos(pr), z: -Math.sin(pr) };
    const target = { x: eye.x + WATCH_VIEW.left, y: eye.y + fwd.y * WATCH_VIEW.ahead + up.y * WATCH_VIEW.up, z: eye.z + fwd.z * WATCH_VIEW.ahead + up.z * WATCH_VIEW.up };
    const pole = { x: S.x + 0.8, y: S.y + 0.05, z: S.z + 0.3 }; // elbow out and level: the forearm runs across the chest
    const { elbow, end } = twoBoneIK(S, target, l1, l2, pole);
    aimArm(0, elbow, end, t);
  }

  // Your arms in virtual reality (#396): each wrist goes to where the controller (or the tracked hand) holds it, with
  // two-bone IK from the shoulder, the elbow down, out and back as a hanging arm bends. The controller is held in the
  // palm, a few cm past the wrist: the target goes back that much towards the shoulder. Out of reach, the arm stretches
  // towards it (core/arm-ik.js).
  const GRIP_TO_WRIST_M = 0.06, reachAt = new THREE.Vector3();
  function reachArms(reach) {
    if (!bones) return;
    root.updateMatrixWorld(true);
    const spineBone = bones[BONE.spine];
    for (const [i, p] of [[0, reach.left], [1, reach.right]]) {
      if (!p) continue;
      const side = i === 0 ? 1 : -1, { S, l1, l2 } = restDir[i];
      const W = spineBone.worldToLocal(reachAt.set(p.x, p.y, p.z)); // model metres, in the frame of the spine
      const toS = new THREE.Vector3(S.x - W.x, S.y - W.y, S.z - W.z), d = toS.length();
      if (d > GRIP_TO_WRIST_M) W.addScaledVector(toS, GRIP_TO_WRIST_M / d);
      const pole = { x: S.x + side * 0.35, y: S.y - 0.6, z: S.z - 0.25 };
      const { elbow, end } = twoBoneIK(S, { x: W.x, y: W.y, z: W.z }, l1, l2, pole);
      aimArm(i, clearOfTorso(elbow), end, 1);
    }
  }

  // Your own arms, followed by the camera (core/body-track.js): their directions in the frame of your torso, which is the
  // frame of the suit's spine. The suit's arms keep their own lengths, and never go into the chest (clearOfTorso).
  function followArms(tracked) {
    for (const [i, arm] of [[0, tracked.left], [1, tracked.right]]) {
      if (!arm || !(arm.weight > 0)) continue;
      const { S, l1, l2 } = restDir[i];
      const elbow = clearOfTorso({ x: S.x + arm.upper.x * l1, y: S.y + arm.upper.y * l1, z: S.z + arm.upper.z * l1 });
      const end = clearOfTorso({ x: elbow.x + arm.fore.x * l2, y: elbow.y + arm.fore.y * l2, z: elbow.z + arm.fore.z * l2 });
      aimArm(i, elbow, end, arm.weight);
    }
  }

  // Your fingers, followed by the camera (core/hand-track.js): how much each joint bends, from the rest of the glove
  // (almost straight in the Z-2). Without the camera, the gloves keep the slight bend of a pressurised glove at rest.
  function bendFingers(hands) {
    if (!handAxes) return;
    for (const [i, hand] of [[0, hands?.left], [1, hands?.right]]) {
      const axes = handAxes[i];
      if (!axes) continue;
      const w = hand?.weight ?? 0;
      fingerBones(i).forEach(([a, b], f) => {
        const [c1, c2] = hand?.curl?.[f] ?? [0, 0];
        const bend = j => GLOVE_REST_BEND * (1 - w) + Math.min(FINGER_MAX_BEND, Math.max(-0.15, j - GLOVE_STRAIGHT)) * w;
        bones[a].quaternion.setFromAxisAngle(axes[f], bend(c1));
        bones[b].quaternion.setFromAxisAngle(axes[f], bend(c2));
      });
    }
  }

  // The points and lines of the skeleton: the two shoulders joined, then each arm, its hand and its fingers.
  let skeletonLines = null, skeletonPoints = null, skeletonLinks = [];
  const tipOwner = [];
  function buildSkeletonView() {
    const links = [[BONE.shoulderL, BONE.shoulderR], [BONE.shoulderL, BONE.elbowL], [BONE.shoulderR, BONE.elbowR]];
    for (const i of [0, 1]) {
      const hand = handBone(i);
      links.push([i === 0 ? BONE.elbowL : BONE.elbowR, hand]);
      fingerBones(i).forEach(([a, b], fi) => { links.push([hand, a], [a, b], [b, -1 - tipOwner.length]); tipOwner.push({ bone: b, side: i, finger: fi }); });
    }
    skeletonLinks = links;
    const lineGeo = new THREE.BufferGeometry(), pointGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(links.length * 6), 3));
    pointGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(links.length * 6), 3));
    const over = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false };
    skeletonLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xf3a83a, opacity: 0.9, ...over }));
    skeletonPoints = new THREE.Points(pointGeo, new THREE.PointsMaterial({ color: 0xffd08a, size: 6, sizeAttenuation: false, ...over }));
    for (const o of [skeletonLines, skeletonPoints]) { o.layers.set(VIEW_MODEL_LAYER); o.frustumCulled = false; o.renderOrder = 10; skeleton.add(o); }
  }
  const sv = new THREE.Vector3();
  function updateSkeletonView() {
    if (!skeleton.visible || !skeletonLines) return;
    root.updateMatrixWorld(true);
    const at = k => {
      if (k >= 0) return body.worldToLocal(bones[k].getWorldPosition(sv)).clone();
      const t = tipOwner[-1 - k], tip = fingerTips?.[t.side]?.[t.finger];
      return tip ? body.worldToLocal(bones[t.bone].localToWorld(sv.copy(tip))).clone() : body.worldToLocal(bones[t.bone].getWorldPosition(sv)).clone();
    };
    const lp = skeletonLines.geometry.attributes.position, pp = skeletonPoints.geometry.attributes.position;
    skeletonLinks.forEach(([a, b], n) => { const A = at(a), B = at(b); lp.setXYZ(n * 2, A.x, A.y, A.z); lp.setXYZ(n * 2 + 1, B.x, B.y, B.z); pp.setXYZ(n * 2, A.x, A.y, A.z); pp.setXYZ(n * 2 + 1, B.x, B.y, B.z); });
    lp.needsUpdate = true; pp.needsUpdate = true;
  }

  // Measures the left forearm of the final mesh round the strap and mounts the watch on the forearm bone.
  let fit = null;
  function fitWatch(geo) {
    const E0 = at('elbowL'), elbowIndex = BONE.elbowL;
    const axis = [WRIST[0] - E0[0], WRIST[1] - E0[1], WRIST[2] - E0[2]], length = Math.hypot(...axis);
    const tc = WATCH_AT * length;
    // The points of the left forearm, in the frame of its bone (model minus the elbow; the mesh is shifted by -SUIT_EYE.z).
    const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, pts = [];
    for (let i = 0; i < pos.count; i++) {
      if (si.getX(i) !== elbowIndex || sw.getX(i) < 0.999) continue;
      pts.push(pos.getX(i) - E0[0], pos.getY(i) - E0[1], pos.getZ(i) + SUIT_EYE.z - E0[2]);
    }
    const strapProfile = radialProfile(pts, [0, 0, 0], axis, tc - STRAP.width / 2 - 0.004, tc + STRAP.width / 2 + 0.004);
    const caseProfile = radialProfile(pts, [0, 0, 0], axis, tc - CASE.long / 2 - 0.004, tc + CASE.long / 2 + 0.004);
    const strap = new THREE.Mesh(strapGeometry(strapProfile, tc), new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.95, emissive: 0x08090a }));
    watch.strap = strap;
    watch.group.add(strap);
    bones[elbowIndex].add(watch.group);
    watch.group.traverse(o => { o.layers.set(VIEW_MODEL_LAYER); o.frustumCulled = false; });
    fit = { axis: new THREE.Vector3(...strapProfile.axis), u: new THREE.Vector3(...strapProfile.u), v: new THREE.Vector3(...strapProfile.v), tc, strapProfile, caseProfile };
  }

  // Every frame the case turns round the forearm to face the eyes (you twist the forearm to read it), and sits on the
  // highest point under it: the measured cloth or the strap, whichever is higher, plus a gap.
  const eyeLocal = new THREE.Vector3(), basis = new THREE.Matrix4(), n = new THREE.Vector3(), side = new THREE.Vector3();
  function placeWatch(eyeWorld) {
    if (!bones || !fit) return;
    root.updateMatrixWorld(true);
    const elbowBone = bones[BONE.elbowL];
    eyeLocal.copy(eyeWorld ?? new THREE.Vector3());
    elbowBone.worldToLocal(eyeLocal); // in the frame of the forearm bone, in model metres
    const d = eyeLocal.clone().addScaledVector(fit.axis, -fit.tc);
    const angle = Math.atan2(d.dot(fit.v), d.dot(fit.u));
    n.copy(fit.u).multiplyScalar(Math.cos(angle)).addScaledVector(fit.v, Math.sin(angle));
    const cloth = seatRadius(fit.caseProfile, angle, CASE.wide / 2);
    const strapTop = seatRadius(fit.strapProfile, angle, CASE.wide / 2) + STRAP.gap + STRAP.thick;
    const r = Math.max(cloth, strapTop) + SEAT_GAP + CASE.thick / 2;
    side.crossVectors(n, fit.axis).normalize();
    basis.makeBasis(fit.axis, side, n);
    watch.face.quaternion.setFromRotationMatrix(basis);
    watch.face.position.copy(fit.axis).multiplyScalar(fit.tc).addScaledVector(n, r);
  }

  // The flag on the right arm (E3.6): a child of the right forearm bone, held by the glove with its pole nearly upright and the
  // cloth out to the right; every frame it is turned against the bone so it keeps that pose whatever the arm does.
  let carried = null; // {mesh, scale}: scale is the mesh's scale in the world (km per unit of the mesh)
  const qBone = new THREE.Quaternion(), qWorld = new THREE.Quaternion(), qTilt = new THREE.Quaternion(), qSpin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const dirW = new THREE.Vector3(), fwdW = new THREE.Vector3(), upLocal = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function mountFlag() {
    if (!carried || !bones || carried.mesh.parent === bones[BONE.elbowR]) return;
    bones[BONE.elbowR].add(carried.mesh);
    carried.mesh.traverse(o => { o.layers.set(VIEW_MODEL_LAYER); o.frustumCulled = false; });
    placeFlag();
  }
  function placeFlag() {
    if (!carried || !bones || carried.mesh.parent !== bones[BONE.elbowR]) return;
    const mesh = carried.mesh, bone = bones[BONE.elbowR];
    root.updateMatrixWorld(true);
    bone.getWorldQuaternion(qBone);
    fwdW.set(0, 0, 1).applyQuaternion(root.quaternion);
    const lean = FLAG_LEAN_DEG * Math.PI / 180;
    dirW.copy(UP).multiplyScalar(Math.cos(lean)).addScaledVector(fwdW, Math.sin(lean));
    qTilt.setFromUnitVectors(UP, dirW);
    qWorld.copy(root.quaternion).multiply(qSpin).premultiply(qTilt); // the cloth runs out to the right of the suit
    mesh.quaternion.copy(qBone).invert().multiply(qWorld);
    mesh.scale.setScalar(carried.scale / body.scale.x);
    // the glove: past the wrist along the forearm, a little out to the right and the pole held a third of the way up
    const E0 = at('elbowR'), a = [-WRIST[0] - E0[0], WRIST[1] - E0[1], WRIST[2] - E0[2]], len = Math.hypot(...a), k = (len + GLOVE_PAST_WRIST_M) / len;
    upLocal.copy(dirW).applyQuaternion(qBone.clone().invert());
    const outLocal = v2.set(-1, 0, 0).applyQuaternion(root.quaternion).applyQuaternion(qBone.clone().invert());
    mesh.position.set(a[0] * k, a[1] * k, a[2] * k).addScaledVector(upLocal, -FLAG_GRIP_M).addScaledVector(outLocal, FLAG_OUT_M);
  }

  return {
    object: root,
    /** Starts the download (once): it is only needed on foot. */
    load,
    /**
     * Places the body under the eyes: feet on the ground, turned to `yaw` (an azimuth of the scene), with the gait.
     * @param {{x:number, z:number, ground:number, yaw:number, lift:number, phase:number, speed:number, air:number}} s
     */
    place({ x, z, ground, yaw, lift, phase, speed, air, bend = 0 }) {
      root.position.set(x, ground + lift, z);
      root.rotation.y = Math.PI - yaw * Math.PI / 180; // the model faces +z; azimuth 0° is -z
      if (!bones) return;
      const p = suitPose({ phase, speed, air });
      bones[BONE.hipL].rotation.x = -p.hip[0]; bones[BONE.kneeL].rotation.x = p.knee[0];
      bones[BONE.hipR].rotation.x = -p.hip[1]; bones[BONE.kneeR].rotation.x = p.knee[1];
      bones[BONE.spine].rotation.x = bend * Math.PI / 180; // bent forward at the waist to look down (core/foot-camera.js)
    },
    /**
     * Moves the arms one frame (core/arm-motion.js). The model stands with its arms already forward: this adds to that.
     * @returns {boolean} true while they still move (the scene redraws)
     */
    animate(dt, s) {
      const a = arms.update(dt, s);
      // Raising the arm to read the watch: about a third of a second each way, eased; at once with reduced motion.
      const goal = s.watchUp ? 1 : 0, before = raise;
      raise = s.reducedMotion ? goal : goal > raise ? Math.min(goal, raise + dt / WATCH_RAISE_S) : Math.max(goal, raise - dt / WATCH_RAISE_S);
      if (!bones) return false;
      for (const [i, side] of [[0, 1], [1, -1]]) {
        const shoulder = bones[i === 0 ? BONE.shoulderL : BONE.shoulderR], elbow = bones[i === 0 ? BONE.elbowL : BONE.elbowR];
        // forward is −x; outwards is +z on the left, −z on the right; on top of the relaxed posture
        shoulder.rotation.set(-(ARM_REST.pitch + a.pitch[i]), 0, side * (ARM_REST.roll + a.roll[i]));
        elbow.rotation.x = -(ARM_REST.flex + a.flex[i]); // bending raises the glove
      }
      // Followed by the camera, your arms take over from the animation; the watch, raised, from your left arm.
      if (s.tracked) followArms(s.tracked);
      // In virtual reality the controllers (or your tracked hands) put the wrists where yours are (#396).
      if (s.reach) reachArms(s.reach);
      bendFingers(s.hands);
      const t = raise * raise * (3 - 2 * raise);
      if (t > 0 && s.raiseArm !== false) raiseLeftArm(t, s.headPitch ?? 0);
      placeWatch(s.eye);
      placeFlag();
      updateSkeletonView();
      return a.moving || raise !== before;
    },
    /**
     * Carries `mesh` (the flag, built in km) on the right arm, `on`, or lets it go: then the caller puts it back in the scene.
     * `scale`: the world scale it has when it is held.
     */
    carryFlag(mesh, on, scale) {
      if (on) { carried = { mesh, scale }; mountFlag(); return; }
      if (carried) { carried.mesh.removeFromParent(); carried.mesh.traverse(o => { o.layers.set(0); o.frustumCulled = true; }); }
      carried = null;
    },
    /** Seen from outside (third person): with its helmet and the top of its torso. */
    setThirdPerson(on) { thirdPerson = on; if (headMesh) headMesh.visible = on; },
    /** The skeleton the camera moves, drawn over the suit. */
    showSkeleton(on) { skeleton.visible = on; updateSkeletonView(); },
    /** The screen of the watch: draw on `canvas`, then call `changed()`. */
    watchFace: { canvas: watch.canvas, changed: () => { watch.texture.needsUpdate = true; } },
    /** 0 with the arm down, 1 with the watch at the eyes. */
    get watchRaise() { return raise; },
    resetArms: () => arms.reset(),
    /** The height of your eyes (km): the suit is scaled so its eyes meet them (virtual reality: your real height, #396). */
    setEyeHeight(km) { body.scale.setScalar(km / SUIT_EYE.y); },
    /**
     * In virtual reality three.js draws layer 1 for the left eye only and layer 2 for the right: the body goes to layer 0
     * there, and scene.js shows it in its own pass by visibility instead of by layers (#396).
     */
    setXRLayers(on) { root.traverse(o => o.layers.set(on ? 0 : VIEW_MODEL_LAYER)); },
  };
}
