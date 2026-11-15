// Public API v1: a small, stable contract over the use cases of the engine (backend/src/useCases.ts). Nothing is decided
// here: parameters are validated and turned into typed inputs, the use case computes (defaults, terrain, scoring,
// constraints and domain warnings), and its result is renamed and trimmed to the public format. GraphQL (graphql/) calls
// these routes, and the evals call the same use cases, so the same question gives the same answer by every path (#61).
//
// The engine is imported from the backend (no copy). Its dependencies (astronomy-engine) resolve from backend/node_modules:
// `npm ci` is also needed in backend/.
//
// Terrain: OPTIONAL (`terrain=1`). Without it, the horizon is ALWAYS spherical, even if the backend has catalog masks
// or a cached DEM (v1.0 responses do not change). Since 1.6.0 the Sun can be seen from the panel height (`panelHeightM`)
// and the Earth from the antenna height (`antennaHeightM`); both default to `observerHeightM`. Since 1.8.0, with terrain
// the horizon is hybrid (`horizonRefineDeg`, 0.1° by default; `horizonRefine=0` turns it off). Since 1.9.0, what a
// request asks for and is ignored goes to `warnings` (request.ts) and malformed values are a 400.
import {
  BATTERY_PARAMS, HttpError, optionalNumber, parseDate, parseDecimal, parseDuration, parseFlag, parseMode, parseNightOptions, parsePanel, parseRange, parseRefineOptions, parseSite,
  parseSiteList, parseSlopeOptions,
} from '../../backend/src/params.ts';
import { SLOPE_DEFAULT_BASELINE_M } from '../../backend/src/terrain/slope.ts';
import { SITES } from '../../backend/src/sites.ts';
import { REGIONS, gridCells } from '../../backend/src/search.ts';
import { REFINE_DEFAULT_DEG, catalogMaskHeights, describeMask } from '../../backend/src/horizon.ts';
import { NIGHT_EXTENSION_LIMIT_DAYS } from '../../backend/src/night.ts';
import { PANEL_FORMULAS } from '../../backend/src/panel.ts';
import { SweepOptionError } from '../../backend/src/landingSweep.ts';
import {
  LIMITS, LOW_HEIGHT_M, SCORE_WEIGHTS, VALIDATED_DATES, horizonProfile, landingDates, lightMap, lightMapCells, rank, search, siteSlopeOf, sunEarth, terrainAvailability, track,
  visibilityWindows,
} from '../../backend/src/useCases.ts';
import type { DsnInfo, HeightsRequest, TerrainRequest, Verdict } from '../../backend/src/useCases.ts';
import { CONSTRAINT_PARAMS, given, RequestContext } from './request.ts';
import { PRIORITIES, SAFE_SLOPE_DEG, bestLandings, rankingRange } from '../../planner/src/ranking.js';
import type { VisibilityWindows } from '../../planner/src/ranking.js';
import { BATTERY_DEFAULTS_SOURCES, TRACKING_NOTE } from './notes.ts';
import type {
  BatteryOptions, BodyNow, CellResult, Constraints, LandingDate, HorizonInfo, Mode, NightOptions, Region, Resolution, Site, SlopeSummary, WindowJson, WindowSummary, Weights, BodyWindows,
} from '../../backend/src/types.ts';
import type {
  V1Body, V1BestLandings, V1ConstraintName, V1SiteSlope, V1Health, V1Horizon, V1LandingDate, V1LandingDates, V1LightMap, V1Metrics, V1Rank, V1RankBattery, V1RankNight, V1RankPanel,
  V1Regions, V1Response, V1Search, V1SearchCell, V1Site, V1SiteList, V1Slope, V1SunEarth, V1Terrain, V1Track, V1TrackBody, V1WeightName, V1HorizonBandWindows, V1Windows, V1WindowsDsn, V1WindowSet,
} from './types.ts';

export { LIMITS, LOW_HEIGHT_M, VALIDATED_DATES };

/** Site as the engine gives it: a catalogue entry or the `site` of a response (SiteInfo, with its horizon). */
type EngineSite = Pick<Site, 'id' | 'name' | 'lat' | 'lon' | 'heightKm' | 'verified' | 'custom'> & { region?: string; program?: string; horizon?: HorizonInfo };

export const API_VERSION = '1.24.0';

const HOUR_MS = 3600e3;
const DAY_MS = 86400e3;

// Public name of each constraint → engine name (backend/src/constraints.ts).
const CONSTRAINT_NAMES: Record<V1ConstraintName, keyof Constraints> = {
  minMeanSunDiskFraction: 'minEnergy',
  minSunTimeFraction: 'minSunFraction',
  minEarthTimeFraction: 'minEarthFraction',
  minSunAndEarthTimeFraction: 'minBothFraction',
  maxLongestNightHours: 'maxLongestNightH',
  maxLongestEarthOutageHours: 'maxLongestNoEarthH',
  minLongestSunAndEarthHours: 'minLongestBothH',
  maxBatteryKg: 'maxBatteryKg',
};
const PUBLIC_CONSTRAINT = Object.fromEntries(Object.entries(CONSTRAINT_NAMES).map(([pub, engine]) => [engine, pub])) as Record<keyof Constraints, V1ConstraintName>;
/** Upper bound of each public constraint's limit. */
const CONSTRAINT_MAX: Record<V1ConstraintName, number> = {
  minMeanSunDiskFraction: 1, minSunTimeFraction: 1, minEarthTimeFraction: 1, minSunAndEarthTimeFraction: 1,
  maxLongestNightHours: 1e6, maxLongestEarthOutageHours: 1e6, minLongestSunAndEarthHours: 1e6, maxBatteryKg: 1e6,
};

const bad = (msg: string): HttpError => new HttpError(400, msg);
const hoursBetween = (fromMs: number, isoTo: string | null): number | null => (isoTo === null ? null : Math.round(((Date.parse(isoTo) - fromMs) / HOUR_MS) * 1000) / 1000);

/** Site in public format (works both for the catalog and for the engine's `site`). */
export function publicSite(s: EngineSite): V1Site {
  const horizon = s.horizon ?? { type: 'sphere', source: 'Luna esférica, horizonte a 0°' };
  return {
    id: s.id,
    name: s.name,
    region: s.region ?? null,
    program: s.program ?? null,
    latDeg: s.lat,
    lonDeg: s.lon,
    heightKm: s.heightKm ?? 0,
    coordinatesVerified: s.verified ?? false,
    custom: s.custom ?? false,
    horizonModel: horizon.type, // 'sphere' without terrain; 'mask' with terrain=1 if there is a mask
  };
}

/** Catalogue site of /v1/sites: plus the heights with a precomputed mask (since 1.9.0), only when it has any. */
export function catalogSite(s: Site): V1Site {
  const heights = catalogMaskHeights(s.id);
  return { ...publicSite(s), ...(heights.length ? { terrainMaskHeightsM: heights } : {}) };
}

function publicBody(b: BodyNow, dateMs: number): V1Body {
  return {
    azimuthDeg: b.azimuthDeg,
    elevationDeg: b.elevationDeg,
    angularRadiusDeg: b.angularRadiusDeg,
    distanceKm: b.distanceKm,
    horizonElevationDeg: b.horizonElevationDeg,
    visible: b.visible,
    visibleFraction: b.visibleFraction,
    nextRise: b.nextRise,
    nextSet: b.nextSet,
    hoursToNextRise: hoursBetween(dateMs, b.nextRise),
    hoursToNextSet: hoursBetween(dateMs, b.nextSet),
  };
}

/**
 * Windows clipped to [rangeStart, rangeEnd]: flags whether the body was already visible before or stays visible after.
 * With `events` (since 1.16.0, events=1) also the rises and sets of the body inside the range.
 */
function publicWindows(
  { count, totalHours, fractionOfTime, longestWindowHours, windows: wins, events }: WindowSummary & { windows: WindowJson[]; events?: BodyWindows['events'] },
  rangeStart: string, rangeEnd: string, withEvents: boolean = false,
): V1WindowSet {
  return {
    summary: { count, totalHours, fractionOfTime, longestWindowHours },
    windows: wins.map((w) => ({
      start: w.start,
      end: w.end,
      durationHours: w.hours,
      startsBeforeRange: w.start === rangeStart,
      endsAfterRange: w.end === rangeEnd,
    })),
    ...(withEvents && events ? { events: events.map((e) => ({ type: e.type, time: e.time })) } : {}),
  };
}

// Public name of each score variable of search.ts (normalized weights, summing to 1).
const WEIGHT_NAMES: Record<keyof Weights, V1WeightName> = {
  energy: 'meanSunDiskFraction',
  comm: 'earthTimeFraction',
  both: 'sunAndEarthTimeFraction',
  night: 'shortNights',
  sun: 'sunTimeFraction',
  commGap: 'shortEarthOutages',
  bothStreak: 'longestSunAndEarth',
};
const publicWeights = (w: Readonly<Record<string, number>>): V1Rank['scoreWeights'] =>
  Object.fromEntries(Object.entries(WEIGHT_NAMES).map(([k, name]) => [name, Math.round((w[k] ?? 0) * 1e4) / 1e4])) as V1Rank['scoreWeights'];
/** Weight parameter of each score variable: weightMeanSunDiskFraction… (the last five since 1.16.0). */
const weightParam = (name: V1WeightName): string => `weight${name[0].toUpperCase()}${name.slice(1)}`;
export const WEIGHT_PARAMS = Object.values(WEIGHT_NAMES).map(weightParam);

/** Optional strict decimal in [min, max] (`fallback` when absent or empty). */
const optNumber = (q: URLSearchParams, name: string, fallback: number, min: number, max: number): number => optionalNumber(q, name, min, max) ?? fallback;

/** Optional integer in [min, max]. */
function optInteger(q: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const n = optNumber(q, name, fallback, min, max);
  if (!Number.isInteger(n)) throw bad(`${name} debe ser un entero entre ${min} y ${max}`);
  return n;
}

/** Parameters that only apply with terrain=1. */
const TERRAIN_ONLY_PARAMS = ['observerHeightM', 'panelHeightM', 'antennaHeightM', 'horizonRefine', 'horizonRefineDeg'] as const;

/** observerHeightM and, only the given ones, panelHeightM (Sun) and antennaHeightM (Earth), 0–100 m. */
function heightsRequest(q: URLSearchParams): HeightsRequest {
  const observerHeightM = optNumber(q, 'observerHeightM', LIMITS.observerHeightDefaultM, 0, LIMITS.observerHeightMaxM);
  const panelHeightM = optionalNumber(q, 'panelHeightM', 0, LIMITS.observerHeightMaxM);
  const antennaHeightM = optionalNumber(q, 'antennaHeightM', 0, LIMITS.observerHeightMaxM);
  return { observerHeightM, ...(panelHeightM !== undefined ? { panelHeightM } : {}), ...(antennaHeightM !== undefined ? { antennaHeightM } : {}) };
}

/**
 * `terrain` (1/true/0/false; no terrain by default) and, only with terrain=1, the heights and the hybrid horizon.
 * null = no terrain. The heights are validated even without terrain (a malformed value is a 400) and, when they are
 * ignored, the response says so. `resolution`: precise over HTTP; fast through GraphQL or /v1/search.
 */
function parseTerrain(q: URLSearchParams, ctx: RequestContext | undefined, resolution: Resolution | undefined = ctx?.resolution): TerrainRequest | null {
  const raw = q.get('terrain');
  const off = raw === null || raw === '' || raw === '0' || raw === 'false';
  if (!off && raw !== '1' && raw !== 'true') throw bad('terrain debe ser 1, true, 0 o false');
  const heights = heightsRequest(q);
  const { refine, refineDeg } = parseRefineOptions(q);
  if (!off) {
    // Hybrid horizon: horizonRefine=0 turns it off, horizonRefineDeg sets it and horizonRefine=1 in fast mode (only
    // through GraphQL or /v1/search) turns it on with the precise default; otherwise the use case's default.
    const deg = refine === false ? 0 : refineDeg ?? (refine === true && resolution === 'fast' ? REFINE_DEFAULT_DEG.precise : undefined);
    return { ...heights, ...(deg !== undefined ? { refineDeg: deg } : {}), ...(resolution === 'fast' ? { resolution } : {}) };
  }
  for (const name of TERRAIN_ONLY_PARAMS) {
    if (given(q, name)) ctx?.warn('ignored_parameter', `${name} solo se usa con terrain=1; sin relieve se ignora.`, name);
  }
  return null;
}

/** Site of a single-site route (parseSite) plus the warnings of what it ignores: `lat`/`lon` and `heightKm` when `site` wins. */
function siteOf(q: URLSearchParams, ctx: RequestContext | undefined): Site {
  if (given(q, 'site')) {
    for (const name of ['lat', 'lon', 'heightKm']) {
      if (!given(q, name)) continue;
      parseDecimal(q.get(name)!, name); // ignored, but a malformed value is still a 400
      ctx?.warn('ignored_parameter', name === 'heightKm'
        ? 'heightKm solo se usa con lat y lon; con site se ignora (los sitios del catálogo están en la esfera, a 0 km).'
        : `site tiene prioridad sobre lat y lon: se usa ${q.get('site')} y se ignora ${name}.`, name);
    }
  }
  return parseSite(q);
}

/** Note of `horizonBand` (since 1.18.0). */
const HORIZON_BAND_NOTE = 'Banda de robustez del horizonte: las mismas ventanas con el horizonte del Sol y de la Tierra subido (`raised`: menos visibilidad) '
  + 'y bajado (`lowered`: más) `deg` grados; `range` es el mínimo y el máximo de cada cifra entre el horizonte nominal y los dos desplazados. '
  + 'Mide cuánto cambian las cifras si el horizonte del modelo se equivoca en esos grados; no es un intervalo de confianza.';

/** Note of `dsn` (since 1.24.0). */
const DSN_NOTE = 'Modo DSN: `earthDsn` son las horas con la Tierra visible desde el sitio y, a la vez, la Luna por encima de `minElevationDeg` '
  + 'en al menos una de las tres estaciones de la Deep Space Network (Goldstone, Madrid y Canberra; centro del disco lunar, sin refracción). '
  + 'Coordenadas de las antenas de 70 m: DSN Telecommunications Link Design Handbook (JPL 810-005), módulo 301. '
  + 'La elevación mínima de 10° es un supuesto de partida (`minElevationAssumed`), pendiente de fuente oficial. '
  + 'No comprueba que la estación esté asignada a la misión: solo que podría apuntar a la Luna.';

/** Echo of the DSN mode (since 1.24.0, dsn=1). */
const publicDsn = (d: DsnInfo): V1WindowsDsn => ({
  minElevationDeg: d.minElevationDeg,
  minElevationAssumed: d.minElevationAssumed,
  stations: d.stations.map(({ id, name, antenna, lat, lon, heightM }) => ({ id, name, antenna, lat, lon, heightM })),
  note: DSN_NOTE,
});

/** `earthMinElevationDeg` (0–90°, since 1.9.0): minimum elevation of the Earth above the horizon to count as visible. */
const parseEarthMin = (q: URLSearchParams): number => optNumber(q, 'earthMinElevationDeg', 0, 0, LIMITS.earthMinElevationMaxDeg);
/** Echo of earthMinElevationDeg, only when it changes something. */
const earthMinEcho = (deg: number): { earthMinElevationDeg?: number } => (deg > 0 ? { earthMinElevationDeg: deg } : {});
/** `earthMode` (since 1.16.0): Earth visibility criterion of rank, landing-dates and search; absent = `mode`. */
const parseEarthMode = (q: URLSearchParams): Mode | undefined => (given(q, 'earthMode') ? parseMode(q.get('earthMode')) : undefined);
/** Echo of earthMode, only when it differs from mode. */
const earthModeEcho = (earthMode: Mode | undefined, mode: Mode): { earthMode?: Mode } => (earthMode && earthMode !== mode ? { earthMode } : {});

/**
 * Score weights of rank, landing-dates and search: only the given ones (the use case keeps the default for the rest).
 * Since 1.16.0 every score variable has its weight parameter.
 */
function parseWeights(q: URLSearchParams): Partial<Weights> | undefined {
  const given_ = (Object.entries(WEIGHT_NAMES) as [keyof Weights, V1WeightName][])
    .map(([k, name]) => [k, optionalNumber(q, weightParam(name), 0, 100)] as const).filter(([, v]) => v !== undefined) as [keyof Weights, number][];
  if (!given_.length) return undefined;
  const w = Object.fromEntries(given_) as Partial<Weights>;
  if (Object.values({ ...SCORE_WEIGHTS, ...w }).reduce((a, b) => a + b, 0) <= 0) {
    throw bad('Al menos un peso debe ser positivo (weightMeanSunDiskFraction o weightEarthTimeFraction)');
  }
  return w;
}

/** Sample step of rank and search (`step`, since 1.16.0): 15 min–6 h, 1 h by default. */
function parseSampleStep(q: URLSearchParams): number {
  if (!given(q, 'step')) return LIMITS.sampleDefaultStepMinutes * 60e3;
  const ms = parseDuration(q.get('step'), 'step');
  if (ms < LIMITS.sampleMinStepMinutes * 60e3 || ms > LIMITS.sampleMaxStepMinutes * 60e3 || ms % 60e3 !== 0) {
    throw bad(`step debe ser un número entero de minutos entre ${LIMITS.sampleMinStepMinutes} min y ${LIMITS.sampleMaxStepMinutes / 60} h`);
  }
  return ms;
}

/** Constraints with their public names (echo) and engine names. Fractions within 0–1. */
function parseConstraints(q: URLSearchParams): { echo: Partial<Record<V1ConstraintName, number>>; engine: Constraints } {
  const echo: Partial<Record<V1ConstraintName, number>> = {};
  const engine: Constraints = {};
  for (const name of CONSTRAINT_PARAMS) {
    if (!given(q, name)) continue;
    echo[name] = engine[CONSTRAINT_NAMES[name]] = optNumber(q, name, 0, 0, CONSTRAINT_MAX[name]);
  }
  return { echo, engine };
}

/** Night options. Warns about battery inputs that battery=0 ignores. */
function parseNight(q: URLSearchParams, ctx: RequestContext | undefined): NightOptions | null {
  const parsed = parseNightOptions(q);
  if ((q.get('battery') === '0' || q.get('battery') === 'false') && !parsed?.battery) {
    for (const name of Object.values(BATTERY_PARAMS)) {
      if (given(q, name)) ctx?.warn('ignored_parameter', `battery=0 apaga la batería: ${name} se ignora.`, name);
    }
  }
  return parsed;
}

/** Text added to a battery note when the whole night reached the search limit. */
const TRUNCATED_NOTE = `AVISO: la noche sigue más allá del límite de búsqueda (${NIGHT_EXTENSION_LIMIT_DAYS} días a cada lado del periodo; sombra casi `
  + 'permanente): longestNightFullHours y la batería son solo un mínimo, no la noche real.';

/** Explanation that goes with every battery figure: what the mass includes and where the defaults come from. */
export const BATTERY_NOTE = 'Solo la masa del pack de baterías: sin electrónica, sin el panel solar extra para recargarlo y sin márgenes '
  + `(a nivel de sistema sale unas 2–3 veces más). ${BATTERY_DEFAULTS_SOURCES}`;

const batteryEcho = (b: BatteryOptions): Pick<V1RankBattery, 'survivalLoadW' | 'whPerKg' | 'depthOfDischarge'> =>
  ({ survivalLoadW: b.survivalLoadW, whPerKg: b.whPerKg, depthOfDischarge: b.depthOfDischarge });

/** `night` and `battery` of rank, landing-dates and search (only when asked for). */
function rankNightEcho(night: NightOptions | null, truncated: boolean = false): { night?: V1RankNight; battery?: V1RankBattery } {
  if (!night) return {};
  const fullNight = night.fullNight === true;
  const minSunFraction = night.nightMinSunFraction ?? 0;
  return {
    ...(fullNight || minSunFraction > 0 ? { night: { minSunFraction, fullNight, ...(fullNight ? { extensionLimitDays: NIGHT_EXTENSION_LIMIT_DAYS } : {}) } } : {}),
    ...(night.battery ? {
      battery: { ...batteryEcho(night.battery), nightMetric: fullNight ? 'longestNightFullHours' : 'longestNightHours', note: truncated ? `${BATTERY_NOTE} ${TRUNCATED_NOTE}` : BATTERY_NOTE },
    } : {}),
  };
}

/** Explanation that goes with the panel echo. */
export const PANEL_NOTE = 'Solo cambia meanSunDiskFraction (y con ella la puntuación): en cada paso, fracción visible del disco solar × '
  + 'factor del panel (el = elevación del centro del Sol). Geometría pura: sin eficiencia de célula, temperatura, oscurecimiento '
  + 'del limbo, variación de la distancia al Sol (±3,4 %), sombras del propio módulo ni polvo.';

/** `panel` echo (only when it is not the default, tracking). */
const rankPanelEcho = (panel: V1RankPanel['orientation'] | undefined): { panel?: V1RankPanel } =>
  (panel ? { panel: { orientation: panel, factor: PANEL_FORMULAS[panel], note: PANEL_NOTE } } : {});

/** Metrics with their public names (same order and rounding as the engine). */
const publicMetrics = (m: CellResult['metrics'], nightTruncated?: true): V1Metrics => ({
  meanSunDiskFraction: m.energy,
  sunTimeFraction: m.sunFraction,
  earthTimeFraction: m.earthFraction,
  sunAndEarthTimeFraction: m.bothFraction,
  longestNightHours: m.longestNightH,
  longestEarthOutageHours: m.longestNoEarthH,
  longestSunAndEarthHours: m.longestBothH,
  ...(m.longestNightFullH !== undefined ? { longestNightFullHours: m.longestNightFullH } : {}),
  ...(nightTruncated ? { nightTruncated } : {}),
  ...(m.batteryKg !== undefined ? { batteryKWh: m.batteryKWh!, batteryKg: m.batteryKg } : {}),
});

/** Constraint verdict of the use case with public names (nothing without constraints). */
function publicVerdict(v: Verdict | null | undefined): Pick<V1LandingDate, 'meetsConstraints' | 'violatedConstraints'> {
  if (!v) return {};
  return { meetsConstraints: v.meets, ...(!v.meets ? { violatedConstraints: v.violated.map((n) => PUBLIC_CONSTRAINT[n]) } : {}) };
}

/**
 * Slope in public form: `meetsMaxSlope` is null, not false, when the slope is unknown (no DEM there, since 1.9.0); the
 * engine already gives null for an uncertified slope (underestimated, since 1.12.0).
 */
function publicSlope<T extends SlopeSummary>(s: T): T & V1Slope {
  return s.meetsMaxSlope !== undefined && s.slopeDeg === null ? { ...s, meetsMaxSlope: null } : s;
}
const slopeEcho = (s: SlopeSummary | null): { slope?: V1SiteSlope } => (s ? { slope: publicSlope(s) as V1SiteSlope } : {});

/**
 * Slope of a site alone (GraphQL `Site.slope`): the same object `slope` that /v1/sun-earth gives with slope=1,
 * slopeBaselineM or maxSlopeDeg, without computing anything else. `q` has the site and the slope parameters.
 */
export function siteSlopeOnly(q: URLSearchParams, ctx: RequestContext): V1SiteSlope {
  const site = siteOf(q, ctx);
  return slopeEcho(siteSlopeOf(site, parseSlopeOptions(q) ?? { baselineM: SLOPE_DEFAULT_BASELINE_M })).slope!;
}

/** slopeUncertified only does something with maxSlopeDeg. */
function slopeRequest(q: URLSearchParams, ctx: RequestContext | undefined) {
  const slope = parseSlopeOptions(q);
  if (given(q, 'slopeUncertified') && slope?.maxSlopeDeg === undefined) {
    ctx?.warn('ignored_parameter', 'slopeUncertified solo se usa con maxSlopeDeg (decide qué hace el filtro con las pendientes sin certificar); sin él se ignora.', 'slopeUncertified');
  }
  return slope;
}

/** A route: query → response body. Warnings go to `ctx`; the server adds them to the body (`warnings`) when there are any. */
export type Route = (q: URLSearchParams, ctx: RequestContext) => V1Response;

export const routes: Record<string, Route> = {
  '/v1/health': (): V1Health => ({ status: 'ok', apiVersion: API_VERSION, uptimeSeconds: Math.round(process.uptime()), terrain: terrainAvailability() }),

  '/v1/sites': (): V1SiteList => ({ count: SITES.length, sites: SITES.map(catalogSite) }),

  // Predefined regions of /v1/search (since 1.16.0).
  '/v1/regions': (): V1Regions => {
    const regions = Object.entries(REGIONS).map(([id, r]) => ({ id, latMinDeg: r.latMin, latMaxDeg: r.latMax, lonMinDeg: r.lonMin, lonMaxDeg: r.lonMax }));
    return { count: regions.length, regions };
  },

  '/v1/sun-earth': (q, ctx): V1SunEarth => {
    const terrain = parseTerrain(q, ctx);
    const site = siteOf(q, ctx);
    const dateMs = parseDate(q.get('date'), 'date', Date.now());
    const r = sunEarth({ site, terrain, dateMs, mode: parseMode(q.get('mode')), earthMinElevationDeg: parseEarthMin(q), slope: parseSlopeOptions(q) }, ctx);
    const sun = publicBody(r.snapshot.bodies.sun, dateMs);
    const earth = publicBody(r.snapshot.bodies.earth, dateMs);
    return {
      site: publicSite(r.snapshot.site),
      date: r.snapshot.date,
      mode: r.mode,
      lookaheadDays: r.lookaheadDays,
      sun,
      earth,
      sunAndEarthVisible: sun.visible && earth.visible,
      ...earthMinEcho(r.earthMinElevationDeg),
      ...(r.terrain ? { terrain: r.terrain } : {}),
      ...slopeEcho(r.slope),
    };
  },

  '/v1/windows': (q, ctx): V1Windows => {
    const terrain = parseTerrain(q, ctx);
    const site = siteOf(q, ctx);
    const { start, end } = parseRange(q, { maxDays: LIMITS.windowsMaxDays, defaultDays: LIMITS.windowsDefaultDays });
    const withEvents = given(q, 'events') && parseFlag(q, 'events');
    const r = visibilityWindows({
      site, terrain, startMs: start, endMs: end, mode: parseMode(q.get('mode')), night: parseNight(q, ctx), earthMinElevationDeg: parseEarthMin(q), slope: parseSlopeOptions(q),
      horizonBandDeg: optNumber(q, 'horizonBandDeg', 0, 0, LIMITS.horizonBandMaxDeg), dsn: given(q, 'dsn') && parseFlag(q, 'dsn'),
    }, ctx);
    const w = r.windows;
    const n = w.night;
    const band = r.horizonBand;
    const shifted = (x: typeof w): V1HorizonBandWindows => ({
      sun: publicWindows(x.sun, w.start, w.end), earth: publicWindows(x.earth, w.start, w.end), sunAndEarth: publicWindows(x.sunAndEarth, w.start, w.end),
    });
    return {
      site: publicSite(w.site),
      start: w.start,
      end: w.end,
      mode: r.mode,
      sun: publicWindows(w.sun, w.start, w.end, withEvents),
      earth: publicWindows(w.earth, w.start, w.end, withEvents),
      sunAndEarth: publicWindows(w.sunAndEarth, w.start, w.end),
      ...(w.earthDsn && r.dsn ? { earthDsn: publicWindows(w.earthDsn, w.start, w.end), dsn: publicDsn(r.dsn) } : {}),
      ...earthMinEcho(r.earthMinElevationDeg),
      ...(r.terrain ? { terrain: r.terrain } : {}),
      ...(n ? {
        night: {
          minSunFraction: n.minSunFraction,
          sampleStepMinutes: n.stepMinutes,
          longestNightHours: n.longestNightHours,
          ...(n.longestNightFullHours !== undefined ? { longestNightFullHours: n.longestNightFullHours, extensionLimitDays: n.extensionLimitDays! } : {}),
          ...(r.nightTruncated ? { nightTruncated: true as const } : {}),
        },
      } : {}),
      ...(n?.battery ? {
        battery: {
          ...batteryEcho(n.battery),
          nightMetric: n.longestNightFullHours !== undefined ? 'longestNightFullHours' : 'longestNightHours',
          nightHours: n.battery.nightHours,
          batteryKWh: n.battery.kWh,
          batteryKg: n.battery.kg,
          note: r.nightTruncated ? `${BATTERY_NOTE} ${TRUNCATED_NOTE}` : BATTERY_NOTE,
        },
      } : {}),
      ...slopeEcho(r.slope),
      ...(band ? { horizonBand: { deg: band.deg, range: band.range, raised: shifted(band.raised), lowered: shifted(band.lowered), note: HORIZON_BAND_NOTE } } : {}),
    };
  },

  '/v1/track': (q, ctx): V1Track => {
    const terrain = parseTerrain(q, ctx);
    const site = siteOf(q, ctx);
    const { start, end } = parseRange(q, { maxDays: LIMITS.trackMaxDays, defaultDays: LIMITS.trackDefaultDays });
    const stepMs = given(q, 'step') ? parseDuration(q.get('step'), 'step') : HOUR_MS;
    if (stepMs < LIMITS.trackMinStepMinutes * 60e3 || stepMs > LIMITS.trackMaxStepMinutes * 60e3) {
      throw bad(`step debe estar entre ${LIMITS.trackMinStepMinutes} min y ${LIMITS.trackMaxStepMinutes} min`);
    }
    const points = Math.floor((end - start) / stepMs) + 1;
    if (points > LIMITS.trackMaxPoints) throw bad(`Demasiados puntos (${points}); el máximo es ${LIMITS.trackMaxPoints}. Aumenta step o reduce el intervalo`);
    const r = track({ site, terrain, startMs: start, endMs: end, stepMs }, ctx);
    const s = r.series;
    const body = (b: typeof s.sun, horizon: number[]): V1TrackBody => ({ azimuthDeg: b.az, elevationDeg: b.el, horizonElevationDeg: horizon, visibleFraction: b.visibleFraction, angularRadiusDeg: b.angularRadiusDeg });
    return {
      site: publicSite(s.site),
      start: s.start,
      end: s.end,
      stepMinutes: s.stepMinutes,
      times: s.t,
      sun: body(s.sun, r.horizonDeg.sun),
      earth: body(s.earth, r.horizonDeg.earth),
      ...(r.terrain ? { terrain: r.terrain } : {}),
    };
  },

  // The horizon profile only makes sense with terrain: it is always computed as with terrain=1.
  '/v1/horizon': (q, ctx): V1Horizon => {
    const site = siteOf(q, ctx);
    // relief=1 (or a radius) adds the terrain heights around the site, only to draw it (since 1.19.0). Without it, nothing changes.
    const withRelief = given(q, 'reliefRadiusKm') || (given(q, 'relief') && parseFlag(q, 'relief'));
    const { mask, terrain, relief } = horizonProfile({
      site,
      observerHeightM: optNumber(q, 'observerHeightM', LIMITS.observerHeightDefaultM, 0, LIMITS.observerHeightMaxM),
      ...(withRelief ? { relief: { radiusKm: optNumber(q, 'reliefRadiusKm', LIMITS.reliefDefaultRadiusKm, LIMITS.reliefMinRadiusKm, LIMITS.reliefMaxRadiusKm) } } : {}),
    }, ctx);
    return {
      site: publicSite({ ...site, horizon: describeMask(mask) }),
      azimuthStepDeg: mask ? mask.stepDeg : 1,
      elevationDeg: mask ? Array.from(mask.el, (e: number) => Math.round(e * 100) / 100) : new Array(360).fill(0),
      groundHeightM: mask?.heightM ?? null,
      ...(withRelief ? {
        relief: relief
          ? { radiusKm: relief.radiusKm, azimuthStepDeg: relief.stepDeg, groundHeightM: Math.round(relief.groundM * 100) / 100, distancesM: relief.distancesM, heightsM: relief.heightsM }
          : null,
      } : {}),
      terrain,
    };
  },

  // Light map: share of the period with the Sun (and the Earth) at every point of a disc, always over the LOLA terrain.
  '/v1/light-map': (q, ctx): V1LightMap => {
    const centred = given(q, 'site') || given(q, 'lat') || given(q, 'lon');
    const centre = centred ? siteOf(q, ctx) : { lat: -90, lon: 0 };
    const radiusKm = optNumber(q, 'radiusKm', LIMITS.lightMapDefaultRadiusKm, 0.5, LIMITS.lightMapMaxRadiusKm);
    const spacingKm = optNumber(q, 'spacingKm', Math.max(LIMITS.lightMapMinSpacingKm, Math.round((radiusKm / 15) * 100) / 100), LIMITS.lightMapMinSpacingKm, LIMITS.lightMapMaxSpacingKm);
    const cells = lightMapCells(centre, radiusKm, spacingKm);
    if (cells.length > LIMITS.lightMapMaxPoints) {
      throw bad(`Demasiados puntos (${cells.length}); el máximo es ${LIMITS.lightMapMaxPoints}. Aumenta spacingKm o reduce radiusKm`);
    }
    const startMs = parseDate(q.get('start'), 'start', Date.now());
    const days = optNumber(q, 'days', LIMITS.lightMapDefaultDays, 0.5, LIMITS.lightMapMaxDays);
    const endMs = startMs + days * DAY_MS;
    const r = lightMap({ cells, startMs, endMs, mode: parseMode(q.get('mode')), heights: heightsRequest(q) }, ctx);
    const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;
    const out = { latDeg: [] as number[], lonDeg: [] as number[], xKm: [] as number[], yKm: [] as number[], sunTimeFraction: [] as number[], earthTimeFraction: [] as number[], longestNightHours: [] as number[], withTerrain: [] as boolean[] };
    for (const { cell: c, result } of r.points) {
      out.latDeg.push(round4(c.lat)); out.lonDeg.push(round4(c.lon));
      out.xKm.push(round4(c.xKm)); out.yKm.push(round4(c.yKm));
      out.sunTimeFraction.push(result.metrics.sunFraction);
      out.earthTimeFraction.push(result.metrics.earthFraction);
      out.longestNightHours.push(result.metrics.longestNightH);
      out.withTerrain.push(result.horizon === 'mask');
    }
    return {
      centre: { latDeg: round4(centre.lat), lonDeg: round4(centre.lon) },
      radiusKm,
      spacingKm,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      mode: r.mode,
      count: cells.length,
      points: out,
      terrain: r.terrain,
    };
  },

  // Best landings: the best landing of each site in a window, judged with the mission rules of planner/ (the same code
  // and the same score the web uses), and the sites ordered. The windows of each site are those of /v1/windows (the
  // visibilityWindows use case: same terrain, same warnings).
  '/v1/best-landings': (q, ctx): V1BestLandings => {
    if (!given(q, 'sites')) throw bad('Falta sites (ids del catálogo o lat:lon separados por comas, hasta 10)');
    const sites = parseSiteList(q.get('sites'), (item) => ctx?.warn('duplicate_site', `${item} está repetido en sites; se evalúa una sola vez.`, 'sites'));
    const from = parseDate(q.get('start'), 'start'), to = parseDate(q.get('end'), 'end');
    if (to < from) throw bad('end no puede ser anterior a start');
    if (to - from > LIMITS.bestLandingsMaxRangeDays * DAY_MS) throw bad(`La ventana de aterrizaje puede durar como mucho ${LIMITS.bestLandingsMaxRangeDays} días`);
    const mission = {
      days: optNumber(q, 'days', 10, 0.5, LIMITS.bestLandingsMaxMissionDays),
      batteryHours: optNumber(q, 'batteryHours', 12, 0, 720),
      minEarthPct: optNumber(q, 'minEarthPct', 60, 0, 100),
      ...(given(q, 'maxEarthGapHours') ? { maxEarthGapHours: optNumber(q, 'maxEarthGapHours', 0, 0, 720) } : {}),
    };
    const priority = q.get('priority') || 'energy';
    if (!PRIORITIES.some((p) => p.id === priority)) throw bad(`priority debe ser una de: ${PRIORITIES.map((p) => p.id).join(', ')}`);
    const mode = given(q, 'mode') ? parseMode(q.get('mode')) : 'full'; // the mission rules count the whole disc
    const terrain = parseTerrain(q, ctx);
    const range = rankingRange({ from, to, days: mission.days });
    const windowsBySite: Record<string, VisibilityWindows> = {}, infos: V1Terrain[] = [], models: Record<string, 'mask' | 'sphere'> = {};
    const spans = (list: readonly WindowJson[]): [number, number][] => list.map((x) => [Date.parse(x.start), Date.parse(x.end)]);
    for (const site of sites) {
      // The slope for R9, measured against the maximum of the mission rules (SAFE_SLOPE_DEG over 100 m).
      const slope = { baselineM: SLOPE_DEFAULT_BASELINE_M, maxSlopeDeg: SAFE_SLOPE_DEG, uncertified: 'exclude' as const };
      const u = visibilityWindows({ site, terrain, startMs: range.fromMs, endMs: range.toMs, mode, slope }, ctx);
      if (u.terrain) infos.push(u.terrain);
      models[site.id] = u.horizonModel;
      const w = u.windows;
      windowsBySite[site.id] = {
        site: { id: site.id, name: site.name, latDeg: site.lat, lonDeg: site.lon, horizonModel: models[site.id] },
        startMs: range.fromMs, endMs: range.toMs,
        sun: spans(w.sun.windows), earth: spans(w.earth.windows), sunAndEarth: spans(w.sunAndEarth.windows),
        slope: u.slope ? publicSlope(u.slope) : null,
      };
    }
    const r = bestLandings({ windowsBySite, sites, from, to, mission, priority });
    const byId = new Map(sites.map((s) => [s.id, s]));
    const iso = (ms: number): string => new Date(ms).toISOString();
    const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
    const withMask = sites.filter((s) => models[s.id] === 'mask').length;
    const heights = infos[0];
    return {
      start: iso(from),
      end: iso(to),
      mission,
      priority,
      mode,
      stepHours: r.stepHours,
      tested: r.tested,
      options: r.options.map((o, i) => {
        const site = byId.get(o.siteId)!, m = o.metrics as Record<string, number | boolean | null>;
        return {
          rank: i + 1,
          siteId: site.id,
          name: site.name,
          latDeg: site.lat,
          lonDeg: site.lon,
          ...(terrain ? { horizonModel: models[site.id] } : {}),
          landing: iso(o.landing),
          verdict: o.verdict,
          reason: o.reason,
          reasons: o.reasons,
          trace: o.trace,
          score: Math.round(o.score * 50 * 100) / 100,
          scoreParts: { energy: r4(o.parts.energy), comms: r4(o.parts.comms), early: r4(o.parts.early), delays: r4(o.parts.delays) },
          metrics: o.metrics.noData ? null : {
            sunAtLanding: m.sunAtLanding as boolean,
            earthAtLanding: m.earthAtLanding as boolean,
            longestShadowHours: r4(m.longestShadowHours as number),
            longestEarthOutageHours: r4(m.longestEarthOutageHours as number),
            sunTimeFraction: r4(m.sunFraction as number),
            earthTimeFraction: r4(m.earthFraction as number),
            sunAndEarthTimeFraction: r4(m.sunAndEarthFraction as number),
            sunlightAfterLandingHours: r4(m.sunlightAfterLandingHours as number),
            earthAfterLandingHours: r4(m.earthAfterLandingHours as number),
          },
          robustness: { maxDelayDays: o.robustness.maxDelayDays, nextWindow: o.robustness.nextWindow === null ? null : iso(o.robustness.nextWindow) },
          viableInWindow: o.viableInWindow,
          landings: o.landings.map((k) => ({ landing: iso(k.t), verdict: k.verdict, reason: k.reason, streak: k.streak })),
        };
      }),
      ...(terrain && heights ? {
        terrain: {
          observerHeightM: heights.observerHeightM,
          ...(heights.panelHeightM !== undefined ? { panelHeightM: heights.panelHeightM, antennaHeightM: heights.antennaHeightM } : {}),
          applied: withMask > 0,
          source: withMask === 0 ? null : infos.some((x) => x.source === 'dem') ? 'dem' : 'catalog',
          demVersion: infos.find((x) => x.demVersion)?.demVersion ?? null,
          note: `Relieve LOLA en ${withMask} de ${sites.length} sitios${withMask < sites.length ? '; el resto, horizonte esférico (0°)' : ''}.`,
        },
      } : {}),
    };
  },

  '/v1/rank': (q, ctx): V1Rank => {
    const raw = q.get('sites') || 'all';
    const sites = raw === 'all' ? SITES : parseSiteList(raw, (item) => ctx?.warn('duplicate_site', `${item} está repetido en sites; se evalúa una sola vez.`, 'sites'));
    const startMs = parseDate(q.get('start'), 'start', Date.now());
    const days = optNumber(q, 'days', LIMITS.rankDefaultDays, LIMITS.rankMinDays, LIMITS.rankMaxDays);
    const mode = parseMode(q.get('mode'));
    const terrain = parseTerrain(q, ctx);
    const constraints = parseConstraints(q);
    const night = parseNight(q, ctx);
    const { panel } = parsePanel(q);
    const slope = slopeRequest(q, ctx);
    const weights = parseWeights(q);
    const earthMode = parseEarthMode(q);
    const earthMin = parseEarthMin(q);
    const u = rank({
      sites, startMs, days, mode, earthMode, stepMs: parseSampleStep(q), weights, earthMinElevationDeg: earthMin, terrain, night, panel, slope, constraints: constraints.engine,
    }, ctx);
    const r = u.ranking;
    return {
      start: r.start,
      end: r.end,
      days,
      mode,
      ...earthModeEcho(earthMode, mode),
      sampleStepMinutes: r.stepMinutes,
      scoreWeights: publicWeights(r.weights),
      ...(Object.keys(constraints.echo).length ? { constraints: constraints.echo } : {}),
      ...earthMinEcho(earthMin),
      results: u.results.map(({ cell: c, verdict }) => ({
        rank: c.rank,
        siteId: c.id!, // rankSites keeps the id and name of each site
        name: c.name!,
        latDeg: c.lat,
        lonDeg: c.lon,
        score: c.score,
        ...publicVerdict(verdict),
        ...(terrain ? { horizonModel: c.horizon } : {}),
        metrics: publicMetrics(c.metrics, c.nightTruncated),
        ...(c.slope ? { slope: publicSlope(c.slope) } : {}),
      })),
      ...(u.terrain ? { terrain: u.terrain } : {}),
      ...rankNightEcho(u.night, u.nightTruncated > 0),
      ...rankPanelEcho(panel),
      ...(r.slope ? {
        slope: {
          baselineM: r.slope.baselineM,
          ...(r.slope.maxSlopeDeg !== undefined ? {
            maxSlopeDeg: r.slope.maxSlopeDeg,
            uncertified: r.slope.uncertified ?? 'exclude',
            excludedSiteIds: r.slope.excludedSites ?? [],
            ...(u.excluded.length ? { excluded: u.excluded.map(({ id, reason, slopeDeg }) => ({ siteId: id, reason, slopeDeg })) } : {}),
          } : {}),
          note: r.slope.note,
        },
      } : {}),
      note: panel ? r.note : `${r.note} ${TRACKING_NOTE}`,
    };
  },

  '/v1/landing-dates': (q, ctx): V1LandingDates => {
    const terrain = parseTerrain(q, ctx);
    const site = siteOf(q, ctx);
    const startMs = parseDate(q.get('start'), 'start', Date.now());
    const endMs = given(q, 'end') ? parseDate(q.get('end'), 'end') : startMs + LIMITS.landingDefaultRangeDays * DAY_MS;
    if (endMs < startMs) throw bad('end debe ser igual o posterior a start');
    if (endMs - startMs > LIMITS.landingMaxRangeDays * DAY_MS) throw bad(`El rango de fechas de alunizaje es de ${LIMITS.landingMaxRangeDays} días como máximo`);
    const dateStepMs = given(q, 'dateStep') ? parseDuration(q.get('dateStep'), 'dateStep') : DAY_MS;
    if (dateStepMs < LIMITS.landingMinDateStepHours * HOUR_MS || dateStepMs > LIMITS.landingMaxDateStepHours * HOUR_MS) {
      throw bad(`dateStep debe estar entre ${LIMITS.landingMinDateStepHours} h y ${LIMITS.landingMaxDateStepHours / 24} d`);
    }
    if (dateStepMs % HOUR_MS !== 0) throw bad('dateStep debe ser un número entero de horas');
    const missionDays = optNumber(q, 'days', LIMITS.landingDefaultMissionDays, 1, LIMITS.landingMaxMissionDays);
    if ((missionDays * DAY_MS) % HOUR_MS !== 0) throw bad('days debe equivaler a un número entero de horas');
    const mode = parseMode(q.get('mode'));
    const constraints = parseConstraints(q);
    const night = parseNight(q, ctx);
    const { panel } = parsePanel(q);
    const slope = parseSlopeOptions(q);
    const weights = parseWeights(q);
    const earthMode = parseEarthMode(q);
    const earthMin = parseEarthMin(q);
    const minScore = given(q, 'minScore') ? optNumber(q, 'minScore', 0, 0, 100) : null;
    const top = optInteger(q, 'top', LIMITS.landingDefaultTop, 1, LIMITS.landingMaxTop);
    // Since 1.10.0: dates=0 leaves out the series of every date (the largest part of the response).
    const withDates = !given(q, 'dates') || parseFlag(q, 'dates');
    let u;
    try {
      u = landingDates({
        site, startMs, endMs, dateStepMs, missionDays, mode, earthMode, earthMinElevationDeg: earthMin, weights, terrain, night, panel, slope, constraints: constraints.engine, minScore, top,
      }, ctx);
    } catch (e) {
      if (e instanceof SweepOptionError) throw bad((e as Error).message);
      throw e;
    }
    const r = u.sweep;
    const publicDate = (d: LandingDate): V1LandingDate => ({
      date: d.date,
      score: d.score,
      ...publicVerdict(u.verdicts.get(d)),
      sunVisibleAtLanding: d.sun.visibleAtLanding,
      hoursToSunChange: d.sun.hoursToChange,
      metrics: publicMetrics(d.metrics, d.nightTruncated),
    });
    const ranked = (d: LandingDate & { rank: number }): V1LandingDate & { rank: number } => ({ rank: d.rank, ...publicDate(d) });
    return {
      site: { ...publicSite(site), horizonModel: r.site.horizon ?? 'sphere' },
      start: r.start,
      end: r.end,
      dateStepHours: r.dateStepHours,
      missionDays: r.missionDays,
      sampleStepMinutes: r.stepMinutes,
      mode,
      ...earthModeEcho(earthMode, mode),
      scoreWeights: publicWeights(r.weights),
      ...(Object.keys(constraints.echo).length ? { constraints: constraints.echo } : {}),
      ...earthMinEcho(earthMin),
      goodCriterion: r.goodCriterion,
      stats: {
        dateCount: r.stats.dates,
        score: r.stats.score,
        meanSunDiskFraction: r.stats.energy,
        ...(r.stats.feasibleFraction !== undefined ? { meetsConstraintsFraction: r.stats.feasibleFraction } : {}),
        goodFraction: r.stats.goodFraction,
      },
      best: r.best.map(ranked),
      worst: r.worst.map(ranked),
      goodWindows: r.goodWindows.map((w) => ({ start: w.start, end: w.end, durationDays: w.durationDays, dateCount: w.dates, bestDate: w.best.date, bestScore: w.best.score })),
      ...(withDates ? { dates: r.dates.map(publicDate) } : {}),
      ...(u.terrain ? { terrain: u.terrain } : {}),
      ...rankNightEcho(u.night, u.nightTruncated > 0),
      ...rankPanelEcho(panel),
      ...slopeEcho(u.slope),
      note: r.note,
    };
  },

  '/v1/search': (q, ctx): V1Search => {
    const s = parseSearch(q, ctx);
    const u = search(s.input, ctx);
    const r = u.grid;
    const terrain = s.input.terrain;
    const cell = (c: CellResult & { level: number }): V1SearchCell => ({
      latDeg: c.lat,
      lonDeg: c.lon,
      score: c.score,
      refineLevel: c.level,
      ...(terrain ? { horizonModel: c.horizon } : {}),
      metrics: publicMetrics(c.metrics, c.nightTruncated),
      ...(c.slope ? { slope: publicSlope(c.slope) } : {}),
    });
    return {
      region: { preset: s.preset, latMinDeg: r.region.latMin, latMaxDeg: r.region.latMax, lonMinDeg: r.region.lonMin, lonMaxDeg: r.region.lonMax },
      start: r.start,
      end: r.end,
      days: s.input.days,
      mode: r.mode,
      ...earthModeEcho(s.input.earthMode, r.mode),
      sampleStepMinutes: r.stepMinutes,
      spacingKm: s.input.spacingKm,
      levels: r.levels,
      evaluated: r.evaluated,
      minSeparationKm: r.minSeparationKm,
      scoreWeights: publicWeights(r.weights),
      ...earthMinEcho(s.input.earthMinElevationDeg ?? 0),
      results: r.top.map((c) => ({ rank: c.rank, ...cell(c) })),
      ...(s.cells ? { cells: r.cells.map(cell) } : {}),
      ...(u.terrain ? { terrain: u.terrain, terrainResolution: r.terrain!.resolution } : {}),
      ...rankNightEcho(u.night, u.nightTruncated > 0),
      ...rankPanelEcho(s.input.panel),
      ...(r.slope ? {
        slope: {
          baselineM: r.slope.baselineM,
          ...(r.slope.maxSlopeDeg !== undefined ? { maxSlopeDeg: r.slope.maxSlopeDeg, uncertified: r.slope.uncertified ?? 'exclude', excludedCount: r.slope.excluded ?? 0 } : {}),
          note: r.slope.note,
        },
      } : {}),
      note: s.input.panel ? r.note : `${r.note} ${TRACKING_NOTE}`,
    };
  },
};

/** Parameters of /v1/search, validated without computing anything (also used to accept an asynchronous job). */
export function parseSearch(q: URLSearchParams, ctx: RequestContext) {
  const preset = given(q, 'region') ? q.get('region')! : null;
  if (preset !== null && !REGIONS[preset]) throw bad(`region debe ser una de: ${Object.keys(REGIONS).join(', ')} (o da latMin, latMax, lonMin y lonMax)`);
  const base = REGIONS[preset ?? 'polo-sur'];
  const region: Region = {
    latMin: optNumber(q, 'latMin', base.latMin, -90, 90),
    latMax: optNumber(q, 'latMax', base.latMax, -90, 90),
    lonMin: optNumber(q, 'lonMin', base.lonMin, -180, 180),
    lonMax: optNumber(q, 'lonMax', base.lonMax, -180, 180),
  };
  if (region.latMin > region.latMax || region.lonMin >= region.lonMax) throw bad('Región vacía: latMin ≤ latMax y lonMin < lonMax');
  const startMs = parseDate(q.get('start'), 'start', Date.now());
  const days = optNumber(q, 'days', LIMITS.searchDefaultDays, 1, LIMITS.searchMaxDays);
  const mode = parseMode(q.get('mode'));
  const rawResolution = given(q, 'terrainResolution') ? q.get('terrainResolution') : 'fast';
  if (rawResolution !== 'fast' && rawResolution !== 'precise') throw bad('terrainResolution debe ser fast o precise');
  const resolution: Resolution = rawResolution;
  const terrain = parseTerrain(q, ctx, resolution);
  if (!terrain && given(q, 'terrainResolution')) ctx?.warn('ignored_parameter', 'terrainResolution solo se usa con terrain=1; sin relieve se ignora.', 'terrainResolution');
  const night = parseNight(q, ctx);
  const { panel } = parsePanel(q);
  const slope = slopeRequest(q, ctx);
  const weights = parseWeights(q);
  const earthMode = parseEarthMode(q);
  const earthMin = parseEarthMin(q);
  const spacingKm = optNumber(q, 'spacingKm', LIMITS.searchDefaultSpacingKm, LIMITS.searchMinSpacingKm, LIMITS.searchMaxSpacingKm);
  const n = gridCells(region, spacingKm).length;
  const max = !terrain ? LIMITS.searchMaxCells : resolution === 'fast' ? LIMITS.searchMaxCellsTerrainFast : LIMITS.searchMaxCellsTerrainPrecise;
  if (n > max) {
    throw bad(`La malla tiene ${n} puntos y el máximo ${terrain ? `con relieve en modo ${resolution === 'fast' ? 'rápido' : 'preciso'} ` : ''}es ${max}`
      + `${terrain ? ' (cada punto calcula su máscara de horizonte)' : ''}. Aumenta spacingKm o reduce la región.`);
  }
  return {
    preset,
    // Since 1.16.0, cells=1 adds every evaluated point (the map of the search), not only the best ones.
    cells: given(q, 'cells') && parseFlag(q, 'cells'),
    input: {
      region, startMs, days, mode, earthMode, stepMs: parseSampleStep(q), earthMinElevationDeg: earthMin, weights,
      terrain: terrain ? { ...terrain, resolution } : null,
      night,
      panel,
      slope,
      spacingKm,
      refine: optInteger(q, 'refineLevels', LIMITS.searchDefaultRefineLevels, 0, LIMITS.searchMaxRefineLevels),
      refineTop: optInteger(q, 'refineTop', LIMITS.searchDefaultRefineTop, 1, LIMITS.searchMaxRefineTop),
      top: optInteger(q, 'top', LIMITS.searchDefaultTop, 1, LIMITS.searchMaxTop),
      minSepKm: optNumber(q, 'minSeparationKm', 4 * spacingKm, 0, 2000),
    },
  };
}

export { HttpError };
