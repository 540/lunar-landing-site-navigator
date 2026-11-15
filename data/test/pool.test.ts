// Worker pool of the server (backend/src/httpServe.ts, pool.ts) with the public API: same bytes as in the main thread,
// masks computed once across workers, light requests not waiting behind heavy ones, deterministic requests computed once,
// asynchronous search in the pool, reserved light worker and timeout (504). Moved from backend/ when its internal API
// /api/* was removed (#61); compression, ETag, Cache-Control, 414 and the full queue are in http.test.ts.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ServerResponse } from 'node:http';
import { createApp, handle } from '../src/server.ts';
import { configureDem } from '../../backend/src/terrain/dem.ts';
import { configureMasks } from '../../backend/src/horizon.ts';
import { chooseEncoding } from '../../backend/src/httpServe.ts';
import { ephemerisTableFilled, ephemerisTableStats } from '../../backend/src/ephemerisTable.ts';

interface Raw { status: number; headers: http.IncomingHttpHeaders; body: Buffer }
/** GET (or another method) without automatic decompression: the bytes as they travel. */
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
const close = (server: http.Server): Promise<void> => new Promise((r) => server.close(() => r()));
/** Body without the timings (the only field that changes from one run to another). */
const stable = (text: string): string => text.replace(/"timingMs":(\{[^}]*\}|\d+)/g, '"timingMs":0');
/** The handler without a pool, as before (fake response). */
const inline = (url: string): Promise<{ status: number; text: string }> => new Promise((resolve) => {
  const res = {
    status: 0,
    writeHead(status: number) { this.status = status; },
    end(body: Buffer) { resolve({ status: this.status, text: String(body) }); },
  };
  handle({ method: 'GET', url }, res as unknown as ServerResponse);
});

/** Synthetic DEM written as a terrain cache (<dir>/cache/*.json + *.f32), so that the workers can read it too. */
function writeDem(dir: string): void {
  const res = 240, halfKm = 200, n = Math.round((2 * halfKm * 1000) / res), a = new Float32Array(n * n);
  const X0 = -halfKm * 1000, Y0 = halfKm * 1000;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = 800 * Math.sin((X0 + (i + 0.5) * res) / 9000) * Math.cos((Y0 - (j + 0.5) * res) / 7000);
  fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'cache', 'SYN_240m.json'), JSON.stringify({ product: 'SYN', res, X0, Y0, c0: 0, r0: 0, w: n, h: n }));
  fs.writeFileSync(path.join(dir, 'cache', 'SYN_240m.f32'), Buffer.from(a.buffer));
}

test('chooseEncoding: br antes que gzip, q=0 excluye, * vale', () => {
  assert.equal(chooseEncoding('gzip, deflate, br'), 'br');
  assert.equal(chooseEncoding('gzip'), 'gzip');
  assert.equal(chooseEncoding('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(chooseEncoding('*'), 'br');
  assert.equal(chooseEncoding('identity'), null);
  assert.equal(chooseEncoding(undefined), null);
});

describe('pool de workers (relieve sintético en disco)', () => {
  const terrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-dem-'));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-masks-'));
  writeDem(terrainDir);
  let server: ReturnType<typeof createApp>, base: string;
  before(async () => {
    // No reserved light worker: two heavy requests at once must run in two workers (coalescing of masks).
    server = createApp({ config: { workers: 2, lightWorkers: 0, queueMax: 8 }, terrainDir, env: { ...process.env, LUNAR_MASK_CACHE_DIR: cacheDir } });
    await server.pool!.ready;
    base = await listen(server);
    // The main thread (handler without pool) with the same DEM, to compare.
    configureDem({ dir: terrainDir });
    configureMasks({ diskCache: false });
  });
  after(async () => {
    await close(server);
    configureDem({ dir: null });
    fs.rmSync(terrainDir, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  const SAME = [
    '/v1/search?latMin=-89.6&latMax=-89.4&lonMin=-10&lonMax=10&spacingKm=4&refineLevels=1&start=2027-01-10&days=3&terrain=1',
    '/v1/rank?sites=-89.3:15,shackleton-rim&start=2027-01-10&days=5&terrain=1&panelHeightM=2&antennaHeightM=10',
    '/v1/landing-dates?lat=-89.35&lon=-20&start=2027-01-01&end=2027-01-20&days=7&terrain=1',
    '/v1/sun-earth?site=apollo11&date=2027-01-15T00:00:00Z',
    '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-02-01&terrain=1',
    '/v1/search?region=nope',
  ];
  test('mismo cuerpo, byte a byte (salvo timingMs), que sin pool', async () => {
    for (const p of SAME) {
      const [a, b] = await Promise.all([raw(base, p), inline(p)]);
      assert.equal(a.status, b.status, p);
      assert.equal(stable(a.body.toString()), stable(b.text), p);
    }
  });

  test('coalescencia: dos workers que piden a la vez la misma máscara nueva la calculan una sola vez', async () => {
    const before0 = server.pool!.terrainCounters();
    const [a, b] = await Promise.all([
      raw(base, '/v1/rank?sites=-89.123:12.345&start=2027-01-10&days=2&terrain=1'),
      raw(base, '/v1/landing-dates?lat=-89.123&lon=12.345&start=2027-01-10&end=2027-01-11&days=2&terrain=1'),
    ]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    const t = server.pool!.terrainCounters();
    assert.equal(t.computed - before0.computed, 1, 'una sola máscara calculada');
    assert.equal((t.fromDisk + t.fromMemory) - (before0.fromDisk + before0.fromMemory), 1, 'la otra petición la ha leído');
    assert.equal(server.pool!.status().workers, 2);
    const left = (fs.readdirSync(cacheDir, { recursive: true }) as string[]).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock'));
    assert.deepEqual(left, [], 'sin temporales ni cerrojos');
  });

  test('health responde al momento con los workers ocupados; dos peticiones deterministas iguales se calculan una vez', async () => {
    const heavy = '/v1/search?region=polo-sur&start=2027-01-01&days=20&spacingKm=12&refineLevels=0';
    const work = Promise.all([raw(base, heavy), raw(base, heavy), raw(base, `${heavy}&top=3`)]);
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const h = await raw(base, '/v1/health');
    const ms = performance.now() - t0;
    assert.equal(h.status, 200);
    assert.ok(ms < 100, `health ha tardado ${ms.toFixed(1)} ms`);
    const [x, y] = await work;
    assert.equal(x.body.toString(), y.body.toString(), 'la segunda ha recibido el mismo cálculo (mismo timingMs)');
  });

  test('búsqueda asíncrona en el pool: progreso y resultado igual al de la síncrona', async () => {
    const q = 'latMin=-89.6&latMax=-89.4&lonMin=-10&lonMax=10&spacingKm=3&refineLevels=1&start=2027-01-10&days=3&terrain=1';
    const job = JSON.parse((await raw(base, `/v1/search/jobs?${q}`, {}, 'POST')).body.toString());
    let state = job;
    for (let i = 0; i < 300 && !['done', 'error'].includes(state.status); i++) {
      await new Promise((r) => setTimeout(r, 20));
      state = JSON.parse((await raw(base, `/v1/search/jobs/${job.id}`)).body.toString());
    }
    assert.equal(state.status, 'done', JSON.stringify(state.error));
    assert.ok(state.startedAt && state.finishedAt);
    assert.equal(state.progress.fraction, 1);
    assert.equal(state.request, `/v1/search?${q}`);
    const sync = await inline(`/v1/search?${q}`);
    assert.equal(stable(JSON.stringify(state.result)), stable(sync.text));
  });
});

describe('límites del pool', () => {
  const slow = '/v1/search?region=polo-sur&start=2027-01-01&days=60&spacingKm=8&refineLevels=0';

  test('worker reservado: una petición ligera no espera detrás de las pesadas', async () => {
    const server = createApp({ config: { workers: 2, queueMax: 8 }, terrainDir: null });
    await server.pool!.ready;
    const base = await listen(server);
    try {
      assert.equal(server.pool!.status().lightReserved, 1);
      const heavy = [1, 2, 3].map((i) => raw(base, `${slow}&top=${i}`));
      await new Promise((r) => setTimeout(r, 50));
      const t0 = performance.now();
      const light = await raw(base, '/v1/sun-earth?site=apollo11&date=2027-01-15T00:00:00Z');
      const ms = performance.now() - t0;
      assert.equal(light.status, 200);
      const pending = server.pool!.status();
      assert.ok(pending.busy + pending.queued >= 2, 'las pesadas siguen en marcha o en cola');
      assert.ok(ms < 1000, `la ligera ha tardado ${ms.toFixed(0)} ms`);
      for (const r of await Promise.all(heavy)) assert.equal(r.status, 200);
    } finally { await close(server); }
  });

  test('timeout: 504 y el worker se sustituye', async () => {
    // One timeout serves two opposite purposes: the heavy search must exceed it and the snapshot answered by the
    // freshly started replacement worker (cold engine: ~90 ms on a fast machine) must not. With 150 ms that second
    // margin was under 2× and a slow CI runner hit it. Now 1 s against a search that needs ~3 s on a fast machine
    // (it never finishes: the worker is terminated at the timeout) and ~90 ms for the cold snapshot: >3× and >10×.
    const heavier = '/v1/search?region=polo-sur&start=2027-01-01&days=120&spacingKm=4&refineLevels=0';
    const server = createApp({ config: { workers: 1, queueMax: 4, timeoutMs: 1000 }, terrainDir: null });
    await server.pool!.ready;
    const base = await listen(server);
    try {
      const r = await raw(base, heavier);
      assert.equal(r.status, 504);
      assert.match(JSON.parse(r.body.toString()).error.message, /tiempo máximo/);
      // Wait for the replacement worker to load the engine: the timeout counts the time in the queue too.
      for (let i = 0; i < 500 && server.pool!.status().ready < 1; i++) await new Promise((res) => setTimeout(res, 20));
      assert.equal(server.pool!.status().ready, 1, 'el worker de repuesto no ha arrancado en 10 s');
      const ok = await raw(base, '/v1/sun-earth?site=apollo11&date=2027-01-15');
      assert.equal(ok.status, 200);
      assert.equal(server.pool!.status().restarts, 1);
    } finally { await close(server); }
  });
});

describe('tabla de efemérides compartida por los workers (#417)', () => {
  const WINDOWS = [
    '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-02-01',
    '/v1/windows?site=apollo11&start=2027-03-01T00:07:00Z&end=2027-03-05',
    '/v1/windows?lat=-89.3&lon=15&start=2030-12-20&end=2031-01-01',
  ];
  /** Bodies of WINDOWS from a pool of 2 workers with `env` (twice each: table empty, then filled). */
  async function bodies(env: Record<string, string | undefined>): Promise<{ texts: string[]; filled: number | null }> {
    const server = createApp({ config: { workers: 2, queueMax: 8 }, terrainDir: null, env });
    await server.pool!.ready;
    const base = await listen(server);
    try {
      const texts: string[] = [];
      for (let round = 0; round < 2; round++) {
        for (const p of WINDOWS) {
          const r = await raw(base, p);
          assert.equal(r.status, 200, p);
          texts.push(stable(r.body.toString()));
        }
      }
      const table = server.pool!.ephemerisTable;
      return { texts, filled: table ? ephemerisTableFilled(table) : null };
    } finally { await close(server); }
  }

  test('/v1/windows da los mismos bytes (salvo timingMs) con LUNAR_EPHEMERIS_TABLE=0 y sin esa variable', async () => {
    // Without NODE_TEST_CONTEXT the pool behaves as in production: no variable = table on.
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.LUNAR_EPHEMERIS_TABLE;
    const on = await bodies(env);
    const off = await bodies({ ...env, LUNAR_EPHEMERIS_TABLE: '0' });
    assert.equal(off.filled, null, 'apagada: el pool no crea tabla');
    assert.ok(on.filled !== null && on.filled > 0, `los workers rellenan la tabla del pool (${on.filled})`);
    assert.deepEqual(on.texts, off.texts);
    for (const [i, p] of WINDOWS.entries()) assert.equal(on.texts[i], stable((await inline(p)).text), `sin pool: ${p}`);
  });
});

describe('tabla de efemérides sin pool (LUNAR_WORKERS=0, #417)', () => {
  const A = '/v1/windows?site=shackleton-rim&start=2027-04-01&end=2027-05-01';
  const B = '/v1/windows?site=shackleton-rim&start=2027-04-01&end=2027-04-20'; // instants of A again: hits
  /** Bodies of A and B from a server without a pool created with `env`, and the stats of this thread meanwhile. */
  async function run(env: Record<string, string | undefined>): Promise<{ texts: string[]; hits: number; misses: number }> {
    const server = createApp({ config: { workers: 0 }, terrainDir: null, env });
    assert.equal(server.pool, null);
    const base = await listen(server);
    try {
      const s0 = ephemerisTableStats();
      const texts: string[] = [];
      for (const p of [A, B]) {
        const r = await raw(base, p);
        assert.equal(r.status, 200, p);
        texts.push(stable(r.body.toString()));
      }
      const s1 = ephemerisTableStats();
      return { texts, hits: s1.hits - s0.hits, misses: s1.misses - s0.misses };
    } finally { await close(server); }
  }

  test('el hilo principal adopta su tabla, da los mismos bytes que apagada y un handler con LUNAR_EPHEMERIS_TABLE=0 la suelta', async () => {
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.LUNAR_EPHEMERIS_TABLE;
    const on = await run(env);
    assert.ok(on.misses > 0, `la primera petición rellena la tabla (${on.misses} fallos)`);
    assert.ok(on.hits > 0, `la segunda la lee (${on.hits} aciertos)`);
    // A later handler with the table off releases it: the same requests no longer touch it.
    const off = await run({ ...env, LUNAR_EPHEMERIS_TABLE: '0' });
    assert.equal(off.hits, 0);
    assert.equal(off.misses, 0);
    assert.deepEqual(on.texts, off.texts);
  });
});
