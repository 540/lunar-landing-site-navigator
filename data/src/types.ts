// Response types of public API v1, written by hand from openapi.yaml (components/schemas). Type-only module.
// openapi.yaml is the contract: the tests validate every real response against it (test/api.test.ts); these types
// only let tsc check that v1.ts builds the fields the spec documents.
import type { Mode, Resolution } from '../../backend/src/types.ts';

/** #/components/schemas/WarningCode (since 1.9.0). */
export type V1WarningCode =
  | 'unknown_parameter' | 'unused_parameter' | 'ignored_parameter' | 'duplicate_parameter' | 'duplicate_site'
  | 'smooth_moon_polar' | 'night_truncated' | 'outside_validated_dates' | 'height_no_horizon_dip' | 'low_observer_height' | 'terrain_not_applied'
  | 'deep_polar_uncertainty';
/** #/components/schemas/Warning (since 1.9.0): something the request asked for that was ignored, or a caveat of the figures. */
export interface V1Warning { code: V1WarningCode; parameter?: string; message: string }

/** #/components/schemas/Site */
export interface V1Site {
  id: string;
  name: string;
  region: string | null;
  program: string | null;
  latDeg: number;
  lonDeg: number;
  heightKm: number;
  coordinatesVerified: boolean;
  custom: boolean;
  horizonModel: 'sphere' | 'mask';
  /** Since 1.9.0, only in /v1/sites and only for sites with precomputed masks: observer heights (m) that have one. */
  terrainMaskHeightsM?: number[];
}

/** #/components/schemas/Body */
export interface V1Body {
  azimuthDeg: number;
  elevationDeg: number;
  angularRadiusDeg: number;
  distanceKm: number;
  horizonElevationDeg: number;
  visible: boolean;
  visibleFraction: number;
  nextRise: string | null;
  nextSet: string | null;
  hoursToNextRise: number | null;
  hoursToNextSet: number | null;
}

/** #/components/schemas/Terrain (only with terrain=1) */
export interface V1Terrain {
  observerHeightM: number;
  /** Since 1.6.0, only when it or antennaHeightM differs from observerHeightM: panel height (mask for the Sun). */
  panelHeightM?: number;
  /** Since 1.6.0, only when it or panelHeightM differs from observerHeightM: antenna height (mask for the Earth). */
  antennaHeightM?: number;
  applied: boolean;
  source: 'catalog' | 'dem' | null;
  demVersion: string | null;
  /**
   * Since 1.8.0, only when the hybrid horizon was applied (never in /v1/horizon): its threshold (°). Where the margin of the Sun or the Earth to the
   * horizon is below it, the horizon elevation is a direct ray over the DEM at the exact azimuth.
   */
  horizonRefineDeg?: number;
  note: string;
}

/** #/components/schemas/Health */
export interface V1Health {
  status: 'ok';
  apiVersion: string;
  uptimeSeconds: number;
  /** Since 1.13.0: the terrain data this server has (what terrain=1 and slope can use). */
  terrain?: V1HealthTerrain;
  warnings?: V1Warning[];
}

/** #/components/schemas/HealthTerrain (since 1.13.0). */
export interface V1HealthTerrain {
  /** LOLA DEM in the cache: masks of any point with terrain=1. */
  dem: boolean;
  demVersion: string | null;
  /** PGDA slope products (LDRM): certified slope for these baselines (m). */
  slopeProducts: boolean;
  slopeProductBaselinesM: number[];
  /** Catalogue sites with a precomputed horizon mask (used with terrain=1 even without the DEM). */
  catalogMaskSiteIds: string[];
}

/** #/components/schemas/SiteList */
export interface V1SiteList { count: number; sites: V1Site[]; warnings?: V1Warning[] }

/** #/components/schemas/SunEarth */
export interface V1SunEarth {
  site: V1Site;
  date: string;
  mode: Mode;
  lookaheadDays: number;
  sun: V1Body;
  earth: V1Body;
  sunAndEarthVisible: boolean;
  /** Since 1.9.0, only when earthMinElevationDeg > 0. */
  earthMinElevationDeg?: number;
  terrain?: V1Terrain;
  slope?: V1SiteSlope;
  /** Since 1.9.0, only when there is something to warn about (ignored parameters, smooth Moon at the poles…). */
  warnings?: V1Warning[];
}

/** #/components/schemas/Window */
export interface V1Window { start: string; end: string; durationHours: number; startsBeforeRange: boolean; endsAfterRange: boolean }

/** #/components/schemas/WindowSet */
export interface V1WindowSet {
  summary: { count: number; totalHours: number; fractionOfTime: number; longestWindowHours: number };
  windows: V1Window[];
  /** Since 1.16.0, only with events=1 (Sun and Earth): rises and sets inside the range. */
  events?: { type: 'rise' | 'set'; time: string }[];
}

/** #/components/schemas/Windows */
export interface V1Windows {
  site: V1Site;
  start: string;
  end: string;
  mode: Mode;
  sun: V1WindowSet;
  earth: V1WindowSet;
  sunAndEarth: V1WindowSet;
  /** Since 1.24.0, only with dsn=1: Earth visible and the Moon above the minimum elevation of some DSN station. */
  earthDsn?: V1WindowSet;
  /** Since 1.24.0, only with dsn=1. */
  dsn?: V1WindowsDsn;
  /** Since 1.9.0, only when earthMinElevationDeg > 0. */
  earthMinElevationDeg?: number;
  terrain?: V1Terrain;
  night?: V1WindowsNight;
  battery?: V1WindowsBattery;
  slope?: V1SiteSlope;
  /** Since 1.18.0, only with horizonBandDeg > 0. */
  horizonBand?: V1HorizonBand;
  /** Since 1.9.0, only when there is something to warn about (ignored parameters, smooth Moon at the poles…). */
  warnings?: V1Warning[];
}

/** #/components/schemas/DsnStation */
export interface V1DsnStation { id: 'goldstone' | 'madrid' | 'canberra'; name: string; antenna: string; lat: number; lon: number; heightM: number }
/** #/components/schemas/WindowsDsn (only with dsn=1; since 1.24.0) */
export interface V1WindowsDsn { minElevationDeg: number; minElevationAssumed: boolean; stations: V1DsnStation[]; note: string }

/** #/components/schemas/BandRange */
export interface V1BandRange { min: number; max: number }
/** #/components/schemas/BandSummaryRange */
export interface V1BandSummaryRange { totalHours: V1BandRange; fractionOfTime: V1BandRange; longestWindowHours: V1BandRange }
/** #/components/schemas/HorizonBandWindows */
export interface V1HorizonBandWindows { sun: V1WindowSet; earth: V1WindowSet; sunAndEarth: V1WindowSet }
/** #/components/schemas/HorizonBand (only with horizonBandDeg > 0; since 1.18.0) */
export interface V1HorizonBand {
  deg: number;
  range: { sun: V1BandSummaryRange; earth: V1BandSummaryRange; sunAndEarth: V1BandSummaryRange; longestNightHours?: V1BandRange; longestNightFullHours?: V1BandRange };
  raised: V1HorizonBandWindows;
  lowered: V1HorizonBandWindows;
  note: string;
}

/** #/components/schemas/WindowsNight (only with fullNight, nightMinSunFraction > 0 or battery; since 1.3.0) */
export interface V1WindowsNight {
  minSunFraction: number;
  sampleStepMinutes: number;
  longestNightHours: number;
  longestNightFullHours?: number;
  extensionLimitDays?: number;
  /** Since 1.9.0, only when the whole night reached extensionLimitDays on some side: longestNightFullHours is a lower bound. */
  nightTruncated?: true;
}

/** Battery inputs echoed in the responses (since 1.3.0). */
export interface V1BatteryInputs { survivalLoadW: number; whPerKg: number; depthOfDischarge: number }
export type V1NightMetric = 'longestNightFullHours' | 'longestNightHours';

/** #/components/schemas/WindowsBattery */
export interface V1WindowsBattery extends V1BatteryInputs { nightMetric: V1NightMetric; nightHours: number; batteryKWh: number; batteryKg: number; note: string }

/** #/components/schemas/RankNight */
export interface V1RankNight { minSunFraction: number; fullNight: boolean; extensionLimitDays?: number }

/** #/components/schemas/RankBattery */
export interface V1RankBattery extends V1BatteryInputs { nightMetric: V1NightMetric; note: string }

/** #/components/schemas/RankPanel (since 1.4.0): solar panel orientation used for meanSunDiskFraction, only when not `tracking`. */
export interface V1RankPanel { orientation: 'vertical-rotating' | 'horizontal'; factor: string; note: string }

/** Public names of the score weights (Rank.scoreWeights). */
export type V1WeightName =
  | 'meanSunDiskFraction' | 'earthTimeFraction' | 'sunAndEarthTimeFraction' | 'shortNights'
  | 'sunTimeFraction' | 'shortEarthOutages' | 'longestSunAndEarth';

/** Metrics of one period, public names (RankResult.metrics and LandingDate.metrics). */
export interface V1Metrics {
  meanSunDiskFraction: number;
  sunTimeFraction: number;
  earthTimeFraction: number;
  sunAndEarthTimeFraction: number;
  longestNightHours: number;
  longestEarthOutageHours: number;
  longestSunAndEarthHours: number;
  longestNightFullHours?: number;
  /** Since 1.9.0, only when the whole night reached the search limit: longestNightFullHours and the battery are a lower bound. */
  nightTruncated?: true;
  batteryKWh?: number;
  batteryKg?: number;
}

/** #/components/schemas/Slope (since 1.7.0): terrain slope of one point, plane fitted to the cached LOLA DEM. */
export interface V1Slope {
  slopeDeg: number | null;
  slopeBaselineM: number | null;
  requestedBaselineM: number;
  demResolutionM: number | null;
  underestimated: boolean;
  roughnessM: number | null;
  /** Since 1.12.0: where the slope comes from (pgda-ldrm-100m, dem-20m, dem-160m…); null without slope. */
  source: string | null;
  /**
   * Only with maxSlopeDeg; null (since 1.9.0) when the slope is unknown (no DEM there) and (since 1.12.0) when it is
   * uncertified (underestimated: the real baseline is longer than the requested one). Never true then.
   */
  meetsMaxSlope?: boolean | null;
  /** Since 1.12.0, only when meetsMaxSlope is null: why («sin certificar: la base real es de 477 m…»). */
  meetsMaxSlopeReason?: string;
}
/** #/components/schemas/SiteSlope (since 1.7.0): slope of the site of /v1/sun-earth, /v1/windows and /v1/landing-dates. */
export interface V1SiteSlope extends V1Slope { note: string }
/** #/components/schemas/RankSlope (since 1.7.0): slope request of /v1/rank. */
export interface V1RankSlope {
  baselineM: number;
  maxSlopeDeg?: number;
  /** Since 1.12.0, only with maxSlopeDeg: what the filter did with uncertified slopes (slopeUncertified). */
  uncertified?: 'exclude' | 'keep';
  excludedSiteIds?: string[];
  excluded?: V1RankExcluded[];
  note: string;
}
/** #/components/schemas/RankExcluded (since 1.9.0): a site left out of /v1/rank by maxSlopeDeg, and why. */
export interface V1RankExcluded { siteId: string; reason: 'slopeAboveMax' | 'slopeUnknown' | 'slopeUncertified'; slopeDeg: number | null }

/** #/components/schemas/RankResult */
export interface V1RankResult {
  rank: number;
  siteId: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  score: number;
  /** Since 1.9.0, only with constraints. */
  meetsConstraints?: boolean;
  /** Since 1.9.0, only when meetsConstraints is false: the constraints it misses. */
  violatedConstraints?: V1ConstraintName[];
  horizonModel?: 'sphere' | 'mask';
  metrics: V1Metrics;
  slope?: V1Slope;
}

/** #/components/schemas/Rank */
export interface V1Rank {
  start: string;
  end: string;
  days: number;
  mode: Mode;
  sampleStepMinutes: number;
  scoreWeights: Record<V1WeightName, number>;
  /** Since 1.9.0, only with constraints: the ones asked for. */
  constraints?: Partial<Record<V1ConstraintName, number>>;
  /** Since 1.9.0, only when earthMinElevationDeg > 0. */
  earthMinElevationDeg?: number;
  results: V1RankResult[];
  /** Since 1.16.0, only when earthMode differs from mode. */
  earthMode?: Mode;
  terrain?: V1Terrain;
  night?: V1RankNight;
  battery?: V1RankBattery;
  panel?: V1RankPanel;
  slope?: V1RankSlope;
  note: string;
  /** Since 1.9.0, only when there is something to warn about (ignored parameters, smooth Moon at the poles…). */
  warnings?: V1Warning[];
}

/** One evaluated point of /v1/search (`cells`, since 1.16.0). */
export interface V1SearchCell {
  latDeg: number;
  lonDeg: number;
  score: number;
  refineLevel: number;
  horizonModel?: 'sphere' | 'mask';
  metrics: V1Metrics;
  /** Since 1.16.0, only with slope=1, slopeBaselineM or maxSlopeDeg. */
  slope?: V1Slope;
}

/** #/components/schemas/SearchSlope (since 1.16.0): slope request of /v1/search. */
export interface V1SearchSlope { baselineM: number; maxSlopeDeg?: number; uncertified?: 'exclude' | 'keep'; excludedCount?: number; note: string }

/** #/components/schemas/Regions (since 1.16.0): predefined regions of /v1/search. */
export interface V1Regions { count: number; regions: { id: string; latMinDeg: number; latMaxDeg: number; lonMinDeg: number; lonMaxDeg: number }[] }

/** One point of /v1/search (since 1.13.0). */
export interface V1SearchResult {
  rank: number;
  /** Since 1.16.0, only with slope=1, slopeBaselineM or maxSlopeDeg. */
  slope?: V1Slope;
  latDeg: number;
  lonDeg: number;
  score: number;
  /** Refinement level at which the point was evaluated (0 = initial grid). */
  refineLevel: number;
  horizonModel?: 'sphere' | 'mask';
  metrics: V1Metrics;
}

/** #/components/schemas/Search (since 1.13.0): grid search with iterative refinement. */
export interface V1Search {
  region: { preset: string | null; latMinDeg: number; latMaxDeg: number; lonMinDeg: number; lonMaxDeg: number };
  start: string;
  end: string;
  days: number;
  mode: Mode;
  sampleStepMinutes: number;
  spacingKm: number;
  levels: { level: number; spacingKm: number; evaluated: number }[];
  evaluated: number;
  minSeparationKm: number;
  scoreWeights: Record<V1WeightName, number>;
  earthMinElevationDeg?: number;
  results: V1SearchResult[];
  /** Since 1.16.0, only with cells=1: every evaluated point, best first. */
  cells?: V1SearchCell[];
  /** Since 1.16.0, only when earthMode differs from mode. */
  earthMode?: Mode;
  slope?: V1SearchSlope;
  terrain?: V1Terrain;
  terrainResolution?: Resolution;
  night?: V1RankNight;
  battery?: V1RankBattery;
  panel?: V1RankPanel;
  note: string;
  warnings?: V1Warning[];
}

/** Series of one body in /v1/track, aligned with `times` (since 1.2.0). */
export interface V1TrackBody {
  azimuthDeg: number[]; elevationDeg: number[]; horizonElevationDeg: number[]; visibleFraction: number[];
  /** Since 1.22.0 (#192): apparent radius of the disc. */
  angularRadiusDeg: number[];
}

/** /v1/track (since 1.2.0). */
export interface V1Track {
  site: V1Site;
  start: string;
  end: string;
  stepMinutes: number;
  times: string[];
  sun: V1TrackBody;
  earth: V1TrackBody;
  terrain?: V1Terrain;
  /** Since 1.9.0, only when there is something to warn about (ignored parameters, smooth Moon at the poles…). */
  warnings?: V1Warning[];
}

/** /v1/best-landings (since 1.15.0): the best landing of each site in a window, with the mission rules of planner/. */
export type V1PlannerVerdict = 'viable' | 'marginal' | 'not-viable';
export interface V1BestLanding {
  rank: number;
  siteId: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  horizonModel?: 'mask' | 'sphere';
  landing: string;
  verdict: V1PlannerVerdict;
  reason: string;
  reasons: string[];
  trace: { rule: string; ok: boolean | null; value: string }[];
  score: number;
  scoreParts: { energy: number; comms: number; early: number; delays: number };
  metrics: {
    sunAtLanding: boolean; earthAtLanding: boolean; longestShadowHours: number; longestEarthOutageHours: number;
    sunTimeFraction: number; earthTimeFraction: number; sunAndEarthTimeFraction: number;
    sunlightAfterLandingHours: number; earthAfterLandingHours: number;
  } | null;
  robustness: { maxDelayDays: number; nextWindow: string | null };
  viableInWindow: number;
  landings: { landing: string; verdict: V1PlannerVerdict; reason: string; streak: number }[];
}
export interface V1BestLandings {
  start: string;
  end: string;
  mission: { days: number; batteryHours: number; minEarthPct: number; maxEarthGapHours?: number };
  priority: 'energy' | 'comms' | 'early' | 'delays' | string;
  mode: 'limb' | 'center' | 'full';
  stepHours: number;
  tested: number;
  options: V1BestLanding[];
  terrain?: V1Terrain;
}

/** /v1/light-map (since 1.14.0): one value per point in each array, in the same order. */
export interface V1LightMap {
  centre: { latDeg: number; lonDeg: number };
  radiusKm: number;
  spacingKm: number;
  start: string;
  end: string;
  mode: 'limb' | 'center' | 'full';
  count: number;
  points: {
    latDeg: number[]; lonDeg: number[]; xKm: number[]; yKm: number[];
    sunTimeFraction: number[]; earthTimeFraction: number[]; longestNightHours: number[]; withTerrain: boolean[];
  };
  terrain: V1Terrain;
}

/** /v1/horizon (since 1.2.0). */
export interface V1Horizon {
  site: V1Site; azimuthStepDeg: number; elevationDeg: number[]; groundHeightM: number | null;
  /** Since 1.19.0, only with `relief=1` or `reliefRadiusKm`: null when the server has no DEM at the point. */
  relief?: V1HorizonRelief | null;
  terrain: V1Terrain; warnings?: V1Warning[];
}
/** Terrain heights around the site (since 1.19.0): heightsM[j][k] at distancesM[j] along azimuth k · azimuthStepDeg; null without data. */
export interface V1HorizonRelief { radiusKm: number; azimuthStepDeg: number; groundHeightM: number; distancesM: number[]; heightsM: (number | null)[][] }

/** Public names of the constraints of /v1/landing-dates (since 1.5.0). */
export type V1ConstraintName =
  | 'minMeanSunDiskFraction' | 'minSunTimeFraction' | 'minEarthTimeFraction' | 'minSunAndEarthTimeFraction'
  | 'maxLongestNightHours' | 'maxLongestEarthOutageHours' | 'minLongestSunAndEarthHours' | 'maxBatteryKg';

/** #/components/schemas/LandingDate (since 1.5.0): the mission that starts on `date`. */
export interface V1LandingDate {
  date: string;
  score: number;
  meetsConstraints?: boolean;
  /** Since 1.9.0, only when meetsConstraints is false: the constraints this date misses. */
  violatedConstraints?: V1ConstraintName[];
  sunVisibleAtLanding: boolean;
  hoursToSunChange: number | null;
  metrics: V1Metrics;
}

/** #/components/schemas/LandingWindow (since 1.5.0). */
export interface V1LandingWindow { start: string; end: string; durationDays: number; dateCount: number; bestDate: string; bestScore: number }

/** #/components/schemas/RangeStats */
export interface V1RangeStats { min: number; mean: number; max: number }

/** #/components/schemas/LandingDates: /v1/landing-dates (since 1.5.0). */
export interface V1LandingDates {
  site: V1Site;
  start: string;
  end: string;
  dateStepHours: number;
  missionDays: number;
  sampleStepMinutes: number;
  mode: Mode;
  /** Since 1.16.0, only when earthMode differs from mode. */
  earthMode?: Mode;
  scoreWeights: Record<V1WeightName, number>;
  constraints?: Partial<Record<V1ConstraintName, number>>;
  /** Since 1.9.0, only when earthMinElevationDeg > 0. */
  earthMinElevationDeg?: number;
  goodCriterion: { constraints: boolean; minScore: number | null; relativeToBest: number | null };
  stats: { dateCount: number; score: V1RangeStats; meanSunDiskFraction: V1RangeStats; meetsConstraintsFraction?: number; goodFraction: number };
  best: (V1LandingDate & { rank: number })[];
  worst: (V1LandingDate & { rank: number })[];
  goodWindows: V1LandingWindow[];
  /** Every candidate date; absent with dates=0 (since 1.10.0). */
  dates?: V1LandingDate[];
  terrain?: V1Terrain;
  night?: V1RankNight;
  battery?: V1RankBattery;
  panel?: V1RankPanel;
  slope?: V1SiteSlope;
  note: string;
  /** Since 1.9.0, only when there is something to warn about (ignored parameters, smooth Moon at the poles…). */
  warnings?: V1Warning[];
}

export type V1Response = V1Health | V1SiteList | V1Regions | V1SunEarth | V1Windows | V1Track | V1Horizon | V1LightMap | V1BestLandings | V1Rank | V1LandingDates | V1Search;

/** #/components/schemas/Error */
export interface V1Error { error: { code: 'invalid_parameter' | 'not_found' | 'method_not_allowed' | 'uri_too_long' | 'internal_error' | 'rate_limited' | 'overloaded' | 'timeout' | 'error'; message: string } }
