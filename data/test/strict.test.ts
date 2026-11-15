// 1.9.0: strict input without breaking clients (warnings), weights and constraints in /v1/rank, and honest figures
// (truncated nights, unknown slopes, smooth Moon at the poles, heightKm). Also the 1.9.0 contract fixture.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.ts';
import { API_VERSION } from '../src/v1.ts';
import { loadCatalogMasks, registerMask } from '../../backend/src/horizon.ts';
import { validate } from './schema.ts';
import { CONTRACT_PATHS, asOf1_12 } from './contract.ts';
import type { MediaType, OpenApiResponse, OpenApiSpec } from './schema.ts';
import type { V1Error, V1Health, V1LandingDates, V1Rank, V1SiteList, V1SunEarth, V1Warning, V1Windows } from '../src/types.ts';

const spec = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const content = (route: string): MediaType => spec.paths[route].get!.responses!['200'].content['application/json'];

let server: Server, base: string;
before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

type WithWarnings = { warnings?: V1Warning[] };
const get = async <T = unknown>(p: string, init?: RequestInit): Promise<{ status: number; headers: Headers; text: string; body: T }> => {
  const res = await fetch(base + p, init);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: (text ? JSON.parse(text) : null) as T };
};
const assertConforms = (p: string, body: unknown): void => {
  const route = p.split('?')[0];
  const errors = validate(spec, content(route).schema, body);
  assert.deepEqual(errors, [], `La respuesta de ${route} no cumple el esquema:\n${errors.join('\n')}`);
};
const codes = (b: WithWarnings): string[] => (b.warnings ?? []).map((w) => `${w.code}:${w.parameter ?? ''}`);

describe('warnings: parámetros que no aplican, sin romper a los clientes', () => {
  test('una petición limpia no lleva warnings', async () => {
    for (const p of ['/v1/health', '/v1/sun-earth?site=apollo11&date=2027-01-15', '/v1/rank?sites=apollo11&start=2027-01-01&days=2&panel=horizontal']) {
      assert.ok(!('warnings' in ((await get<WithWarnings>(p)).body as object)), p);
    }
  });

  const CASES: [string, string[]][] = [
    ['/v1/sun-earth?site=apollo11&date=2027-01-15&terain=1', ['unknown_parameter:terain']],
    ['/v1/landing-dates?site=apollo11&start=2027-01-01&end=2027-01-05&minEnergy=0.9', ['unknown_parameter:minEnergy']],
    ['/v1/rank?sites=apollo11&start=2027-01-01&end=2027-02-01', ['unused_parameter:end']],
    ['/v1/windows?site=apollo11&start=2027-01-01&end=2027-01-03&panel=horizontal', ['unused_parameter:panel']],
    ['/v1/track?site=apollo11&start=2027-01-01&end=2027-01-02&mode=full', ['unused_parameter:mode']],
    ['/v1/sun-earth?site=apollo11&date=2027-01-15&observerHeightM=10&panelHeightM=4', ['ignored_parameter:observerHeightM', 'ignored_parameter:panelHeightM']],
    ['/v1/sun-earth?site=apollo11&lat=-89&lon=0&heightKm=1&date=2027-01-15', ['ignored_parameter:lat', 'ignored_parameter:lon', 'ignored_parameter:heightKm']],
    ['/v1/windows?site=apollo11&start=2027-01-01&end=2027-01-03&battery=0&survivalLoadW=0', ['ignored_parameter:survivalLoadW']],
    ['/v1/sun-earth?site=apollo11&site=im1&date=2027-01-15', ['duplicate_parameter:site']],
    ['/v1/rank?sites=apollo11,apollo11,0.67408:23.47297&start=2027-01-01&days=2', ['duplicate_site:sites']],
    ['/v1/sun-earth?lat=10&lon=0&heightKm=5&date=2027-01-15', ['height_no_horizon_dip:heightKm']],
    ['/v1/sun-earth?site=apollo11&date=2031-06-01', ['outside_validated_dates:']],
  ];
  for (const [p, expected] of CASES) {
    test(p, async () => {
      const r = await get<WithWarnings>(p);
      assert.equal(r.status, 200, r.text);
      assertConforms(p, r.body);
      assert.deepEqual(codes(r.body), expected);
      assert.equal(Object.keys(r.body as object).at(-1), 'warnings', 'warnings va al final');
    });
  }

  test('sugiere el parámetro correcto', async () => {
    const [w] = (await get<WithWarnings>('/v1/sun-earth?site=apollo11&date=2027-01-15&terain=1')).body.warnings!;
    assert.match(w.message, /¿Querías decir terrain\?/);
    const [m] = (await get<WithWarnings>('/v1/landing-dates?site=apollo11&start=2027-01-01&end=2027-01-05&minEnergy=0.9')).body.warnings!;
    assert.match(m.message, /minMeanSunDiskFraction/);
    const [e] = (await get<WithWarnings>('/v1/rank?sites=apollo11&start=2027-01-01&days=2&end=2027-02-01')).body.warnings!;
    assert.match(e.message, /Aquí se usa days/);
  });

  test('lo que se ignora no cambia la respuesta', async () => {
    const strip = (t: string): unknown => (({ warnings: _w, ...b }) => b)(JSON.parse(t) as Record<string, unknown>);
    const plain = await get('/v1/sun-earth?site=apollo11&date=2027-01-15');
    for (const extra of ['&terain=1', '&observerHeightM=10', '&lat=-89&lon=0', '&heightKm=1']) {
      assert.deepEqual(strip((await get(`/v1/sun-earth?site=apollo11&date=2027-01-15${extra}`)).text), plain.body, extra);
    }
    // battery=0 really turns the battery off
    const off = await get<V1Windows>('/v1/windows?site=apollo11&start=2027-01-01&end=2027-01-03&battery=0&survivalLoadW=0');
    assert.ok(!('battery' in off.body) && !('night' in off.body));
  });

  test('Luna lisa a más de 80° sin relieve: aviso en sun-earth y windows, no en latitudes bajas', async () => {
    const polar = await get<V1SunEarth>('/v1/sun-earth?site=shackleton-rim&date=2027-01-15');
    assert.deepEqual(codes(polar.body), ['smooth_moon_polar:']);
    const w = await get<V1Windows>('/v1/windows?lat=-85&lon=10&start=2027-01-01&end=2027-01-03');
    assert.deepEqual(codes(w.body), ['smooth_moon_polar:']);
    // terrain=1 without a DEM (here) still falls back to the sphere: still warned, with the reason
    const t = await get<V1SunEarth>('/v1/sun-earth?site=shackleton-rim&date=2027-01-15&terrain=1');
    assert.match(t.body.warnings![0].message, /Se pidió relieve/);
    assert.ok(!('warnings' in (await get<V1SunEarth>('/v1/sun-earth?lat=-79&lon=0&date=2027-01-15')).body));
  });
});

describe('valores mal formados: 400 claro', () => {
  const BAD: [string, RegExp][] = [
    ['/v1/sun-earth?site=apollo11&date=2027-02-30', /date no es una fecha real/],
    ['/v1/sun-earth?site=apollo11&date=2027-04-31', /no es una fecha real/],
    ['/v1/sun-earth?site=apollo11&date=2027', /date no es una fecha ISO 8601/],
    ['/v1/sun-earth?site=apollo11&date=15/01/2027', /ISO 8601/],
    ['/v1/sun-earth?site=apollo11&date=2027-01-15T24:00', /no es una fecha real/],
    ['/v1/sun-earth?site=apollo11&date=1500-01-01', /entre los años 1900 y 2100/],
    ['/v1/sun-earth?site=apollo11&date=9999-01-01', /entre los años 1900 y 2100/],
    ['/v1/sun-earth?site=apollo11&date=275760-09-13', /ISO 8601/], // was a 500
    ['/v1/windows?site=apollo11&start=2027-01-01&end=2027-13-01', /end/],
    ['/v1/sun-earth?lat=%20&lon=0&date=2027-01-15', /lat debe ser un número decimal/],
    ['/v1/sun-earth?lat=0&lon=0x10&date=2027-01-15', /lon debe ser un número decimal/],
    ['/v1/sun-earth?lat=Infinity&lon=0', /lat debe ser un número decimal/],
    ['/v1/rank?sites=apollo11&days=1e999', /days/],
    ['/v1/sun-earth?site=apollo11&observerHeightM=abc', /observerHeightM debe ser un número/], // even without terrain
    ['/v1/sun-earth?site=apollo11&lat=abc', /lat debe ser un número/], // even when site wins
    ['/v1/rank?sites=-89.5:0:3', /no es un id del catálogo ni un par lat:lon/], // was a 404
    ['/v1/rank?sites=-89.5:abc', /lon debe ser un número/],
    ['/v1/landing-dates?site=apollo11&minMeanSunDiskFraction=1.5', /minMeanSunDiskFraction debe ser un número entre 0 y 1/],
    ['/v1/rank?sites=apollo11&minEarthTimeFraction=2', /minEarthTimeFraction debe ser un número entre 0 y 1/],
    ['/v1/landing-dates?site=apollo11&top=2.5', /top debe ser un entero entre 1 y 50/],
    ['/v1/landing-dates?site=apollo11&top=51', /top debe ser un número entre 1 y 50/],
    ['/v1/rank?sites=apollo11&weightMeanSunDiskFraction=0&weightEarthTimeFraction=0', /Al menos un peso debe ser positivo/],
    ['/v1/sun-earth?site=apollo11&earthMinElevationDeg=91', /earthMinElevationDeg debe ser un número entre 0 y 90/],
    ['/v1/landing-dates?site=apollo11&maxSlopeDeg=91', /maxSlopeDeg/],
  ];
  for (const [p, msg] of BAD) {
    test(p, async () => {
      const r = await get<V1Error>(p);
      assert.equal(r.status, 400, r.text);
      assert.equal(r.body.error.code, 'invalid_parameter');
      assert.match(r.body.error.message, msg);
    });
  }

  test('fechas válidas: zona, fracción, espacio como separador y + sin codificar', async () => {
    const at = async (d: string): Promise<string> => (await get<V1SunEarth>(`/v1/sun-earth?site=apollo11&date=${d}`)).body.date;
    assert.equal(await at('2027-01-15T12:00:00%2B02:00'), '2027-01-15T10:00:00.000Z');
    assert.equal(await at('2027-01-15T12:00:00+02:00'), '2027-01-15T10:00:00.000Z'); // '+' arrives as a space
    assert.equal(await at('2027-01-15T12:00:00.5-0130'), '2027-01-15T13:30:00.500Z');
    assert.equal(await at('2027-01-15%2012:00'), '2027-01-15T12:00:00.000Z');
    assert.equal(await at('2028-02-29'), '2028-02-29T00:00:00.000Z');
    assert.equal((await get<V1SunEarth>('/v1/sun-earth?lat=1e1&lon=-0.5E1&date=2027-01-15')).body.site.latDeg, 10);
  });

  test('405 con cabecera Allow', async () => {
    const r = await get<V1Error>('/v1/health', { method: 'POST' });
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('allow'), 'GET, HEAD, OPTIONS');
    assert.equal(r.body.error.code, 'method_not_allowed');
  });
});

describe('/v1/rank con pesos y restricciones', () => {
  const R = '/v1/rank?sites=im1,apollo11,chandrayaan3&start=2027-01-01&days=14';

  test('sin los parámetros nuevos no cambia nada; con los pesos por defecto, tampoco', async () => {
    const plain = await get(R);
    assert.equal((await get(`${R}&weightMeanSunDiskFraction=0.7&weightEarthTimeFraction=0.3&earthMinElevationDeg=0`)).text, plain.text);
  });

  test('pesos: los mismos nombres y la misma puntuación que /v1/landing-dates', async () => {
    const r = await get<V1Rank>(`${R}&weightMeanSunDiskFraction=1&weightEarthTimeFraction=0`);
    assertConforms(R, r.body);
    assert.equal(r.body.scoreWeights.meanSunDiskFraction, 1);
    for (const c of r.body.results) assert.equal(c.score, Math.round(100 * c.metrics.meanSunDiskFraction * 100) / 100);
    const sweep = await get<V1LandingDates>('/v1/landing-dates?site=im1&start=2027-01-01&end=2027-01-01&weightMeanSunDiskFraction=1&weightEarthTimeFraction=0');
    assert.equal(sweep.body.dates![0].score, r.body.results.find((c) => c.siteId === 'im1')!.score);
  });

  test('restricciones: eco, meetsConstraints y violatedConstraints; el orden no cambia', async () => {
    const plain = await get<V1Rank>(R);
    const r = await get<V1Rank>(`${R}&minEarthTimeFraction=0.9&maxLongestNightHours=300`);
    assertConforms(R, r.body);
    assert.deepEqual(r.body.constraints, { minEarthTimeFraction: 0.9, maxLongestNightHours: 300 });
    assert.deepEqual(r.body.results.map((c) => c.siteId), plain.body.results.map((c) => c.siteId));
    for (const c of r.body.results) {
      const missed = [
        ...(c.metrics.earthTimeFraction >= 0.9 ? [] : ['minEarthTimeFraction']),
        ...(c.metrics.longestNightHours <= 300 ? [] : ['maxLongestNightHours']),
      ];
      assert.equal(c.meetsConstraints, missed.length === 0, c.siteId);
      assert.deepEqual(c.violatedConstraints, missed.length ? missed : undefined, c.siteId);
    }
    assert.ok(r.body.results.some((c) => c.meetsConstraints) && r.body.results.some((c) => !c.meetsConstraints));
  });

  test('maxBatteryKg activa la batería, como en /v1/landing-dates', async () => {
    const r = await get<V1Rank>(`${R}&maxBatteryKg=150`);
    assertConforms(R, r.body);
    assert.equal(r.body.battery?.survivalLoadW, 100);
    for (const c of r.body.results) assert.equal(c.meetsConstraints, c.metrics.batteryKg! <= 150);
  });

  test('earthMinElevationDeg: menos tiempo con la Tierra; eco solo si es > 0; igual que /v1/landing-dates', async () => {
    const plain = await get<V1Rank>(R), r = await get<V1Rank>(`${R}&earthMinElevationDeg=10`);
    assert.equal(r.body.earthMinElevationDeg, 10);
    for (const c of r.body.results) {
      const p = plain.body.results.find((x) => x.siteId === c.siteId)!;
      assert.ok(c.metrics.earthTimeFraction <= p.metrics.earthTimeFraction, c.siteId);
    }
    assert.ok(r.body.results.some((c) => c.metrics.earthTimeFraction < plain.body.results.find((x) => x.siteId === c.siteId)!.metrics.earthTimeFraction));
    const sweep = await get<V1LandingDates>('/v1/landing-dates?site=im1&start=2027-01-01&end=2027-01-01&earthMinElevationDeg=10');
    assert.equal(sweep.body.earthMinElevationDeg, 10);
    assert.deepEqual(sweep.body.dates![0].metrics, r.body.results.find((c) => c.siteId === 'im1')!.metrics);
  });

  test('earthMinElevationDeg en sun-earth y windows: la Tierra necesita esa elevación', async () => {
    const se = await get<V1SunEarth>('/v1/sun-earth?site=im1&date=2027-01-15&earthMinElevationDeg=5');
    assertConforms('/v1/sun-earth', se.body);
    assert.equal(se.body.earth.horizonElevationDeg, 5);
    assert.equal(se.body.earth.visible, se.body.earth.elevationDeg + se.body.earth.angularRadiusDeg > 5);
    const plain = await get<V1Windows>('/v1/windows?site=im1&start=2027-01-01&end=2027-02-01');
    const w = await get<V1Windows>('/v1/windows?site=im1&start=2027-01-01&end=2027-02-01&earthMinElevationDeg=5');
    assert.ok(w.body.earth.summary.totalHours < plain.body.earth.summary.totalHours);
    assert.deepEqual(w.body.sun, plain.body.sun);
  });

  test('note: la energía supone un panel que sigue al Sol, salvo con panel', async () => {
    assert.match((await get<V1Rank>(R)).body.note, /panel que sigue al Sol/);
    assert.doesNotMatch((await get<V1Rank>(`${R}&panel=vertical-rotating`)).body.note, /panel que sigue al Sol/);
  });
});

describe('/v1/landing-dates: restricciones incumplidas de cada fecha', () => {
  test('violatedConstraints solo en las fechas que no cumplen, coherente con meetsConstraints', async () => {
    const p = '/v1/landing-dates?site=apollo11&start=2027-01-01&end=2027-02-01&minMeanSunDiskFraction=0.5&maxLongestNightHours=100';
    const r = await get<V1LandingDates>(p);
    assertConforms(p, r.body);
    for (const d of r.body.dates!) {
      const missed = [
        ...(d.metrics.meanSunDiskFraction >= 0.5 ? [] : ['minMeanSunDiskFraction']),
        ...(d.metrics.longestNightHours <= 100 ? [] : ['maxLongestNightHours']),
      ];
      assert.equal(d.meetsConstraints, missed.length === 0, d.date);
      assert.deepEqual(d.violatedConstraints, missed.length ? missed : undefined, d.date);
    }
    assert.ok(r.body.dates!.some((d) => d.violatedConstraints?.length === 2));
  });
});

describe('noche real cortada por el límite de búsqueda (sombra casi permanente)', () => {
  // A registered mask of 40° everywhere: the Sun never rises (permanent shadow), without needing a DEM.
  before(() => registerMask('custom:-89.9,0', { stepDeg: 1, el: new Array(360).fill(40), source: 'prueba: sombra permanente' }));

  test('windows: nightTruncated, aviso en la nota de la batería y en warnings', async () => {
    const p = '/v1/windows?lat=-89.9&lon=0&start=2027-01-01&end=2027-01-15&fullNight=1&battery=1';
    const r = await get<V1Windows>(p);
    assert.equal(r.status, 200, r.text);
    assertConforms(p, r.body);
    assert.equal(r.body.night!.nightTruncated, true);
    assert.ok(Math.abs(r.body.night!.longestNightFullHours! - (14 + 2 * 30) * 24) <= 0.25, 'el periodo y 30 días a cada lado');
    assert.match(r.body.battery!.note, /solo un mínimo/);
    assert.deepEqual(codes(r.body), ['night_truncated:fullNight']);
    // a normal night is not flagged
    const ok = await get<V1Windows>('/v1/windows?lat=-65.31485&lon=-3.05572&start=2027-01-24&end=2027-02-07&fullNight=1&battery=1');
    assert.ok(!('nightTruncated' in ok.body.night!) && !('warnings' in ok.body));
  });

  test('rank y landing-dates: nightTruncated en las métricas, el mismo en las dos rutas', async () => {
    const rank = await get<V1Rank>('/v1/rank?sites=-89.9:0,apollo11&start=2027-01-01&days=14&fullNight=1&battery=1');
    assertConforms('/v1/rank', rank.body);
    const dark = rank.body.results.find((c) => c.siteId === 'custom:-89.9,0')!;
    assert.equal(dark.metrics.nightTruncated, true);
    assert.ok(!('nightTruncated' in rank.body.results.find((c) => c.siteId === 'apollo11')!.metrics));
    assert.match(rank.body.battery!.note, /solo un mínimo/);
    assert.deepEqual(codes(rank.body), ['night_truncated:fullNight']);
    const sweep = await get<V1LandingDates>('/v1/landing-dates?lat=-89.9&lon=0&start=2027-01-01&end=2027-01-03&fullNight=1&battery=1');
    assertConforms('/v1/landing-dates', sweep.body);
    assert.deepEqual(sweep.body.dates![0].metrics, dark.metrics);
    assert.ok(sweep.body.dates!.every((d) => d.metrics.nightTruncated));
  });
});

describe('detalles', () => {
  test('el ejemplo de health y data/package.json llevan la versión real', () => {
    const health = (spec.paths['/v1/health'].get!.responses!['200'] as OpenApiResponse).content['application/json'].example as V1Health;
    assert.equal(health.apiVersion, API_VERSION);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    assert.equal(pkg.version, API_VERSION);
    assert.deepEqual((spec as unknown as { servers: { url: string }[] }).servers.map((s) => s.url), ['/']);
  });

  test('/v1/sites: terrainMaskHeightsM en los sitios con máscaras del catálogo', async () => {
    loadCatalogMasks(new URL('../../backend/terrain', import.meta.url).pathname);
    try {
      const r = await get<V1SiteList>('/v1/sites');
      assertConforms('/v1/sites', r.body);
      const byId = Object.fromEntries(r.body.sites.map((s) => [s.id, s]));
      assert.deepEqual(byId['shackleton-rim'].terrainMaskHeightsM, [2, 10]);
      assert.ok(!('terrainMaskHeightsM' in byId.apollo11));
    } finally {
      loadCatalogMasks(null);
    }
    assert.ok(!('terrainMaskHeightsM' in (await get<V1SiteList>('/v1/sites')).body.sites[1]));
  });
});

describe('contrato 1.9.0: cuerpos guardados en fixtures/v1-contract-1.9.0.json', () => {
  // Bodies computed without DEM nor catalogue (as under node --test). Regenerate with: node test/fixtures/write-contract.ts
  const bodies = JSON.parse(readFileSync(new URL('./fixtures/v1-contract-1.9.0.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  test('cubre las mismas rutas que CONTRACT_PATHS', () => assert.deepEqual(Object.keys(bodies), CONTRACT_PATHS));
  for (const p of CONTRACT_PATHS) {
    test(p, async () => {
      const r = await get(p);
      assert.equal(r.status, 200, r.text);
      // /v1/health only changes its apiVersion from one version to the next (1.10.0: no other body changes).
      const expected = p === '/v1/health' ? { ...(bodies[p] as object), apiVersion: API_VERSION, uptimeSeconds: (r.body as V1Health).uptimeSeconds } : bodies[p];
      assert.equal(asOf1_12(r.text), JSON.stringify(expected), 'la respuesta ha cambiado byte a byte');
    });
  }
});
