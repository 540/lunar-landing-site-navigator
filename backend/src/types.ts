// Shared types of the engine, the HTTP API and the evals harness. Type-only module: Node erases it when running
// (type stripping), so it adds no code and no runtime cost. codeHash (evals/fingerprint.ts) ignores it for that reason.

// ---------- geometry and ephemeris ----------
export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];
export type Body = 'sun' | 'earth';
/** Visibility criterion of a disc: some part ('limb'), its centre ('center') or all of it ('full') above the horizon. */
export type Mode = 'limb' | 'center' | 'full';

/**
 * Solar panel orientation for the `energy` metric (panel.ts). Factor applied to the visible fraction of the solar disc:
 * tracking 1 (default, normal incidence), vertical-rotating cos(el), horizontal max(0, sin(el)).
 */
export type Panel = 'tracking' | 'vertical-rotating' | 'horizontal';
export type PerBody<T> = Record<Body, T>;

export interface SiteFrame { pos: Vec3; up: Vec3; east: Vec3; north: Vec3 }
/** Azimuth from north towards east and elevation, in degrees; distance in km; apparent radius of the disc in degrees. */
export interface Topocentric { az: number; el: number; distKm: number; radiusDeg: number }
/** What the visibility functions read from a position (the tests pass partial positions). */
export type DiscPosition = Pick<Topocentric, 'az' | 'el' | 'radiusDeg'>;

/** Point on the surface: selenographic degrees, east-positive longitude. */
export interface LatLon { lat: number; lon: number }

/** Catalogue site (sites.ts) or custom coordinates (params.ts). */
export interface Site extends LatLon {
  id: string;
  name: string;
  region?: string;
  program?: string;
  heightKm?: number;
  verified?: boolean;
  /** Internal: not exposed by public API v1. */
  source?: string;
  custom?: boolean;
}

/** Moon→Sun and Moon→Earth vectors sampled at the instants `t` (ms), shared by every point. */
export interface SampledVectors { t: number[]; vecs: PerBody<Vec3>[] }
/** Visibility margin (degrees) of each body at each instant of `t`. */
export interface MarginSample { frame: SiteFrame; t: number[]; m: PerBody<number[]> }
export interface VisibilityEvent { type: 'rise' | 'set'; time: number }
/** [start, end] in ms. */
export type Interval = [number, number];

// ---------- horizon and terrain ----------
export type Resolution = 'fast' | 'precise';

/** Horizon elevation by azimuth, uniform step from north, clockwise. */
export interface HorizonMask {
  stepDeg: number;
  /** number[] (catalogue JSON, registered masks) or Float64Array (on-demand masks): never converted, so values stay bit-identical. */
  el: ArrayLike<number>;
  source: string;
  observerHeightM?: number;
  heightM?: number;
  demVersion?: string | null;
  /**
   * Hybrid horizon (horizon.ts, refinedMask): only on masks with a DEM behind them. Where the mask value is within `deg`
   * of the edge that decides (visibility margin, visible fraction), `elevation(az)` traces the direct ray at the exact
   * azimuth and that elevation is used instead of the interpolated one.
   */
  refine?: HorizonRefine;
}

/** Direct ray of a DEM mask (horizon.ts): threshold X (°) and the ray elevation (°) at an exact azimuth, cached. */
export interface HorizonRefine { deg: number; elevation: (azDeg: number) => number }

/** Mask computed from the DEM (buildMask, maskFor) or precomputed in the catalogue. */
export interface DemMask<E extends ArrayLike<number> = ArrayLike<number>> extends HorizonMask {
  lat: number;
  lon: number;
  heightM: number;
  observerHeightM: number;
  el: E;
  demVersion: string | null;
  resolution: Resolution;
  coverage: number;
}

/** Mask chosen for a site (chooseMask): where it comes from, or no mask (spherical horizon) and source null. */
export type ChosenMask = { mask: HorizonMask; source: 'registered' | 'catalog' | 'dem' } | { mask: null; source: null };
/** Masks chosen for the panel (Sun) and the antenna (Earth) of a site (chooseMasks): the same object when the heights match. */
export interface ChosenMasks { sun: ChosenMask; earth: ChosenMask }

/** On-disk store of on-demand masks (horizon.ts): one append-only file per DEM version, resolution and height. */
export interface TerrainCounters {
  computed: number; fromDisk: number; fromMemory: number; noCoverage: number; computeMs: number;
  /** Hybrid horizon: direct rays traced, rays served from the cache and time spent tracing (ms). */
  rays: number; rayHits: number; rayMs: number;
}
/** Terrain status (terrainStatus): cached DEM, catalogue masks and counters. */
export interface TerrainStatus extends TerrainCounters { demVersion: string | null; catalogMasks: string[]; msPerMask: number | null }

/** `terrain` option as it arrives (scenario JSON, query string). */

export interface TerrainOption {
  enabled?: boolean; observerHeightM?: number; panelHeightM?: number; antennaHeightM?: number; resolution?: string | null;
  /** Hybrid horizon (direct ray near the horizon): false turns it off. Default: on in precise, off in fast. */
  refine?: boolean;
  /** Threshold X (°) of the hybrid horizon: 0 turns it off. Default 0.1 in precise (REFINE_DEFAULT_DEG). */
  refineDeg?: number;
}

/**
 * `terrain` option once validated by resolveTerrain. `panelHeightM` (mask for the Sun) and `antennaHeightM` (mask for the
 * Earth) are present, both of them, only when at least one differs from `observerHeightM`; otherwise both heights are
 * `observerHeightM` and the object is the same as before they existed.
 */
export interface Terrain {
  enabled: true; observerHeightM: number; panelHeightM?: number; antennaHeightM?: number; resolution: Resolution; demVersion: string | null;
  /** Threshold X (°) of the hybrid horizon, only when it differs from the default of `resolution` (0 = off). */
  refineDeg?: number;
}

/** Horizon mask used for each body: the panel's for the Sun, the antenna's for the Earth (the same object when the heights match). */
export interface BodyMasks { sun: HorizonMask | null; earth: HorizonMask | null }

/** DEM grid. `a` (heights, Float32) may be a lazy non-enumerable getter (dem.ts). */
export interface Grid {
  name: string;
  product: string;
  res: number;
  X0: number;
  Y0: number;
  c0: number;
  r0: number;
  w: number;
  h: number;
  a: Float32Array;
  bin?: string;
}
/** Georeference of a grid, without its heights (what covers() needs; also the metadata .json of the cache). */
export type GridGeometry = Pick<Grid, 'res' | 'X0' | 'Y0' | 'c0' | 'r0' | 'w' | 'h'>;
/** Metadata <name>.json of a cached grid (scripts/fetch-dem.ts writes it). */
export interface GridMeta extends GridGeometry { product?: string; url?: string; level?: number; fetchedAt?: string; importedFrom?: string }
export interface DemStore { grids: Grid[]; version: string | null; dir: string | null }
export interface Layer { g: Grid; maxD: number }
export interface LayerSelection { layers: Layer[]; cfg: ResolutionConfig; products: string[] }

export interface ResolutionConfig { nearM: number; farM: number; stepFrac: number; grow: number; nAz: number; fine: boolean }

/** Public description of the horizon of a site (`site.horizon` in /api/*). */
export type HorizonInfo =
  | { type: 'sphere'; source: string }
  | { type: 'mask'; source: string; stepDeg: number; observerHeightM?: number; heightM?: number; demVersion?: string };

// ---------- service (snapshot, series, windows, compare) ----------
export interface SiteInfo {
  id: string;
  name: string;
  region: string | undefined;
  program: string | undefined;
  lat: number;
  lon: number;
  heightKm: number;
  verified: boolean;
  custom?: true;
  horizon: HorizonInfo;
}

export interface BodyNow {
  azimuthDeg: number;
  elevationDeg: number;
  angularRadiusDeg: number;
  distanceKm: number;
  horizonElevationDeg: number;
  visible: boolean;
  visibleFraction: number;
  nextRise: string | null;
  nextSet: string | null;
  hoursToNextSet?: number | null;
  hoursToNextRise?: number | null;
}

export interface NextEvents { rise: number | null; set: number | null }
export interface Snapshot {
 site: SiteInfo; date: string; mode: Mode; lookaheadDays: number; bodies: PerBody<BodyNow> }

/** `angularRadiusDeg`: apparent radius of the disc, in degrees (since API 1.22.0, #192). */
export interface BodySeries { az: number[]; el: number[]; visibleFraction: number[]; angularRadiusDeg: number[] }
export interface Series extends PerBody<BodySeries> { site: SiteInfo; start: string; end: string; stepMinutes: number; t: string[] }

export interface WindowSummary { count: number; totalHours: number; fractionOfTime: number; longestWindowHours: number }
export interface WindowJson { start: string; end: string; hours: number }
export interface BodyWindows extends WindowSummary { events: { type: VisibilityEvent['type']; time: string }[]; windows: WindowJson[] }
export interface WindowsBreakdown extends PerBody<BodyWindows> {
  sunAndEarth: WindowSummary & { windows: WindowJson[] };
  /** Earth visible from the site and the Moon above the minimum elevation of some DSN station (dsn.ts); only when asked for. */
  earthDsn?: WindowSummary & { windows: WindowJson[] };
}
export interface Windows extends WindowsBreakdown { site: SiteInfo; start: string; end: string; mode: Mode; stepMinutes: number; night?: NightSummary }

export interface Comparison {
  date: string;
  end: string;
  days: number;
  mode: Mode;
  sites: { site: SiteInfo; now: PerBody<BodyNow>; summary: PerBody<WindowSummary> & { sunAndEarth: WindowSummary } }[];
}

// ---------- night and battery (night.ts) ----------
/** Battery sizing inputs (defaults in BATTERY_DEFAULTS, night.ts). */
export interface BatteryOptions {
  /** Survival load during the night (heaters, electronics), in W. */
  survivalLoadW: number;
  /** Specific energy at pack level, in Wh/kg. */
  whPerKg: number;
  /** Usable depth of discharge, 0..1. */
  depthOfDischarge: number;
}
/** Battery option as it arrives (scenario JSON): true = defaults, or some fields to override. */
export type BatteryInput = boolean | Partial<BatteryOptions> | null;
export interface BatteryResult { kWh: number; kg: number }

/** Optional night criteria and metrics. Without them (defaults) every result is identical to before. */
export interface NightOptions {
  /** > 0: a sample counts as night when the visible fraction of the solar disc is below this value (0..1). 0 = `mode` decides. */
  nightMinSunFraction?: number;
  /** true: also measure the whole longest night that touches the period (longestNightFullH). */
  fullNight?: boolean;
  /** Battery sizing from the night (the full one if `fullNight`, otherwise longestNightH). */
  battery?: BatteryOptions | null;
}

/** /v1/windows with night options: the longest night in [start, end] and, optionally, the whole one. */
export interface NightSummary {
  minSunFraction: number;
  stepMinutes: number;
  longestNightHours: number;
  longestNightFullHours?: number;
  extensionLimitDays?: number;
  /** Only when the whole night reached the extension limit on some side: longestNightFullHours is a lower bound. */
  fullNightTruncated?: true;
  battery?: BatteryOptions & BatteryResult & { nightHours: number };
}

// ---------- terrain slope (terrain/slope.ts) ----------
export interface SlopeOptions {
  /** Baseline (diameter of the footprint, ground metres). Default 100 m (Artemis III: slope < 10° over 100 m). */
  baselineM?: number;
  /** Use the official PGDA slope (LDRM, terrain/ldrm.ts) when cached for that baseline. Default true; false = only the DEM fit. */
  ldrm?: boolean;
}
/**
 * Where a slope comes from: `pgda-ldrm-<base>m` (official PGDA LDRM product for that baseline) or `dem-<res>m` (plane
 * fitted to the cached LOLA DEM of that resolution).
 */
export type SlopeSource = `pgda-ldrm-${number}m` | `dem-${number}m`;
/** Slope of the terrain around a point: PGDA LDRM product or plane fitted to the DEM. */
export interface SlopeResult {
  slopeDeg: number;
  /** Baseline actually used (m): the requested one, or ~3 ground pixels of the DEM if that is longer. */
  slopeBaselineM: number;
  requestedBaselineM: number;
  /** Nominal resolution of the grid used: the DEM (20, 160 or 240 m/px) or the LDRM product (50 m/px). */
  demResolutionM: number;
  /** Pixel size on the ground at that latitude (the stereographic scale removed). */
  pixelGroundM: number;
  /** The requested baseline was shorter than 3 pixels: the slope over the requested baseline is probably steeper. */
  underestimated: boolean;
  /** Standard deviation of the residuals of the plane (m); null with LDRM when the DEM does not resolve the baseline. */
  roughnessM: number | null;
  samples: number;
  product: string;
  source: SlopeSource;
  demVersion: string | null;
}

/** Slope of a point in API responses (rounded; null fields when no cached DEM contains the point). */
export interface SlopeSummary {
  slopeDeg: number | null;
  slopeBaselineM: number | null;
  requestedBaselineM: number;
  demResolutionM: number | null;
  underestimated: boolean;
  roughnessM: number | null;
  /** Where the slope comes from (null without slope). */
  source: SlopeSource | null;
  /**
   * Only with maxSlopeDeg. true/false only when the slope is certified (measured on the requested baseline); null when it
   * is underestimated (uncertified: the real baseline is longer). Internally false without DEM (v1 says null).
   */
  meetsMaxSlope?: boolean | null;
  /** Only with maxSlopeDeg and a slope that cannot be checked: why (uncertified or unknown). */
  meetsMaxSlopeReason?: string;
}
/** What to do with uncertified slopes (underestimated) under maxSlopeDeg: leave them out (default) or keep them, marked. */
export type SlopeUncertifiedPolicy = 'exclude' | 'keep';
/** Slope requested in a search, a ranking or a site endpoint: baseline and, optionally, the filter. */
export interface SlopeRequest { baselineM: number; maxSlopeDeg?: number; uncertified?: SlopeUncertifiedPolicy }
/** Echo of the slope request in search and ranking responses. */
export interface SlopeEcho extends SlopeRequest {
  excluded?: number;
  /** With maxSlopeDeg: results whose slope is uncertified (underestimated), excluded or kept according to `uncertified`. */
  uncertifiedCount?: number;
  /** rankSites only: ids of the sites left out by maxSlopeDeg. */
  excludedSites?: string[];
  note: string;
}

// ---------- search and score ----------
/** Metrics of a point over a period (the inputs of the score). A type alias (not an interface) so Object.fromEntries can be asserted to it. */
export type Metrics = {
  /**
   * Mean over the samples of visibleFraction(sun) × panel factor (panel.ts). With the default panel (`tracking`, factor 1)
   * it is the mean visible fraction of the solar disc: a panel that follows the Sun (normal incidence). Pure geometry: no
   * limb darkening, Sun-distance variation (±3.4 %), self-shadowing, dust, cell efficiency or temperature.
   */
  energy: number;
  sunFraction: number;
  earthFraction: number;
  bothFraction: number;
  longestNightH: number;
  longestNoEarthH: number;
  longestBothH: number;
  /** Only with the `fullNight` option: the longest night that touches the period, extended past its ends (night.ts). */
  longestNightFullH?: number;
  /** Only with the `battery` option: energy and pack mass needed to get through the night (night.ts). */
  batteryKWh?: number;
  batteryKg?: number;
  /** Only when the slope is asked for (evals `slope` or the maxSlopeDeg constraint): terrain slope, terrain/slope.ts. */
  slopeDeg?: number;
};
export type MetricKey
 = keyof Metrics;
/** The seven metrics that are always present (the optional night/battery ones only appear when asked for). */
export type CoreMetricKey = Exclude<MetricKey, 'longestNightFullH' | 'batteryKWh' | 'batteryKg' | 'slopeDeg'>;
export type WeightKey = 'energy' | 'comm' | 'both' | 'night' | 'sun' | 'commGap' | 'bothStreak';
/** Normalized weights (they sum to 1). */
export type Weights = Record<WeightKey, number>;
/** Weights as given (any key: unknown ones are rejected by normalizeWeights; undefined/null = default). */
export type WeightsInput = Record<string, number | null | undefined>;

export interface ScoreVariable { metric: MetricKey; label: string; value: (m: Metrics, periodH: number) => number }

export interface Region { latMin: number; latMax: number; lonMin: number; lonMax: number }

/** Point to evaluate: a bare lat/lon, a catalogue site (with id) or a scenario point. */
export interface Cell extends LatLon { id?: string; name?: string; heightKm?: number }

export interface EvaluateOptions extends NightOptions {
  mode: Mode;
  stepMs: number;
  weights: Weights;
  earthMode?: Mode;
  earthMinElevationDeg?: number;
  terrain?: Terrain | null;
  /** Panel orientation for `energy` only (panel.ts). Absent = tracking (identical to before). */
  panel?: Panel;
}

/**
 * Raw tallies of one period, in samples (search.ts → cellResult). `leadingNight`/`trailingNight` are the night runs that
 * touch the first/last sample (for the full night).
 */
export interface CellTally {
  n: number;
  energy: number;
  sunN: number;
  earthN: number;
  bothN: number;
  maxNight: number;
  maxNoEarth: number;
  maxBoth: number;
  minSunEl: number;
  maxSunEl: number;
  leadingNight: number;
  trailingNight: number;
}

export interface CellResult {
  lat: number;
  lon: number;
  id?: string;
  name?: string;
  horizon?: 'mask' | 'sphere';
  heightM?: number;
  /** With terrain, only when the mask is the precomputed catalogue one (no DEM there): since API 1.13.0. */
  horizonSource?: 'catalog';
  score: number;
  periodH: number;
  metrics: Metrics & { sunElevationRangeDeg: number[] };
  /**
   * Only with `fullNight` when the search for the whole night reached NIGHT_EXTENSION_LIMIT_DAYS on some side (near
   * permanent shadow): `longestNightFullH` and the battery are then a lower bound, not the real night.
   */
  nightTruncated?: true;
  /** Only when the slope is asked for (searchGrid / rankSites with `slope`). */
  slope?: SlopeSummary;
}

/** Options of searchGrid / rankSites (`/v1/search`, `/v1/rank`). */
export interface SearchOptions extends NightOptions {
  startMs: number;
  endMs: number;
  stepMs: number;
  mode: Mode;
  weights?: WeightsInput;
  earthMode?: Mode;
  earthMinElevationDeg?: number;
  terrain?: TerrainOption;
  /** Panel orientation for `energy` (panel.ts). Absent or 'tracking' = identical to before. */
  panel?: Panel;
  /** Terrain slope of each result and, with maxSlopeDeg, the filter (terrain/slope.ts). Absent = identical to before. */
  slope?: Partial<SlopeRequest> | null;
  spacingKm?: number;
  refine?: number;
  refineTop?: number;
  top?: number;
  minSepKm?: number;
}
export type GridSearchOptions = SearchOptions & { spacingKm: number; refine: number; refineTop: number; top: number };

/** Night settings echoed in search responses when any night option is on. */
export interface NightEcho { minSunFraction: number; fullNight: boolean; extensionLimitDays?: number }

export interface GridSearch {
  kind: 'grid';
  region: Region;
  start: string;
  end: string;
  stepMinutes: number;
  mode: Mode;
  weights: Weights;
  levels: { level: number; spacingKm: number; evaluated: number }[];
  evaluated: number;
  minSeparationKm: number;
  top: (CellResult & { level: number; rank: number })[];
  cells: (CellResult & { level: number })[];
  terrain?: Terrain;
  night?: NightEcho;
  battery?: BatteryOptions;
  /** Only when the panel is not 'tracking'. */
  panel?: Panel;
  /** Only when the slope is asked for. */
  slope?: SlopeEcho;
  note: string;
  timingMs: number;
}

export interface SiteRanking {
  kind: 'sites';
  start: string;
  end: string;
  stepMinutes: number;
  mode: Mode;
  weights: Weights;
  evaluated: number;
  top: (CellResult & { rank: number })[];
  terrain?: Terrain;
  night?: NightEcho;
  battery?: BatteryOptions;
  /** Only when the panel is not 'tracking'. */
  panel?: Panel;
  /** Only when the slope is asked for. */
  slope?: SlopeEcho;
  note: string;
  timingMs: number;
}

// ---------- landing-date sweep (landingSweep.ts, /v1/landing-dates) ----------
/** Options of sweepLandingDates. Same names as the search options; night, battery, terrain and panel as in evaluateCell. */
export interface LandingSweepOptions extends NightOptions {
  /** First candidate landing date (ms). */
  startMs: number;
  /** Last candidate landing date (ms, inclusive when it falls on the date step). */
  endMs: number;
  /** Step between candidate dates (ms, ≥ 1 h, multiple of stepMs). */
  dateStepMs: number;
  /** Mission length in days, starting at landing (its length must be a multiple of stepMs). */
  missionDays: number;
  /** Sample step inside each mission (ms). */
  stepMs: number;
  mode: Mode;
  earthMode?: Mode;
  earthMinElevationDeg?: number;
  weights?: WeightsInput;
  terrain?: TerrainOption | null;
  panel?: Panel;
  /** Slope of the site (constant over the dates). The maxSlopeDeg constraint turns it on with the default baseline. */
  slope?: Partial<SlopeRequest> | null;
  /** Hard constraints (same names as the evals scenarios). */
  constraints?: Constraints;
  /** A date is "good" when it reaches this score (and meets the constraints, if any). */
  minScore?: number | null;
  /** How many best (and worst) dates to list. */
  top?: number;
}

/** One candidate landing date: the mission that starts then. */
export interface LandingDate {
  date: string;
  score: number;
  /** Only with constraints. */
  feasible?: boolean;
  violations?: string[];
  metrics: CellResult['metrics'];
  /** Only with `fullNight` when the whole night reached the search limit (see CellResult.nightTruncated). */
  nightTruncated?: true;
  /** Sun at landing: visible or not, and hours (sample resolution) until that changes within the mission (null = it does not). */
  sun: { visibleAtLanding: boolean; hoursToChange: number | null };
}

/** Contiguous run of good dates. `durationDays` = last − first date. */
export interface LandingWindow { start: string; end: string; durationDays: number; dates: number; best: { date: string; score: number } }

export interface RangeStats { min: number; mean: number; max: number }

export interface LandingSweep {
  kind: 'landing-dates';
  site: { lat: number; lon: number; id?: string; name?: string; horizon?: 'mask' | 'sphere'; heightM?: number; horizonSource?: 'catalog' };
  start: string;
  /** Last candidate date actually evaluated. */
  end: string;
  dateStepHours: number;
  missionDays: number;
  stepMinutes: number;
  mode: Mode;
  earthMode: Mode;
  weights: Weights;
  constraints?: Constraints;
  /** What "good" means: constraints met and score ≥ minScore (minScore = relativeToBest × best score when neither is given). */
  goodCriterion: { constraints: boolean; minScore: number | null; relativeToBest: number | null };
  stats: { dates: number; score: RangeStats; energy: RangeStats; feasibleFraction?: number; goodFraction: number };
  best: (LandingDate & { rank: number })[];
  worst: (LandingDate & { rank: number })[];
  goodWindows: LandingWindow[];
  dates: LandingDate[];
  terrain?: Terrain;
  night?: NightEcho;
  battery?: BatteryOptions;
  panel?: Panel;
  /** Only with `slope` or the maxSlopeDeg constraint. */
  slope?: SlopeSummary & { note: string };
  note: string;
  timingMs: { total: number; sampling: number };
  /** Samples computed once for the whole sweep. */
  samples: number;
}

// ---------- evals: scenarios ----------
export type Aggregate = 'worst' | 'mean';
export type ConstraintName =
  | 'minEnergy' | 'minSunFraction' | 'minEarthFraction' | 'minBothFraction'
  | 'maxLongestNightH' | 'maxLongestNoEarthH' | 'minLongestBothH' | 'maxBatteryKg' | 'maxSlopeDeg';
export type Constraints = Partial<Record<ConstraintName, number>>;
export interface SearchSettings { spacingKm: number; maxIterations: number; keepTop: number; minSpacingKm: number; stopDelta: number; patience: number }
export interface Robustness { radiusKm: number; directions: number; rings: number }
export interface RawPoint { lat: number; lon: number; name?: string }
export interface ScenarioPoint { lat: number; lon: number; name: string; siteId?: string }

/** Scenario as written in evals/scenarios/*.json (everything optional: resolveScenario fills and validates it). */
export interface RawScenario {
  name?: string;
  description?: string;
  region?: Region;
  points?: (string | RawPoint)[];
  dates?: string[];
  missionDays?: number;
  stepMinutes?: number;
  mode?: Mode;
  earthMode?: Mode | null;
  earthMinElevationDeg?: number;
  aggregate?: Aggregate;
  weights?: WeightsInput;
  constraints?: Constraints;
  search?: Partial<SearchSettings>;
  baselines?: string[];
  robustness?: (Partial<Robustness> & { radiusKm: number }) | null;
  terrain?: TerrainOption | null;
  nightMinSunFraction?: number;
  fullNight?: boolean;
  battery?: BatteryInput;
  panel?: Panel;
  /** Terrain slope as a metric (slopeDeg) of each candidate: `{baselineM}` (default 100 m). Also turned on by maxSlopeDeg. */
  slope?: SlopeOptions | null;
}

/** Defaults of a scenario (SCENARIO_DEFAULTS in evals/lib.ts). */
export interface ScenarioDefaults {
  missionDays: number;
  stepMinutes: number;
  mode: Mode;
  earthMode: Mode | null;
  earthMinElevationDeg: number;
  aggregate: Aggregate;
  weights: WeightsInput;
  constraints: Constraints;
  search: SearchSettings;
  baselines: string[];
  robustness: Robustness | null;
}

/** resolveScenario's work in progress: the raw scenario over the defaults, resolved field by field into a Scenario. */
export interface ScenarioDraft extends Omit<ScenarioDefaults, 'weights' | 'robustness'> {
  name?: string;
  description?: string;
  region?: Region;
  points?: (string | RawPoint | ScenarioPoint)[];
  dates?: string[];
  dateMs?: number[];
  weights: WeightsInput | Weights;
  robustness: RawScenario['robustness'] | Robustness;
  terrain?: Terrain | TerrainOption | null;
  nightMinSunFraction?: number;
  fullNight?: boolean;
  battery?: BatteryInput | BatteryOptions;
  panel?: Panel;
  slope?: SlopeOptions | ScenarioSlope | null;
}

/** Scenario after resolveScenario: defaults applied, weights normalized, dates parsed. */

export interface Scenario {
  name: string;
  description?: string;
  region?: Region;
  points?: ScenarioPoint[];
  dates: string[];
  dateMs: number[];
  missionDays: number;
  stepMinutes: number;
  mode: Mode;
  earthMode: Mode;
  earthMinElevationDeg: number;
  aggregate: Aggregate;
  weights: Weights;
  constraints: Constraints;
  search: SearchSettings;
  baselines: string[];
  robustness: Robustness | null;
  terrain?: Terrain;
  /** Only present when > 0 (so scenarioHash of existing scenarios does not change). */
  nightMinSunFraction?: number;
  /** Only present when true. */
  fullNight?: true;
  /** Only present when enabled. */
  battery?: BatteryOptions;
  /** Only present when not 'tracking' (so scenarioHash of the existing scenarios does not change). */
  panel?: Panel;
  /** Only present when the slope is used (`slope` or maxSlopeDeg), with the DEM version it is computed from. */
  slope?: ScenarioSlope;
}

/** Slope of a resolved scenario: baseline and the cached DEM (part of scenarioHash only when used). */
export interface ScenarioSlope { baselineM: number; demVersion: string | null }

// ---------- evals: evaluations and runs ----------
export interface DateEvaluation extends Metrics { date: string; periodH: number; score: number; feasible: boolean; violations: string[] }

export interface RobustnessInfo {
  radiusKm: number;
  points: number;
  worstScore: number;
  worstAt: LatLon;
  spread: number;
  failingNeighbors: number;
}

/** Evaluation of a candidate (evaluateCandidate), optionally with spatial robustness (evaluateRobust). */
export interface Evaluation {
  lat: number;
  lon: number;
  id?: string;
  horizon?: 'mask' | 'sphere';
  heightM?: number;
  score: number;
  breakdown: Partial<Weights>;
  feasible: boolean;
  violations: string[];
  worstDate: string | null;
  metrics: Metrics;
  perDate: DateEvaluation[];
  nominalScore?: number;
  robustness?: RobustnessInfo;
  /** Only when the scenario uses the slope (null = no DEM contains the point). */
  slope?: SlopeSummary | null;
}

/** Candidate evaluated in an optimizer iteration (or in points mode). */
export interface Candidate extends Evaluation { iteration: number; name?: string; siteId?: string }
export type TopCandidate = Omit<Candidate, 'perDate'>;

/**
 * Anything ordered by feasibility. The ordering code subtracts booleans (`b.feasible - a.feasible`, true − false = 1)
 * and TypeScript forbids arithmetic on booleans. Rewriting it (Number(…)) would change codeHash, so the comparison
 * parameters see `feasible` as `any`. At runtime it is always a boolean.
 */
export type Ranked<T extends { feasible: boolean }> = Omit<T, 'feasible'> & { feasible: any };

export type StopReason = 'maxIterations' | 'minSpacing' | 'converged' | 'points';

/** One optimizer iteration. `candidates` is NON-enumerable (defineProperty): it is not written to the JSONL nor hashed. */
export interface IterationRecord {
  iteration: number;
  spacingKm: number | null;
  evaluated: number;
  totalEvaluated: number;
  feasibleCount: number;
  best: Candidate;
  top: TopCandidate[];
  improvement: number | null;
  bestMovedKm: number | null;
  elapsedMs: number;
  stop: StopReason | null;
  readonly candidates?: Candidate[];
}

export type Baseline = ({ name: string } & Evaluation) | { id: string; error: string };

export interface FingerprintParts {
  scenarioHash: string;
  codeHash: string;
  codeHashVersion: number;
  lockHash: string;
  nodeVersion: string;
  engineVersion: string;
}
export interface Fingerprint extends FingerprintParts { fingerprint: string }

/** Scenario as stored in summary.json (and in the database). */
export type ScenarioSummary = Pick<Scenario, 'name' | 'description' | 'region' | 'dates' | 'missionDays' | 'stepMinutes' | 'mode' | 'earthMode'
  | 'earthMinElevationDeg' | 'aggregate' | 'weights' | 'constraints' | 'search' | 'robustness' | 'terrain' | 'points'
  | 'nightMinSunFraction' | 'fullNight' | 'battery' | 'panel'>;

export interface RunSummary {
  runId: string;
  label: string | null;
  codeVersion: string;
  fingerprint: Fingerprint & { resultHash: string };
  scenario: ScenarioSummary;
  best: Candidate;
  stop: StopReason | null;
  iterations: number;
  totalEvaluated: number;
  top: TopCandidate[];
  baselines: Baseline[];
  warnings: string[];
  note: string;
  elapsedMs: number;
}

// ---------- evals database rows (node:sqlite returns Record<string, SQLOutputValue>; see rows() in evals/db.ts) ----------
/** Row of `runs` (a type alias, not an interface, so it can be read as Record<string, unknown>). */
export type RunRow = {
  id: number;
  run_id: string;
  created_at: string;
  scenario: string;
  label: string | null;
  code_version: string | null;
  description: string | null;
  mode: string | null;
  aggregate: string | null;
  mission_days: number | null;
  step_minutes: number | null;
  dates_json: string | null;
  region_json: string | null;
  weights_json: string | null;
  constraints_json: string | null;
  search_json: string | null;
  iterations: number | null;
  total_evaluated: number | null;
  stop_reason: string | null;
  elapsed_ms: number | null;
  best_lat: number | null;
  best_lon: number | null;
  best_score: number | null;
  best_feasible: number | null;
  fingerprint: string | null;
  scenario_hash: string | null;
  code_hash: string | null;
  lock_hash: string | null;
  node_version: string | null;
  engine_version: string | null;
  result_hash: string | null;
  earth_mode: string | null;
  earth_min_elevation_deg: number | null;
  robustness_json: string | null;
  terrain_json: string | null;
};

export interface CountRow { n: number }
export interface ColumnInfoRow { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }
