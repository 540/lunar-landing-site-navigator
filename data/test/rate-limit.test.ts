// Rate limit per client over HTTP (#161, API 1.21.0): off by default (nothing changes), and on, the 429 of v1 and of
// GraphQL with Retry-After and RateLimit-*, cache hits and exempt routes free, keys that skip it and the client's address
// behind a trusted proxy. Each test is a different client (X-Forwarded-For, one trusted proxy), so they do not interfere.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { parse as parseYaml } from 'yaml';
import { createApp } from '../src/server.ts';
import { validate } from './schema.ts';
import type { OpenApiSpec } from './schema.ts';

const spec = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const ERROR = { $ref: '#/components/schemas/Error' };

interface Raw { status: number; headers: http.IncomingHttpHeaders; body: string }
function raw(base: string, p: string, { headers = {}, method = 'GET', body }: { headers?: Record<string, string>; method?: string; body?: string } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = http.request(base + p, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const listen = async (server: http.Server): Promise<string> => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const close = (server: http.Server): Promise<void> => new Promise((r) => server.close(() => r()));

// Heavy: slope (DEM parameters); light: the Sun and the Earth at one instant. Every date explicit: they are cached.
const heavy = (day: number): string => `/v1/sun-earth?site=apollo11&date=2027-01-${String(day).padStart(2, '0')}T00:00:00Z&slope=1`;
const light = (day: number): string => `/v1/sun-earth?site=apollo11&date=2027-02-${String(day).padStart(2, '0')}T00:00:00Z`;
const RATE = 'ratelimit-limit';

test('apagado por defecto: sin cabeceras RateLimit-* ni 429, y CORS como antes', async () => {
  const server = createApp();
  const base = await listen(server);
  try {
    for (let i = 1; i <= 5; i++) {
      const r = await raw(base, `/v1/rank?sites=apollo11&start=2027-01-0${i}&days=1`);
      assert.equal(r.status, 200);
      assert.equal(r.headers[RATE], undefined);
    }
    const r = await raw(base, light(1));
    assert.equal(r.headers['access-control-expose-headers'], 'etag, retry-after, location');
    assert.equal(r.headers['access-control-allow-headers'], 'content-type, if-none-match');
  } finally { await close(server); }
});

describe('con el límite activo', () => {
  let server: http.Server, base: string;
  const previous = process.env.LUNAR_GRAPHQL_HEAVY_COST;
  before(async () => {
    process.env.LUNAR_GRAPHQL_HEAVY_COST = '5'; // a two-day `windows` (cost 5.2) is heavy, a `sites` (1) light
    server = createApp({
      config: {
        resultCacheBytes: 8 * 1024 * 1024,
        rateLimit: { lightPerMin: 60, heavyPerMin: 6, lightBurst: 4, heavyBurst: 2, trustProxy: 1, keys: ['clave-de-prueba'], maxClients: 100 },
      },
    });
    base = await listen(server);
  });
  after(async () => {
    if (previous === undefined) delete process.env.LUNAR_GRAPHQL_HEAVY_COST; else process.env.LUNAR_GRAPHQL_HEAVY_COST = previous;
    await close(server);
  });
  const from = (ip: string, extra: Record<string, string> = {}) => ({ headers: { 'x-forwarded-for': ip, ...extra } });

  test('v1: la tercera pesada da 429 con Retry-After, RateLimit-* y el formato de error de la v1', async () => {
    const c = from('203.0.113.1');
    const first = await raw(base, heavy(1), c);
    assert.equal(first.status, 200);
    assert.deepEqual([first.headers['ratelimit-limit'], first.headers['ratelimit-remaining'], first.headers['ratelimit-reset'], first.headers['ratelimit-policy']],
      ['2', '1', '10', '2;w=20;name="heavy"']);
    assert.equal((await raw(base, heavy(2), c)).status, 200);
    const over = await raw(base, heavy(3), c);
    assert.equal(over.status, 429);
    assert.equal(over.headers['retry-after'], '10');
    assert.equal(over.headers['ratelimit-remaining'], '0');
    assert.equal(over.headers['cache-control'], 'no-store');
    assert.match(String(over.headers['access-control-expose-headers']), /retry-after.*ratelimit-limit, ratelimit-remaining, ratelimit-reset, ratelimit-policy/);
    const body = JSON.parse(over.body);
    assert.equal(body.error.code, 'rate_limited');
    assert.match(body.error.message, /pesadas \(6 por minuto, hasta 2 seguidas\)\. Vuelve a intentarlo dentro de 10 s\./);
    assert.deepEqual(validate(spec, ERROR, body), []);
    // The light budget is another one.
    const l = await raw(base, light(1), c);
    assert.equal(l.status, 200);
    assert.equal(l.headers['ratelimit-policy'], '4;w=4;name="light"');
  });

  test('v1: lo que sale de la caché (y su 304) no gasta; health, docs, especificación y esquema no cuentan', async () => {
    const c = from('203.0.113.2');
    const first = await raw(base, heavy(1), c); // already in the cache (previous test): free
    assert.equal(first.status, 200);
    assert.equal(first.headers[RATE], undefined, 'de la caché: sin cobrar ni cabeceras');
    await raw(base, heavy(4), c);
    await raw(base, heavy(5), c);
    assert.equal((await raw(base, heavy(6), c)).status, 429);
    assert.equal((await raw(base, heavy(4), c)).status, 200, 'repetida, de la caché');
    assert.equal((await raw(base, heavy(4), from('203.0.113.2', { 'if-none-match': first.headers.etag! }))).status, 200);
    assert.equal((await raw(base, heavy(1), from('203.0.113.2', { 'if-none-match': first.headers.etag! }))).status, 304);
    for (let i = 0; i < 6; i++) {
      for (const p of ['/v1/health', '/docs', '/openapi.yaml', '/openapi.json', '/graphql/schema.graphql']) {
        const r = await raw(base, p, c);
        assert.equal(r.status, 200, p);
        assert.equal(r.headers[RATE], undefined, p);
      }
      assert.equal((await raw(base, '/graphql', from('203.0.113.2', { accept: 'text/html' }))).status, 200, 'GraphiQL');
    }
    const pre = await raw(base, '/v1/rank', { ...c, method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.match(String(pre.headers['access-control-allow-headers']), /x-api-key/);
  });

  test('la IP es la que añade el proxy de confianza: lo que mande el cliente en X-Forwarded-For no le da otro cupo', async () => {
    const real = '203.0.113.3';
    await raw(base, heavy(7), from(real));
    await raw(base, heavy(8), from(real));
    assert.equal((await raw(base, heavy(9), from(real))).status, 429);
    // The client sends its own X-Forwarded-For; the proxy appends the real address after it.
    assert.equal((await raw(base, heavy(10), from(`198.51.100.7, ${real}`))).status, 429);
    assert.equal((await raw(base, heavy(10), from(`${real}, 198.51.100.8`))).status, 200, 'otra dirección real, otro cupo');
  });

  test('una clave de LUNAR_API_KEYS en X-Api-Key salta el límite; una que no está, no', async () => {
    const c = '203.0.113.4';
    for (let d = 11; d <= 14; d++) {
      const r = await raw(base, heavy(d), from(c, { 'x-api-key': 'clave-de-prueba' }));
      assert.equal(r.status, 200);
      assert.equal(r.headers[RATE], undefined);
    }
    await raw(base, heavy(15), from(c, { 'x-api-key': 'otra' }));
    await raw(base, heavy(16), from(c, { 'x-api-key': 'otra' }));
    assert.equal((await raw(base, heavy(17), from(c, { 'x-api-key': 'otra' }))).status, 429);
  });

  test('trabajos de búsqueda: crear uno es pesado y el 429 va en el formato de la v1', async () => {
    const c = from('203.0.113.5');
    for (let i = 0; i < 2; i++) assert.equal((await raw(base, '/v1/search/jobs?spacingKm=nope', { ...c, method: 'POST' })).status, 400);
    const over = await raw(base, '/v1/search/jobs?spacingKm=nope', { ...c, method: 'POST' });
    assert.equal(over.status, 429);
    assert.equal(JSON.parse(over.body).error.code, 'rate_limited');
    assert.equal((await raw(base, '/v1/search/jobs/00000000-0000-0000-0000-000000000000', c)).status, 404, 'el estado es ligero');
  });

  test('GraphQL: 429 con Retry-After y extensions.code rate_limited; ligera o pesada según el coste; la caché no gasta', async () => {
    const c = from('203.0.113.6', { 'content-type': 'application/json' });
    const post = (query: string): Promise<Raw> => raw(base, '/graphql', { ...c, method: 'POST', body: JSON.stringify({ query }) });
    const windows = (day: number): string => `{ site(id: "apollo11") { windows(from: "2027-03-${String(day).padStart(2, '0')}", to: "2027-03-${String(day + 2).padStart(2, '0')}") { sun { summary { count } } } } }`;
    const a = await post(windows(1));
    assert.equal(a.status, 200);
    assert.equal(a.headers['ratelimit-policy'], '2;w=20;name="heavy"');
    assert.equal((await post(windows(4))).status, 200);
    const over = await post(windows(7));
    assert.equal(over.status, 429);
    assert.equal(over.headers['retry-after'], '10');
    const body = JSON.parse(over.body);
    assert.equal(body.errors[0].extensions.code, 'rate_limited');
    assert.match(body.errors[0].message, /peticiones pesadas/);
    assert.equal((await post(windows(1))).status, 200, 'la misma consulta, de la caché');
    // Cheap queries take from the light budget (4).
    const ids = ['apollo11', 'im1', 'chandrayaan3', 'shackleton-rim', 'apollo12'];
    for (const id of ids.slice(0, 4)) assert.equal((await post(`{ sites(ids: ["${id}"]) { id } }`)).status, 200, id);
    const lightOver = await post(`{ sites(ids: ["${ids[4]}"]) { id } }`);
    assert.equal(lightOver.status, 429);
    assert.match(JSON.parse(lightOver.body).errors[0].message, /peticiones ligeras/);
  });
});

test('openapi documenta el 429 (con Retry-After y RateLimit-*) y el código rate_limited', () => {
  const s = spec as unknown as {
    paths: Record<string, Record<string, { responses: Record<string, { $ref?: string }> }>>;
    components: { responses: Record<string, { headers?: Record<string, unknown> }> };
  };
  for (const [path, item] of Object.entries(s.paths)) {
    for (const op of Object.values(item)) {
      if (path === '/v1/health') assert.equal(op.responses['429'], undefined, path);
      else assert.equal(op.responses['429']?.$ref, '#/components/responses/TooManyRequests', path);
    }
  }
  assert.deepEqual(Object.keys(s.components.responses.TooManyRequests.headers ?? {}), ['Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit-Policy']);
  assert.deepEqual(validate(spec, ERROR, { error: { code: 'rate_limited', message: '…' } }), []);
});
