#!/usr/bin/env node
// Writes fixtures/v1-contract-<API_VERSION>.json: the response body of every CONTRACT_PATHS request, computed without
// DEM nor terrain catalogue (as under node --test), so a contract change shows up as a readable diff in git.
//
//   node test/fixtures/write-contract.ts     (from data/; ONLY when the change of the responses is intentional)
import { writeFileSync } from 'node:fs';

process.env.LUNAR_TERRAIN_DIR = 'none'; // before importing the engine: no DEM and no catalogue masks
const { routes, API_VERSION } = await import('../../src/v1.ts');
const { checkParams, RequestContext } = await import('../../src/request.ts');
const { CONTRACT_PATHS } = await import('../contract.ts');

const out: Record<string, unknown> = {};
for (const p of CONTRACT_PATHS) {
  const url = new URL(p, 'http://localhost');
  const ctx = new RequestContext();
  checkParams(url.pathname, url.searchParams, ctx);
  const body = routes[url.pathname](url.searchParams, ctx);
  out[p] = { ...(ctx.warnings.length ? { ...body, warnings: ctx.warnings } : body), ...(url.pathname === '/v1/health' ? { uptimeSeconds: 0 } : {}) };
}
const file = new URL(`./v1-contract-${API_VERSION}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`✔ ${CONTRACT_PATHS.length} respuestas en ${file.pathname.split('/').slice(-2).join('/')}`);
