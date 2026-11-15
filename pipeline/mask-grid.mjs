// Precomputes the grid of horizon masks around a site (E2.0): 4 × 4 km, one point every 100 m (41 × 41 = 1681 points), each with
// the mask of buildMask(lat, lon, { observerHeightM: 2, resolution: 'precise' }) of the engine (backend/src/terrain/horizonMask.ts).
// The masks are stored already in the axes of the region: azimuth from the local north of the CENTRE and elevation over the
// vertical of the centre. Near the pole the local north turns about 3.4° per km and the vertical tilts about 0.03° per km, so every
// direction of the horizon is rotated (it is not copied), and the client compares with series-2027.json with no correction.
// Usage: node pipeline/mask-grid.mjs --site <id> [--azimuths 360|720]
//   --site <id>       region of viewpoint/data/<id>/ (needs its meta.json and series-2027.json), writes masks.bin and meta.json `maskGrid`
//   --azimuths <n>    azimuths of every mask (default 360, see «Decisión» in pipeline/README.md)
// Needs the DEM in the local cache (cd backend && node scripts/fetch-dem.ts) and the SAME DEM version as the series.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildMask } from '../backend/src/terrain/horizonMask.ts';
import { demVersion } from '../backend/src/terrain/dem.ts';
import { createSceneFrame } from '../viewpoint/src/core/scene-frame.js';

export const EXTENT_KM = 4;
export const STEP_KM = 0.1;
export const OBSERVER_HEIGHT_M = 2;
export const AZIMUTHS = 360; // the smallest count that keeps the parity: measured by the test «360 or 720 azimuths»
export const MASKS_FILE = 'masks.bin';
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const regionDir = (siteId) => new URL(`../viewpoint/data/${siteId}/`, import.meta.url);

/** East, north and up unit vectors (Moon-fixed axes) at a point, as horizonRay of the engine builds them. */
function basisAt(lat, lon) {
  const la = lat * D2R;
  const lo = lon * D2R;
  return {
    up: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
  };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Rotates a horizon mask from the axes of its own point to the axes of the centre of the region.
 * @param {ArrayLike<number>} el elevations (degrees) at azimuth k · 360 / el.length from the local north of (lat, lon)
 * @param {{lat:number, lon:number}} point where the mask was computed
 * @param {{lat:number, lon:number}} center centre of the region
 * @param {number} azimuths number of azimuths of the result
 * @returns {Float64Array} elevations (degrees) at azimuth k · 360 / azimuths from the local north of the centre, over its vertical
 */
export function toCenterAxes(el, point, center, azimuths) {
  const n = el.length;
  const p = basisAt(point.lat, point.lon);
  const c = basisAt(center.lat, center.lon);
  // direction of every horizon sample in the axes of the centre; the azimuth is unwrapped so it grows with k
  const az = new Float64Array(n);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = ((k * 360) / n) * D2R;
    const e = el[k] * D2R;
    const ce = Math.cos(e);
    const v = [0, 1, 2].map((i) => ce * (Math.cos(a) * p.north[i] + Math.sin(a) * p.east[i]) + Math.sin(e) * p.up[i]);
    let ac = Math.atan2(dot(v, c.east), dot(v, c.north)) * R2D;
    if (k > 0) while (ac < az[k - 1]) ac += 360;
    else ac = ((ac % 360) + 360) % 360;
    az[k] = ac;
    out[k] = Math.asin(Math.max(-1, Math.min(1, dot(v, c.up)))) * R2D;
  }
  // resample at the azimuths of the region, linear between the two samples around each one (as the engine reads a mask)
  const res = new Float64Array(azimuths);
  let j = 0;
  for (let k = 0; k < azimuths; k++) {
    let t = (k * 360) / azimuths;
    while (t < az[0]) t += 360;
    while (t >= az[0] + 360) t -= 360;
    if (az[j] > t) j = 0; // the targets only go back when they wrap round: search again from the start
    while (j < n - 1 && az[j + 1] <= t) j++;
    const a0 = az[j];
    const a1 = j < n - 1 ? az[j + 1] : az[0] + 360;
    const e1 = out[(j + 1) % n];
    res[k] = a1 > a0 ? out[j] + ((e1 - out[j]) * (t - a0)) / (a1 - a0) : out[j];
  }
  return res;
}

/** DEM version of the series of a region: the `demVersion: …` of its `source`. null when it does not say. */
export const seriesDemVersion = (seriesDoc) => /demVersion: ([\w-]+)/.exec(seriesDoc?.source ?? '')?.[1] ?? null;

/** Throws when the DEM that computes the grid is not the one of the series: the two would not describe the same relief. */
export function assertSameDem(seriesVersion, gridVersion) {
  if (!seriesVersion) throw new Error('La serie no declara su demVersion: regenera series-2027.json con pipeline/ephemeris.mjs');
  if (!gridVersion) throw new Error('No hay DEM en backend/terrain/cache/: ejecuta antes «cd backend && node scripts/fetch-dem.ts»');
  if (seriesVersion !== gridVersion) {
    throw new Error(`La demVersion de la rejilla (${gridVersion}) no coincide con la de la serie (${seriesVersion}): usa el mismo DEM que series-2027.json o regenera la serie`);
  }
}

/**
 * Builds the grid of masks around `center`: points by rows from north to south and from west to east, the scene frame of the region.
 * @returns {{ maskGrid: object, bin: Buffer }} the `maskGrid` block of meta.json and the bytes of masks.bin
 */
export function buildMaskGrid({
  center, radiusKm = 1737.4, extentKm = EXTENT_KM, stepKm = STEP_KM, azimuths = AZIMUTHS, observerHeightM = OBSERVER_HEIGHT_M,
}) {
  const cols = Math.round(extentKm / stepKm) + 1;
  const rows = cols;
  const frame = createSceneFrame({ radiusKm, centerLat: center.lat, centerLon: center.lon });
  const bin = Buffer.alloc(cols * rows * azimuths * 2);
  let at = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { lat, lon } = frame.fromScene(-extentKm / 2 + c * stepKm, -extentKm / 2 + r * stepKm);
      const mask = buildMask(lat, lon, { observerHeightM, resolution: 'precise' });
      if (!mask) throw new Error(`Sin DEM en (${lat.toFixed(5)}, ${lon.toFixed(5)}), punto (${c}, ${r}) de la rejilla`);
      for (const e of toCenterAxes(mask.el, { lat, lon }, center, azimuths)) {
        bin.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(e * 100))), at);
        at += 2;
      }
    }
  }
  const version = demVersion();
  return {
    maskGrid: { file: MASKS_FILE, extentKm, stepKm, cols, rows, azimuths, encoding: 'int16-le', observerHeightM, demVersion: version },
    bin,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const siteId = opt('--site');
  const azimuths = Number(opt('--azimuths', AZIMUTHS));
  if (!siteId || ![360, 720].includes(azimuths)) throw new Error('Uso: node pipeline/mask-grid.mjs --site <id> [--azimuths 360|720]');
  const dir = regionDir(siteId);
  const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8'));
  const series = JSON.parse(readFileSync(new URL('series-2027.json', dir), 'utf8'));
  assertSameDem(seriesDemVersion(series), demVersion());
  const { centerLat, centerLon, radiusKm } = meta.sceneFrame;
  const t0 = Date.now();
  const { maskGrid, bin } = buildMaskGrid({ center: { lat: centerLat, lon: centerLon }, radiusKm, azimuths });
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(MASKS_FILE, dir), bin);
  writeFileSync(new URL('meta.json', dir), JSON.stringify({ ...meta, maskGrid }, null, 2) + '\n');
  console.log(`${maskGrid.cols * maskGrid.rows} máscaras de ${siteId} (${azimuths} azimuts, ${bin.length} bytes, demVersion ${maskGrid.demVersion}) en ${Math.round((Date.now() - t0) / 1000)} s`);
}
