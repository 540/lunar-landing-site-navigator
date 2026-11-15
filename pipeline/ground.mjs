// Real ground at human scale in the Mirador (E3, #181): a fifth of the step of the finest LOLA grid of the viewer, from
// the 5 m/pixel LOLA DEMs of the south pole landing sites (Barker et al. 2021, NASA GSFC PGDA product 78). Only measured
// data: where no site DEM covers the square around a region, nothing is added and the region stays as it was.
//
// It adds one more level to `meta.detail` (core/relief.js stitches it into the one before, like the others): 2.5 km round
// the site, 513 × 513 nodes, one every 4.88 m (four per cell of the 19.5 m level, so it fits it exactly). It also notes
// what the site DEM says about itself in that square: how many of its pixels have a LOLA shot (the rest are interpolated)
// and its typical height error (the RMS of the product), for the note of sources.
//
// The GeoTIFFs are read over HTTP range requests: only the window around the site, about a megabyte, not the 41 MB file.
// Usage (geotiff is not a dependency of the repo; it is installed only to run this):
//   cd pipeline && npm i --no-save geotiff@2.1.3 && node ground.mjs [region…]
import { readFileSync, writeFileSync } from 'node:fs';
import { R_MOON_KM } from '../backend/src/ephemeris.ts';
import { llToXY } from '../backend/src/terrain/dem.ts';
import { createSceneFrame } from '../viewpoint/src/core/scene-frame.js';
import { encodeHeights, packDelta16, outDir, DETAIL_ENCODING } from './relief.mjs';

export const PGDA_5MPP = 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp';
/** The site DEMs of PGDA product 78 (the numbers of Mazarico et al. 2011). */
export const SITES_5MPP = ['Site01', 'Site04', 'Site07', 'Site11', 'Site20', 'Site23'];
export const GROUND_LEVEL = { file: 'terrain-lod3.bin', extentKm: 2.5, size: 513 };
export const GROUND_CITATION = 'LOLA 5 m/px de los sitios del polo sur (PGDA/GSFC), Barker et al. 2021';
const REGIONS = ['shackleton-rim', 'ridge-slope', 'im2-objetivo', 'malapert', 'gerlache', 'mouton'];

/** Curvature of the scene, as relief.mjs: a point at height h (km) and horizontal distance ρ (km) from the centre. */
const curved = (h, rho) => (R_MOON_KM + h) * Math.sqrt(1 - (rho / R_MOON_KM) ** 2) - R_MOON_KM;

/** Header of a site GeoTIFF: its polar-stereographic box (m), pixel size and no-data value. */
async function openSite(site, kind = 'surf') {
  const { fromUrl } = await import('geotiff'); // only when run: the tests and the viewer never need it
  const tiff = await fromUrl(`${PGDA_5MPP}/${site}/${site}_final_adj_5mpp_${kind}.tif`);
  const image = await tiff.getImage();
  const [x0, y0, x1, y1] = image.getBoundingBox();
  const [rx, ry] = image.getResolution();
  const nodata = Number(image.getGDALNoData());
  return { site, image, x0, y0, x1, y1, res: Math.abs(rx), flipY: ry < 0, width: image.getWidth(), height: image.getHeight(), nodata };
}

/** Reads the pixels of a box (polar-stereographic m) with a margin of two pixels; returns a sampler in polar x, y (m). */
async function readWindow(t, minX, minY, maxX, maxY) {
  const col = x => (x - t.x0) / t.res - 0.5, row = y => (t.y1 - y) / t.res - 0.5;
  const c0 = Math.max(0, Math.floor(col(minX)) - 2), c1 = Math.min(t.width, Math.ceil(col(maxX)) + 3);
  const r0 = Math.max(0, Math.floor(row(maxY)) - 2), r1 = Math.min(t.height, Math.ceil(row(minY)) + 3);
  const [data] = await t.image.readRasters({ window: [c0, r0, c1, r1] });
  const w = c1 - c0, h = r1 - r0;
  const valid = v => Number.isFinite(v) && v !== t.nodata && Math.abs(v) < 1e5;
  return {
    values: data, w, h,
    /** Bilinear at (x, y); NaN outside the window or next to a no-data pixel. */
    at(x, y) {
      const fx = col(x) - c0, fy = row(y) - r0, i = Math.floor(fx), j = Math.floor(fy);
      if (i < 0 || j < 0 || i + 1 >= w || j + 1 >= h) return NaN;
      const a = data[j * w + i], b = data[j * w + i + 1], c = data[(j + 1) * w + i], d = data[(j + 1) * w + i + 1];
      if (![a, b, c, d].every(valid)) return NaN;
      const u = fx - i, v = fy - j;
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    },
  };
}

/** The polar-stereographic points of the nodes of the ground grid round a region, and their box. */
function nodesOf(meta) {
  const frame = createSceneFrame({ radiusKm: R_MOON_KM, centerLat: meta.center.lat, centerLon: meta.center.lon });
  const { extentKm, size } = GROUND_LEVEL, step = extentKm / (size - 1), half = extentKm / 2;
  const xy = new Float64Array(size * size * 2);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -half + i * step, z = -half + j * step;
      const { lat, lon } = frame.fromScene(x, z);
      const [px, py] = llToXY(lat, lon);
      const k = (j * size + i) * 2;
      xy[k] = px; xy[k + 1] = py;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
  }
  return { xy, step, half, box: { minX, minY, maxX, maxY } };
}

/**
 * The ground level of a region from the first site DEM that covers all of it, or null.
 * @returns {Promise<null | {meta: object, bin: Buffer, site: string, stats: {measured: number, rmsM: number, offsetM: number}}>}
 */
export async function buildGround(meta, { sites = SITES_5MPP, open = openSite, lod2Height = null } = {}) {
  const { xy, step, half, box } = nodesOf(meta);
  const { size } = GROUND_LEVEL;
  for (const site of sites) {
    const t = await open(site);
    const inside = box.minX >= t.x0 + 2 * t.res && box.maxX <= t.x1 - 2 * t.res && box.minY >= t.y0 + 2 * t.res && box.maxY <= t.y1 - 2 * t.res;
    if (!inside) continue;
    const surf = await readWindow(t, box.minX, box.minY, box.maxX, box.maxY);
    const h = new Float64Array(size * size);
    let complete = true;
    for (let k = 0; k < size * size && complete; k++) {
      const hm = surf.at(xy[k * 2], xy[k * 2 + 1]);
      if (!Number.isFinite(hm)) { complete = false; break; }
      const i = k % size, j = Math.floor(k / size);
      h[k] = curved(hm / 1000, Math.hypot(-half + i * step, -half + j * step));
    }
    if (!complete) continue; // a hole of no-data in the square: this DEM does not cover it whole
    // What the product says about itself in the square: shots per pixel and the RMS of its heights.
    const [count, err] = await Promise.all([open(site, 'ldec'), open(site, 'toterr')]);
    const cw = await readWindow(count, box.minX, box.minY, box.maxX, box.maxY);
    const ew = await readWindow(err, box.minX, box.minY, box.maxX, box.maxY);
    let shot = 0, all = 0;
    const errs = [];
    for (let k = 0; k < cw.values.length; k++) { all++; if (cw.values[k] > 0) shot++; }
    for (const v of ew.values) if (Number.isFinite(v) && v >= 0 && v < 1e4) errs.push(v);
    errs.sort((a, b) => a - b);
    const centre = (size * size - 1) / 2;
    const offsetM = lod2Height ? (h[centre] - lod2Height) * 1000 : NaN;
    const { bin, scale, offset } = encodeHeights(h);
    const product = `LOLA_5MPP_${site}@5m`;
    return {
      site,
      bin: packDelta16(bin, size),
      stats: { measured: shot / all, rmsM: errs[Math.floor(errs.length / 2)], offsetM },
      meta: {
        extentKm: GROUND_LEVEL.extentKm, grid: { cols: size, rows: size, stepKm: step },
        heights: { file: GROUND_LEVEL.file, encoding: DETAIL_ENCODING, unit: 'km', scale, offset },
        products: [product],
        // What the product says about itself in the square, for the note of sources: the share of pixels with a LOLA
        // shot (the rest are interpolated) and the median of its height error (RMS, m). The level carries its citation.
        measured: Math.round((shot / all) * 1000) / 1000,
        rmsM: Math.round(errs[Math.floor(errs.length / 2)] * 100) / 100,
        citation: GROUND_CITATION,
      },
    };
  }
  return null;
}

async function main(ids) {
  for (const id of ids) {
    const dir = outDir(id);
    const metaUrl = new URL('meta.json', dir);
    const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
    const coarse = (meta.detail ?? []).filter(d => d.heights.file !== GROUND_LEVEL.file);
    if (!coarse.length || coarse.at(-1).extentKm < GROUND_LEVEL.extentKm) { console.log(`${id}: sin nivel de 19,5 m debajo; no se añade suelo de 5 m`); continue; }
    const ground = await buildGround(meta);
    if (!ground) { console.log(`${id}: ningún DEM de 5 m de PGDA cubre los ${GROUND_LEVEL.extentKm} km alrededor del sitio`); continue; }
    writeFileSync(new URL(GROUND_LEVEL.file, dir), ground.bin);
    // The region keeps its source as it was (the 20 m DEM and the rest); the new level says where it comes from itself.
    meta.detail = [...coarse, ground.meta];
    writeFileSync(metaUrl, JSON.stringify(meta, null, 2) + '\n');
    console.log(`${id}: ${ground.site}, ${(ground.bin.length / 1e3).toFixed(0)} KB, ${(ground.stats.measured * 100).toFixed(1)} % de píxeles con disparo LOLA, error típico ${ground.stats.rmsM.toFixed(2)} m`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  await main(process.argv.slice(2).length ? process.argv.slice(2) : REGIONS);
}
