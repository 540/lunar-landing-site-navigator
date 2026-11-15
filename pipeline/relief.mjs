// Procedural relief of the Shackleton rim, ported from the prototype (docs/mirador-polo-sur/index.html: rng, REGIONS.shackleton,
// small craters, feat and Hr). It writes the final region format (docs/desglose-tour-lunar.md, section 3.4), so E9 only changes the source.
// Units as in the prototype: x, z and heights in km, region centre at (0, 0).
// Usage: node pipeline/relief.mjs [--source lola|procedural|simulated] [--site <id>] [--dem-dir <terrain folder>] [--far-only]
//   --site <id>                    site written to viewpoint/data/<id>/ (default shackleton-rim); with --source lola also any site of the
//                                  backend catalogue with a mask (e.g. im2-objetivo); with --far-only, the region that gains the ring
//   npm run pipeline:relief        procedural relief (default, needs no DEM)
//   npm run pipeline:relief:lola   real LOLA relief, read with the DEM engine of backend/src/terrain/dem.ts
//   node pipeline/relief.mjs --source lola --site malapert
//                                  real LOLA relief around any polar site of the web catalogue (the DEM must cover it)
//   node pipeline/relief.mjs --source simulated --site malapert
//                                  the invented relief of the web's simulated engine (elevation() of web/js/engine/model.js),
//                                  for any polar site of the web catalogue (V2.1, #76): the terrain of the simulated verdict
// Deterministic: same input, same bytes every time.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { getSite } from '../backend/src/sites.ts';
import { R_MOON_KM } from '../backend/src/ephemeris.ts';
import { bilinear, configureDem, covers, demVersion, layersFor, llToXY } from '../backend/src/terrain/dem.ts';
import { createSceneFrame } from '../viewpoint/src/core/scene-frame.js';
import { elevation, toMap } from '../web/js/engine/model.js';
import { SITES as WEB_SITES } from '../web/js/engine/catalog.js';

export const SITE_ID = 'shackleton-rim';
export const SOURCES = ['procedural', 'lola', 'simulated'];
export const outDir = (id) => new URL(`../viewpoint/data/${id}/`, import.meta.url);
export const OUT_DIR = outDir(SITE_ID);
export const EXTENT_KM = 40; // as buildGrid in the prototype
export const GRID_SIZE = 257; // 256 cells of 156.25 m
export const VERSION = 1;
export const FAR_EXTENT_KM = 300; // E9.2: coarse ring around the fine zone, centred on the same point
export const FAR_GRID_SIZE = 257; // 256 cells of ~1.17 km
export const FAR_FILE = 'terrain-far.bin';
// Finer grids around the centre of the region, coarse to fine (#97). Each one is centred, covers a whole number of cells of the
// one before, and replaces it there in the viewer: 20 km at 78 m and 10 km at 19.5 m, the resolution of LDEM_80S_20MPP_ADJ.
// Only written with LOLA, and only while the DEM under the grid is fine enough (DETAIL_MAX_DEM_STEPS): the procedural and
// simulated reliefs are smooth, and a region read from the 160 m DEM alone has nothing finer to show.
export const DETAIL_LEVELS = [
  { file: 'terrain-lod1.bin', extentKm: 20, size: 257 },
  { file: 'terrain-lod2.bin', extentKm: 10, size: 513 },
];
// A detail grid is kept when every node comes from a DEM whose resolution is at most this many steps of the grid.
export const DETAIL_MAX_DEM_STEPS = 2;
// Encoding of the detail grids: half the bytes of plain uint16 (see packDelta16). terrain-lod0.bin stays plain.
export const DETAIL_ENCODING = 'delta16-gzip';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// REGIONS.shackleton of the prototype
export const REGION = {
  seed: 11,
  bowl: 1,
  feats: [
    { t: 'c', x: 0, z: -11, R: 10.5, D: 4.2, rim: 0.35 },
    { t: 'm', x: 13, z: 7, R: 4, H: 2.0, p: 2 },
    { t: 'm', x: -12, z: 9, R: 5, H: 1.4, p: 2 },
  ],
  keep: [{ x: 0, z: -0.6, r: 1.2 }],
};

function smallCraters(reg) {
  const g = rng(reg.seed);
  const small = [];
  for (let i = 0; i < 40; i++) {
    const R = 0.2 + g() * g() * 1.6;
    const x = (g() - 0.5) * 36;
    const z = (g() - 0.5) * 36;
    if (reg.keep.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + R)) continue;
    small.push({ t: 'c', x, z, R, D: R * 0.22, rim: R * 0.05 });
  }
  return small;
}

export function feat(f, x, z) {
  const r = Math.hypot(x - f.x, z - f.z);
  if (f.t === 'm') return f.H / (1 + Math.pow(r / f.R, f.p * 2));
  if (r > f.R * 2.2) return 0;
  const q = r / f.R;
  if (q < 1) return f.D * (q * q - 1) + f.rim * Math.pow(q, 6);
  const u = (r - f.R) / (0.35 * f.R);
  return f.rim * Math.exp(-u * u);
}

export function makeHeightFn(reg = REGION) {
  const small = smallCraters(reg);
  return (x, z) => {
    let h = 0.018 * Math.sin(1.3 * x + 0.7 * z) * Math.cos(0.9 * z - 1.1 * x) + 0.008 * Math.sin(3.1 * x - 2.3 * z + 1) + 0.003 * Math.sin(7.3 * x + 5.1 * z);
    if (reg.bowl) {
      const rr = (x * x + z * z) / 900;
      h -= 2.0 * (1 - Math.exp(-rr));
    }
    for (const f of reg.feats) h += feat(f, x, z);
    for (const f of small) h += feat(f, x, z);
    return h;
  };
}

// Display names of the regions (meta.name). Sites not listed here use the catalogue name for both languages.
const REGION_NAMES = {
  'shackleton-rim': { en: 'Shackleton connecting ridge' },
  'im2-objetivo': { es: 'Mons Mouton · IM-2 Athena (objetivo)', en: 'Mons Mouton · IM-2 Athena (target)' },
};

export const LOLA_CITATION = 'LOLA LDEM (PGDA/GSFC), Barker et al. 2023';
export const DEFAULT_DEM_DIR = fileURLToPath(new URL('../backend/terrain/', import.meta.url));

/** Procedural heights (km) of every node, rows north to south, columns west to east. */
function proceduralHeights(n, step, half) {
  const H = makeHeightFn();
  const h = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = H(-half + i * step, -half + j * step);
  return { h, source: { type: 'procedural', origin: 'docs/mirador-polo-sur/index.html (Hr, feat)', seed: REGION.seed } };
}

/**
 * LOLA heights (km) of every node. Each node (x, z) goes to lat/lon with `fromScene`, its height is read with `bilinear` from the
 * finest grid of `layersFor(lat, lon, 'precise')` that covers it, and the sphere curvature is applied: the scene is the tangent
 * frame at the centre, so y = (R + h) · cos θ − R, with sin θ = ρ / R (the projection of SceneFrame is orthographic).
 * `resolution` 'fast' reads only the 160/240 m layers (the far ring). `grids` (optional) replaces the DEM folder with in-memory grids (tests).
 * `coarsestM` is the resolution of the coarsest DEM grid that gave a node.
 */
function lolaHeights(n, step, half, site, { demDir, grids, resolution = 'precise' }) {
  const version = grids ? configureDem({ grids }) : configureDem({ dir: demDir });
  if (!version) throw new Error(`No hay DEM LOLA en ${demDir}/cache. Descárgalo una vez: cd backend && node scripts/fetch-dem.ts && node scripts/fetch-dem.ts --near ${site.lat},${site.lon} --half-km 22`);
  const frame = createSceneFrame({ radiusKm: R_MOON_KM, centerLat: site.lat, centerLon: site.lon });
  const h = new Float64Array(n * n);
  const used = new Set();
  let coarsestM = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const { lat, lon } = frame.fromScene(x, z);
      const sel = layersFor(lat, lon, resolution);
      const [px, py] = llToXY(lat, lon);
      let hm = NaN;
      for (const { g } of sel?.layers ?? []) {
        if (!covers(g, px, py)) continue;
        hm = bilinear(g, px, py);
        if (Number.isFinite(hm)) {
          used.add(`${g.product}@${g.res}m`);
          if (g.res > coarsestM) coarsestM = g.res;
          break;
        }
      }
      if (!Number.isFinite(hm)) throw new Error(`Ningún DEM cubre el nodo (${x.toFixed(3)}, ${z.toFixed(3)}) km (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
      h[j * n + i] = curved(hm / 1000, Math.hypot(x, z));
    }
  }
  return { h, coarsestM, source: { type: 'lola', products: [...used].sort(), demVersion: version, citation: LOLA_CITATION } };
}

/** Encodes heights (km) as uint16 little-endian with their own offset and scale. */
export function encodeHeights(h) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of h) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const offset = Math.round(min * 1e6) / 1e6;
  const scale = Math.round(((max - offset) / 65535) * 1e9) / 1e9;
  const bin = Buffer.alloc(h.length * 2);
  // The rounded offset can sit just over the lowest node: it is clamped to 0.
  for (let k = 0; k < h.length; k++) bin.writeUInt16LE(Math.min(65535, Math.max(0, Math.round((h[k] - offset) / scale))), k * 2);
  return { bin, scale, offset };
}

/**
 * Packs a grid of uint16 heights (little-endian, row-major) as `delta16-gzip`: each value is replaced by its difference from
 * the prediction left + up − up-left (0 beyond the edges), as int16 modulo 2^16; the low bytes of all nodes go first, then the
 * high bytes, and the whole is gzipped. Terrain is smooth, so the differences are small and the high bytes almost all 0.
 * viewpoint/src/core/relief.js (unpackDelta16) undoes it.
 */
export function packDelta16(buf, cols) {
  const count = buf.length / 2;
  const planes = Buffer.alloc(count * 2);
  const at = (k) => buf.readUInt16LE(k * 2);
  for (let k = 0; k < count; k++) {
    const left = k % cols ? at(k - 1) : 0;
    const up = k >= cols ? at(k - cols) : 0;
    const upLeft = k % cols && k >= cols ? at(k - cols - 1) : 0;
    const d = (at(k) - (left + up - upLeft)) & 0xffff;
    planes[k] = d & 0xff;
    planes[count + k] = d >> 8;
  }
  return gzipSync(planes, { level: 9 });
}

/**
 * The finer grids of DETAIL_LEVELS around a site (#97), coarse to fine, until the DEM is too coarse for one: the ones after it
 * would not fit without it. Each entry is the description that goes to `meta.detail` and the packed binary.
 */
function buildDetail(site, { demDir, grids }) {
  const detail = [];
  for (const d of DETAIL_LEVELS) {
    const stepKm = d.extentKm / (d.size - 1);
    const { h, coarsestM, source } = lolaHeights(d.size, stepKm, d.extentKm / 2, site, { demDir, grids });
    if (coarsestM > DETAIL_MAX_DEM_STEPS * stepKm * 1000) break;
    const { bin, scale, offset } = encodeHeights(h);
    detail.push({
      meta: { extentKm: d.extentKm, grid: { cols: d.size, rows: d.size, stepKm }, heights: { file: d.file, encoding: DETAIL_ENCODING, unit: 'km', scale, offset }, products: source.products },
      file: d.file,
      bin: packDelta16(bin, d.size),
    });
  }
  return detail;
}

/** Curvature of the scene: a point at height h (km) and horizontal distance ρ (km) from the centre, in the tangent frame. */
const curved = (h, rho) => (R_MOON_KM + h) * Math.sqrt(1 - (rho / R_MOON_KM) ** 2) - R_MOON_KM;

export const SIMULATED_NOTE = 'Relieve inventado: el del motor simulado de la web (cráteres y montañas con nombres reales, posiciones aproximadas y alturas inventadas). No es el terreno real: es el mismo con el que decide el veredicto simulado.';

/**
 * Simulated heights (km) of every node: the same elevation() as the simulated verdict of the web. Each node (x, z) goes to
 * lat/lon with `fromScene`, then to the polar map of the model with `toMap`, its height is `elevation(x, y)` and the sphere
 * curvature of SceneFrame is applied, as with LOLA.
 */
function simulatedHeights(n, step, half, site) {
  const frame = createSceneFrame({ radiusKm: R_MOON_KM, centerLat: site.lat, centerLon: site.lon });
  const h = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const { lat, lon } = frame.fromScene(x, z);
      const p = toMap(lat, lon);
      h[j * n + i] = curved(elevation(p.x, p.y), Math.hypot(x, z));
    }
  }
  return { h, source: { type: 'simulated', origin: 'web/js/engine/model.js (elevation, toMap)', note: SIMULATED_NOTE } };
}

// English names of the web sites (the web catalogue only has the Spanish ones).
const EN_NAMES = {
  'shackleton-rim': 'Shackleton connecting ridge',
  'ridge-slope': 'Slope of the ridge (≈4 km away)',
  malapert: 'Malapert massif',
  gerlache: 'Rim of de Gerlache crater',
};

/**
 * The site of a region. Without --site (or with shackleton-rim), the ridge of the backend catalogue: the only one with
 * procedural relief. LOLA and simulated also take any polar site of the web catalogue, centred on its coordinates.
 */
function siteFor(source, id) {
  if (source === 'simulated' && id === undefined) throw new Error('--source simulated necesita --site <id> (un sitio de web/js/engine/catalog.js)');
  if ((id === undefined || id === SITE_ID) && source !== 'simulated') {
    const site = getSite(SITE_ID);
    return { id: site.id, lat: site.lat, lon: site.lon, name: { es: site.name, en: 'Shackleton connecting ridge' }, verified: site.verified ?? false };
  }
  if (source === 'lola' && id !== undefined && getSite(id)) {
    const site = getSite(id);
    return { id: site.id, lat: site.lat, lon: site.lon, name: { es: REGION_NAMES[id]?.es ?? site.name, en: REGION_NAMES[id]?.en ?? site.name }, verified: site.verified ?? false };
  }
  if (source === 'procedural') throw new Error(`--source procedural solo sirve para «${SITE_ID}»; para otro sitio usa --source lola o simulated`);
  const site = WEB_SITES.find((s) => s.id === id);
  if (!site) throw new Error(`Sitio desconocido: «${id}», no está en el catálogo. Sitios: ${WEB_SITES.filter((s) => !s.offMap).map((s) => s.id).join(', ')}`);
  if (site.offMap) throw new Error(`«${id}» está fuera del mapa polar del modelo simulado: no tiene relieve simulado`);
  return { id: site.id, lat: site.lat, lon: site.lon, name: { es: site.name, en: EN_NAMES[site.id] ?? site.name }, verified: getSite(site.id)?.verified ?? false };
}

/**
 * Builds meta.json, the binary of heights (Buffer, uint16 little-endian) and, with LOLA, the finer grids of `DETAIL_LEVELS`
 * that the DEM can fill (`detail`: `[{ file, bin }]`, described in `meta.detail`).
 * @param {{source?: 'procedural'|'lola'|'simulated', site?: string, demDir?: string, grids?: object[]}} [options]
 */
export function buildRelief({ source = 'procedural', site: siteId, demDir = DEFAULT_DEM_DIR, grids } = {}) {
  if (!SOURCES.includes(source)) throw new Error(`--source debe ser «lola», «procedural» o «simulated», no «${source}»`);
  const site = siteFor(source, siteId);
  const n = GRID_SIZE;
  const step = EXTENT_KM / (n - 1);
  const half = EXTENT_KM / 2;
  const { h, source: metaSource } =
    source === 'lola' ? lolaHeights(n, step, half, site, { demDir, grids })
    : source === 'simulated' ? simulatedHeights(n, step, half, site)
    : proceduralHeights(n, step, half);
  const { bin: buf, scale, offset } = encodeHeights(h);
  const detail = source === 'lola' ? buildDetail(site, { demDir, grids }) : [];
  const meta = {
    version: VERSION,
    id: site.id,
    name: site.name,
    center: { lat: site.lat, lon: site.lon },
    // From `verified` of the backend catalogue, as the API does (#155): false shows «coordenadas aproximadas» in the selector.
    coordinatesVerified: site.verified,
    extentKm: EXTENT_KM,
    grid: { cols: n, rows: n, stepKm: step },
    units: { horizontal: 'km', vertical: 'km' },
    heights: { file: 'terrain-lod0.bin', encoding: 'uint16-le', unit: 'km', scale, offset },
    // Optional and additive (#97): a client that does not know it draws the region with terrain-lod0.bin alone.
    ...(detail.length ? { detail: detail.map((d) => d.meta) } : {}),
    source: metaSource,
    // Parameters of SceneFrame (viewpoint/src/core/scene-frame.js): orthographic projection on the Moon sphere around the centre.
    sceneFrame: { projection: 'orthographic', radiusKm: R_MOON_KM, centerLat: site.lat, centerLon: site.lon, axes: { x: 'east', y: 'up', z: 'south' } },
  };
  return { meta, bin: buf, detail: detail.map(({ file, bin }) => ({ file, bin })) };
}

/**
 * The far ring (E9.2): FAR_EXTENT_KM × FAR_EXTENT_KM around the centre of the region, FAR_GRID_SIZE², same encoding and same curvature
 * formula as the fine grid, read from the 160/240 m layers. Returns the `far` entry of meta.json and the binary. Needs a DEM (there is no
 * procedural far ring). `center` is `meta.center` of the region (#430); without it, the Shackleton ridge.
 * @param {{center?: {lat: number, lon: number}, demDir?: string, grids?: object[]}} [options]
 */
export function buildFarRelief({ center, demDir = DEFAULT_DEM_DIR, grids } = {}) {
  const site = center ?? getSite(SITE_ID);
  const n = FAR_GRID_SIZE;
  const { h } = lolaHeights(n, FAR_EXTENT_KM / (n - 1), FAR_EXTENT_KM / 2, site, { demDir, grids, resolution: 'fast' });
  const { bin, scale, offset } = encodeHeights(h);
  const far = {
    file: FAR_FILE,
    extentKm: FAR_EXTENT_KM,
    grid: { cols: n, rows: n, stepKm: FAR_EXTENT_KM / (n - 1) },
    heights: { encoding: 'uint16-le', unit: 'km', scale, offset },
  };
  return { far, bin };
}

/** `--far-only` adds a LOLA ring, so it only fits a LOLA meta.json: on procedural or simulated relief it would mix sources. */
export function assertFarOnlyMeta(meta) {
  if (meta?.source?.type !== 'lola') {
    throw new Error('--far-only necesita un meta.json de LOLA; ejecuta antes npm run pipeline:relief:lola');
  }
}

const FLAGS = { '--source': 'source', '--site': 'site', '--dem-dir': 'demDir' };

/** Reads `--source`, `--site`, `--dem-dir` and `--far-only` from the command line. */
export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--far-only') opts.farOnly = true;
    else {
      if (!FLAGS[a]) throw new Error(`Opción desconocida: ${a}`);
      if (argv[i + 1] === undefined) throw new Error(`Falta el valor de ${a}`);
      opts[FLAGS[a]] = argv[++i];
    }
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.farOnly) {
    // Only the far ring (a DEM of 160/240 m is enough): meta.json gains `far` and terrain-lod0.bin stays as it is.
    // The region of --site (#430), centred on its own meta.center.
    const dir = outDir(opts.site ?? SITE_ID);
    const metaUrl = new URL('meta.json', dir);
    const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
    assertFarOnlyMeta(meta);
    const { far, bin } = buildFarRelief({ ...opts, center: meta.center });
    writeFileSync(metaUrl, JSON.stringify({ ...meta, far }, null, 2) + '\n');
    writeFileSync(new URL(FAR_FILE, dir), bin);
    console.log(`Escrito ${new URL(FAR_FILE, dir).pathname} (${bin.length} bytes) y «far» en meta.json`);
    process.exit(0);
  }
  const { meta, bin, detail } = buildRelief(opts);
  // Every LOLA region has a far ring around its own centre (#430); procedural and simulated files have none.
  const farRelief = meta.source.type === 'lola' ? buildFarRelief({ ...opts, center: meta.center }) : null;
  if (farRelief) meta.far = farRelief.far;
  const dir = outDir(meta.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('meta.json', dir), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(new URL('terrain-lod0.bin', dir), bin);
  if (farRelief) writeFileSync(new URL(FAR_FILE, dir), farRelief.bin);
  else rmSync(new URL(FAR_FILE, dir), { force: true });
  // The detail grids of an earlier run that this one does not write must not stay next to it.
  for (const d of DETAIL_LEVELS) rmSync(new URL(d.file, dir), { force: true });
  for (const d of detail) writeFileSync(new URL(d.file, dir), d.bin);
  const detailBytes = detail.reduce((sum, d) => sum + d.bin.length, 0);
  console.log(`Escrito ${dir.pathname} (fuente ${meta.source.type}, ${bin.length} bytes de alturas${detail.length ? `, ${detailBytes} de ${detail.length} rejillas de detalle` : ''}${farRelief ? `, ${farRelief.bin.length} del anillo lejano` : ''})`);
}
