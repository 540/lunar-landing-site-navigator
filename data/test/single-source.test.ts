// One source of truth (#61): the same question asked through /v1, through GraphQL and to the use case directly (as the
// evals do) gives the same numbers, with and without terrain, also for a catalogue site when the server has no DEM
// (its precomputed mask) and for a point with a (synthetic) DEM; and (#71) every operation of v1, with every parameter,
// asked through GraphQL gives the same body. Before #61 each path assembled the engine its own way:
// without a DEM, shackleton-rim had 0 Sun in the ranking and 0.735 in the windows of the same month (fixed in 1.13.0).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { routes } from '../src/v1.ts';
import { ROUTE_PARAMS, RequestContext } from '../src/request.ts';
import { executeRequest, schema } from '../src/graphql/executor.ts';
import { configureDem, llToXY, makeGrid } from '../../backend/src/terrain/dem.ts';
import { configureMasks, loadCatalogMasks } from '../../backend/src/horizon.ts';
import { getSite } from '../../backend/src/sites.ts';
import { sampleVectors } from '../../backend/src/service.ts';
import { resolveTerrain } from '../../backend/src/horizon.ts';
import { SCORE_WEIGHTS, engineTerrain, evaluatePeriod, landingDates, rank, search, sunEarth, visibilityWindows } from '../../backend/src/useCases.ts';
import type { TerrainRequest } from '../../backend/src/useCases.ts';
import type { Site } from '../../backend/src/types.ts';
import type { V1LandingDates, V1Rank, V1Search, V1SunEarth, V1Windows } from '../src/types.ts';
import { getNamedType } from 'graphql';
import type { GraphQLObjectType } from 'graphql';
import { OPERATIONS, SITE_ARGS, V1_ONLY } from '../src/graphql/operations.ts';
import type { Operation } from '../src/graphql/operations.ts';
import { computeResponse } from '../src/app.ts';
import { assertSameAsV1, assertWarnings, selectAll } from './graphql-helpers.ts';

const DAY = 86400e3;
const START = '2027-04-01T00:00:00Z';
const START_MS = Date.parse(START);
const RIM = getSite('shackleton-rim')!;
/** A custom point near the pole, inside the synthetic DEM. */
const POINT: Site = { id: 'custom:-89.3,15', name: 'Coordenadas personalizadas', lat: -89.3, lon: 15, heightKm: 0, custom: true };

const v1 = <T>(path: string): T => {
  const u = new URL(path, 'http://x');
  return routes[u.pathname](u.searchParams, new RequestContext()) as T;
};
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const gql = (query: string): Json => {
  const r = executeRequest({ query });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const body = r.body as { data?: Json; errors?: unknown };
  assert.ok(!body.errors, JSON.stringify(body.errors));
  return JSON.parse(JSON.stringify(body.data)) as Json; // plain objects (graphql-js builds them without a prototype)
};
const siteArg = (s: Site): string => (s.custom ? `lat: ${s.lat}, lon: ${s.lon}` : `id: "${s.id}"`);
const siteParam = (s: Site): string => (s.custom ? `lat=${s.lat}&lon=${s.lon}` : `site=${s.id}`);

/** A rough synthetic DEM around POINT (hills up to ±800 m), so that terrain=1 there uses a DEM mask. */
function syntheticDem() {
  const [cx, cy] = llToXY(POINT.lat, POINT.lon);
  const res = 240, half = 60000, n = Math.round((2 * half) / res), a = new Float32Array(n * n);
  const X0 = cx - half, Y0 = cy + half;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = 800 * Math.sin((X0 + (i + 0.5) * res) / 9000) * Math.cos((Y0 - (j + 0.5) * res) / 7000);
  return makeGrid({ name: 'single-source', res, X0, Y0, w: n, h: n, a });
}

/** Every question, for one site and one terrain choice (null = no terrain). */
function sameEverywhere(site: Site, terrain: TerrainRequest | null, expectSource: 'catalog' | 'dem' | null): void {
  const t = terrain ? '&terrain=1' : '';
  const tg = terrain ? ', terrain: {}' : '';
  const date = '2027-04-15T00:00:00Z';

  // ---- Sun and Earth at an instant
  const se = v1<V1SunEarth>(`/v1/sun-earth?${siteParam(site)}&date=${date}${t}`);
  const seCase = sunEarth({ site, dateMs: Date.parse(date), terrain });
  const seGql = gql(`{ site(${siteArg(site)}) { sunEarth(at: "${date}"${tg}) { sun { visibleFraction elevationDeg horizonElevationDeg nextSet nextRise } earth { visibleFraction horizonElevationDeg } } } }`).site.sunEarth;
  for (const b of ['sun', 'earth'] as const) {
    assert.equal(se[b].visibleFraction, seCase.snapshot.bodies[b].visibleFraction, `sun-earth ${b}`);
    assert.equal(se[b].horizonElevationDeg, seCase.snapshot.bodies[b].horizonElevationDeg);
    assert.equal(seGql[b].visibleFraction, se[b].visibleFraction);
    assert.equal(seGql[b].horizonElevationDeg, se[b].horizonElevationDeg);
  }
  assert.equal(se.sun.nextSet, seCase.snapshot.bodies.sun.nextSet);
  assert.equal(seGql.sun.nextSet, se.sun.nextSet);
  assert.equal(se.terrain?.source ?? null, expectSource);

  // ---- Windows over the month
  const end = '2027-05-01T00:00:00Z';
  const w = v1<V1Windows>(`/v1/windows?${siteParam(site)}&start=${START}&end=${end}${t}`);
  const wCase = visibilityWindows({ site, startMs: START_MS, endMs: Date.parse(end), terrain }).windows;
  const wGql = gql(`{ site(${siteArg(site)}) { windows(from: "${START}", to: "${end}"${tg}) { sun { summary { fractionOfTime totalHours } } earth { summary { fractionOfTime } } sunAndEarth { summary { fractionOfTime } } } } }`).site.windows;
  for (const b of ['sun', 'earth', 'sunAndEarth'] as const) {
    assert.equal(w[b].summary.fractionOfTime, wCase[b].fractionOfTime, `windows ${b}`);
    assert.equal(wGql[b].summary.fractionOfTime, w[b].summary.fractionOfTime);
  }

  // ---- Ranking (one site), the evals' evaluation of the same period and the landing-date sweep of that date
  const r = v1<V1Rank>(`/v1/rank?sites=${site.custom ? `${site.lat}:${site.lon}` : site.id}&start=${START}&days=14${t}`);
  const rCase = rank({ sites: [site], startMs: START_MS, days: 14, terrain }).ranking.top[0];
  const rGql = gql(`{ rank(sites: ["${site.custom ? `${site.lat}:${site.lon}` : site.id}"], from: "${START}", days: 14${tg}) { results { score metrics { meanSunDiskFraction sunTimeFraction earthTimeFraction longestNightHours } } } }`).rank.results[0];
  const res = r.results[0];
  assert.equal(res.score, rCase.score, 'rank score');
  assert.equal(res.metrics.sunTimeFraction, rCase.metrics.sunFraction);
  assert.equal(res.metrics.meanSunDiskFraction, rCase.metrics.energy);
  assert.equal(rGql.score, res.score);
  assert.deepEqual(rGql.metrics, { meanSunDiskFraction: res.metrics.meanSunDiskFraction, sunTimeFraction: res.metrics.sunTimeFraction, earthTimeFraction: res.metrics.earthTimeFraction, longestNightHours: res.metrics.longestNightHours });
  // The evals (evaluatePeriod) with the same mission: same metrics and score as the ranking.
  const ev = evaluatePeriod(site, sampleVectors(START_MS, START_MS + 14 * DAY, 3600e3), {
    mode: 'limb', stepMs: 3600e3, weights: SCORE_WEIGHTS, ...(terrain ? { terrain: resolveTerrain(engineTerrain(terrain), 'precise') } : {}),
  });
  assert.deepEqual(ev.result.metrics, rCase.metrics, 'evals = rank');
  assert.equal(ev.result.score, rCase.score);
  // The sweep date that starts at START is the same mission.
  const ld = v1<V1LandingDates>(`/v1/landing-dates?${siteParam(site)}&start=${START}&end=2027-04-03T00:00:00Z&days=14${t}`);
  const ldCase = landingDates({ site, startMs: START_MS, endMs: Date.parse('2027-04-03T00:00:00Z'), dateStepMs: DAY, missionDays: 14, terrain }).sweep;
  const ldGql = gql(`{ site(${siteArg(site)}) { landingDates(from: "${START}", to: "2027-04-03T00:00:00Z", missionDays: 14${tg}) { dates { date score metrics { sunTimeFraction meanSunDiskFraction } } } } }`).site.landingDates;
  assert.equal(ld.dates![0].score, ldCase.dates[0].score);
  assert.equal(ld.dates![0].score, res.score, 'landing-dates = rank');
  assert.equal(ld.dates![0].metrics.sunTimeFraction, res.metrics.sunTimeFraction);
  assert.deepEqual(ldGql.dates.map((d: Json) => d.score), ld.dates!.map((d) => d.score));
}

describe('una sola fuente de verdad: /v1, GraphQL y el caso de uso dan lo mismo', () => {
  before(() => { configureMasks({ diskCache: false }); });
  after(() => { configureDem({ dir: null }); loadCatalogMasks(null); });

  test('sitio del catálogo sin DEM en el servidor: sin relieve (esfera) y con relieve (máscara del catálogo)', () => {
    configureDem({ grids: [] });
    // Under node --test the real catalogue is not loaded by default: load it from backend/terrain/masks.
    assert.ok(loadCatalogMasks(fileURLToPath(new URL('../../backend/terrain', import.meta.url))) > 0, 'máscaras del catálogo en backend/terrain/masks');
    sameEverywhere(RIM, null, null);
    sameEverywhere(RIM, { observerHeightM: 2 }, 'catalog');
  });

  test('punto con DEM (sintético): sin relieve y con la máscara calculada con el DEM', () => {
    configureDem({ grids: [syntheticDem()] });
    sameEverywhere(POINT, null, null);
    sameEverywhere(POINT, { observerHeightM: 2 }, 'dem');
  });

  test('búsqueda en malla: /v1/search = caso de uso search', () => {
    configureDem({ grids: [syntheticDem()] });
    const q = 'latMin=-89.4&latMax=-89.2&lonMin=0&lonMax=30&spacingKm=4&refineLevels=1&top=3&days=5';
    for (const terrain of [null, { observerHeightM: 2, resolution: 'fast' as const }]) {
      const r = v1<V1Search>(`/v1/search?${q}&start=${START}${terrain ? '&terrain=1' : ''}`);
      const c = search({ region: { latMin: -89.4, latMax: -89.2, lonMin: 0, lonMax: 30 }, spacingKm: 4, refine: 1, top: 3, startMs: START_MS, days: 5, terrain }).grid;
      assert.deepEqual(r.results.map((x) => [x.latDeg, x.lonDeg, x.score]), c.top.map((x) => [x.lat, x.lon, x.score]));
    }
  });
});

// ---------------------------------------------------------------- every operation, by /v1 and by GraphQL (#71)
//
// Each v1 request below is turned into its GraphQL query with the table of src/graphql/operations.ts (the inverse of
// what the resolvers do) and both answers must be the same, field by field, warnings included. Together the requests of
// a route use every one of its parameters: a parameter added to v1 (openapi.yaml) without a request here fails.

/** v1 requests that, together, use every parameter of every route (cheap: no DEM under node --test). */
const PARITY_REQUESTS: readonly string[] = [
  '/v1/health',
  '/v1/sites',
  '/v1/regions',
  '/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&mode=center&terrain=1&observerHeightM=5&panelHeightM=3&antennaHeightM=8&horizonRefine=1&horizonRefineDeg=0.2&earthMinElevationDeg=2&slope=1&slopeBaselineM=200&maxSlopeDeg=10',
  '/v1/sun-earth?lat=-89.5&lon=0&heightKm=1&date=2027-01-15&terrain=0&panelHeightM=4',
  '/v1/windows?site=im1&start=2027-01-01&end=2027-01-10&mode=full&events=1&nightMinSunFraction=0.5&fullNight=1&battery=1&survivalLoadW=50&batteryWhPerKg=250&batteryDoD=0.8&slope=1&slopeBaselineM=100&maxSlopeDeg=10&earthMinElevationDeg=1&terrain=1&observerHeightM=2&panelHeightM=3&antennaHeightM=4&horizonRefine=0&horizonRefineDeg=0.1',
  '/v1/windows?lat=-65.31485&lon=-3.05572&heightKm=0.5&start=2027-01-24&end=2027-02-07&battery=0&survivalLoadW=10',
  '/v1/track?site=im1&start=2027-01-01&end=2027-01-03&step=30m&terrain=1&observerHeightM=3&panelHeightM=4&antennaHeightM=5&horizonRefine=0&horizonRefineDeg=0.1',
  '/v1/track?lat=-80&lon=10&heightKm=0.3&start=2027-01-01&end=2027-01-02&step=2h',
  '/v1/horizon?site=shackleton-rim&observerHeightM=10',
  '/v1/horizon?site=shackleton-rim&observerHeightM=10&relief=1&reliefRadiusKm=5',
  '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-01-10&terrain=1&nightMinSunFraction=0.5&fullNight=1&horizonBandDeg=0.3',
  '/v1/windows?site=apollo11&start=2027-01-01&end=2027-01-05&dsn=1',
  '/v1/horizon?lat=-89&lon=20&heightKm=1',
  '/v1/light-map?site=shackleton-rim&radiusKm=2&spacingKm=1&start=2027-01-01&days=2&mode=full&observerHeightM=3&panelHeightM=4&antennaHeightM=5',
  '/v1/light-map?lat=-89&lon=10&heightKm=0.2&radiusKm=1&spacingKm=0.5&days=1&start=2027-03-01',
  '/v1/best-landings?sites=im1,shackleton-rim,im1&start=2027-01-01&end=2027-01-10&days=5&batteryHours=24&minEarthPct=50&maxEarthGapHours=48&priority=comms&mode=limb&terrain=1&observerHeightM=2&panelHeightM=3&antennaHeightM=4&horizonRefine=0&horizonRefineDeg=0.1',
  '/v1/rank?sites=im1,apollo11&start=2027-01-01&days=5&mode=center&earthMode=full&step=30m&terrain=1&observerHeightM=2&panelHeightM=3&antennaHeightM=4&horizonRefine=1&horizonRefineDeg=0.2'
    + '&nightMinSunFraction=0.3&fullNight=1&battery=1&survivalLoadW=50&batteryWhPerKg=250&batteryDoD=0.8&panel=vertical-rotating&slope=1&slopeBaselineM=200&maxSlopeDeg=10&slopeUncertified=keep'
    + '&weightMeanSunDiskFraction=1&weightEarthTimeFraction=1&weightSunAndEarthTimeFraction=1&weightShortNights=1&weightSunTimeFraction=1&weightShortEarthOutages=1&weightLongestSunAndEarth=1'
    + '&minMeanSunDiskFraction=0.5&minSunTimeFraction=0.5&minEarthTimeFraction=0.5&minSunAndEarthTimeFraction=0.2&maxLongestNightHours=100&maxLongestEarthOutageHours=100&minLongestSunAndEarthHours=10&maxBatteryKg=300&earthMinElevationDeg=2',
  '/v1/landing-dates?site=im1&start=2027-01-01&end=2027-01-05&dateStep=48h&days=3&mode=center&earthMode=limb&terrain=1&observerHeightM=2&panelHeightM=3&antennaHeightM=4&horizonRefine=1&horizonRefineDeg=0.2'
    + '&nightMinSunFraction=0.3&fullNight=1&battery=1&survivalLoadW=50&batteryWhPerKg=250&batteryDoD=0.8&panel=horizontal&slope=1&slopeBaselineM=200&maxSlopeDeg=10'
    + '&weightMeanSunDiskFraction=1&weightEarthTimeFraction=2&weightSunAndEarthTimeFraction=1&weightShortNights=1&weightSunTimeFraction=1&weightShortEarthOutages=1&weightLongestSunAndEarth=1'
    + '&minMeanSunDiskFraction=0.5&minSunTimeFraction=0.5&minEarthTimeFraction=0.5&minSunAndEarthTimeFraction=0.2&maxLongestNightHours=100&maxLongestEarthOutageHours=100&minLongestSunAndEarthHours=10&maxBatteryKg=300'
    + '&earthMinElevationDeg=2&minScore=10&top=2',
  '/v1/landing-dates?lat=-65.31485&lon=-3.05572&heightKm=0.4&start=2027-01-01&end=2027-01-03&days=2',
  '/v1/search?region=polo-sur&latMin=-89.4&latMax=-89.2&lonMin=0&lonMax=30&spacingKm=4&refineLevels=1&refineTop=2&top=3&minSeparationKm=1&start=2027-04-01&days=3&mode=center&earthMode=full&step=60m&cells=1'
    + '&terrain=1&terrainResolution=fast&observerHeightM=2&panelHeightM=3&antennaHeightM=4&horizonRefine=1&horizonRefineDeg=0.2&nightMinSunFraction=0.3&fullNight=1&battery=1&survivalLoadW=50&batteryWhPerKg=250&batteryDoD=0.8'
    + '&panel=vertical-rotating&slope=1&slopeBaselineM=200&maxSlopeDeg=10&slopeUncertified=keep'
    + '&weightMeanSunDiskFraction=1&weightEarthTimeFraction=1&weightSunAndEarthTimeFraction=1&weightShortNights=1&weightSunTimeFraction=1&weightShortEarthOutages=1&weightLongestSunAndEarth=1&earthMinElevationDeg=2',
  '/v1/search?region=casquete-sur&spacingKm=200&refineLevels=0&days=2&start=2027-01-01&terrainResolution=precise',
];

/** A GraphQL enum value in a literal (not quoted). */
class EnumValue { declare readonly value: string; constructor(value: string) { this.value = value; } }
type Literal = string | number | boolean | EnumValue | Literal[] | { [k: string]: Literal };
const literal = (x: Literal): string => (x instanceof EnumValue ? x.value : Array.isArray(x) ? `[${x.map(literal).join(', ')}]`
  : typeof x === 'object' ? `{ ${Object.entries(x).map(([k, v]) => `${k}: ${literal(v)}`).join(', ')} }` : JSON.stringify(x));

/** A v1 duration (30m, 2h, 1d) in minutes or hours. */
function duration(v: string, unit: 'minutes' | 'hours'): number {
  const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(v);
  assert.ok(m, `duración que este test no sabe traducir: ${v}`);
  const minutes = Number(m[1]) * { m: 1, h: 60, d: 1440 }[m[2] as 'm' | 'h' | 'd'];
  return unit === 'minutes' ? minutes : minutes / 60;
}

/** The GraphQL query of a v1 request, built from the table (operations.ts), and the path of its answer in `data`. */
function graphqlOf(url: string): { query: string; path: string[]; route: string; op: Operation } {
  const u = new URL(url, 'http://x');
  const route = u.pathname, op = OPERATIONS[route];
  assert.ok(op, `${route} no tiene operación de GraphQL`);
  const args: Record<string, Literal> = {}, siteArgs: Record<string, Literal> = {};
  const set = (path: string, value: Literal | ((old: Literal | undefined) => Literal)): void => {
    const keys = path.split('.');
    let o = args as Record<string, Literal>;
    for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Record<string, Literal>;
    const last = keys[keys.length - 1];
    o[last] = typeof value === 'function' ? value(o[last]) : value;
  };
  for (const [param, v] of u.searchParams) {
    if (op.site && SITE_ARGS[param]) { siteArgs[SITE_ARGS[param]] = param === 'site' ? v : Number(v); continue; }
    const spec = op.params[param];
    assert.ok(spec, `${route}?${param}: sin argumento de GraphQL en operations.ts`);
    const on = v === '1' || v === 'true';
    switch (spec.to) {
      case 'switch': {
        const obj = spec.arg.replace(/\.enabled$/, '');
        set(obj, (old) => (on ? (old ?? {}) : { ...(old as object ?? {}), enabled: false }));
        break;
      }
      case 'flag': set(spec.arg, on); break;
      case 'num': set(spec.arg, Number(v)); break;
      case 'enum': set(spec.arg, new EnumValue(v.replace(/-/g, '_'))); break;
      case 'list': set(spec.arg, v.split(',')); break;
      case 'minutes': case 'hours': set(spec.arg, duration(v, spec.to)); break;
      default: set(spec.arg, v);
    }
  }
  for (const [param, spec] of Object.entries(op.params)) {
    if (spec.offUnlessGiven && !u.searchParams.has(param) && args[spec.arg]) set(spec.arg, (old) => ({ ...(old as object), enabled: false }));
  }
  const [type, name] = op.field.split('.');
  const fieldType = getNamedType((schema.getType(type) as GraphQLObjectType).getFields()[name].type);
  const call = `${name}${Object.keys(args).length ? `(${Object.entries(args).map(([k, x]) => `${k}: ${literal(x)}`).join(', ')})` : ''} { ${selectAll(fieldType.name)} }`;
  if (!op.site) return { query: `{ ${call} }`, path: [name], route, op };
  const site = `site(${Object.entries(siteArgs).map(([k, x]) => `${k}: ${literal(x)}`).join(', ')})`;
  return { query: `{ ${site} { ${call} } }`, path: ['site', name], route, op };
}

describe('cada operación: la misma pregunta por /v1 y por GraphQL da lo mismo (#71)', () => {
  // The catalogue masks (real, in git) give terrain to the catalogue sites, so the warnings that need it (such as
  // deep_polar_uncertainty at shackleton-rim, #437) are compared too.
  before(() => {
    configureMasks({ diskCache: false }); configureDem({ grids: [] });
    loadCatalogMasks(fileURLToPath(new URL('../../backend/terrain', import.meta.url)));
  });
  after(() => { loadCatalogMasks(null); });

  test('alguna petición de prueba provoca deep_polar_uncertainty (#437)', () => {
    const codes = new Set(PARITY_REQUESTS.flatMap((url) => {
      const body = JSON.parse(String(computeResponse({ method: 'GET', url }).body)) as { warnings?: { code: string }[] };
      return (body.warnings ?? []).map((w) => w.code);
    }));
    assert.ok(codes.has('deep_polar_uncertainty'), 'ninguna petición de PARITY_REQUESTS provoca deep_polar_uncertainty');
  });

  test('las peticiones de prueba usan todos los parámetros de cada ruta', () => {
    const used = new Map<string, Set<string>>();
    for (const url of PARITY_REQUESTS) {
      const u = new URL(url, 'http://x');
      const s = used.get(u.pathname) ?? new Set<string>();
      for (const k of u.searchParams.keys()) s.add(k);
      used.set(u.pathname, s);
    }
    const missing = Object.entries(ROUTE_PARAMS).flatMap(([route, params]) => [
      ...(used.has(route) ? [] : [`${route} (ninguna petición)`]),
      ...params.filter((p) => !used.get(route)?.has(p) && !V1_ONLY[`${route}?${p}`]).map((p) => `${route}?${p}`),
    ]);
    assert.deepEqual(missing, [], `Añade a PARITY_REQUESTS (test/single-source.test.ts) peticiones que usen:\n  - ${missing.join('\n  - ')}`);
  });

  for (const url of PARITY_REQUESTS) {
    test(url.length > 90 ? `${url.slice(0, 90)}…` : url, () => {
      const { query, path, route, op } = graphqlOf(url);
      const res = computeResponse({ method: 'GET', url });
      assert.equal(res.status, 200, String(res.body));
      const v1Body = JSON.parse(String(res.body)) as Json;
      let g = path.reduce((o: Json, k) => o[k], gql(query));
      let v = op.list ? v1Body[op.list] : v1Body;
      if (route === '/v1/health') { g = { ...g, uptimeSeconds: 0 }; v = { ...v, uptimeSeconds: 0 }; }
      assertSameAsV1(g, v);
      if (!op.list) assertWarnings(g.warnings, v1Body, route);
    });
  }
});
