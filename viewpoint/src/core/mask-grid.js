// MaskGrid: the horizon masks of a 4 × 4 km square around the site, one every 100 m, so the light and the Earth can be known
// at ANY point around the site and not only at the flag. Pure: no fetch, no DOM.
// The masks are stored already in the axes of the region (pipeline/mask-grid.mjs): azimuth from the local north of the CENTRE and
// elevation over the vertical of the centre, so they compare straight away with the azimuth and elevation of series-2027.json.
// Layout of masks.bin: int16 little-endian, hundredths of a degree, one row of `azimuths` values per point; points by rows from
// north to south (z from -extent/2 to +extent/2) and from west to east (x from -extent/2 to +extent/2), like the relief.
const BYTES_PER_VALUE = 2;
const CENTIDEGREES = 100;

/** Number of points per side and bytes the file has to weigh, from the `maskGrid` block of meta.json. */
export function expectedMaskBytes(maskGrid) {
  return maskGrid.cols * maskGrid.rows * maskGrid.azimuths * BYTES_PER_VALUE;
}

/**
 * @param {object} meta `maskGrid` block of meta.json (`meta.maskGrid`) or the whole meta.json.
 * @param {Uint8Array|ArrayBuffer} buffer bytes of masks.bin
 * @returns {{extentKm:number, stepKm:number, cols:number, rows:number, azimuths:number, stepDeg:number, data:Float32Array}}
 *   data: elevations in degrees, `azimuths` per point, point (col, row) at ((row · cols) + col) · azimuths.
 */
export function decodeMaskGrid(meta, buffer) {
  const g = meta?.maskGrid ?? meta;
  if (!g || g.encoding !== 'int16-le') throw new Error('meta.json: la rejilla de máscaras no usa int16-le');
  for (const key of ['cols', 'rows', 'azimuths']) {
    if (!Number.isInteger(g[key]) || g[key] < 2) throw new Error(`meta.json: maskGrid.${key} no válido`);
  }
  if (!(g.extentKm > 0) || !(g.stepKm > 0)) throw new Error('meta.json: maskGrid sin extensión o paso');
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  if (bytes.byteLength !== expectedMaskBytes(g)) {
    throw new Error(`${g.file ?? 'masks.bin'} pesa ${bytes.byteLength} bytes y se esperaban ${expectedMaskBytes(g)}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data = new Float32Array(g.cols * g.rows * g.azimuths);
  for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * BYTES_PER_VALUE, true) / CENTIDEGREES;
  return { extentKm: g.extentKm, stepKm: g.stepKm, cols: g.cols, rows: g.rows, azimuths: g.azimuths, stepDeg: 360 / g.azimuths, data };
}

/**
 * Mask at a scene point (x east, z south, km): bilinear between the four masks around it. Outside the square it takes the
 * nearest edge (the grid does not extrapolate).
 * @returns {{el:Float32Array, stepDeg:number}} elevations in degrees at azimuth k · stepDeg
 */
export function maskAt(grid, x, z) {
  const { cols, rows, azimuths, stepKm, extentKm, data } = grid;
  const clamp = (v, max) => Math.min(Math.max(v, 0), max);
  const fx = clamp((x + extentKm / 2) / stepKm, cols - 1);
  const fz = clamp((z + extentKm / 2) / stepKm, rows - 1);
  const i = Math.min(Math.floor(fx), cols - 2);
  const j = Math.min(Math.floor(fz), rows - 2);
  const u = fx - i;
  const v = fz - j;
  const at = (c, r) => (r * cols + c) * azimuths;
  const a = at(i, j);
  const b = at(i + 1, j);
  const c = at(i, j + 1);
  const d = at(i + 1, j + 1);
  const el = new Float32Array(azimuths);
  for (let k = 0; k < azimuths; k++) {
    el[k] = (1 - u) * (1 - v) * data[a + k] + u * (1 - v) * data[b + k] + (1 - u) * v * data[c + k] + u * v * data[d + k];
  }
  return { el, stepDeg: grid.stepDeg };
}

/** Elevation of the horizon (degrees) at an azimuth: linear between the two nearest samples (as horizonElevation of the engine). */
export function horizonAtAzimuth(mask, az) {
  const n = mask.el.length;
  const x = (((az % 360) + 360) % 360) / mask.stepDeg;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  return mask.el[i] * (1 - f) + mask.el[(i + 1) % n] * f;
}

/** Visible fraction (0..1) of a disc of radius `radiusDeg` centred at `el` over a straight horizon at `h` (ported from fractionOver, backend/src/visibility.ts). */
export function fractionOver(el, radiusDeg, h) {
  const y = (h - el) / radiusDeg; // horizon relative to the centre, in radii
  if (y <= -1) return 1;
  if (y >= 1) return 0;
  return (Math.acos(y) - y * Math.sqrt(1 - y * y)) / Math.PI;
}

/** Visible fraction (0..1) of the disc at (az, el) with radius `radiusDeg` (degrees) over the mask (ported from visibleFraction, backend/src/visibility.ts). */
export function discFraction(mask, az, el, radiusDeg) {
  return fractionOver(el, radiusDeg, horizonAtAzimuth(mask, az));
}
