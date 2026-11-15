// What your own suit looks like up close (E3, #181): its textures, its seams, its rig per piece and its light.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pieceMask, heightToNormal, dilate, darkParts, BACKGROUND_MIN } from '../src/core/suit-maps.js';
import { pnTessellate, weldNormals } from '../src/core/pn-triangles.js';
import { rigWeights, bodyTriangles, clipBelow, BONE, ARM_RING } from '../src/core/suit-rig.js';
import { sunFraction, horizonElevation } from '../src/core/sunlit.js';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);

/** A w × h grey image: `at(x, y)` gives the grey of each pixel. */
function grey(w, h, at) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, v = at(x, y); out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255; }
  return out;
}

test('suit maps: the edge of a piece and of its black parts reads flat, the relief inside it does not', () => {
  // a piece (grey 128) with a black part on its right half, over the white background of the atlas, and a gentle ramp
  const w = 40, h = 20;
  const img = grey(w, h, (x, y) => (y < 2 || y > 17 ? 255 : x >= 20 ? 0 : 100 + x));
  const n = heightToNormal(img, w, h, 2);
  const nx = (x, y) => n[(y * w + x) * 4];
  assert.equal(nx(19, 10), nx(10, 10), 'at the step into the black part the slope is the one of the cloth, not a cliff');
  assert.equal(nx(25, 10), 128, 'inside the black part: flat');
  assert.ok(nx(10, 10) < 128, 'the ramp of the cloth tilts the normal');
  assert.equal(n[(0 * w + 5) * 4 + 2], 255, 'background: flat');
  assert.equal(pieceMask(img)[0], 0); assert.equal(pieceMask(img)[10 * w + 5], 1);
  assert.ok(BACKGROUND_MIN <= 255);
});

test('suit maps: the colour grows over the background, so filtering never mixes white into a piece', () => {
  const w = 30, h = 10;
  const img = grey(w, h, x => (x < 10 ? 60 : 255));
  const mask = pieceMask(img);
  dilate(img, w, h, mask, 4);
  for (let x = 10; x < 14; x++) assert.equal(img[(5 * w + x) * 4], 60, `pixel ${x} took the colour of the piece`);
  assert.equal(img[(5 * w + 20) * 4], 255, 'further away the background stays');
});

test('suit maps: a bearing is a dark piece; a stain as dark on the cloth is not', () => {
  // two pieces apart: a dark neutral one (a bearing) and a light one with a stain darker than the bearing
  const w = 30, h = 10, img = new Uint8ClampedArray(w * h * 4), height = grey(w, h, x => (x === 14 || x === 15 ? 255 : 128));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, c = x < 14 ? [26, 26, 26] : x === 22 ? [12, 8, 4] : [220, 215, 205];
    img.set([...c, 255], o);
  }
  const dark = darkParts(img, w, h, pieceMask(height));
  assert.equal(dark[5 * w + 3], 1, 'the bearing');
  assert.equal(dark[5 * w + 22], 0, 'the stain lies on cloth');
  assert.equal(dark[5 * w + 14], 0, 'the background');
});

test('PN triangles: two sides of a seam with different normals meet with welded normals, and open a crack without', () => {
  // two triangles sharing the edge (0,0,0)-(1,0,0), split along it: at (0,0,0) each side has its own normal
  const P = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0, 1, 0, 0, 0, 0, 0, 0.5, -1, 0]);
  const unit = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  const up = [0, 0, 1], left = unit(0.3, 0, 1), right = unit(-0.1, 0, 1);
  const N = new Float32Array([...left, ...up, ...up, ...up, ...right, ...up]);
  const edgeMid = out => {
    // the vertex in the middle of the shared edge, from each triangle (level 2: u = v = 0.5 on that edge)
    const pts = [];
    for (let i = 0; i < out.positions.length; i += 3) if (out.positions[i] > 0.2 && out.positions[i] < 0.8 && Math.abs(out.positions[i + 1]) < 1e-6) pts.push([...out.positions.slice(i, i + 3)]);
    return pts;
  };
  const open = edgeMid(pnTessellate(P, N, null, 2));
  const gap = Math.max(...open.map(p => p[2])) - Math.min(...open.map(p => p[2]));
  assert.ok(gap > 1e-3, `without welding the two sides part (${gap})`);
  const shut = edgeMid(pnTessellate(P, N, null, 2, weldNormals(P, N)));
  for (const p of shut) for (const q of shut) close(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), 0, 1e-6);
});

test('suit rig: the hard torso goes wholly with the spine, and the upper arm turns in its bearing', () => {
  // a point of the torso shell over the shoulder would blend into the shoulder by zone; as torso it does not
  assert.notEqual(rigWeights(0.33, 1.42, 0.05).index[0], BONE.spine);
  assert.deepEqual(rigWeights(0.33, 1.42, 0.05, 'torso'), { index: [BONE.spine, BONE.spine], weight: [1, 0] });
  // on the ring the arm stays on the torso; a few cm out of it, it is the shoulder's
  const [cx, cy, cz] = ARM_RING.centre;
  const ring = rigWeights(cx, cy, cz, 'arm');
  assert.deepEqual(ring.index, [BONE.spine, BONE.spine]);
  const out = rigWeights(cx + 0.006, cy - 0.06, cz + 0.08, 'arm');
  assert.equal(out.index[0], BONE.shoulderL); assert.equal(out.weight[0], 1);
  // mirrored on the right
  assert.equal(rigWeights(-(cx + 0.006), cy - 0.06, cz + 0.08, 'arm').index[0], BONE.shoulderR);
});

test('suit rig: pieces across the upper body are the torso, those to a side are arms, and the part follows the clipped triangles', () => {
  const pts = [], idx = [];
  const strip = (x0, x1, y0, y1, bands) => {
    for (let k = 0; k <= bands; k++) { const y = y0 + (y1 - y0) * k / bands; pts.push(x0, y, 0, x1, y, 0); }
    const base = pts.length / 3 - 2 * (bands + 1);
    for (let k = 0; k < bands; k++) { const a = base + 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  };
  strip(-0.3, 0.3, 1.0, 1.5, 300); // across the body: torso
  strip(0.25, 0.4, 1.1, 1.4, 300); // to one side: an arm
  const { clothPart } = bodyTriangles(new Float32Array(pts), new Uint32Array(idx));
  assert.equal(clothPart[0], 'torso'); assert.equal(clothPart[clothPart.length - 1], 'arm');
  // a triangle cut in two by the cut keeps its tag on both pieces
  const t = { normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), uvs: null };
  const cut = clipBelow({ ...t, positions: new Float32Array([0, 2, 0, 1, 1, 0, 0, 1, 0]) }, 1.5);
  assert.equal(cut.tags, null, 'no tags in, none out');
  const tagged = clipBelow({ ...t, positions: new Float32Array([0, 2, 0, 1, 1, 0, 0, 1, 0]), tags: ['arm'] }, 1.5);
  assert.deepEqual(tagged.tags, Array(tagged.positions.length / 9).fill('arm'));
});

test('sunlit: the whole Sun on open ground, none behind a ridge, part of it on the line of a far one', () => {
  const at = { x: 0, y: 0.0017, z: 0 }, sun = { az: 90, el: 0.4 }; // the Sun to the east, 0.4° up
  assert.equal(sunFraction(at, sun, () => 0), 1);
  // a ridge 1 km east, 50 m high: about 2.9° over the eyes
  const ridge = (x) => (x > 1 && x < 1.2 ? 0.05 : 0);
  close(horizonElevation(at, 90, ridge), Math.atan2(0.05 - 0.0017, 1) * 180 / Math.PI, 0.1); // sampled in steps of 4 %
  assert.equal(sunFraction(at, sun, ridge), 0);
  // the edge of a plateau exactly at the Sun's centre: half the disc
  const h = 0.0017 + Math.tan(0.4 * Math.PI / 180) * 5;
  close(sunFraction(at, sun, x => (x >= 5 ? h : 0)), 0.5, 0.06); // a plateau from 5 km on
  // to the west the ridge does not matter
  assert.equal(sunFraction(at, { az: 270, el: 0.4 }, ridge), 1);
});

test('suit rig: the waist, reaching up under the torso at its sides, never goes with the shoulders', () => {
  // a point of the side of the waist, under the hard torso: by zone it would be the shoulder's
  const [cx, cy, cz] = ARM_RING.centre;
  assert.equal(rigWeights(0.2, 1.05, 0.15, 'arm').index[0], BONE.shoulderL);
  const waist = rigWeights(0.2, 1.05, 0.15, 'body');
  assert.ok(!waist.index.includes(BONE.shoulderL) && !waist.index.includes(BONE.elbowL), JSON.stringify(waist));
  assert.ok(cx > 0 && cy > 1 && cz > 0);
});
