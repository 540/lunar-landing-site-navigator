// Requests of the public API v1 as data: (method, URL) → response (status, headers, body). The HTTP side (pool of workers,
// compression, ETag, limits) is in server.ts and backend/src/httpServe.ts; this module is also what the workers import.
//   /v1/*           JSON, open CORS, errors {error:{code,message}}; ignored parameters and caveats in `warnings` (1.9.0)
//   /openapi.yaml   OpenAPI 3.1 specification (source file)
//   /openapi.json   the same specification converted to JSON
//   /docs           Swagger UI (from jsDelivr) pointing at /openapi.yaml
//   /graphql        GraphQL over the same engine (since 1.11.0): HTTP side in graphql/http.ts, execution here (a task
//                   with a body, only ever built by that module) so that it runs in the workers like a v1 request
//   /graphql/schema.graphql   the GraphQL schema (SDL)
//   /v1/search/jobs  asynchronous grid searches (since 1.13.0): main thread, backend/src/jobs.ts (server.ts)
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { HttpError, routes } from './v1.ts';
import { checkParams, RequestContext } from './request.ts';
import { prepare } from '../../backend/src/httpServe.ts';
import type { Computed, Prepared, RouteTask } from '../../backend/src/httpServe.ts';
import type { V1Error } from './types.ts';
import { SDL, executeRequest } from './graphql/executor.ts';
import { setSearchProgress } from '../../backend/src/search.ts';
import { GRAPHQL_PATH, UNCACHEABLE } from './graphql/http.ts';

const SPEC_YAML = readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');
const SPEC_JSON = JSON.stringify(parseYaml(SPEC_YAML));
const DOCS_HTML = readFileSync(new URL('./docs.html', import.meta.url), 'utf8');

const ERROR_CODES: Record<number, V1Error['error']['code']> = {
  400: 'invalid_parameter', 404: 'not_found', 405: 'method_not_allowed', 414: 'uri_too_long', 500: 'internal_error', 429: 'rate_limited', 503: 'overloaded', 504: 'timeout',
};
export const ALLOW = 'GET, HEAD, OPTIONS';

/** path → [content-type, body] */
export const STATIC: Record<string, [string, string]> = {
  '/openapi.yaml': ['application/yaml; charset=utf-8', SPEC_YAML],
  '/openapi.json': ['application/json; charset=utf-8', SPEC_JSON],
  '/docs': ['text/html; charset=utf-8', DOCS_HTML],
  '/graphql/schema.graphql': ['text/plain; charset=utf-8', SDL],
};

const JSON_TYPE = 'application/json; charset=utf-8';
const json = (status: number, body: unknown, headers: Record<string, string> = {}): Computed =>
  ({ status, headers: { 'content-type': JSON_TYPE, ...headers }, body: JSON.stringify(body) });

/** Error of v1: {error: {code, message}}; a 405 says which methods are allowed (RFC 9110). */
export function errorResponse(status: number, message: string, code?: string): Computed {
  return json(status, { error: { code: (code ?? ERROR_CODES[status] ?? 'error') as V1Error['error']['code'], message } } satisfies V1Error, status === 405 ? { allow: ALLOW } : {});
}

/** Path without a trailing slash (except "/"). */
export const routePath = (pathname: string): string => (pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname);

/** Runs a GraphQL request (body of the task: {query, variables, operationName}, already accepted by graphql/http.ts). */
function graphqlResponse(body: string): Computed {
  const r = executeRequest(JSON.parse(body) as Record<string, unknown>);
  return json(r.status, r.body, r.cacheable ? {} : { [UNCACHEABLE]: '1' });
}

/**
 * Runs a request of v1 and returns its response, with the body exactly as before. `hooks.progress` hears the progress
 * of a grid search (asynchronous jobs of /v1/search).
 */
export function computeResponse({ method, url, body: taskBody }: RouteTask, hooks: { progress?: (p: unknown) => void } = {}): Computed {
  try {
    if (taskBody !== undefined && routePath(new URL(url, 'http://localhost').pathname) === GRAPHQL_PATH) return graphqlResponse(taskBody);
    if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Método no permitido; usa GET');
    const u = new URL(url, 'http://localhost');
    const path = routePath(u.pathname);
    if (path === '/') return { status: 302, headers: { location: '/docs' }, body: '' };
    if (STATIC[path]) return { status: 200, headers: { 'content-type': STATIC[path][0] }, body: STATIC[path][1] };
    const route = routes[path];
    if (!route) throw new HttpError(404, `Ruta no encontrada: ${u.pathname}`);
    const ctx = new RequestContext();
    checkParams(path, u.searchParams, ctx);
    if (hooks.progress) setSearchProgress(hooks.progress);
    let body;
    try { body = route(u.searchParams, ctx); } finally { if (hooks.progress) setSearchProgress(null); }
    // Optional `warnings`, last and only when there are any: a clean request answers exactly as before.
    return json(200, ctx.warnings.length ? { ...body, warnings: ctx.warnings } : body);
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.message);
    console.error(err);
    return errorResponse(500, 'Error interno del servidor');
  }
}

/** Entry point of the pool workers (backend/src/poolWorker.ts). */
export const compute = (task: RouteTask, hooks: { progress?: (p: unknown) => void } = {}): Prepared => prepare(computeResponse(task, hooks));
