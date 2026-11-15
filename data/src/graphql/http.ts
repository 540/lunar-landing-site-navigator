// /graphql over HTTP, in the main thread of the data/ server (a `special` route of backend/src/httpServe.ts):
//   GET  /graphql?query=…&variables=…&operationName=…   short or persisted queries; cacheable (ETag, and public
//                                                       Cache-Control when every date is explicit)
//   POST /graphql  {"query", "variables", "operationName"} (application/json)
//   GET  /graphql  from a browser (Accept: text/html, no query): the GraphiQL explorer with the examples
// Persisted queries (Apollo APQ protocol): `extensions.persistedQuery.sha256Hash`; the examples are known from the start.
// The query is prepared here (parse, validation, limits) and, if it passes, runs in a worker of the pool with the
// priority of its cost (light or heavy) and the timeout of the server; without a pool, in this thread.
// Identical queries (same text, variables and operation) in flight at the same time run once, and the result of a
// deterministic one (no date left to «now», no errors) is kept in the server's result cache (since API 1.13.0).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { QueueFullError, TaskTimeoutError } from '../../../backend/src/pool.ts';
import type { Computed, Prepared, RouteTask, ServeContext, Special } from '../../../backend/src/httpServe.ts';
import type { RateClass } from '../../../backend/src/rateLimit.ts';
import { EXAMPLES } from './examples.ts';
import { prepareRequest } from './executor.ts';
import type { FormattedError, GraphQLRequest } from './executor.ts';
import { graphqlConfig } from './limits.ts';
import type { GraphQLConfig } from './limits.ts';

export const GRAPHQL_PATH = '/graphql';
const ALLOW = 'GET, POST, OPTIONS';
const JSON_TYPE = 'application/json; charset=utf-8';
/** Header the worker sets on a response with errors (not cached); removed before sending. */
export const UNCACHEABLE = 'x-lunar-graphql-uncacheable';

export const GRAPHIQL_HTML = readFileSync(new URL('./graphiql.html', import.meta.url), 'utf8')
  .replace('/*EXAMPLES*/[]', JSON.stringify(EXAMPLES).replace(/</g, '\\u003c'));

const errorBody = (status: number, message: string, code: string, headers: Record<string, string> = {}): Computed =>
  ({ status, headers: { 'content-type': JSON_TYPE, ...headers }, body: JSON.stringify({ errors: [{ message, extensions: { code } }] }) });
const errorsBody = (status: number, errors: FormattedError[]): Computed =>
  ({ status, headers: { 'content-type': JSON_TYPE }, body: JSON.stringify({ errors }) });

class BadRequest extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code: string) { super(message); this.status = status; this.code = code; }
}

/** JSON of a query parameter (variables, extensions). */
function jsonParam(raw: string | null, name: string): unknown {
  if (raw === null || raw === '') return undefined;
  try { return JSON.parse(raw); } catch { throw new BadRequest(400, `${name} no es JSON válido`, 'bad_request'); }
}

/** Body of a POST, up to `max` bytes (413 beyond). */
async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const declared = Number(req.headers['content-length']);
  if (declared > max) throw new BadRequest(413, `El cuerpo de la petición pasa de ${max} bytes (LUNAR_GRAPHQL_MAX_BODY_BYTES).`, 'payload_too_large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new BadRequest(413, `El cuerpo de la petición pasa de ${max} bytes (LUNAR_GRAPHQL_MAX_BODY_BYTES).`, 'payload_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Persisted queries (APQ): hash → query. The examples stay; the rest is an LRU of `max` queries. */
export class PersistedQueries {
  private readonly fixed = new Map<string, string>();
  private readonly lru = new Map<string, string>();
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
    for (const e of EXAMPLES) this.fixed.set(sha256(e.query), e.query);
  }

  /** The request with its query resolved from `extensions.persistedQuery` (and the query registered if it came with it). */
  resolve(req: GraphQLRequest): GraphQLRequest {
    const pq = (req.extensions as { persistedQuery?: { version?: number; sha256Hash?: unknown } } | undefined)?.persistedQuery;
    if (!pq) return req;
    if (pq.version !== 1 || typeof pq.sha256Hash !== 'string') throw new BadRequest(400, 'persistedQuery debe ser {"version": 1, "sha256Hash": "<hash>"}', 'bad_request');
    const hash = pq.sha256Hash.toLowerCase();
    if (typeof req.query === 'string') {
      if (sha256(req.query) !== hash) throw new BadRequest(400, 'sha256Hash no coincide con el SHA-256 de la consulta', 'persisted_query_hash_mismatch');
      if (!this.fixed.has(hash) && this.max > 0) {
        this.lru.delete(hash);
        this.lru.set(hash, req.query);
        if (this.lru.size > this.max) this.lru.delete(this.lru.keys().next().value!);
      }
      return req;
    }
    const query = this.fixed.get(hash) ?? this.lru.get(hash);
    if (query === undefined) {
      // Code of the APQ protocol (Apollo and other clients then send the query along with its hash).
      throw new BadRequest(400, 'Consulta persistida desconocida: vuelve a enviarla con su texto en query.', 'PERSISTED_QUERY_NOT_FOUND');
    }
    if (this.lru.has(hash)) { this.lru.delete(hash); this.lru.set(hash, query); }
    return { ...req, query };
  }
}

/** Does the client want HTML (a browser)? */
const wantsHtml = (req: IncomingMessage): boolean => /\btext\/html\b/.test(String(req.headers.accept ?? ''));

/** 429 in GraphQL form if the request is over the rate limit of its client (its headers are added by httpServe.ts). */
function limited(ctx: ServeContext, cls: RateClass): Computed | null {
  const r = ctx.meter.charge(cls);
  return r ? errorBody(r.status, r.message, r.code) : null;
}

/** Response for a task that could not run in the pool, in GraphQL form. */
function poolFailure(err: unknown, config: ServeContext['config']): Computed {
  const retry = { 'retry-after': String(config.retryAfterS) };
  const s = Math.round(config.timeoutMs / 1000);
  if (err instanceof QueueFullError) return errorBody(503, `El servidor está ocupado: hay demasiadas peticiones pesadas en cola. Vuelve a intentarlo dentro de ${config.retryAfterS} s.`, 'overloaded', retry);
  if (err instanceof TaskTimeoutError) {
    return err.queued
      ? errorBody(503, `La petición ha esperado en cola más de ${s} s sin empezar. Vuelve a intentarlo dentro de ${config.retryAfterS} s.`, 'overloaded', retry)
      : errorBody(504, `El cálculo ha superado el tiempo máximo de ${s} s. Reduce los intervalos, el número de sitios o el relieve.`, 'timeout');
  }
  console.error(err);
  return errorBody(500, 'Error interno del servidor', 'internal_error');
}

/**
 * The /graphql route of an endpoint. `compute` runs a task in this thread (no pool); with a pool, the task goes to a worker,
 * whose handler module answers it the same way (data/src/app.ts).
 */
export function graphqlRoute(compute: (task: RouteTask) => Prepared, cfg: GraphQLConfig = graphqlConfig()) {
  const persisted = new PersistedQueries(cfg.persistedMax);

  async function handle(req: IncomingMessage, url: URL, ctx: ServeContext): Promise<Special> {
    const method = req.method ?? 'GET';
    let request: GraphQLRequest;
    if (method === 'GET' || method === 'HEAD') {
      const q = url.searchParams;
      if (!q.has('query') && !q.has('extensions')) {
        if (wantsHtml(req)) return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: GRAPHIQL_HTML };
        return errorBody(400, 'Falta la consulta: pásala en query (GET) o en un cuerpo JSON (POST). Desde el navegador, /graphql abre el explorador.', 'bad_request');
      }
      request = { query: q.get('query') ?? undefined, variables: jsonParam(q.get('variables'), 'variables'), operationName: q.get('operationName') || undefined, extensions: jsonParam(q.get('extensions'), 'extensions') };
    } else if (method === 'POST') {
      if (!/^application\/(graphql-response\+)?json\b/i.test(String(req.headers['content-type'] ?? ''))) {
        return errorBody(415, 'Usa Content-Type: application/json con un cuerpo {"query", "variables", "operationName"}.', 'unsupported_media_type');
      }
      const raw = await readBody(req, cfg.maxBodyBytes);
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new BadRequest(400, 'El cuerpo no es JSON válido.', 'bad_request'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BadRequest(400, 'El cuerpo debe ser un objeto JSON {"query", "variables", "operationName"} (no se admiten lotes).', 'bad_request');
      request = parsed as GraphQLRequest;
    } else {
      return errorBody(405, 'Método no permitido en /graphql; usa GET o POST.', 'method_not_allowed', { allow: ALLOW });
    }
    request = persisted.resolve(request);
    const prep = prepareRequest(request, cfg);
    if (!prep.ok) return limited(ctx, 'light') ?? errorsBody(400, prep.errors);

    const task: RouteTask = { method: 'POST', url: GRAPHQL_PATH, body: JSON.stringify({ query: request.query, variables: request.variables, operationName: request.operationName }) };
    const pool = ctx.pool;
    const key = `GRAPHQL ${sha256(task.body!)}`;
    const cache = !prep.analysis.usesNow;
    const priority: RateClass = prep.analysis.cost >= cfg.heavyCost ? 'heavy' : 'light';
    // Rate limit (httpServe.ts): a result from the cache is free; computing it counts with the priority of its cost.
    const over = cache && ctx.results.has(key) ? null : limited(ctx, priority);
    if (over) return over;
    let p: Prepared;
    try {
      p = await ctx.results.run(key, { cache, coalesce: true, keep: (r) => r.status === 200 && !r.headers[UNCACHEABLE] },
        async () => (pool ? pool.run(task, { priority, timeoutMs: ctx.config.timeoutMs }) : compute(task)));
    } catch (err) { return poolFailure(err, ctx.config); }
    const { [UNCACHEABLE]: uncacheable, ...headers } = p.headers;
    return { ...p, headers, cacheable: (method === 'GET' || method === 'HEAD') && !prep.analysis.usesNow && !uncacheable };
  }

  return {
    special(req: IncomingMessage, url: URL, ctx: ServeContext): Promise<Special> {
      return handle(req, url, ctx).catch((err: unknown) => {
        if (err instanceof BadRequest) return errorBody(err.status, err.message, err.code);
        throw err;
      });
    },
    preflight: (): Record<string, string> => ({ 'access-control-allow-methods': ALLOW }),
  };
}
