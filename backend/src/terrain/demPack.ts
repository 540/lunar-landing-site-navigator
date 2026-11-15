// Lossless packing of a DEM grid (Float32, row-major) for deployments with a size limit.
//
// The heights are smooth, so each value is predicted from its neighbours and only the residual is stored:
//   1. the float bits become an ordered int32 (same order as the floats), so neighbouring heights give small differences;
//   2. plane predictor p = left + up − up-left (left or up on the edges), residual r = value − p (wrapping int32);
//   3. zigzag (small negative → small positive) and the 4 bytes of every residual split into 4 planes;
//   4. zstd (node:zlib).
// Every step is exact integer arithmetic on the bits: decode(encode(a)) is bit for bit the same Float32Array, NaN and −0
// included. On the LOLA grids it keeps 53–57 % of the size (285 → 172 MB) and decodes in about a second.
//
// File layout (<name>.ldp next to <name>.json in the terrain cache, dem.ts): magic 'LDP1', width and height (uint32 LE),
// then the zstd frame.
import zlib from 'node:zlib';

const MAGIC = 'LDP1';
const HEADER = 12;
export const PACKED_EXT = '.ldp';

const toOrdered = (bits: number): number => (bits & 0x80000000 ? ~(bits & 0x7fffffff) : bits | 0);
const fromOrdered = (ord: number): number => (ord < 0 ? (~ord | 0x80000000) >>> 0 : ord);

function predict(ord: Int32Array, k: number, i: number, j: number, w: number): number {
  if (i && j) return ord[k - 1] + ord[k - w] - ord[k - w - 1];
  if (i) return ord[k - 1];
  if (j) return ord[k - w];
  return 0;
}

/** Packs a w×h grid. `level` is the zstd level (3 is fast; 19 saves ~2 % more and takes minutes). */
export function packGrid(a: Float32Array, w: number, h: number, level: number = 9): Buffer {
  const n = w * h;
  if (a.length !== n) throw new Error(`packGrid: se esperaban ${w}×${h} valores y hay ${a.length}`);
  const bits = new Uint32Array(a.buffer, a.byteOffset, n);
  const ord = new Int32Array(n);
  for (let k = 0; k < n; k++) ord[k] = toOrdered(bits[k]);
  const planes = Buffer.allocUnsafe(n * 4);
  for (let j = 0, k = 0; j < h; j++) {
    for (let i = 0; i < w; i++, k++) {
      const r = (ord[k] - predict(ord, k, i, j, w)) | 0;
      const z = ((r << 1) ^ (r >> 31)) >>> 0;
      planes[k] = z & 0xff; planes[n + k] = (z >>> 8) & 0xff; planes[2 * n + k] = (z >>> 16) & 0xff; planes[3 * n + k] = z >>> 24;
    }
  }
  const body = zlib.zstdCompressSync(planes, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } });
  const head = Buffer.alloc(HEADER);
  head.write(MAGIC, 0, 'latin1');
  head.writeUInt32LE(w, 4);
  head.writeUInt32LE(h, 8);
  return Buffer.concat([head, body]);
}

/** Size of a packed grid without decoding it. */
export function packedSize(buf: Uint8Array): { w: number; h: number } {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < HEADER || b.toString('latin1', 0, 4) !== MAGIC) throw new Error('No es una rejilla empaquetada (falta la cabecera LDP1)');
  return { w: b.readUInt32LE(4), h: b.readUInt32LE(8) };
}

/** Unpacks a grid into `out` (a new Float32Array if not given; a view of a SharedArrayBuffer for the pool). */
export function unpackGrid(buf: Uint8Array, out?: Float32Array): Float32Array {
  const { w, h } = packedSize(buf);
  const n = w * h;
  const planes = zlib.zstdDecompressSync(buf.subarray(HEADER));
  if (planes.length !== n * 4) throw new Error(`Rejilla empaquetada corrupta: ${planes.length} bytes, se esperaban ${n * 4}`);
  const a = out ?? new Float32Array(n);
  if (a.length !== n) throw new Error(`unpackGrid: el destino tiene ${a.length} valores y la rejilla ${n}`);
  // Only the previous row and the current one are kept as ordered ints, not a copy of the whole grid (the 60S grid is
  // 240 MB).
  const bits = new Uint32Array(a.buffer, a.byteOffset, n);
  let prev = new Int32Array(w), row = new Int32Array(w);
  for (let j = 0, k = 0; j < h; j++) {
    for (let i = 0; i < w; i++, k++) {
      const z = (planes[k] | (planes[n + k] << 8) | (planes[2 * n + k] << 16) | (planes[3 * n + k] << 24)) >>> 0;
      const r = (z >>> 1) ^ -(z & 1);
      const p = i && j ? row[i - 1] + prev[i] - prev[i - 1] : i ? row[i - 1] : j ? prev[i] : 0;
      row[i] = (r + p) | 0;
      bits[k] = fromOrdered(row[i]);
    }
    [prev, row] = [row, prev];
  }
  return a;
}
