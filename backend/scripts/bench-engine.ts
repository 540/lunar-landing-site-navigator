#!/usr/bin/env node
// Engine benchmark (#414, epic #413): how long the engine takes, calling it directly (no server, no pool), with the mask
// disk cache off. Each row prints its name and the mean milliseconds of its repetitions; the terrain rows need the DEM
// in the cache (node scripts/fetch-dem.ts) and are reported as not run without it. Times are only printed, never checked.
//
//   npm run bench [-- --json <file>]      rows; with --json also writes { node, demVersion, rows: [{ name, ms }] }
//   npm run bench -- --ephemeris-table     with the shared ephemeris table (src/ephemerisTable.ts) adopted; the rows
//                                          without terrain that sample ephemerides are timed on their second run
//   npm run bench -- --identity <N>        bit-by-bit identity of the ray-march of src/ against the frozen reference
//                                          (test/reference/horizonMarchReference.ts) at N points of the real DEM
//
// LUNAR_TERRAIN_DIR chooses the terrain folder (as everywhere in the engine; 'none' = no DEM).
import fs from 'node:fs';
import path from 'node:path';
import { moonFixedVectors } from '../src/ephemeris.ts';
import { adoptEphemerisTable, createEphemerisTable } from '../src/ephemerisTable.ts';
import { chooseMask, configureMasks } from '../src/horizon.ts';
import { sweepLandingDates } from '../src/landingSweep.ts';
import { REGIONS, rankSites, searchGrid } from '../src/search.ts';
import { snapshot, windows } from '../src/service.ts';
import { SITES, getSite } from '../src/sites.ts';
import { PRODUCTS, demVersion, layersFor, listGrids, xyToLL } from '../src/terrain/dem.ts';
import { buildMask } from '../src/terrain/horizonMask.ts';
import type { Resolution, Site } from '../src/types.ts';
import { compareMarch, randomAzimuths, seededRandom } from '../test/reference/marchIdentity.ts';

const HOUR = 3600e3, DAY = 24 * HOUR;
const START = Date.parse('2027-01-10T00:00:00Z');
const NO_DEM = 'no ejecutado: falta el DEM';

const args = process.argv.slice(2);
const opt = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? '' : null; };

configureMasks({ diskCache: false });
const version = demVersion();
const withTable = args.includes('--ephemeris-table');
if (withTable) adoptEphemerisTable(createEphemerisTable());

// ---------- identity against the frozen reference (real DEM) ----------
const IDENTITY_HEIGHTS = [0, 0.5, 2, 2.3, 10, 100];
const IDENTITY_RAYS = 40;

/** Random point south of 60°S, uniform in area. */
function southOf60(rand: () => number): [number, number] {
  const s60 = Math.sin(60 * Math.PI / 180);
  const lat = -Math.asin(s60 + rand() * (1 - s60)) * 180 / Math.PI;
  return [Math.round(lat * 1e5) / 1e5, Math.round((rand() * 360 - 180) * 1e5) / 1e5];
}

/** Random point inside one of the fine grids (≤ 80 m), 2 km away from its edge; null if there are none. */
function insideFine(rand: () => number): [number, number] | null {
  const fine = listGrids().filter((g) => g.res <= 80 && PRODUCTS[g.product]);
  if (!fine.length) return null;
  const g = fine[Math.floor(rand() * fine.length)], P = PRODUCTS[g.product], m = Math.ceil(2000 / g.res);
  const i = m + rand() * (g.w - 2 * m), j = m + rand() * (g.h - 2 * m);
  const [lat, lon] = xyToLL(P.X0 + (g.c0 + i) * g.res, P.Y0 - (g.r0 + j) * g.res);
  return [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
}

function identity(n: number): number {
  if (!version) { console.log(`Identidad del ray-march: ${NO_DEM} (backend/terrain/cache; node scripts/fetch-dem.ts).`); return 0; }
  if (!Number.isInteger(n) || n < 1) { console.error('✖ --identity espera un número de puntos entero mayor que 0'); return 2; }
  const rand = seededRandom(414);
  const resolutions: Resolution[] = ['precise', 'fast'];
  let points = 0, azimuths = 0, rays = 0, withDiff = 0, misses = 0;
  const t0 = performance.now();
  console.log(`Identidad del ray-march frente a la referencia · DEM ${version} · ${n} puntos`);
  for (let i = 0; i < n; i++) {
    const observerHeightM = IDENTITY_HEIGHTS[i % IDENTITY_HEIGHTS.length];
    let ll: [number, number] | null = null;
    for (let tries = 0; tries < 1000 && !ll; tries++) {
      const cand = (i % 3 === 2 && insideFine(rand)) || southOf60(rand);
      if (layersFor(cand[0], cand[1], 'precise') && layersFor(cand[0], cand[1], 'fast')) ll = cand;
    }
    if (!ll) { console.error('✖ No hay puntos con DEM al sur de 60°S'); return 2; }
    const [lat, lon] = ll;
    const diffs: string[] = [];
    for (const resolution of resolutions) {
      const { layers, cfg } = layersFor(lat, lon, resolution)!;
      const r = compareMarch(lat, lon, layers, { nAz: cfg.nAz, observerHeightM, stepFrac: cfg.stepFrac, grow: cfg.grow }, randomAzimuths(rand, IDENTITY_RAYS));
      azimuths += r.azimuths; rays += r.rays; diffs.push(...r.diffs);
      if (r.miss > 0) misses++;
    }
    points++;
    if (diffs.length) { withDiff++; console.log(`✖ (${lat}, ${lon}) h=${observerHeightM} m: ${diffs.length} diferencias; la primera: ${diffs[0]}`); }
    if (points % 20 === 0 || points === n) console.log(`· ${points}/${n} puntos, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  console.log(`Puntos comparados: ${points} (${misses} máscaras con muestras sin dato)`);
  console.log(`Acimuts de máscara: ${azimuths}`);
  console.log(`Rayos directos: ${rays}`);
  console.log(`Puntos con alguna diferencia: ${withDiff}`);
  return withDiff ? 1 : 0;
}

// ---------- benchmark rows ----------
interface Row { name: string; ms: number | null; skipped?: string }
const rows: Row[] = [];

/**
 * Runs `fn` `reps` times and records the mean; terrain rows (`dem`) are skipped without a DEM. With --ephemeris-table,
 * the rows marked `warm` run once untimed first, so that they are timed with the table already filled.
 */
function bench(name: string, reps: number, fn: () => unknown, { dem = false, before, warm = false }: { dem?: boolean; before?: () => void; warm?: boolean } = {}): void {
  if (dem && !version) { rows.push({ name, ms: null, skipped: 'falta el DEM' }); console.log(`${name.padEnd(72)} ${NO_DEM}`); return; }
  if (warm && withTable) fn();
  let total = 0;
  for (let r = 0; r < reps; r++) {
    before?.();
    const t0 = performance.now();
    fn();
    total += performance.now() - t0;
  }
  const ms = Math.round((total / reps) * 10) / 10;
  rows.push({ name, ms });
  console.log(`${name.padEnd(72)} ${ms.toFixed(1).padStart(9)} ms`);
}

function run(): void {
  const rim = getSite('shackleton-rim') as Site;
  const im1: [number, number] = [-80.13, 1.44];
  console.log(`Banco del motor · Node ${process.version} · DEM ${version ?? 'ninguno'} · inicio ${new Date(START).toISOString()}${withTable ? ' · tabla de efemérides adoptada' : ''}`);

  if (version) { // the grids are read on first use: load them before timing (not a row)
    const t0 = performance.now();
    for (const [lat, lon] of [[rim.lat, rim.lon], im1]) buildMask(lat, lon, { resolution: 'precise' });
    console.log(`(DEM leído de la caché en ${(performance.now() - t0).toFixed(0)} ms, fuera de las filas)`);
  }

  bench('Efemérides, un año a 1 h (moonFixedVectors × 8760)', 3, () => {
    for (let k = 0; k < 8760; k++) moonFixedVectors(new Date(START + k * HOUR));
  }, { warm: true });

  for (const resolution of ['precise', 'fast'] as Resolution[]) {
    const label = resolution === 'precise' ? 'precisa' : 'rápida';
    bench(`Máscara ${label}, shackleton-rim (buildMask)`, 3, () => buildMask(rim.lat, rim.lon, { resolution }), { dem: true });
    bench(`Máscara ${label}, (−80,13, 1,44) (buildMask)`, 3, () => buildMask(im1[0], im1[1], { resolution }), { dem: true });
  }

  const year = START + 365 * DAY, month = START + 30 * DAY, step15 = 15 * 60e3;
  const terrainMask = version ? chooseMask(rim, { terrain: true }).mask : null;
  bench('Ventanas de un año a 15 min, relieve preciso, primera llamada', 1, () => windows(rim, START, year, { stepMs: step15, mask: terrainMask }), { dem: true });
  bench('Ventanas de un año a 15 min, relieve preciso, repetida', 3, () => windows(rim, START, year, { stepMs: step15, mask: terrainMask }), { dem: true });
  bench('Ventanas de 30 d a 15 min, sin relieve', 5, () => windows(rim, START, month, { stepMs: step15, mask: null }), { warm: true });
  bench('sun-earth de un instante, sin relieve (snapshot)', 5, () => snapshot(rim, START, { mask: null }), { warm: true });

  const search = { startMs: START, endMs: month, stepMs: HOUR, mode: 'limb' as const, spacingKm: 15, refine: 2, refineTop: 5, top: 10 };
  bench('Búsqueda polo sur, 15 km, 30 d, 1 h, sin relieve', 3, () => searchGrid(REGIONS['polo-sur'], search), { warm: true });
  const fastTerrain = { ...search, terrain: { enabled: true, resolution: 'fast' } };
  bench('Búsqueda polo sur, relieve rápido, en frío', 1, () => searchGrid(REGIONS['polo-sur'], fastTerrain), { dem: true, before: () => configureMasks({ diskCache: false }) });
  bench('Búsqueda polo sur, relieve rápido, máscaras en memoria', 3, () => searchGrid(REGIONS['polo-sur'], fastTerrain), { dem: true });

  bench('Ranking de 10 sitios, 30 d, 1 h, relieve preciso (rankSites)', 1, () => rankSites(SITES.slice(0, 10), {
    startMs: START, endMs: month, stepMs: HOUR, mode: 'limb', terrain: { enabled: true, resolution: 'precise' },
  }), { dem: true, before: () => configureMasks({ diskCache: false }) });

  const sweep = { startMs: START, endMs: year, dateStepMs: 6 * HOUR, missionDays: 14, stepMs: HOUR, mode: 'limb' as const };
  bench('Barrido de fechas de un año cada 6 h, misión de 14 d, sin relieve', 3, () => sweepLandingDates(rim, sweep), { warm: true });
  bench('Barrido de fechas de un año cada 6 h, misión de 14 d, relieve preciso', 1, () => sweepLandingDates(rim, { ...sweep, terrain: { enabled: true, resolution: 'precise' } }), { dem: true });

  const json = opt('--json');
  if (json) {
    fs.mkdirSync(path.dirname(path.resolve(json)), { recursive: true });
    fs.writeFileSync(json, JSON.stringify({ node: process.version, demVersion: version, rows }, null, 2) + '\n');
    console.log(`→ ${json}`);
  }
}

const identityArg = opt('--identity');
if (identityArg !== null) process.exit(identity(Number(identityArg)));
run();
