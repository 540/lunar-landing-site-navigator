// LOLA digital elevation models (DEM) in a local cache, used to compute horizons.
//
// Products (PGDA/GSFC, Barker et al. 2023; heights in metres above the 1737.4 km sphere, ME frame):
//   LDEM_80S_20MPP_ADJ  20 m/px COG with overviews (40…1280 m), covers the ±304 km square around the south pole
//   LDEM_60S_240MPP_ADJ 240 m/px, ±931.2 km (down to 60°S along the axes)
// Projection: SPHERICAL south polar stereographic (R = 1 737 400 m, true scale at the pole): it has a closed form,
// no proj4 needed.  x = ρ·sin(lon), y = ρ·cos(lon), ρ = 2R·tan((90° + lat)/2).
//
// The cache (backend/terrain/cache/, outside git) stores each grid as <name>.json (georeference) + <name>.f32
// (little-endian Float32, row-major, north up). It is filled by `node scripts/fetch-dem.ts`; at runtime there is NO network.
// Instead of the .f32 a grid may come packed without loss as <name>.ldp (demPack.ts, `node scripts/pack-dem.ts`), for
// deployments with a size limit: it is unpacked in memory on first use, to the same bits.
// Without the cache everything still works: no DEM → no mask → horizon at 0°.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DemStore, Grid, GridGeometry, GridMeta, Layer, LayerSelection, Resolution, ResolutionConfig } from '../types.ts';
import { PACKED_EXT, packedSize, unpackGrid } from './demPack.ts';

export const R_M = 1737400;
const D2R = Math.PI / 180;

export const PRODUCTS: Record<string, { url: string; X0: number; Y0: number; sizeM: number; baseRes: number }> = {
  LDEM_80S_20MPP_ADJ: { url: 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF', X0: -304000, Y0: 304000, sizeM: 608000, baseRes: 20 },
  LDEM_60S_240MPP_ADJ: { url: 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF', X0: -931200, Y0: 931200, sizeM: 1862400, baseRes: 240 },
};

/** Terrain folder. LUNAR_TERRAIN_DIR changes it ('none' disables it). Under `node --test` it disables itself: hermetic tests. */
export function defaultTerrainDir(): string | null {
  const env = process.env.LUNAR_TERRAIN_DIR;
  if (env !== undefined) return env === '' || env === 'none' ? null : path.resolve(env);
  if (process.env.NODE_TEST_CONTEXT) return null;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'terrain');
}

export const llToXY = (lat: number, lon: number): [number, number] => {
  const rho = 2 * R_M * Math.tan(((90 + lat) * D2R) / 2);
  return [rho * Math.sin(lon * D2R), rho * Math.cos(lon * D2R)];
};
export const xyToLL = (x: number, y: number): [number, number] => [-(90 - (2 * Math.atan(Math.hypot(x, y) / (2 * R_M))) / D2R), Math.atan2(x, y) / D2R];

/**
 * Grid: {name, product, res, X0, Y0, c0, r0, w, h, a: Float32Array}.
 * The centre of pixel (i, j) is at x = X0 + (c0 + i + 0.5)·res, y = Y0 − (r0 + j + 0.5)·res.
 */
export function makeGrid({ name = 'memoria', product = 'sintético', res, X0, Y0, c0 = 0, r0 = 0, w, h, a }: Omit<Grid, 'name' | 'product' | 'c0' | 'r0' | 'bin'> & Partial<Pick<Grid, 'name' | 'product' | 'c0' | 'r0'>>): Grid {
  if (!(a instanceof Float32Array) || a.length !== w * h) throw new Error(`Rejilla ${name}: se esperaban ${w}×${h} valores Float32`);
  return { name, product, res, X0, Y0, c0, r0, w, h, a };
}

/** Height (m) by bilinear interpolation; NaN outside the grid. */
export function bilinear(g: Grid, x: number, y: number): number {
  const fx = (x - g.X0) / g.res - 0.5 - g.c0, fy = (g.Y0 - y) / g.res - 0.5 - g.r0;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.w - 1 || j >= g.h - 1) return NaN;
  const u = fx - i, v = fy - j, a = g.a, k = j * g.w + i;
  return (1 - u) * (1 - v) * a[k] + u * (1 - v) * a[k + 1] + (1 - u) * v * a[k + g.w] + u * v * a[k + g.w + 1];
}

/** Does the grid contain the point (x, y) with `marginM` of clearance to the edge? */
export function covers(g: GridGeometry, x: number, y: number, marginM: number = 0): boolean {
  const xmin = g.X0 + (g.c0 + 0.5) * g.res, xmax = g.X0 + (g.c0 + g.w - 0.5) * g.res;
  const ymax = g.Y0 - (g.r0 + 0.5) * g.res, ymin = g.Y0 - (g.r0 + g.h - 0.5) * g.res;
  return x - xmin >= marginM && xmax - x >= marginM && y - ymin >= marginM && ymax - y >= marginM;
}

// ---------- grid data shared between threads ----------
// The worker pool (pool.ts) reads every grid once, asynchronously, into a SharedArrayBuffer and hands the buffers to its
// workers: N workers use one copy of the DEM (~340 MB) instead of N. Without the pool each grid is read on first use.
const sharedData: Map<string, Float32Array> = new Map(); // .f32 path → data

/** Uses the given buffers (bin path → SharedArrayBuffer, from loadSharedGrids) for the grids of those files. */
export function adoptSharedGrids(buffers: Readonly<Record<string, SharedArrayBuffer>>): void {
  for (const [bin, sab] of Object.entries(buffers)) sharedData.set(bin, new Float32Array(sab));
}

/** Reads every grid of the cache of `dir` into SharedArrayBuffers without blocking the event loop (bin path → buffer). */
export async function loadSharedGrids(dir: string | null = defaultTerrainDir()): Promise<Record<string, SharedArrayBuffer>> {
  const out: Record<string, SharedArrayBuffer> = {};
  for (const g of scan(dir).grids) {
    if (!g.bin) continue;
    const size = g.w * g.h * 4;
    const sab = new SharedArrayBuffer(size);
    if (g.bin.endsWith(PACKED_EXT)) {
      unpackGrid(await fs.promises.readFile(g.bin), new Float32Array(sab));
      out[g.bin] = sab;
      continue;
    }
    const fh = await fs.promises.open(g.bin, 'r');
    try {
      for (let pos = 0; pos < size;) {
        const { bytesRead } = await fh.read(new Uint8Array(sab, pos, Math.min(size - pos, 16 << 20)), 0, Math.min(size - pos, 16 << 20), pos);
        if (!bytesRead) throw new Error(`${g.bin}: fichero más corto de lo esperado`);
        pos += bytesRead;
      }
    } finally { await fh.close(); }
    out[g.bin] = sab;
  }
  return out;
}

// ---------- grid store ----------
/** @type {{grids: object[], version: string|null, dir: string|null}} */
let store: DemStore | null = null;

function versionOf(grids: readonly Grid[]): string | null {
  if (!grids.length) return null;
  const desc = grids.map((g) => `${g.product}|${g.res}|${g.c0}|${g.r0}|${g.w}|${g.h}`).sort().join(';');
  return `lola-${crypto.createHash('sha256').update(desc).digest('hex').slice(0, 12)}`;
}

/** Does the header of a packed grid match the size of its metadata? (reads only the first bytes) */
function packedMatches(file: string, m: GridMeta): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    const { w, h } = packedSize(head);
    return w === m.w && h === m.h;
  } catch { return false; } finally { fs.closeSync(fd); }
}

/** Reads the cache metadata (the Float32 data is loaded, or unpacked, on first use). */
function scan(dir: string | null): DemStore {
  const cache = dir ? path.join(dir, 'cache') : null;
  const grids: Grid[] = [];
  if (cache && fs.existsSync(cache)) {
    for (const f of fs.readdirSync(cache).filter((n) => n.endsWith('.json')).sort()) {
      try {
        const m: GridMeta = JSON.parse(fs.readFileSync(path.join(cache, f), 'utf8'));
        const raw = path.join(cache, f.replace(/\.json$/, '.f32')), packed = path.join(cache, f.replace(/\.json$/, PACKED_EXT));
        if (!Number.isFinite(m.res)) continue;
        const bin = fs.existsSync(raw) && fs.statSync(raw).size === m.w * m.h * 4 ? raw : fs.existsSync(packed) && packedMatches(packed, m) ? packed : null;
        if (!bin) continue;
        const g = { name: f.replace(/\.json$/, ''), product: m.product ?? 'desconocido', res: m.res, X0: m.X0, Y0: m.Y0, c0: m.c0, r0: m.r0, w: m.w, h: m.h, bin } as Grid;
        let data: Float32Array | null = null;
        Object.defineProperty(g, 'a', {
          enumerable: false,
          get() {
            if (!data) {
              const shared = sharedData.get(bin);
              if (shared) data = shared;
              else if (bin.endsWith(PACKED_EXT)) data = unpackGrid(fs.readFileSync(bin));
              else { const b = fs.readFileSync(bin); data = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); }
            }
            return data;
          },
        });
        grids.push(g);
      } catch { /* unreadable metadata: that grid is skipped */ }
    }
  }
  grids.sort((p, q) => p.res - q.res || (p.name < q.name ? -1 : 1));
  return { grids, version: versionOf(grids), dir };
}

const getStore = (): DemStore => (store ??= scan(defaultTerrainDir()));

/** Replaces the store: {dir} to read another folder, {grids} for in-memory grids (tests), nothing = default. */
export function configureDem({ dir, grids }: { dir?: string | null; grids?: readonly Grid[] } = {}): string | null {
  if (grids) store = { grids: [...grids].sort((p, q) => p.res - q.res), version: versionOf(grids), dir: null };
  else store = scan(dir === undefined ? defaultTerrainDir() : dir);
  return store.version;
}

/** Identifier of the available DEM set (null = no DEM). Part of the evals fingerprint. */
export const demVersion = (): string | null => getStore().version;
export const listGrids = (): Omit<Grid, 'X0' | 'Y0' | 'a' | 'bin'>[] => getStore().grids.map(({ name, product, res, c0, r0, w, h }) => ({ name, product, res, c0, r0, w, h }));

/** Grids (finest first) that contain the point (x, y) with `marginM` of clearance to the edge. */
export const gridsCovering = (x: number, y: number, marginM: number = 0): Grid[] => getStore().grids.filter((g) => covers(g, x, y, marginM));

const FINE_MAX_RES = 80; // ≤ 80 m: near field
export const RESOLUTIONS: Record<Resolution, ResolutionConfig> = {
  // Precise: 20 m up to 10 km (if there is a 20 m window) + 160/240 m up to 300 km, step 0.5 px (growing 0.3 %·d), 720 azimuths.
  precise: { nearM: 10000, farM: 300000, stepFrac: 0.5, grow: 0.003, nAz: 720, fine: true },
  // Fast: only 160/240 m up to 150 km, step growing 1 %·d, 360 azimuths. For search grids.
  fast: { nearM: 0, farM: 150000, stepFrac: 0.5, grow: 0.01, nAz: 360, fine: false },
};

/**
 * Layers (fine to coarse) for the horizon of a point, by coverage: the best grid containing it at each
 * scale and, behind it, the coarser ones as filler where the fine one ends. null if no DEM contains the point.
 */
export function layersFor(lat: number, lon: number, resolution: Resolution = 'precise'): LayerSelection | null {
  const cfg = RESOLUTIONS[resolution];
  if (!cfg) throw new Error(`resolution debe ser una de: ${Object.keys(RESOLUTIONS).join(', ')}`);
  const [x, y] = llToXY(lat, lon);
  const { grids } = getStore();
  const coarse = grids.filter((g) => g.res > FINE_MAX_RES && covers(g, x, y, g.res));
  const fine = cfg.fine ? grids.find((g) => g.res <= FINE_MAX_RES && covers(g, x, y, 2000)) : null;
  if (!coarse.length && !fine) return null;
  const layers: Layer[] = [];
  if (fine) layers.push({ g: fine, maxD: coarse.length ? cfg.nearM : Math.min(cfg.farM, 50000) });
  for (const g of coarse) layers.push({ g, maxD: cfg.farM });
  return { layers, cfg, products: [...new Set(layers.map((l) => `${l.g.product}@${l.g.res}m`))] };
}
