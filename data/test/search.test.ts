// /v1/search and its asynchronous jobs (since 1.13.0): the grid search with the v1 contract, the format of v1 errors and
// the jobs (POST /v1/search/jobs, GET /v1/search/jobs/{id}) without a pool and in a pool of workers.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.ts';
import { validate } from './schema.ts';
import type { OpenApiSpec, Schema } from './schema.ts';
import type { V1Error, V1Search, V1Warning } from '../src/types.ts';

const spec = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const schemas = spec.components.schemas;
const conforms = (schema: Schema, body: unknown): void => assert.deepEqual(validate(spec, schema, body), []);

interface Job { id: string; status: string; request: string; statusUrl: string; progress?: { fraction: number }; result?: V1Search; error?: { status: number; code?: string; message: string } }

const Q = 'latMin=-89.6&latMax=-89.3&lonMin=-30&lonMax=30&spacingKm=4&refineLevels=1&start=2027-01-10&days=3';

async function call<T>(base: string, p: string, method = 'GET'): Promise<{ status: number; headers: Headers; body: T }> {
  const res = await fetch(base + p, { method });
  return { status: res.status, headers: res.headers, body: (await res.json()) as T };
}

/** Polls a job until it finishes. */
async function finished(base: string, id: string): Promise<Job> {
  for (let i = 0; i < 500; i++) {
    const j = (await call<Job>(base, `/v1/search/jobs/${id}`)).body;
    if (j.status === 'done' || j.status === 'error') return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('el trabajo no ha terminado');
}

for (const workers of [0, 2]) {
  describe(`/v1/search y sus trabajos (${workers ? 'pool de workers' : 'sin pool'})`, () => {
    let server: Server & { pool: unknown }, base: string;
    before(async () => {
      server = createApp({ config: { workers }, terrainDir: null });
      await (server.pool as { ready?: Promise<void> } | null)?.ready;
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    after(() => new Promise<void>((r) => server.close(() => r())));

    test('trabajo: 202 con Location, progreso y el mismo resultado que la búsqueda síncrona', async () => {
      const created = await call<Job>(base, `/v1/search/jobs?${Q}`, 'POST');
      assert.equal(created.status, 202);
      conforms(schemas.SearchJob, created.body);
      assert.equal(created.headers.get('location'), `/v1/search/jobs/${created.body.id}`);
      assert.equal(created.body.statusUrl, created.headers.get('location'));
      assert.equal(created.body.request, `/v1/search?${Q}`);
      const done = await finished(base, created.body.id);
      assert.equal(done.status, 'done', JSON.stringify(done.error));
      conforms(schemas.SearchJob, done);
      assert.equal(done.progress!.fraction, 1);
      const sync = await call<V1Search>(base, `/v1/search?${Q}`);
      assert.equal(sync.status, 200);
      assert.deepEqual(done.result, sync.body);
    });

    test('trabajo sin start: «ahora» queda fijado al aceptarlo', async () => {
      const created = await call<Job>(base, '/v1/search/jobs?latMin=-89.6&latMax=-89.3&lonMin=-30&lonMax=30&spacingKm=10&refineLevels=0&days=1', 'POST');
      assert.equal(created.status, 202);
      assert.match(new URLSearchParams(created.body.request.split('?')[1]).get('start')!, /^\d{4}-\d\d-\d\dT/);
      assert.equal((await finished(base, created.body.id)).status, 'done');
    });

    test('errores con el formato de la v1: 400 al crear, 404, 405', async () => {
      const bad = await call<V1Error>(base, '/v1/search/jobs?spacingKm=0.1', 'POST');
      assert.equal(bad.status, 400);
      conforms(schemas.Error, bad.body);
      assert.equal(bad.body.error.code, 'invalid_parameter');
      const missing = await call<V1Error>(base, '/v1/search/jobs/00000000-0000-0000-0000-000000000000');
      assert.equal(missing.status, 404);
      assert.equal(missing.body.error.code, 'not_found');
      const get = await call<V1Error>(base, '/v1/search/jobs');
      assert.equal(get.status, 405);
      assert.equal(get.body.error.code, 'method_not_allowed');
      assert.equal(get.headers.get('allow'), 'POST, OPTIONS');
      const pre = await fetch(`${base}/v1/search/jobs`, { method: 'OPTIONS' });
      assert.equal(pre.status, 204);
      assert.match(pre.headers.get('access-control-allow-methods') ?? '', /POST/);
    });
  });
}

// Stateless mode (LUNAR_JOBS_STATELESS=1, since 1.20.0): two servers play two instances that share nothing; the job
// created in one is read in the other through its statusUrl.
for (const workers of [0, 2]) {
  describe(`trabajos sin estado entre instancias (${workers ? 'pool de workers' : 'sin pool'})`, () => {
    const servers: (Server & { pool: unknown })[] = [];
    let a: string, b: string;
    before(async () => {
      const previous = process.env.LUNAR_JOBS_STATELESS;
      process.env.LUNAR_JOBS_STATELESS = '1';
      try {
        for (let i = 0; i < 2; i++) servers.push(createApp({ config: { workers }, terrainDir: null }));
      } finally {
        if (previous === undefined) delete process.env.LUNAR_JOBS_STATELESS; else process.env.LUNAR_JOBS_STATELESS = previous;
      }
      const bases = await Promise.all(servers.map(async (s) => {
        await (s.pool as { ready?: Promise<void> } | null)?.ready;
        await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
        return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
      }));
      [a, b] = bases;
    });
    after(() => Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r())))));

    test('POST en una instancia, la statusUrl en otra: terminado y con el mismo resultado que la búsqueda síncrona', async () => {
      const created = await call<Job>(a, `/v1/search/jobs?${Q}`, 'POST');
      assert.equal(created.status, 202);
      conforms(schemas.SearchJob, created.body);
      assert.equal(created.body.status, 'queued');
      assert.equal(created.body.request, `/v1/search?${Q}`);
      assert.equal(created.body.statusUrl, `/v1/search/jobs/${created.body.id}?${Q}`);
      assert.equal(created.headers.get('location'), created.body.statusUrl);
      const done = await call<Job>(b, created.body.statusUrl);
      assert.equal(done.status, 200);
      conforms(schemas.SearchJob, done.body);
      assert.equal(done.body.status, 'done', JSON.stringify(done.body.error));
      assert.equal(done.body.id, created.body.id);
      assert.equal(done.body.statusUrl, created.body.statusUrl);
      assert.deepEqual(done.body.result, (await call<V1Search>(b, `/v1/search?${Q}`)).body);
    });

    test('sin start, «ahora» queda fijado en la statusUrl', async () => {
      const created = await call<Job>(a, '/v1/search/jobs?latMin=-89.6&latMax=-89.3&lonMin=-30&lonMax=30&spacingKm=10&refineLevels=0&days=1', 'POST');
      const start = new URL(created.body.statusUrl, 'http://x').searchParams.get('start');
      assert.match(start!, /^\d{4}-\d\d-\d\dT/);
      const done = (await call<Job>(b, created.body.statusUrl)).body;
      assert.equal(done.status, 'done');
      assert.equal(done.result!.start.slice(0, 16), start!.slice(0, 16));
    });

    test('errores: 404 sin parámetros (con la pista), 400 si faltan start o un parámetro es inválido', async () => {
      const id = '00000000-0000-0000-0000-000000000000';
      const missing = await call<V1Error>(b, `/v1/search/jobs/${id}`);
      assert.equal(missing.status, 404);
      assert.match(missing.body.error.message, /statusUrl/);
      const noStart = await call<V1Error>(b, `/v1/search/jobs/${id}?latMin=-89.6&latMax=-89.3&lonMin=-30&lonMax=30`);
      assert.equal(noStart.status, 400);
      conforms(schemas.Error, noStart.body);
      const bad = await call<V1Error>(b, `/v1/search/jobs/${id}?spacingKm=0.1&start=2027-01-10`);
      assert.equal(bad.status, 400);
      assert.equal(bad.body.error.code, 'invalid_parameter');
    });
  });
}

describe('/v1/search: parámetros', () => {
  let server: Server, base: string;
  before(async () => {
    server = createApp({ config: { workers: 0 }, terrainDir: null });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));
  const codes = (ws?: V1Warning[]): string[] => (ws ?? []).map((w) => `${w.code}:${w.parameter ?? ''}`);

  test('400: región vacía, malla demasiado grande, con relieve preciso más de 300 puntos, terrainResolution inválido', async () => {
    for (const p of [
      '/v1/search?latMin=-80&latMax=-85',
      '/v1/search?region=global&spacingKm=5',
      '/v1/search?region=polo-sur&spacingKm=5&terrain=1&terrainResolution=precise',
      '/v1/search?terrain=1&terrainResolution=slow',
      '/v1/search?region=marte',
      '/v1/search?refineLevels=1.5',
    ]) {
      const r = await call<V1Error>(base, p);
      assert.equal(r.status, 400, p);
      assert.equal(r.body.error.code, 'invalid_parameter', p);
    }
  });

  test('avisos: nombres de la API interna y terrainResolution sin relieve; sin DEM, terrain_not_applied', async () => {
    const r = await call<V1Search>(base, '/v1/search?latMin=-89.6&latMax=-89.3&lonMin=-30&lonMax=30&spacingKm=10&refine=0&start=2027-01-10&days=2&terrainResolution=fast');
    assert.equal(r.status, 200);
    assert.deepEqual(codes(r.body.warnings), ['unknown_parameter:refine', 'ignored_parameter:terrainResolution']);
    assert.match(r.body.warnings![0].message, /refineLevels/);
    const t = await call<V1Search>(base, '/v1/search?latMin=-89.6&latMax=-89.3&lonMin=-30&lonMax=30&spacingKm=10&refineLevels=0&start=2027-01-10&days=2&terrain=1');
    assert.equal(t.body.terrainResolution, 'fast');
    assert.equal(t.body.terrain!.applied, false);
    assert.deepEqual(codes(t.body.warnings), ['terrain_not_applied:terrain']);
    assert.ok(t.body.results.every((x) => x.horizonModel === 'sphere'));
  });
});
