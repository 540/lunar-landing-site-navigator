// Loads the relief of a region (viewpoint/data/<id>/): meta.json and the binary of heights. Shared by the tour and the
// mission viewer (mission.js).
import { validateMeta, decodeHeights, decodeGrid, detailLevels, isGzipped } from './core/relief.js';
import { validateFar, decodeFarHeights } from './core/far-relief.js';
import { decodeMaskGrid } from './core/mask-grid.js';

// `root` is where the data folder lives relative to the page: the role-playing game's cabin (J12.1) reads it from
// ../viewpoint/data/.
export const regionUrl = (id, root = 'data/') => `${root}${id}/`;

const gunzip = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());

/**
 * The finer grids around the centre (`meta.detail`, #97), decoded and in order. They are an extra: one that cannot be loaded
 * or decoded is null, and the scene draws the region with the ones before it.
 */
async function loadDetail(base, meta) {
  let levels;
  try {
    levels = detailLevels(meta);
  } catch (err) {
    console.warn(`Relieve de detalle no disponible: ${err.message}`);
    return [];
  }
  return Promise.all(levels.map(async level => {
    try {
      const res = await fetch(`${base}${level.heights.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return decodeGrid(level, isGzipped(level) ? await gunzip(bytes) : bytes);
    } catch (err) {
      console.warn(`Relieve de detalle no disponible (${level.heights.file}): ${err.message}`);
      return null;
    }
  }));
}

/** meta.json of a region, validated (the selector reads the names from it). */
export async function loadRegionMeta(id, root = 'data/') {
  const metaRes = await fetch(`${regionUrl(id, root)}meta.json`);
  if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
  return validateMeta(await metaRes.json());
}

/** The relief of a region. `knownMeta` (already loaded and validated) saves downloading meta.json again. */
export async function loadRegion(id, knownMeta = null, root = 'data/') {
  const base = regionUrl(id, root);
  const meta = knownMeta ?? await loadRegionMeta(id, root);
  const binRes = await fetch(`${base}${meta.heights.file}`);
  if (!binRes.ok) throw new Error(`HTTP ${binRes.status}`);
  const heights = decodeHeights(meta, new Uint8Array(await binRes.arrayBuffer()));
  // Far ring (E9.2): optional. Without `far` (procedural files) the scene is the fine zone alone.
  let far = null;
  // If the ring cannot be loaded or decoded the scene falls back to the fine zone alone instead of failing.
  try {
    if (validateFar(meta).far) {
      const farRes = await fetch(`${base}${meta.far.file}`);
      if (!farRes.ok) throw new Error(`HTTP ${farRes.status}`);
      far = decodeFarHeights(meta, new Uint8Array(await farRes.arrayBuffer()));
    }
  } catch (err) {
    console.warn(`Relieve lejano no disponible, se usa solo la zona fina: ${err.message}`);
    far = null;
  }
  return { meta, heights, far, detail: await loadDetail(base, meta) };
}

export async function loadSeries(id, year = 2027) {
  const res = await fetch(`${regionUrl(id)}series-${year}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * The grid of horizon masks around the site (E2.0, `meta.maskGrid`), decoded. It is an extra that nothing draws yet and is
 * fetched AFTER the first scene, so it never delays it: null when the region has none or it cannot be loaded or decoded.
 */
export async function loadMaskGrid(id, meta) {
  if (!meta?.maskGrid) return null;
  try {
    const res = await fetch(`${regionUrl(id)}${meta.maskGrid.file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return decodeMaskGrid(meta, new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    console.warn(`Rejilla de máscaras no disponible: ${err.message}`);
    return null;
  }
}

/**
 * The catalogue horizon mask of a region (E1.1, `mask.json`, copied by pipeline/horizon-mask.mjs), for the horizon ring.
 * null when the region has none or it cannot be loaded: then there is no ring and the panel says so.
 */
export async function loadMask(id) {
  try {
    const res = await fetch(`${regionUrl(id)}mask.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mask = await res.json();
    if (!Array.isArray(mask.el) || mask.el.length * mask.stepDeg !== 360) throw new Error('mask.json no cubre 360°');
    return mask;
  } catch (err) {
    console.warn(`Máscara de horizonte no disponible: ${err.message}`);
    return null;
  }
}

/**
 * Preloads the files of a region (meta.json, relief, far ring and detail grids) so they wait in the browser cache when the
 * page navigates (E7.2, #497). `onProgress` receives a list of `{ loaded, total, done }`, one per file known so far
 * (`total` 0 when the server does not say). Rejects on the first error or when `signal` aborts: the caller navigates anyway.
 */
export async function preloadRegion(id, onProgress = () => {}, signal) {
  const base = regionUrl(id);
  const files = [];
  const report = () => onProgress(files.map(f => ({ ...f })));
  const read = (file, optional = false) => {
    const entry = { loaded: 0, total: 0, done: false };
    files.push(entry);
    return fetchInto(file, entry).catch(err => {
      if (!optional || signal?.aborted) throw err;
      entry.done = true; // a missing extra counts as finished
      report();
    });
  };
  const fetchInto = async (file, entry) => {
    const res = await fetch(`${base}${file}`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entry.total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        entry.loaded += value.length;
        report();
      }
    } else {
      await res.arrayBuffer();
    }
    entry.done = true;
    report();
  };
  const metaRes = await fetch(`${base}meta.json`, { signal });
  if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
  const meta = validateMeta(await metaRes.json());
  const names = [meta.heights.file];
  if (validateFar(meta).far) names.push(meta.far.file);
  const detailNames = [];
  try { for (const level of detailLevels(meta)) detailNames.push(level.heights.file); } catch { /* detail is an extra */ }
  // Detail is an extra, as in loadRegion: a missing grid counts as finished and does not fail the preload (abort still rejects).
  // An entry only knows its size when its headers arrive: until then the bar goes by finished files, then by bytes (never back).
  await Promise.all([...names.map(f => read(f)), ...detailNames.map(f => read(f, true))]);
}
