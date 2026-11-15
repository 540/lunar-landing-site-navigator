// Official PGDA slope products (LDRM, Barker et al. 2023) in the local cache, read pixel by pixel from disk.
//
// LDRM_80S_50MPP_ADJ_SLP_{100,400,800}M: slope (degrees) of the plane fitted to the 5/20 m LOLA DEM over a baseline of
// 100, 400 or 800 m, the same definition as slope.ts, on a 50 m/px grid covering the ±304 km square around the south
// pole (down to ~80°S), in the projection of LDEM_80S_20MPP_ADJ (dem.ts). Pixel-registered: a point takes the value of
// the pixel that contains it, which is exactly PGDA's number for that place.
//
// Cache: backend/terrain/cache/ldrm/<name>.json (georeference) + <name>.f32 (little-endian Float32, row-major, north up,
// NaN = no data), filled by `node scripts/fetch-dem.ts --slope` (windows) or `--slope-cap` (the whole product, 591 MB).
// The subfolder keeps dem.ts (and older checkouts that share the cache) from ever reading a slope grid as heights.
// Nothing is loaded into memory: each lookup reads one pixel (4 bytes) with a positional read, so the whole cap costs
// nothing until it is used and the worker pool does not copy it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defaultTerrainDir } from './dem.ts';

/** LDRM products by baseline (m). Same georeference as LDEM_80S_20MPP_ADJ: 12160 × 12160 px of 50 m. */
export const LDRM_PRODUCTS: Readonly<Record<number, { product: string; url: string }>> = {
  100: { product: 'LDRM_80S_50MPP_ADJ_SLP_100M', url: 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDRM_80S_50MPP_ADJ_SLP_100M.TIF' },
  400: { product: 'LDRM_80S_50MPP_ADJ_SLP_400M', url: 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDRM_80S_50MPP_ADJ_SLP_400M.TIF' },
  800: { product: 'LDRM_80S_50MPP_ADJ_SLP_800M', url: 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDRM_80S_50MPP_ADJ_SLP_800M.TIF' },
};
export const LDRM_GEOMETRY = { X0: -304000, Y0: 304000, res: 50, size: 12160 } as const;
/** Subfolder of the terrain cache with the LDRM grids. */
export const LDRM_SUBDIR = 'ldrm';

/** A window of an LDRM product: on disk (`bin`) or in memory (`a`, tests). Pixel (i, j) centre as in dem.ts. */
export interface SlopeGrid {
  name: string;
  product: string;
  baselineM: number;
  res: number;
  X0: number;
  Y0: number;
  c0: number;
  r0: number;
  w: number;
  h: number;
  bin?: string;
  a?: Float32Array;
}
/** Metadata of a cached LDRM window (<name>.json). */
export interface SlopeGridMeta { product: string; baselineM: number; url?: string; res: number; X0: number; Y0: number; c0: number; r0: number; w: number; h: number; fetchedAt?: string }

interface Store { grids: SlopeGrid[]; version: string | null }
let store: Store | null = null;
const fds: Map<string, number> = new Map();
const cell = Buffer.alloc(4);

function versionOf(grids: readonly SlopeGrid[]): string | null {
  if (!grids.length) return null;
  const desc = grids.map((g) => `${g.product}|${g.res}|${g.c0}|${g.r0}|${g.w}|${g.h}`).sort().join(';');
  return `ldrm-${crypto.createHash('sha256').update(desc).digest('hex').slice(0, 12)}`;
}

function scan(dir: string | null): Store {
  const folder = dir ? path.join(dir, 'cache', LDRM_SUBDIR) : null;
  const grids: SlopeGrid[] = [];
  if (folder && fs.existsSync(folder)) {
    for (const f of fs.readdirSync(folder).filter((n) => n.endsWith('.json')).sort()) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')) as SlopeGridMeta;
        const bin = path.join(folder, f.replace(/\.json$/, '.f32'));
        if (!LDRM_PRODUCTS[m.baselineM] || !Number.isFinite(m.res) || !fs.existsSync(bin) || fs.statSync(bin).size !== m.w * m.h * 4) continue;
        grids.push({ name: f.replace(/\.json$/, ''), product: m.product, baselineM: m.baselineM, res: m.res, X0: m.X0, Y0: m.Y0, c0: m.c0, r0: m.r0, w: m.w, h: m.h, bin });
      } catch { /* unreadable metadata: that window is skipped */ }
    }
  }
  // Largest windows first (the whole cap before a small window): the value is the same, only fewer misses.
  grids.sort((p, q) => q.w * q.h - p.w * p.h || (p.name < q.name ? -1 : 1));
  return { grids, version: versionOf(grids) };
}

const getStore = (): Store => (store ??= scan(defaultTerrainDir()));

/** Replaces the store: {dir} to read another terrain folder, {grids} for in-memory windows (tests), nothing = default. */
export function configureLdrm({ dir, grids }: { dir?: string | null; grids?: readonly SlopeGrid[] } = {}): string | null {
  for (const fd of fds.values()) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  fds.clear();
  store = grids ? { grids: [...grids], version: versionOf(grids) } : scan(dir === undefined ? defaultTerrainDir() : dir);
  return store.version;
}

/** Identifier of the cached LDRM set (null = none). */
export const ldrmVersion = (): string | null => getStore().version;
/** Cached LDRM windows (without data). */
export const listLdrm = (): Omit<SlopeGrid, 'a' | 'bin' | 'X0' | 'Y0'>[] => getStore().grids.map(({ name, product, baselineM, res, c0, r0, w, h }) => ({ name, product, baselineM, res, c0, r0, w, h }));

function read(g: SlopeGrid, k: number): number {
  if (g.a) return g.a[k];
  let fd = fds.get(g.bin!);
  if (fd === undefined) { fd = fs.openSync(g.bin!, 'r'); fds.set(g.bin!, fd); }
  return fs.readSync(fd, cell, 0, 4, k * 4) === 4 ? cell.readFloatLE(0) : NaN;
}

/**
 * PGDA slope (degrees) over `baselineM` at the projected point (x, y), or null when that baseline has no LDRM product or
 * no cached window contains the point with data.
 */
export function ldrmSlopeAt(x: number, y: number, baselineM: number): { slopeDeg: number; grid: SlopeGrid } | null {
  if (!LDRM_PRODUCTS[baselineM]) return null;
  for (const g of getStore().grids) {
    if (g.baselineM !== baselineM) continue;
    const i = Math.floor((x - g.X0) / g.res) - g.c0, j = Math.floor((g.Y0 - y) / g.res) - g.r0;
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
    const v = read(g, j * g.w + i);
    if (Number.isFinite(v)) return { slopeDeg: v, grid: g };
  }
  return null;
}
