// Far relief of a region (E9.2): a coarse ring of terrain-far.bin around the fine zone of terrain-lod0.bin. Pure: no fetch, no DOM, no three.js.
// meta.far = { file, extentKm, grid: { cols, rows, stepKm }, heights: { encoding, unit, scale, offset } }. Same layout and encoding as the
// fine grid, centred on the same point. Both grids already include the sphere curvature (y = (R + h) · cos θ − R).
import { decodeHeights, heightAt } from './relief.js';

/** Width in km of the strip, inside the edge of the fine zone, where the fine height blends towards the ring. */
export const BLEND_KM = 2;

/** The far grid as a relief-like meta (extentKm, grid, heights), so the helpers of relief.js read it. */
export const farMeta = (meta) => ({ ...meta, extentKm: meta.far.extentKm, grid: meta.far.grid, heights: { file: meta.far.file, ...meta.far.heights } });

/** Decodes terrain-far.bin into heights in km. */
export function decodeFarHeights(meta, buffer) {
  if (!meta.far) throw new Error('meta.json: no tiene «far»');
  return decodeHeights(farMeta(meta), buffer);
}

/** Throws if meta.far does not describe a usable far grid. Returns meta. */
export function validateFar(meta) {
  const far = meta.far;
  if (far === undefined) return meta;
  if (typeof far.file !== 'string' || !(far.extentKm > meta.extentKm)) throw new Error('meta.json: «far» no válido');
  const { grid, heights } = far;
  if (!Number.isInteger(grid?.cols) || !Number.isInteger(grid?.rows) || grid.cols < 2 || grid.rows < 2) throw new Error('meta.json: rejilla lejana no válida');
  if (heights?.encoding !== 'uint16-le' || heights.unit !== 'km' || !Number.isFinite(heights.scale) || !Number.isFinite(heights.offset)) {
    throw new Error('meta.json: codificación de alturas lejanas no válida');
  }
  return meta;
}

/**
 * Height in km at (x, z) of the fine mesh blended with the ring. Inside the fine zone and further than `blendKm` from its edge it is the
 * fine height; in the strip it goes to the ring's with a smoothstep (C1: no jump in the slope either); on the edge exactly it is the ring's. Outside the fine zone it is the ring's.
 */
export function blendHeight(meta, fine, far, x, z, blendKm = BLEND_KM) {
  const ringH = heightAt(farMeta(meta), far, x, z);
  const inside = meta.extentKm / 2 - Math.max(Math.abs(x), Math.abs(z)); // km to the edge of the fine zone, Chebyshev
  if (inside <= 0) return ringH;
  if (inside >= blendKm) return heightAt(meta, fine, x, z);
  const u = inside / blendKm;
  const t = u * u * (3 - 2 * u);
  return t * heightAt(meta, fine, x, z) + (1 - t) * ringH;
}

/** Heights of the fine grid with the edge strip blended towards the ring (a new Float32Array, same layout). */
export function blendFineHeights(meta, fine, far, blendKm = BLEND_KM) {
  const { rows, cols } = meta.grid;
  const half = meta.extentKm / 2;
  const dx = meta.extentKm / (cols - 1);
  const dz = meta.extentKm / (rows - 1);
  const out = new Float32Array(fine.length);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const x = -half + i * dx;
      const z = -half + j * dz;
      out[k] = half - Math.max(Math.abs(x), Math.abs(z)) >= blendKm ? fine[k] : blendHeight(meta, fine, far, x, z, blendKm);
    }
  }
  return out;
}

/** Sorted coordinates of every far node plus ±half: the hole boundary is a grid line and keeps all the far nodes along it. */
function ringAxis(extentKm, n, half) {
  const step = extentKm / (n - 1);
  const out = [-half, half];
  for (let i = 0; i < n; i++) {
    const c = -extentKm / 2 + i * step;
    if (Math.abs(Math.abs(c) - half) > 1e-9) out.push(c);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Mesh of the ring: the far grid with a square hole of the fine zone (|x|, |z| < extentKm / 2). The hole edge falls on a vertex line
 * (extra lines at ±half), so it fits the fine mesh without slivers. Heights are the far grid sampled bilinearly.
 */
export function buildRingArrays(meta, far) {
  const fm = farMeta(meta);
  const half = meta.extentKm / 2;
  const xs = ringAxis(fm.extentKm, fm.grid.cols, half);
  const zs = ringAxis(fm.extentKm, fm.grid.rows, half);
  const nx = xs.length;
  const nz = zs.length;
  const positions = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      positions[k] = xs[i];
      positions[k + 1] = heightAt(fm, far, xs[i], zs[j]);
      positions[k + 2] = zs[j];
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if ((xs[i] + xs[i + 1]) / 2 > -half && (xs[i] + xs[i + 1]) / 2 < half && (zs[j] + zs[j + 1]) / 2 > -half && (zs[j] + zs[j + 1]) / 2 < half) continue; // the hole
      const a = j * nx + i;
      const c = a + nx;
      idx.push(a, c, a + 1, a + 1, c, c + 1); // counter-clockwise seen from above
    }
  }
  return { positions, indices: Uint32Array.from(idx) };
}

/**
 * Copies the normals of the fine mesh edge onto the ring vertices on the hole boundary (nearest fine edge node), so the two meshes, which
 * compute their normals apart, shade the seam alike. Modifies `ringNormals` in place and returns the number of vertices changed.
 */
export function matchSeamNormals(meta, fineNormals, ringPositions, ringNormals) {
  const { rows, cols } = meta.grid;
  const half = meta.extentKm / 2;
  const dx = meta.extentKm / (cols - 1);
  const dz = meta.extentKm / (rows - 1);
  let changed = 0;
  for (let v = 0; v < ringPositions.length; v += 3) {
    const x = ringPositions[v];
    const z = ringPositions[v + 2];
    const onX = Math.abs(Math.abs(x) - half) < 1e-6;
    const onZ = Math.abs(Math.abs(z) - half) < 1e-6;
    if (Math.abs(x) > half + 1e-6 || Math.abs(z) > half + 1e-6 || (!onX && !onZ)) continue;
    const i = Math.min(cols - 1, Math.max(0, Math.round((x + half) / dx)));
    const j = Math.min(rows - 1, Math.max(0, Math.round((z + half) / dz)));
    const k = (j * cols + i) * 3;
    ringNormals[v] = fineNormals[k];
    ringNormals[v + 1] = fineNormals[k + 1];
    ringNormals[v + 2] = fineNormals[k + 2];
    changed++;
  }
  return changed;
}

/**
 * Elevation in degrees of the horizon from (x, z) for `nAz` azimuths (index k is k · 360 / nAz, 0° towards -z, 90° towards +x), walking
 * the fine grid where it covers and the far one beyond. The observer stands `observerKm` above the fine ground. Only for the tests.
 */
export function horizonFrom(meta, fine, far, x, z, observerKm, { nAz = 720, stepKm = 0.01, maxKm } = {}) {
  const fm = farMeta(meta);
  const half = meta.extentKm / 2;
  const reach = maxKm ?? fm.extentKm / 2 * Math.SQRT2;
  const y0 = heightAt(meta, fine, x, z) + observerKm;
  const el = new Float64Array(nAz);
  for (let k = 0; k < nAz; k++) {
    const a = (k * 2 * Math.PI) / nAz;
    const dx = Math.sin(a);
    const dz = -Math.cos(a);
    let best = -Infinity;
    for (let d = stepKm; d <= reach; d += stepKm) {
      const px = x + dx * d;
      const pz = z + dz * d;
      if (Math.abs(px) > fm.extentKm / 2 || Math.abs(pz) > fm.extentKm / 2) break;
      const h = Math.abs(px) <= half && Math.abs(pz) <= half ? heightAt(meta, fine, px, pz) : heightAt(fm, far, px, pz);
      const e = Math.atan2(h - y0, d);
      if (e > best) best = e;
    }
    el[k] = (best * 180) / Math.PI;
  }
  return el;
}
