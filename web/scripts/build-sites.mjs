#!/usr/bin/env node
// Generates web/data/sites.json from the backend catalogue (backend/src/sites.ts), so the web lists the same sites with
// the same coordinates even without the data API. What only the web needs (short name, note, group, offMap) and the
// illustrative sites that are not in the backend live in web/js/engine/catalog.js.
//
//   node web/scripts/build-sites.mjs
//
// web/test/sites-json.test.js fails when the JSON is behind sites.ts.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SITES } from '../../backend/src/sites.ts';

export const OUT = fileURLToPath(new URL('../data/sites.json', import.meta.url));

// `source` stays out: the backend keeps it internal (public API v1 does not expose it either).
const FIELDS = ['id', 'name', 'region', 'program', 'lat', 'lon', 'verified'];

export function sitesJson(sites = SITES) {
  const doc = {
    generatedBy: 'web/scripts/build-sites.mjs',
    from: 'backend/src/sites.ts',
    sites: sites.map(s => Object.fromEntries(FIELDS.filter(k => s[k] !== undefined).map(k => [k, s[k]]))),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  fs.writeFileSync(OUT, sitesJson());
  console.log(`${OUT}: ${SITES.length} sitios`);
}
