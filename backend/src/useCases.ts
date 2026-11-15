// Use cases: one function per operation (sun-earth, windows, track, horizon, light-map, rank, landing-dates, search,
// and the evaluation of one point over one period that the evals use). This is the ONLY place that decides the
// defaults, the terrain (DEM, catalogue mask or sphere, with its warning), the scoring, the constraints and the domain
// warnings. The public API (data/src/v1.ts, and GraphQL through it) only validates, renames and formats; the evals
// (evals/lib.ts) call evaluatePeriod. So the same question gives the same answer by every path (issue #61).
//
// Inputs are already validated and typed (internal names). Warnings go to an optional sink (`warn`): the API puts them
// in `warnings`; the evals do not need them.
import { DEFAULT_STEP_MS, snapshot, series, windows, sampleVectors } from './service.ts';
import { DSN_MIN_ELEVATION_ASSUMED, DSN_MIN_ELEVATION_DEG, DSN_STATIONS } from './dsn.ts';
import type { DsnStation } from './dsn.ts';
import { DEFAULT_WEIGHTS, evaluateCell, rankSites, searchGrid } from './search.ts';
import { REFINE_DEFAULT_DEG, catalogMaskHeights, chooseMasks, horizonElevation, resolveTerrain, terrainRefineDeg } from './horizon.ts';
import { demVersion, layersFor } from './terrain/dem.ts';
import { reliefRings } from './terrain/horizonMask.ts';
import type { ReliefRings } from './terrain/horizonMask.ts';
import { listLdrm } from './terrain/ldrm.ts';
import { siteSlope, slopeSummary } from './terrain/slope.ts';
import { BATTERY_DEFAULTS, NIGHT_EXTENSION_LIMIT_DAYS } from './night.ts';
import { sweepLandingDates } from './landingSweep.ts';
import { constraintViolations, violatedConstraints } from './constraints.ts';
import { SITES } from './sites.ts';
import type {
  CellResult, Constraints, EvaluateOptions, GridSearch, HorizonMask, LandingDate, LandingSweep, LatLon, Metrics, Mode, NightOptions, Panel, Region,
  Resolution, SampledVectors, Series, Site, SiteRanking, SlopeRequest, SlopeSummary, Snapshot, Terrain, TerrainOption, Weights, Windows, WindowSummary, Cell,
} from './types.ts';

const HOUR_MS = 3600e3;
const DAY_MS = 86400e3;
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

// ---------------------------------------------------------------- defaults and limits

/** Defaults and limits of every operation (the public API validates against them). */
export const LIMITS = {
  lookaheadDays: 45, // lookahead for the next rise/set (sun-earth)
  windowsDefaultDays: 30,
  windowsMaxDays: 366,
  rankDefaultDays: 30,
  rankMinDays: 1,
  rankMaxDays: 120,
  rankMaxSites: 10, // does not apply with sites=all
  observerHeightMaxM: 100, // observer height above the ground with terrain
  observerHeightDefaultM: 2,
  reliefDefaultRadiusKm: 30, // horizon with relief=1: rings of terrain heights around the site, only to draw
  reliefMinRadiusKm: 1,
  reliefMaxRadiusKm: 100,
  trackDefaultDays: 10,
  trackMaxDays: 400, // 60 until API 1.15.0
  trackMinStepMinutes: 1, // 5 until API 1.15.0
  trackMaxStepMinutes: 1440,
  trackMaxPoints: 3000,
  landingDefaultRangeDays: 365, // landing-dates: candidate landing dates [start, end]
  landingMaxRangeDays: 400,
  landingMinDateStepHours: 1,
  landingMaxDateStepHours: 30 * 24,
  landingDefaultMissionDays: 14,
  landingMaxMissionDays: 60,
  landingDefaultTop: 10,
  landingMaxTop: 50,
  earthMinElevationMaxDeg: 90,
  horizonBandMaxDeg: 5, // windows: robustness band of the horizon (horizonBandDeg), 0 = off
  polarLatDeg: 80, // beyond it, without terrain, a smooth-Moon warning
  sampleDefaultStepMinutes: 60, // rank and search: one sample per hour unless `stepMinutes` says otherwise
  sampleMinStepMinutes: 15,
  sampleMaxStepMinutes: 360,
  searchDefaultDays: 30, // grid search with iterative refinement
  searchMaxDays: 120,
  searchDefaultSpacingKm: 15,
  searchMinSpacingKm: 0.5,
  searchMaxSpacingKm: 500,
  searchMaxCells: 8000, // points of the initial grid
  searchMaxCellsTerrainFast: 2500, // with terrain each point computes its mask (fast: ~5–15 ms)
  searchMaxCellsTerrainPrecise: 300, // precise masks: ~0.1–0.5 s each
  searchMaxRefineLevels: 4,
  searchDefaultRefineLevels: 2,
  searchDefaultRefineTop: 5,
  searchMaxRefineTop: 20,
  searchDefaultTop: 10,
  searchMaxTop: 50,
  lightMapDefaultRadiusKm: 60, // light-map: disc around the centre
  lightMapMaxRadiusKm: 200,
  lightMapMinSpacingKm: 0.25,
  lightMapMaxSpacingKm: 20,
  lightMapDefaultDays: 10,
  lightMapMaxDays: 30,
  lightMapMaxPoints: 2000,
  bestLandingsMaxRangeDays: 120, // best-landings: landing window [start, end]
  bestLandingsMaxMissionDays: 30,
};

/**
 * Score weights of rank, landing-dates and search when none is given: FIXED here (not the engine's DEFAULT_WEIGHTS,
 * which may change) because they are part of the public contract. Same values the engine had when v1 was published.
 */
export const SCORE_WEIGHTS: Weights = { energy: 0.7, comm: 0.3, both: 0, night: 0, sun: 0, commGap: 0, bothStreak: 0 };

/** Dates validated against JPL Horizons (data/ACCURACY.md): outside them a warning. */
export const VALIDATED_DATES = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2031, 0, 1) };

/** Below this height (m) over the ground a terrain horizon is dominated by the DEM pixel the observer stands on. */
export const LOW_HEIGHT_M = 1;

/**
 * Deep polar zone (issue #437): south of 85°S the time fractions with terrain are less reliable. There the validation
 * matrix (VALIDATION.md, rows against the 60 m PGDA products) measures an RMS of 3.9–7.5 pp and worst points of 18–47 pp,
 * against 2–4 pp RMS north of 85°S and against the 240 m products (#85, #86). `maxLatDeg` is the threshold (a point
 * counts when its latitude is below it); `measured` are the 2 m rows of that matrix, the API's default height. They are
 * not typed freely: backend/test/deep-polar.test.ts reads them back from VALIDATION.md and fails if they drift.
 */
export const DEEP_POLAR = {
  maxLatDeg: -85,
  measured: { sunRmsPp: 7.5, sunMaxPp: 47.28, earthRmsPp: 7.2, earthMaxPp: 32.67 },
  validationUrl: 'https://github.com/540/lunar-landing-site-navigator/blob/main/VALIDATION.md',
} as const;
/** True when a point lies in the deep polar zone (south of 85°S). */
export const isDeepPolar = (p: LatLon): boolean => p.lat < DEEP_POLAR.maxLatDeg;

// ---------------------------------------------------------------- warnings

export type DomainWarningCode = 'smooth_moon_polar' | 'night_truncated' | 'outside_validated_dates' | 'height_no_horizon_dip' | 'low_observer_height' | 'terrain_not_applied'
  | 'deep_polar_uncertainty';
/** Where a use case leaves its warnings (the API's RequestContext is one). */
export interface WarningSink { warn(code: DomainWarningCode, message: string, parameter?: string): void }

/** Warning when the period leaves the dates the ephemerides were validated in (2026–2030 against JPL Horizons). */
function validatedDatesWarning(fromMs: number, toMs: number, w?: WarningSink): void {
  if (fromMs >= VALIDATED_DATES.startMs && toMs <= VALIDATED_DATES.endMs) return;
  w?.warn('outside_validated_dates', 'Las efemérides solo están validadas frente a JPL Horizons entre 2026 y 2030 (data/ACCURACY.md); '
    + 'fuera de ese intervalo el cálculo funciona, pero su precisión no está medida.');
}

/**
 * Warning when an observer, panel or antenna height with terrain is below 1 m: the horizon is then dominated by the DEM
 * pixel under the observer and by interpolation, and polar nights grow a lot (on the Shackleton connecting ridge, C1,
 * the longest night in 18.6 years is 2108 h at 0 m against 114 h at 2 m; comparison with PGDA, 2026-11). Only said.
 * A panel or antenna height that is absent inherits observerHeightM and is covered by its warning.
 */
function lowHeightWarning(h: HeightsRequest, w?: WarningSink): void {
  for (const name of ['observerHeightM', 'panelHeightM', 'antennaHeightM'] as const) {
    const v = h[name];
    if (v === undefined || v >= LOW_HEIGHT_M) continue;
    w?.warn('low_observer_height', `${name}=${v} m: por debajo de ${LOW_HEIGHT_M} m el horizonte con relieve lo decide el píxel del DEM `
      + 'en el que está el observador y las noches polares se alargan mucho (en la cresta de conexión de Shackleton, C1, la noche '
      + 'más larga en 18,6 años es de 2108 h a 0 m frente a 114 h a 2 m). Un módulo real tiene el panel y la antena a 2–4 m o más.', name);
  }
}

/** Warning when terrain was asked for and some horizon is still the smooth sphere. `what` says which part went without. */
function terrainNotApplied(w: WarningSink | undefined, what: string, plural: boolean = false): void {
  const why = demVersion()
    ? 'está fuera de la cobertura del DEM LOLA (polo sur, hasta unos 60°S)'
    : 'el servidor no tiene el DEM LOLA en caché y no hay máscara precalculada del catálogo para ese punto y esa altura';
  w?.warn('terrain_not_applied', `Se pidió relieve, pero ${what} ${plural ? 'usan' : 'usa'} el horizonte de Luna lisa a 0°: ${why}.`, 'terrain');
}

const comma = (x: number, digits: number): string => x.toFixed(digits).replace('.', ',');
/**
 * Warning when a time fraction or a window with terrain falls south of 85°S (DEEP_POLAR): there the computation can
 * differ from the PGDA maps by tens of percentage points. Only said: it changes no figure, verdict or score.
 * `which` names the points it applies to when the answer has several (rank, search, light-map).
 */
function deepPolarWarning(w: WarningSink | undefined, which: string = ''): void {
  const m = DEEP_POLAR.measured;
  w?.warn('deep_polar_uncertainty', `${which}Al sur de ${-DEEP_POLAR.maxLatDeg}°S la fracción de tiempo con Sol o con Tierra con relieve puede `
    + 'desviarse de los mapas de PGDA en decenas de puntos porcentuales: frente a los de 60 m, con el panel o la antena a 2 m, '
    + `hasta ${comma(m.sunMaxPp, 0)} pp con el Sol y ${comma(m.earthMaxPp, 0)} pp con la Tierra (RMS de ${comma(m.sunRmsPp, 1)} y `
    + `${comma(m.earthRmsPp, 1)} pp). Las ventanas y las cifras son orientativas; matriz de validación: ${DEEP_POLAR.validationUrl}.`);
}

const truncatedWarning = (w: WarningSink | undefined, what: string): void =>
  w?.warn('night_truncated', `${what} llega al límite de búsqueda de la noche real (${NIGHT_EXTENSION_LIMIT_DAYS} días a cada lado): `
    + 'es una sombra casi permanente y longestNightFullHours (y la batería, si se pide) es solo un mínimo.', 'fullNight');

/** Smooth Moon at the poles: without a terrain mask beyond 80° of latitude the horizon is at 0°, and there the terrain rules. */
function polarWarning(site: LatLon, masks: { mask: HorizonMask | null; earthMask: HorizonMask | null }, terrain: TerrainRequest | null, w?: WarningSink): void {
  if (Math.abs(site.lat) <= LIMITS.polarLatDeg || (masks.mask && masks.earthMask)) return;
  w?.warn('smooth_moon_polar', `${terrain ? 'Se pidió relieve, pero no hay máscara de horizonte para este punto' : 'Sin relieve (terrain=1)'}: `
    + `horizonte de Luna lisa a 0° a más de ${LIMITS.polarLatDeg}° de latitud. En los polos el relieve decide la luz y la visibilidad de la Tierra; `
    + 'estas cifras son optimistas o, en un cráter, directamente falsas.');
}

/** heightKm of a custom point only raises it for the geometry, it does not lower the horizon. */
function heightWarning(site: Site, terrain: TerrainRequest | null, w?: WarningSink): void {
  if (!site.custom || !site.heightKm || terrain) return;
  w?.warn('height_no_horizon_dip', 'heightKm eleva al observador sobre la esfera solo para la geometría (paralaje, menos de 0,01°): '
    + 'el horizonte sigue a 0° porque se supone terreno llano alrededor del sitio, no la depresión del horizonte de una torre de '
    + `${site.heightKm} km sobre una esfera lisa. Para un mástil o un panel elevado usa terrain=1 con panelHeightM o antennaHeightM.`, 'heightKm');
}

// ---------------------------------------------------------------- terrain

/** Heights of a terrain request: panel (Sun) and antenna (Earth) absent = observerHeightM. */
export interface HeightsRequest { observerHeightM: number; panelHeightM?: number; antennaHeightM?: number }
/**
 * Terrain asked for (null = no terrain: always the sphere, except masks registered by hand in the tests).
 * refineDeg: threshold of the hybrid horizon (absent = default of the resolution). resolution: precise by default.
 */
export interface TerrainRequest extends HeightsRequest { refineDeg?: number; resolution?: Resolution }

/** Terrain summary of a response (the `terrain` object of v1). */
export interface TerrainReport {
  observerHeightM: number; panelHeightM?: number; antennaHeightM?: number; applied: boolean; source: 'catalog' | 'dem' | null; demVersion: string | null;
  horizonRefineDeg?: number; note: string;
}

const heightsOf = (t: HeightsRequest): { observerHeightM: number; panelHeightM: number; antennaHeightM: number } =>
  ({ observerHeightM: t.observerHeightM, panelHeightM: t.panelHeightM ?? t.observerHeightM, antennaHeightM: t.antennaHeightM ?? t.observerHeightM });
const isSplit = (t: HeightsRequest): boolean => {
  const h = heightsOf(t);
  return h.panelHeightM !== h.observerHeightM || h.antennaHeightM !== h.observerHeightM;
};
/** panelHeightM and antennaHeightM of a report: both when any differs from observerHeightM, none otherwise. */
const heightsEcho = (t: HeightsRequest): Pick<TerrainReport, 'panelHeightM' | 'antennaHeightM'> => {
  const h = heightsOf(t);
  return isSplit(t) ? { panelHeightM: h.panelHeightM, antennaHeightM: h.antennaHeightM } : {};
};
const refineDegOf = (t: TerrainRequest): number => t.refineDeg ?? REFINE_DEFAULT_DEG[t.resolution ?? 'precise'];
const refineEcho = (deg: number | undefined): Pick<TerrainReport, 'horizonRefineDeg'> => (deg ? { horizonRefineDeg: deg } : {});
const refineSentence = (deg: number): string =>
  ` Horizonte híbrido: rayo directo sobre el DEM en el acimut exacto del astro cuando su margen al horizonte es menor que ${String(deg).replace('.', ',')}°.`;

/** `terrain` option of the engine (rankSites, searchGrid, sweepLandingDates). */
export function engineTerrain(t: TerrainRequest): TerrainOption {
  const resolution = t.resolution ?? 'precise';
  return {
    enabled: true, observerHeightM: t.observerHeightM, ...heightsEcho(t), resolution,
    ...(t.refineDeg !== undefined && t.refineDeg !== REFINE_DEFAULT_DEG[resolution] ? { refineDeg: t.refineDeg } : {}),
  };
}

function maskNote(mask: HorizonMask | null, source: string | null): string {
  if (source === 'dem') return `Máscara de horizonte calculada con el DEM en caché: ${mask!.source}.`;
  if (mask) return `Máscara de horizonte precalculada del catálogo: ${mask.source}.`;
  if (demVersion()) return 'El punto queda fuera de la cobertura del DEM LOLA (polo sur, hasta unos 60°S): horizonte esférico (0°).';
  return 'El servidor no tiene el DEM LOLA en caché ni máscara precalculada para este sitio y altura: horizonte esférico (0°).';
}

export interface SiteHorizon { mask: HorizonMask | null; earthMask: HorizonMask | null; terrain: TerrainReport | null }

/**
 * Horizon of one site: without terrain, always spherical (except masks registered by hand, only in the tests); with
 * terrain, the catalogue mask or one computed from the cached DEM, or the catalogue one at those coordinates; if none,
 * the sphere, said in the report and in a warning. `mask` is the panel's (Sun), `earthMask` the antenna's (Earth).
 */
export function siteHorizon(site: Site, terrain: TerrainRequest | null, w?: WarningSink): SiteHorizon {
  const h = terrain ? heightsOf(terrain) : null;
  const { sun, earth } = chooseMasks(site, {
    terrain: Boolean(terrain), panelHeightM: h?.panelHeightM, antennaHeightM: h?.antennaHeightM, resolution: terrain?.resolution ?? 'precise',
    refineDeg: terrain ? refineDegOf(terrain) : 0,
  });
  const mask = sun.mask, earthMask = earth.mask;
  if (!terrain || !h) return { mask, earthMask, terrain: null };
  const note = isSplit(terrain)
    ? `Panel (Sol) a ${h.panelHeightM} m: ${maskNote(mask, sun.source)} Antena (Tierra) a ${h.antennaHeightM} m: ${maskNote(earthMask, earth.source)}`
    : maskNote(mask, sun.source);
  const sources = [sun, earth].filter((c) => c.mask).map((c) => c.source);
  const applied = sources.length > 0;
  if (!mask && !earthMask) terrainNotApplied(w, 'el sitio');
  else if (!mask || !earthMask) terrainNotApplied(w, mask ? `la antena (Tierra, a ${h.antennaHeightM} m)` : `el panel (Sol, a ${h.panelHeightM} m)`);
  const refined = [mask, earthMask].find((m) => m?.refine)?.refine?.deg;
  return {
    mask,
    earthMask,
    terrain: {
      observerHeightM: terrain.observerHeightM,
      ...heightsEcho(terrain),
      applied,
      source: applied ? (sources.includes('dem') ? 'dem' : 'catalog') : null,
      demVersion: (mask ?? earthMask)?.demVersion ?? null,
      ...refineEcho(refined),
      note: note + (refined ? refineSentence(refined) : ''),
    },
  };
}

/** Terrain report of several points (rank, search): DEM, catalogue mask or sphere, counted. */
function pointsTerrain(terrain: Terrain, results: readonly Pick<CellResult, 'horizon' | 'horizonSource'>[], [one, many]: readonly [string, string]): TerrainReport {
  const withMask = results.filter((c) => c.horizon === 'mask').length;
  const fromCatalog = results.filter((c) => c.horizonSource === 'catalog').length;
  const fromDem = withMask - fromCatalog;
  let note;
  if (fromDem) note = `Relieve LOLA calculado con el DEM en caché en ${fromDem} de ${results.length} ${many}${fromCatalog ? `, máscara precalculada del catálogo en ${fromCatalog}` : ''}; el resto, horizonte esférico (0°).`;
  else if (fromCatalog) note = `El servidor no tiene el DEM LOLA en caché: máscara de horizonte precalculada del catálogo en ${fromCatalog} de ${results.length} ${many}; el resto, horizonte esférico (0°).`;
  else if (terrain.demVersion) note = `Ningún ${one} queda dentro de la cobertura del DEM LOLA (polo sur, hasta unos 60°S): horizonte esférico (0°).`;
  else note = `El servidor no tiene el DEM LOLA en caché: horizonte esférico (0°) en todos los ${many}.`;
  if (fromDem && terrainRefineDeg(terrain) > 0) note += refineSentence(terrainRefineDeg(terrain));
  return {
    observerHeightM: terrain.observerHeightM, ...heightsEcho(terrain), applied: withMask > 0, source: fromDem ? 'dem' : fromCatalog ? 'catalog' : null,
    demVersion: fromDem ? terrain.demVersion : null, ...refineEcho(fromDem ? terrainRefineDeg(terrain) : 0), note,
  };
}

/** Terrain report of a landing-date sweep (one site). */
function sweepTerrain(terrain: Terrain, applied: boolean, catalog: boolean): TerrainReport {
  let note;
  if (applied && catalog) note = 'El servidor no tiene el DEM LOLA en caché: máscara de horizonte precalculada del catálogo (modo preciso, sin rayo directo).';
  else if (applied) note = `Relieve LOLA calculado con el DEM en caché (modo ${terrain.resolution === 'fast' ? 'rápido' : 'preciso'}).`;
  else if (terrain.demVersion) note = 'El punto queda fuera de la cobertura del DEM LOLA (polo sur, hasta unos 60°S): horizonte esférico (0°).';
  else note = 'El servidor no tiene el DEM LOLA en caché: horizonte esférico (0°).';
  const fromDem = applied && !catalog;
  if (fromDem && terrainRefineDeg(terrain) > 0) note += refineSentence(terrainRefineDeg(terrain));
  return {
    observerHeightM: terrain.observerHeightM, ...heightsEcho(terrain), applied, source: fromDem ? 'dem' : applied ? 'catalog' : null, demVersion: fromDem ? terrain.demVersion : null,
    ...refineEcho(fromDem ? terrainRefineDeg(terrain) : 0), note,
  };
}

/** Earth mask raised by `deg`: the Earth needs that elevation above the horizon (same as the engine's earthMinElevationDeg). */
function raiseMask(mask: HorizonMask | null, deg: number): HorizonMask | null {
  if (!deg) return mask;
  if (!mask) return { stepDeg: 360, el: [deg], source: `horizonte esférico + ${deg}°` };
  const { refine } = mask; // hybrid horizon: the direct ray is raised too
  return { ...mask, el: Array.from(mask.el, (e: number) => e + deg), ...(refine ? { refine: { deg: refine.deg, elevation: (az: number) => refine.elevation(az) + deg } } : {}) };
}

/** Terrain data of this server: only metadata, nothing is loaded. */
export function terrainAvailability(): { dem: boolean; demVersion: string | null; slopeProducts: boolean; slopeProductBaselinesM: number[]; catalogMaskSiteIds: string[] } {
  const version = demVersion();
  const baselines = [...new Set(listLdrm().map((g) => g.baselineM))].sort((a, b) => a - b);
  return {
    dem: version !== null,
    demVersion: version,
    slopeProducts: baselines.length > 0,
    slopeProductBaselinesM: baselines,
    catalogMaskSiteIds: SITES.filter((x) => catalogMaskHeights(x.id).length > 0).map((x) => x.id),
  };
}

// ---------------------------------------------------------------- night, constraints, slope

/** Night options; `maxBatteryKg` turns the battery on with its defaults. */
export const nightWithBattery = (night: NightOptions | null, constraints: Constraints = {}): NightOptions | null =>
  (constraints.maxBatteryKg !== undefined && !night?.battery ? { ...night, battery: { ...BATTERY_DEFAULTS } } : night);

/** Verdict of a result against the constraints: met or not and which constraints (engine names) it misses. */
export interface Verdict { meets: boolean; violated: (keyof Constraints)[] }
const verdictOf = (metrics: CellResult['metrics'], constraints: Constraints, feasible?: boolean): Verdict | null => {
  if (!Object.keys(constraints).length) return null;
  const violated = violatedConstraints(metrics as Metrics, constraints);
  return { meets: feasible ?? violated.length === 0, violated };
};

/** Why a site leaves a ranking with maxSlopeDeg, with its slope. */
export interface SlopeExclusion { id: string; reason: 'slopeUnknown' | 'slopeUncertified' | 'slopeAboveMax'; slopeDeg: number | null }
function slopeExclusions(sites: readonly Site[], ids: readonly string[], req: SlopeRequest): SlopeExclusion[] {
  return ids.map((id) => {
    const site = sites.find((s) => s.id === id)!;
    const { slopeDeg, underestimated } = slopeSummary(site.lat, site.lon, req);
    return { id, reason: slopeDeg === null ? 'slopeUnknown' : underestimated ? 'slopeUncertified' : 'slopeAboveMax', slopeDeg };
  });
}

/** Slope of a site (with slope=1, slopeBaselineM or maxSlopeDeg): depends only on the place, cached DEM even without terrain. */
export const siteSlopeOf = (site: LatLon, req: SlopeRequest | null | undefined): SlopeSummary | null => (req ? siteSlope(site.lat, site.lon, req) : null);

// ---------------------------------------------------------------- single-site use cases

interface SiteInput { site: Site; terrain?: TerrainRequest | null }
const terrainRequest = (i: SiteInput, w?: WarningSink): TerrainRequest | null => {
  const t = i.terrain ?? null;
  if (t) lowHeightWarning(t, w);
  heightWarning(i.site, t, w);
  return t;
};

/** Sun and Earth at one instant, with the next rise and set. */
export function sunEarth(i: SiteInput & { dateMs: number; mode?: Mode; earthMinElevationDeg?: number; slope?: SlopeRequest | null }, w?: WarningSink):
{ snapshot: Snapshot; mode: Mode; lookaheadDays: number; earthMinElevationDeg: number; terrain: TerrainReport | null; slope: SlopeSummary | null } {
  const terrain = terrainRequest(i, w);
  const mode = i.mode ?? 'limb', earthMin = i.earthMinElevationDeg ?? 0;
  validatedDatesWarning(i.dateMs, i.dateMs + LIMITS.lookaheadDays * DAY_MS, w);
  const horizon = siteHorizon(i.site, terrain, w);
  polarWarning(i.site, horizon, terrain, w);
  const s = snapshot(i.site, i.dateMs, { mode, lookaheadDays: LIMITS.lookaheadDays, mask: horizon.mask, earthMask: raiseMask(horizon.earthMask, earthMin) });
  return { snapshot: s, mode, lookaheadDays: LIMITS.lookaheadDays, earthMinElevationDeg: earthMin, terrain: horizon.terrain, slope: siteSlopeOf(i.site, i.slope) };
}

/** Smallest and largest value of a metric over the nominal horizon and the two shifted ones. */
export interface BandRange { min: number; max: number }
/** Ranges of the summary of one body (or of both at once) over the horizon band. */
export interface BandSummaryRange { totalHours: BandRange; fractionOfTime: BandRange; longestWindowHours: BandRange }
/**
 * Robustness band of the horizon (issue #64): the same windows with the horizon of both bodies raised (`raised`: the
 * relief is higher than the model says, less Sun and Earth) and lowered (`lowered`) by `deg`, and the range of each
 * summary figure over the three horizons (nominal, raised and lowered).
 */
export interface HorizonBand {
  deg: number;
  raised: Windows;
  lowered: Windows;
  range: { sun: BandSummaryRange; earth: BandSummaryRange; sunAndEarth: BandSummaryRange; longestNightHours?: BandRange; longestNightFullHours?: BandRange };
}

const bandRange = (values: readonly number[]): BandRange => ({ min: Math.min(...values), max: Math.max(...values) });
const summaryRange = (sets: readonly WindowSummary[]): BandSummaryRange => ({
  totalHours: bandRange(sets.map((x) => x.totalHours)),
  fractionOfTime: bandRange(sets.map((x) => x.fractionOfTime)),
  longestWindowHours: bandRange(sets.map((x) => x.longestWindowHours)),
});

/** DSN mode of the windows (issue #103): the stations and the minimum elevation behind `earthDsn`. */
export interface DsnInfo { minElevationDeg: number; minElevationAssumed: boolean; stations: readonly DsnStation[] }

/**
 * Visibility windows of the Sun, the Earth and both, with the night and the battery when asked for. With
 * `horizonBandDeg` > 0 also the horizon band: the whole computation repeated with the horizon shifted up and down,
 * over the same ephemeris sample (the nominal windows are the same with or without it). With `dsn`, also
 * `windows.earthDsn`: the Earth visible from the site while some DSN station has the Moon above its minimum elevation
 * (only in the nominal windows, not in the band).
 */
export function visibilityWindows(
  i: SiteInput & { startMs: number; endMs: number; mode?: Mode; night?: NightOptions | null; earthMinElevationDeg?: number; slope?: SlopeRequest | null; horizonBandDeg?: number; dsn?: boolean },
  w?: WarningSink,
): {
  windows: Windows; mode: Mode; earthMinElevationDeg: number; terrain: TerrainReport | null; horizonModel: 'mask' | 'sphere'; slope: SlopeSummary | null; nightTruncated: boolean;
  horizonBand: HorizonBand | null; dsn: DsnInfo | null;
} {
  const terrain = terrainRequest(i, w);
  const mode = i.mode ?? 'limb', earthMin = i.earthMinElevationDeg ?? 0, bandDeg = i.horizonBandDeg ?? 0;
  validatedDatesWarning(i.startMs, i.endMs, w);
  const horizon = siteHorizon(i.site, terrain, w);
  polarWarning(i.site, horizon, terrain, w);
  const sampled = bandDeg > 0 ? sampleVectors(i.startMs, i.endMs, DEFAULT_STEP_MS) : undefined;
  // shiftDeg moves the horizon of both bodies; the Earth keeps its minimum elevation on top of it.
  // The DSN windows (earthDsn) only for the nominal horizon.
  const at = (shiftDeg: number, dsnMinElevationDeg?: number): Windows => windows(i.site, i.startMs, i.endMs, {
    mode, mask: raiseMask(horizon.mask, shiftDeg), earthMask: raiseMask(horizon.earthMask, earthMin + shiftDeg), ...(i.night ? { night: i.night } : {}), ...(sampled ? { sampled } : {}),
    ...(dsnMinElevationDeg !== undefined ? { dsnMinElevationDeg } : {}),
  });
  const r = at(0, i.dsn ? DSN_MIN_ELEVATION_DEG : undefined);
  const nightTruncated = r.night?.fullNightTruncated === true;
  if (nightTruncated) truncatedWarning(w, 'La noche que toca el intervalo');
  const horizonModel = horizon.mask && horizon.earthMask ? 'mask' : 'sphere';
  if (horizon.terrain?.applied && isDeepPolar(i.site)) deepPolarWarning(w);
  let horizonBand: HorizonBand | null = null;
  if (bandDeg > 0) {
    const raised = at(bandDeg), lowered = at(-bandDeg), all = [r, raised, lowered];
    const full = all.map((x) => x.night?.longestNightFullHours).filter((x): x is number => x !== undefined);
    horizonBand = {
      deg: bandDeg, raised, lowered,
      range: {
        sun: summaryRange(all.map((x) => x.sun)), earth: summaryRange(all.map((x) => x.earth)), sunAndEarth: summaryRange(all.map((x) => x.sunAndEarth)),
        ...(r.night ? { longestNightHours: bandRange(all.map((x) => x.night!.longestNightHours)) } : {}),
        ...(full.length === all.length ? { longestNightFullHours: bandRange(full) } : {}),
      },
    };
  }
  const dsn = i.dsn ? { minElevationDeg: DSN_MIN_ELEVATION_DEG, minElevationAssumed: DSN_MIN_ELEVATION_ASSUMED, stations: DSN_STATIONS } : null;
  return { windows: r, mode, earthMinElevationDeg: earthMin, terrain: horizon.terrain, horizonModel, slope: siteSlopeOf(i.site, i.slope), nightTruncated, horizonBand, dsn };
}

/** Azimuth, elevation, horizon and visible fraction of the Sun and the Earth step by step. */
export function track(i: SiteInput & { startMs: number; endMs: number; stepMs?: number }, w?: WarningSink):
{ series: Series; horizonDeg: { sun: number[]; earth: number[] }; terrain: TerrainReport | null } {
  const terrain = terrainRequest(i, w);
  validatedDatesWarning(i.startMs, i.endMs, w);
  const horizon = siteHorizon(i.site, terrain, w);
  const s = series(i.site, i.startMs, i.endMs, i.stepMs ?? HOUR_MS, { mask: horizon.mask, earthMask: horizon.earthMask });
  const along = (az: number[], mask: HorizonMask | null): number[] => az.map((a) => round4(horizonElevation(mask, a)));
  return { series: s, horizonDeg: { sun: along(s.sun.az, horizon.mask), earth: along(s.earth.az, horizon.earthMask) }, terrain: horizon.terrain };
}

/** Relief rings of /v1/horizon?relief=1 (terrain/horizonMask.ts reliefRings), with the radius they reach. */
export type HorizonRelief = ReliefRings & { radiusKm: number };

/**
 * Horizon profile of a site: always with terrain (that is what it is for), the observer at `observerHeightM`.
 * With `relief`, also the terrain heights around the site on the great circles of the mask (only to draw it): null
 * when the server has no DEM at the point (a catalogue mask alone has no heights behind it).
 */
export function horizonProfile(
  i: { site: Site; observerHeightM?: number; relief?: { radiusKm: number } }, w?: WarningSink,
): { mask: HorizonMask | null; terrain: TerrainReport; relief?: HorizonRelief | null } {
  const h = i.observerHeightM ?? LIMITS.observerHeightDefaultM;
  lowHeightWarning({ observerHeightM: h }, w);
  const { mask, terrain } = siteHorizon(i.site, { observerHeightM: h, refineDeg: 0 }, w);
  if (!i.relief) return { mask, terrain: terrain! };
  return { mask, terrain: terrain!, relief: reliefAround(i.site, i.relief.radiusKm) };
}

function reliefAround(site: Site, radiusKm: number): HorizonRelief | null {
  const sel = layersFor(site.lat, site.lon, 'precise');
  if (!sel) return null;
  try { return { ...reliefRings(site.lat, site.lon, sel.layers, { radiusM: radiusKm * 1000 }), radiusKm }; } catch { return null; }
}

// ---------------------------------------------------------------- light map

const MOON_RADIUS_KM = 1737.4;
const KM_PER_DEG = (Math.PI / 180) * MOON_RADIUS_KM;
const RAD = Math.PI / 180;
const normLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * Point at (xKm east, yKm north) from a centre, along the great circle (azimuthal equidistant around the centre).
 * At a pole "north" is the meridian 0° and "east" the meridian 90°E, the projection of the polar maps of the web.
 */
function offsetPoint(lat: number, lon: number, xKm: number, yKm: number): LatLon {
  const d = Math.hypot(xKm, yKm);
  if (d === 0) return { lat, lon };
  if (Math.abs(lat) > 89.9999) {
    const south = lat < 0;
    return { lat: south ? -90 + d / KM_PER_DEG : 90 - d / KM_PER_DEG, lon: normLon(Math.atan2(xKm, south ? yKm : -yKm) / RAD) };
  }
  const b = Math.atan2(xKm, yKm), delta = d / MOON_RADIUS_KM, p1 = lat * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(delta) + Math.cos(p1) * Math.sin(delta) * Math.cos(b));
  const l2 = lon * RAD + Math.atan2(Math.sin(b) * Math.sin(delta) * Math.cos(p1), Math.cos(delta) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: normLon(l2 / RAD) };
}

export interface MapCell extends LatLon { xKm: number; yKm: number }
/** Points of a light map: a square mesh of `spacingKm` clipped to the disc of `radiusKm` around the centre, north to south. */
export function lightMapCells(centre: LatLon, radiusKm: number, spacingKm: number): MapCell[] {
  const k = Math.floor(radiusKm / spacingKm);
  const cells: MapCell[] = [];
  for (let j = k; j >= -k; j--) for (let i = -k; i <= k; i++) {
    const xKm = i * spacingKm, yKm = j * spacingKm;
    if (Math.hypot(xKm, yKm) > radiusKm + 1e-9) continue;
    cells.push({ ...offsetPoint(centre.lat, centre.lon, xKm, yKm), xKm, yKm });
  }
  return cells;
}

/** Share of the period with the Sun and with the Earth, and longest night, at every point, always over the LOLA terrain (fast masks). */
export function lightMap(i: { cells: readonly MapCell[]; startMs: number; endMs: number; mode?: Mode; heights: HeightsRequest }, w?: WarningSink) {
  const mode = i.mode ?? 'limb';
  lowHeightWarning(i.heights, w);
  validatedDatesWarning(i.startMs, i.endMs, w);
  // Fast masks (150 km, 360 azimuths): a few ms per point, so a map of a thousand points takes seconds.
  const terrain = resolveTerrain(engineTerrain({ ...i.heights, resolution: 'fast' }), 'fast');
  const sampled = sampleVectors(i.startMs, i.endMs, HOUR_MS);
  const points = i.cells.map((c) => ({ cell: c, result: evaluateCell({ lat: c.lat, lon: c.lon }, sampled, { mode, stepMs: HOUR_MS, weights: DEFAULT_WEIGHTS, earthMode: mode, terrain }) }));
  const withMask = points.filter((p) => p.result.horizon === 'mask').length;
  const deep = points.filter((p) => p.result.horizon === 'mask' && isDeepPolar(p.cell)).length;
  if (deep) deepPolarWarning(w, `${deep} de ${points.length} puntos: `);
  const version = demVersion();
  const n = points.length;
  const report: TerrainReport = {
    observerHeightM: i.heights.observerHeightM,
    ...heightsEcho(i.heights),
    applied: withMask > 0,
    source: withMask > 0 ? 'dem' : null,
    demVersion: withMask > 0 ? version : null,
    note: withMask === n
      ? 'Horizonte con relieve LOLA en todos los puntos (máscaras rápidas: DEM de 160/240 m hasta 150 km, 360 acimuts).'
      : withMask > 0
        ? `Horizonte con relieve LOLA en ${withMask} de ${n} puntos; el resto queda fuera de la cobertura del DEM (horizonte esférico).`
        : version
          ? 'Ningún punto queda dentro de la cobertura del DEM LOLA (polo sur, hasta unos 60°S): horizonte esférico (0°).'
          : 'El servidor no tiene el DEM LOLA en caché: horizonte esférico (0°) en todos los puntos.',
  };
  return { mode, points, terrain: report };
}

// ---------------------------------------------------------------- scoring use cases

/** Options shared by rank, landing-dates and search (absent = the defaults above). */
export interface MissionInput {
  mode?: Mode;
  /** Earth visibility criterion; absent = `mode`. */
  earthMode?: Mode;
  earthMinElevationDeg?: number;
  /** Sample step (ms); absent = 1 h. */
  stepMs?: number;
  /** Each weight not given is the one of SCORE_WEIGHTS; the engine normalizes them to sum 1. */
  weights?: Partial<Weights>;
  terrain?: TerrainRequest | null;
  night?: NightOptions | null;
  panel?: Exclude<Panel, 'tracking'>;
  constraints?: Constraints;
}

/** Weights of a request: SCORE_WEIGHTS unless some are given (then only those). */
const weightsOf = (w: Partial<Weights> | undefined): Weights => ({ ...SCORE_WEIGHTS, ...w });
/** Engine options common to rank, landing-dates and search. */
function engineOptions(i: MissionInput, defaultResolution: Resolution) {
  const mode = i.mode ?? 'limb';
  const night = nightWithBattery(i.night ?? null, i.constraints);
  return {
    mode,
    night,
    options: {
      stepMs: i.stepMs ?? HOUR_MS, mode, earthMode: i.earthMode ?? mode, earthMinElevationDeg: i.earthMinElevationDeg ?? 0, weights: weightsOf(i.weights),
      ...(i.terrain ? { terrain: engineTerrain({ resolution: defaultResolution, ...i.terrain }) } : {}),
      ...(night ?? {}),
      ...(i.panel ? { panel: i.panel } : {}),
    },
  };
}

/** Ranking of sites (catalogue or custom) for a mission of `days` days from `startMs`. */
export function rank(i: MissionInput & { sites: readonly Site[]; startMs: number; days: number; slope?: SlopeRequest | null }, w?: WarningSink):
{ ranking: SiteRanking; mode: Mode; days: number; night: NightOptions | null; results: { cell: SiteRanking['top'][number]; verdict: Verdict | null }[]; terrain: TerrainReport | null; nightTruncated: number; excluded: SlopeExclusion[] } {
  if (i.terrain) lowHeightWarning(i.terrain, w);
  const endMs = i.startMs + i.days * DAY_MS;
  validatedDatesWarning(i.startMs, endMs, w);
  const { mode, night, options } = engineOptions(i, 'precise');
  const r = rankSites(i.sites, { startMs: i.startMs, endMs, ...options, ...(i.slope ? { slope: i.slope } : {}) });
  const nightTruncated = r.top.filter((c) => c.nightTruncated).length;
  if (nightTruncated) truncatedWarning(w, `La noche de ${nightTruncated} de ${r.top.length} sitios`);
  const flat = i.terrain ? r.top.filter((c) => c.horizon !== 'mask').length : 0;
  if (flat) terrainNotApplied(w, flat === r.top.length ? 'todos los sitios' : `${flat} de ${r.top.length} sitios`, true);
  const deep = i.terrain ? r.top.filter((c) => c.horizon === 'mask' && isDeepPolar(c)) : [];
  if (deep.length) deepPolarWarning(w, `${deep.map((c) => c.id ?? `${c.lat}:${c.lon}`).join(', ')}: `);
  const constraints = i.constraints ?? {};
  return {
    ranking: r,
    mode,
    days: i.days,
    night,
    results: r.top.map((c) => ({ cell: c, verdict: verdictOf(c.metrics, constraints) })),
    terrain: r.terrain ? pointsTerrain(r.terrain, r.top, ['sitio', 'sitios']) : null,
    nightTruncated,
    excluded: i.slope?.maxSlopeDeg !== undefined ? slopeExclusions(i.sites, r.slope?.excludedSites ?? [], i.slope) : [],
  };
}

/** Landing-date sweep of one site: the mission that starts on each candidate date [startMs, endMs] every dateStepMs. */
export function landingDates(
  i: MissionInput & { site: Site; startMs: number; endMs: number; dateStepMs: number; missionDays: number; minScore?: number | null; top?: number; slope?: SlopeRequest | null },
  w?: WarningSink,
): { sweep: LandingSweep; mode: Mode; night: NightOptions | null; verdicts: Map<LandingDate, Verdict | null>; terrain: TerrainReport | null; slope: SlopeSummary | null; nightTruncated: number } {
  const terrain = terrainRequest(i, w);
  validatedDatesWarning(i.startMs, i.endMs + i.missionDays * DAY_MS, w);
  const { mode, night, options } = engineOptions(i, 'precise');
  const constraints = i.constraints ?? {};
  const r = sweepLandingDates(i.site, {
    startMs: i.startMs, endMs: i.endMs, dateStepMs: i.dateStepMs, missionDays: i.missionDays, ...options, constraints,
    minScore: i.minScore ?? null, top: i.top ?? LIMITS.landingDefaultTop,
  });
  const nightTruncated = r.dates.filter((d) => d.nightTruncated).length;
  if (nightTruncated) truncatedWarning(w, `La noche de ${nightTruncated} de ${r.dates.length} fechas`);
  if (terrain && r.site.horizon !== 'mask') terrainNotApplied(w, 'el sitio');
  if (terrain && r.site.horizon === 'mask' && isDeepPolar(i.site)) deepPolarWarning(w);
  const verdicts = new Map<LandingDate, Verdict | null>();
  for (const d of [...r.dates, ...r.best, ...r.worst]) verdicts.set(d, verdictOf(d.metrics, constraints, d.feasible));
  return {
    sweep: r, mode, night, verdicts, nightTruncated,
    terrain: r.terrain ? sweepTerrain(r.terrain, r.site.horizon === 'mask', r.site.horizonSource === 'catalog') : null,
    slope: siteSlopeOf(i.site, i.slope),
  };
}

/** Grid search of the best points of a region, with iterative refinement. Terrain in fast mode unless asked otherwise. */
export function search(
  i: MissionInput & { region: Region; startMs: number; days: number; spacingKm: number; refine?: number; refineTop?: number; top?: number; minSepKm?: number; slope?: SlopeRequest | null },
  w?: WarningSink,
): { grid: GridSearch; mode: Mode; night: NightOptions | null; terrain: TerrainReport | null; nightTruncated: number } {
  if (i.terrain) lowHeightWarning(i.terrain, w);
  const endMs = i.startMs + i.days * DAY_MS;
  validatedDatesWarning(i.startMs, endMs, w);
  const { mode, night, options } = engineOptions(i, 'fast');
  const r = searchGrid(i.region, {
    startMs: i.startMs, endMs, ...options, ...(i.slope ? { slope: i.slope } : {}),
    spacingKm: i.spacingKm,
    refine: i.refine ?? LIMITS.searchDefaultRefineLevels,
    refineTop: i.refineTop ?? LIMITS.searchDefaultRefineTop,
    top: i.top ?? LIMITS.searchDefaultTop,
    minSepKm: i.minSepKm ?? 4 * i.spacingKm,
  });
  if (i.terrain) {
    const flat = r.top.filter((c) => c.horizon !== 'mask').length;
    if (flat) terrainNotApplied(w, flat === r.top.length ? 'todos los puntos' : `${flat} de ${r.top.length} puntos`, true);
    const deep = r.top.filter((c) => c.horizon === 'mask' && isDeepPolar(c)).length;
    if (deep) deepPolarWarning(w, `${deep} de ${r.top.length} puntos: `);
  }
  const nightTruncated = r.top.filter((c) => c.nightTruncated).length;
  if (nightTruncated) truncatedWarning(w, `La noche de ${nightTruncated} de ${r.top.length} puntos`);
  return { grid: r, mode, night, terrain: r.terrain ? pointsTerrain(r.terrain, r.cells, ['punto', 'puntos']) : null, nightTruncated };
}

// ---------------------------------------------------------------- one point, one period (the evals)

/** A mission already resolved (evals scenario): engine options plus constraints. */
export interface PeriodOptions extends EvaluateOptions { constraints?: Constraints }
export interface PeriodEvaluation {
  result: CellResult;
  /** Metrics of the period plus the slope (slopeDeg) when it is known. */
  metrics: CellResult['metrics'] & { slopeDeg?: number };
  /** Constraint violations, with the rule of the uncertified slope (never meets maxSlopeDeg). */
  violations: string[];
}

/**
 * One point over one sampled period: the same evaluation rank, search and light-map make (evaluateCell), with the slope
 * of the point (`slope`, computed once by the caller: it does not depend on the date) and the constraints checked with
 * the same rules as the landing-date sweep. The evals call it for every candidate and date.
 */
export function evaluatePeriod(cell: Cell, sampled: SampledVectors, o: PeriodOptions, slope: SlopeSummary | null = null): PeriodEvaluation {
  const { constraints = {}, ...options } = o;
  const result = evaluateCell(cell, sampled, options);
  const metrics = { ...result.metrics, ...(slope?.slopeDeg != null ? { slopeDeg: slope.slopeDeg } : {}) };
  return { result, metrics, violations: constraintViolations(metrics as Metrics, constraints, slope) };
}
