// GraphQL API (since 1.11.0), without terrain: the same values as v1 field by field, the HTTP side (GET, POST,
// persisted queries, cache, CORS, explorer, schema), the limits and the errors. With terrain: graphql-terrain.test.ts.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildSchema, getIntrospectionQuery } from 'graphql';
import { createApp } from '../src/server.ts';
import { API_VERSION } from '../src/v1.ts';
import { EXAMPLES } from '../src/graphql/examples.ts';
import { executeRequest } from '../src/graphql/executor.ts';
import { graphqlConfig } from '../src/graphql/limits.ts';
import { assertSameAsV1, assertWarnings, gqlData, gqlPost, selectAll, v1Get } from './graphql-helpers.ts';

const listen = async (server: http.Server): Promise<string> => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

let server: http.Server, base: string;
before(async () => { server = createApp(); base = await listen(server); });
after(() => new Promise<void>((r) => server.close(() => r())));

type J = Record<string, never> & Record<string, unknown>;
const at = (data: unknown, ...path: (string | number)[]): never => path.reduce((o: any, k) => o[k], data) as never;

/** A GraphQL field and the v1 request that must give the same values. */
interface Case { name: string; v1: string; route: string; query: string; path: (string | number)[] }

const SE = selectAll('SunEarth'), WI = selectAll('Windows'), TR = selectAll('Track'), HO = selectAll('Horizon'), RK = selectAll('Rank'), LD = selectAll('LandingDates');
const BL = selectAll('BestLandings'), LM = selectAll('LightMap');

const CASES: Case[] = [
  {
    name: 'sunEarth de un sitio del catálogo (con aviso de Luna lisa)', route: '/v1/sun-earth',
    v1: '/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z',
    query: `{ site(id: "shackleton-rim") { sunEarth(at: "2027-01-15T00:00:00Z") { ${SE} } } }`, path: ['site', 'sunEarth'],
  },
  {
    name: 'sunEarth de unas coordenadas, mode=center, earthMinElevationDeg y heightKm', route: '/v1/sun-earth',
    v1: '/v1/sun-earth?lat=-89.5&lon=0&heightKm=1&date=2027-01-15&mode=center&earthMinElevationDeg=5',
    query: `{ site(lat: -89.5, lon: 0, heightKm: 1) { sunEarth(at: "2027-01-15", mode: center, earthMinElevationDeg: 5) { ${SE} } } }`, path: ['site', 'sunEarth'],
  },
  {
    name: 'sunEarth con terrain pedido en un servidor sin DEM', route: '/v1/sun-earth',
    v1: '/v1/sun-earth?site=apollo11&date=2027-06-01T12:00:00Z&terrain=1&observerHeightM=5',
    query: `{ site(id: "apollo11") { sunEarth(at: "2027-06-01T12:00:00Z", terrain: { observerHeightM: 5 }) { ${SE} } } }`, path: ['site', 'sunEarth'],
  },
  {
    name: 'sunEarth con terrain desactivado y alturas (avisos de parámetros ignorados)', route: '/v1/sun-earth',
    v1: '/v1/sun-earth?site=apollo11&date=2027-06-01&terrain=0&panelHeightM=5',
    query: `{ site(id: "apollo11") { sunEarth(at: "2027-06-01", terrain: { enabled: false, panelHeightM: 5 }) { ${SE} } } }`, path: ['site', 'sunEarth'],
  },
  {
    name: 'windows con noche real y batería', route: '/v1/windows',
    v1: '/v1/windows?lat=-65.31485&lon=-3.05572&start=2027-01-24&end=2027-02-07&fullNight=1&battery=1',
    query: `{ site(lat: -65.31485, lon: -3.05572) { windows(from: "2027-01-24", to: "2027-02-07", night: { fullNight: true }, battery: {}) { ${WI} } } }`, path: ['site', 'windows'],
  },
  {
    name: 'windows con mode, noche parcial y batería a medida', route: '/v1/windows',
    v1: '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&mode=full&nightMinSunFraction=0.5&survivalLoadW=50&batteryWhPerKg=250&batteryDoD=0.8&earthMinElevationDeg=2',
    query: `{ site(id: "shackleton-rim") { windows(from: "2027-01-01", to: "2027-03-01", mode: full, night: { minSunFraction: 0.5 }, battery: { survivalLoadW: 50, whPerKg: 250, depthOfDischarge: 0.8 }, earthMinElevationDeg: 2) { ${WI} } } }`,
    path: ['site', 'windows'],
  },
  {
    name: 'track', route: '/v1/track',
    v1: '/v1/track?site=im1&start=2027-01-01&end=2027-01-03&step=30m',
    query: `{ site(id: "im1") { track(from: "2027-01-01", to: "2027-01-03", stepMinutes: 30) { ${TR} } } }`, path: ['site', 'track'],
  },
  {
    name: 'horizon (sin DEM: esfera)', route: '/v1/horizon',
    v1: '/v1/horizon?site=shackleton-rim&observerHeightM=10',
    query: `{ site(id: "shackleton-rim") { horizon(heightM: 10) { ${HO} } } }`, path: ['site', 'horizon'],
  },
  {
    name: 'rank de todo el catálogo', route: '/v1/rank',
    v1: '/v1/rank?sites=all&start=2027-01-01&days=30',
    query: `{ rank(from: "2027-01-01", days: 30) { ${RK} } }`, path: ['rank'],
  },
  {
    name: 'rank con pesos, restricciones y elevación mínima de la Tierra', route: '/v1/rank',
    v1: '/v1/rank?sites=im1,apollo11,chandrayaan3&start=2027-01-01&days=14&weightMeanSunDiskFraction=1&weightEarthTimeFraction=1&minEarthTimeFraction=0.9&maxLongestNightHours=200&earthMinElevationDeg=3',
    query: `{ rank(sites: ["im1", "apollo11", "chandrayaan3"], from: "2027-01-01", days: 14, scoring: { meanSunDiskFraction: 1, earthTimeFraction: 1 }, constraints: { minEarthTimeFraction: 0.9, maxLongestNightHours: 200 }, earthMinElevationDeg: 3) { ${RK} } }`,
    path: ['rank'],
  },
  {
    name: 'rank con panel, noche real, batería y sitio repetido', route: '/v1/rank',
    v1: '/v1/rank?sites=shackleton-rim,im1,im1&start=2027-01-24&days=14&panel=vertical-rotating&fullNight=1&battery=1&maxBatteryKg=300',
    query: `{ rank(sites: ["shackleton-rim", "im1", "im1"], from: "2027-01-24", days: 14, panel: vertical_rotating, night: { fullNight: true }, battery: { enabled: true }, constraints: { maxBatteryKg: 300 }) { ${RK} } }`,
    path: ['rank'],
  },
  {
    name: 'rank con pendiente máxima (sin DEM: excluidos por pendiente desconocida)', route: '/v1/rank',
    v1: '/v1/rank?sites=-65.31485:-3.05572,apollo11&start=2027-03-01&days=14&mode=full&slopeBaselineM=200&maxSlopeDeg=10',
    query: `{ rank(sites: ["-65.31485:-3.05572", "apollo11"], from: "2027-03-01", days: 14, mode: full, slope: { baselineM: 200, maxSlopeDeg: 10 }) { ${RK} } }`,
    path: ['rank'],
  },
  {
    name: 'landingDates básico', route: '/v1/landing-dates',
    v1: '/v1/landing-dates?site=im1&start=2027-01-01&end=2027-01-15',
    query: `{ site(id: "im1") { landingDates(from: "2027-01-01", to: "2027-01-15") { ${LD} } } }`, path: ['site', 'landingDates'],
  },
  {
    name: 'landingDates con noche real, batería, panel y paso de 2 días', route: '/v1/landing-dates',
    v1: '/v1/landing-dates?lat=-65.31485&lon=-3.05572&start=2027-01-01&end=2027-02-01&dateStep=48h&days=10&fullNight=1&battery=1&panel=vertical-rotating',
    query: `{ site(lat: -65.31485, lon: -3.05572) { landingDates(from: "2027-01-01", to: "2027-02-01", dateStepHours: 48, missionDays: 10, night: { fullNight: true }, battery: {}, panel: vertical_rotating) { ${LD} } } }`,
    path: ['site', 'landingDates'],
  },
  {
    name: 'landingDates con restricciones, pesos, minScore y top', route: '/v1/landing-dates',
    v1: '/v1/landing-dates?site=apollo11&start=2027-01-01&end=2027-01-20&dateStep=48h&minMeanSunDiskFraction=0.5&maxLongestNightHours=100&weightMeanSunDiskFraction=1&weightEarthTimeFraction=0&minScore=40&top=3',
    query: `{ site(id: "apollo11") { landingDates(from: "2027-01-01", to: "2027-01-20", dateStepHours: 48, constraints: { minMeanSunDiskFraction: 0.5, maxLongestNightHours: 100 }, scoring: { meanSunDiskFraction: 1, earthTimeFraction: 0 }, minScore: 40, top: 3) { ${LD} } } }`,
    path: ['site', 'landingDates'],
  },
  {
    name: 'landingDates fuera de las fechas validadas (aviso)', route: '/v1/landing-dates',
    v1: '/v1/landing-dates?site=im1&start=2031-03-01&end=2031-03-05&days=3',
    query: `{ site(id: "im1") { landingDates(from: "2031-03-01", to: "2031-03-05", missionDays: 3) { ${LD} } } }`, path: ['site', 'landingDates'],
  },
  {
    name: 'bestLandings con los valores por defecto de la misión', route: '/v1/best-landings',
    v1: '/v1/best-landings?sites=shackleton-rim,im1,-89.5:0&start=2027-10-01&end=2027-10-05&days=5',
    query: `{ bestLandings(sites: ["shackleton-rim", "im1", "-89.5:0"], from: "2027-10-01", to: "2027-10-05", missionDays: 5) { ${BL} } }`, path: ['bestLandings'],
  },
  {
    name: 'bestLandings con todos los requisitos, prioridad, mode y sitio repetido', route: '/v1/best-landings',
    v1: '/v1/best-landings?sites=shackleton-rim,im1,im1,apollo11&start=2027-10-01T00:00:00Z&end=2027-10-03T00:00:00Z&days=3&batteryHours=24&minEarthPct=40&maxEarthGapHours=48&priority=delays&mode=limb',
    query: `{ bestLandings(sites: ["shackleton-rim", "im1", "im1", "apollo11"], from: "2027-10-01T00:00:00Z", to: "2027-10-03T00:00:00Z", missionDays: 3, batteryHours: 24, minEarthPct: 40, maxEarthGapHours: 48, priority: delays, mode: limb) { ${BL} } }`,
    path: ['bestLandings'],
  },
  {
    name: 'bestLandings con relieve pedido en un servidor sin DEM', route: '/v1/best-landings',
    v1: '/v1/best-landings?sites=apollo11,-89.5:0&start=2027-01-01&end=2027-01-20&priority=comms&terrain=1&observerHeightM=5',
    query: `{ bestLandings(sites: ["apollo11", "-89.5:0"], from: "2027-01-01", to: "2027-01-20", priority: comms, terrain: { observerHeightM: 5 }) { ${BL} } }`, path: ['bestLandings'],
  },
  {
    name: 'lightMap alrededor del polo sur (centro por defecto)', route: '/v1/light-map',
    v1: '/v1/light-map?radiusKm=20&spacingKm=10&start=2027-10-11T12:00:00Z&days=2',
    query: `{ lightMap(radiusKm: 20, spacingKm: 10, from: "2027-10-11T12:00:00Z", days: 2) { ${LM} } }`, path: ['lightMap'],
  },
  {
    name: 'lightMap de un sitio del catálogo, mode y alturas', route: '/v1/light-map',
    v1: '/v1/light-map?site=shackleton-rim&radiusKm=2&spacingKm=1&start=2027-10-11&days=1&mode=full&observerHeightM=10&panelHeightM=20',
    query: `{ lightMap(site: "shackleton-rim", radiusKm: 2, spacingKm: 1, from: "2027-10-11", days: 1, mode: full, observerHeightM: 10, panelHeightM: 20) { ${LM} } }`, path: ['lightMap'],
  },
  {
    name: 'lightMap de unas coordenadas con avisos (fechas fuera de lo validado, observador a 0 m)', route: '/v1/light-map',
    v1: '/v1/light-map?lat=-85&lon=30&radiusKm=3&spacingKm=1.5&start=2031-03-01&days=1&observerHeightM=0',
    query: `{ lightMap(lat: -85, lon: 30, radiusKm: 3, spacingKm: 1.5, from: "2031-03-01", days: 1, observerHeightM: 0) { ${LM} } }`, path: ['lightMap'],
  },
];

describe('GraphQL da los mismos valores que la v1 (sin relieve)', () => {
  for (const c of CASES) {
    test(c.name, async () => {
      const [v1, data] = await Promise.all([v1Get<Record<string, never>>(base, c.v1), gqlData(base, c.query)]);
      const g = at(data, ...c.path) as Record<string, never>;
      assertSameAsV1(g, v1);
      assertWarnings(g.warnings, v1, c.route);
    });
  }

  test('sites: el catálogo de /v1/sites, filtrado por ids y por máscara', async () => {
    const plain = 'id name region program latDeg lonDeg heightKm coordinatesVerified custom horizonModel terrainMaskHeightsM';
    const [v1, data] = await Promise.all([v1Get<{ sites: never[] }>(base, '/v1/sites'), gqlData(base, `{ sites { ${plain} } some: sites(ids: ["im1", "apollo11"]) { id } masked: sites(withTerrainMask: true) { id } }`)]);
    assertSameAsV1(data.sites as never, v1.sites);
    assert.deepEqual(data.some, [{ id: 'im1' }, { id: 'apollo11' }]);
    assert.deepEqual(data.masked, [], 'bajo node --test no hay máscaras de catálogo');
  });

  test('Site.slope = el objeto slope de /v1/sun-earth con slope=1 (sin DEM: nulos)', async () => {
    const v1 = await v1Get<{ slope: never }>(base, '/v1/sun-earth?site=im1&date=2027-01-15&slopeBaselineM=200&maxSlopeDeg=8');
    const data = await gqlData(base, `{ site(id: "im1") { slope(baselineM: 200, maxSlopeDeg: 8) { ${selectAll('Slope')} } } }`);
    assertSameAsV1(at(data, 'site', 'slope'), v1.slope);
  });

  test('compare: el barrido de cada sitio es el de /v1/landing-dates y la matriz sale de sus fechas', async () => {
    const opts = 'from: "2027-01-01", to: "2027-01-31", dateStepHours: 72, missionDays: 7, constraints: { minEarthTimeFraction: 0.9 }';
    const data = await gqlData(base, `{ compare(sites: ["im1", "-89.5:0", "apollo11"], landingDates: { ${opts} }) {
      siteCount dateCount cellCount warnings { code message }
      sites { site { id } landingDates { ${LD} } }
      matrix { date bestSiteId cells { siteId score meetsConstraints violatedConstraints sunVisibleAtLanding hoursToSunChange metrics { ${selectAll('Metrics')} } } }
      ranking { rank siteId name bestDate bestScore meanScore goodFraction meetsConstraintsFraction } } }`);
    const cmp = data.compare as any;
    const v1s = await Promise.all(['site=im1', 'lat=-89.5&lon=0', 'site=apollo11'].map((s) =>
      v1Get<any>(base, `/v1/landing-dates?${s}&start=2027-01-01&end=2027-01-31&dateStep=72h&days=7&minEarthTimeFraction=0.9`)));
    assert.deepEqual([cmp.siteCount, cmp.dateCount, cmp.cellCount], [3, 11, 33]);
    v1s.forEach((v1, i) => {
      assertSameAsV1(cmp.sites[i].landingDates, v1);
      assertWarnings(cmp.sites[i].landingDates.warnings, v1, '/v1/landing-dates', 'landingDates.');
    });
    cmp.matrix.forEach((row: any, d: number) => {
      row.cells.forEach((cell: any, i: number) => {
        const { date: _d, ...v1date } = v1s[i].dates[d];
        assertSameAsV1({ ...cell, siteId: undefined, rank: null }, { ...v1date, siteId: undefined } as never, `matrix[${d}][${i}]`);
      });
      const best = Math.max(...row.cells.map((c: any) => c.score));
      assert.equal(row.bestSiteId, row.cells.find((c: any) => c.score === best).siteId);
    });
    assert.deepEqual(cmp.ranking.map((r: any) => r.bestScore), [...cmp.ranking.map((r: any) => r.bestScore)].sort((a: number, b: number) => b - a));
    const im1 = cmp.ranking.find((r: any) => r.siteId === 'im1');
    assert.deepEqual([im1.bestDate, im1.bestScore, im1.meanScore], [v1s[0].best[0].date, v1s[0].best[0].score, v1s[0].stats.score.mean]);
  });

  test('una misma petición calcula una vez lo que se repite (memo por petición y efemérides compartidas)', () => {
    const q = `{ a: site(id: "im1") { landingDates(from: "2027-01-01", to: "2027-03-01") { stats { dateCount } } }
      b: site(id: "im1") { landingDates(from: "2027-01-01", to: "2027-03-01") { best { date } } }
      compare(sites: ["im1", "apollo11"], landingDates: { from: "2027-01-01", to: "2027-03-01" }) { siteCount } }`;
    const r = executeRequest({ query: q });
    assert.equal(r.body.errors, undefined);
    const computed = (r.body.extensions as any).computed;
    assert.equal(computed.routeCalls, 2, 'im1 y apollo11: dos barridos');
    assert.equal(computed.memoHits, 2, 'el segundo alias y compare reutilizan el barrido de im1');
    assert.ok(computed.ephemerisReused > computed.ephemerisSamples * 0.9, `apollo11 reutiliza las efemérides de im1 (${JSON.stringify(computed)})`);
  });
});

describe('HTTP de /graphql', () => {
  test('GET con query: igual que POST, con ETag, 304 y caché pública si todas las fechas son explícitas', async () => {
    const query = '{ site(id: "im1") { sunEarth(at: "2027-01-15T00:00:00Z") { sun { elevationDeg } } } }';
    const res = await fetch(`${base}/graphql?query=${encodeURIComponent(query)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('x-lunar-graphql-uncacheable'), null);
    const body = await res.json();
    assert.deepEqual(body, (await gqlPost(base, query)).body);
    const again = await fetch(`${base}/graphql?query=${encodeURIComponent(query)}`, { headers: { 'if-none-match': res.headers.get('etag')! } });
    assert.equal(again.status, 304);
    // «now» (no date): revalidated; errors: not stored as a public copy.
    const now = await fetch(`${base}/graphql?query=${encodeURIComponent('{ site(id: "im1") { sunEarth { date } } }')}`);
    assert.equal(now.headers.get('cache-control'), 'no-cache');
    const err = await fetch(`${base}/graphql?query=${encodeURIComponent('{ site(id: "nada") { name } }')}`);
    assert.equal(err.status, 200);
    assert.equal(err.headers.get('cache-control'), 'no-cache');
  });

  test('GET con variables y operationName; comprimida con Accept-Encoding', async () => {
    const ex = EXAMPLES[0];
    const url = `${base}/graphql?query=${encodeURIComponent(ex.query)}&variables=${encodeURIComponent(JSON.stringify(ex.variables))}&operationName=FichaSitio`;
    const res = await fetch(url, { headers: { 'accept-encoding': 'br' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-encoding'), 'br');
    const body = await res.json() as any;
    assert.equal(body.data.site.name, 'Cresta de conexión de Shackleton');
  });

  test('consultas persistidas (APQ): por hash, las de ejemplo desde el principio y las demás tras registrarlas', async () => {
    const hash = (q: string): string => createHash('sha256').update(q).digest('hex');
    const ext = (h: string): string => encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: h } }));
    const ex = EXAMPLES[1];
    const known = await fetch(`${base}/graphql?extensions=${ext(hash(ex.query))}`);
    assert.equal(known.status, 200);
    assert.equal(((await known.json()) as any).data.compare.siteCount, 3);
    const q = '{ apiVersion }';
    const miss = await fetch(`${base}/graphql?extensions=${ext(hash(q))}`);
    assert.equal(miss.status, 400);
    assert.equal(((await miss.json()) as any).errors[0].extensions.code, 'PERSISTED_QUERY_NOT_FOUND');
    const reg = await fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, extensions: { persistedQuery: { version: 1, sha256Hash: hash(q) } } }) });
    assert.deepEqual(((await reg.json()) as any).data, { apiVersion: API_VERSION });
    const hit = await fetch(`${base}/graphql?extensions=${ext(hash(q))}`);
    assert.deepEqual(((await hit.json()) as any).data, { apiVersion: API_VERSION });
    const wrong = await gqlPost(base, '{ apiVersion }');
    assert.equal(wrong.status, 200);
    const mismatch = await fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, extensions: { persistedQuery: { version: 1, sha256Hash: hash('otra') } } }) });
    assert.equal(((await mismatch.json()) as any).errors[0].extensions.code, 'persisted_query_hash_mismatch');
  });

  test('explorador GraphiQL en el navegador, con los ejemplos y versiones exactas de un CDN permitido', async () => {
    const res = await fetch(`${base}/graphql`, { headers: { accept: 'text/html,application/xhtml+xml' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type')!, /^text\/html/);
    const html = await res.text();
    for (const src of html.match(/https:\/\/[^"]+/g)!) assert.match(src, /^https:\/\/unpkg\.com\/(graphiql|react|react-dom)@\d+\.\d+\.\d+\//, src);
    assert.equal((html.match(/integrity="sha384-/g) ?? []).length, 4, 'SRI en los cuatro recursos');
    for (const e of EXAMPLES) assert.ok(html.includes(JSON.stringify(e.query).slice(1, 40)), e.name);
    assert.ok(html.includes('Comparar sitios y fechas') && html.includes('Barrido de fechas (solo resumen)') && html.includes('Ficha de un sitio'));
    const noHtml = await fetch(`${base}/graphql`);
    assert.equal(noHtml.status, 400);
    assert.equal(((await noHtml.json()) as any).errors[0].extensions.code, 'bad_request');
  });

  test('esquema publicado en /graphql/schema.graphql (el mismo que ejecuta el servidor)', async () => {
    const res = await fetch(`${base}/graphql/schema.graphql`);
    assert.equal(res.status, 200);
    const sdl = await res.text();
    assert.equal(sdl, readFileSync(new URL('../src/graphql/schema.graphql', import.meta.url), 'utf8'));
    const s = buildSchema(sdl);
    for (const t of ['TerrainInput', 'ScoringInput', 'ConstraintsInput', 'NightInput', 'BatteryInput', 'PanelOrientation', 'Comparison']) assert.ok(s.getType(t), t);
  });

  test('introspección permitida; CORS con POST en el preflight de /graphql y v1 sigue siendo GET', async () => {
    const intro = await gqlPost(base, getIntrospectionQuery());
    assert.equal(intro.status, 200);
    assert.ok((intro.body.data as any).__schema.types.length > 30);
    const pre = await fetch(`${base}/graphql`, { method: 'OPTIONS', headers: { origin: 'https://example.org', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get('access-control-allow-methods')!, /POST/);
    assert.match(pre.headers.get('access-control-allow-headers')!, /content-type/);
    const v1pre = await fetch(`${base}/v1/rank`, { method: 'OPTIONS' });
    assert.equal(v1pre.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
    assert.equal((await fetch(`${base}/v1/rank`, { method: 'POST' })).status, 405);
  });

  test('errores HTTP con código: método, tipo de contenido, JSON, cuerpo demasiado grande', async () => {
    const put = await fetch(`${base}/graphql`, { method: 'PUT' });
    assert.equal(put.status, 405);
    assert.equal(put.headers.get('allow'), 'GET, POST, OPTIONS');
    const text = await fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{ apiVersion }' });
    assert.equal(text.status, 415);
    const bad = await fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":' });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as any).errors[0].extensions.code, 'bad_request');
    const big = await fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: `{ apiVersion } #${'x'.repeat(70000)}` }) });
    assert.equal(big.status, 413);
    assert.equal(((await big.json()) as any).errors[0].extensions.code, 'payload_too_large');
  });
});

describe('errores en español con código', () => {
  const errorOf = async (query: string): Promise<{ status: number; message: string; code: string; path?: unknown }> => {
    const r = await gqlPost(base, query);
    const e = r.body.errors![0];
    return { status: r.status, message: e.message, code: e.extensions.code, path: e.path };
  };

  test('sintaxis, campos y argumentos desconocidos, enums', async () => {
    assert.deepEqual(await errorOf('{ site'), { status: 400, message: 'Error de sintaxis: se esperaba Name y se encontró <EOF>.', code: 'syntax_error', path: undefined });
    const f = await errorOf('{ site(id: "im1") { nombre } }');
    assert.equal(f.code, 'validation_failed');
    assert.match(f.message, /^El campo «nombre» no existe en el tipo Site\./);
    const a = await errorOf('{ site(id: "im1") { sunEarth(fecha: "2027-01-01") { date } } }');
    assert.match(a.message, /^El argumento «fecha» no existe en el campo Site\.sunEarth\./);
    const e = await errorOf('{ site(id: "im1") { sunEarth(mode: lim) { date } } }');
    assert.equal(e.message, 'El valor «lim» no existe en Mode. ¿Querías decir «limb»?');
    const s = await errorOf('{ site(id: "im1") { sunEarth } }');
    assert.match(s.message, /necesita una selección de subcampos/);
  });

  test('errores de la v1 en el campo, con los nombres de GraphQL y datos parciales', async () => {
    const r = await gqlPost(base, '{ ok: site(id: "im1") { name } bad: site(id: "im1") { landingDates(from: "2027-02-30") { note } } nope: site(id: "nada") { name } }');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { ok: { name: 'IM-1 Odysseus' }, bad: { landingDates: null }, nope: null });
    const byPath = Object.fromEntries(r.body.errors!.map((e) => [e.path!.join('.'), [e.extensions.code, e.message]]));
    assert.deepEqual(byPath['bad.landingDates'], ['invalid_parameter', 'from no es una fecha real: 2027-02-30']);
    assert.deepEqual(byPath.nope, ['not_found', 'Sitio desconocido: nada']);
    const m = await errorOf('{ site(id: "im1") { landingDates(missionDays: 90) { note } } }');
    assert.equal(m.message, 'missionDays debe ser un número entre 1 y 60');
    const t = await errorOf('{ site(id: "im1") { sunEarth(at: "2027-01-01", terrain: { observerHeightM: 500 }) { date } } }');
    assert.equal(t.message, 'terrain.observerHeightM debe ser un número entre 0 y 100');
    const c = await errorOf('{ compare(sites: ["im1"], landingDates: { from: "2027-03-01", to: "2027-01-01" }) { siteCount } }');
    assert.equal(c.message, 'landingDates.to debe ser igual o posterior a landingDates.from');
    assert.equal((await errorOf('{ site(id: "im1", lat: 1, lon: 2) { name } }')).message, 'Indica id o lat y lon, no los dos');
    assert.equal((await errorOf('{ site(lat: 100, lon: 0) { name } }')).message, 'lat debe estar entre -90 y 90');
  });

  test('bestLandings: argumentos obligatorios, enums y límites de la v1 con los nombres de GraphQL', async () => {
    const msg = async (args: string): Promise<[string, string]> => {
      const e = await errorOf(`{ bestLandings(${args}) { tested } }`);
      return [e.code, e.message];
    };
    const ok = 'from: "2027-01-01", to: "2027-01-05"';
    assert.deepEqual(await msg('sites: ["im1"], to: "2027-01-05"'), ['validation_failed', 'Falta el argumento obligatorio «from» (DateTime!) del campo Query.bestLandings.']);
    assert.deepEqual(await msg(`sites: ["im1"], ${ok}, priority: speed`), ['validation_failed', 'El valor «speed» no existe en Priority.']);
    assert.deepEqual(await msg(`sites: [], ${ok}`), ['invalid_parameter', 'sites no puede estar vacío: indica de 1 a 10 sitios (ids o lat:lon)']);
    assert.deepEqual(await msg('sites: ["im1"], from: "2027-03-01", to: "2027-01-05"'), ['invalid_parameter', 'to no puede ser anterior a from']);
    assert.deepEqual(await msg('sites: ["im1"], from: "2027-01-01", to: "2027-06-01"'), ['invalid_parameter', 'La ventana de aterrizaje puede durar como mucho 120 días']);
    assert.deepEqual(await msg(`sites: ["im1"], ${ok}, missionDays: 90`), ['invalid_parameter', 'missionDays debe ser un número entre 0.5 y 30']);
    assert.deepEqual(await msg(`sites: ["im1"], ${ok}, minEarthPct: 120`), ['invalid_parameter', 'minEarthPct debe ser un número entre 0 y 100']);
    assert.deepEqual(await msg(`sites: ["im1"], ${ok}, terrain: { observerHeightM: 500 }`), ['invalid_parameter', 'terrain.observerHeightM debe ser un número entre 0 y 100']);
    assert.deepEqual(await msg(`sites: ["nada"], ${ok}`), ['not_found', 'Sitio desconocido: nada']);
    const eleven = Array.from({ length: 11 }, (_, i) => `"-89.${i}:0"`).join(', ');
    assert.deepEqual(await msg(`sites: [${eleven}], ${ok}`), ['invalid_parameter', 'Máximo 10 sitios por comparación']);
  });

  test('bestLandings: los veredictos con guion son valores del enum Verdict (not-viable → not_viable)', async () => {
    const q = '/v1/best-landings?sites=shackleton-rim,im1&start=2027-10-01&end=2027-10-05&days=5';
    const [v1, data] = await Promise.all([v1Get<any>(base, q), gqlData(base, '{ bestLandings(sites: ["shackleton-rim", "im1"], from: "2027-10-01", to: "2027-10-05", missionDays: 5) { options { verdict landings { verdict } } } }')]);
    const all = (o: { verdict: string; landings: { verdict: string }[] }[]): string[] => o.flatMap((x) => [x.verdict, ...x.landings.map((l) => l.verdict)]);
    assert.ok(all(v1.options).includes('not-viable'), 'el caso debe tener algún not-viable');
    assert.deepEqual(all((data.bestLandings as any).options), all(v1.options).map((v) => v.replace('-', '_')));
  });

  test('lightMap: centro, límites de la v1 y alturas con su propio nombre (no terrain.…)', async () => {
    const msg = async (args: string): Promise<[string, string]> => {
      const e = await errorOf(`{ lightMap(${args}) { count } }`);
      return [e.code, e.message];
    };
    assert.deepEqual(await msg('site: "im1", lat: -89'), ['invalid_parameter', 'Indica site o lat y lon, no los dos']);
    assert.deepEqual(await msg('lat: -89, from: "2027-01-01"'), ['invalid_parameter', 'Indica site=<id> o lat y lon']);
    assert.deepEqual(await msg('site: "nada", from: "2027-01-01"'), ['not_found', 'Sitio desconocido: nada']);
    assert.deepEqual(await msg('radiusKm: 200, spacingKm: 1, from: "2027-01-01"'), ['invalid_parameter', 'Demasiados puntos (125629); el máximo es 2000. Aumenta spacingKm o reduce radiusKm']);
    assert.deepEqual(await msg('observerHeightM: 500, from: "2027-01-01"'), ['invalid_parameter', 'observerHeightM debe ser un número entre 0 y 100']);
    assert.deepEqual(await msg('days: 40, from: "2027-01-01"'), ['invalid_parameter', 'days debe ser un número entre 0.5 y 30']);
    assert.deepEqual(await msg('from: "2027-02-30"'), ['invalid_parameter', 'from no es una fecha real: 2027-02-30']);
    const data = await gqlData(base, '{ lightMap(radiusKm: 1, spacingKm: 1, from: "2031-03-01", days: 1, observerHeightM: 0) { warnings { code parameter } } }');
    assert.deepEqual((data.lightMap as any).warnings, [{ code: 'low_observer_height', parameter: 'observerHeightM' }, { code: 'outside_validated_dates', parameter: null }]);
  });
});

describe('límites de la consulta', () => {
  test('una consulta demasiado cara se rechaza antes de calcular, con un mensaje claro', async () => {
    // 26 years of 15-minute windows (~400 points each, different periods: their ephemeris is not shared).
    const years = Array.from({ length: 26 }, (_, i) => `y${i}: windows(from: "${2027 + i}-01-01", to: "${2027 + i}-12-31") { mode }`).join(' ');
    const r = await gqlPost(base, `{ site(id: "im1") { ${years} } }`);
    assert.equal(r.status, 400);
    assert.equal(r.body.data, undefined);
    const e = r.body.errors![0];
    assert.equal(e.extensions.code, 'query_too_complex');
    assert.match(e.message, /^La consulta es demasiado cara: su coste estimado es [\d.]+ puntos y el máximo es 10\.000 \(LUNAR_GRAPHQL_MAX_COST/);
  });

  test('1.13.0: la mejor fecha de los 15 sitios con relieve (≈ 160–840 ms medidos) ya no se rechaza', () => {
    const r = executeRequest({ query: '{ sites { landingDates(from: "2027-01-01", to: "2027-12-31", terrain: {}) { best { date score } } } }' });
    assert.equal(r.status, 200, JSON.stringify(r.body.errors));
    assert.ok((r.body.extensions as any).cost.estimated < 1000);
  });

  test('el coste depende del cálculo: un barrido de un año con relieve cuesta mucho y una pendiente, poco', () => {
    const cost = (q: string): number => (executeRequest({ query: q }).body.extensions as any)?.cost.estimated;
    const slope = cost('{ site(id: "im1") { slope { slopeDeg } } }');
    const year = cost('{ site(id: "im1") { landingDates(from: "2027-01-01", to: "2027-12-31") { note } } }');
    const yearTerrain = cost('{ site(id: "im1") { landingDates(from: "2027-01-01", to: "2027-12-31", terrain: {}) { note } } }');
    const month = cost('{ site(id: "im1") { landingDates(from: "2027-01-01", to: "2027-01-31") { note } } }');
    assert.ok(slope <= 5, `pendiente: ${slope}`);
    assert.ok(month < year && year <= yearTerrain, `${month} < ${year} ≤ ${yearTerrain} (aquí sin DEM ni catálogo)`);
    assert.ok(year > 20 * slope, `un año (${year}) frente a una pendiente (${slope})`);
    const data = cost('{ sites { id name latDeg } }');
    assert.ok(data <= 1, `solo datos: ${data}`);
  });

  test('profundidad máxima (la introspección no cuenta)', () => {
    const r = executeRequest({ query: '{ compare(sites: ["im1"]) { sites { site { landingDates { best { metrics { meanSunDiskFraction } } } } } } }' }, { ...graphqlConfig(), maxDepth: 5 });
    assert.equal(r.status, 400);
    assert.equal(r.body.errors![0].extensions.code, 'query_too_deep');
    assert.match(r.body.errors![0].message, /más de 5 niveles/);
    const intro = executeRequest({ query: getIntrospectionQuery() }, { ...graphqlConfig(), maxDepth: 3 });
    assert.equal(intro.status, 200);
  });

  test('sitios × fechas', () => {
    const r = executeRequest({ query: '{ compare(sites: ["im1", "apollo11", "chandrayaan3"], landingDates: { from: "2027-01-01", to: "2027-12-31", dateStepHours: 12 }) { siteCount } }' }, { ...graphqlConfig(), maxSiteDates: 2000 });
    assert.equal(r.status, 400);
    assert.equal(r.body.errors![0].extensions.code, 'too_many_site_dates');
    assert.match(r.body.errors![0].message, /^La consulta pide 2187 combinaciones de sitio y fecha de alunizaje; el máximo es 2000/);
  });

  test('las listas de sitios suman lo de cada sitio; las efemérides del mismo periodo se cuentan una vez', () => {
    const est = (query: string): number => (executeRequest({ query }).body.extensions as any).cost.estimated;
    const one = est('{ site(id: "im1") { windows(from: "2027-01-01", to: "2027-02-01") { mode } } }');
    const all = est('{ sites { windows(from: "2027-01-01", to: "2027-02-01") { mode } } }');
    const two = est('{ a: site(id: "im1") { windows(from: "2027-01-01", to: "2027-02-01") { mode } } b: site(id: "im1") { windows(from: "2027-01-01", to: "2027-02-01") { mode } } }');
    const otherMonth = est('{ a: site(id: "im1") { windows(from: "2027-01-01", to: "2027-02-01") { mode } } b: site(id: "im1") { windows(from: "2027-03-01", to: "2027-04-01") { mode } } }');
    // Measured: a 15-site sweep of a year takes 160 ms against 104 ms for one site (the ephemeris is shared).
    assert.ok(all > one && all < 3 * one, `${all} frente a ${one}`);
    assert.ok(two > one && two < 1.2 * one, `dos alias del mismo periodo: ${two} frente a ${one}`);
    assert.ok(otherMonth > 1.9 * one, `dos periodos distintos: ${otherMonth} frente a ${one}`);
  });

  test('bestLandings: el coste crece con los sitios y la ventana; cuenta los aterrizajes probados como sitios × fechas', () => {
    const run = (query: string): { cost: number; siteDates: number } => {
      const c = (executeRequest({ query }).body.extensions as any).cost;
      return { cost: c.estimated, siteDates: c.siteDates };
    };
    const q = (sites: string, to: string): string => `{ bestLandings(sites: [${sites}], from: "2027-01-01", to: "${to}") { tested } }`;
    const one = run(q('"im1"', '2027-01-10'));
    const three = run(q('"im1", "apollo11", "chandrayaan3"', '2027-01-10'));
    const long = run(q('"im1"', '2027-04-30'));
    assert.ok(three.cost > one.cost && three.cost < 3 * one.cost, `tres sitios (${three.cost}) frente a uno (${one.cost}): las efemérides se comparten`);
    assert.ok(long.cost > 3 * one.cost, `119 días (${long.cost}) frente a 9 (${one.cost})`);
    assert.deepEqual([one.siteDates, three.siteDates, long.siteDates], [19, 57, 239]);
    // Measured on the real DEM (1.16.0): 10 sites over 120 days with a 30-day mission, 210 ms; well under the limit.
    const ten = Array.from({ length: 10 }, (_, i) => `"-8${i}.5:${i * 30}"`).join(', ');
    const max = run(`{ bestLandings(sites: [${ten}], from: "2027-01-01", to: "2027-05-01", missionDays: 30) { tested } }`);
    assert.ok(max.cost > 100 && max.cost < 1000, `10 sitios, 120 días: ${max.cost}`);
  });

  test('lightMap: los puntos se cuentan como en la v1 y, sin DEM, cuesta poco (con DEM, ~12 por punto: graphql-terrain.test.ts)', async () => {
    const { lightMapPoints } = await import('../src/graphql/limits.ts');
    const { lightMapCells } = await import('../../backend/src/useCases.ts');
    for (const [r, s] of [[20, 10], [2, 1], [60, 4], [3, 1.5], [10, 0.5], [7.5, 2.5], [1, 0.3]] as const) {
      assert.equal(lightMapPoints(r, s), lightMapCells({ lat: -90, lon: 0 }, r, s).length, `${r} km cada ${s} km`);
    }
    assert.equal(lightMapPoints(undefined, undefined), lightMapCells({ lat: -90, lon: 0 }, 60, 4).length, 'por defecto, 60 km cada 4 km');
    assert.equal(lightMapPoints(200, 0.25), 2000, 'por encima del máximo cuenta el máximo (la ejecución lo rechaza)');
    const r = executeRequest({ query: '{ lightMap(from: "2027-01-01") { count } }' });
    assert.equal(r.status, 200);
    assert.ok((r.body.extensions as any).cost.estimated < 100, `sin DEM: ${(r.body.extensions as any).cost.estimated}`);
  });

  test('variables configurables por entorno', () => {
    assert.deepEqual([graphqlConfig({}).maxCost, graphqlConfig({}).heavyCost], [10000, 100]);
    const cfg = graphqlConfig({ LUNAR_GRAPHQL_MAX_COST: '10', LUNAR_GRAPHQL_MAX_DEPTH: '4', LUNAR_GRAPHQL_MAX_SITE_DATES: '50', LUNAR_GRAPHQL_INTROSPECTION: '0' });
    assert.deepEqual([cfg.maxCost, cfg.maxDepth, cfg.maxSiteDates, cfg.introspection], [10, 4, 50, false]);
    const r = executeRequest({ query: '{ __schema { types { name } } }' }, cfg);
    assert.equal(r.status, 400);
    assert.match(r.body.errors![0].message, /introspección está desactivada/);
    assert.throws(() => graphqlConfig({ LUNAR_GRAPHQL_MAX_COST: 'mucho' }), /LUNAR_GRAPHQL_MAX_COST debe ser un entero/);
  });
});

describe('ejemplos', () => {
  for (const e of EXAMPLES) {
    test(`«${e.name}» funciona y respeta los límites por defecto`, () => {
      const r = executeRequest({ query: e.query, variables: e.variables });
      assert.equal(r.status, 200, JSON.stringify(r.body.errors));
      assert.equal(r.body.errors, undefined, JSON.stringify(r.body.errors));
    });
  }
});

test('con pool de workers: la consulta corre en un worker y da lo mismo que sin pool', async () => {
  const pooled = createApp({ config: { workers: 1 }, terrainDir: null });
  await pooled.pool!.ready;
  const b = await listen(pooled);
  try {
    const q = EXAMPLES[1].query;
    const [a, c] = await Promise.all([gqlPost(b, q), gqlPost(base, q)]);
    assert.deepEqual(a.body, c.body);
    assert.ok(pooled.pool!.status().done >= 1);
  } finally {
    await new Promise<void>((r) => pooled.close(() => r()));
  }
});
