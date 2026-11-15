// 1.18.0 (issue #64): horizonBandDeg in /v1/windows, the horizon robustness band. Without it nothing changes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.ts';
import { loadCatalogMasks } from '../../backend/src/horizon.ts';
import { visibilityWindows } from '../../backend/src/useCases.ts';
import { getSite } from '../../backend/src/sites.ts';
import { validate } from './schema.ts';
import type { OpenApiSpec } from './schema.ts';
import type { V1Error, V1Warning, V1Windows } from '../src/types.ts';

const spec = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const schema = spec.paths['/v1/windows'].get!.responses!['200'].content['application/json'].schema;

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
const conforms = (body: unknown): void => assert.deepEqual(validate(spec, schema, body), []);

const W = '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&mode=full';

describe('horizonBandDeg en /v1/windows', () => {
  test('sin el parámetro (o con 0) la respuesta no lleva horizonBand y es la misma', async () => {
    const plain = await get<V1Windows>(W);
    assert.ok(!('horizonBand' in plain.body));
    assert.equal((await get(`${W}&horizonBandDeg=0`)).text, plain.text);
  });

  test('con 0.3: las ventanas nominales no cambian y horizonBand trae el rango y las ventanas desplazadas', async () => {
    const plain = await get<V1Windows>(W), r = await get<V1Windows>(`${W}&horizonBandDeg=0.3`);
    assert.equal(r.status, 200, r.text);
    conforms(r.body);
    const { horizonBand: band, ...rest } = r.body;
    assert.deepEqual(rest, plain.body);
    assert.equal(band!.deg, 0.3);
    assert.match(band!.note, /no es un intervalo de confianza/);
    for (const body of ['sun', 'earth', 'sunAndEarth'] as const) {
      const nominal = plain.body[body].summary.fractionOfTime, range = band!.range[body].fractionOfTime;
      assert.equal(range.min, band!.raised[body].summary.fractionOfTime, body);
      assert.equal(range.max, band!.lowered[body].summary.fractionOfTime, body);
      assert.ok(range.min <= nominal && nominal <= range.max, body);
      assert.ok(!('events' in band!.raised[body]));
    }
    // Smooth Moon at 89.4°S: the Sun grazes the horizon, 0.3° is many hours.
    assert.ok(band!.range.sun.fractionOfTime.max - band!.range.sun.fractionOfTime.min > 0.02);
    assert.ok(!('longestNightHours' in band!.range));
  });

  test('es el caso de uso del motor, también con noche y earthMinElevationDeg', async () => {
    const r = await get<V1Windows>(`${W}&horizonBandDeg=0.5&fullNight=1&earthMinElevationDeg=2`);
    conforms(r.body);
    const u = visibilityWindows({
      site: getSite('shackleton-rim')!, startMs: Date.parse('2027-01-01T00:00:00Z'), endMs: Date.parse('2027-03-01T00:00:00Z'), mode: 'full',
      night: { fullNight: true }, earthMinElevationDeg: 2, horizonBandDeg: 0.5,
    }).horizonBand!;
    assert.deepEqual(r.body.horizonBand!.range, u.range);
    assert.equal(r.body.horizonBand!.range.longestNightHours!.max, u.raised.night!.longestNightHours);
    assert.deepEqual(r.body.horizonBand!.raised.earth.summary.totalHours, u.raised.earth.totalHours);
  });

  test('con relieve (máscara del catálogo): la banda desplaza la máscara', async () => {
    loadCatalogMasks(fileURLToPath(new URL('../../backend/terrain', import.meta.url)));
    try {
      const flat = await get<V1Windows>(`${W}&horizonBandDeg=0.3`), r = await get<V1Windows>(`${W}&terrain=1&horizonBandDeg=0.3`);
      conforms(r.body);
      assert.equal(r.body.terrain!.applied, true);
      const range = r.body.horizonBand!.range.sun.fractionOfTime, nominal = r.body.sun.summary.fractionOfTime;
      assert.ok(range.min < nominal && nominal < range.max);
      assert.notDeepEqual(r.body.horizonBand!.range, flat.body.horizonBand!.range);
    } finally {
      loadCatalogMasks(null);
    }
  });

  test('fuera de rango, 400; en otra ruta, se ignora con aviso', async () => {
    for (const bad of ['-0.1', '5.1', 'abc']) {
      const r = await get<V1Error>(`${W}&horizonBandDeg=${bad}`);
      assert.equal(r.status, 400, r.text);
      assert.match(r.body.error.message, /horizonBandDeg debe ser un número/);
    }
    const other = await get<{ warnings?: V1Warning[] }>('/v1/sun-earth?site=apollo11&date=2027-01-15&horizonBandDeg=0.3');
    assert.equal(other.status, 200);
    assert.deepEqual(other.body.warnings!.map((w) => `${w.code}:${w.parameter}`), ['unused_parameter:horizonBandDeg']);
  });
});
