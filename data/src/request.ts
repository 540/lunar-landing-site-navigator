// Request checks of public API v1 that do NOT refuse the request: unknown parameters, parameters that do not apply and
// repeated ones become `warnings` in the response (since 1.9.0). v1 only takes additive changes, so a parameter a client
// already sends by mistake keeps working; the warning tells it what was ignored.
import type { V1Warning, V1WarningCode } from './types.ts';
import type { Resolution } from '../../backend/src/types.ts';

/**
 * Warnings collected while answering one request. `resolution` is the terrain resolution of terrain=1: always
 * `precise` over HTTP (v1 has no parameter for it); the GraphQL layer can ask for `fast` (TerrainInput.resolution).
 */
export class RequestContext {
  readonly warnings: V1Warning[] = [];
  readonly resolution: Resolution;
  constructor(resolution: Resolution = 'precise') { this.resolution = resolution; }
  warn(code: V1WarningCode, message: string, parameter?: string): void {
    if (this.warnings.some((w) => w.code === code && w.parameter === parameter && w.message === message)) return;
    this.warnings.push({ code, ...(parameter !== undefined ? { parameter } : {}), message });
  }
}

const SITE = ['site', 'lat', 'lon', 'heightKm'];
const TERRAIN = ['terrain', 'observerHeightM', 'panelHeightM', 'antennaHeightM', 'horizonRefine', 'horizonRefineDeg'];
const NIGHT = ['nightMinSunFraction', 'fullNight', 'battery', 'survivalLoadW', 'batteryWhPerKg', 'batteryDoD'];
const SLOPE = ['slope', 'slopeBaselineM', 'maxSlopeDeg'];
const WEIGHTS = [
  'weightMeanSunDiskFraction', 'weightEarthTimeFraction', // since 1.16.0 the other five score variables:
  'weightSunAndEarthTimeFraction', 'weightShortNights', 'weightSunTimeFraction', 'weightShortEarthOutages', 'weightLongestSunAndEarth',
];
export const CONSTRAINT_PARAMS = [
  'minMeanSunDiskFraction', 'minSunTimeFraction', 'minEarthTimeFraction', 'minSunAndEarthTimeFraction',
  'maxLongestNightHours', 'maxLongestEarthOutageHours', 'minLongestSunAndEarthHours', 'maxBatteryKg',
] as const;

/** Documented query parameters of each route (data/openapi.yaml). */
export const ROUTE_PARAMS: Record<string, readonly string[]> = {
  '/v1/health': [],
  '/v1/sites': [],
  '/v1/regions': [],
  '/v1/sun-earth': [...SITE, 'date', 'mode', ...TERRAIN, ...SLOPE, 'earthMinElevationDeg'],
  '/v1/windows': [...SITE, 'start', 'end', 'mode', ...TERRAIN, ...NIGHT, ...SLOPE, 'earthMinElevationDeg', 'events', 'horizonBandDeg', 'dsn'],
  '/v1/track': [...SITE, 'start', 'end', 'step', ...TERRAIN],
  '/v1/horizon': [...SITE, 'observerHeightM', 'relief', 'reliefRadiusKm'],
  '/v1/best-landings': ['sites', 'start', 'end', 'days', 'batteryHours', 'minEarthPct', 'maxEarthGapHours', 'priority', 'mode', ...TERRAIN],
  '/v1/light-map': [...SITE, 'radiusKm', 'spacingKm', 'start', 'days', 'mode', 'observerHeightM', 'panelHeightM', 'antennaHeightM'],
  '/v1/rank': ['sites', 'start', 'days', 'mode', 'earthMode', 'step', ...TERRAIN, ...NIGHT, 'panel', ...SLOPE, 'slopeUncertified', ...WEIGHTS, ...CONSTRAINT_PARAMS, 'earthMinElevationDeg'],
  '/v1/landing-dates': [
    ...SITE, 'start', 'end', 'dateStep', 'days', 'mode', 'earthMode', ...TERRAIN, ...NIGHT, 'panel', ...SLOPE, ...WEIGHTS, ...CONSTRAINT_PARAMS,
    'earthMinElevationDeg', 'minScore', 'top', 'dates',
  ],
  '/v1/search': [
    'region', 'latMin', 'latMax', 'lonMin', 'lonMax', 'spacingKm', 'refineLevels', 'refineTop', 'top', 'minSeparationKm', 'start', 'days', 'mode',
    'earthMode', 'step', 'cells', ...TERRAIN, 'terrainResolution', ...NIGHT, 'panel', ...SLOPE, 'slopeUncertified', ...WEIGHTS, 'earthMinElevationDeg',
  ],
};
const ALL_PARAMS = new Set(Object.values(ROUTE_PARAMS).flat());

/** Names of the old internal API (/api/*, removed in 1.16.0) or of the evals, with their v1 equivalent: a likely slip when moving to v1. */
const ALIASES: Record<string, string> = {
  minEnergy: 'minMeanSunDiskFraction',
  minSunFraction: 'minSunTimeFraction',
  minEarthFraction: 'minEarthTimeFraction',
  minBothFraction: 'minSunAndEarthTimeFraction',
  maxLongestNightH: 'maxLongestNightHours',
  maxLongestNoEarthH: 'maxLongestEarthOutageHours',
  minLongestBothH: 'minLongestSunAndEarthHours',
  wEnergy: 'weightMeanSunDiskFraction',
  wComm: 'weightEarthTimeFraction',
  wBoth: 'weightSunAndEarthTimeFraction',
  wNight: 'weightShortNights',
  wSun: 'weightSunTimeFraction',
  wCommGap: 'weightShortEarthOutages',
  wBothStreak: 'weightLongestSunAndEarth',
  earthMinEl: 'earthMinElevationDeg',
};

/** Route-specific slips: a parameter of another route that has an equivalent here. */
const ROUTE_HINTS: Record<string, Record<string, string>> = {
  '/v1/rank': { end: 'days', date: 'start', site: 'sites' },
  '/v1/windows': { days: 'end', date: 'start' },
  '/v1/track': { days: 'end', date: 'start' },
  '/v1/landing-dates': { date: 'start', sites: 'site' },
  '/v1/sun-earth': { start: 'date' },
  '/v1/search': { refine: 'refineLevels', minSepKm: 'minSeparationKm', end: 'days', date: 'start', sites: '/v1/rank' },
};

/** Levenshtein distance (short names: the quadratic cost does not matter). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** The parameter of the route that `name` probably meant (alias, different case or a typo of up to 2 letters). */
function suggestion(route: string, name: string, allowed: readonly string[]): string | null {
  const routeHint = ROUTE_HINTS[route]?.[name];
  if (routeHint) return routeHint;
  const alias = ALIASES[name];
  if (alias && allowed.includes(alias)) return alias;
  const lower = name.toLowerCase();
  const sameCase = allowed.find((p) => p.toLowerCase() === lower);
  if (sameCase) return sameCase;
  let best: string | null = null, bestD = 3;
  for (const p of allowed) {
    const dd = distance(lower, p.toLowerCase());
    if (dd < bestD) { best = p; bestD = dd; }
  }
  return best;
}

/** Unknown, misplaced and repeated parameters of a request to `route` (a documented v1 route). */
export function checkParams(route: string, q: URLSearchParams, ctx: RequestContext): void {
  const allowed = ROUTE_PARAMS[route] ?? [];
  const counted = new Map<string, number>();
  for (const name of q.keys()) counted.set(name, (counted.get(name) ?? 0) + 1);
  for (const [name, n] of counted) {
    if (allowed.includes(name)) {
      if (n > 1) ctx.warn('duplicate_parameter', `${name} aparece ${n} veces; se usa el primer valor («${q.get(name)}»).`, name);
      continue;
    }
    const hint = suggestion(route, name, allowed);
    const tail = hint ? (ROUTE_HINTS[route]?.[name] ? ` Aquí se usa ${hint}.` : ` ¿Querías decir ${hint}?`) : '';
    if (ALL_PARAMS.has(name)) ctx.warn('unused_parameter', `${name} no se usa en ${route}; se ignora.${tail}`, name);
    else ctx.warn('unknown_parameter', `Parámetro desconocido: ${name}; se ignora.${tail}`, name);
  }
}

/** Is a query parameter present with a value? (an empty value counts as absent, as everywhere in v1) */
export const given = (q: URLSearchParams, name: string): boolean => (q.get(name) ?? '') !== '';
