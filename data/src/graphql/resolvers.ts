// Resolvers of the GraphQL API: every field that computes something calls the v1 route that gives it (v1.ts), with the
// GraphQL arguments translated to v1 query parameters. So the values are the v1 ones by construction (same validation,
// same rounding, same notes and warnings) and v1 stays the only adapter of the engine.
//
// Per request (GraphQLContext): identical route calls are computed once (two fields, an alias or `compare` and
// `Site.landingDates` asking for the same thing), and executor.ts runs the whole request inside withVectorCache, so the
// Sun/Earth vectors of an instant are computed once for every field and site that samples it. Masks and direct rays are
// already cached per thread by the engine (horizon.ts).
import type { GraphQLError } from 'graphql';
import { API_VERSION, HttpError, catalogSite, publicSite, routes, siteSlopeOnly } from '../v1.ts';
import { RequestContext } from '../request.ts';
import { SITES, getSite } from '../../../backend/src/sites.ts';
import { catalogMaskHeights } from '../../../backend/src/horizon.ts';
import { parseSite, parseSiteList } from '../../../backend/src/params.ts';
import type { Resolution } from '../../../backend/src/types.ts';
import type { V1BestLandings, V1LandingDate, V1LightMap, V1LandingDates, V1Rank, V1Regions, V1Search, V1Site, V1Warning } from '../types.ts';
import { OPERATIONS, fieldError, graphqlToV1 } from './operations.ts';
import type { Args, Params } from './operations.ts';

export { fieldError };

// ---------------------------------------------------------------- v1 names → GraphQL names (messages and warnings)

const CONSTRAINT_NAMES = [
  'minMeanSunDiskFraction', 'minSunTimeFraction', 'minEarthTimeFraction', 'minSunAndEarthTimeFraction',
  'maxLongestNightHours', 'maxLongestEarthOutageHours', 'minLongestSunAndEarthHours', 'maxBatteryKg',
] as const;

/** v1 parameter → GraphQL argument, as the errors and warnings of v1 name them (any route; each route's own names win). */
const RENAMES: Record<string, string> = {
  start: 'from', end: 'to', date: 'at', step: 'stepMinutes', dateStep: 'dateStepHours',
  observerHeightM: 'terrain.observerHeightM', panelHeightM: 'terrain.panelHeightM', antennaHeightM: 'terrain.antennaHeightM',
  horizonRefine: 'terrain.refine', horizonRefineDeg: 'terrain.refineDeg',
  nightMinSunFraction: 'night.minSunFraction', fullNight: 'night.fullNight',
  battery: 'battery.enabled', survivalLoadW: 'battery.survivalLoadW', batteryWhPerKg: 'battery.whPerKg', batteryDoD: 'battery.depthOfDischarge',
  weightMeanSunDiskFraction: 'scoring.meanSunDiskFraction', weightEarthTimeFraction: 'scoring.earthTimeFraction',
  slopeBaselineM: 'slope.baselineM', maxSlopeDeg: 'slope.maxSlopeDeg', slopeUncertified: 'slope.uncertified',
  ...Object.fromEntries(CONSTRAINT_NAMES.map((c) => [c, `constraints.${c}`])),
};
/** Names of each route: those of its operation (operations.ts) and those of Site.slope. */
const routeRenames = (route: string): Record<string, string> => (route === 'slope'
  ? { slopeBaselineM: 'baselineM', maxSlopeDeg: 'maxSlopeDeg' }
  : Object.fromEntries(Object.entries(OPERATIONS[route]?.params ?? {}).map(([param, spec]) => [param, spec.arg])));
/** v1 phrases with a flag value, said the GraphQL way. */
const PHRASES: [RegExp, string][] = [[/\bterrain=1\b/g, 'terrain'], [/\bbattery=0\b/g, 'battery.enabled: false'], [/\bslope=1\b/g, 'slope']];

export type Renamer = (text: string) => string;

/** Function that rewrites the v1 parameter names of a message (or a warning's `parameter`) to GraphQL names. */
export function renamer(route: string, prefix = ''): Renamer {
  const map: Record<string, string> = { ...RENAMES, ...routeRenames(route) };
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\w.])(${keys.join('|')})(?![\\w])`, 'g');
  return (text) => PHRASES.reduce((t, [p, r]) => t.replace(p, r), text).replace(re, (m) => (map[m] === m ? m : prefix + map[m]));
}

/** A v1 warning with GraphQL names (`parameter` is null when v1 has none). */
export interface GqlWarning { code: V1Warning['code']; parameter: string | null; message: string }
const gqlWarnings = (ws: readonly V1Warning[], rename: Renamer): GqlWarning[] =>
  ws.map((w) => ({ code: w.code, parameter: w.parameter === undefined ? null : rename(w.parameter), message: rename(w.message) }));

const num = (x: unknown): string | undefined => (x === null || x === undefined ? undefined : String(x));

// ---------------------------------------------------------------- per-request context

/** Body of a v1 route plus its warnings (GraphQL names). */
type Result<T> = Omit<T, 'warnings'> & { warnings: GqlWarning[] };

/** State of one GraphQL request: memo of v1 route calls (counted, for the tests and the measurements). */
export class GraphQLContext {
  private readonly memo = new Map<string, { body?: unknown; warnings?: V1Warning[]; error?: GraphQLError }>();
  readonly counters = { routeCalls: 0, memoHits: 0 };

  /** Runs a v1 route once per request and set of parameters; v1 errors become field errors with GraphQL names. */
  run<T>(route: string, params: Params, resolution: Resolution = 'precise', prefix = ''): Result<T> {
    const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined));
    const key = `${route}|${resolution}|${q}`;
    const rename = renamer(route, prefix);
    let entry = this.memo.get(key);
    if (entry) this.counters.memoHits++;
    else {
      this.counters.routeCalls++;
      const ctx = new RequestContext(resolution);
      try {
        const body = route === 'slope' ? siteSlopeOnly(q, ctx) : routes[route](q, ctx);
        entry = { body, warnings: ctx.warnings };
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        entry = { error: fieldError(rename(e.message), e.status === 404 ? 'not_found' : 'invalid_parameter') };
      }
      this.memo.set(key, entry);
    }
    if (entry.error) throw entry.error;
    return { ...(entry.body as T), warnings: gqlWarnings(entry.warnings!, (t) => rename(t)) };
  }
}

// ---------------------------------------------------------------- output adapters

/** A v1 enum value as the GraphQL one (GraphQL does not allow hyphens: vertical-rotating → vertical_rotating). */
const toEnum = (v: string): string => v.replace(/-/g, '_');

/** `panel.orientation` as the GraphQL enum. */
function withPanelEnum<T extends { panel?: { orientation: string } }>(body: T): T {
  return body.panel ? { ...body, panel: { ...body.panel, orientation: toEnum(body.panel.orientation) } } : body;
}

/** The verdicts of /v1/best-landings (`not-viable`) as the GraphQL enum. */
function withVerdictEnums(body: Result<V1BestLandings>): Result<V1BestLandings> {
  return {
    ...body,
    options: body.options.map((o) => ({ ...o, verdict: toEnum(o.verdict) as never, landings: o.landings.map((l) => ({ ...l, verdict: toEnum(l.verdict) as never })) })),
  };
}

/** Runs the v1 route of an operation with the GraphQL arguments translated by its table (operations.ts). */
function runOperation<T>(ctx: GraphQLContext, route: string, a: Args, base: Params = {}, prefix = ''): Result<T> {
  const { params, resolution } = graphqlToV1(route, a, prefix);
  return ctx.run<T>(route, { ...base, ...params }, resolution, prefix);
}

// ---------------------------------------------------------------- Site

/** A site of the schema: its v1 data plus the fields that compute something (methods: graphql-js calls them with the arguments). */
export interface SiteNode extends V1Site {}
export class SiteNode {
  /** Site parameters of v1 (site=<id> or lat/lon/heightKm). */
  readonly #params: Params;

  constructor(info: V1Site, params: Params) {
    Object.assign(this, info);
    this.#params = params;
  }

  slope(a: Args, ctx: GraphQLContext): unknown {
    return ctx.run('slope', { ...this.#params, slope: '1', slopeBaselineM: num(a.baselineM), maxSlopeDeg: num(a.maxSlopeDeg) });
  }

  horizon(a: Args, ctx: GraphQLContext): unknown { return runOperation(ctx, '/v1/horizon', a, this.#params); }

  sunEarth(a: Args, ctx: GraphQLContext): unknown { return runOperation(ctx, '/v1/sun-earth', a, this.#params); }

  track(a: Args, ctx: GraphQLContext): unknown { return runOperation(ctx, '/v1/track', a, this.#params); }

  windows(a: Args, ctx: GraphQLContext): unknown { return runOperation(ctx, '/v1/windows', a, this.#params); }

  landingDates(a: Args, ctx: GraphQLContext): Result<V1LandingDates> { return this.sweep(a, ctx); }

  /** The landing-date sweep of this site; `prefix` names the arguments in messages (`landingDates.` in compare). */
  sweep(a: Args, ctx: GraphQLContext, prefix = ''): Result<V1LandingDates> {
    return withPanelEnum(runOperation<V1LandingDates>(ctx, '/v1/landing-dates', a, this.#params, prefix));
  }
}

/** Site of the catalogue (as /v1/sites gives it). */
const catalogNode = (id: string): SiteNode => {
  const s = getSite(id);
  if (!s) throw fieldError(`Sitio desconocido: ${id}`, 'not_found');
  return new SiteNode(catalogSite(s), { site: s.id });
};

/** Runs a backend parser, turning its HttpError into a field error. */
function parsed<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if (e instanceof HttpError) throw fieldError(e.message, e.status === 404 ? 'not_found' : 'invalid_parameter');
    throw e;
  }
}

/** Sites of a list argument (ids or lat:lon, as `sites` in /v1/rank): nodes plus the warnings of repeated items. */
function siteList(items: readonly string[], name: string): { nodes: SiteNode[]; warnings: GqlWarning[] } {
  const warnings: GqlWarning[] = [];
  const sites = parsed(() => parseSiteList(items.join(','), (item) => {
    warnings.push({ code: 'duplicate_site', parameter: name, message: `${item} está repetido en ${name}; se evalúa una sola vez.` });
  }));
  const nodes = sites.map((s) => (s.custom
    ? new SiteNode(publicSite(s), { lat: String(s.lat), lon: String(s.lon) })
    : new SiteNode(catalogSite(s), { site: s.id })));
  return { nodes, warnings };
}

// ---------------------------------------------------------------- compare

type LandingResult = Result<V1LandingDates>;

/** Result of `compare`: the sweep of each site, the date × site matrix and the summary per site. */
class ComparisonNode {
  readonly siteCount: number;
  readonly dateCount: number;
  readonly cellCount: number;
  readonly sites: { site: SiteNode; landingDates: LandingResult }[];
  readonly warnings: GqlWarning[];

  constructor(nodes: SiteNode[], results: LandingResult[], warnings: GqlWarning[]) {
    this.siteCount = nodes.length;
    this.dateCount = results[0]?.stats.dateCount ?? 0;
    this.cellCount = this.siteCount * this.dateCount;
    this.sites = nodes.map((site, i) => ({ site, landingDates: results[i] }));
    this.warnings = [...warnings, ...results.flatMap((r, i) => r.warnings.map((w) => ({ ...w, message: `${nodes[i].id}: ${w.message}` })))];
  }

  matrix(): { date: string; bestSiteId: string; cells: (V1LandingDate & { siteId: string })[] }[] {
    const series = this.sites.map((s) => s.landingDates.dates ?? []);
    return (series[0] ?? []).map((first, i) => {
      const cells = this.sites.map((s, k) => ({ siteId: s.site.id, ...series[k][i] }));
      let best = cells[0];
      for (const c of cells) if (c.score > best.score) best = c;
      return { date: first.date, bestSiteId: best.siteId, cells };
    });
  }

  ranking(): { rank: number; siteId: string; name: string; bestDate: string; bestScore: number; meanScore: number; goodFraction: number; meetsConstraintsFraction: number | null }[] {
    return this.sites
      .map(({ site, landingDates: r }, i) => ({ i, siteId: site.id, name: site.name, bestDate: r.best[0].date, bestScore: r.best[0].score, meanScore: r.stats.score.mean, goodFraction: r.stats.goodFraction, meetsConstraintsFraction: r.stats.meetsConstraintsFraction ?? null }))
      .sort((a, b) => b.bestScore - a.bestScore || a.i - b.i)
      .map(({ i: _i, ...rest }, k) => ({ rank: k + 1, ...rest }));
  }
}

// ---------------------------------------------------------------- Query

export const root = {
  apiVersion: (): string => API_VERSION,

  sites(a: Args): SiteNode[] {
    const ids = a.ids as string[] | null | undefined;
    let nodes = ids ? ids.map(catalogNode) : SITES.map((s) => new SiteNode(catalogSite(s), { site: s.id }));
    if (typeof a.withTerrainMask === 'boolean') nodes = nodes.filter((n) => (catalogMaskHeights(n.id).length > 0) === a.withTerrainMask);
    return nodes;
  },

  site(a: Args): SiteNode {
    const { id, lat, lon, heightKm } = a as { id?: string | null; lat?: number | null; lon?: number | null; heightKm?: number | null };
    if (id !== null && id !== undefined) {
      if (lat != null || lon != null || heightKm != null) throw fieldError('Indica id o lat y lon, no los dos');
      return catalogNode(id);
    }
    if (lat == null || lon == null) throw fieldError('Indica id o lat y lon');
    const params: Params = { lat: String(lat), lon: String(lon), heightKm: num(heightKm) };
    const site = parsed(() => parseSite(new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined))));
    return new SiteNode(publicSite(site), params);
  },

  health: (_a: Args, ctx: GraphQLContext): unknown => ctx.run('/v1/health', {}),

  regions: (_a: Args, ctx: GraphQLContext): V1Regions['regions'] => ctx.run<V1Regions>('/v1/regions', {}).regions,

  rank(a: Args, ctx: GraphQLContext): Result<V1Rank> {
    const ids = a.sites as string[] | null | undefined;
    if (ids && ids.length === 0) throw fieldError('sites no puede estar vacío; sin sites se usa todo el catálogo');
    return withPanelEnum(runOperation<V1Rank>(ctx, '/v1/rank', a));
  },

  search: (a: Args, ctx: GraphQLContext): Result<V1Search> => withPanelEnum(runOperation<V1Search>(ctx, '/v1/search', a)),

  bestLandings(a: Args, ctx: GraphQLContext): Result<V1BestLandings> {
    if (!(a.sites as string[]).length) throw fieldError('sites no puede estar vacío: indica de 1 a 10 sitios (ids o lat:lon)');
    return withVerdictEnums(runOperation<V1BestLandings>(ctx, '/v1/best-landings', a));
  },

  lightMap(a: Args, ctx: GraphQLContext): Result<V1LightMap> {
    if (a.site != null && (a.lat != null || a.lon != null)) throw fieldError('Indica site o lat y lon, no los dos');
    return runOperation<V1LightMap>(ctx, '/v1/light-map', a);
  },

  compare(a: Args, ctx: GraphQLContext): ComparisonNode {
    const items = a.sites as string[];
    if (!items.length) throw fieldError('sites no puede estar vacío: indica de 1 a 10 sitios (ids o lat:lon)');
    const { nodes, warnings } = siteList(items, 'sites');
    const options = (a.landingDates ?? {}) as Args;
    return new ComparisonNode(nodes, nodes.map((n) => n.sweep(options, ctx, 'landingDates.')), warnings);
  },
};
