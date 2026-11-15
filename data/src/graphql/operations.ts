// What GraphQL offers of v1, defined ONCE (#71): for every v1 route, the GraphQL field that answers it and, for every
// v1 query parameter, the GraphQL argument it comes from. The resolvers build the v1 parameters from this table
// (graphqlToV1), the error and warning messages are renamed with it (resolvers.ts, renamer) and the parity tests read it:
// test/api-parity.test.ts checks it against data/openapi.yaml and schema.graphql in both directions (a v1 route,
// parameter or response field without its GraphQL equivalent fails, and vice versa), and test/single-source.test.ts
// turns v1 requests into GraphQL queries with it and checks that both answer the same. Deliberate differences are in
// V1_ONLY and GRAPHQL_ONLY, each with its reason.
import { GraphQLError } from 'graphql';
import { CONSTRAINT_PARAMS } from '../request.ts';
import { LIMITS, WEIGHT_PARAMS } from '../v1.ts';
import type { Resolution } from '../../../backend/src/types.ts';

/** v1 query parameters (undefined = not given). */
export type Params = Record<string, string | undefined>;
export type Args = Record<string, unknown>;

/** Error of a field: Spanish message and a stable code in `extensions.code` (the v1 ones where they exist). */
export const fieldError = (message: string, code: 'invalid_parameter' | 'not_found' = 'invalid_parameter'): GraphQLError =>
  new GraphQLError(message, { extensions: { code } });

/**
 * How a GraphQL argument becomes a v1 parameter: `text` (as is), `num` (a number as text), `flag` (1/0), `date` (DateTime, checked to
 * be a non-empty string), `enum` (the GraphQL value with `_` turned into `-`, as in `vertical_rotating`), `list` (ids
 * joined by commas), `minutes`/`hours` (a duration: 30 → `30m`), and `switch`: the presence of an input object turns
 * the v1 flag on (`terrain: {}` → terrain=1) and its `enabled: false` turns it off (terrain=0).
 */
export type Conversion = 'text' | 'num' | 'flag' | 'date' | 'enum' | 'list' | 'minutes' | 'hours' | 'switch';
export interface ArgSpec {
  /** Path of the GraphQL argument (`terrain.observerHeightM`); with `switch`, the input object or its `enabled`. */
  arg: string;
  to: Conversion;
  /**
   * `switch` only: in v1 the flag stays off when only its other parameters are given (terrain: heights without
   * terrain=1 are ignored), unlike battery and slope, which those parameters turn on. In GraphQL: `enabled: false`.
   */
  offUnlessGiven?: boolean;
  /** Check done before calling v1 (a duration with an exponent is not one v1 can read). */
  check?: (value: number, name: string) => void;
}

export interface Operation {
  /** GraphQL field that answers the route: `Type.field`. */
  field: string;
  /** A field of `Site`: site, lat, lon and heightKm come from the parent (`Query.site(id, lat, lon, heightKm)`). */
  site?: boolean;
  /** GraphQL list that carries the v1 body's list (/v1/sites: `sites`): the field returns that list. */
  list?: string;
  /** `TerrainInput.resolution` chooses the terrain resolution of the computation (v1 over HTTP is always precise). */
  resolution?: boolean;
  /** v1 parameter → GraphQL argument (site parameters excluded: they come from the parent). */
  params: Record<string, ArgSpec>;
}

const lowerFirst = (s: string): string => s[0].toLowerCase() + s.slice(1);
const num = (arg: string): ArgSpec => ({ arg, to: 'num' });

/** v1 parameters of a site (`site` or `lat`/`lon`/`heightKm`) → arguments of `Query.site`. */
export const SITE_ARGS: Record<string, string> = { site: 'id', lat: 'lat', lon: 'lon', heightKm: 'heightKm' };

const TERRAIN: Record<string, ArgSpec> = {
  terrain: { arg: 'terrain', to: 'switch', offUnlessGiven: true },
  observerHeightM: num('terrain.observerHeightM'),
  panelHeightM: num('terrain.panelHeightM'),
  antennaHeightM: num('terrain.antennaHeightM'),
  horizonRefine: { arg: 'terrain.refine', to: 'flag' },
  horizonRefineDeg: num('terrain.refineDeg'),
};
const NIGHT: Record<string, ArgSpec> = {
  nightMinSunFraction: num('night.minSunFraction'),
  fullNight: { arg: 'night.fullNight', to: 'flag' },
  battery: { arg: 'battery.enabled', to: 'switch' },
  survivalLoadW: num('battery.survivalLoadW'),
  batteryWhPerKg: num('battery.whPerKg'),
  batteryDoD: num('battery.depthOfDischarge'),
};
/** Slope of one site (sun-earth, windows, landing-dates): `SiteSlopeInput`. */
const SITE_SLOPE: Record<string, ArgSpec> = {
  slope: { arg: 'slope', to: 'switch' },
  slopeBaselineM: num('slope.baselineM'),
  maxSlopeDeg: num('slope.maxSlopeDeg'),
};
/** Slope as a filter (rank, search): `SlopeInput`. */
const SLOPE: Record<string, ArgSpec> = { ...SITE_SLOPE, slopeUncertified: { arg: 'slope.uncertified', to: 'enum' } };
/** weightMeanSunDiskFraction… → scoring.meanSunDiskFraction… */
const WEIGHTS: Record<string, ArgSpec> = Object.fromEntries(WEIGHT_PARAMS.map((p) => [p, num(`scoring.${lowerFirst(p.slice('weight'.length))}`)]));
const CONSTRAINTS: Record<string, ArgSpec> = Object.fromEntries(CONSTRAINT_PARAMS.map((c) => [c, num(`constraints.${c}`)]));
const EARTH_MIN = { earthMinElevationDeg: num('earthMinElevationDeg') };
const RANGE = { start: { arg: 'from', to: 'date' }, end: { arg: 'to', to: 'date' } } satisfies Record<string, ArgSpec>;
const MODE = { mode: { arg: 'mode', to: 'enum' } } satisfies Record<string, ArgSpec>;
/** Score options of rank, landing-dates and search. */
const SCORING: Record<string, ArgSpec> = {
  earthMode: { arg: 'earthMode', to: 'enum' }, panel: { arg: 'panel', to: 'enum' }, ...WEIGHTS, ...NIGHT, ...EARTH_MIN,
};
const SAMPLE_STEP = { step: { arg: 'stepMinutes', to: 'minutes' } } satisfies Record<string, ArgSpec>;

/** Every v1 route (data/openapi.yaml) and its GraphQL field. */
export const OPERATIONS: Record<string, Operation> = {
  '/v1/health': { field: 'Query.health', params: {} },
  '/v1/sites': { field: 'Query.sites', list: 'sites', params: {} },
  '/v1/regions': { field: 'Query.regions', list: 'regions', params: {} },
  '/v1/sun-earth': {
    field: 'Site.sunEarth', site: true, resolution: true,
    params: { date: { arg: 'at', to: 'date' }, ...MODE, ...TERRAIN, ...SITE_SLOPE, ...EARTH_MIN },
  },
  '/v1/windows': {
    field: 'Site.windows', site: true, resolution: true,
    params: { ...RANGE, ...MODE, ...TERRAIN, ...NIGHT, ...SITE_SLOPE, ...EARTH_MIN, events: { arg: 'events', to: 'flag' }, horizonBandDeg: num('horizonBandDeg'), dsn: { arg: 'dsn', to: 'flag' } },
  },
  '/v1/track': {
    field: 'Site.track', site: true, resolution: true,
    params: {
      ...RANGE,
      step: {
        arg: 'stepMinutes', to: 'minutes',
        check: (m, name) => {
          if (!(m >= LIMITS.trackMinStepMinutes && m <= LIMITS.trackMaxStepMinutes)) {
            throw fieldError(`${name} debe estar entre ${LIMITS.trackMinStepMinutes} min y ${LIMITS.trackMaxStepMinutes} min`);
          }
        },
      },
      ...TERRAIN,
    },
  },
  '/v1/horizon': {
    field: 'Site.horizon', site: true,
    params: { observerHeightM: num('heightM'), relief: { arg: 'relief', to: 'flag' }, reliefRadiusKm: num('reliefRadiusKm') },
  },
  '/v1/light-map': {
    field: 'Query.lightMap',
    params: {
      site: { arg: 'site', to: 'text' }, lat: num('lat'), lon: num('lon'), heightKm: num('heightKm'), radiusKm: num('radiusKm'), spacingKm: num('spacingKm'),
      start: RANGE.start, days: num('days'), ...MODE,
      observerHeightM: num('observerHeightM'), panelHeightM: num('panelHeightM'), antennaHeightM: num('antennaHeightM'),
    },
  },
  '/v1/best-landings': {
    field: 'Query.bestLandings', resolution: true,
    params: {
      sites: { arg: 'sites', to: 'list' }, ...RANGE, days: num('missionDays'), batteryHours: num('batteryHours'), minEarthPct: num('minEarthPct'),
      maxEarthGapHours: num('maxEarthGapHours'), priority: { arg: 'priority', to: 'enum' }, ...MODE, ...TERRAIN,
    },
  },
  '/v1/rank': {
    field: 'Query.rank', resolution: true,
    params: {
      sites: { arg: 'sites', to: 'list' }, start: RANGE.start, days: num('days'), ...MODE, ...SAMPLE_STEP, ...TERRAIN, ...SLOPE, ...CONSTRAINTS, ...SCORING,
    },
  },
  '/v1/landing-dates': {
    field: 'Site.landingDates', site: true, resolution: true,
    params: {
      ...RANGE,
      dateStep: {
        arg: 'dateStepHours', to: 'hours',
        check: (h, name) => {
          if (!(h >= LIMITS.landingMinDateStepHours && h <= LIMITS.landingMaxDateStepHours)) {
            throw fieldError(`${name} debe estar entre ${LIMITS.landingMinDateStepHours} h y ${LIMITS.landingMaxDateStepHours / 24} d`);
          }
        },
      },
      days: num('missionDays'), ...MODE, ...TERRAIN, ...SITE_SLOPE, ...CONSTRAINTS, ...SCORING, minScore: num('minScore'), top: num('top'),
    },
  },
  '/v1/search': {
    field: 'Query.search',
    params: {
      region: { arg: 'region', to: 'text' }, latMin: num('latMin'), latMax: num('latMax'), lonMin: num('lonMin'), lonMax: num('lonMax'),
      spacingKm: num('spacingKm'), refineLevels: num('refineLevels'), refineTop: num('refineTop'), top: num('top'), minSeparationKm: num('minSeparationKm'),
      start: RANGE.start, days: num('days'), ...MODE, ...SAMPLE_STEP, cells: { arg: 'cells', to: 'flag' }, ...TERRAIN,
      terrainResolution: { arg: 'terrain.resolution', to: 'enum' }, ...SLOPE, ...SCORING,
    },
  },
};

/**
 * What v1 has and GraphQL deliberately does not, with the reason (the parity test accepts nothing else).
 * Keys: `METHOD path` (a route), `path?param` (a parameter) or `path#field` (a response field, dotted from the body).
 */
export const V1_ONLY: Record<string, string> = {
  'POST /v1/search/jobs': 'Trabajo asíncrono de HTTP (202 y sondeo, en el hilo principal); GraphQL calcula dentro de la petición: `search` da el mismo resultado.',
  'GET /v1/search/jobs/{id}': 'Estado de un trabajo asíncrono de HTTP (ver POST /v1/search/jobs).',
  '/v1/landing-dates?dates': 'dates=0 solo recorta la respuesta; en GraphQL lo decide la selección (no pedir `dates`).',
  '/v1/sites#count': 'GraphQL devuelve la lista: su longitud.',
  '/v1/regions#count': 'GraphQL devuelve la lista: su longitud.',
  '/v1/sites#warnings': 'Sin parámetros solo avisaría de parámetros desconocidos, que en GraphQL son un error de validación.',
  '/v1/regions#warnings': 'Sin parámetros solo avisaría de parámetros desconocidos, que en GraphQL son un error de validación.',
  'SiteInfo.terrainMaskHeightsM': 'Solo lo da /v1/sites (`Site.terrainMaskHeightsM`); el `site` de cada resultado nunca lo lleva.',
};

/** What GraphQL has and v1 does not (arguments as `Type.field(arg.path)`, fields as `Type.field`), with the reason. */
export const GRAPHQL_ONLY: Record<string, string> = {
  'Query.apiVersion': 'La versión sola; en la v1, `apiVersion` de /v1/health (también `health.apiVersion`).',
  'Query.site': 'Elige el sitio de los campos de `Site` (los parámetros site, lat, lon y heightKm de la v1).',
  'Query.compare': 'Composición de /v1/landing-dates para varios sitios en una consulta (cada barrido es el de la v1).',
  'Query.sites(ids)': 'Filtro de la lista del catálogo (en la v1 se filtra en el cliente).',
  'Query.sites(withTerrainMask)': 'Filtro de la lista del catálogo (en la v1 se filtra en el cliente).',
  'Site.slope': 'La pendiente sola: el objeto `slope` de /v1/sun-earth con slope=1, sin calcular el resto.',
  'Slope.note': 'El mismo tipo es la pendiente de un sitio (con nota: `SiteSlope` en la v1) y la de cada resultado de rank o search (sin ella): ahí vale null.',
  'TerrainInput.resolution': 'La v1 por HTTP calcula siempre el relieve preciso; GraphQL deja pedir el rápido (en `search` es `terrainResolution` de la v1).',
};

const valueAt = (a: Args, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o === null || o === undefined ? undefined : (o as Args)[k]), a);

/** One GraphQL argument as the v1 parameter (undefined when not given); `prefix` names it in messages (`landingDates.`). */
function convert(spec: ArgSpec, a: Args, prefix: string): string | undefined {
  if (spec.to === 'switch') {
    const obj = valueAt(a, spec.arg.replace(/\.enabled$/, ''));
    if (obj === null || obj === undefined) return undefined;
    return (obj as { enabled?: boolean }).enabled === false ? '0' : '1';
  }
  const v = valueAt(a, spec.arg);
  if (v === null || v === undefined) return undefined;
  const name = prefix + spec.arg;
  switch (spec.to) {
    case 'flag': return v ? '1' : '0';
    case 'enum': return String(v).replace(/_/g, '-');
    case 'list': return (v as unknown[]).join(',');
    case 'date':
      if (typeof v !== 'string') throw fieldError(`${name} debe ser una fecha ISO 8601 en texto, por ejemplo "2027-01-15T00:00:00Z"`);
      if (v === '') throw fieldError(`${name} no puede estar vacío`);
      return v;
    case 'minutes':
    case 'hours':
      spec.check?.(v as number, name);
      return `${v}${spec.to === 'minutes' ? 'm' : 'h'}`;
    default: return String(v);
  }
}

/** The v1 parameters of a GraphQL field's arguments, and the terrain resolution of the computation. */
export function graphqlToV1(route: string, a: Args, prefix = ''): { params: Params; resolution: Resolution } {
  const op = OPERATIONS[route];
  const params: Params = {};
  for (const [param, spec] of Object.entries(op.params)) params[param] = convert(spec, a, prefix);
  const t = a.terrain as { enabled?: boolean; resolution?: Resolution | null } | null | undefined;
  return { params, resolution: op.resolution && t && t.enabled !== false ? t.resolution ?? 'precise' : 'precise' };
}
