// Rig of your own suit on foot (E3, #181): NASA's Z-2 model (viewpoint/assets/suit-z2.glb) has no skeleton, so its
// vertices are given to a few bones here, by where they are. Pure: no three.js.
// Model space, in metres, after the node's rotation: y up, feet at y ≈ 0, facing +z, so its left is +x.
//
// Where things are in the Z-2 (measured from the model, pipeline/suit.mjs): the helmet goes from 1.56 m to 1.93 m, the
// legs part below 0.70 m, the arms hang out of the hard upper torso at |x| ≈ 0.3 and come forward, with the gloves in front
// of the belly (z up to 0.63 m at 1.0–1.3 m).

/**
 * The eyes inside the helmet, where the camera goes: about 18 cm over the neck ring and a little forward of its centre,
 * as the head of a person sits in the bubble. The model is scaled so that they meet the camera at 1.7 m.
 */
export const SUIT_EYE = { y: 1.78, z: 0.08 };
/**
 * Above this the helmet is cut away: the camera is inside it. Every triangle that crosses it is clipped exactly at this
 * height (clipBelow), so the chest stays whole up to the neck ring. Through the openings left (the neck, the ring that
 * held the helmet) you see the inside of the suit, drawn dark: your own body in its shadow (suit-body.js).
 */
export const HELMET_CUT_Y = 1.6;
/**
 * Your own body inside the suit, from the waist to just under the neck ring: an ellipsoid (centre and semi-axes, model
 * metres) inside the hard upper torso, never out of it (measured: the torso is ±0.37 m wide and from −0.22 to 0.26 m deep
 * at the chest). Drawn dark, so looking straight down through the neck ring you see yourself in the shadow of the suit,
 * not the empty legs of the suit.
 */
export const INNER_BODY = { centre: [0, 1.24, 0.01], radii: [0.21, 0.35, 0.13] };

/**
 * The scye bearing, where the upper arm leaves the hard upper torso: the centre of the ring the two pieces share (measured
 * on the Z-2, left side; the right one is its mirror) and the axis of the upper arm out of it, towards the elbow.
 */
export const ARM_RING = { centre: [0.296, 1.406, 0.179], axis: [0.06, -0.6, 0.8] };
/** Along that axis, how far the cloth of the upper arm stretches between the ring (on the torso) and the arm. */
export const ARM_RING_BLEND = 0.06;

/** Bones: index, parent and pivot (model metres). */
export const BONES = [
  { name: 'root', parent: -1, at: [0, 0.95, 0] },
  { name: 'hipL', parent: 0, at: [0.13, 0.9, 0.02] },
  { name: 'kneeL', parent: 1, at: [0.17, 0.48, 0.03] },
  { name: 'hipR', parent: 0, at: [-0.13, 0.9, 0.02] },
  { name: 'kneeR', parent: 3, at: [-0.17, 0.48, 0.03] },
  // The waist: the upper body bends forward round it to look down past what the neck allows (core/foot-camera.js,
  // WAIST_BELOW_EYES_KM: 0.72 m under the eyes and 0.08 m behind them, in the model's 0.955 scale).
  { name: 'spine', parent: 0, at: [0, 1.026, 0] },
  // Arms (measured): the upper arm turns in the scye bearing, the ring where it leaves the torso (ARM_RING), and comes
  // forward to the elbow, where the forearm piece overlaps it (0.30, 1.28, 0.33); the glove is at (0.28, 1.08, 0.60).
  // Turning round the centre of the ring, the arm stays in it, as in a bearing; round a point 13 cm behind it, as before,
  // the arm slid out of the cuff of the torso and left a hole.
  { name: 'shoulderL', parent: 5, at: ARM_RING.centre },
  { name: 'shoulderR', parent: 5, at: [-ARM_RING.centre[0], ARM_RING.centre[1], ARM_RING.centre[2]] },
  { name: 'elbowL', parent: 6, at: [0.3, 1.28, 0.33] },
  { name: 'elbowR', parent: 7, at: [-0.3, 1.28, 0.33] },
];
export const BONE = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

// Distance (m) out of the scye bearing along the upper arm: 0 on the ring, negative inside the torso.
const ARM_AXIS = (() => { const [x, y, z] = ARM_RING.axis, l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; })();
function alongArm(x, y, z) {
  const side = x >= 0 ? 1 : -1, c = ARM_RING.centre;
  return (side * x - c[0]) * ARM_AXIS[0] + (y - c[1]) * ARM_AXIS[1] + (z - c[2]) * ARM_AXIS[2];
}

// 0 at a, 1 at b (either way round), smooth in between.
function smooth(a, b, v) {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The two bones that move a vertex and how much: {index:[i, j], weight:[w, 1 − w]}.
 * Legs blend from the root into the hip around the crotch and from the hip into the knee around the knee. The upper body
 * goes with the spine, blended from the root over the waist. Arms blend from the spine into the shoulder where they leave
 * the torso, and from the shoulder into the elbow where the forearm begins: forearm and glove go with the elbow.
 *
 * With `part` (bodyTriangles): the shell of the torso and the hard parts on it ('torso') go wholly with the spine, as the
 * fibreglass of a real hard upper torso: blended with the shoulders it bent like cloth, tore the flag on the shoulder and
 * folded the shells over each other. The arm then turns at its bearing, and what stretches is its own cloth ('arm'): the
 * upper arm blends from the spine at the ring where it leaves the torso (ARM_RING) into the shoulder a few cm along it.
 * The rest of the body ('body': the legs and the waist) goes by zones, but never with the arms.
 * @param {'torso'|'arm'|'body'} [part]
 */
export function rigWeights(x, y, z, part) {
  if (part === 'torso') {
    const s = smooth(0.98, 1.1, y);
    return s >= 1 ? { index: [BONE.spine, BONE.spine], weight: [1, 0] } : { index: [BONE.spine, BONE.root], weight: [s, 1 - s] };
  }
  const left = x >= 0;
  if (y < 0.98) {
    const hip = left ? BONE.hipL : BONE.hipR, knee = left ? BONE.kneeL : BONE.kneeR;
    const k = smooth(0.56, 0.42, y);
    if (k > 0) return { index: [knee, hip], weight: [k, 1 - k] };
    const h = smooth(0.98, 0.84, y);
    return { index: [hip, BONE.root], weight: [h, 1 - h] };
  }
  if (y < HELMET_CUT_Y && Math.abs(x) > 0.12 && part !== 'body') {
    const shoulder = left ? BONE.shoulderL : BONE.shoulderR, elbow = left ? BONE.elbowL : BONE.elbowR;
    // Forearm and glove: in front of the elbow.
    const e = y < 1.36 ? smooth(0.29, 0.36, z) : 0;
    if (e > 0) return { index: [elbow, shoulder], weight: [e, 1 - e] };
    // Upper arm: out to the side of the torso, or coming forward from the shoulder.
    const a = part === 'arm' ? smooth(0, ARM_RING_BLEND, alongArm(x, y, z))
      : y > 1.12 ? Math.max(smooth(0.26, 0.33, Math.abs(x)), Math.abs(x) > 0.2 ? smooth(0.06, 0.14, z) : 0) : 0;
    if (a > 0) return { index: [shoulder, BONE.spine], weight: [a, 1 - a] };
  }
  const s = smooth(0.98, 1.1, y);
  return s >= 1 ? { index: [BONE.spine, BONE.spine], weight: [1, 0] } : { index: [BONE.spine, BONE.root], weight: [s, 1 - s] };
}

/** A piece of the model is part of the helmet if it lies wholly around the head: from the neck ring up. */
const HELMET_PIECE_MIN_Y = 1.55;
const HELMET_PIECE_TOP_Y = 1.65;

/** Pieces with fewer triangles than this are hard parts (the controls of the chest, buckles): they are not smoothed. */
export const CLOTH_MIN_TRIANGLES = 500;
/** A piece across the body that starts above this is part of the upper body (the waist below it bends with the hips). */
const TORSO_MIN_Y = 0.95;

/**
 * The triangles to draw, the model without the helmet, split in cloth and hard parts. The Z-2 is made of separate pieces
 * (43): the pieces of the helmet (dome, visor, lights, guards) go whole. A piece that reaches up from the body into the
 * helmet (the hard upper torso goes up to 1.88 m) is kept here and clipped at the cut afterwards (clipBelow). Big pieces
 * are the cloth of the suit (arms, legs, torso, boots), curved when loaded; the small ones are the hard parts (the
 * controls of the chest), kept square.
 * @param {ArrayLike<number>} positions x, y, z per vertex (model metres, y up)
 * @param {ArrayLike<number>} index three vertex indices per triangle
 * @returns {{cloth:number[], rigid:number[], clothPiece:number[], rigidPiece:number[], clothPart:string[], rigidPart:string[]}}
 *   index lists, and the piece of each of their triangles and its part for rigWeights ('torso', 'arm' or 'body'); helmet:
 *   the triangles of the pieces of the helmet (only seen from outside, in third person)
 */
export function bodyTriangles(positions, index) {
  const n = positions.length / 3;
  // Vertices split along texture seams share a position: weld them, so a piece is one piece.
  const at = new Map(), weld = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(positions[i * 3] * 1e4)},${Math.round(positions[i * 3 + 1] * 1e4)},${Math.round(positions[i * 3 + 2] * 1e4)}`;
    if (!at.has(key)) at.set(key, i);
    weld[i] = at.get(key);
  }
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < index.length; t += 3) {
    const a = find(weld[index[t]]);
    for (const k of [1, 2]) { const b = find(weld[index[t + k]]); if (a !== b) parent[b] = a; }
  }
  const lo = new Map(), hi = new Map(), size = new Map();
  for (let i = 0; i < n; i++) {
    const c = find(weld[i]), y = positions[i * 3 + 1];
    lo.set(c, Math.min(lo.get(c) ?? Infinity, y)); hi.set(c, Math.max(hi.get(c) ?? -Infinity, y));
  }
  for (let t = 0; t < index.length; t += 3) { const c = find(weld[index[t]]); size.set(c, (size.get(c) ?? 0) + 1); }
  // Across: a piece that reaches over both sides of the body's middle (the shell of the torso, the backpack, the waist).
  const xlo = new Map(), xhi = new Map();
  for (let i = 0; i < n; i++) {
    const c = find(weld[i]), x = positions[i * 3];
    xlo.set(c, Math.min(xlo.get(c) ?? Infinity, x)); xhi.set(c, Math.max(xhi.get(c) ?? -Infinity, x));
  }
  const cloth = [], rigid = [], clothPiece = [], rigidPiece = [], clothPart = [], rigidPart = [], helmet = [];
  for (let t = 0; t < index.length; t += 3) {
    const c = find(weld[index[t]]);
    if (lo.get(c) >= HELMET_PIECE_MIN_Y && hi.get(c) > HELMET_PIECE_TOP_Y) { helmet.push(index[t], index[t + 1], index[t + 2]); continue; } // a piece of the helmet
    const isCloth = size.get(c) >= CLOTH_MIN_TRIANGLES;
    // The torso: the hard parts (all of them are on the chest and the shoulders) and the pieces across the upper body.
    // An arm: a piece to one side of the body, above the waist. The rest (the legs, the waist) goes by zones, never with
    // the shoulders: the waist reaches up under the torso at its sides, and with the arms raised it followed them.
    const upper = lo.get(c) > TORSO_MIN_Y, across = xlo.get(c) < -0.1 && xhi.get(c) > 0.1;
    const part = !isCloth || (upper && across) ? 'torso' : upper && (xlo.get(c) > 0.1 || xhi.get(c) < -0.1) ? 'arm' : 'body';
    (isCloth ? cloth : rigid).push(index[t], index[t + 1], index[t + 2]);
    (isCloth ? clothPiece : rigidPiece).push(c);
    (isCloth ? clothPart : rigidPart).push(part);
  }
  return { cloth, rigid, clothPiece, rigidPiece, clothPart, rigidPart, helmet };
}

/**
 * Clips triangles at the height `cutY`, keeping what is below: a triangle wholly below stays, one wholly above goes, and
 * one that crosses the cut is cut along it (one or two triangles, with the normals and uvs interpolated and the winding
 * kept). So the torso stays whole up to the neck ring, with no holes and no slivers.
 * @param {{positions:Float32Array, normals:Float32Array, uvs:Float32Array|null, tags?:any[]|null}} corners three corners per
 *   triangle; `tags` (optional), one per triangle, come along with the pieces they are cut into
 * @param {number} cutY
 * @returns {{positions:Float32Array, normals:Float32Array, uvs:Float32Array|null}}
 */
export function clipBelow({ positions, normals, uvs, tags = null }, cutY) {
  const P = [], N = [], U = uvs ? [] : null, T = tags ? [] : null;
  const corner = (t, k) => ({
    p: [positions[t * 9 + k * 3], positions[t * 9 + k * 3 + 1], positions[t * 9 + k * 3 + 2]],
    n: [normals[t * 9 + k * 3], normals[t * 9 + k * 3 + 1], normals[t * 9 + k * 3 + 2]],
    u: uvs ? [uvs[t * 6 + k * 2], uvs[t * 6 + k * 2 + 1]] : null,
  });
  const mix = (a, b) => {
    const f = (cutY - a.p[1]) / (b.p[1] - a.p[1]);
    const lerp = (x, y) => x.map((v, i) => v + (y[i] - v) * f);
    const n = lerp(a.n, b.n), len = Math.hypot(...n) || 1;
    const p = lerp(a.p, b.p); p[1] = cutY;
    return { p, n: n.map(v => v / len), u: a.u && lerp(a.u, b.u) };
  };
  const emit = (...cs) => { for (const c of cs) { P.push(...c.p); N.push(...c.n); if (U) U.push(...c.u); } };
  for (let t = 0; t < positions.length / 9; t++) {
    const c = [corner(t, 0), corner(t, 1), corner(t, 2)];
    const below = c.map(x => x.p[1] <= cutY), count = below.filter(Boolean).length;
    if (count === 3) { emit(...c); if (T) T.push(tags[t]); continue; }
    if (count === 0) continue;
    // Turn the corners round (keeping their order, so the winding) until the odd one out is first.
    const odd = count === 1; // the odd one is below when only one is
    let k = 0;
    while (below[k] !== odd) k++;
    const [a, b, d] = [c[k], c[(k + 1) % 3], c[(k + 2) % 3]];
    if (count === 1) { emit(a, mix(a, b), mix(a, d)); if (T) T.push(tags[t]); } // a below, b and d above
    else { const ba = mix(b, a), da = mix(d, a); emit(b, d, da); emit(b, da, ba); if (T) T.push(tags[t], tags[t]); } // a above, b and d below
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), uvs: U && new Float32Array(U), tags: T };
}

/**
 * What clipBelow leaves out: the triangles above the cut, cut exactly on it (the top of the torso inside the helmet, seen
 * only from outside). It is clipBelow on the mirror image, mirrored back, so the winding is kept.
 */
export function clipAbove({ positions, normals, uvs }, cutY) {
  const flip = (a, k) => { const out = Float32Array.from(a); for (let i = 1; i < out.length; i += 3) out[i] = k(out[i]); return out; };
  const below = clipBelow({ positions: flip(positions, y => 2 * cutY - y), normals: flip(normals, y => -y), uvs }, cutY);
  return { positions: flip(below.positions, y => 2 * cutY - y), normals: flip(below.normals, y => -y), uvs: below.uvs };
}
