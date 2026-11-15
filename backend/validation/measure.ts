// Measurements of the validation matrix (matrix.ts): each unit computes what the engine says for one reference point
// or one group of points, through the use cases (src/useCases.ts, the code behind /v1 and GraphQL), and returns plain
// JSON. validate.ts runs the units in worker threads; matrix.ts turns their results into the rows of the matrix.
//
// Only three groups go below the use cases, because they isolate one piece on purpose: the "matched definition"
// illumination (only the 240 m DEM, as the PGDA product), the slope against LDRM (slopeAt, the function behind
// siteSlopeOf, without its 2-decimal rounding) and the 6 h-step regression values of fixtures/illumination.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demVersion, gridsCovering, llToXY, xyToLL } from '../src/terrain/dem.ts';
import { slopeAt, slopeSummary } from '../src/terrain/slope.ts';
import { computeHorizon } from '../src/terrain/horizonMask.ts';
import { moonFixedVectors, siteFrame, topocentric } from '../src/ephemeris.ts';
import { margin } from '../src/visibility.ts';
import { getSite } from '../src/sites.ts';
import { horizonProfile, landingDates, rank, search, sunEarth, track, visibilityWindows } from '../src/useCases.ts';
import { directionReference, separationDeg } from '../../data/test/accuracy.ts';
import type { HorizonMask, Site, Vec3 } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const fixture = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf8')) as T;

const HOUR_MS = 3600e3;
const DAY_MS = 86400e3;
/** One nodal cycle (18.6 years) from 2010-01-01: the period of the PGDA maps. */
export const CYCLE = { startMs: Date.parse('2010-01-01T00:00:00Z'), days: 6793.5 };
const cycleEndMs = CYCLE.startMs + CYCLE.days * DAY_MS;

// ---------------------------------------------------------------- fixtures

export interface PgdaPoints {
  products: Record<'earth65' | 'earth85' | 'sun65' | 'sun85' | 'skyv65', { product: string; version: string; created: string; resolutionM: number; url: string }>;
  /** id, catalogue site id or null, lat, lon, earth65, earth85, sun65, sun85, skyv65 */
  points: [string, string | null, number, number, number | null, number | null, number | null, number | null, number | null][];
}
export interface Glaser { source: string; period: [string, string]; points: [string, 1 | 2, number, number, number, number, number, number][] }
export interface Leone { source: string; points: [string, number, number, number][] }
export interface Missions {
  coordinates: { rows: [string, number, number, string, number][] };
  facts: {
    blueghost1: { landing: string; daylightHours: number; source: string };
    slim: { landing: string; firstNightDateJst: string; source: string };
    chandrayaan3: { landing: string; landerSleep: string; expectedSunrise: string; source: string };
  };
  apollo: { source: string; rows: [string, string, string, number | null, number][] };
}
export interface IllumFixture { points: [string, number, number, number, number][] }
export interface PsrFixture { points: [string, number, number, 0 | 1, boolean, number][] }
export interface SlopeFixture { cap: [number, number, number, number, number][]; win: [number, number, number, number, number, number][] }

/** A custom point as the API builds it from lat/lon. */
const customSite = (lat: number, lon: number, name = 'punto'): Site => ({ id: 'custom', name, lat, lon, custom: true });

/** Site of a PGDA point: the catalogue entry (as `site=<id>`) or a custom point. Fails if the catalogue moved the site. */
function pgdaSite(id: string): Site {
  const p = fixture<PgdaPoints>('pgda-points.json').points.find((q) => q[0] === id)!;
  if (!p[1]) return customSite(p[2], p[3], id);
  const s = getSite(p[1])!;
  if (s.lat !== p[2] || s.lon !== p[3]) throw new Error(`${s.id} ha cambiado de coordenadas: regenerar fixtures/pgda-points.json (node validation/fetch-fixtures.ts)`);
  return s;
}

/** Sun time fraction and Sun windows of a site over [startMs, endMs] with terrain (limb, the API default). */
function terrainWindows(site: Site, startMs: number, endMs: number, observerHeightM: number) {
  const r = visibilityWindows({ site, startMs, endMs, mode: 'limb', terrain: { observerHeightM } });
  const hours = (endMs - startMs) / HOUR_MS;
  return { sun: r.windows.sun.totalHours / hours, sunWindows: r.windows.sun.windows };
}

/** Visible-sky solid angle (sr) of a horizon profile: Σ (1 − sin h) · Δaz. */
const skySolidAngle = (mask: HorizonMask): number => Array.from(mask.el).reduce((a: number, h: number) => a + (1 - Math.sin((h * Math.PI) / 180)), 0) * ((mask.stepDeg * Math.PI) / 180);

/** Longest stretch without any Sun window inside [startMs, endMs], in hours (the ends count as edges). */
function longestShadowH(windows: readonly { start: string; end: string }[], startMs: number, endMs: number): number {
  let prev = startMs, gap = 0;
  for (const w of windows) { gap = Math.max(gap, Date.parse(w.start) - prev); prev = Math.max(prev, Date.parse(w.end)); }
  return Math.max(gap, endMs - prev) / HOUR_MS;
}

// ---------------------------------------------------------------- units

export type Unit =
  | { kind: 'pgda'; id: string }
  | { kind: 'glaser'; index: number }
  | { kind: 'glaserNear'; index: number }
  | { kind: 'footprint'; id: string }
  | { kind: 'leone'; index: number }
  | { kind: 'horizons' } | { kind: 'apollo' } | { kind: 'missions' } | { kind: 'consistency' }
  | { kind: 'slope' } | { kind: 'psr' } | { kind: 'illumination240' };

export const unitKey = (u: Unit): string => Object.values(u).join(':');

/** Which units need which terrain data (without it they are not run). */
export const NEEDS: Partial<Record<Unit['kind'], 'dem' | 'cap'>> = { pgda: 'dem', glaser: 'dem', glaserNear: 'dem', footprint: 'dem', leone: 'dem', slope: 'dem', illumination240: 'dem', psr: 'cap' };

/** Every unit of the matrix, heaviest first (so the pool ends together). */
export function allUnits(): Unit[] {
  const points = fixture<Glaser>('glaser2018.json').points;
  const glaser = points.map((_, index): Unit => ({ kind: 'glaser', index }));
  const near = points.flatMap((p, index): Unit[] => (p[1] === 1 ? [{ kind: 'glaserNear', index }] : []));
  const pgda = fixture<PgdaPoints>('pgda-points.json').points.map((p): Unit => ({ kind: 'pgda', id: p[0] }));
  const leone = fixture<Leone>('leone2023.json').points.map((_, index): Unit => ({ kind: 'leone', index }));
  const footprint = FOOTPRINT_SITES.map((id): Unit => ({ kind: 'footprint', id }));
  return [...near, ...footprint, ...glaser, { kind: 'consistency' }, { kind: 'psr' }, ...pgda, ...leone, { kind: 'illumination240' }, { kind: 'slope' }, { kind: 'missions' }, { kind: 'apollo' }, { kind: 'horizons' }];
}

export function runUnit(u: Unit): unknown {
  switch (u.kind) {
    case 'pgda': return pgdaUnit(u.id);
    case 'glaser': return glaserUnit(u.index);
    case 'glaserNear': return glaserNearUnit(u.index);
    case 'footprint': return footprintUnit(u.id);
    case 'leone': return leoneUnit(u.index);
    case 'horizons': return horizonsUnit();
    case 'apollo': return apolloUnit();
    case 'missions': return missionsUnit();
    case 'consistency': return consistencyUnit();
    case 'slope': return slopeUnit();
    case 'psr': return psrUnit();
    case 'illumination240': return illumination240Unit();
  }
}

export interface PgdaHeight { sun: number; earth: number; skySr: number | null }
export type PgdaResult = Record<'h0' | 'h2', PgdaHeight>;
/** Sun and Earth time fraction over 18.6 years (/v1/rank, 1 h step like the PGDA maps) with terrain at one height. */
function cycleFractions(site: Site, observerHeightM: number): { sun: number; earth: number } {
  const { metrics } = rank({ sites: [site], startMs: CYCLE.startMs, days: CYCLE.days, terrain: { observerHeightM } }).results[0].cell;
  return { sun: metrics.sunFraction, earth: metrics.earthFraction };
}
/** One PGDA point at 0 m and 2 m: Sun and Earth time fraction (/v1/rank) and the visible-sky solid angle (/v1/horizon). */
function pgdaUnit(id: string): PgdaResult {
  const site = pgdaSite(id);
  const at = (h: number): PgdaHeight => {
    const { mask } = horizonProfile({ site, observerHeightM: h });
    return { ...cycleFractions(site, h), skySr: mask ? skySolidAngle(mask) : null };
  };
  return { h0: at(0), h2: at(2) };
}

export interface GlaserResult { vis: number; avg: number; shadowH: number }
/** One point of Gläser 2018: % of time with Sun and longest shadow (/v1/windows), mean visible disc (/v1/rank), 2017–2037. */
function glaserUnit(index: number): GlaserResult {
  const g = fixture<Glaser>('glaser2018.json');
  const [, , lat, lon, heightM] = g.points[index];
  const site = customSite(lat, lon);
  const [startMs, endMs] = g.period.map(Date.parse);
  const w = terrainWindows(site, startMs, endMs, heightM);
  const r = rank({ sites: [site], startMs, days: (endMs - startMs) / DAY_MS, terrain: { observerHeightM: heightM } });
  return { vis: w.sun * 100, avg: r.results[0].cell.metrics.energy * 100, shadowH: longestShadowH(w.sunWindows, startMs, endMs) };
}

/** Half-width (m) and step (m) of the grid of glaserNearUnit around a published coordinate. */
export const NEAR = { halfM: 40, stepM: 10 };
/**
 * Footprint of a 60 m PGDA pixel (footprintUnit): pixelM is its side; the points are the middles of 6 × 6 cells of
 * stepM inside the pixel (offsets ±25 m, every 10 m), so none lies on an edge shared with a neighbouring pixel.
 */
export const FOOTPRINT = { halfM: 25, stepM: 10, pixelM: 60 };

export interface NearPoint { dx: number; dy: number; lat: number; lon: number }
/**
 * Grid around a coordinate: offsets dx, dy ∈ {−halfM, −halfM + stepM, …, halfM} m on the polar stereographic
 * projection of the DEM (llToXY / xyToLL); with NEAR, 81 points. The centre (0, 0) is the coordinate itself.
 */
export function nearGrid(lat: number, lon: number, { halfM, stepM } = NEAR): NearPoint[] {
  const [x0, y0] = llToXY(lat, lon);
  const out: NearPoint[] = [];
  for (let dy = -halfM; dy <= halfM; dy += stepM) {
    for (let dx = -halfM; dx <= halfM; dx += stepM) {
      const [la, lo] = dx === 0 && dy === 0 ? [lat, lon] : xyToLL(x0 + dx, y0 + dy);
      out.push({ dx, dy, lat: la, lon: lo });
    }
  }
  return out;
}

/**
 * Centre of the PGDA pixel that contains a coordinate, with the same indexing as sample() in fetch-fixtures.ts
 * (pixel edges at multiples of pixelM on the projection, an even LINES), and the footprint grid around it: 36 points,
 * offsets dx, dy relative to the pixel centre; siteOffsetM is the offset of the coordinate from that centre.
 */
export function pixelFootprint(lat: number, lon: number, { halfM, stepM, pixelM } = FOOTPRINT): { grid: NearPoint[]; centre: { lat: number; lon: number }; siteOffsetM: [number, number] } {
  const [x, y] = llToXY(lat, lon);
  const cx = (Math.floor(x / pixelM) + 0.5) * pixelM, cy = -(Math.floor(-y / pixelM) + 0.5) * pixelM;
  const grid: NearPoint[] = [];
  for (let dy = -halfM; dy <= halfM; dy += stepM) {
    for (let dx = -halfM; dx <= halfM; dx += stepM) {
      const [la, lo] = xyToLL(cx + dx, cy + dy);
      grid.push({ dx, dy, lat: la, lon: lo });
    }
  }
  const [clat, clon] = xyToLL(cx, cy);
  return { grid, centre: { lat: clat, lon: clon }, siteOffsetM: [x - cx, y - cy] };
}

/** Metrics of the rank use case for every point of a grid, in grid order (one call: the 10-site cap is the API's). */
function gridMetrics(grid: readonly NearPoint[], startMs: number, days: number, observerHeightM: number) {
  const sites = grid.map((p, i) => ({ ...customSite(p.lat, p.lon), id: String(i) }));
  const r = rank({ sites, startMs, days, terrain: { observerHeightM, refineDeg: 0 } });
  const byId = new Map(r.results.map(({ cell }) => [cell.id, cell.metrics]));
  return grid.map((_, i) => byId.get(String(i))!);
}

export interface GlaserNearResult extends GlaserResult {
  /** Offset (m) of the best point from the published coordinate on the projection. */
  dx: number; dy: number;
  /** Minimum and maximum % of time with Sun among the 9 points within ±10 m. */
  vis10: [number, number];
}
/** Metrics of one grid point that glaserNear reads (those of the rank use case). */
export interface NearMetrics { sunFraction: number; energy: number; longestNightH: number }
/**
 * The best point of a grid and the ±10 m range (pure, so it can be tested without DEM): the highest Sun fraction and,
 * on a tie, the closest to the centre; vis10 is the minimum and maximum % with Sun among the points within ±10 m.
 */
export function bestNear(grid: readonly NearPoint[], metrics: readonly NearMetrics[]): GlaserNearResult {
  const dist = (i: number): number => Math.hypot(grid[i].dx, grid[i].dy);
  let best = 0;
  for (let i = 1; i < grid.length; i++) {
    const a = metrics[i].sunFraction, b = metrics[best].sunFraction;
    if (a > b || (a === b && dist(i) < dist(best))) best = i;
  }
  const near10 = grid.flatMap((p, i) => (Math.abs(p.dx) <= NEAR.stepM && Math.abs(p.dy) <= NEAR.stepM ? [metrics[i].sunFraction * 100] : []));
  const m = metrics[best];
  return { vis: m.sunFraction * 100, avg: m.energy * 100, shadowH: m.longestNightH, dx: grid[best].dx, dy: grid[best].dy, vis10: [Math.min(...near10), Math.max(...near10)] };
}

/**
 * One point of Gläser 2018 table 1 (observer at 0 m) with the matched definition: at ground level the result depends
 * on the position within metres and the published coordinates are rounded (latitude to 1e-4°, ~3 m; longitude to
 * 0.01°), so the 81 points of nearGrid are evaluated with the rank use case (2017–2037, 1 h step, mask only:
 * refineDeg 0) and the best one is kept (bestNear).
 */
function glaserNearUnit(index: number): GlaserNearResult {
  const g = fixture<Glaser>('glaser2018.json');
  const [, table, lat, lon, heightM] = g.points[index];
  if (table !== 1) throw new Error(`glaserNear: el punto ${index} no es de la tabla 1`);
  const [startMs, endMs] = g.period.map(Date.parse);
  const grid = nearGrid(lat, lon);
  return bestNear(grid, gridMetrics(grid, startMs, (endMs - startMs) / DAY_MS, heightM));
}

/** PGDA points compared with the footprint of their 60 m pixel (#85): shackleton-rim, in the deep pole. */
export const FOOTPRINT_SITES = ['shackleton-rim'] as const;
export interface FootprintResult {
  /** % of time with Sun: mean, minimum and maximum over the 36 points of the pixel, and the value at the site. */
  mean: number; min: number; max: number; centre: number;
}
/**
 * Matched definition of a PGDA 60 m pixel (AVGVISIB_85S_060M is "observer on the ground", per pixel): the % of time
 * with Sun of the rank use case over 18.6 years (CYCLE, 1 h step, observer at 0 m, mask only: refineDeg 0) at the
 * 36 points inside the pixel that contains the site (pixelFootprint). The site is evaluated apart (`centre`).
 */
function footprintUnit(id: string): FootprintResult {
  const site = pgdaSite(id);
  const { grid } = pixelFootprint(site.lat, site.lon);
  const all = [...grid, { dx: 0, dy: 0, lat: site.lat, lon: site.lon }];
  const vis = gridMetrics(all, CYCLE.startMs, CYCLE.days, 0).map((m) => m.sunFraction * 100);
  const inside = vis.slice(0, grid.length);
  return { mean: inside.reduce((a, b) => a + b, 0) / inside.length, min: Math.min(...inside), max: Math.max(...inside), centre: vis[grid.length] };
}

/** One point of Leone 2023 at 0 m and 2 m: % of time with the Earth over 18.6 years (/v1/rank, 1 h step). */
function leoneUnit(index: number): Record<'h0' | 'h2', number> {
  const [, lat, lon] = fixture<Leone>('leone2023.json').points[index];
  const site = customSite(lat, lon);
  return { h0: cycleFractions(site, 0).earth * 100, h2: cycleFractions(site, 2).earth * 100 };
}

/**
 * Direction error (°) of every point of the Horizons fixture through /v1/track: max(separation, |Δelevation|), as
 * data/test/accuracy.ts; `labels` names each point (site, body and instant) for `npm run validate -- --view`.
 */
function horizonsUnit(): { errorsDeg: number[]; labels: string[] } {
  const ref = directionReference, stepMs = ref.stepMinutes * 60e3, startMs = Date.parse(ref.start);
  const errorsDeg: number[] = [], labels: string[] = [];
  for (const s of ref.sites) {
    const { series } = track({ site: { id: s.id, name: s.id, lat: s.lat, lon: s.lon, heightKm: s.heightKm }, startMs, endMs: startMs + (ref.count - 1) * stepMs, stepMs });
    for (const body of ['sun', 'earth'] as const) {
      const want = ref.series.find((q) => q.site === s.id && q.body === body)!;
      const got = series[body];
      for (let i = 0; i < ref.count; i++) {
        errorsDeg.push(Math.max(separationDeg(got.az[i], got.el[i], want.az[i], want.el[i]), Math.abs(got.el[i] - want.el[i])));
        labels.push(`${s.id} · ${body === 'sun' ? 'Sol' : 'Tierra'} · ${new Date(startMs + i * stepMs).toISOString().slice(0, 16)}Z`);
      }
    }
  }
  return { errorsDeg, labels };
}

/** Sun elevation at the Apollo instants (/v1/sun-earth, no terrain): [ours, WOTM or null, Horizons]. */
function apolloUnit(): { rows: [number, number | null, number][] } {
  return {
    rows: fixture<Missions>('missions.json').apollo.rows.map(([id, , time, wotm, horizons]) =>
      [sunEarth({ site: getSite(id)!, dateMs: Date.parse(time) }).snapshot.bodies.sun.elevationDeg, wotm, horizons]),
  };
}

export interface MissionsResult {
  coordinates: { id: string; distM: number; tolM: number }[];
  blueGhostDaylightH: number;
  slimFirstSunsetJst: string;
  ch3: { sunset: string; sunrise: string };
}
/** Catalogue coordinates against the official ones, and the dated facts of real missions (/v1/windows). */
function missionsUnit(): MissionsResult {
  const m = fixture<Missions>('missions.json');
  const R = 1737.4e3, D = Math.PI / 180;
  const dist = (a: number, b: number, c: number, d: number): number =>
    2 * R * Math.asin(Math.sqrt(Math.sin(((c - a) * D) / 2) ** 2 + Math.cos(a * D) * Math.cos(c * D) * Math.sin(((d - b) * D) / 2) ** 2));
  const coordinates = m.coordinates.rows.map(([id, lat, lon, , tolM]) => { const s = getSite(id)!; return { id, distM: dist(s.lat, s.lon, lat, lon), tolM }; });
  const firstSunset = (id: string, from: string, days: number, terrain: boolean): ReturnType<typeof visibilityWindows>['windows']['sun']['windows'] => {
    const startMs = Date.parse(from);
    return visibilityWindows({ site: getSite(id)!, startMs, endMs: startMs + days * DAY_MS, mode: 'limb', terrain: terrain ? { observerHeightM: 2 } : null }).windows.sun.windows;
  };
  const bg = m.facts.blueghost1, slim = m.facts.slim, ch3 = m.facts.chandrayaan3;
  const bgEnd = Date.parse(firstSunset('blueghost1', bg.landing, 18, false)[0].end);
  const slimEnd = Date.parse(firstSunset('slim', slim.landing, 16, false)[0].end);
  const ch3w = firstSunset('chandrayaan3', ch3.landing, 38, true);
  return {
    coordinates,
    blueGhostDaylightH: (bgEnd - Date.parse(bg.landing)) / HOUR_MS,
    slimFirstSunsetJst: new Date(slimEnd + 9 * HOUR_MS).toISOString().slice(0, 10),
    ch3: { sunset: ch3w[0].end, sunrise: ch3w[1].start },
  };
}

export interface ConsistencyResult {
  rankVsWindowsPp: number[]; landingVsRank: number[]; searchVsRank: number[];
  /** Name of each value of the three lists, in order (for `npm run validate -- --view`). */
  labels: { rankVsWindows: string[]; landing: string[]; search: string[] };
}
/** No official truth: rank against windows, landing-dates against rank on its best dates and search against rank on its best point. */
function consistencyUnit(): ConsistencyResult {
  const ids = ['im1', 'im2-objetivo', 'im2-alunizaje', 'chandrayaan3', 'shackleton-rim', 'apollo11', 'slim'];
  const sites = ids.map((id) => getSite(id)!);
  const rankVsWindowsPp: number[] = [], rankVsWindowsLabels: string[] = [];
  for (const terrain of [null, { observerHeightM: 2 }]) for (const start of ['2027-01-01', '2028-06-15']) {
    const startMs = Date.parse(start), days = 30, endMs = startMs + days * DAY_MS, hours = days * 24;
    const r = rank({ sites, startMs, days, terrain });
    for (const { cell } of r.results) {
      const w = visibilityWindows({ site: getSite(cell.id!)!, startMs, endMs, terrain }).windows;
      rankVsWindowsPp.push(...[[cell.metrics.sunFraction, w.sun.totalHours], [cell.metrics.earthFraction, w.earth.totalHours], [cell.metrics.bothFraction, w.sunAndEarth.totalHours]]
        .map(([f, h]) => (f - h / hours) * 100));
      rankVsWindowsLabels.push(...['Sol', 'Tierra', 'ambos'].map((what) => `${cell.id} · ${start} · ${terrain ? 'relieve' : 'sin relieve'} · ${what}`));
    }
  }
  const site = getSite('im2-objetivo')!, terrain = { observerHeightM: 2 }, missionDays = 14, startMs = Date.parse('2027-01-01');
  const sweep = landingDates({ site, startMs, endMs: startMs + 30 * DAY_MS, dateStepMs: DAY_MS, missionDays, top: 3, terrain }).sweep;
  const landingVsRank = sweep.best.map((d) => rank({ sites: [site], startMs: Date.parse(d.date), days: missionDays, terrain }).results[0].cell.score - d.score);
  const g = search({ region: { latMin: -85.2, latMax: -84.4, lonMin: 25, lonMax: 35 }, startMs, days: missionDays, spacingKm: 5 }).grid;
  const searchVsRank = g.top.slice(0, 3).map((c) => rank({ sites: [customSite(c.lat, c.lon)], startMs, days: missionDays }).results[0].cell.score - c.score);
  return {
    rankVsWindowsPp, landingVsRank, searchVsRank,
    labels: { rankVsWindows: rankVsWindowsLabels, landing: sweep.best.map((d) => d.date), search: g.top.slice(0, 3).map((c) => `${c.lat}, ${c.lon}`) },
  };
}

export interface SlopeResult {
  hasLdrm: boolean; has20m: boolean; hasCap: boolean;
  ldrmErrors: number[];
  /** Point of each LDRM error: lat, lon and the product value (for `npm run validate -- --view`). */
  ldrmPoints: [number, number, number][];
  win100: number[]; win400: number[]; cap800: number[];
  regressions: string[];
  capFalseApt: boolean[];
}
/** Slope against the LDRM products: as is with LDRM in the cache, and the DEM fit on its own (validation/fixtures/slope.json). */
function slopeUnit(): SlopeResult {
  const F = fixture<SlopeFixture>('slope.json');
  const out: SlopeResult = { hasLdrm: false, has20m: true, hasCap: true, ldrmErrors: [], ldrmPoints: [], win100: [], win400: [], cap800: [], regressions: [], capFalseApt: [] };
  // The 20 m window points are 20 m pixel centres: some fall exactly on a border of the 50 m LDRM pixels, where the
  // 6 decimals of the fixture may pick the neighbour. Those (within 1 m of a border) are left out.
  const onBorder = (lat: number, lon: number): boolean => llToXY(lat, lon).some((v) => { const f = (((v + 304000) / 50) % 1 + 1) % 1; return f < 0.02 || f > 0.98; });
  for (const [lat, lon, p100] of [...F.cap, ...F.win]) {
    const s = slopeAt(lat, lon);
    if (s?.source === 'pgda-ldrm-100m' && !onBorder(lat, lon)) { out.ldrmErrors.push(s.slopeDeg - p100); out.ldrmPoints.push([lat, lon, p100]); }
  }
  for (const [lat, lon, , p400] of F.win) {
    const s = slopeAt(lat, lon, { baselineM: 400 });
    if (s?.source === 'pgda-ldrm-400m' && !onBorder(lat, lon)) { out.ldrmErrors.push(s.slopeDeg - p400); out.ldrmPoints.push([lat, lon, p400]); }
  }
  out.hasLdrm = out.ldrmErrors.length > 0;
  for (const [lat, lon, p100, p400, e100, e400] of F.win) {
    const a = slopeAt(lat, lon, { ldrm: false });
    if (!a || a.source !== 'dem-20m') { out.has20m = false; break; }
    const b = slopeAt(lat, lon, { baselineM: 400, ldrm: false })!;
    if (a.underestimated) out.regressions.push(`(${lat}, ${lon}) base 100 m subestimada`);
    if (Math.abs(a.slopeDeg - e100) >= 0.01 || Math.abs(b.slopeDeg - e400) >= 0.01) out.regressions.push(`(${lat}, ${lon}): ${a.slopeDeg.toFixed(3)} / ${b.slopeDeg.toFixed(3)} frente a ${e100} / ${e400}`);
    out.win100.push(a.slopeDeg - p100); out.win400.push(b.slopeDeg - p400);
  }
  for (const [lat, lon, p100, p800, e800] of F.cap) {
    const s = slopeAt(lat, lon, { baselineM: 800, ldrm: false });
    if (!s || s.source !== 'dem-160m') { out.hasCap = false; break; }
    if (Math.abs(s.slopeDeg - e800) >= 0.01) out.regressions.push(`(${lat}, ${lon}) 800 m: ${s.slopeDeg.toFixed(3)} frente a ${e800}`);
    out.cap800.push(s.slopeDeg - p800);
    // Base 100 m on the 160 m DEM: underestimated, so never "meets" a maximum slope (null); with LDRM, the true answer.
    const dem = slopeSummary(lat, lon, { maxSlopeDeg: 10, ldrm: false });
    const best = slopeSummary(lat, lon, { maxSlopeDeg: 10 });
    out.capFalseApt.push(dem.underestimated && dem.meetsMaxSlope === null && (best.source !== 'pgda-ldrm-100m' || best.meetsMaxSlope === (p100 <= 10)));
  }
  return out;
}

/** Permanent shadow: Sun time fraction over 18.6 years (/v1/rank, 1 h step, precise terrain at 0 m) at points in and out of LPSR. */
function psrUnit(): { rows: [string, 0 | 1, number][] } {
  const F = fixture<PsrFixture>('psr.json');
  const sites = F.points.map(([id, lat, lon]) => ({ ...customSite(lat, lon, id), id }));
  const r = rank({ sites, startMs: CYCLE.startMs, days: CYCLE.days, terrain: { observerHeightM: 0 } });
  const byId = new Map(r.results.map(({ cell }) => [cell.id, cell.metrics.sunFraction]));
  return { rows: F.points.map(([id, , , psr]) => [id, psr, byId.get(id)!]) };
}

/**
 * Matched definition (not a use case on purpose): the engine with ONLY the 240 m DEM, observer at 0 m, 6 h step over
 * 18.6 years, against AVGVISIB_65S_240M; each point also against its value in the 2026-11 comparison (± 0.1 pp).
 */
function illumination240Unit(): { pairs: [number, number][]; regressions: string[] } {
  const F = fixture<IllumFixture>('illumination.json');
  const n = Math.floor((CYCLE.days * 24) / 6);
  const sun: Vec3[] = [];
  for (let i = 0; i < n; i++) sun.push(moonFixedVectors(new Date(CYCLE.startMs + i * 6 * HOUR_MS)).sun);
  const pairs: [number, number][] = [], regressions: string[] = [];
  for (const [id, lat, lon, pgda, engineRef] of F.points) {
    const [x, y] = llToXY(lat, lon);
    const g = gridsCovering(x, y).find((q) => q.res === 240)!;
    const hz = computeHorizon(lat, lon, [{ g, maxD: 300000 }], { nAz: 720, observerHeightM: 0, stepFrac: 0.5, grow: 0.003 });
    const mask: HorizonMask = { stepDeg: 0.5, el: Array.from(hz.el, (v) => Math.round(v * 100) / 100), source: 'LOLA 240 m', heightM: hz.groundM };
    const frame = siteFrame({ lat, lon });
    let lit = 0;
    for (const v of sun) if (margin(topocentric(frame, v, 'sun'), mask, 'limb') > 0) lit++;
    const f = lit / n;
    if (Math.abs(f - engineRef) >= 0.001) regressions.push(`${id}: ${(f * 100).toFixed(2)} % frente a ${(engineRef * 100).toFixed(2)} % de la comparación`);
    pairs.push([f * 100, pgda * 100]);
  }
  return { pairs, regressions };
}

/** Terrain data available (the units that need it are reported as not run without it). */
export function terrainData(): { dem: boolean; cap: boolean; demVersion: string | null } {
  const version = demVersion();
  const cap = version !== null && gridsCovering(...llToXY(-89.5, 0)).some((g) => g.res === 160);
  return { dem: version !== null, cap, demVersion: version };
}

