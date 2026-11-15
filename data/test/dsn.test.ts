// 1.24.0 (issue #103): dsn=1 in /v1/windows, the Earth visible with a DSN antenna available. Without it nothing changes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.ts';
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

const W = '/v1/windows?site=apollo11&start=2027-01-01&end=2027-01-15';

describe('dsn en /v1/windows', () => {
  test('sin el parámetro (o con 0) la respuesta no lleva earthDsn ni dsn y es la misma', async () => {
    const plain = await get<V1Windows>(W);
    assert.ok(!('earthDsn' in plain.body) && !('dsn' in plain.body));
    assert.equal((await get(`${W}&dsn=0`)).text, plain.text);
    assert.equal((await get(`${W}&dsn=false`)).text, plain.text);
  });

  test('con dsn=1: el resto no cambia, earthDsn está dentro de earth y dsn trae las estaciones', async () => {
    const plain = await get<V1Windows>(W), r = await get<V1Windows>(`${W}&dsn=1`);
    assert.equal(r.status, 200, r.text);
    conforms(r.body);
    const { earthDsn, dsn, ...rest } = r.body;
    assert.deepEqual(rest, plain.body);
    // Apollo 11 sees the Earth all the time; the DSN does not always have the Moon above 10°.
    assert.equal(plain.body.earth.summary.fractionOfTime, 1);
    assert.ok(earthDsn!.summary.fractionOfTime < 1 && earthDsn!.summary.fractionOfTime > 0.5);
    assert.ok(earthDsn!.summary.count > 1);
    assert.equal(dsn!.minElevationDeg, 10);
    assert.equal(dsn!.minElevationAssumed, true);
    assert.deepEqual(dsn!.stations.map((s) => s.antenna), ['DSS-14', 'DSS-63', 'DSS-43']);
    assert.match(dsn!.note, /810-005/);
  });

  test('es el caso de uso del motor', async () => {
    const r = await get<V1Windows>(`${W}&dsn=true&earthMinElevationDeg=2`);
    const u = visibilityWindows({
      site: getSite('apollo11')!, startMs: Date.parse('2027-01-01T00:00:00Z'), endMs: Date.parse('2027-01-15T00:00:00Z'), earthMinElevationDeg: 2, dsn: true,
    });
    const { windows: _w, ...summary } = u.windows.earthDsn!;
    assert.deepEqual(r.body.earthDsn!.summary, summary);
    assert.equal(r.body.earthDsn!.windows.length, u.windows.earthDsn!.windows.length);
  });

  test('valor no válido, 400; en otra ruta, se ignora con aviso', async () => {
    const r = await get<V1Error>(`${W}&dsn=si`);
    assert.equal(r.status, 400, r.text);
    assert.match(r.body.error.message, /dsn/);
    const other = await get<{ warnings?: V1Warning[] }>('/v1/sun-earth?site=apollo11&date=2027-01-15&dsn=1');
    assert.equal(other.status, 200);
    assert.deepEqual(other.body.warnings!.map((w) => `${w.code}:${w.parameter}`), ['unused_parameter:dsn']);
  });
});
