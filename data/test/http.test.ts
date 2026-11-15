// HTTP of v1 since 1.10.0: compression (the same bytes once decompressed), ETag and 304, Cache-Control, security headers
// that leave /docs working, landing-dates without the series (dates=0), and the v1 errors 414 and 503 (worker pool).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';
import { API_VERSION } from '../src/v1.ts';
import { validate } from './schema.ts';
import type { OpenApiSpec } from './schema.ts';
import { asOf1_12 } from './contract.ts';

const spec = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const contract = JSON.parse(readFileSync(new URL('./fixtures/v1-contract-1.9.0.json', import.meta.url), 'utf8')) as Record<string, unknown>;

interface Raw { status: number; headers: http.IncomingHttpHeaders; body: Buffer }
function raw(base: string, p: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}
const listen = async (server: http.Server): Promise<string> => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe('v1 sin pool', () => {
  let server: http.Server, base: string;
  before(async () => { server = createApp(); base = await listen(server); });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test('comprimidas, las respuestas del contrato 1.9.0 son las mismas byte a byte', async () => {
    for (const p of Object.keys(contract).filter((k) => k !== '/v1/health')) {
      const r = await raw(base, p, { 'accept-encoding': 'gzip, br' });
      assert.equal(r.status, 200, p);
      const text = r.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(r.body).toString()
        : r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.body).toString() : r.body.toString();
      assert.equal(asOf1_12(text), JSON.stringify(contract[p]), p);
      if (text.length >= 1024) assert.equal(r.headers['content-encoding'], 'br', p);
    }
  });

  test('ETag, 304 y Cache-Control (público solo con la fecha explícita)', async () => {
    const p = '/v1/sun-earth?site=apollo11&date=2027-01-15T00:00:00Z';
    const a = await raw(base, p);
    assert.equal(a.headers['cache-control'], 'public, max-age=3600');
    const b = await raw(base, p, { 'if-none-match': a.headers.etag! });
    assert.equal(b.status, 304);
    assert.equal(b.body.length, 0);
    assert.equal((await raw(base, '/v1/sun-earth?site=apollo11')).headers['cache-control'], 'no-cache');
    assert.equal((await raw(base, '/v1/horizon?site=apollo11')).headers['cache-control'], 'public, max-age=3600');
    assert.equal((await raw(base, '/v1/health')).headers['cache-control'], 'no-cache');
    assert.equal((await raw(base, '/v1/rank?sites=apollo11&start=nope')).headers['cache-control'], 'no-store');
  });

  test('cabeceras de seguridad; /docs sin CSP (carga Swagger UI de jsDelivr) y HEAD sin cuerpo', async () => {
    const j = await raw(base, '/v1/sites');
    assert.equal(j.headers['x-content-type-options'], 'nosniff');
    assert.match(String(j.headers['content-security-policy'] ?? ''), /default-src 'none'/);
    assert.equal(j.headers['access-control-allow-origin'], '*');
    const docs = await raw(base, '/docs');
    assert.equal(docs.status, 200);
    assert.match(String(docs.headers['content-type'] ?? ''), /text\/html/);
    assert.equal(docs.headers['content-security-policy'], undefined);
    assert.match(docs.body.toString(), /swagger-ui/);
    const head = await raw(base, '/v1/sites', {}, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    const redirect = await raw(base, '/');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, '/docs');
    const notAllowed = await raw(base, '/v1/sites', {}, 'POST');
    assert.equal(notAllowed.status, 405);
    assert.equal(notAllowed.headers.allow, 'GET, HEAD, OPTIONS');
  });

  test('414 con el formato de error de v1', async () => {
    const r = await raw(base, `/v1/sites?x=${'a'.repeat(9000)}`);
    assert.equal(r.status, 414);
    const body = JSON.parse(r.body.toString());
    assert.equal(body.error.code, 'uri_too_long');
    assert.deepEqual(validate(spec, { $ref: '#/components/schemas/Error' }, body), []);
  });

  test('landing-dates con dates=0: sin la serie, el resto idéntico y conforme al esquema; el parámetro está documentado', async () => {
    const p = '/v1/landing-dates?site=im1&start=2027-01-01&end=2027-12-31&dateStep=12h';
    const full = await raw(base, p), summary = await raw(base, `${p}&dates=0`);
    assert.equal(summary.status, 200);
    const s = JSON.parse(summary.body.toString()), f = JSON.parse(full.body.toString());
    assert.ok(!('dates' in s) && !('warnings' in s));
    const { dates: _d, ...rest } = f;
    assert.equal(JSON.stringify(s), JSON.stringify(rest));
    assert.ok(summary.body.length < full.body.length / 10, `${summary.body.length} B frente a ${full.body.length} B`);
    const schema = spec.paths['/v1/landing-dates'].get!.responses!['200'].content['application/json'].schema;
    assert.deepEqual(validate(spec, schema, s), []);
    assert.equal(JSON.parse((await raw(base, `${p}&dates=1`)).body.toString()).dates.length, f.dates.length);
    const bad = await raw(base, `${p}&dates=no`);
    assert.equal(bad.status, 400);
    assert.match(JSON.parse(bad.body.toString()).error.message, /dates/);
    const params = (spec.paths['/v1/landing-dates'].get as { parameters: { name?: string }[] }).parameters.map((x) => x.name);
    assert.ok(params.includes('dates'));
  });

  test('openapi documenta 304, 414, 503 (con Retry-After) y 504', () => {
    const r = (spec.paths['/v1/rank'].get as { responses: Record<string, { $ref?: string }> }).responses;
    assert.deepEqual(['304', '414', '503', '504'].map((c) => r[c]?.$ref), [
      '#/components/responses/NotModified', '#/components/responses/UriTooLong', '#/components/responses/Overloaded', '#/components/responses/Timeout',
    ]);
    const comps = (spec as unknown as { components: { responses: Record<string, { headers?: Record<string, unknown> }> } }).components.responses;
    assert.ok(comps.Overloaded.headers?.['Retry-After']);
    assert.equal((spec as unknown as { info: { version: string } }).info.version, API_VERSION);
  });
});

test('v1 con pool: 503 con Retry-After y error overloaded cuando la cola está llena', async () => {
  const server = createApp({ config: { workers: 1, queueMax: 0, retryAfterS: 3 }, terrainDir: null });
  await server.pool!.ready;
  const base = await listen(server);
  try {
    const slow = '/v1/landing-dates?site=im1&start=2027-01-01&end=2028-02-01&dateStep=1h&days=60';
    const first = raw(base, slow);
    await new Promise((r) => setTimeout(r, 20));
    const r = await raw(base, '/v1/rank?sites=all&start=2027-01-01&days=120');
    assert.equal(r.status, 503);
    assert.equal(r.headers['retry-after'], '3');
    const body = JSON.parse(r.body.toString());
    assert.equal(body.error.code, 'overloaded');
    assert.deepEqual(validate(spec, { $ref: '#/components/schemas/Error' }, body), []);
    const h = await raw(base, '/v1/health');
    assert.equal(h.status, 200);
    assert.equal((await first).status, 200);
    // With the pool, the same bytes as the contract.
    const c = await raw(base, '/v1/rank?sites=all&start=2027-01-01&days=30');
    assert.equal(c.body.toString(), JSON.stringify(contract['/v1/rank?sites=all&start=2027-01-01&days=30']));
  } finally { await new Promise<void>((r) => server.close(() => r())); }
});
