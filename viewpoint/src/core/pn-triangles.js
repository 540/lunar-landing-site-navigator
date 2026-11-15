// Curved PN triangles (Vlachos, Peters, Boyd and Mitchell, 2001): each flat triangle becomes a cubic patch built from the
// positions and normals of its three corners, and is cut into level² smaller triangles on it. The silhouettes of a mesh
// with smooth normals lose their facets; the corners stay where they were (no shrinking, unlike Loop subdivision), a flat
// triangle stays flat, and two triangles that share an edge with the same normals meet without cracks. Pure: no three.js.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * @param {Float32Array} positions x, y, z per corner, three corners per triangle (not indexed)
 * @param {Float32Array} normals unit normals per corner, same layout
 * @param {Float32Array|null} uvs u, v per corner, or null
 * @param {number} level cuts per edge (1: unchanged, 2: 4 triangles each, 3: 9…)
 * @param {Float32Array} [shapeNormals] the normals that shape the patches (same layout), by default `normals`. Where a mesh
 *   is split along a seam with a different normal on each side, the patches of the two sides bulge apart and open a crack:
 *   with one normal per position (averaged over its corners, weldNormals) both sides build the same edge, and `normals`
 *   still shade.
 * @returns {{positions:Float32Array, normals:Float32Array, uvs:Float32Array|null}} not indexed, level² triangles per triangle
 */
export function pnTessellate(positions, normals, uvs, level, shapeNormals = normals) {
  const triangles = positions.length / 9, per = level * level;
  const P = new Float32Array(triangles * per * 9), N = new Float32Array(triangles * per * 9), U = uvs ? new Float32Array(triangles * per * 6) : null;
  let o = 0;
  const p = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], n = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], s = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], t = [[0, 0], [0, 0], [0, 0]];
  for (let tri = 0; tri < triangles; tri++) {
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++) {
        const i = tri * 9 + k * 3 + c;
        p[k][c] = positions[i]; n[k][c] = normals[i]; s[k][c] = shapeNormals[i];
      }
      if (uvs) { t[k][0] = uvs[tri * 6 + k * 2]; t[k][1] = uvs[tri * 6 + k * 2 + 1]; }
    }
    // Edge control points: a third of the way along each edge, pushed onto the tangent plane of its nearer corner.
    const edge = (i, j) => { const w = dot([p[j][0] - p[i][0], p[j][1] - p[i][1], p[j][2] - p[i][2]], s[i]); return [0, 1, 2].map(c => (2 * p[i][c] + p[j][c] - w * s[i][c]) / 3); };
    const b210 = edge(0, 1), b120 = edge(1, 0), b021 = edge(1, 2), b012 = edge(2, 1), b102 = edge(2, 0), b201 = edge(0, 2);
    const E = [0, 1, 2].map(c => (b210[c] + b120[c] + b021[c] + b012[c] + b102[c] + b201[c]) / 6);
    const V = [0, 1, 2].map(c => (p[0][c] + p[1][c] + p[2][c]) / 3);
    const b111 = [0, 1, 2].map(c => E[c] + (E[c] - V[c]) / 2);
    // Point, normal and uv at barycentric (u, v, w) for corners 0, 1, 2.
    const at = (u, v, w, out, oi, nOut, uvOut, ui) => {
      for (let c = 0; c < 3; c++) {
        out[oi + c] = p[0][c] * w * w * w + p[1][c] * u * u * u + p[2][c] * v * v * v
          + 3 * (b210[c] * w * w * u + b120[c] * w * u * u + b201[c] * w * w * v + b021[c] * u * u * v + b102[c] * w * v * v + b012[c] * u * v * v)
          + 6 * b111[c] * w * u * v;
      }
      // Normals interpolated and renormalised: smooth shading across the patch (the quadratic normal patch adds little here).
      let nx = n[0][0] * w + n[1][0] * u + n[2][0] * v, ny = n[0][1] * w + n[1][1] * u + n[2][1] * v, nz = n[0][2] * w + n[1][2] * u + n[2][2] * v;
      const len = Math.hypot(nx, ny, nz) || 1;
      nOut[oi] = nx / len; nOut[oi + 1] = ny / len; nOut[oi + 2] = nz / len;
      if (uvOut) { uvOut[ui] = t[0][0] * w + t[1][0] * u + t[2][0] * v; uvOut[ui + 1] = t[0][1] * w + t[1][1] * u + t[2][1] * v; }
    };
    // Cut into level² triangles: grid points (i, j) with u = i/level, v = j/level, w = 1 − u − v.
    const emit = (a, b, c) => {
      for (const [i, j] of [a, b, c]) { const u = i / level, v = j / level; at(u, v, 1 - u - v, P, o * 3, N, U, o * 2); o++; }
    };
    for (let j = 0; j < level; j++) {
      for (let i = 0; i < level - j; i++) {
        emit([i, j], [i + 1, j], [i, j + 1]);
        if (i + j + 1 < level) emit([i + 1, j], [i + 1, j + 1], [i, j + 1]);
      }
    }
  }
  return { positions: P, normals: N, uvs: U };
}

/**
 * One normal per position: the corners that share a position (to 0.1 mm) get the average of their normals, so the patches
 * of pnTessellate meet along a seam where the mesh was split. A corner whose neighbours point the other way (two pieces
 * back to back) keeps its own: only normals less than 90° apart are averaged.
 * @param {Float32Array} positions x, y, z per corner
 * @param {Float32Array} normals unit normals per corner, same layout
 * @returns {Float32Array} unit normals, same layout
 */
export function weldNormals(positions, normals) {
  const n = positions.length / 3, groups = new Map(), out = new Float32Array(normals.length);
  const key = i => `${Math.round(positions[i * 3] * 1e4)},${Math.round(positions[i * 3 + 1] * 1e4)},${Math.round(positions[i * 3 + 2] * 1e4)}`;
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let g = groups.get(k);
    if (!g) groups.set(k, g = []);
    g.push(i);
  }
  for (const g of groups.values()) {
    for (const i of g) {
      let x = 0, y = 0, z = 0;
      for (const j of g) {
        const d = normals[i * 3] * normals[j * 3] + normals[i * 3 + 1] * normals[j * 3 + 1] + normals[i * 3 + 2] * normals[j * 3 + 2];
        if (d > 0) { x += normals[j * 3]; y += normals[j * 3 + 1]; z += normals[j * 3 + 2]; }
      }
      const len = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / len; out[i * 3 + 1] = y / len; out[i * 3 + 2] = z / len;
    }
  }
  return out;
}
