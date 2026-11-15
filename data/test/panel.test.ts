// Solar panel orientation (1.4.0): optional `panel` in /v1/rank. Without it (or with `tracking`) nothing changes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.ts';
import { validate } from './schema.ts';
import type { MediaType, OpenApiSpec } from './schema.ts';
import { withoutWarnings } from './contract.ts';
import type { V1Error, V1Rank, V1Warning } from '../src/types.ts';

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

const RANK = '/v1/rank?sites=shackleton-rim,im1&start=2027-01-24&days=14';

describe('contrato: sin `panel` (o con tracking) la respuesta no cambia', () => {
  for (const path of [RANK, '/v1/rank?sites=all&start=2027-01-01&days=30', `${RANK}&fullNight=1&battery=1`]) {
    test(path, async () => {
      const plain = await get(path);
      assert.equal(plain.status, 200);
      assert.ok(!('panel' in (plain.body as object)));
      for (const neutral of ['tracking', '']) assert.equal((await get(`${path}&panel=${neutral}`)).text, plain.text);
    });
  }
  test('las rutas sin métricas de energía ignoran panel', async () => {
    for (const path of ['/v1/windows?site=im1&start=2027-01-24&end=2027-02-07', '/v1/sun-earth?site=im1&date=2027-01-24']) {
      const r = await get(`${path}&panel=horizontal`);
      assert.equal(withoutWarnings(r.text), withoutWarnings((await get(path)).text));
      // since 1.9.0 the response says panel is not used there
      assert.ok((JSON.parse(r.text) as { warnings: V1Warning[] }).warnings.some((w) => w.code === 'unused_parameter' && w.parameter === 'panel'), path);
    }
  });
});

describe('panel en /v1/rank', () => {
  test('el ejemplo panelHorizontal de openapi.yaml es real', async () => {
    const r = await get(`${RANK}&panel=horizontal`);
    assert.deepEqual(r.body, content('/v1/rank').examples!.panelHorizontal.value);
  });

  test('solo cambian meanSunDiskFraction y la puntuación; en el polo horizontal ≪ vertical-rotating ≈ tracking', async () => {
    const plain = await get<V1Rank>(RANK);
    const bySite = (r: V1Rank, id: string) => r.results.find((c) => c.siteId === id)!;
    const out: Record<string, V1Rank> = {};
    for (const panel of ['vertical-rotating', 'horizontal']) {
      const r = await get<V1Rank>(`${RANK}&panel=${panel}`);
      assert.deepEqual(validate(spec, content('/v1/rank').schema, r.body), []);
      assert.equal(r.body.panel!.orientation, panel);
      assert.equal(r.body.panel!.factor, panel === 'horizontal' ? 'max(0, sen(el))' : 'cos(el)');
      for (const c of r.body.results) {
        const p = bySite(plain.body, c.siteId);
        assert.deepEqual({ ...c.metrics, meanSunDiskFraction: 0 }, { ...p.metrics, meanSunDiskFraction: 0 });
        assert.ok(c.metrics.meanSunDiskFraction <= p.metrics.meanSunDiskFraction);
      }
      out[panel] = r.body;
    }
    const rim = (r: V1Rank): number => bySite(r, 'shackleton-rim').metrics.meanSunDiskFraction;
    assert.ok(Math.abs(rim(out['vertical-rotating']) - rim(plain.body)) < 0.001);
    assert.ok(rim(out.horizontal) < rim(plain.body) / 50);
  });

  test('panel inválido: 400 invalid_parameter con mensaje en español', async () => {
    const r = await get<V1Error>(`${RANK}&panel=vertical`);
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error.code, 'invalid_parameter');
    assert.match(r.body.error.message, /panel debe ser tracking, vertical-rotating u horizontal/);
  });
});
