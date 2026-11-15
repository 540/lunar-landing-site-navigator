// Night and battery (1.3.0): optional parameters of /v1/windows and /v1/rank. Without them nothing changes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.ts';
import { validate } from './schema.ts';
import type { MediaType, OpenApiSpec } from './schema.ts';
import type { V1Error, V1Rank, V1Windows } from '../src/types.ts';

const spec = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const content = (route: string): MediaType => spec.paths[route].get!.responses!['200'].content['application/json'];

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
const assertConforms = (route: string, body: unknown): void => {
  assert.deepEqual(validate(spec, content(route).schema, body), [], `${route} no cumple el esquema`);
};

const WINDOWS = '/v1/windows?lat=-65.31485&lon=-3.05572&start=2027-01-24&end=2027-02-07';
const RANK = '/v1/rank?sites=im1,apollo11&start=2027-01-24&days=14';

describe('contrato: sin los parámetros nuevos la respuesta no cambia', () => {
  for (const path of [WINDOWS, RANK, '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&mode=center', '/v1/rank?sites=all&start=2027-01-01&days=30']) {
    test(path, async () => {
      const plain = await get(path);
      assert.equal(plain.status, 200);
      assert.ok(!('night' in (plain.body as object)) && !('battery' in (plain.body as object)));
      // Explicit neutral values (0 / false) are the same as not giving them: byte for byte.
      const neutral = await get(`${path}&nightMinSunFraction=0&fullNight=0&battery=false`);
      assert.equal(neutral.text, plain.text);
    });
  }

  test('rank: sin parámetros nuevos, las métricas son las siete de 1.0.0', async () => {
    const r = await get<V1Rank>(RANK);
    for (const c of r.body.results) {
      assert.deepEqual(Object.keys(c.metrics), ['meanSunDiskFraction', 'sunTimeFraction', 'earthTimeFraction', 'sunAndEarthTimeFraction', 'longestNightHours', 'longestEarthOutageHours', 'longestSunAndEarthHours']);
    }
  });
});

describe('los ejemplos nocheYBateria de openapi.yaml son reales', () => {
  test('windows', async () => {
    const r = await get(`${WINDOWS}&fullNight=1&battery=1`);
    assert.deepEqual(r.body, content('/v1/windows').examples!.nocheYBateria.value);
  });
  test('rank', async () => {
    const r = await get(`${RANK}&fullNight=1&battery=1`);
    assert.deepEqual(r.body, content('/v1/rank').examples!.nocheYBateria.value);
  });
});

describe('noche real y batería', () => {
  test('windows: la noche real alarga la recortada y no la cambia; la batería sale de la real', async () => {
    const plain = await get<V1Windows>(`${WINDOWS}&battery=1`);
    const full = await get<V1Windows>(`${WINDOWS}&battery=1&fullNight=1`);
    assertConforms('/v1/windows', plain.body);
    assertConforms('/v1/windows', full.body);
    assert.equal(full.body.night!.longestNightHours, plain.body.night!.longestNightHours);
    assert.ok(!('longestNightFullHours' in plain.body.night!));
    assert.ok(full.body.night!.longestNightFullHours! >= 349 && full.body.night!.longestNightFullHours! <= 369, `${full.body.night!.longestNightFullHours} h`);
    assert.equal(plain.body.battery!.nightMetric, 'longestNightHours');
    assert.equal(plain.body.battery!.nightHours, plain.body.night!.longestNightHours);
    assert.equal(full.body.battery!.nightMetric, 'longestNightFullHours');
    assert.equal(full.body.battery!.nightHours, full.body.night!.longestNightFullHours);
    assert.match(full.body.battery!.note, /Solo la masa del pack/);
    // The 1.22.1 wording, pinned (#255): changing who the defaults are credited to has to be deliberate.
    assert.equal(full.body.battery!.note, 'Solo la masa del pack de baterías: sin electrónica, sin el panel solar extra para recargarlo y sin márgenes '
      + '(a nivel de sistema sale unas 2–3 veces más). Valores por defecto: 100 W de Cataldo, Zacny y Schmitz (NASA GRC, NETS 2018, '
      + 'apartado IV); 200 Wh/kg y profundidad de descarga 0,9 del estudio COMPASS de NASA GRC «Overnight Power & Thermal Solutions '
      + 'for Lunar Landers» (2022, transparencia 15).');
  });

  test('windows: dar solo survivalLoadW activa la batería con el resto por defecto, y la aritmética es exacta', async () => {
    const r = await get<V1Windows>(`${WINDOWS}&survivalLoadW=50`);
    const b = r.body.battery!;
    assert.deepEqual([b.survivalLoadW, b.whPerKg, b.depthOfDischarge], [50, 200, 0.9]);
    // 182.75 h × 50 W = 9.1375 kWh → 9137.5 Wh / (0.9 × 200 Wh/kg) = 50.7639 kg
    assert.equal(b.nightHours, 182.75);
    assert.equal(b.batteryKWh, 9.138);
    assert.equal(b.batteryKg, 50.76);
  });

  test('windows: nightMinSunFraction alarga (o deja igual) la noche y lo dice', async () => {
    const def = await get<V1Windows>(`${WINDOWS}&fullNight=1`);
    const strict = await get<V1Windows>(`${WINDOWS}&fullNight=1&nightMinSunFraction=1`);
    assert.equal(strict.body.night!.minSunFraction, 1);
    assert.ok(strict.body.night!.longestNightHours >= def.body.night!.longestNightHours);
    assert.ok(strict.body.night!.longestNightFullHours! >= def.body.night!.longestNightFullHours!);
    assert.deepEqual(strict.body.sun, def.body.sun, 'las ventanas no cambian');
  });

  test('rank: métricas nuevas solo si se piden, la puntuación no cambia', async () => {
    const plain = await get<V1Rank>(RANK);
    const r = await get<V1Rank>(`${RANK}&fullNight=1&battery=1&batteryWhPerKg=250&batteryDoD=0.8`);
    assertConforms('/v1/rank', r.body);
    assert.deepEqual(r.body.night, { minSunFraction: 0, fullNight: true, extensionLimitDays: 30 });
    assert.equal(r.body.battery!.nightMetric, 'longestNightFullHours');
    r.body.results.forEach((c, i) => {
      assert.equal(c.score, plain.body.results[i].score);
      assert.equal(c.metrics.longestNightHours, plain.body.results[i].metrics.longestNightHours);
      const h = c.metrics.longestNightFullHours!;
      assert.ok(h >= c.metrics.longestNightHours);
      assert.equal(c.metrics.batteryKWh, Math.round(100 * h) / 1000);
      assert.equal(c.metrics.batteryKg, Math.round((100 * h / (0.8 * 250)) * 100) / 100);
    });
  });
});

describe('400 con parámetros de noche y batería malos', () => {
  for (const [path, message] of [
    [`${WINDOWS}&nightMinSunFraction=1.5`, /nightMinSunFraction debe ser un número entre 0 y 1/],
    [`${WINDOWS}&nightMinSunFraction=mucho`, /nightMinSunFraction/],
    [`${WINDOWS}&fullNight=si`, /fullNight debe ser 1, true, 0 o false/],
    [`${WINDOWS}&battery=2`, /battery debe ser 1, true, 0 o false/],
    [`${RANK}&batteryDoD=0`, /batteryDoD debe ser un número entre 0.05 y 1/],
    [`${RANK}&survivalLoadW=-1`, /survivalLoadW debe ser un número entre 0 y 10000/],
    [`${RANK}&batteryWhPerKg=5000`, /batteryWhPerKg/],
  ] as const) {
    test(path, async () => {
      const r = await get<V1Error>(path);
      assert.equal(r.status, 400, r.text);
      assert.equal(r.body.error.code, 'invalid_parameter');
      assert.match(r.body.error.message, message);
    });
  }
});
