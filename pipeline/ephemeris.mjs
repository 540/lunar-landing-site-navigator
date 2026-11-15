// Precomputes the hourly Sun and Earth series seen from the Shackleton rim during 2027.
// It uses the same engine as the public API (backend/src, shared by data/). Azimuth and elevation match
// /v1/sun-earth; visibleFraction matches /v1/sun-earth?...&terrain=1 (catalogue mask, observer at 2 m).
// Without `terrain` the API uses a spherical horizon, so only az and el match there.
// Usage: node pipeline/ephemeris.mjs [--site <id>]   (or: npm run pipeline:ephemeris)
//   --site <id>   catalogue site with a horizon mask, written to viewpoint/data/<id>/series-2027.json (default shackleton-rim)
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { series } from '../backend/src/service.ts';
import { getSite } from '../backend/src/sites.ts';
import { loadCatalogMasks } from '../backend/src/horizon.ts';

export const SITE_ID = 'shackleton-rim';
export const START = '2027-01-01T00:00:00.000Z';
export const END_EXCLUSIVE = '2028-01-01T00:00:00.000Z';
export const STEP_MS = 3600e3;
// Fixed on purpose: loadCatalogMasks() would otherwise read LUNAR_OBSERVER_HEIGHT_M and change the output.
export const OBSERVER_HEIGHT_M = 2;
export const TERRAIN_DIR = fileURLToPath(new URL('../backend/terrain/', import.meta.url));
/** Output file of a region: viewpoint/data/<id>/series-2027.json */
export const outFileFor = (siteId) => new URL(`../viewpoint/data/${siteId}/series-2027.json`, import.meta.url);
export const OUT_FILE = outFileFor(SITE_ID);

/** Provenance string built from the horizon that series() really used, so it cannot drift. */
export function describeSource(horizon) {
  const parts = [`horizonModel: ${horizon.type}`];
  if (horizon.source) parts.push(`horizonSource: ${horizon.source}`);
  if (horizon.demVersion) parts.push(`demVersion: ${horizon.demVersion}`);
  return `backend/src (astronomy-engine), ${parts.join(', ')}`;
}

/**
 * Builds the compact Series document. `count` samples from `startIso`, one every `stepMs`.
 * visibleFraction is kept for both bodies: series() applies the catalogue horizon mask, so it can be 0 while el > 0
 * (terrain hiding the body), exactly as /v1/sun-earth reports it. Consumers must not rely on el > 0 alone.
 */
export function buildSeries({ siteId = SITE_ID, startIso = START, endExclusiveIso = END_EXCLUSIVE, stepMs = STEP_MS } = {}) {
  // The engine switches the terrain off under `node --test`; load the catalogue explicitly so the output
  // is the same from the CLI and from the tests.
  loadCatalogMasks(TERRAIN_DIR, OBSERVER_HEIGHT_M);
  const site = getSite(siteId);
  if (!site) throw new Error(`--site «${siteId}» no está en el catálogo`);
  const startMs = Date.parse(startIso);
  const count = Math.round((Date.parse(endExclusiveIso) - startMs) / stepMs);
  // series() includes the end instant, so the last sample requested is the one before the exclusive end.
  const s = series(site, startMs, startMs + (count - 1) * stepMs, stepMs);
  if (s.site.horizon.type !== 'mask') throw new Error(`Falta la máscara de horizonte de ${siteId} en backend/terrain/masks/`);
  return {
    version: 1,
    siteId: site.id,
    lat: site.lat,
    lon: site.lon,
    start: s.start,
    stepMinutes: s.stepMinutes,
    count: s.t.length,
    observerHeightM: s.site.horizon.observerHeightM,
    source: describeSource(s.site.horizon),
    sun: { az: s.sun.az, el: s.sun.el, visibleFraction: s.sun.visibleFraction },
    earth: { az: s.earth.az, el: s.earth.el, visibleFraction: s.earth.visibleFraction },
  };
}

export const serialize = (doc) => JSON.stringify(doc) + '\n';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length && (argv[0] !== '--site' || argv.length !== 2)) throw new Error('Uso: node pipeline/ephemeris.mjs [--site <id>]');
  const doc = buildSeries(argv.length ? { siteId: argv[1] } : {});
  const outFile = outFileFor(doc.siteId);
  mkdirSync(new URL('./', outFile), { recursive: true });
  writeFileSync(outFile, serialize(doc));
  console.log(`${doc.count} muestras de ${doc.siteId} escritas en viewpoint/data/${doc.siteId}/series-2027.json`);
}
