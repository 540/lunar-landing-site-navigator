// Asynchronous search jobs of the public API v1
// (POST /v1/search/jobs, since 1.13.0, data/src/server.ts). They live in the main thread: a job is a GET of the
// synchronous search run in the pool with the 'job' priority (or, without a pool, in this thread after answering), and
// its state is polled with GET <base>/<id>. Each API gives its paths, its validation and its error format.
//
// Stateless mode (`stateless`, LUNAR_JOBS_STATELESS=1, since 1.20.0): for deployments with several instances and no
// shared memory. POST only validates and fixes the anchor date; the job is not kept anywhere. Its `statusUrl`
// (and `Location`) carries the parameters of the search, and GET <base>/<id>?<parameters> runs it then, in that request,
// and answers it finished (`done` or `error`). The search is deterministic (the anchor date is fixed), so any instance
// gives the same result, and the result cache of the server (httpServe.ts) answers repeated polls without recomputing.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpError } from './params.ts';
import { failure, prepare, resultKey } from './httpServe.ts';
import type { Computed, Prepared, RouteTask, ServeContext } from './httpServe.ts';
import type { RateClass } from './rateLimit.ts';

export interface Job {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  request: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: unknown;
  /** Body of the finished search (JSON text, as the synchronous search would answer it). */
  result?: string;
  /** Status, message and (v1) code of the error of the search. */
  error?: { status: number; message: string; code?: string };
}

function jobLimits(env: Record<string, string | undefined> = process.env): { max: number; ttlMs: number } {
  const max = Number(env.LUNAR_JOBS_MAX), ttl = Number(env.LUNAR_JOB_TTL_S);
  return { max: Number.isInteger(max) && max > 0 ? max : 100, ttlMs: (Number.isFinite(ttl) && ttl > 0 ? ttl : 3600) * 1000 };
}

export class JobStore {
  private jobs: Map<string, Job> = new Map();
  private limits = jobLimits();

  private purge(): void {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (j.finishedAt && now - Date.parse(j.finishedAt) > this.limits.ttlMs) this.jobs.delete(id);
  }

  /** New job, or null if the store is full of jobs that have not finished. */
  create(request: string): Job | null {
    this.purge();
    if (this.jobs.size >= this.limits.max) {
      const oldest = [...this.jobs.values()].find((j) => j.finishedAt);
      if (!oldest) return null;
      this.jobs.delete(oldest.id);
    }
    const job: Job = { id: randomUUID(), status: 'queued', request, createdAt: new Date().toISOString() };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined { this.purge(); return this.jobs.get(id); }
}

/** How an API exposes its jobs. */
export interface JobsApi {
  /** Collection path (POST creates a job; GET <base>/<id> reads it), e.g. /v1/search/jobs. */
  base: string;
  /** Path of the synchronous search the job runs, e.g. /v1/search. */
  search: string;
  /** Name of the date parameter that defaults to «now»: fixed when the job is accepted. */
  anchor: string;
  /** Validates the parameters without computing anything (throws HttpError). */
  validate(q: URLSearchParams): void;
  /** Error body of the API. */
  error(status: number, message: string, code?: string): Computed;
  /** The search in this thread (no pool), with progress. */
  computeInline(task: RouteTask, hooks: { progress?: (p: unknown) => void }): Computed | Prepared;
  /** Stateless mode (see the header): the status URL carries the search and GET runs it. */
  stateless?: boolean;
}

const JSON_TYPE = 'application/json; charset=utf-8';

/** JSON of a job; the result goes in as it came from the search, without parsing it again. */
function jobBody(j: Job, base: string, query: string = ''): string {
  const { result, ...meta } = j;
  const head = JSON.stringify({ ...meta, statusUrl: `${base}/${j.id}${query ? `?${query}` : ''}` });
  return result === undefined ? head : `${head.slice(0, -1)},"result":${result}}`;
}

function finishJob(job: Job, p: Prepared | Computed): void {
  const text = typeof p.body === 'string' ? p.body : new TextDecoder().decode(p.body);
  job.finishedAt = new Date().toISOString();
  if (p.status === 200) { job.status = 'done'; job.result = text; job.progress = { ...(job.progress as object ?? {}), fraction: 1 }; return; }
  job.status = 'error';
  let message = 'Error interno del servidor', code: string | undefined;
  try {
    // Internal API: {error: "…"}; v1: {error: {code, message}}.
    const e = (JSON.parse(text) as { error: string | { code: string; message: string } }).error;
    if (typeof e === 'string') message = e; else { message = e.message; code = e.code; }
  } catch { /* not JSON */ }
  job.error = { status: p.status, message, ...(code ? { code } : {}) };
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The special route (httpServe.ts Endpoint.special) of the jobs of an API: null when the path is not theirs. */
export function jobsRoute(api: JobsApi, store: JobStore = new JobStore()): (req: IncomingMessage, url: URL, ctx: ServeContext) => Promise<Computed> | Computed | Prepared | null {
  const path = new RegExp(`^${escape(api.base)}(?:/([0-9a-f-]{36}))?/?$`);
  const withHeaders = (c: Computed, headers: Record<string, string>): Computed => ({ ...c, headers: { ...c.headers, ...headers } });
  const validated = (q: URLSearchParams): Computed | null => {
    try { api.validate(q); return null; } catch (err) {
      if (err instanceof HttpError) return api.error(err.status, err.message);
      throw err;
    }
  };
  return (req, url, ctx) => {
    const { pool, config, endpoint, results, meter } = ctx;
    // Rate limit (httpServe.ts): creating a job, or running a stateless one, is heavy; asking for its status, light.
    const limited = (cls: RateClass): Computed | null => {
      const r = meter.charge(cls);
      return r ? api.error(r.status, r.message, r.code) : null;
    };
    const m = path.exec(url.pathname);
    if (!m) return null;
    const id = m[1];
    if (!id) {
      if (req.method !== 'POST') return withHeaders(api.error(405, 'Método no permitido; usa POST para crear un trabajo de búsqueda', 'method_not_allowed'), { allow: 'POST, OPTIONS' });
      const over = limited('heavy');
      if (over) return over;
      // The same parameters as the synchronous search; without the anchor date, «now» is fixed when the job is accepted.
      const q = new URLSearchParams(url.search);
      if (!q.get(api.anchor)) q.set(api.anchor, new Date().toISOString());
      const invalid = validated(q);
      if (invalid) return invalid;
      const request = `${api.search}?${q}`;
      if (api.stateless) {
        const job: Job = { id: randomUUID(), status: 'queued', request, createdAt: new Date().toISOString() };
        return { status: 202, headers: { 'content-type': JSON_TYPE, location: `${api.base}/${job.id}?${q}` }, body: jobBody(job, api.base, String(q)) };
      }
      const job = store.create(request);
      if (!job) {
        return withHeaders(api.error(503, `Hay demasiados trabajos de búsqueda sin terminar. Vuelve a intentarlo dentro de ${config.retryAfterS} s.`, 'overloaded'), { 'retry-after': String(config.retryAfterS) });
      }
      const progress = (p: unknown): void => { job.progress = p; };
      const start = (): void => { job.status = 'running'; job.startedAt = new Date().toISOString(); };
      if (pool) {
        pool.run({ method: 'GET', url: request, job: true }, { priority: 'job', timeoutMs: config.jobTimeoutMs, onProgress: progress, onStart: start })
          .then((p) => finishJob(job, p), (err) => {
            const [p] = failure(err, endpoint, config);
            finishJob(job, p);
          });
      } else {
        // Without a pool the job runs in this thread, after answering.
        setImmediate(() => { start(); finishJob(job, api.computeInline({ method: 'GET', url: request }, { progress })); });
      }
      return { status: 202, headers: { 'content-type': JSON_TYPE, location: `${api.base}/${job.id}` }, body: jobBody(job, api.base) };
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return withHeaders(api.error(405, 'Método no permitido; usa GET', 'method_not_allowed'), { allow: 'GET, OPTIONS' });
    const job = store.get(id);
    if (api.stateless && !job && url.search.length > 1) return runStateless(api, id, new URLSearchParams(url.search), ctx, validated, limited);
    const over = limited('light');
    if (over) return over;
    if (job) return { status: 200, headers: { 'content-type': JSON_TYPE }, body: jobBody(job, api.base) };
    return api.error(404, `Trabajo desconocido o caducado: ${id}${api.stateless ? '. En este servidor los trabajos no se guardan: consulta su statusUrl, que lleva los parámetros de la búsqueda' : ''}`);
  };
}

/** Stateless mode: runs the search of the job now (or takes it from the result cache) and answers the job finished. */
async function runStateless(api: JobsApi, id: string, q: URLSearchParams, ctx: ServeContext, validated: (q: URLSearchParams) => Computed | null, limited: (cls: RateClass) => Computed | null): Promise<Computed> {
  if (!q.get(api.anchor)) return api.error(400, `Falta «${api.anchor}»: usa la statusUrl tal como la dio POST ${api.base}`);
  const invalid = validated(q);
  if (invalid) return invalid;
  const request = `${api.search}?${q}`;
  const key = resultKey('GET', new URL(request, 'http://localhost'));
  const { pool, config, endpoint, results } = ctx;
  // A search already in the result cache is free; computing it is heavy.
  const over = results.has(key) ? null : limited('heavy');
  if (over) return over;
  const job: Job = { id, status: 'running', request, createdAt: new Date().toISOString() };
  job.startedAt = job.createdAt;
  const task: RouteTask = { method: 'GET', url: request, job: true };
  const run = (): Promise<Prepared> => (pool
    ? pool.run(task, { priority: 'job', timeoutMs: config.timeoutMs })
    : Promise.resolve().then(() => { const c = api.computeInline(task, {}); return 'etag' in c ? c : prepare(c); }));
  try {
    finishJob(job, await results.run(key, { cache: true }, run));
  } catch (err) {
    finishJob(job, failure(err, endpoint, config)[0]);
  }
  return { status: 200, headers: { 'content-type': JSON_TYPE }, body: jobBody(job, api.base, String(q)) };
}
