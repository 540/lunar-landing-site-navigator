#!/usr/bin/env node
// Precomputes the horizon masks of the catalog sites (src/sites.ts) into backend/terrain/masks/:
//   <id>.json      observer at 2 m  (the one the backend loads at startup)
//   <id>.h10.json  observer at 10 m (selected with LUNAR_OBSERVER_HEIGHT_M=10)
// Precise mode: 20 m up to 10 km if there is a 20 m window in the cache (node scripts/fetch-dem.ts --catalog), and 160/240 m
// up to 300 km. Sites outside the DEM coverage (mid latitudes) get no mask: horizon at 0 deg.
//
//   node scripts/build-masks.ts [--heights 2,10] [--dir <terrain folder>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureDem, demVersion } from '../src/terrain/dem.ts';
import { buildMask } from '../src/terrain/horizonMask.ts';
import { SITES } from '../src/sites.ts';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const TERRAIN = path.resolve(opt('--dir', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'terrain')));
const heights = opt('--heights', '2,10').split(',').map(Number);
configureDem({ dir: TERRAIN });
if (!demVersion()) { process.stderr.write('✖ No hay DEM en la caché. Ejecuta antes: node scripts/fetch-dem.ts\n'); process.exit(1); }
const OUT = path.join(TERRAIN, 'masks');
fs.mkdirSync(OUT, { recursive: true });
console.log(`DEM ${demVersion()} → ${path.relative(process.cwd(), OUT)}`);
for (const s of SITES) {
  for (const h of heights) {
    const t0 = performance.now();
    const m = buildMask(s.lat, s.lon, { observerHeightM: h, resolution: 'precise' });
    const file = path.join(OUT, h === 2 ? `${s.id}.json` : `${s.id}.h${h}.json`);
    if (!m) { fs.rmSync(file, { force: true }); if (h === heights[0]) console.log(`· ${s.id}: fuera de la cobertura del DEM → horizonte a 0°`); continue; }
    fs.writeFileSync(file, JSON.stringify({ id: s.id, ...m }) + '\n');
    const mean = m.el.reduce((a, b) => a + b, 0) / m.el.length;
    console.log(`✔ ${s.id} (${h} m): altitud ${m.heightM} m, horizonte ${Math.min(...m.el).toFixed(2)}…${Math.max(...m.el).toFixed(2)}° (medio ${mean.toFixed(2)}°), cobertura ${(100 * m.coverage).toFixed(1)} %, ${(performance.now() - t0).toFixed(0)} ms · ${m.source}`);
  }
}
