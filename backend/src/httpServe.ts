// HTTP layer of the public API v1 (data/src/server.ts): backend/ has no HTTP server of its own since #61.
//
// Each server describes its routes (an Endpoint) and this layer decides where they run and how they are sent:
//  - in a worker of the pool (pool.ts) or, without a pool (LUNAR_WORKERS=0, tests), in the main thread as before;
//  - ETag (hash of the uncompressed body) and 304 when If-None-Match matches;
//  - Cache-Control: public with max-age only when the response is deterministic (every date given explicitly, nothing
//    depends on «now»); no-cache otherwise (revalidation with the ETag) and no-store for errors;
//  - gzip or brotli by Accept-Encoding for bodies over 1 KiB, in libuv's thread pool (it does not block the event loop);
//  - basic security headers that do not get in the way of CORS or of /docs;
//  - limits: URL length (414), queue of the pool (503 with Retry-After) and time per request (504);
//  - optionally (LUNAR_RATE_LIMIT=1, since API 1.21.0), a rate limit per client: 429 with Retry-After (rateLimit.ts).
// Two identical deterministic requests in flight at the same time are computed once, and a deterministic response is
// kept in a bounded LRU (ResultStore, LUNAR_RESULT_CACHE_MB): repeating it, or revalidating it (304), costs no
// computation (since API 1.13.0). Its compressed bodies are kept with it.
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { QueueFullError, TaskTimeoutError, WorkerPool, defaultPoolSize } from './pool.ts';
import type { Prepared, Priority, RouteTask } from './pool.ts';
import { RateLimiter, UNMETERED, rateLimitConfig, rateLimitCors } from './rateLimit.ts';
import type { Meter, RateLimitConfig, RateRejection } from './rateLimit.ts';

/** A response as the routes produce it (body not yet encoded). */
export interface Computed { status: number; headers: Record<string, string>; body: string }

/** Limits and caching, from the environment (documented in backend/README.md, «Servidor»). */
export interface ServeConfig {
  workers: number;
  /** Workers reserved for light requests (LUNAR_LIGHT_WORKERS); null = the default of the pool (1 from 2 workers up). */
  lightWorkers: number | null;
  queueMax: number;
  timeoutMs: number;
  jobTimeoutMs: number;
  maxUrlLength: number;
  maxAgeS: number;
  retryAfterS: number;
  compressMinBytes: number;
  /** Budget of the result cache, bytes of uncompressed bodies (LUNAR_RESULT_CACHE_MB; 0 = off, and off under node --test). */
  resultCacheBytes: number;
  /** Rate limit per client (LUNAR_RATE_LIMIT=1 and LUNAR_RATE_*; rateLimit.ts); null = off, the default. */
  rateLimit: RateLimitConfig | null;
}

const int = (env: Record<string, string | undefined>, name: string, fallback: number, min = 0): number => {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} debe ser un entero mayor o igual que ${min} (vale «${raw}»)`);
  return n;
};

export function serveConfig(env: Record<string, string | undefined> = process.env): ServeConfig {
  return {
    workers: defaultPoolSize(env),
    lightWorkers: env.LUNAR_LIGHT_WORKERS ? int(env, 'LUNAR_LIGHT_WORKERS', 0) : null,
    queueMax: int(env, 'LUNAR_QUEUE_MAX', 32),
    timeoutMs: int(env, 'LUNAR_REQUEST_TIMEOUT_MS', 120000, 1),
    jobTimeoutMs: int(env, 'LUNAR_JOB_TIMEOUT_MS', 600000, 1),
    maxUrlLength: int(env, 'LUNAR_MAX_URL_LENGTH', 8192, 64),
    maxAgeS: int(env, 'LUNAR_CACHE_MAX_AGE_S', 3600),
    retryAfterS: int(env, 'LUNAR_RETRY_AFTER_S', 5, 1),
    compressMinBytes: 1024,
    resultCacheBytes: int(env, 'LUNAR_RESULT_CACHE_MB', env.NODE_TEST_CONTEXT ? 0 : 64) * 1024 * 1024,
    rateLimit: rateLimitConfig(env),
  };
}

/**
 * Results of a server: an LRU of deterministic responses (bounded by the bytes of their bodies; an entry bigger than a
 * quarter of the budget is not kept) and the computations in flight, so that identical ones run once.
 */
export class ResultStore {
  readonly maxBytes: number;
  private readonly lru = new Map<string, Prepared>();
  private readonly inflight = new Map<string, Promise<Prepared>>();
  private bytes = 0;
  private counters = { hits: 0, misses: 0, coalesced: 0, evicted: 0 };
  constructor(maxBytes: number) { this.maxBytes = maxBytes; }

  /** A kept response (it becomes the most recent), or undefined. */
  get(key: string): Prepared | undefined {
    const p = this.lru.get(key);
    if (p) { this.lru.delete(key); this.lru.set(key, p); this.counters.hits++; }
    return p;
  }

  /** Is a response kept for `key`? (it does not count as a hit nor change the order) */
  has(key: string): boolean { return this.lru.has(key); }

  set(key: string, p: Prepared): void {
    const size = p.body.byteLength + key.length;
    if (this.maxBytes <= 0 || size > this.maxBytes / 4) return;
    const old = this.lru.get(key);
    if (old) { this.lru.delete(key); this.bytes -= old.body.byteLength + key.length; }
    this.lru.set(key, p);
    this.bytes += size;
    for (const [k, v] of this.lru) {
      if (this.bytes <= this.maxBytes) break;
      this.lru.delete(k); this.bytes -= v.body.byteLength + k.length; this.counters.evicted++;
    }
  }

  /**
   * The response of `key`: kept (when `cache`), the one already being computed (when `cache` or `coalesce`) or a new
   * computation with `run`, kept afterwards when `cache` and `keep(response)` (by default, a 200).
   */
  run(key: string, { cache, coalesce = cache, keep = (p: Prepared) => p.status === 200 }: { cache: boolean; coalesce?: boolean; keep?: (p: Prepared) => boolean }, run: () => Promise<Prepared>): Promise<Prepared> {
    const hit = cache ? this.get(key) : undefined;
    if (hit) return Promise.resolve(hit);
    const flying = coalesce ? this.inflight.get(key) : undefined;
    if (flying) { this.counters.coalesced++; return flying; }
    this.counters.misses++;
    const p = run();
    if (coalesce) {
      this.inflight.set(key, p);
      const forget = (): void => { if (this.inflight.get(key) === p) this.inflight.delete(key); };
      p.then(forget, forget);
    }
    if (cache) p.then((r) => { if (keep(r)) this.set(key, r); }, () => {});
    return p;
  }

  status(): { entries: number; bytes: number; maxBytes: number; hits: number; misses: number; coalesced: number; evicted: number } {
    return { entries: this.lru.size, bytes: this.bytes, maxBytes: this.maxBytes, ...this.counters };
  }
}

/** Key of a request in the result cache: method and path with its parameters sorted (duplicates keep their order). */
export function resultKey(method: string, url: URL): string {
  const q = new URLSearchParams(url.search);
  q.sort();
  const query = q.toString();
  return `${method === 'HEAD' ? 'GET' : method} ${url.pathname}${query ? `?${query}` : ''}`;
}

/** How a server's routes are described to this layer. */
export interface Endpoint {
  /** CORS headers of every response. */
  cors: Record<string, string>;
  /** Error body in the style of the API. */
  error(status: number, message: string, code?: string): Computed;
  /** Runs a route (in the worker or in the main thread). */
  compute(task: RouteTask, hooks?: { progress?: (p: unknown) => void }): Prepared;
  /** Routes cheap enough for the main thread (health, catalogue, static files, unknown routes…). */
  inline(method: string, url: URL): boolean;
  /** Heavy request (search, sweep, terrain…): queued after the light ones. */
  heavy(url: URL): boolean;
  /** Routes that never count for the rate limit (health, the spec, /docs). */
  free?(method: string, url: URL): boolean;
  /** Deterministic response (every date explicit): it can be cached publicly. */
  deterministic(url: URL): boolean;
  /** Module the workers import (it exports `compute`). */
  handler: string;
  /** Adds `server-timing` (calc;dur) to every response. */
  serverTiming?: boolean;
  /**
   * Routes answered in the main thread with access to the pool (jobs, status, GraphQL). null → not handled. The response
   * is not publicly cacheable unless it says `cacheable: true`.
   */
  special?(req: IncomingMessage, url: URL, ctx: ServeContext): Promise<Special> | Special | null;
  /** Extra CORS headers of the preflight (OPTIONS) of a path, over `cors` (for example, a route that also takes POST). */
  preflight?(url: URL): Record<string, string> | null;
}

/** Response of a special route: computed or prepared, and whether it may be cached publicly. */
export type Special = (Computed | Prepared) & { cacheable?: boolean };

export interface ServeContext {
  pool: WorkerPool | null; config: ServeConfig; endpoint: Endpoint; results: ResultStore;
  /** Rate limiter of the server (null: off). */
  limiter: RateLimiter | null;
  /**
   * Rate limit of the request being answered: a special route charges it (light or heavy) when it is going to compute,
   * and answers the rejection with a 429 in its own error format. The handler adds its headers to the response.
   */
  meter: Meter;
}

/** Encodes a computed response and, for a 200, its weak ETag (SHA-1 of the body). */
export function prepare(c: Computed): Prepared {
  const body = new TextEncoder().encode(c.body);
  const etag = c.status === 200 ? `W/"${createHash('sha1').update(body).digest('base64url')}"` : null;
  return { status: c.status, headers: c.headers, body, etag };
}

const SECURITY_JSON: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'cross-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};
// HTML (Swagger UI from jsDelivr in /docs): no CSP, so the page keeps loading its scripts and styles.
const SECURITY_HTML: Record<string, string> = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN' };

/** Does If-None-Match match the ETag? (weak comparison, list or *) */
function notModified(req: Pick<IncomingMessage, 'headers'>, etag: string): boolean {
  const inm = req.headers?.['if-none-match'];
  if (!inm) return false;
  if (inm.trim() === '*') return true;
  const bare = etag.replace(/^W\//, '');
  return inm.split(',').some((t) => t.trim().replace(/^W\//, '') === bare);
}

/** Preferred encoding of Accept-Encoding: br, then gzip (q=0 excludes it). null = identity. */
export function chooseEncoding(header: string | string[] | undefined): 'br' | 'gzip' | null {
  if (!header) return null;
  const accepted = new Map<string, number>();
  for (const part of String(header).toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)).find(Boolean);
    accepted.set(name.trim(), q ? Number(q[1]) : 1);
  }
  const ok = (n: string): boolean => (accepted.get(n) ?? (accepted.has('*') ? accepted.get('*')! : 0)) > 0;
  return ok('br') ? 'br' : ok('gzip') ? 'gzip' : null;
}

/** Compressed bodies of the responses still referenced (the result cache keeps them alive; the rest are collected). */
const compressed: WeakMap<Uint8Array, Partial<Record<'br' | 'gzip', Buffer>>> = new WeakMap();

/** Writes a prepared response: headers, 304, compression. Synchronous when there is nothing to compress. */
export function writeResponse(
  req: Pick<IncomingMessage, 'method' | 'headers'>, res: ServerResponse, p: Prepared,
  { endpoint, config, cacheable, startedAt, extra = {} }: { endpoint: Endpoint; config: ServeConfig; cacheable: boolean; startedAt: number; extra?: Record<string, string> },
): void {
  const type = p.headers['content-type'] ?? '';
  const headers: Record<string, string | number> = {
    ...endpoint.cors,
    ...(type.startsWith('text/html') ? SECURITY_HTML : SECURITY_JSON),
    ...p.headers,
    ...extra,
  };
  if (endpoint.serverTiming) headers['server-timing'] = `calc;dur=${(performance.now() - startedAt).toFixed(1)}`;
  if (p.status === 200 && p.etag) {
    headers.etag = p.etag;
    headers['cache-control'] = cacheable && config.maxAgeS > 0 ? `public, max-age=${config.maxAgeS}` : 'no-cache';
  } else if (p.status >= 400) headers['cache-control'] = 'no-store';
  const compressible = p.body.length >= config.compressMinBytes;
  if (compressible) headers.vary = 'accept-encoding';
  if (p.status === 200 && p.etag && notModified(req, p.etag)) {
    delete headers['content-type'];
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const encoding = compressible ? chooseEncoding(req.headers?.['accept-encoding']) : null;
  const send = (body: Uint8Array, enc: string | null): void => {
    if (enc) headers['content-encoding'] = enc;
    headers['content-length'] = body.length;
    res.writeHead(p.status, headers);
    res.end(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  };
  if (!encoding) return send(p.body, null);
  const kept = compressed.get(p.body)?.[encoding];
  if (kept) return send(kept, encoding);
  const done = (err: Error | null, out: Buffer): void => {
    if (err) return send(p.body, null);
    compressed.set(p.body, { ...compressed.get(p.body), [encoding]: out });
    send(out, encoding);
  };
  if (encoding === 'br') {
    zlib.brotliCompress(p.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: p.body.length } }, done);
  } else zlib.gzip(p.body, { level: 6 }, done);
}

/**
 * Request handler of a server. Without a pool (workers = 0) everything runs in the main thread and, with nothing to
 * compress, synchronously (the tests call it with a minimal fake response).
 */
export function createHandler(api: Endpoint, config: ServeConfig = serveConfig(), pool: WorkerPool | null = null): ((req: IncomingMessage, res: ServerResponse) => void) & { context: ServeContext } {
  const limiter = config.rateLimit ? new RateLimiter(config.rateLimit) : null;
  // With the limit on, CORS also allows X-Api-Key and lets the browser read the RateLimit-* headers.
  const endpoint: Endpoint = limiter ? { ...api, cors: rateLimitCors(api.cors) } : api;
  const ctx: ServeContext = { pool, config, endpoint, results: new ResultStore(config.resultCacheBytes), limiter, meter: UNMETERED };
  const { results } = ctx;
  const fail = (status: number, message: string, code?: string): Prepared => prepare(endpoint.error(status, message, code));
  const limited = (r: RateRejection): Prepared => fail(r.status, r.message, r.code);

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const startedAt = performance.now();
    if (req.method === 'OPTIONS') {
      let extra: Record<string, string> | null = null;
      try { extra = endpoint.preflight?.(new URL(req.url ?? '/', 'http://localhost')) ?? null; } catch { /* malformed URL: plain CORS */ }
      res.writeHead(204, extra ? { ...endpoint.cors, ...extra } : endpoint.cors);
      res.end();
      return;
    }
    let meter = UNMETERED;
    const write = (p: Prepared, cacheable: boolean, extra?: Record<string, string>): void =>
      writeResponse(req, res, p, { endpoint, config, cacheable, startedAt, extra: { ...extra, ...meter.headers() } });
    const rawUrl = req.url ?? '/';
    if (rawUrl.length > config.maxUrlLength) {
      return write(fail(414, `La URL es demasiado larga (${rawUrl.length} caracteres; el máximo es ${config.maxUrlLength})`, 'uri_too_long'), false);
    }
    let url: URL;
    try { url = new URL(rawUrl, 'http://localhost'); } catch { return write(fail(400, 'URL inválida'), false); }
    const method = req.method ?? 'GET';
    if (limiter && !endpoint.free?.(method, url)) meter = limiter.meter(req);

    const special = endpoint.special?.(req, url, meter === UNMETERED ? ctx : { ...ctx, meter });
    if (special) {
      Promise.resolve(special).then(
        (r) => write('etag' in r ? r : prepare(r), r.cacheable === true),
        (err) => { console.error(err); write(fail(500, 'Error interno del servidor'), false); },
      );
      return;
    }
    const cacheable = endpoint.deterministic(url);
    const task: RouteTask = { method, url: url.pathname + url.search };
    const key = resultKey(method, url);
    const hit = cacheable ? results.get(key) : undefined;
    if (hit) return write(hit, true);
    // Only what computes counts (a cache hit, and its 304, is free); the class is the priority it would have in the pool.
    const inline = endpoint.inline(method, url);
    const rejection = meter.charge(!inline && endpoint.heavy(url) ? 'heavy' : 'light');
    if (rejection) return write(limited(rejection), false);
    if (!pool || inline) {
      const p = endpoint.compute(task);
      if (cacheable && p.status === 200) results.set(key, p);
      return write(p, cacheable);
    }
    const p = results.run(key, { cache: cacheable }, () => pool.run(task, { priority: endpoint.heavy(url) ? 'heavy' : 'light', timeoutMs: config.timeoutMs }));
    p.then(
      (r) => write(r, cacheable),
      (err) => write(...failure(err, endpoint, config)),
    );
  };
  return Object.assign(handler, { context: ctx });
}

/** Response for a task that could not run: queue full (503), timeout (504 or 503 while queued) or internal error. */
export function failure(err: unknown, endpoint: Endpoint, config: ServeConfig): [Prepared, boolean, Record<string, string>?] {
  const retry = { 'retry-after': String(config.retryAfterS) };
  if (err instanceof QueueFullError) {
    return [prepare(endpoint.error(503, `El servidor está ocupado: hay demasiadas peticiones pesadas en cola. Vuelve a intentarlo dentro de ${config.retryAfterS} s.`, 'overloaded')), false, retry];
  }
  if (err instanceof TaskTimeoutError) {
    const s = Math.round(config.timeoutMs / 1000);
    return err.queued
      ? [prepare(endpoint.error(503, `La petición ha esperado en cola más de ${s} s sin empezar. Vuelve a intentarlo dentro de ${config.retryAfterS} s.`, 'overloaded')), false, retry]
      : [prepare(endpoint.error(504, `El cálculo ha superado el tiempo máximo de ${s} s. Reduce el intervalo, la región o la resolución.`, 'timeout')), false];
  }
  console.error(err);
  return [prepare(endpoint.error(500, 'Error interno del servidor')), false];
}

/** Starts the pool of a server if the configuration asks for one (workers > 0). */
export function startPool(endpoint: Endpoint, config: ServeConfig, opts: { terrainDir?: string | null; env?: Record<string, string | undefined> } = {}): WorkerPool | null {
  if (config.workers <= 0) return null;
  const pool = new WorkerPool({ size: config.workers, ...(config.lightWorkers !== null ? { lightReserved: config.lightWorkers } : {}), queueMax: config.queueMax, handler: endpoint.handler, ...opts });
  pool.ready.catch((err) => { console.error('[pool] no se ha podido arrancar:', err); });
  return pool;
}

export type { Prepared, Priority, RouteTask };
