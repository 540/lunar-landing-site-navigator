// Landing-date sweep (1.5.0): /v1/landing-dates, and the v1 contract of the other routes (unchanged, byte for byte).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.ts';
import { validate } from './schema.ts';
import { legacyText } from './contract.ts';
import type { MediaType, OpenApiSpec } from './schema.ts';
import type { V1Error, V1Health, V1LandingDates, V1Rank } from '../src/types.ts';

const spec = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const content = (route: string): MediaType => spec.paths[route].get!.responses!['200'].content['application/json'];
const ROUTE = '/v1/landing-dates';

let server: Server, base: string;
before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const get = async <T = unknown>(p: string): Promise<{ status: number; text: string; body: T }> => {
  const res = await fetch(base + p);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as T };
};
const assertConforms = (body: unknown): void => {
  const errors = validate(spec, content(ROUTE).schema, body);
  assert.deepEqual(errors, [], `La respuesta no cumple el esquema:\n${errors.join('\n')}`);
};

describe('contrato: las demás rutas v1 no cambian', () => {
  // SHA-256 of the response bodies of 1.4.0 (commit e03ee0f), computed with the engine without terrain (as under node --test).
  const hashes = JSON.parse(readFileSync(new URL('./fixtures/v1-contract-1.4.0.json', import.meta.url), 'utf8')) as Record<string, string>;
  for (const [path, hash] of Object.entries(hashes)) {
    test(path, async () => {
      const r = await get(path);
      assert.equal(r.status, 200);
      assert.equal(createHash('sha256').update(legacyText(path, r.text)).digest('hex'), hash, 'la respuesta ha cambiado byte a byte');
    });
  }
  test('health anuncia la versión de openapi.yaml (1.5.0 o posterior)', async () => {
    const r = await get<V1Health>('/v1/health');
    assert.equal(r.body.apiVersion, (spec as unknown as { info: { version: string } }).info.version);
    assert.ok(/^1\.(5|[6-9]|\d\d)\.\d+$/.test(r.body.apiVersion), r.body.apiVersion);
  });
});

describe('/v1/landing-dates', () => {
  test('el ejemplo de openapi.yaml es real', async () => {
    const r = await get('/v1/landing-dates?site=im1&start=2027-01-01&end=2027-01-07&dateStep=3d&top=1');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, content(ROUTE).examples!.barrido.value);
  });

  test('cada fecha coincide con /v1/rank empezando ese día (mismas métricas y puntuación)', async () => {
    const sweep = await get<V1LandingDates>('/v1/landing-dates?lat=-65.31485&lon=-3.05572&start=2027-01-10&end=2027-02-10&dateStep=1d&fullNight=1&battery=1&panel=vertical-rotating');
    assert.equal(sweep.status, 200, sweep.text);
    assertConforms(sweep.body);
    for (const i of [0, 6, 14, 23, 31]) {
      const d = sweep.body.dates![i];
      const rank = await get<V1Rank>(`/v1/rank?sites=-65.31485:-3.05572&start=${d.date}&days=14&fullNight=1&battery=1&panel=vertical-rotating`);
      assert.deepEqual(d.metrics, rank.body.results[0].metrics, d.date);
      assert.equal(d.score, rank.body.results[0].score, d.date);
    }
    assert.deepEqual(sweep.body.panel, (await get<V1Rank>('/v1/rank?sites=apollo11&days=1&panel=vertical-rotating')).body.panel);
    assert.equal(sweep.body.battery!.nightMetric, 'longestNightFullHours');
  });

  test('2027 en (−65,31485, −3,05572): las mejores fechas ≫ las peores, y ventanas cada ~29,5 días', async () => {
    const r = await get<V1LandingDates>('/v1/landing-dates?lat=-65.31485&lon=-3.05572&start=2027-01-01&end=2027-12-31&top=5');
    assert.equal(r.body.stats.dateCount, 365);
    assert.ok(Math.min(...r.body.best.map((d) => d.metrics.meanSunDiskFraction)) >= 0.9);
    assert.ok(Math.max(...r.body.worst.map((d) => d.metrics.meanSunDiskFraction)) <= 0.1);
    const w = r.body.goodWindows.map((x) => Date.parse(x.bestDate));
    const meanGap = (w.at(-1)! - w[0]) / (w.length - 1) / 86400e3;
    assert.ok(Math.abs(meanGap - 29.53) < 1, `${meanGap} días`);
    assert.match(r.body.note, /panel que sigue al Sol/);
  });

  test('restricciones con nombres públicos: eco, meetsConstraints y ventanas que las cumplen', async () => {
    const r = await get<V1LandingDates>('/v1/landing-dates?lat=-65.31485&lon=-3.05572&start=2027-01-01&end=2027-04-01&minMeanSunDiskFraction=0.8&maxLongestNightHours=48');
    assertConforms(r.body);
    assert.deepEqual(r.body.constraints, { minMeanSunDiskFraction: 0.8, maxLongestNightHours: 48 });
    assert.deepEqual(r.body.goodCriterion, { constraints: true, minScore: null, relativeToBest: null });
    const ok = r.body.dates!.filter((d) => d.meetsConstraints);
    assert.ok(ok.length > 0 && ok.every((d) => d.metrics.meanSunDiskFraction >= 0.8 && d.metrics.longestNightHours <= 48));
    assert.equal(r.body.goodWindows.reduce((a, x) => a + x.dateCount, 0), ok.length);
    assert.equal(r.body.stats.meetsConstraintsFraction, Math.round((ok.length / r.body.dates!.length) * 1e4) / 1e4);
  });

  test('pesos: solo energía', async () => {
    const r = await get<V1LandingDates>('/v1/landing-dates?site=apollo11&start=2027-01-01&end=2027-01-05&weightMeanSunDiskFraction=1&weightEarthTimeFraction=0');
    assert.equal(r.body.scoreWeights.meanSunDiskFraction, 1);
    for (const d of r.body.dates!) assert.equal(d.score, Math.round(100 * d.metrics.meanSunDiskFraction * 100) / 100);
  });

  test('maxBatteryKg activa la batería y lo dice', async () => {
    const r = await get<V1LandingDates>('/v1/landing-dates?site=im1&start=2027-01-01&end=2027-01-05&maxBatteryKg=150');
    assertConforms(r.body);
    assert.equal(r.body.battery?.survivalLoadW, 100);
    assert.ok(r.body.dates!.every((d) => d.metrics.batteryKg !== undefined && d.meetsConstraints === d.metrics.batteryKg <= 150));
  });

  test('sin terrain no hay relieve; con terrain=1 (sin DEM aquí) esfera explicada en terrain', async () => {
    const plain = await get<V1LandingDates>('/v1/landing-dates?site=shackleton-rim&start=2027-01-01&end=2027-01-03');
    assert.equal(plain.body.site.horizonModel, 'sphere');
    assert.ok(!('terrain' in plain.body));
    const t = await get<V1LandingDates>('/v1/landing-dates?site=shackleton-rim&start=2027-01-01&end=2027-01-03&terrain=1');
    assertConforms(t.body);
    assert.equal(t.body.terrain!.applied, false);
  });

  const BAD = [
    'site=apollo11&start=2027-01-01&end=2028-02-10',
    'site=apollo11&start=2027-02-01&end=2027-01-01',
    'site=apollo11&dateStep=31d',
    'site=apollo11&dateStep=1semana',
    'site=apollo11&days=61',
    'site=apollo11&days=14.01',
    'site=apollo11&minMeanSunDiskFraction=x',
    'site=apollo11&maxLongestNightHours=-1',
    'site=apollo11&minScore=-1',
    'site=apollo11&top=51',
    'site=apollo11&weightMeanSunDiskFraction=0&weightEarthTimeFraction=0',
    'site=apollo11&panel=diagonal',
    'site=apollo11&terrain=quizas',
    'site=apollo11&fullNight=si',
  ];
  for (const qs of BAD) {
    test(`400 en ${qs}`, async () => {
      const r = await get<V1Error>(`${ROUTE}?${qs}`);
      assert.equal(r.status, 400, r.text);
      assert.equal(r.body.error.code, 'invalid_parameter');
      assert.match(r.body.error.message, /debe|máximo|posterior|Al menos/);
    });
  }
});
