// Search for the best landing site according to the Sun (energy) and the Earth (direct communication).
//
// Idea: evaluate many surface points with the same time samples and score them.
//  1. Grid of points spaced in KILOMETRES (not degrees: near the pole the meridians converge).
//  2. The Moon→Sun and Moon→Earth vectors are computed once per instant and reused for every point.
//  3. Per-point metrics, treating Sun and Earth as DISCS (not points):
//       - energy = mean fraction of the solar disc above the horizon (0..1) × panel factor (panel.ts), proxy for
//         available power. By default (panel 'tracking', factor 1) it assumes a panel that follows the Sun on two axes
//         (normal incidence). Not modelled: limb darkening, Sun-distance variation (±3.4 %), self-shadowing of the
//         lander, dust, cell efficiency or temperature. At the pole, with the Sun at 0–2°, a horizontal panel would get
//         ~sin(el); polar landers use vertical panels that rotate (panel 'vertical-rotating', factor cos(el));
//       - visibility = "some part of the disc shows" (limb mode by default).
//  4. Iterative refinement: take the best points and search again around them with a finer grid.
//
// Terrain: by default, smooth-Moon horizon (0°). With the `terrain` option each point uses its LOLA horizon mask
// (maskFor), including points without an id. Without `terrain` results are identical to before. The Sun (energy, Sun
// fraction, night, battery) uses the mask at the panel height and the Earth (Earth fraction, outages) the one at the
// antenna height; `bothFraction` combines both. The two heights default to `terrain.observerHeightM`.
import { R_MOON_KM, siteFrame, topocentric } from './ephemeris.ts';
import { catalogMaskFor, fastModeWarning, getRegisteredMask, isCatalogMask, maskFor, refineText, refinedMask, resolveTerrain, terrainHeights, terrainRefineDeg } from './horizon.ts';
import { sampleVectors } from './service.ts';
import { discEdge, fractionEdgeY, fractionOver, horizonAt, margin, marginOver } from './visibility.ts';
import { panelFactor, panelOption } from './panel.ts';
import { checkMaxSlope, checkSlopeBaseline, checkUncertifiedPolicy, slopeNote, slopeSummary } from './terrain/slope.ts';
import { NIGHT_EXTENSION_LIMIT_DAYS, batteryFor, checkNightMinSunFraction, extensionLimitSamples, fullNightSamples, nightBeyond, resolveBattery, watchTruncation } from './night.ts';
import type {
  BatteryOptions, BodyMasks, Cell, CellResult, CellTally, EvaluateOptions, HorizonMask, GridSearch, GridSearchOptions, LatLon, Metrics, NightEcho, NightOptions, Region, SampledVectors, ScoreVariable,
  SearchOptions, SiteRanking, SlopeEcho, SlopeRequest, Terrain, Weights, WeightsInput,
} from './types.ts';

const DEG = Math.PI / 180;
const HOUR_MS = 3600e3;
const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;

/**
 * Score variables. Each converts a metric to 0..1 (1 = best) and is multiplied by its weight.
 * Order matters: it is the summation order (keeping it guarantees bit-identical results).
 *   periodH = length of the evaluated period in hours (to normalize the streaks).
 */
export const SCORE_VARIABLES: Readonly<Record<string, ScoreVariable>> = {
  energy: { metric: 'energy', label: '⚡ Energía (fracción media del disco solar visible × factor del panel; por defecto, panel que sigue al Sol)', value: (m) => m.energy },
  comm: { metric: 'earthFraction', label: '📡 Comunicación (% del tiempo con la Tierra visible)', value: (m) => m.earthFraction },
  both: { metric: 'bothFraction', label: '⚡+📡 Sol y Tierra a la vez (% del tiempo)', value: (m) => m.bothFraction },
  night: { metric: 'longestNightH', label: '🌙 Noches cortas (1 − noche más larga / periodo)', value: (m, p) => 1 - Math.min(1, m.longestNightH / p) },
  sun: { metric: 'sunFraction', label: '☀️ Tiempo con algo de Sol (% del tiempo)', value: (m) => m.sunFraction },
  commGap: { metric: 'longestNoEarthH', label: '📵 Apagones cortos (1 − apagón de Tierra más largo / periodo)', value: (m, p) => 1 - Math.min(1, m.longestNoEarthH / p) },
  bothStreak: { metric: 'longestBothH', label: '⏱ Ventana continua Sol+Tierra más larga (/ periodo)', value: (m, p) => Math.min(1, m.longestBothH / p) },
};

/** Default weights (normalized to sum to 1). New variables start at 0: they do not change the classic score. */
export const DEFAULT_WEIGHTS: Weights = {
  energy: 0.7,
  comm: 0.3,
  both: 0,
  night: 0,
  sun: 0,
  commGap: 0,
  bothStreak: 0,
};

/**
 * Pairs of variables that measure almost the same thing over windows of up to one lunar cycle (correlation ≈ 1 measured on
 * 618,000 candidates): weighting both counts the same information twice.
 */
const REDUNDANT: [string[], string[], string][] = [
  [['night'], ['sun', 'energy'], 'night ≈ sun (en ≤14 días hay como mucho una noche: noche más larga = tiempo sin Sol)'],
  [['commGap'], ['comm'], 'commGap ≈ comm (un solo apagón por ventana)'],
  [['bothStreak'], ['both'], 'bothStreak ≈ both'],
  [['both'], ['energy', 'sun', 'comm'], 'both ≈ Sol × Tierra: sumarla a energy/sun o comm cuenta dos veces lo mismo'],
];

/** Double-counting warnings for a set of (normalized) weights. */
export function redundancyWarnings(weights: Readonly<Record<string, number>>): string[] {
  const on = (keys: string[]): boolean => keys.some((k) => (weights[k] ?? 0) > 0);
  return REDUNDANT.filter(([a, b]) => on(a) && on(b)).map(([, , why]) => `Pesos redundantes: ${why}.`);
}

/** Predefined regions (degrees; east-positive longitude, from −180 to 180). */
export const REGIONS: Record<string, Region> = {
  'polo-sur': { latMin: -90, latMax: -84, lonMin: -180, lonMax: 180 },
  'casquete-sur': { latMin: -90, latMax: -75, lonMin: -180, lonMax: 180 },
  'cara-visible': { latMin: -60, latMax: 60, lonMin: -90, lonMax: 90 },
  global: { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 },
};

/**
 * Roughly equally spaced grid (in km) within a lat/lon rectangle.
 * Rows are every `spacingKm` in latitude; in each row the number of points depends on the actual length of the parallel.
 */
export function gridCells({ latMin, latMax, lonMin, lonMax }: Region, spacingKm: number): LatLon[] {
  const dLat = spacingKm / R_MOON_KM / DEG;
  const width = lonMax - lonMin;
  const fullCircle = width >= 360 - 1e-9;
  const cells: LatLon[] = [];
  const rows = Math.max(1, Math.round((latMax - latMin) / dLat) + 1);
  for (let r = 0; r < rows; r++) {
    const lat = rows === 1 ? (latMin + latMax) / 2 : latMin + (r * (latMax - latMin)) / (rows - 1);
    const rowKm = R_MOON_KM * Math.cos(lat * DEG) * width * DEG;
    if (rowKm < spacingKm / 2) { // degenerate row (pole): a single point
      cells.push({ lat, lon: fullCircle ? 0 : (lonMin + lonMax) / 2 });
      continue;
    }
    const n = Math.max(1, Math.round(rowKm / spacingKm));
    for (let i = 0; i < n; i++) {
      const lon = fullCircle ? lonMin + ((i + 0.5) * width) / n : n === 1 ? (lonMin + lonMax) / 2 : lonMin + (i * width) / (n - 1);
      cells.push({ lat, lon: lon > 180 ? lon - 360 : lon });
    }
  }
  return cells;
}

/**
 * Whether a point lies inside the lat/lon rectangle (inclusive, with a small tolerance). Longitudes are compared modulo
 * 360; at the pole any longitude is the same point, so only the latitude counts there.
 */
export function inRegion(c: LatLon, { latMin, latMax, lonMin, lonMax }: Region): boolean {
  const eps = 1e-9;
  if (c.lat < latMin - eps || c.lat > latMax + eps) return false;
  if (lonMax - lonMin >= 360 - eps || Math.abs(c.lat) >= 90 - eps) return true;
  return [c.lon, c.lon - 360, c.lon + 360].some((lon) => lon >= lonMin - eps && lon <= lonMax + eps);
}

/** Points around a centre, within ±`radiusKm`, with spacing `spacingKm` (for refining). */
export function neighborhood(center: LatLon, radiusKm: number, spacingKm: number): LatLon[] {
  const out: LatLon[] = [];
  const k = Math.round(radiusKm / spacingKm);
  const dLat = spacingKm / R_MOON_KM / DEG;
  for (let i = -k; i <= k; i++) {
    const lat = center.lat + i * dLat;
    if (lat < -90 || lat > 90) continue;
    const c = Math.cos(lat * DEG);
    if (c < 1e-6) { out.push({ lat, lon: 0 }); continue; }
    const dLon = Math.min(360, spacingKm / (R_MOON_KM * c) / DEG);
    for (let j = -k; j <= k; j++) {
      let lon = center.lon + j * dLon;
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;
      out.push({ lat, lon });
    }
  }
  return out;
}

/** Great-circle distance between two points (km). */
export function distanceKm(a: LatLon, b: LatLon): number {
  const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return R_MOON_KM * Math.acos(Math.max(-1, Math.min(1, c)));
}

/** The `n` best, at least `minSepKm` apart (distinct zones, not near-identical neighbours). */
function diverseTop<T extends LatLon>(sorted: readonly T[], n: number, minSepKm: number): T[] {
  const out: T[] = [];
  for (const c of sorted) {
    if (out.every((o) => distanceKm(o, c) >= minSepKm)) out.push(c);
    if (out.length === n) break;
  }
  return out;
}

const key = (c: LatLon): string => `${c.lat.toFixed(4)},${c.lon.toFixed(4)}`;

/** Normalizes weights (ignoring negative/non-numeric ones) so they sum to 1. */
export function normalizeWeights(w: WeightsInput = {}): Weights {
  // Only the given weights override (an `undefined` must not cancel the default value).
  const given = Object.fromEntries(Object.entries(w).filter(([, v]) => v !== undefined && v !== null));
  for (const k of Object.keys(given)) {
    if (!SCORE_VARIABLES[k]) throw new Error(`Peso desconocido: ${k}. Variables válidas: ${Object.keys(SCORE_VARIABLES).join(', ')}`);
  }
  const merged: Record<string, number> = { ...DEFAULT_WEIGHTS, ...given };
  const clean = Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, Number.isFinite(v) && v > 0 ? v : 0]));
  const sum = Object.values(clean).reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('Al menos un peso debe ser positivo');
  return Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, v / sum])) as Weights;
}

/**
 * Score 0..100 from metrics (the same ones evaluateCell returns).
 * It is the "objective function": used by the API search and by the evals harness.
 */
export function scoreMetrics(m: Metrics, weights: Readonly<Record<string, number>>, periodH: number): number {
  let sum = 0;
  for (const [k, v] of Object.entries(SCORE_VARIABLES)) {
    const w = weights[k] ?? 0;
    if (w) sum += w * v.value(m, periodH);
  }
  return 100 * sum;
}

/** Score breakdown: how many points (out of 100) each variable with weight > 0 contributes. */
export function scoreBreakdown(m: Metrics, weights: Readonly<Record<string, number>>, periodH: number): Partial<Weights> {
  const out: Partial<Record<string, number>> = {};
  for (const [k, v] of Object.entries(SCORE_VARIABLES)) {
    const w = weights[k] ?? 0;
    if (w) out[k] = Math.round(10000 * w * v.value(m, periodH)) / 100;
  }
  return out;
}

/**
 * Metrics of a point over already computed samples.
 * Each sample represents `stepMs` of time (time resolution of the metrics = one step).
 *
 * `energy` = mean of visibleFraction(sun) × panelFactor(panel, el) (panel.ts; el = elevation of the disc centre).
 * With the default panel ('tracking') the factor is 1: a panel that follows the Sun (normal incidence), bit-identical
 * to before the option existed. The panel changes only `energy`, not sunFraction, the night, the Earth or the battery.
 * Pure geometry: no limb darkening, Sun-distance variation (±3.4 %), self-shadowing of the lander, dust, cell efficiency
 * or temperature.
 */
export function evaluateCell(
  cell: Cell, sampled: SampledVectors,
  { mode, stepMs, weights, earthMode = mode, earthMinElevationDeg = 0, terrain = null, nightMinSunFraction = 0, fullNight = false, battery = null, panel = 'tracking' }: EvaluateOptions,
): CellResult {
  const frame = siteFrame(cell);
  const { sun: mask, earth: earthMask } = cellMasks(cell, terrain);
  const n = sampled.vecs.length;
  const tracking = panel === 'tracking';
  let energy = 0, sunN = 0, earthN = 0, bothN = 0;
  let night = 0, maxNight = 0, noEarth = 0, maxNoEarth = 0, both = 0, maxBoth = 0;
  let minSunEl = Infinity, maxSunEl = -Infinity;
  // Night samples at the start of the period (for the full night). With nightMinSunFraction > 0 a sample is night when
  // the visible fraction of the disc is below it; with 0 (default) when the Sun is not visible (same as before).
  let leadingNight = 0, leadingOpen = true;
  // Sun horizon: one per sample for the margin and the fraction. With the hybrid horizon it is refined near the edge of
  // `mode` and near the fraction edge (upper limb or, with nightMinSunFraction, the edge of that fraction).
  const fracY = fractionEdgeY(nightMinSunFraction);
  for (let i = 0; i < n; i++) {
    const v = sampled.vecs[i];
    const sun = topocentric(frame, v.sun, 'sun');
    const earth = topocentric(frame, v.earth, 'earth');
    const hSun = horizonAt(sun, mask, discEdge(sun, mode), sun.el + fracY * sun.radiusDeg);
    const sunVis = marginOver(sun, hSun, mode) > 0;
    const earthVis = margin(earth, earthMask, earthMode, earthMinElevationDeg) > 0;
    const sunFrac = fractionOver(sun, hSun);
    // Tracking (default): factor 1, added as is so the result stays bit-identical.
    energy += tracking ? sunFrac : sunFrac * panelFactor(panel, sun.el);
    if (sun.el < minSunEl) minSunEl = sun.el;
    if (sun.el > maxSunEl) maxSunEl = sun.el;
    if (sunVis) sunN++;
    if (nightMinSunFraction > 0 ? sunFrac >= nightMinSunFraction : sunVis) { night = 0; leadingOpen = false; } else {
      night++;
      if (night > maxNight) maxNight = night;
      if (leadingOpen) leadingNight++;
    }
    if (earthVis) { earthN++; noEarth = 0; } else { noEarth++; if (noEarth > maxNoEarth) maxNoEarth = noEarth; }
    if (sunVis && earthVis) { bothN++; both++; if (both > maxBoth) maxBoth = both; } else both = 0;
  }
  const tally: CellTally = { n, energy, sunN, earthN, bothN, maxNight, maxNoEarth, maxBoth, minSunEl, maxSunEl, leadingNight, trailingNight: night };
  return cellResult(cell, mask, tally, { stepMs, weights, terrain, fullNight, battery },
    (dir) => nightBeyond(frame, mask, sampled, stepMs, dir, mode, nightMinSunFraction));
}

/**
 * Horizon masks evaluateCell uses for a point: `sun` at the panel height, `earth` at the antenna height. With terrain:
 * LOLA masks of the point (null = no DEM coverage → 0°), with the hybrid horizon unless terrain.refineDeg is 0 (on by
 * default in precise, off in fast); with equal heights, one mask (the same object) for both. Where the DEM gives no mask
 * (no DEM in the cache, or no coverage) a catalogue site — by id or at the same coordinates — uses its precomputed
 * catalogue mask, as the single-site routes do (since API 1.13.0).
 * Without terrain: only hand-registered masks, the same for both bodies.
 */
export function cellMasks(cell: Cell, terrain: Terrain | null | undefined): BodyMasks {
  if (!terrain?.enabled) {
    const mask = cell.id ? getRegisteredMask(cell.id) : null;
    return { sun: mask, earth: mask };
  }
  const { panelHeightM, antennaHeightM } = terrainHeights(terrain);
  const refineDeg = terrainRefineDeg(terrain);
  const at = (h: number): HorizonMask | null => refinedMask(maskFor(cell.lat, cell.lon, h, terrain.resolution) ?? catalogMaskFor(cell, h), refineDeg);
  const sun = at(panelHeightM);
  return { sun, earth: antennaHeightM === panelHeightM ? sun : at(antennaHeightM) };
}

/**
 * Builds evaluateCell's result from the tallies of one period (in samples). Shared with landingSweep.ts, so a sweep date
 * and evaluateCell over the same samples give the same object. `extend(dir)` counts the night samples past one end of
 * the period (only called with `fullNight`).
 */
export function cellResult(
  cell: Cell, mask: HorizonMask | null, t: CellTally,
  { stepMs, weights, terrain = null, fullNight = false, battery = null }: Pick<EvaluateOptions, 'stepMs' | 'weights' | 'terrain' | 'fullNight' | 'battery'>,
  extend: (dir: 1 | -1) => number,
): CellResult {
  const { n } = t;
  const h = stepMs / HOUR_MS;
  const periodH = n * h;
  const watch = watchTruncation(extend, extensionLimitSamples(stepMs));
  const fullH = fullNight ? fullNightSamples(n, t.maxNight, t.leadingNight, t.trailingNight, watch.extend) * h : null;
  const bat = battery ? batteryFor(round(fullH ?? t.maxNight * h, 1), battery) : null;
  const m = {
    energy: t.energy / n,
    sunFraction: t.sunN / n,
    earthFraction: t.earthN / n,
    bothFraction: t.bothN / n,
    longestNightH: t.maxNight * h,
    longestNoEarthH: t.maxNoEarth * h,
    longestBothH: t.maxBoth * h,
    sunElevationRangeDeg: [t.minSunEl, t.maxSunEl],
  };
  const score = scoreMetrics(m, weights, periodH);
  return {
    lat: round(cell.lat, 4),
    lon: round(cell.lon, 4),
    ...(cell.id ? { id: cell.id, name: cell.name } : {}),
    ...(terrain?.enabled ? { horizon: mask ? 'mask' : 'sphere', ...(mask ? { heightM: mask.heightM } : {}), ...(isCatalogMask(mask) ? { horizonSource: 'catalog' as const } : {}) } : {}),
    score: round(score, 2),
    periodH,
    metrics: {
      energy: round(m.energy, 4),
      sunFraction: round(m.sunFraction, 4),
      earthFraction: round(m.earthFraction, 4),
      bothFraction: round(m.bothFraction, 4),
      longestNightH: round(m.longestNightH, 1),
      longestNoEarthH: round(m.longestNoEarthH, 1),
      longestBothH: round(m.longestBothH, 1),
      ...(fullH !== null ? { longestNightFullH: round(fullH, 1) } : {}),
      ...(bat ? { batteryKWh: bat.kWh, batteryKg: bat.kg } : {}),
      sunElevationRangeDeg: m.sunElevationRangeDeg.map((x) => round(x, 3)),
    },
    ...(fullH !== null && watch.truncated() ? { nightTruncated: true as const } : {}),
  };
}

/**
 * Validated night options of a search plus what the response echoes. All off by default: then `opts` adds nothing
 * and the response has no `night`/`battery` (identical to before).
 */
export function resolveNightOptions(o: NightOptions): { opts: NightOptions; echo: { night?: NightEcho; battery?: BatteryOptions } } {
  const nightMinSunFraction = checkNightMinSunFraction(o.nightMinSunFraction);
  const fullNight = o.fullNight === true;
  const battery = o.battery ? resolveBattery(o.battery) : null;
  const opts: NightOptions = {
    ...(nightMinSunFraction > 0 ? { nightMinSunFraction } : {}),
    ...(fullNight ? { fullNight } : {}),
    ...(battery ? { battery } : {}),
  };
  const echo = {
    ...(nightMinSunFraction > 0 || fullNight
      ? { night: { minSunFraction: nightMinSunFraction, fullNight, ...(fullNight ? { extensionLimitDays: NIGHT_EXTENSION_LIMIT_DAYS } : {}) } }
      : {}),
    ...(battery ? { battery } : {}),
  };
  return { opts, echo };
}

/** Heights of a terrain in words: «observador a 2 m» or, when they differ, «panel a 10 m (Sol) y antena a 2 m (Tierra)». */
export function heightsText(t: Terrain): string {
  if (t.panelHeightM === undefined && t.antennaHeightM === undefined) return `observador a ${t.observerHeightM} m`;
  const { panelHeightM, antennaHeightM } = terrainHeights(t);
  return `panel a ${panelHeightM} m (Sol) y antena a ${antennaHeightM} m (Tierra)`;
}

/** Validated slope request of a search (null = not asked for: the response does not change). */
export function resolveSlope(o: Partial<SlopeRequest> | null | undefined): SlopeRequest | null {
  if (!o) return null;
  const maxSlopeDeg = checkMaxSlope(o.maxSlopeDeg);
  const uncertified = checkUncertifiedPolicy(o.uncertified);
  return { baselineM: checkSlopeBaseline(o.baselineM), ...(maxSlopeDeg !== undefined ? { maxSlopeDeg, uncertified } : {}) };
}

/** Adds `slope` to a result (when asked for), at the point's own coordinates (`at`), not the ones rounded for the response. */
const withSlope = <T extends CellResult>(c: T, slope: SlopeRequest | null, at: LatLon): T => (slope ? { ...c, slope: slopeSummary(at.lat, at.lon, slope) } : c);
/**
 * Does a result pass the slope filter? No filter = yes; a point without DEM does not; an uncertified slope
 * (meetsMaxSlope null: underestimated) only with `uncertified: 'keep'`.
 */
const passesSlope = (c: CellResult, slope: SlopeRequest | null): boolean => {
  const meets = c.slope?.meetsMaxSlope;
  if (meets === undefined || meets === true) return true;
  return meets === null && slope?.uncertified === 'keep';
};

function slopeEcho(slope: SlopeRequest, cells: readonly CellResult[]): SlopeEcho {
  const filter = slope.maxSlopeDeg !== undefined;
  const excluded = filter ? cells.filter((c) => !passesSlope(c, slope)).length : undefined;
  const uncertifiedCount = filter ? cells.filter((c) => c.slope?.meetsMaxSlope === null).length : undefined;
  return { ...slope, ...(excluded !== undefined ? { excluded, uncertifiedCount } : {}), note: slopeNote(cells.map((c) => c.slope!), slope.baselineM) };
}

const NOTE = 'Sin relieve: horizonte de Luna lisa a 0°. En los polos los resultados son optimistas. Sol y Tierra se tratan como discos.';
const terrainNote = (t: Terrain, cells: readonly Pick<CellResult, 'horizon' | 'horizonSource' | 'lat' | 'lon'>[]): string => {
  const without = cells.filter((c) => c.horizon === 'sphere').length;
  const fromCatalog = cells.filter((c) => c.horizonSource === 'catalog').length;
  const warning = fastModeWarning(t, cells.filter((c) => c.horizon === 'mask'));
  const refine = cells.some((c) => c.horizon === 'mask') && t.demVersion ? `; ${refineText(t)}` : '';
  return `Con relieve LOLA (${t.resolution === 'fast' ? 'modo rápido, 160/240 m' : 'modo preciso, 20 m + 160/240 m'}, ${heightsText(t)}${refine}).`
    + (t.demVersion ? '' : fromCatalog
      ? ` AVISO: no hay DEM en la caché; ${fromCatalog} de ${cells.length} puntos usan la máscara precalculada del catálogo y el resto, horizonte a 0° (node scripts/fetch-dem.ts).`
      : ' AVISO: no hay DEM en la caché, se ha usado horizonte a 0° (node scripts/fetch-dem.ts).')
    + (t.demVersion && without ? ` ${without} de ${cells.length} puntos quedan fuera de la cobertura del DEM y usan horizonte a 0°.` : '')
    + (warning ? ` ${warning}` : '')
    + ' Sol y Tierra se tratan como discos.';
};

/** Progress of a search (asynchronous jobs of /v1/search): level of the refinement and points evaluated. */
export interface SearchProgress { level: number; levels: number; levelDone: number; levelTotal: number; evaluated: number; fraction: number }
let progressHook: ((p: SearchProgress) => void) | null = null;
/** Receives the progress of the searches of this thread (null = nobody). It does not change any result. */
export function setSearchProgress(fn: ((p: SearchProgress) => void) | null): void { progressHook = fn; }
/** Rough fraction done: each refinement level weighs the same. */
const report = (level: number, levels: number, done: number, total: number, evaluated: number): void => {
  progressHook?.({ level, levels, levelDone: done, levelTotal: total, evaluated, fraction: Math.round(((level + (total ? done / total : 1)) / levels) * 1000) / 1000 });
};

/**
 * Grid search with iterative refinement.
 * @param {{latMin,latMax,lonMin,lonMax}} region
 * @param {{startMs:number, endMs:number, stepMs:number, mode:string, spacingKm:number, refine:number, refineTop:number, top:number, weights:object}} o
 */
export function searchGrid(region: Region, o: GridSearchOptions): GridSearch {
  const t0 = performance.now();
  const weights = normalizeWeights(o.weights);
  const sampled = sampleVectors(o.startMs, o.endMs, o.stepMs);
  const terrain = resolveTerrain(o.terrain, 'fast');
  const night = resolveNightOptions(o);
  const panel = panelOption(o.panel);
  const slope = resolveSlope(o.slope);
  const opts = { mode: o.mode, stepMs: o.stepMs, weights, earthMode: o.earthMode ?? o.mode, earthMinElevationDeg: o.earthMinElevationDeg ?? 0, terrain, ...night.opts, ...panel };
  const seen: Map<string, CellResult & { level: number }> = new Map();
  const levels: GridSearch['levels'] = [];

  let spacing = o.spacingKm;
  let candidates = gridCells(region, spacing);
  for (let level = 0; level <= o.refine; level++) {
    let added = 0, done = 0;
    for (const c of candidates) {
      done++;
      const k = key(c);
      if (seen.has(k)) continue;
      if (!inRegion(c, region)) continue;
      seen.set(k, { ...withSlope(evaluateCell(c, sampled, opts), slope, c), level });
      added++;
      if (progressHook) report(level, o.refine + 1, done, candidates.length, seen.size);
    }
    levels.push({ level, spacingKm: round(spacing, 3), evaluated: added });
    if (level === o.refine) break;
    // Next level: around the best ones, with half the spacing.
    const best = [...seen.values()].filter((c) => passesSlope(c, slope)).sort((a, b) => b.score - a.score).slice(0, o.refineTop);
    const next = spacing / 2;
    candidates = best.flatMap((b) => neighborhood(b, spacing, next));
    spacing = next;
  }

  const cells = [...seen.values()].sort((a, b) => b.score - a.score);
  return {
    kind: 'grid',
    region,
    start: new Date(o.startMs).toISOString(),
    end: new Date(o.endMs).toISOString(),
    stepMinutes: o.stepMs / 60e3,
    mode: o.mode,
    weights,
    levels,
    evaluated: cells.length,
    minSeparationKm: o.minSepKm ?? o.spacingKm,
    top: diverseTop(cells.filter((c) => passesSlope(c, slope)), o.top, o.minSepKm ?? o.spacingKm).map((c, i) => ({ rank: i + 1, ...c })),
    cells,
    ...(terrain ? { terrain } : {}),
    ...night.echo,
    ...panel,
    ...(slope ? { slope: slopeEcho(slope, cells) } : {}),
    note: terrain ? terrainNote(terrain, cells) : NOTE,
    timingMs: Math.round(performance.now() - t0),
  };
}

/** Same scoring applied to a list of named sites (catalogue or custom). */
export function rankSites(sites: readonly Cell[], o: SearchOptions): SiteRanking {
  const t0 = performance.now();
  const weights = normalizeWeights(o.weights);
  const sampled = sampleVectors(o.startMs, o.endMs, o.stepMs);
  const terrain = resolveTerrain(o.terrain, 'precise');
  const night = resolveNightOptions(o);
  const panel = panelOption(o.panel);
  const slope = resolveSlope(o.slope);
  const opts = { mode: o.mode, stepMs: o.stepMs, weights, earthMode: o.earthMode ?? o.mode, earthMinElevationDeg: o.earthMinElevationDeg ?? 0, terrain, ...night.opts, ...panel };
  const all = sites.map((s, i) => {
    const r = withSlope(evaluateCell(s, sampled, opts), slope, s);
    if (progressHook) report(0, 1, i + 1, sites.length, i + 1);
    return r;
  }).sort((a, b) => b.score - a.score);
  // With maxSlopeDeg the sites that do not meet it leave the ranking (counted in slope.excluded).
  const cells = all.filter((c) => passesSlope(c, slope));
  return {
    kind: 'sites',
    start: new Date(o.startMs).toISOString(),
    end: new Date(o.endMs).toISOString(),
    stepMinutes: o.stepMs / 60e3,
    mode: o.mode,
    weights,
    evaluated: all.length,
    top: cells.map((c, i) => ({ rank: i + 1, ...c })),
    ...(terrain ? { terrain } : {}),
    ...night.echo,
    ...panel,
    ...(slope ? { slope: { ...slopeEcho(slope, all), ...(slope.maxSlopeDeg !== undefined ? { excludedSites: all.filter((c) => !passesSlope(c, slope)).map((c) => c.id ?? `${c.lat},${c.lon}`) } : {}) } } : {}),
    note: terrain ? terrainNote(terrain, cells) : NOTE,
    timingMs: Math.round(performance.now() - t0),
  };
}
