// Regenerates the official-source fixtures of the validation matrix (validation/matrix.ts) that can be downloaded:
//
//   node validation/fetch-fixtures.ts [--cache <dir>] [--horizons]
//
//   - fixtures/pgda-points.json: the PGDA/LOLA illumination products (Mazarico et al. 2011, release 201608) sampled at
//     the points of the matrix (catalogue sites south of 65°S and a grid of 8 latitudes × 12 longitudes). Downloads the
//     five products (~445 MB) once into --cache (default: terrain/cache/pgda-illumination, outside git) and reads the
//     nearest pixel of each point (pixel registration, polar stereographic sphere of 1737.4 km, as dem.ts llToXY).
//   - with --horizons, the JPL Horizons Sun elevations of the Apollo instants in fixtures/missions.json (30 queries).
//
// The other fixtures are tables transcribed by hand from their publications (each one says which and where):
// glaser2018.json, leone2023.json and the official coordinates and facts of missions.json. illumination.json,
// psr.json and slope.json come from the 2026-11 comparison with PGDA (see their `description`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES } from '../src/sites.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');
const BASE_URL = 'http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/';
/** Key in the fixture → PGDA product. */
export const PGDA_PRODUCTS = {
  earth65: 'AVGVISIB_65S_240M_201608_EARTH',
  earth85: 'AVGVISIB_85S_060M_201608_EARTH',
  sun65: 'AVGVISIB_65S_240M_201608',
  sun85: 'AVGVISIB_85S_060M_201608',
  skyv65: 'SKYV_65S_240M',
} as const;
type ProductKey = keyof typeof PGDA_PRODUCTS;
/** The 60 m products only cover 85–90°S. */
const MAX_LAT: Partial<Record<ProductKey, number>> = { earth85: -85, sun85: -85 };
const R_M = 1737400;
const D2R = Math.PI / 180;

interface Product { name: string; n: number; res: number; scale: number; offset: number; fd: number; version: string; created: string; url: string }

function openProduct(dir: string, name: string): Product {
  const label = fs.readFileSync(path.join(dir, `${name}.LBL`), 'latin1');
  const num = (key: string): number => Number(new RegExp(`^\\s*${key}\\s*=\\s*([-\\d.]+)`, 'm').exec(label)![1]);
  const str = (key: string): string => new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm').exec(label)?.[1].trim() ?? '';
  return {
    name, n: num('LINES'), res: num('MAP_SCALE'), scale: num('SCALING_FACTOR'), offset: /^\s*OFFSET\s*=/m.test(label) ? num('OFFSET') : 0,
    fd: fs.openSync(path.join(dir, `${name}.IMG`), 'r'), version: str('PRODUCT_VERSION_ID'), created: str('PRODUCT_CREATION_TIME'), url: `${BASE_URL}${name}.IMG`,
  };
}

/** Value of the pixel that contains (lat, lon), or null outside the product. */
function sample(p: Product, lat: number, lon: number): number | null {
  const rho = 2 * R_M * Math.tan(((90 + lat) * D2R) / 2);
  const x = rho * Math.sin(lon * D2R), y = rho * Math.cos(lon * D2R);
  const row = Math.floor(p.n / 2 - y / p.res), col = Math.floor(x / p.res + p.n / 2);
  if (row < 0 || col < 0 || row >= p.n || col >= p.n) return null;
  const b = Buffer.alloc(2);
  fs.readSync(p.fd, b, 0, 2, (row * p.n + col) * 2);
  return Math.round((b.readInt16LE(0) * p.scale + p.offset) * 1e5) / 1e5;
}

async function download(dir: string, file: string): Promise<void> {
  const dest = path.join(dir, file);
  if (fs.existsSync(dest)) return;
  console.log(`descargando ${BASE_URL}${file}`);
  const res = await fetch(BASE_URL + file);
  if (!res.ok || !res.body) throw new Error(`${file}: HTTP ${res.status}`);
  fs.writeFileSync(`${dest}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${dest}.part`, dest);
}

/** Points of the matrix: catalogue sites south of 65°S and a regular grid (8 latitudes × 12 longitudes). */
export function matrixPoints(): { id: string; lat: number; lon: number; site?: string }[] {
  const pts: { id: string; lat: number; lon: number; site?: string }[] = SITES.filter((s) => s.lat < -65).map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, site: s.id }));
  for (const lat of [-70, -75, -80, -82.5, -85, -86.5, -88, -89.3]) for (let lon = -165; lon < 180; lon += 30) pts.push({ id: `g${lat}_${lon}`, lat, lon });
  return pts;
}

async function pgdaPoints(cache: string): Promise<void> {
  fs.mkdirSync(cache, { recursive: true });
  for (const name of Object.values(PGDA_PRODUCTS)) for (const ext of ['LBL', 'IMG']) await download(cache, `${name}.${ext}`);
  const products = Object.fromEntries(Object.entries(PGDA_PRODUCTS).map(([k, name]) => [k, openProduct(cache, name)])) as Record<ProductKey, Product>;
  const keys = Object.keys(PGDA_PRODUCTS) as ProductKey[];
  const points = matrixPoints().map((p) => [p.id, p.site ?? null, p.lat, p.lon,
    ...keys.map((k) => (MAX_LAT[k] !== undefined && p.lat > MAX_LAT[k]! ? null : sample(products[k], p.lat, p.lon)))]);
  const out = {
    description: 'Productos de iluminación de PGDA/LOLA (Mazarico et al. 2011, Icarus 211, 1066–1081) muestreados en los puntos '
      + 'de la matriz de validación: sitios del catálogo al sur de 65°S y una malla de 8 latitudes × 12 longitudes. Píxel más '
      + 'cercano (registro de píxel, estereográfica polar sobre la esfera de 1737,4 km). earth*/sun*: fracción de tiempo con '
      + 'algo del disco de la Tierra o del Sol visible (0–1, horaria, 18,6 años, observador sobre el suelo); skyv65: ángulo '
      + 'sólido del cielo visible (sr). Los productos de 60 m solo cubren 85–90°S (null fuera). Regenerar con '
      + '`node validation/fetch-fixtures.ts`.',
    products: Object.fromEntries(keys.map((k) => [k, { product: products[k].name, version: products[k].version, created: products[k].created, resolutionM: products[k].res, url: products[k].url }])),
    columns: ['id', 'site', 'lat', 'lon', ...keys],
    points,
  };
  fs.writeFileSync(path.join(FIXTURES, 'pgda-points.json'), `${JSON.stringify(out, null, 0).replace(/\],\[/g, '],\n[')}\n`);
  console.log(`fixtures/pgda-points.json: ${points.length} puntos`);
}

/** Apparent Sun elevation (°, no refraction) from a lunar surface point at one instant, from JPL Horizons. */
async function horizonsSunElevation(lat: number, lon: number, iso: string): Promise<number> {
  const jd = Date.parse(iso) / 86400e3 + 2440587.5;
  const q = new URLSearchParams({
    format: 'text', COMMAND: "'10'", OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER', CENTER: "'coord@301'",
    COORD_TYPE: 'GEODETIC', SITE_COORD: `'${lon},${lat},0'`, TLIST: `'${jd.toFixed(8)}'`, TLIST_TYPE: 'JD', TIME_TYPE: 'UT',
    QUANTITIES: "'4'", ANG_FORMAT: 'DEG', CSV_FORMAT: 'YES', EXTRA_PREC: 'YES',
  });
  const text = await (await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${q}`)).text();
  const row = text.split('$$SOE')[1]?.split('$$EOE')[0]?.trim();
  if (!row) throw new Error(text.slice(0, 800));
  const nums = row.split(',').map((s) => s.trim()).filter((s) => /^-?\d+\.\d+$/.test(s)).map(Number);
  await new Promise((r) => setTimeout(r, 500)); // a shared public service: one query at a time
  return nums.at(-1)!;
}

async function apolloHorizons(): Promise<void> {
  const file = path.join(FIXTURES, 'missions.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8')) as { apollo: { rows: [string, string, string, number | null, number][] } };
  for (const row of m.apollo.rows) {
    const site = SITES.find((s) => s.id === row[0])!;
    row[4] = Math.round((await horizonsSunElevation(site.lat, site.lon, row[2])) * 1e6) / 1e6;
  }
  fs.writeFileSync(file, `${JSON.stringify(m, null, 1)}\n`);
  console.log(`fixtures/missions.json: ${m.apollo.rows.length} elevaciones de Horizons`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--cache');
  const cache = at >= 0 ? path.resolve(args[at + 1]) : path.join(HERE, '..', 'terrain', 'cache', 'pgda-illumination');
  await pgdaPoints(cache);
  if (args.includes('--horizons')) await apolloHorizons();
}
