// Protection of the GraphQL endpoint: limits from the environment and a static analysis of each query BEFORE it runs
// (main thread, cheap): depth, estimated cost and sites × dates. A query over a limit is refused with a 400 and a
// message that says how much it asked for and what the limit is.
//
// Cost: an estimate in «points» of roughly one millisecond of computation on one core, calibrated against real
// timings (COSTS, below). The expensive parts are the Sun/Earth ephemeris per sample, computed ONCE per query for every
// site and field that shares the same instants (withVectorCache), and, with terrain, the horizon mask of each site
// when it is not already in the disk cache (a precise mask from the DEM costs ~100 ms; a catalogue or cached one,
// nothing) and the direct rays of the hybrid horizon. A field that is only data costs 0; introspection is free and does
// not count for the depth. Lists that create sites (`sites`, `compare.sites`) multiply what is asked under them.
import { GraphQLError, Kind, getArgumentValues, getNamedType, isObjectType } from 'graphql';
import type { DocumentNode, FragmentDefinitionNode, GraphQLObjectType, GraphQLSchema, OperationDefinitionNode, SelectionSetNode } from 'graphql';
import { SITES, getSite } from '../../../backend/src/sites.ts';
import { catalogMaskHeights, maskState } from '../../../backend/src/horizon.ts';
import { demVersion } from '../../../backend/src/terrain/dem.ts';
import type { Resolution, Site } from '../../../backend/src/types.ts';
import { parseDate } from '../../../backend/src/params.ts';
import { LIMITS } from '../v1.ts';
import { REGIONS } from '../../../backend/src/search.ts';
import { LOOKAHEAD_DAYS, RANK_STEP_HOURS } from '../../../planner/src/ranking.js';

type VariableValues = Parameters<typeof getArgumentValues>[2];

/** Limits of the endpoint (documented in data/README.md, «GraphQL»). */
export interface GraphQLConfig {
  maxDepth: number;
  maxCost: number;
  maxSiteDates: number;
  maxTokens: number;
  maxBodyBytes: number;
  heavyCost: number;
  persistedMax: number;
  introspection: boolean;
}

const int = (env: Record<string, string | undefined>, name: string, fallback: number, min = 0): number => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} debe ser un entero mayor o igual que ${min} (vale «${raw}»)`);
  return n;
};

export function graphqlConfig(env: Record<string, string | undefined> = process.env): GraphQLConfig {
  const intro = env.LUNAR_GRAPHQL_INTROSPECTION;
  return {
    maxDepth: int(env, 'LUNAR_GRAPHQL_MAX_DEPTH', 12, 1),
    maxCost: int(env, 'LUNAR_GRAPHQL_MAX_COST', 10000, 1),
    maxSiteDates: int(env, 'LUNAR_GRAPHQL_MAX_SITE_DATES', 10000, 1),
    maxTokens: int(env, 'LUNAR_GRAPHQL_MAX_TOKENS', 5000, 100),
    maxBodyBytes: int(env, 'LUNAR_GRAPHQL_MAX_BODY_BYTES', 65536, 1024),
    heavyCost: int(env, 'LUNAR_GRAPHQL_HEAVY_COST', 100, 0),
    persistedMax: int(env, 'LUNAR_GRAPHQL_PERSISTED_MAX', 500, 0),
    introspection: !(intro === '0' || intro === 'false'),
  };
}

/**
 * Cost model (points ≈ ms of one core). Exported for the documentation and the tests. Measured in API 1.13.0 on the real
 * DEM, one worker, cold (new points, empty mask cache) and warm (repeated), against the 1.12.0 estimate:
 *   sunEarth (45-day rise/set lookahead)            53 ms        (1.12.0: 11)
 *   windows of a year (15-min samples)               385 ms       (422)
 *   landingDates of a year                           104 ms       (114)
 *   sites { landingDates(a year) } (15 sites)         160 ms       (1701: the ephemeris was counted once per site)
 *   … with terrain                                    838 cold, 160 warm   (3709: refused)
 *   horizon of a new point (one precise mask)         102 cold, 1 warm     (11)
 *   rank of 10 new points with terrain, 30 days       1035 cold, 11 warm   (351)
 *   windows of a year with terrain (catalogue mask)   720 cold, 393 warm   (867): the rays of the hybrid horizon
 * and, in API 1.16.0 (same conditions, mask disk cache off), against the estimate:
 *   bestLandings of 10 sites, 120 days, 30-day mission         210 ms       (313)
 *   … with terrain (5 catalogue sites, 5 new points)          735 ms       (1154)
 *   lightMap of 709 points (60 km every 4 km), 10 days        7.7–10.1 s   (8580): ~11 ms per point, its fast mask
 * and, in API 1.17.0 (the same, masks always cold):
 *   search of polo-sur by default (no terrain)                94 ms        (101)
 *   search of polo-sur every 10 km, 60 days, 30-min step      650 ms       (700)
 *   search of polo-sur every 20 km with terrain (fast)        3.1–7.2 s    (6607)
 */
export const COSTS = {
  /** Sun/Earth vectors of one sample (~11 µs), once per query and period (shared by every site). */
  perSample: 0.011,
  /** Topocentric position and visibility of one sample at one more site. */
  perSiteSample: 0.0004,
  /** A site of a list, a field without computation of its own. */
  site: 1,
  slope: 2,
  /** Profile of /v1/horizon, without its mask. */
  horizon: 1,
  /** Snapshot with the next rise and set (45-day lookahead). */
  sunEarth: 50,
  /** Horizon mask of a site, by state (backend/src/horizon.ts maskState): computed from the DEM in each resolution. */
  maskCold: { precise: 110, fast: 12 },
  /** Mask read from the disk cache or the catalogue. */
  maskCached: 1,
  /** Direct rays of the hybrid horizon (cold), per sample: windows and the snapshot refine rises and sets with them. */
  rayPerWindowSample: 0.01,
  rayPerSample: 0.002,
  raySunEarth: 20,
  /** Sliding window of the sweep: per date and hourly sample of the mission. */
  slidePerDateSample: 2e-5,
  /** Per site and day of a ranking (metrics over the shared samples). */
  rankPerSiteDay: 0.02,
  /** best-landings: the mission rules over the windows of one site, per landing tested (every 12 h, plus 15 days to measure the streak). */
  bestLandingsPerLanding: 0.02,
  /** Per point and sample of a grid search (its loop is tighter than a ranking's); with terrain, plus each point's mask. */
  searchPerPointSample: 0.00017,
} as const;

const DAY_MS = 86400e3;
/** Days of the whole night looked for around the period with fullNight (30 on each side), hourly. */
const FULL_NIGHT_DAYS = 60;

/** What a query asks for, before running it. */
export interface Analysis { cost: number; depth: number; siteDates: number; usesNow: boolean }

type Args = Record<string, unknown>;
/** A site the query computes something for: catalogue entry or custom point. */
type SiteRef = Pick<Site, 'lat' | 'lon'> & { id?: string; custom?: boolean };
/**
 * Cost of a field: `cost` is per parent (multiplied by the sites above it); `once` is paid once per query (the
 * ephemeris, shared). `sites` are the sites the field creates for the fields under it.
 */
interface FieldCost { cost: number; once?: number; siteDates?: number; usesNow?: boolean; childMult?: number; sites?: readonly SiteRef[] }

/** Date argument in ms (NaN when absent or malformed: then the default applies; the execution reports the error). */
function ms(x: unknown): number {
  if (typeof x !== 'string' || x === '') return NaN;
  try { return parseDate(x, 'fecha'); } catch { return NaN; }
}
/** Length in days of [from, to] (to defaults to from + defDays). */
function spanDays(from: unknown, to: unknown, defDays: number): number {
  const a = ms(from), b = ms(to);
  if (Number.isNaN(b) || Number.isNaN(a)) return defDays;
  return Math.max(0, (b - a) / DAY_MS);
}
interface TerrainArgs { enabled?: boolean; resolution?: Resolution; observerHeightM?: number; panelHeightM?: number; antennaHeightM?: number; refine?: boolean; refineDeg?: number }
const terrainOn = (t: unknown): t is TerrainArgs => Boolean(t) && (t as TerrainArgs).enabled !== false;
const fullNight = (n: unknown): boolean => Boolean((n as { fullNight?: boolean } | null)?.fullNight);

/** Sites of a list of ids or `lat:lon` (unknown or malformed items: a custom point at the pole, the execution reports them). */
function siteRefs(items: readonly string[] | null | undefined): SiteRef[] {
  if (!items) return [...SITES];
  return items.map((item) => {
    const [lat, lon] = item.includes(':') ? item.split(':').map(Number) : [NaN, NaN];
    return getSite(item) ?? { lat: Number.isFinite(lat) ? lat : -90, lon: Number.isFinite(lon) ? lon : 0, custom: true };
  });
}

/**
 * Masks and rays of one site with terrain (0 without): one mask per distinct height (panel and antenna), by state, and
 * the rays of the hybrid horizon over `samples` (only with a DEM and the hybrid on).
 */
function terrainCost(t: unknown, site: SiteRef, { catalogFirst, samples, rayPerSample }: { catalogFirst: boolean; samples: number; rayPerSample: number }): number {
  if (!terrainOn(t)) return 0;
  const resolution: Resolution = t.resolution === 'fast' ? 'fast' : 'precise';
  const h = t.observerHeightM ?? 2;
  const heights = [...new Set([t.panelHeightM ?? h, t.antennaHeightM ?? h])];
  let cost = 0, demMask = false;
  for (const height of heights) {
    const state = maskState(site, height, resolution, catalogFirst);
    cost += state === 'cold' ? COSTS.maskCold[resolution] : state === 'none' ? 0 : COSTS.maskCached;
    if (state !== 'none' && demVersion()) demMask = true;
  }
  const refine = t.refine === false ? 0 : t.refineDeg ?? (resolution === 'precise' || t.refine === true ? 0.1 : 0);
  return cost + (demMask && refine > 0 ? samples * rayPerSample * heights.length : 0);
}

/**
 * Points of a light map (those of lightMapCells: a square mesh clipped to the disc), counted row by row without
 * building them; at most the limit of v1 (beyond it the execution refuses the map). Out-of-range values: the defaults.
 */
export function lightMapPoints(radius: unknown, spacing: unknown): number {
  const r = typeof radius === 'number' && radius > 0 ? Math.min(radius, LIMITS.lightMapMaxRadiusKm) : LIMITS.lightMapDefaultRadiusKm;
  const s = typeof spacing === 'number' && spacing >= LIMITS.lightMapMinSpacingKm ? spacing : Math.max(LIMITS.lightMapMinSpacingKm, Math.round((r / 15) * 100) / 100);
  const k = Math.floor(r / s);
  let n = 0;
  for (let j = -k; j <= k && n <= LIMITS.lightMapMaxPoints; j++) n += 2 * Math.floor(Math.sqrt(Math.max(0, (r + 1e-9) ** 2 - (j * s) ** 2)) / s) + 1;
  return Math.min(n, LIMITS.lightMapMaxPoints);
}

/** Points a grid search evaluates: the initial grid (estimated from the area, capped where v1 refuses it) plus the refinement. */
function searchPoints(a: Args): { points: number; terrain: boolean; resolution: Resolution } {
  const base = REGIONS[String(a.region ?? 'polo-sur')] ?? REGIONS['polo-sur'];
  const num = (x: unknown, d: number): number => (typeof x === 'number' ? x : d);
  const latMin = num(a.latMin, base.latMin), latMax = num(a.latMax, base.latMax), lonMin = num(a.lonMin, base.lonMin), lonMax = num(a.lonMax, base.lonMax);
  const spacing = Math.max(LIMITS.searchMinSpacingKm, num(a.spacingKm, LIMITS.searchDefaultSpacingKm));
  const kmPerDeg = (1737.4 * Math.PI) / 180;
  const meanCos = Math.max(0, Math.cos(((latMin + latMax) / 2) * (Math.PI / 180)));
  const grid = (Math.abs(latMax - latMin) * kmPerDeg / spacing + 1) * (Math.abs(lonMax - lonMin) * kmPerDeg * meanCos / spacing + 1);
  const terrain = terrainOn(a.terrain);
  const resolution: Resolution = (a.terrain as TerrainArgs | null)?.resolution === 'precise' ? 'precise' : 'fast';
  const max = !terrain ? LIMITS.searchMaxCells : resolution === 'fast' ? LIMITS.searchMaxCellsTerrainFast : LIMITS.searchMaxCellsTerrainPrecise;
  const refine = num(a.refineLevels, LIMITS.searchDefaultRefineLevels) * num(a.refineTop, LIMITS.searchDefaultRefineTop) * 25; // 5 × 5 around each
  return { points: Math.min(max, grid) + refine, terrain, resolution };
}

/** Mean of a per-site cost over the sites of the parent (the visit multiplies it by their number). */
const mean = (sites: readonly SiteRef[], f: (s: SiteRef) => number): number => (sites.length ? sites.reduce((sum, s) => sum + f(s), 0) / sites.length : 0);

/** Cost of a landing-date sweep for `sites` with the same options (the ephemeris samples are shared). */
export function sweepCost(a: Args, sites: readonly SiteRef[]): FieldCost {
  const range = spanDays(a.from, a.to, LIMITS.landingDefaultRangeDays);
  const mission = (a.missionDays as number | null) ?? LIMITS.landingDefaultMissionDays;
  const stepH = (a.dateStepHours as number | null) ?? 24;
  const dates = Math.floor((range * 24) / Math.max(1, stepH)) + 1;
  const samples = (range + mission + (fullNight(a.night) ? FULL_NIGHT_DAYS : 0)) * 24;
  const perSite = (s: SiteRef): number => 2 + (a.slope ? COSTS.slope : 0) + samples * COSTS.perSiteSample + dates * mission * 24 * COSTS.slidePerDateSample
    + terrainCost(a.terrain, s, { catalogFirst: false, samples, rayPerSample: COSTS.rayPerSample });
  return { cost: mean(sites, perSite), once: samples * COSTS.perSample, siteDates: dates, usesNow: a.from == null };
}

/** Cost of each field that computes something, by `Type.field`; `sites` are the sites of the parent. */
const RULES: Record<string, (a: Args, sites: readonly SiteRef[]) => FieldCost> = {
  'Query.sites': (a) => {
    let list = siteRefs(a.ids as string[] | null);
    if (!a.ids && typeof a.withTerrainMask === 'boolean') list = SITES.filter((s) => (catalogMaskHeights(s.id).length > 0) === a.withTerrainMask);
    return { cost: COSTS.site, childMult: list.length, sites: list };
  },
  'Query.site': (a) => ({ cost: COSTS.site, sites: a.id != null ? siteRefs([String(a.id)]) : [{ lat: Number(a.lat ?? -90), lon: Number(a.lon ?? 0), custom: true }] }),
  'Query.health': () => ({ cost: 0, usesNow: true }), // uptime: never cached
  'Query.rank': (a) => {
    const list = siteRefs(a.sites as string[] | null);
    const days = (a.days as number | null) ?? LIMITS.rankDefaultDays;
    const samples = days * (1440 / ((a.stepMinutes as number | null) ?? 60)) + (fullNight(a.night) ? FULL_NIGHT_DAYS * 24 : 0);
    const perSite = (s: SiteRef): number => days * COSTS.rankPerSiteDay + samples * COSTS.perSiteSample + (a.slope ? COSTS.slope : 0)
      + terrainCost(a.terrain, s, { catalogFirst: false, samples, rayPerSample: COSTS.rayPerSample });
    return { cost: list.reduce((sum, s) => sum + perSite(s), 0), once: samples * COSTS.perSample, usesNow: a.from == null };
  },
  'Query.search': (a) => {
    const { points, terrain, resolution } = searchPoints(a);
    const days = (a.days as number | null) ?? LIMITS.searchDefaultDays;
    const samples = days * (1440 / ((a.stepMinutes as number | null) ?? 60)) + (fullNight(a.night) ? FULL_NIGHT_DAYS * 24 : 0);
    const perPoint = samples * COSTS.searchPerPointSample + (terrain ? COSTS.maskCold[resolution] : 0) + (a.slope ? COSTS.slope : 0);
    return { cost: points * perPoint, once: samples * COSTS.perSample, usesNow: a.from == null };
  },
  'Query.compare': (a) => {
    const list = siteRefs(a.sites as string[]);
    const sweep = sweepCost((a.landingDates ?? {}) as Args, list);
    return { ...sweep, cost: sweep.cost * list.length, siteDates: (sweep.siteDates ?? 0) * list.length, sites: list };
  },
  'Query.bestLandings': (a) => {
    // The windows of each site over the range of planner/ranking.js (the window, the mission and 16 days more), every
    // 15 min as /v1/windows, and the mission rules at every landing tested (every 12 h, and 15 days more for the streak).
    // The rays of the hybrid horizon at the rate of the sweeps: measured, they add little here (5 catalogue sites over
    // 120 days with terrain, 150 ms against 144 without).
    const list = siteRefs(a.sites as string[]);
    const window = spanDays(a.from, a.to, 0);
    const mission = (a.missionDays as number | null) ?? 10;
    const samples = (window + mission + LOOKAHEAD_DAYS + 1) * 96;
    const landings = Math.floor((window * 24) / RANK_STEP_HOURS) + 1;
    const perSite = (s: SiteRef): number => 2 + samples * COSTS.perSiteSample + (landings + (LOOKAHEAD_DAYS * 24) / RANK_STEP_HOURS) * COSTS.bestLandingsPerLanding
      + terrainCost(a.terrain, s, { catalogFirst: true, samples, rayPerSample: COSTS.rayPerSample });
    return { cost: list.reduce((sum, s) => sum + perSite(s), 0), once: samples * COSTS.perSample, siteDates: landings * list.length };
  },
  'Query.lightMap': (a) => {
    // One fast mask per point (and per distinct height) when the server has the DEM, and the hourly samples of the period.
    const points = lightMapPoints(a.radiusKm, a.spacingKm);
    const samples = ((a.days as number | null) ?? LIMITS.lightMapDefaultDays) * 24;
    const centre = a.lat != null && a.lon != null ? { lat: Number(a.lat), lon: Number(a.lon), custom: true } : a.site != null ? siteRefs([String(a.site)])[0] : { lat: -90, lon: 0, custom: true };
    const h = (a.observerHeightM as number | null) ?? LIMITS.observerHeightDefaultM;
    const heights = [...new Set([(a.panelHeightM as number | null) ?? h, (a.antennaHeightM as number | null) ?? h])];
    // The state of the centre stands for every point: without the DEM (or outside it) no masks; with it, cold ones (the
    // disk cache is looked up point by point, and a new map rarely repeats its points).
    const mask = heights.reduce((sum, height) => {
      const state = maskState({ lat: centre.lat, lon: centre.lon, custom: true }, height, 'fast', false);
      return sum + (state === 'cold' || state === 'disk' ? COSTS.maskCold.fast : 0);
    }, 0);
    return { cost: 1 + points * (samples * COSTS.perSiteSample + mask), once: samples * COSTS.perSample, usesNow: a.from == null };
  },
  'Comparison.sites': (_a, sites) => ({ cost: 0, childMult: sites.length, sites }),
  'Site.slope': () => ({ cost: COSTS.slope }),
  'Site.horizon': (a, sites) => ({ cost: COSTS.horizon + mean(sites, (s) => terrainCost({ observerHeightM: (a.heightM as number | null) ?? 2, refine: false }, s, { catalogFirst: true, samples: 0, rayPerSample: 0 })) }),
  'Site.sunEarth': (a, sites) => ({
    cost: COSTS.sunEarth + (a.slope ? COSTS.slope : 0) + mean(sites, (s) => terrainCost(a.terrain, s, { catalogFirst: true, samples: 1, rayPerSample: COSTS.raySunEarth })),
    usesNow: a.at == null,
  }),
  'Site.track': (a, sites) => {
    const days = spanDays(a.from, a.to, LIMITS.trackDefaultDays);
    const points = (days * 1440) / ((a.stepMinutes as number | null) ?? 60);
    return {
      cost: 1 + points * COSTS.perSiteSample + mean(sites, (s) => terrainCost(a.terrain, s, { catalogFirst: true, samples: points, rayPerSample: COSTS.rayPerSample })),
      once: points * COSTS.perSample, usesNow: a.from == null,
    };
  },
  'Site.windows': (a, sites) => {
    const samples = spanDays(a.from, a.to, LIMITS.windowsDefaultDays) * 96 + (fullNight(a.night) ? FULL_NIGHT_DAYS * 24 : 0); // every 15 min; the whole night hourly
    return {
      cost: 2 + (a.slope ? COSTS.slope : 0) + samples * COSTS.perSiteSample + mean(sites, (s) => terrainCost(a.terrain, s, { catalogFirst: true, samples, rayPerSample: COSTS.rayPerWindowSample })),
      once: samples * COSTS.perSample, usesNow: a.from == null,
    };
  },
  'Site.landingDates': (a, sites) => sweepCost(a, sites),
};

/** Error of a refused query: Spanish message and a stable code. */
export const requestError = (message: string, code: string): GraphQLError => new GraphQLError(message, { extensions: { code } });

const fmt = (x: number): string => Math.round(x).toLocaleString('es-ES');

/**
 * Analyses the operation that will run (after validation) with its variables: depth, cost, sites × dates and whether
 * it depends on «now» (some date left to its default). Throws a GraphQLError when a limit is exceeded.
 */
export function analyze(schema: GraphQLSchema, document: DocumentNode, operation: OperationDefinitionNode, variables: VariableValues, cfg: GraphQLConfig): Analysis {
  const fragments: Record<string, FragmentDefinitionNode> = {};
  for (const d of document.definitions) if (d.kind === Kind.FRAGMENT_DEFINITION) fragments[d.name.value] = d;
  const out: Analysis = { cost: 0, depth: 0, siteDates: 0, usesNow: false };
  let visited = 0;

  // Ephemeris paid once per query: the largest per period signature (fields over the same instants share the samples).
  const once = new Map<string, number>();
  const visit = (set: SelectionSetNode, type: GraphQLObjectType, depth: number, mult: number, sites: readonly SiteRef[]): void => {
    for (const sel of set.selections) {
      if (++visited > 100000) throw requestError('La consulta es demasiado compleja: tiene demasiados campos y fragmentos anidados.', 'query_too_complex');
      if (sel.kind === Kind.FIELD) {
        const name = sel.name.value;
        if (name.startsWith('__')) continue; // introspection and __typename: free
        const def = type.getFields()[name];
        if (!def) continue;
        const d = depth + 1;
        if (d > cfg.maxDepth) throw requestError(`La consulta es demasiado profunda: más de ${cfg.maxDepth} niveles de campos anidados (LUNAR_GRAPHQL_MAX_DEPTH).`, 'query_too_deep');
        out.depth = Math.max(out.depth, d);
        let childMult = 1, childSites = sites;
        const rule = RULES[`${type.name}.${name}`];
        if (rule) {
          const args = getArgumentValues(def, sel, variables) as Args;
          const c = rule(args, sites);
          out.cost += mult * c.cost;
          if (c.once) {
            const key = `${type.name}.${name}|${String(args.from ?? '')}|${String(args.to ?? '')}|${JSON.stringify(args.landingDates ?? null)}`;
            once.set(key, Math.max(once.get(key) ?? 0, c.once));
          }
          out.siteDates += mult * (c.siteDates ?? 0);
          out.usesNow ||= c.usesNow === true;
          childMult = c.childMult ?? 1;
          childSites = c.sites ?? sites;
        }
        const t = getNamedType(def.type);
        if (sel.selectionSet && isObjectType(t)) visit(sel.selectionSet, t, d, Math.min(mult * childMult, 1e9), childSites);
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        const t = sel.typeCondition ? schema.getType(sel.typeCondition.name.value) : type;
        if (isObjectType(t)) visit(sel.selectionSet, t, depth, mult, sites);
      } else {
        const f = fragments[sel.name.value];
        const t = f && schema.getType(f.typeCondition.name.value);
        if (f && isObjectType(t)) visit(f.selectionSet, t, depth, mult, sites);
      }
    }
  };
  const rootType = schema.getQueryType()!;
  visit(operation.selectionSet, rootType, 0, 1, []);
  for (const c of once.values()) out.cost += c;
  out.cost = Math.round(out.cost * 10) / 10;

  if (out.siteDates > cfg.maxSiteDates) {
    throw requestError(`La consulta pide ${fmt(out.siteDates)} combinaciones de sitio y fecha de alunizaje; el máximo es ${fmt(cfg.maxSiteDates)} `
      + '(LUNAR_GRAPHQL_MAX_SITE_DATES). Reduce el número de sitios o el rango de fechas, o aumenta dateStepHours.', 'too_many_site_dates');
  }
  if (out.cost > cfg.maxCost) {
    throw requestError(`La consulta es demasiado cara: su coste estimado es ${fmt(out.cost)} puntos y el máximo es ${fmt(cfg.maxCost)} `
      + '(LUNAR_GRAPHQL_MAX_COST; un punto ≈ 1 ms de cálculo). Lo que más cuesta son los barridos largos con relieve, las ventanas '
      + 'de muchos días y repetir cálculos para muchos sitios: acorta los intervalos, pide menos sitios o quita el relieve, '
      + 'o divide la consulta en varias.', 'query_too_complex');
  }
  return out;
}
