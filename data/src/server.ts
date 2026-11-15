// Public API v1 server (node:http, no framework). Every route is GET; the requests are answered by app.ts.
// The heavy ones (rank, landing dates, windows, track, terrain…) run in a pool of worker threads
// (backend/src/pool.ts); compression, ETag, Cache-Control and limits in backend/src/httpServe.ts.
import http from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { STATIC, compute, computeResponse, errorResponse, routePath } from './app.ts';
import { RequestContext } from './request.ts';
import { parseSearch } from './v1.ts';
import { jobsRoute } from '../../backend/src/jobs.ts';
import { createHandler, serveConfig, startPool } from '../../backend/src/httpServe.ts';
import type { Endpoint, ServeConfig } from '../../backend/src/httpServe.ts';
import type { WorkerPool } from '../../backend/src/pool.ts';
import { adoptEphemerisTable, createEphemerisTable, ephemerisTableEnabled } from '../../backend/src/ephemerisTable.ts';
import type { EphemerisTable } from '../../backend/src/ephemerisTable.ts';
import { GRAPHQL_PATH, graphqlRoute } from './graphql/http.ts';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, if-none-match',
  'access-control-expose-headers': 'etag, retry-after, location',
};

/** Date that defaults to «now» in each route (null: none). With it given, the response is deterministic. */
const ANCHOR: Record<string, string | null> = {
  '/v1/sites': null, '/v1/horizon': null,
  '/v1/sun-earth': 'date', '/v1/windows': 'start', '/v1/track': 'start', '/v1/rank': 'start', '/v1/landing-dates': 'start', '/v1/search': 'start',
};
const JOBS_PATH = '/v1/search/jobs';
/** Light unless they ask for terrain or slope: the Sun and the Earth at one instant. */
const LIGHT = new Set(['/v1/sun-earth']);
const DEM_PARAMS = ['terrain', 'slope', 'slopeBaselineM', 'maxSlopeDeg'];

/** Public API v1 described for httpServe.ts. */
export function v1Endpoint(): Endpoint {
  const graphql = graphqlRoute(compute);
  // Asynchronous grid searches (since 1.13.0): the same parameters as /v1/search, errors in the v1 format.
  const jobs = jobsRoute({
    base: JOBS_PATH,
    search: '/v1/search',
    anchor: 'start',
    validate: (q) => { parseSearch(q, new RequestContext()); },
    error: (status, message, code) => errorResponse(status, message, code),
    computeInline: computeResponse,
    // Several instances without shared memory: the status URL carries the search (backend/src/jobs.ts).
    stateless: process.env.LUNAR_JOBS_STATELESS === '1',
  });
  return {
    cors: CORS,
    handler: new URL('./app.ts', import.meta.url).href,
    error: (status, message, code) => errorResponse(status, message, code),
    compute,
    // health (uptime of this process), catalogue, static files, redirects and unknown routes: in the main thread.
    inline: (method, url) => (method !== 'GET' && method !== 'HEAD') || !(routePath(url.pathname) in ANCHOR) || routePath(url.pathname) === '/v1/sites',
    // Never counted by the rate limit (LUNAR_RATE_LIMIT): health, the spec, /docs and the redirect to it.
    free: (_method, url) => { const path = routePath(url.pathname); return path === '/v1/health' || path === '/' || STATIC[path] !== undefined; },
    heavy: (url) => !LIGHT.has(routePath(url.pathname)) || DEM_PARAMS.some((p) => (url.searchParams.get(p) ?? '') !== '' && url.searchParams.get(p) !== '0' && url.searchParams.get(p) !== 'false'),
    // GraphQL (since 1.11.0): parsed and checked here, run in the pool (graphql/http.ts).
    special: (req, url, ctx) => (routePath(url.pathname) === GRAPHQL_PATH ? graphql.special(req, url, ctx) : jobs(req, url, ctx)),
    preflight: (url) => {
      const path = routePath(url.pathname);
      if (path === GRAPHQL_PATH) return graphql.preflight();
      return path.startsWith(JOBS_PATH) ? { 'access-control-allow-methods': 'GET, POST, OPTIONS' } : null;
    },
    deterministic: (url) => {
      const path = routePath(url.pathname);
      if (STATIC[path]) return false; // revalidated with the ETag: they change with each version
      const anchor = ANCHOR[path];
      return anchor !== undefined && (anchor === null || (url.searchParams.get(anchor) ?? '') !== '');
    },
  };
}

/** Request handler without a pool (exported for the tests). */
export const handle = createHandler(v1Endpoint(), { ...serveConfig(), workers: 0 }) as unknown as (req: Pick<IncomingMessage, 'method' | 'url'>, res: ServerResponse) => void;

/**
 * HTTP server. Without options, the configuration of the environment (LUNAR_WORKERS…); under node --test there is no
 * pool unless `config.workers` asks for one. `close()` also stops the pool.
 */
export function createApp(opts: AppOptions = {}): Server & { pool: WorkerPool | null } {
  const handler = createRequestHandler(opts);
  const server = http.createServer(handler);
  server.on('close', () => { void handler.pool?.close(); });
  return Object.assign(server, { pool: handler.pool });
}

/**
 * Ephemeris table adopted by the main thread (null: none). One per process: the last handler created decides, so a
 * handler with the table turned off (LUNAR_EPHEMERIS_TABLE=0) releases the one an earlier handler adopted.
 */
let mainTable: EphemerisTable | null = null;

export interface AppOptions { config?: Partial<ServeConfig>; terrainDir?: string | null; env?: Record<string, string | undefined> }

/**
 * Request handler with its pool, without a server: what a platform that brings its own HTTP server calls with
 * (req, res). Same options as createApp.
 */
export function createRequestHandler(opts: AppOptions = {}): ((req: IncomingMessage, res: ServerResponse) => void) & { pool: WorkerPool | null } {
  const config = { ...serveConfig(), ...opts.config };
  const endpoint = v1Endpoint();
  const pool = startPool(endpoint, config, { ...(opts.terrainDir !== undefined ? { terrainDir: opts.terrainDir } : {}), ...(opts.env ? { env: opts.env } : {}) });
  // Without a pool the main thread computes: it uses its own exact ephemeris table (with a pool, the pool's is shared).
  const tableOn = ephemerisTableEnabled(opts.env ?? process.env);
  if (!pool && tableOn && !mainTable) adoptEphemerisTable(mainTable = createEphemerisTable());
  else if (!tableOn && mainTable) { adoptEphemerisTable(null); mainTable = null; }
  return Object.assign(createHandler(endpoint, config, pool), { pool });
}

// Only listens when run directly (npm start), not when imported by the tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 3100;
  const app = createApp();
  app.listen(port, () => console.log(`API pública v1 en http://localhost:${port} (docs en /docs, GraphQL en /graphql)${app.pool ? ` · ${app.pool.size} workers` : ''}`));
}
