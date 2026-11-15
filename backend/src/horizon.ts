// Local horizon: terrain masks (LOLA) or, if there are none, a spherical horizon (0°).
//
// A mask is the horizon elevation as a function of azimuth, sampled at a uniform step
// (e.g. 360 or 720 values, azimuth 0 = north, clockwise). It is interpolated linearly.
//
// Three sources:
//  1. registerMask(id, mask): explicit in-memory registration.
//  2. Catalogue: backend/terrain/masks/<id>.json, precomputed by scripts/build-masks.ts. Loaded at startup and
//     used by snapshot/series/windows/compare through getMask(id).
//  3. maskFor(lat, lon, observerHeight, resolution): computed on demand from the DEM cache, with an in-memory LRU
//     cache and an on-disk cache (terrain/maskCache.ts). Used by searches and evals when `terrain` is enabled.
// Without DEM or masks everything works as before: horizon at 0°.
// chooseMask(site, {terrain}) picks the mask explicitly (public API v1): without `terrain`, never the catalogue.
//
// Panel and antenna heights: the Sun (energy, night, battery) is seen from the solar panel and the Earth (direct
// communication) from the antenna, which may stand at different heights (e.g. panels on the deck at ~2–4 m, a VSAT
// mast at 5–10 m). Each height has its own mask: chooseMasks / terrainHeights give one per body. Both heights default
// to `observerHeightM`; when they match, a single mask (the same object) serves both bodies.
//
// Hybrid horizon (refinedMask): the mask is always used and, when a body is close to it (|margin| < X, 0.1° by default
// in precise mode), the horizon elevation is recomputed with a direct ray at the body's exact azimuth (same layers and
// march as the mask, terrain/horizonMask.ts). Only for masks with the DEM behind them; rays are cached per mask (site,
// height, resolution) and azimuth rounded to 1e-4°. Measured (2027, 1 h step): in precise mode every decision change
// between the interpolated mask and the ray happened with |margin| < 0.04°, so X = 0.1° removes them all. In fast mode
// the error of the march itself dominates (up to 0.5°), so the hybrid is off by default there.
import fs from 'node:fs';
import path from 'node:path';
import { defaultTerrainDir, demVersion, layersFor, RESOLUTIONS } from './terrain/dem.ts';
import { buildMask, rayForMask } from './terrain/horizonMask.ts';
import { SITES } from './sites.ts';
import { configureMaskCache, maskCacheConfig, maskCacheDefaults, maskFile, obtainMask, persistsHeight } from './terrain/maskCache.ts';
import type { MaskCacheConfig, MaskRecord } from './terrain/maskCache.ts';
import type { ChosenMask, ChosenMasks, DemMask, HorizonInfo, HorizonMask, HorizonRefine, Resolution, Site, Terrain, TerrainCounters, TerrainOption, TerrainStatus } from './types.ts';

/** @typedef {{ stepDeg: number, el: ArrayLike<number>, source: string, observerHeightM?: number, heightM?: number, demVersion?: string }} HorizonMask */

/** @type {Map<string, HorizonMask>} */
const masks: Map<string, HorizonMask> = new Map(); // registered by hand
/** @type {Map<string, HorizonMask>} */
const catalog: Map<string, HorizonMask> = new Map(); // precomputed on disk
let catalogFolder: string | null = null; // folder the catalogue was loaded from (to read other heights on demand)
/** Every mask object read from the catalogue (and its hybrid copies): isCatalogMask tells them from DEM masks. */
const fromCatalog: WeakSet<HorizonMask> = new WeakSet();

export function registerMask(siteId: string, mask: HorizonMask): void {
  if (!Array.isArray(mask.el) || mask.el.length * mask.stepDeg !== 360) {
    throw new Error('La máscara debe cubrir exactamente 360° con paso uniforme');
  }
  masks.set(siteId, mask);
}

/** Mask of a site: the one registered by hand or, failing that, the one from the precomputed catalogue. */
export function getMask(siteId: string): HorizonMask | null {
  return masks.get(siteId) ?? catalog.get(siteId) ?? null;
}

/** Only the hand-registered ones (searches without `terrain` do not use the catalogue: results identical to before). */
export function getRegisteredMask(siteId: string): HorizonMask | null {
  return masks.get(siteId) ?? null;
}

/** Horizon elevation (degrees) at an azimuth. No mask → 0 (sphere). */
export function horizonElevation(mask: HorizonMask | null, azDeg: number): number {
  if (!mask) return 0;
  const n = mask.el.length;
  const x = (((azDeg % 360) + 360) % 360) / mask.stepDeg;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  return mask.el[i] * (1 - f) + mask.el[(i + 1) % n] * f;
}

export function describeMask(mask: HorizonMask | null): HorizonInfo {
  if (!mask) return { type: 'sphere', source: 'Luna esférica, horizonte a 0°' };
  return {
    type: 'mask', source: mask.source, stepDeg: mask.stepDeg,
    ...(mask.observerHeightM !== undefined ? { observerHeightM: mask.observerHeightM } : {}),
    ...(mask.heightM !== undefined ? { heightM: mask.heightM } : {}),
    ...(mask.demVersion ? { demVersion: mask.demVersion } : {}),
  };
}

// ---------- precomputed catalogue ----------
/**
 * Loads terrain/masks/<id>.json (observer at 2 m) or <id>.h<height>.json. Returns how many were loaded.
 * The height is chosen with LUNAR_OBSERVER_HEIGHT_M (default 2).
 */
export function loadCatalogMasks(dir: string | null = defaultTerrainDir(), observerHeightM: number = Number(process.env.LUNAR_OBSERVER_HEIGHT_M) || 2): number {
  catalog.clear(); otherHeights.clear();
  const folder = dir ? path.join(dir, 'masks') : null;
  catalogFolder = folder && fs.existsSync(folder) ? folder : null;
  if (!catalogFolder) return 0;
  const suffix = observerHeightM === 2 ? '.json' : `.h${observerHeightM}.json`;
  for (const f of fs.readdirSync(folder!)) {
    if (!f.endsWith(suffix) || (suffix === '.json' && /\.h\d+(\.\d+)?\.json$/.test(f))) continue;
    try {
      const m: HorizonMask = JSON.parse(fs.readFileSync(path.join(folder!, f), 'utf8'));
      if (Array.isArray(m.el) && m.el.length * m.stepDeg === 360) { catalog.set(f.slice(0, -suffix.length), m); fromCatalog.add(m); }
    } catch { /* unreadable file: that site keeps a spherical horizon */ }
  }
  return catalog.size;
}

/** @type {Map<string, HorizonMask|null>} */
const otherHeights: Map<string, HorizonMask | null> = new Map(); // catalogue masks at another observer height, read on demand

/**
 * Precomputed catalogue mask for a site and an observer height (2 m → <id>.json, h → <id>.h<h>.json).
 * null if there is none. Does not look at hand-registered masks nor compute anything.
 */
export function getCatalogMask(siteId: string, observerHeightM: number = 2): HorizonMask | null {
  const loaded = catalog.get(siteId);
  if (loaded && (loaded.observerHeightM ?? 2) === observerHeightM) return loaded;
  if (!catalogFolder || !/^[a-z0-9-]+$/.test(siteId)) return null;
  const key = `${siteId}|${observerHeightM}`;
  if (!otherHeights.has(key)) {
    let m: HorizonMask | null = null;
    try {
      const f = path.join(catalogFolder, observerHeightM === 2 ? `${siteId}.json` : `${siteId}.h${observerHeightM}.json`);
      const read: HorizonMask = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(read.el) && read.el.length * read.stepDeg === 360 && (read.observerHeightM ?? 2) === observerHeightM) { m = read; fromCatalog.add(m); }
    } catch { /* missing or unreadable: no catalogue mask at that height */ }
    otherHeights.set(key, m);
  }
  return otherHeights.get(key) as HorizonMask | null;
}

/** Was this mask read from the precomputed catalogue (not computed from the DEM)? */
export const isCatalogMask = (mask: HorizonMask | null | undefined): boolean => Boolean(mask) && fromCatalog.has(mask!);

/** Catalogue site at these coordinates (compared at 1e-5°, the rounding of maskFor), or null. */
export function catalogSiteAt(lat: number, lon: number): Site | null {
  const latE5 = Math.round(lat * 1e5), lonE5 = Math.round(lon * 1e5);
  return SITES.find((s) => Math.round(s.lat * 1e5) === latE5 && Math.round(s.lon * 1e5) === lonE5) ?? null;
}

/**
 * Catalogue mask of a point at an observer height: the one of its catalogue site (by id) or, for a custom point or a
 * grid cell, the one of the catalogue site at the same coordinates. null if there is none at that height.
 */
export function catalogMaskFor(site: Pick<Site, 'lat' | 'lon' | 'custom'> & { id?: string }, observerHeightM: number = 2): HorizonMask | null {
  const id = site.id && !site.custom ? site.id : catalogSiteAt(site.lat, site.lon)?.id;
  return id ? getCatalogMask(id, observerHeightM) : null;
}

let catalogListing: { folder: string; byId: Map<string, number[]> } | null = null;
/** Observer heights (m) with a precomputed catalogue mask for a site (<id>.json = 2 m, <id>.h<h>.json = h), ascending. */
export function catalogMaskHeights(siteId: string): number[] {
  if (!catalogFolder) return [];
  if (!catalogListing || catalogListing.folder !== catalogFolder) {
    const byId = new Map<string, number[]>();
    for (const f of fs.readdirSync(catalogFolder)) {
      const m = /^([a-z0-9-]+?)(?:\.h(\d+(?:\.\d+)?))?\.json$/.exec(f);
      if (!m) continue;
      const list = byId.get(m[1]) ?? [];
      list.push(m[2] === undefined ? 2 : Number(m[2]));
      byId.set(m[1], list);
    }
    for (const list of byId.values()) list.sort((a, b) => a - b);
    catalogListing = { folder: catalogFolder, byId };
  }
  return catalogListing.byId.get(siteId) ?? [];
}

/**
 * EXPLICIT choice of a site's mask (used by public API v1, which must not change unless asked to):
 *  - without terrain: only hand-registered masks, never the catalogue → spherical horizon unless explicitly registered;
 *  - with terrain: registered, catalogue at that observer height or, failing that, maskFor (cached DEM) and, without
 *    a DEM there, the catalogue mask of the catalogue site at the same coordinates (since API 1.13.0: the terrain of a
 *    catalogue site does not depend on the route nor on whether it is asked for by id or by coordinates).
 * Returns { mask, source }: source = 'registered' | 'catalog' | 'dem' | null (null = spherical horizon).
 * @param {{id?: string, lat: number, lon: number, custom?: boolean}} site
 * @param {{terrain?: boolean, observerHeightM?: number, resolution?: 'fast'|'precise'}} [opts]
 */
export function chooseMask(
  site: Pick<Site, 'lat' | 'lon' | 'custom'> & { id?: string },
  { terrain = false, observerHeightM = 2, resolution = 'precise', refineDeg = REFINE_DEFAULT_DEG[resolution] }: { terrain?: boolean; observerHeightM?: number; resolution?: Resolution; refineDeg?: number } = {}
): ChosenMask {
  const registered = site.id ? getRegisteredMask(site.id) : null;
  if (registered) return { mask: registered, source: 'registered' };
  if (!terrain) return { mask: null, source: null };
  const fromCatalog = site.id && !site.custom ? getCatalogMask(site.id, observerHeightM) : null;
  if (fromCatalog) return { mask: refinedMask(fromCatalog, refineDeg)!, source: 'catalog' };
  const computed = maskFor(site.lat, site.lon, observerHeightM, resolution);
  if (computed) return { mask: refinedMask(computed, refineDeg)!, source: 'dem' };
  const atCoordinates = catalogMaskFor({ lat: site.lat, lon: site.lon }, observerHeightM);
  return atCoordinates ? { mask: refinedMask(atCoordinates, refineDeg)!, source: 'catalog' } : { mask: null, source: null };
}

/**
 * Masks of a site for the panel (Sun) and the antenna (Earth), chosen as chooseMask does for each height.
 * When both heights are equal the mask is chosen once and shared (no second lookup or computation).
 */
export function chooseMasks(
  site: Pick<Site, 'lat' | 'lon' | 'custom'> & { id?: string },
  { terrain = false, panelHeightM = 2, antennaHeightM = panelHeightM, resolution = 'precise', refineDeg = REFINE_DEFAULT_DEG[resolution] }: { terrain?: boolean; panelHeightM?: number; antennaHeightM?: number; resolution?: Resolution; refineDeg?: number } = {}
): ChosenMasks {
  const sun = chooseMask(site, { terrain, observerHeightM: panelHeightM, resolution, refineDeg });
  return { sun, earth: antennaHeightM === panelHeightM ? sun : chooseMask(site, { terrain, observerHeightM: antennaHeightM, resolution, refineDeg }) };
}

/** Threshold X (°) of the hybrid horizon of a validated `terrain` (0 = off). */
export const terrainRefineDeg = (t: Terrain): number => t.refineDeg ?? REFINE_DEFAULT_DEG[t.resolution];

/** Panel (Sun) and antenna (Earth) heights of a validated `terrain`: both `observerHeightM` unless given apart. */
export function terrainHeights(t: Terrain): { panelHeightM: number; antennaHeightM: number } {
  return { panelHeightM: t.panelHeightM ?? t.observerHeightM, antennaHeightM: t.antennaHeightM ?? t.observerHeightM };
}

// ---------- on-demand masks ----------
// Memory: an LRU of LUNAR_MASK_MEMORY_MAX masks (10 000 by default, ~58 MB in precise mode) per thread.
// Disk: terrain/maskCache.ts (one file per mask, LRU with a size budget, shared by threads and processes).
const lruMax = (): number => {
  const v = Number(process.env.LUNAR_MASK_MEMORY_MAX);
  return Number.isInteger(v) && v > 0 ? v : 10000;
};
let LRU_MAX = lruMax();
/** @type {Map<string, HorizonMask|null>} */
const lru: Map<string, DemMask<Float64Array> | null> = new Map();
const stats: TerrainCounters = { computed: 0, fromDisk: 0, fromMemory: 0, noCoverage: 0, computeMs: 0, rays: 0, rayHits: 0, rayMs: 0 };
let warned = false;
configureMaskCache(maskCacheDefaults(defaultTerrainDir()));

/**
 * The mask object, built the same way whether it was just computed or read from the disk cache (same fields, same
 * order, same `source`): a response does not depend on which thread computed a mask or on what the cache holds.
 */
function assemble(lat: number, lon: number, observerHeightM: number, version: string, resolution: Resolution, rec: MaskRecord, products: readonly string[]): DemMask<Float64Array> {
  return {
    lat, lon,
    heightM: rec.heightM,
    observerHeightM,
    stepDeg: 360 / rec.el.length,
    el: rec.el,
    source: `LOLA ${products.join(' + ')} (${resolution === 'fast' ? 'rápido' : 'preciso'}, observador a ${observerHeightM} m)`,
    demVersion: version,
    resolution,
    coverage: rec.coverage,
  };
}

/**
 * Horizon mask of any point, computed on demand from the cached DEM.
 *  - lat/lon are rounded to 1e-5° (≈ 0.3 m) and the computation is done AT the rounded point: the key identifies the mask.
 *  - Values in hundredths of a degree: what is computed and what is read from disk are bit-identical (deterministic evals).
 *  - Returns null (horizon at 0°) if there is no cached DEM or the point is outside its coverage.
 *  - Concurrent requests of the same mask from several threads compute it once (maskCache.ts obtainMask).
 * @param {number} lat @param {number} lon
 * @param {number} [observerHeightM] observer height above the ground (m)
 * @param {'fast'|'precise'} [resolution]
 */
export function maskFor(lat: number, lon: number, observerHeightM: number = 2, resolution: Resolution = 'precise'): DemMask<Float64Array> | null {
  const version = demVersion();
  if (!version) {
    if (!warned) { warned = true; console.warn('[relieve] No hay DEM en la caché (backend/terrain/cache): se usa horizonte a 0°. Descárgalo con `node scripts/fetch-dem.ts`.'); }
    stats.noCoverage++;
    return null;
  }
  const latE5 = Math.round(lat * 1e5), lonE5 = Math.round(lon * 1e5);
  const key = `${latE5},${lonE5}|${observerHeightM}|${resolution}|${version}`;
  if (lru.has(key)) {
    const m = lru.get(key) as DemMask<Float64Array> | null;
    lru.delete(key); lru.set(key, m); // most recent goes last
    stats.fromMemory++;
    return m;
  }
  const rlat = latE5 / 1e5, rlon = lonE5 / 1e5;
  let m: DemMask<Float64Array> | null = null;
  const sel = layersFor(rlat, rlon, resolution);
  if (sel) {
    const k = { version, resolution, h: observerHeightM, latE5, lonE5, nAz: RESOLUTIONS[resolution].nAz };
    const got = obtainMask(k, () => {
      const t0 = performance.now();
      const b = buildMask(rlat, rlon, { observerHeightM, resolution })!;
      stats.computeMs += performance.now() - t0;
      return { heightM: b.heightM, el: Float64Array.from(b.el), coverage: b.coverage };
    });
    if (got.from === 'disk') stats.fromDisk++; else stats.computed++;
    m = assemble(rlat, rlon, observerHeightM, version, resolution, got.record, sel.products);
  } else stats.noCoverage++;
  lru.set(key, m);
  if (lru.size > LRU_MAX) lru.delete(lru.keys().next().value!);
  return m;
}

/**
 * What getting the mask of a point would cost, without computing anything (only metadata and one stat of the disk cache;
 * for cost estimates, data/src/graphql/limits.ts): 'catalog' (precomputed, or the catalogue fallback without a DEM),
 * 'none' (no mask: spherical horizon), 'disk' (already in the disk cache) or 'cold' (to compute from the DEM).
 * `catalogFirst`: the single-site routes (chooseMask) take the catalogue mask before the DEM; the searches (cellMasks), after.
 */
export function maskState(site: Pick<Site, 'lat' | 'lon' | 'custom'> & { id?: string }, observerHeightM: number, resolution: Resolution, catalogFirst: boolean): 'catalog' | 'none' | 'disk' | 'cold' {
  const catalogMask = catalogMaskFor(site, observerHeightM);
  if (catalogMask && catalogFirst && site.id && !site.custom) return 'catalog';
  const version = demVersion();
  if (!version || !layersFor(site.lat, site.lon, resolution)) return catalogMask ? 'catalog' : 'none';
  const cache = maskCacheConfig();
  if (cache.enabled && cache.dir && persistsHeight(observerHeightM)) {
    const k = { version, resolution, h: observerHeightM, latE5: Math.round(site.lat * 1e5), lonE5: Math.round(site.lon * 1e5), nAz: RESOLUTIONS[resolution].nAz };
    if (fs.existsSync(maskFile(k))) return 'disk';
  }
  return 'cold';
}

// ---------- hybrid horizon: direct ray near the horizon ----------
/**
 * Default threshold X (°) of the hybrid horizon per resolution. Precise: 0.1° (every decision change between the mask and
 * the ray measured over 2027 happened with |margin| < 0.04°). Fast: off, because there the march itself (160/240 m,
 * step growing 1 %·d) is the dominant error and a ray with the same march would not fix it.
 */
export const REFINE_DEFAULT_DEG: Readonly<Record<Resolution, number>> = { precise: 0.1, fast: 0 };
export const REFINE_MAX_DEG = 2;
const RAY_CACHE_MAX = 200000; // rays per mask (a year at 1 h, both bodies, needs ~1 000)

/** Ray state of one DEM mask, shared by every threshold: the ray tracer and its cache (key = azimuth in 1e-4°). */
interface RayState { version: string | null; trace: ((azDeg: number) => number) | null; cache: Map<number, number>; byDeg: Map<number, HorizonMask> }
const rayStates: WeakMap<HorizonMask, RayState> = new WeakMap();

function rayState(mask: HorizonMask): RayState {
  const version = demVersion();
  let st = rayStates.get(mask);
  if (!st || st.version !== version) {
    st = { version, trace: rayForMask(mask as Partial<DemMask>), cache: new Map(), byDeg: new Map() };
    rayStates.set(mask, st);
  }
  return st;
}

/**
 * Mask with the hybrid horizon: the same data plus `refine` = {deg, elevation(az)} (types.ts, HorizonRefine), which
 * visibility.ts uses where the body is within `deg` of the horizon. Returns the mask unchanged (the same object) when
 * refineDeg is 0 or the mask has no DEM behind it (hand-registered masks, catalogue masks without the DEM they came
 * from): then every result is identical to before. The refined mask is cached per mask and threshold (same object).
 * The ray is traced at the azimuth rounded to 1e-4° (≈ 2 mm at 1 km) so the result does not depend on which query came first.
 */
export function refinedMask(mask: HorizonMask | null, refineDeg: number = REFINE_DEFAULT_DEG[((mask as Partial<DemMask> | null)?.resolution) ?? 'precise']): HorizonMask | null {
  if (!mask || !(refineDeg > 0) || mask.refine) return mask;
  const st = rayState(mask);
  if (!st.trace) return mask;
  let out = st.byDeg.get(refineDeg);
  if (!out) {
    const trace = st.trace, cache = st.cache;
    const elevation = (azDeg: number): number => {
      const k = Math.round((((azDeg % 360) + 360) % 360) * 1e4) % 3600000;
      const hit = cache.get(k);
      if (hit !== undefined) { stats.rayHits++; return hit; }
      const t0 = performance.now();
      const el = trace(k / 1e4);
      stats.rayMs += performance.now() - t0; stats.rays++;
      if (cache.size >= RAY_CACHE_MAX) cache.clear();
      cache.set(k, el);
      return el;
    };
    const refine: HorizonRefine = { deg: refineDeg, elevation };
    out = { ...mask, refine };
    if (fromCatalog.has(mask)) fromCatalog.add(out);
    st.byDeg.set(refineDeg, out);
  }
  return out;
}

/** The hybrid horizon in words, for the notes of the responses: «máscara de 720 acimuts + rayo directo a menos de 0,1°». */
export function refineText(t: Terrain): string {
  const deg = terrainRefineDeg(t);
  const nAz = RESOLUTIONS[t.resolution].nAz;
  return deg > 0
    ? `horizonte híbrido: máscara de ${nAz} acimuts y rayo directo en el acimut exacto cuando el margen es menor que ${String(deg).replace('.', ',')}°`
    : `máscara de ${nAz} acimuts interpolada, sin rayo directo`;
}

/** Latitude (°) at or south of which the fast mode gets the polar warning (also wherever a 20 m window exists). */
export const FAST_WARNING_LAT = -85;

/**
 * Warning of the fast mode near the pole, or null. Fast mode (160/240 m, step growing 1 %·d, no 20 m layer) is a
 * screening tool: measured over 2027 against a fine reference, at shackleton-rim it flips the Sun's visibility in 406
 * hours and the longest night goes from 111 h to 274 h. It applies when the terrain is fast, there is a DEM and some point
 * is at or south of FAST_WARNING_LAT or has a 20 m window (where precise mode would use it). `how` says how to ask for
 * precise mode in that context.
 */
export function fastModeWarning(t: Terrain | null | undefined, points: readonly { lat: number; lon: number }[], how: string = 'terrainResolution=precise'): string | null {
  if (!t || t.resolution !== 'fast' || !t.demVersion) return null;
  const polar = points.some((p) => p.lat <= FAST_WARNING_LAT || (layersFor(p.lat, p.lon, 'precise')?.layers[0]?.g.res ?? Infinity) <= 80);
  if (!polar) return null;
  return 'AVISO: relieve en modo rápido cerca del polo, válido solo para cribar. Frente a la referencia fina, en shackleton-rim '
    + 'cambia la visibilidad del Sol en 406 horas de 2027 y la noche más larga pasa de 111 h a 274 h. '
    + `Confirma los finalistas en modo preciso (${how}).`;
}

/** Validates the hybrid-horizon threshold (0 = off). */
export function checkRefineDeg(x: unknown, name: string = 'terrain.refineDeg'): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > REFINE_MAX_DEG) throw new Error(`${name} debe ser un número entre 0 y ${REFINE_MAX_DEG} (grados; 0 lo desactiva)`);
  return x;
}

/** Terrain status: what is available and how much has been computed in this process. */
export function terrainStatus(): TerrainStatus {
  return { demVersion: demVersion(), catalogMasks: [...catalog.keys()], ...stats, rayMs: Math.round(stats.rayMs * 10) / 10, msPerMask: stats.computed ? Math.round((stats.computeMs / stats.computed) * 10) / 10 : null };
}

/**
 * Settings for on-demand masks (tests): {diskCache: false} disables the disk; {dir} uses <dir>/cache/masks (a terrain
 * folder) and {cacheDir} that folder itself; {memoryMax} the size of the memory LRU; the rest goes to the disk cache
 * (maskCache.ts). Clears the memory cache and the counters (not the disk).
 */
export function configureMasks({ diskCache, dir, cacheDir, memoryMax, ...disk }: { diskCache?: boolean; dir?: string | null; cacheDir?: string | null; memoryMax?: number } & Partial<Omit<MaskCacheConfig, 'dir' | 'enabled'>> = {}): void {
  configureMaskCache({
    ...disk,
    ...(diskCache !== undefined ? { enabled: diskCache } : {}),
    ...(dir !== undefined ? { dir: dir === null ? null : path.join(dir, 'cache', 'masks') } : {}),
    ...(cacheDir !== undefined ? { dir: cacheDir } : {}),
  });
  if (memoryMax !== undefined) LRU_MAX = memoryMax;
  lru.clear(); warned = false;
  for (const k of Object.keys(stats) as (keyof TerrainCounters)[]) stats[k] = 0;
}

/** Normalizes the `terrain` option of searches and scenarios. null = no terrain. */
/** Validates a height of the `terrain` option (0–100 m). */
function checkHeight(x: unknown, name: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 100) throw new Error(`terrain.${name} debe estar entre 0 y 100 m`);
  return x;
}

/**
 * Normalizes the `terrain` option of searches and scenarios. null = no terrain.
 * `panelHeightM` (Sun) and `antennaHeightM` (Earth) default to `observerHeightM`. They are kept, both, only when at least
 * one differs from it: with them absent or equal the result is the same object as before they existed (same scenarioHash).
 */
export function resolveTerrain(t: TerrainOption | null | undefined, defaultResolution: Resolution = 'fast'): Terrain | null {
  if (!t || !t.enabled) return null;
  const observerHeightM = checkHeight(t.observerHeightM ?? 2, 'observerHeightM');
  const panelHeightM = checkHeight(t.panelHeightM ?? observerHeightM, 'panelHeightM');
  const antennaHeightM = checkHeight(t.antennaHeightM ?? observerHeightM, 'antennaHeightM');
  const resolution = t.resolution as Resolution | undefined ?? defaultResolution;
  if (!RESOLUTIONS[resolution]) throw new Error(`terrain.resolution debe ser una de: ${Object.keys(RESOLUTIONS).join(', ')}`);
  const split = panelHeightM !== observerHeightM || antennaHeightM !== observerHeightM;
  // Hybrid horizon: refine false → 0; refineDeg overrides; refine true in fast mode → the precise default. Stored only
  // when it differs from the default of the resolution, so scenarioHash of the existing scenarios does not change (the
  // codeHash already tells runs before and after the hybrid apart).
  if (t.refine !== undefined && typeof t.refine !== 'boolean') throw new Error('terrain.refine debe ser true o false');
  const refineDeg = t.refine === false ? 0
    : t.refineDeg !== undefined ? checkRefineDeg(t.refineDeg)
      : t.refine === true ? REFINE_DEFAULT_DEG[resolution] || REFINE_DEFAULT_DEG.precise : REFINE_DEFAULT_DEG[resolution];
  return {
    enabled: true, observerHeightM, ...(split ? { panelHeightM, antennaHeightM } : {}), resolution, demVersion: demVersion(),
    ...(refineDeg !== REFINE_DEFAULT_DEG[resolution] ? { refineDeg } : {}),
  };
}

loadCatalogMasks();
