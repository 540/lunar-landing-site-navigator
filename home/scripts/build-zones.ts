#!/usr/bin/env node
// Generates home/data/zones.json: light, Earth and slope of each zone of «Explorar la Luna», from the engine's use cases
// (the same ones /v1/windows and /v1/track call). The texts of the cards are written by hand in home/index.html.
//
//   cd backend && npm ci && cd .. && node home/scripts/build-zones.ts
//
// With the LOLA DEM in backend/terrain/cache/ (cd backend && node scripts/fetch-dem.ts) the zones south of ~60°S get
// their relief; without it only the catalogue masks apply and the rest is a smooth Moon. Each zone says which in the JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteSlopeOf, terrainAvailability, track, visibilityWindows } from '../../backend/src/useCases.ts';
import type { TerrainRequest, WarningSink } from '../../backend/src/useCases.ts';
import { getSite } from '../../backend/src/sites.ts';
import type { Site } from '../../backend/src/types.ts';
import { zoneRecord } from './zones-lib.ts';
import type { ZoneSource } from './zones-lib.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'data', 'zones.json');

// Published coordinates (selenographic, east-positive longitude). Catalogue sites are taken from backend/src/sites.ts.
const ZONES: ZoneSource[] = [
  { id: 'shackleton-ridge', lat: -89.44027, lon: -137.12649, siteId: 'shackleton-rim' },
  // LCROSS impact point inside Cabeus (Colaprete et al. 2010, Science 330: 84.675°S, 311.275°E).
  { id: 'cabeus', lat: -84.675, lon: -48.725 },
  { id: 'von-karman', lat: -45.4561, lon: 177.5885, siteId: 'change4' },
  { id: 'apollo-11', lat: 0.67408, lon: 23.47297, siteId: 'apollo11' },
  { id: 'apollo-15', lat: 26.13222, lon: 3.63386, siteId: 'apollo15' },
  { id: 'mare-crisium', lat: 18.5623, lon: 61.8103, siteId: 'blueghost1' },
  { id: 'north-pole', lat: 89.5, lon: 0 },
];

const START = '2027-01-01T00:00:00Z', END = '2028-01-01T00:00:00Z';
const TERRAIN: TerrainRequest = { observerHeightM: 2 };
const SLOPE_BASELINE_M = 100;
const HOUR_MS = 3600e3;

function siteOf(z: ZoneSource): Site {
  if (z.siteId) {
    const s = getSite(z.siteId);
    if (!s) throw new Error(`${z.id}: no existe el sitio ${z.siteId} en el catálogo`);
    if (Math.abs(s.lat - z.lat) > 1e-6 || Math.abs(s.lon - z.lon) > 1e-6) throw new Error(`${z.id}: no coincide con ${z.siteId} del catálogo`);
    return s;
  }
  return { id: `custom:${z.lat},${z.lon}`, name: z.id, lat: z.lat, lon: z.lon, heightKm: 0, custom: true };
}

const startMs = Date.parse(START), endMs = Date.parse(END);
const zones = ZONES.map((z) => {
  const warnings: string[] = [];
  const sink: WarningSink = { warn: (code) => { warnings.push(code); } };
  const site = siteOf(z);
  const w = visibilityWindows({ site, terrain: TERRAIN, startMs, endMs, night: {} }, sink);
  const t = track({ site, terrain: TERRAIN, startMs, endMs, stepMs: HOUR_MS }, sink);
  const slope = siteSlopeOf(site, { baselineM: SLOPE_BASELINE_M });
  const record = zoneRecord(z, {
    sunFraction: w.windows.sun.fractionOfTime,
    earthFraction: w.windows.earth.fractionOfTime,
    longestNightHours: w.windows.night?.longestNightHours ?? 0,
    nightTruncated: w.nightTruncated || (w.windows.night?.longestNightHours ?? 0) >= (endMs - startMs) / HOUR_MS - 1,
    earthElevationDeg: t.series.earth.el,
    horizon: { applied: w.terrain?.applied ?? false, source: w.terrain?.source ?? null, note: w.terrain?.note ?? null },
    slope,
    warnings,
  });
  // Without the DEM a south polar crater comes out with Sun half the time: refuse to publish that by accident.
  if (z.lat <= -60 && record.horizon.model === 'smooth' && !process.argv.includes('--allow-smooth')) {
    throw new Error(`${z.id}: sin relieve en el polo sur. Descarga el DEM (cd backend && node scripts/fetch-dem.ts) o pasa --allow-smooth.`);
  }
  process.stderr.write(`${z.id}: Sol ${record.light.percent} %, noche ${record.night.longestDays} d, Tierra ${record.earth.percent} %, ${record.horizon.model}\n`);
  return record;
});

const terrain = terrainAvailability();
const out = {
  generatedBy: 'home/scripts/build-zones.ts',
  period: { start: START, end: END },
  mode: 'limb',
  observerHeightM: TERRAIN.observerHeightM,
  slopeBaselineM: SLOPE_BASELINE_M,
  demVersion: terrain.demVersion,
  note: 'Sol y Tierra: fracción del año 2027 con algo del disco sobre el horizonte (visibilityWindows, como /v1/windows, con terrain y un observador a 2 m). '
    + 'Elevación de la Tierra: track cada hora. Horizonte con relieve donde hay máscara del catálogo o DEM LOLA en caché; si no, Luna lisa (horizon.model).',
  zones,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
process.stderr.write(`→ ${path.relative(process.cwd(), OUT)}\n`);
