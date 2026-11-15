// Relief of a region (viewpoint/data/<site>/meta.json + terrain-lod0.bin). Pure: no fetch, no DOM, no three.js.
// Layout of terrain-lod0.bin: rows × cols unsigned 16-bit little-endian integers, row-major.
// Row j is at z = -extent/2 + j·step (north to south), column i at x = -extent/2 + i·step (west to east).
// Height in km = offset + value · scale.
// `meta.detail` (optional, #97) lists finer grids with the same layout, centred on the region and coarse to fine: each one
// replaces the one before where it reaches. A «level» below is `{ extentKm, grid, heights }`; level 0 is the whole region.
export const BYTES_PER_HEIGHT = 2;
// Encodings of a binary of heights. 'uint16-le' is the layout above. 'delta16-gzip' (the detail grids) is the same layout
// packed by pipeline/relief.mjs (packDelta16) and gzipped: the caller gunzips the file and unpackDelta16 gives the layout back.
export const PLAIN_ENCODING = 'uint16-le';
export const PACKED_ENCODING = 'delta16-gzip';

export const SOURCE_TYPES = ['procedural', 'lola', 'simulated'];

/** Only LOLA is measured terrain; procedural and simulated are invented. */
export const isRealRelief = type => type === 'lola';

/**
 * Which notice the viewer shows (V2.3, #78): the source of the relief, or a warning when the relief and the verdict come from
 * different sources (a simulated verdict on real LOLA relief, or a verdict with real data on invented relief).
 * `verdictSource` is the source of the mission service: 'api', 'fake' or null (unknown: no warning).
 * @returns {'lola'|'procedural'|'simulated'|'fakeOverReal'|'realOverInvented'} a key of TEXTS.notice
 */
export function reliefNoticeKey(reliefType, verdictSource) {
  if (verdictSource === 'fake' && isRealRelief(reliefType)) return 'fakeOverReal';
  if (verdictSource === 'api' && !isRealRelief(reliefType)) return 'realOverInvented';
  return reliefType;
}

const REQUIRED = ['version', 'id', 'name', 'center', 'extentKm', 'grid', 'heights', 'source', 'sceneFrame'];

/** Throws if meta.json does not have the fields the client needs. Returns meta. */
export function validateMeta(meta) {
  for (const key of REQUIRED) {
    if (meta?.[key] === undefined) throw new Error(`meta.json: falta «${key}»`);
  }
  if (!SOURCE_TYPES.includes(meta.source?.type)) throw new Error(`meta.json: fuente no válida (${SOURCE_TYPES.join(', ')})`);
  const { grid, heights, sceneFrame, center } = meta;
  if (!Number.isInteger(grid.cols) || !Number.isInteger(grid.rows) || grid.cols < 2 || grid.rows < 2) throw new Error('meta.json: rejilla no válida');
  if (!(meta.extentKm > 0)) throw new Error('meta.json: extensión no válida');
  if (heights.encoding !== 'uint16-le' || heights.unit !== 'km' || !Number.isFinite(heights.scale) || !Number.isFinite(heights.offset)) {
    throw new Error('meta.json: codificación de alturas no válida');
  }
  if (!(sceneFrame.radiusKm > 0) || !Number.isFinite(sceneFrame.centerLat) || !Number.isFinite(sceneFrame.centerLon)) throw new Error('meta.json: sceneFrame no válido');
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) throw new Error('meta.json: centro no válido');
  return meta;
}

const isWhole = (v) => Math.abs(v - Math.round(v)) < 1e-9;

/**
 * The finer grids of `meta.detail`, coarse to fine ([] when there are none). Throws if one cannot be stitched to the one
 * before: it has to be smaller, and its border has to run along grid lines of the one before.
 */
export function detailLevels(meta) {
  const list = meta.detail ?? [];
  if (!Array.isArray(list)) throw new Error('meta.json: «detail» no válido');
  let parent = meta;
  for (const level of list) {
    const { grid, heights } = level ?? {};
    if (!grid || !Number.isInteger(grid.cols) || !Number.isInteger(grid.rows) || grid.cols < 3 || grid.rows < 3) throw new Error('meta.json: rejilla de detalle no válida');
    if (![PLAIN_ENCODING, PACKED_ENCODING].includes(heights?.encoding) || heights.unit !== 'km' || !Number.isFinite(heights.scale) || !Number.isFinite(heights.offset) || !heights.file) {
      throw new Error('meta.json: codificación de alturas de detalle no válida');
    }
    const cellsX = (level.extentKm / parent.extentKm) * (parent.grid.cols - 1);
    const cellsZ = (level.extentKm / parent.extentKm) * (parent.grid.rows - 1);
    const aligned = (cells, total) => isWhole(cells) && isWhole((total - cells) / 2);
    if (!(level.extentKm > 0 && level.extentKm < parent.extentKm) || !aligned(cellsX, parent.grid.cols - 1) || !aligned(cellsZ, parent.grid.rows - 1)) {
      throw new Error('meta.json: la rejilla de detalle no encaja en la anterior');
    }
    parent = level;
  }
  return list;
}

/** Expected size of the binary of the region or of one of its detail grids, in bytes. */
export const expectedBytes = (meta) => meta.grid.rows * meta.grid.cols * BYTES_PER_HEIGHT;

/** Decodes the binary of the region into heights in km (Float32Array rows × cols). */
export function decodeHeights(meta, buffer) {
  validateMeta(meta);
  return decodeGrid(meta, buffer);
}

/** True when the file of the grid is gzipped: it has to be gunzipped before decodeGrid. */
export const isGzipped = (meta) => meta.heights.encoding === PACKED_ENCODING;

/**
 * Undoes packDelta16 of pipeline/relief.mjs on the gunzipped bytes: the low bytes of every node, then the high bytes, of the
 * difference between each height and the prediction left + up − up-left. Returns the plain uint16 little-endian layout.
 */
export function unpackDelta16(planes, cols) {
  const count = planes.byteLength / 2;
  const values = new Uint16Array(count);
  const out = new Uint8Array(count * 2);
  for (let k = 0; k < count; k++) {
    const left = k % cols ? values[k - 1] : 0;
    const up = k >= cols ? values[k - cols] : 0;
    const upLeft = k % cols && k >= cols ? values[k - cols - 1] : 0;
    const v = (left + up - upLeft + (planes[k] | (planes[count + k] << 8))) & 0xffff;
    values[k] = v;
    out[k * 2] = v & 0xff;
    out[k * 2 + 1] = v >> 8;
  }
  return out;
}

/**
 * Decodes the binary of the region or of one entry of `meta.detail` into heights in km (Float32Array rows × cols).
 * `buffer` is a Uint8Array with the bytes of the file, already gunzipped when `isGzipped(meta)`.
 */
export function decodeGrid(meta, buffer) {
  if (buffer.byteLength !== expectedBytes(meta)) {
    throw new Error(`${meta.heights.file} pesa ${buffer.byteLength} bytes y se esperaban ${expectedBytes(meta)}`);
  }
  if (isGzipped(meta)) buffer = unpackDelta16(buffer, meta.grid.cols);
  const view = new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  const { rows, cols } = meta.grid;
  const out = new Float32Array(rows * cols);
  for (let i = 0; i < out.length; i++) out[i] = meta.heights.offset + view.getUint16(i * BYTES_PER_HEIGHT, true) * meta.heights.scale;
  return out;
}

/**
 * Vertex positions (x, y, z in km) and triangle indices of the grid. With `holeKm`, the cells of the centred square of that
 * side are left without triangles: a finer level is drawn there.
 */
export function buildTerrainArrays(meta, heights, holeKm = 0) {
  const { rows, cols } = meta.grid;
  const half = meta.extentKm / 2;
  const dx = meta.extentKm / (cols - 1);
  const dz = meta.extentKm / (rows - 1);
  const positions = new Float32Array(rows * cols * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      positions[k * 3] = -half + i * dx;
      positions[k * 3 + 1] = heights[k];
      positions[k * 3 + 2] = -half + j * dz;
    }
  }
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);
  // First and one-past-last cell of the hole on each axis (empty when there is no hole).
  const holeI0 = Math.round((half - holeKm / 2) / dx);
  const holeI1 = Math.round((half + holeKm / 2) / dx);
  const holeJ0 = Math.round((half - holeKm / 2) / dz);
  const holeJ1 = Math.round((half + holeKm / 2) / dz);
  let n = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      if (i >= holeI0 && i < holeI1 && j >= holeJ0 && j < holeJ1) continue;
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // counter-clockwise seen from above (+y), so the normals point up
      indices.set([a, c, b, b, c, d], n);
      n += 6;
    }
  }
  return { positions, indices: n === indices.length ? indices : indices.subarray(0, n) };
}

/** Height in km at (x, z) in km, bilinear. Outside the grid it clamps to the edge. */
export function heightAt(meta, heights, x, z) {
  const { rows, cols } = meta.grid;
  const half = meta.extentKm / 2;
  const fi = Math.min(cols - 1, Math.max(0, ((x + half) / meta.extentKm) * (cols - 1)));
  const fj = Math.min(rows - 1, Math.max(0, ((z + half) / meta.extentKm) * (rows - 1)));
  const i0 = Math.min(cols - 2, Math.floor(fi));
  const j0 = Math.min(rows - 2, Math.floor(fj));
  const u = fi - i0;
  const v = fj - j0;
  const h = (j, i) => heights[j * cols + i];
  return h(j0, i0) * (1 - u) * (1 - v) + h(j0, i0 + 1) * u * (1 - v) + h(j0 + 1, i0) * (1 - u) * v + h(j0 + 1, i0 + 1) * u * v;
}

const inside = (level, x, z) => Math.max(Math.abs(x), Math.abs(z)) <= level.extentKm / 2;

/** Height in km at (x, z) on the finest level that reaches the point. */
export function surfaceHeightAt(levels, x, z) {
  for (let k = levels.length - 1; k > 0; k--) if (inside(levels[k], x, z)) return heightAt(levels[k], levels[k].heights, x, z);
  return heightAt(levels[0], levels[0].heights, x, z);
}

const smoothstep = (t) => t * t * (3 - 2 * t);
// Width of the band, in cells of the level before, where a detail level fades into it.
const BLEND_PARENT_CELLS = 2;

/**
 * Fades the heights of a detail level into the level before over a band at its border, so the two meshes meet without a step:
 * on the border itself the height is the one of the level before (its triangles are straight along grid lines, where the
 * bilinear height is exact), and `BLEND_PARENT_CELLS` cells in it is the level's own.
 */
function blendIntoParent(level, heights, parent) {
  const { rows, cols } = level.grid;
  const half = level.extentKm / 2;
  const dx = level.extentKm / (cols - 1);
  const dz = level.extentKm / (rows - 1);
  const parentStep = parent.extentKm / (parent.grid.cols - 1);
  const band = Math.max(1, Math.min(Math.floor((Math.min(rows, cols) - 1) / 4), Math.round((BLEND_PARENT_CELLS * parentStep) / dx)));
  const out = Float32Array.from(heights);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = Math.min(i, j, cols - 1 - i, rows - 1 - j);
      if (d >= band) continue;
      const w = smoothstep(d / band);
      const k = j * cols + i;
      out[k] = heightAt(parent, parent.heights, -half + i * dx, -half + j * dz) * (1 - w) + heights[k] * w;
    }
  }
  return out;
}

/** Bilinear sample of a per-node vector field (`size` numbers per node) of a level at (x, z), written to `out`. */
function sampleField(level, field, size, x, z, out) {
  const { rows, cols } = level.grid;
  const half = level.extentKm / 2;
  const fi = Math.min(cols - 1, Math.max(0, ((x + half) / level.extentKm) * (cols - 1)));
  const fj = Math.min(rows - 1, Math.max(0, ((z + half) / level.extentKm) * (rows - 1)));
  const i0 = Math.min(cols - 2, Math.floor(fi));
  const j0 = Math.min(rows - 2, Math.floor(fj));
  const u = fi - i0;
  const v = fj - j0;
  const a = (j0 * cols + i0) * size;
  const c = a + cols * size;
  for (let q = 0; q < size; q++) out[q] = field[a + q] * (1 - u) * (1 - v) + field[a + size + q] * u * (1 - v) + field[c + q] * (1 - u) * v + field[c + size + q] * u * v;
  return out;
}

/**
 * Unit normals of every node of a level (x, y, z per node), from the slope of the heights between its neighbours. At the
 * border the neighbour that is missing comes from the level before, and the border nodes take the normal the level before
 * has there: the light does not change across the seam between two levels.
 */
function levelNormals(level, parent) {
  const { rows, cols } = level.grid;
  const half = level.extentKm / 2;
  const dx = level.extentKm / (cols - 1);
  const dz = level.extentKm / (rows - 1);
  const h = level.heights;
  const normals = new Float32Array(rows * cols * 3);
  // Height of the node (i, j), also one step outside the grid: from the level before, or the edge when there is none.
  const at = (i, j) => {
    if (i >= 0 && i < cols && j >= 0 && j < rows) return h[j * cols + i];
    if (parent) return heightAt(parent, parent.heights, -half + i * dx, -half + j * dz);
    return h[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];
  };
  const tmp = [0, 0, 0];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = (j * cols + i) * 3;
      const border = i === 0 || j === 0 || i === cols - 1 || j === rows - 1;
      let nx, ny, nz;
      if (border && parent) {
        [nx, ny, nz] = sampleField(parent, parent.normals, 3, -half + i * dx, -half + j * dz, tmp);
      } else {
        // Without a level before, the edge of the region has one neighbour only: the slope is one-sided there.
        const spanX = (i === 0 || i === cols - 1) && !parent ? dx : 2 * dx;
        const spanZ = (j === 0 || j === rows - 1) && !parent ? dz : 2 * dz;
        nx = -(at(i + 1, j) - at(i - 1, j)) / spanX;
        nz = -(at(i, j + 1) - at(i, j - 1)) / spanZ;
        ny = 1;
      }
      const len = Math.hypot(nx, ny, nz);
      normals[k] = nx / len;
      normals[k + 1] = ny / len;
      normals[k + 2] = nz / len;
    }
  }
  return normals;
}

/**
 * The levels of a region ready to draw, coarse to fine: `{ extentKm, grid, heights, normals }`. `detailHeights` are the decoded
 * heights of `meta.detail`, in order; a missing one ends the list there (the region is drawn with what there is).
 */
export function buildLevels(meta, heights, detailHeights = []) {
  const levels = [{ extentKm: meta.extentKm, grid: meta.grid, heights }];
  levels[0].normals = levelNormals(levels[0], null);
  const detail = detailLevels(meta);
  for (let k = 0; k < detail.length && detailHeights[k]; k++) {
    const parent = levels[k];
    const level = { extentKm: detail[k].extentKm, grid: detail[k].grid };
    level.heights = blendIntoParent(level, detailHeights[k], parent);
    level.normals = levelNormals(level, parent);
    levels.push(level);
  }
  return levels;
}

/** What the shadow camera has to cover: the half side of the region and its lowest and highest height, in km. */
export function shadowBounds(levels) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { heights } of levels) {
    for (const h of heights) {
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }
  return { half: levels[0].extentKm / 2, minY, maxY };
}

const SHADOW_MARGIN_KM = 0.05;

/**
 * Orthographic frustum of the Sun's shadow camera, fitted to the box of the region for one direction of the Sun (a unit vector
 * towards it, as `dirAzEl`). With the Sun grazing the horizon the box is seen almost edge-on, a few km tall: fitting `top` and
 * `bottom` to it, instead of to the diagonal of the region, is what gives the shadow map metres per texel in height (#97).
 * The camera is the one of three.js: at `distance` from the origin along the direction, looking at the origin, with +y up.
 */
export function fitShadowFrustum({ half, minY, maxY }, dir) {
  // Axes of the camera: z towards the Sun, x horizontal, y up as seen from the Sun.
  const flat = Math.hypot(dir.x, dir.z);
  const ax = flat > 1e-9 ? { x: dir.z / flat, y: 0, z: -dir.x / flat } : { x: 1, y: 0, z: 0 };
  const ay = { x: dir.y * ax.z - dir.z * ax.y, y: dir.z * ax.x - dir.x * ax.z, z: dir.x * ax.y - dir.y * ax.x };
  const dot = (a, x, y, z) => a.x * x + a.y * y + a.z * z;
  const range = (a) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of [-half, half]) for (const y of [minY, maxY]) for (const z of [-half, half]) {
      const v = dot(a, x, y, z);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo - SHADOW_MARGIN_KM, hi + SHADOW_MARGIN_KM];
  };
  const [left, right] = range(ax);
  const [bottom, top] = range(ay);
  const [back, front] = range(dir);
  const distance = Math.hypot(half * Math.SQRT2, Math.max(Math.abs(minY), Math.abs(maxY))) + 1;
  return { left, right, bottom, top, near: distance - front, far: distance - back, distance };
}
