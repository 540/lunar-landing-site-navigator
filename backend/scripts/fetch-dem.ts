#!/usr/bin/env node
// ONE-OFF download of the LOLA DEMs into the local cache backend/terrain/cache/ (outside git). The backend never downloads
// anything at runtime: it only reads this cache.
//
//   node scripts/fetch-dem.ts                      # base: 160 m for the whole 80S cap (~38 MB) + 240 m down to 60S (~170 MB)
//   node scripts/fetch-dem.ts --near -84.79,29.2   # 20 m window (+-16 km) around a point (only >= 80 S), ~10-20 MB
//   node scripts/fetch-dem.ts --catalog            # 20 m windows for the catalog sites inside 80S
//   node scripts/fetch-dem.ts --import <folder>    # imports already downloaded .json+.f32 grids (same format)
//   node scripts/fetch-dem.ts --list               # what is in the cache
//   options: --half-km 16   --dir <terrain folder>
//
// Official PGDA slope (LDRM, slope.ts uses it for baselines of 100/400/800 m), OPTIONAL, in cache/ldrm/:
//   node scripts/fetch-dem.ts --slope                     # windows: every cached 20 m window + catalog sites in 80S (~2 MB each)
//   node scripts/fetch-dem.ts --slope-near -84.79,29.2    # one window (+-16 km) around a point (only >= 80 S)
//   node scripts/fetch-dem.ts --slope-cap                 # the whole 80S cap at 50 m: 591 MB per baseline, ~15-25 min each
//   options: --baselines 100,400,800 (default: all three for windows, 100 for --slope-cap)
// LDRM files are COGs (512 px tiles, deflate, Float32); the overviews are averaged slopes, not slopes over a longer
// baseline, so only level 0 is read. The whole cap is read in strips and can be resumed (<name>.f32.part + .progress).
//
// PGDA rate-limits (403 on parallel requests, ~0.4-0.9 MB/s) and has no CORS: that is why reads are
// SEQUENTIAL (one HTTP request at a time), ranged (COG), with retries and growing backoff. Already downloaded data is skipped.
// geotiff.js is a devDependency: only this script uses it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, llToXY, covers } from '../src/terrain/dem.ts';
import { LDRM_GEOMETRY, LDRM_PRODUCTS, LDRM_SUBDIR } from '../src/terrain/ldrm.ts';
import { SITES } from '../src/sites.ts';
import type { GeoTIFF, RemoteSourceOptions } from 'geotiff';
import type { GridMeta } from '../src/types.ts';
import type { SlopeGridMeta } from '../src/terrain/ldrm.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function opt(name: string): string | undefined;
function opt<F>(name: string, fallback: F): string | F;
function opt(name: string, fallback?: unknown): unknown { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; }
const has = (name: string): boolean => args.includes(name);
const TERRAIN = path.resolve(opt('--dir', path.join(HERE, '..', 'terrain')));
const CACHE = path.join(TERRAIN, 'cache');
fs.mkdirSync(CACHE, { recursive: true });

// ---------- network: one request at a time, with retries ----------
const stats = { requests: 0, bytes: 0, retries: 0 };
const rawFetch = globalThis.fetch;
let chain: Promise<unknown> = Promise.resolve();
globalThis.fetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const run = async (): Promise<Response> => {
    for (let i = 0; ; i++) {
      try {
        const r = await rawFetch(url, init);
        if (r.ok) {
          const body = await r.arrayBuffer();
          stats.requests++; stats.bytes += body.byteLength;
          return new Response(body, { status: r.status, headers: r.headers });
        }
        if (i >= 10) return r;
        process.stderr.write(`  reintento ${i + 1} (HTTP ${r.status})\n`);
      } catch (e) {
        if (i >= 10) throw e;
        const err = e as Error & { cause?: { code?: string } };
        process.stderr.write(`  reintento ${i + 1} (${err.cause?.code ?? err.message})\n`);
      }
      stats.retries++;
      await new Promise((ok) => setTimeout(ok, 4000 * (i + 1)));
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
};

const existing = (): (GridMeta & { name: string })[] => fs.readdirSync(CACHE).filter((f) => f.endsWith('.json') && !f.endsWith('.progress.json'))
  .map((f) => ({ name: f.slice(0, -5), ...(JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')) as GridMeta) }));

function save(name: string, meta: GridMeta, data: ArrayBufferView): void {
  // binary first and the .json last: a half-written grid is never taken as valid
  fs.writeFileSync(path.join(CACHE, `${name}.f32`), Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  fs.writeFileSync(path.join(CACHE, `${name}.json`), JSON.stringify(meta));
}

const tiffs: Record<string, GeoTIFF> = {};
/** Downloads the window [xmin,xmax]x[ymin,ymax] (m) from the product level at `res` m/px. */
async function fetchWindow(product: string, res: number, xmin: number, xmax: number, ymin: number, ymax: number): Promise<string> {
  const P = PRODUCTS[product];
  const level = Math.round(Math.log2(res / P.baseRes));
  if (P.baseRes * 2 ** level !== res) throw new Error(`${product} no tiene nivel de ${res} m`);
  const n = P.sizeM / res;
  const c0 = Math.max(0, Math.floor((xmin - P.X0) / res)), c1 = Math.min(n, Math.ceil((xmax - P.X0) / res));
  const r0 = Math.max(0, Math.floor((P.Y0 - ymax) / res)), r1 = Math.min(n, Math.ceil((P.Y0 - ymin) / res));
  const name = `${product}_${res}m_c${c0}_r${r0}_${c1 - c0}x${r1 - r0}`;
  if (fs.existsSync(path.join(CACHE, `${name}.json`))) { console.log(`✔ ${name}: ya está en la caché`); return name; }
  const { fromUrl } = await import('geotiff');
  // geotiff's remote source reads blockSize and cacheSize (source/remote.js), but its RemoteSourceOptions type lacks them.
  const sourceOptions: RemoteSourceOptions & { blockSize: number; cacheSize: number } = { blockSize: 1024 * 1024, cacheSize: 32 };

  tiffs[product] ??= await fromUrl(P.url, sourceOptions);
  const image = await tiffs[product].getImage(level);
  if (image.getWidth() !== n) throw new Error(`${product}: el nivel ${level} mide ${image.getWidth()} px, se esperaban ${n}`);
  const t0 = Date.now(), b0 = stats.bytes;
  process.stdout.write(`… ${name}: descargando ${c1 - c0}×${r1 - r0} px\n`);
  const [a] = await image.readRasters({ window: [c0, r0, c1, r1] });
  save(name, { product, url: P.url, level, res, X0: P.X0, Y0: P.Y0, c0, r0, w: c1 - c0, h: r1 - r0, fetchedAt: new Date().toISOString() }, a);
  console.log(`✔ ${name}: ${((stats.bytes - b0) / 1e6).toFixed(1)} MB en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return name;
}

async function near(lat: number, lon: number, halfKm: number): Promise<void> {
  const [x, y] = llToXY(lat, lon);
  const P = PRODUCTS.LDEM_80S_20MPP_ADJ, half = halfKm * 1000;
  if (Math.abs(x) > -P.X0 || Math.abs(y) > P.Y0) { console.log(`· (${lat}, ${lon}) queda fuera del producto de 20 m (80°S): se usará 240 m`); return; }
  const done = existing().find((g) => g.res <= 80 && covers(g, x, y, Math.min(10000, half * 0.6)));
  if (done) { console.log(`✔ (${lat}, ${lon}): ya cubierto a ${done.res} m por ${done.name}`); return; }
  await fetchWindow('LDEM_80S_20MPP_ADJ', 20, x - half, x + half, y - half, y + half);
}

function importDir(dir: string): void {
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as GridMeta;
    const bin = path.join(dir, f.replace(/\.json$/, '.f32'));
    if (!Number.isFinite(m.res) || !fs.existsSync(bin) || fs.statSync(bin).size !== m.w * m.h * 4) { console.log(`· ${f}: no es una rejilla, se salta`); continue; }
    const product = m.product ?? ((m.X0 ?? -304000) === -304000 ? 'LDEM_80S_20MPP_ADJ' : 'LDEM_60S_240MPP_ADJ');
    const P = PRODUCTS[product];
    const name = `${product}_${m.res}m_c${m.c0}_r${m.r0}_${m.w}x${m.h}`;
    if (fs.existsSync(path.join(CACHE, `${name}.json`))) { console.log(`✔ ${name}: ya está en la caché`); continue; }
    fs.copyFileSync(bin, path.join(CACHE, `${name}.f32`));
    fs.writeFileSync(path.join(CACHE, `${name}.json`), JSON.stringify({ product, url: P.url, level: Math.round(Math.log2(m.res / P.baseRes)), res: m.res, X0: P.X0, Y0: P.Y0, c0: m.c0, r0: m.r0, w: m.w, h: m.h, importedFrom: path.join(dir, f) }));
    console.log(`✔ ${name}: importada de ${f}`);
  }
}

// ---------- PGDA slope (LDRM) ----------
const SLOPE_CACHE = path.join(CACHE, LDRM_SUBDIR);
const existingSlope = (): (SlopeGridMeta & { name: string })[] => (fs.existsSync(SLOPE_CACHE) ? fs.readdirSync(SLOPE_CACHE) : [])
  .filter((f) => f.endsWith('.json') && !f.endsWith('.progress.json'))
  .map((f) => ({ name: f.slice(0, -5), ...(JSON.parse(fs.readFileSync(path.join(SLOPE_CACHE, f), 'utf8')) as SlopeGridMeta) }));
const baselines = (fallback: string): number[] => {
  const list = String(opt('--baselines', fallback)).split(',').map(Number);
  for (const b of list) if (!LDRM_PRODUCTS[b]) throw new Error(`--baselines: ${b} no es una base de LDRM (100, 400 u 800)`);
  return list;
};

/** Downloads the window [xmin,xmax]x[ymin,ymax] (m) of the LDRM product of `baselineM`, level 0, in strips of tile rows. */
async function fetchSlopeWindow(baselineM: number, xmin: number, xmax: number, ymin: number, ymax: number): Promise<string | null> {
  const P = LDRM_PRODUCTS[baselineM], G = LDRM_GEOMETRY;
  const c0 = Math.max(0, Math.floor((xmin - G.X0) / G.res)), c1 = Math.min(G.size, Math.ceil((xmax - G.X0) / G.res));
  const r0 = Math.max(0, Math.floor((G.Y0 - ymax) / G.res)), r1 = Math.min(G.size, Math.ceil((G.Y0 - ymin) / G.res));
  if (c1 <= c0 || r1 <= r0) return null;
  const w = c1 - c0, h = r1 - r0, name = `${P.product}_c${c0}_r${r0}_${w}x${h}`;
  const inside = existingSlope().find((g) => g.baselineM === baselineM && g.c0 <= c0 && g.r0 <= r0 && g.c0 + g.w >= c1 && g.r0 + g.h >= r1);
  if (inside) { console.log(`✔ ${name}: ya cubierto por ${inside.name}`); return inside.name; }
  fs.mkdirSync(SLOPE_CACHE, { recursive: true });
  const bin = path.join(SLOPE_CACHE, `${name}.f32`), part = `${bin}.part`, progress = path.join(SLOPE_CACHE, `${name}.progress.json`);
  let row = r0;
  if (fs.existsSync(part) && fs.existsSync(progress) && fs.statSync(part).size === w * h * 4) row = (JSON.parse(fs.readFileSync(progress, 'utf8')) as { row: number }).row;
  else { fs.writeFileSync(part, ''); fs.truncateSync(part, w * h * 4); }
  const { fromUrl } = await import('geotiff');
  const sourceOptions: RemoteSourceOptions & { blockSize: number; cacheSize: number } = { blockSize: 1024 * 1024, cacheSize: 32 };
  tiffs[P.product] ??= await fromUrl(P.url, sourceOptions);
  const image = await tiffs[P.product].getImage(0);
  if (image.getWidth() !== G.size) throw new Error(`${P.product}: mide ${image.getWidth()} px, se esperaban ${G.size}`);
  const tileH = image.getTileHeight() || 512;
  const t0 = Date.now(), b0 = stats.bytes;
  process.stdout.write(`… ${name}: descargando ${w}×${h} px${row > r0 ? ` (desde la fila ${row - r0})` : ''}\n`);
  const fd = fs.openSync(part, 'r+');
  try {
    while (row < r1) {
      const next = Math.min(r1, (Math.floor(row / tileH) + 1) * tileH); // one row of tiles at a time
      const [a] = await image.readRasters({ window: [c0, row, c1, next] });
      const data = a as Float32Array;
      fs.writeSync(fd, Buffer.from(data.buffer, data.byteOffset, data.byteLength), 0, data.byteLength, (row - r0) * w * 4);
      row = next;
      fs.writeFileSync(progress, JSON.stringify({ row }));
      if (h > 4 * tileH) process.stdout.write(`  ${((100 * (row - r0)) / h).toFixed(0)} % (${((stats.bytes - b0) / 1e6).toFixed(0)} MB)\n`);
    }
  } finally { fs.closeSync(fd); }
  fs.renameSync(part, bin);
  const meta: SlopeGridMeta = { product: P.product, baselineM, url: P.url, res: G.res, X0: G.X0, Y0: G.Y0, c0, r0, w, h, fetchedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(SLOPE_CACHE, `${name}.json`), JSON.stringify(meta)); // the .json last: a half-written window is never valid
  fs.rmSync(progress, { force: true });
  console.log(`✔ ${name}: ${((stats.bytes - b0) / 1e6).toFixed(1)} MB en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return name;
}

/** LDRM windows (+-halfKm) around a point, for the given baselines. */
async function slopeNear(lat: number, lon: number, halfKm: number, list: readonly number[]): Promise<void> {
  const [x, y] = llToXY(lat, lon), G = LDRM_GEOMETRY, half = halfKm * 1000;
  if (Math.abs(x) > -G.X0 || Math.abs(y) > G.Y0) { console.log(`· (${lat}, ${lon}) queda fuera de LDRM (80°S): sin pendiente de PGDA`); return; }
  for (const b of list) await fetchSlopeWindow(b, x - half, x + half, y - half, y + half);
}

/** LDRM windows matching every cached 20 m DEM window, plus the catalog sites inside 80S. */
async function slopeWindows(list: readonly number[], halfKm: number): Promise<void> {
  for (const g of existing().filter((q) => q.res <= 20)) {
    for (const b of list) await fetchSlopeWindow(b, g.X0 + g.c0 * g.res, g.X0 + (g.c0 + g.w) * g.res, g.Y0 - (g.r0 + g.h) * g.res, g.Y0 - g.r0 * g.res);
  }
  for (const s of SITES.filter((p) => p.lat <= -79.9)) await slopeNear(s.lat, s.lon, halfKm, list);
}

try {
  if (has('--list')) {
    for (const g of existing()) console.log(`${g.name}  ${g.res} m  ${g.w}×${g.h}  ${(g.w * g.h * 4 / 1e6).toFixed(0)} MB`);
    for (const g of existingSlope()) console.log(`${LDRM_SUBDIR}/${g.name}  pendiente ${g.baselineM} m  ${g.res} m  ${g.w}×${g.h}  ${(g.w * g.h * 4 / 1e6).toFixed(0)} MB`);
  } else if (has('--slope')) {
    await slopeWindows(baselines('100,400,800'), Number(opt('--half-km', 16)));
  } else if (has('--slope-near')) {
    const [lat, lon] = opt('--slope-near')!.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('--slope-near <lat>,<lon>');
    await slopeNear(lat, lon, Number(opt('--half-km', 16)), baselines('100,400,800'));
  } else if (has('--slope-cap')) {
    const G = LDRM_GEOMETRY;
    for (const b of baselines('100')) await fetchSlopeWindow(b, G.X0, -G.X0, -G.Y0, G.Y0);
  } else if (has('--import')) {
    importDir(path.resolve(opt('--import')!));
  } else if (has('--near')) {
    const [lat, lon] = opt('--near')!.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('--near <lat>,<lon>');
    await near(lat, lon, Number(opt('--half-km', 16)));
  } else if (has('--catalog')) {
    for (const s of SITES.filter((p) => p.lat <= -79.9)) await near(s.lat, s.lon, Number(opt('--half-km', 16)));
  } else {
    const A = PRODUCTS.LDEM_80S_20MPP_ADJ, B = PRODUCTS.LDEM_60S_240MPP_ADJ;
    await fetchWindow('LDEM_80S_20MPP_ADJ', 160, A.X0, -A.X0, -A.Y0, A.Y0);
    await fetchWindow('LDEM_60S_240MPP_ADJ', 240, B.X0, -B.X0, -B.Y0, B.Y0);
  }
  if (stats.requests) console.log(`Red: ${stats.requests} peticiones, ${(stats.bytes / 1e6).toFixed(1)} MB, ${stats.retries} reintentos`);
} catch (e) {
  process.stderr.write(`✖ ${(e as Error).message}\n`);
  process.exit(1);
}
