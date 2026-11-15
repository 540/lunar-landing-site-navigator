#!/usr/bin/env node
// Packs the DEM grids of the terrain cache without loss (src/terrain/demPack.ts) and checks them against the SHA-256 of
// terrain/dem-sha256.json: the heights the team works with locally (PGDA validation, catalogue masks).
//
//   node scripts/pack-dem.ts --out <terrain folder>   # cache/<name>.f32 → <out>/cache/<name>.ldp + <name>.json
//   node scripts/pack-dem.ts --check                  # every grid of the cache (.f32 or .ldp) matches dem-sha256.json
//   options: --dir <terrain folder> (default backend/terrain)   --level <zstd 1-19> (default 9)   --any (any DEM: grids
//            that are not those of dem-sha256.json, such as the synthetic ones of the tests; a listed grid must still match)
// Exit 1 if a grid does not match or, without --any, if a grid of dem-sha256.json is missing.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKED_EXT, packGrid, unpackGrid } from '../src/terrain/demPack.ts';
import type { GridMeta } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const TERRAIN = path.resolve(opt('--dir') ?? path.join(HERE, '..', 'terrain'));
const OUT = opt('--out');
const LEVEL = Number(opt('--level') ?? 9);
const CHECK = args.includes('--check');
const ANY = args.includes('--any');
if (!OUT && !CHECK) {
  console.error('Uso: node scripts/pack-dem.ts --out <carpeta de relieve> | --check   [--dir <carpeta>] [--level 9] [--any]');
  process.exit(2);
}

/** SHA-256 of the heights (little-endian Float32), what dem-sha256.json records. */
const heightsSha256 = (a: Float32Array): string => crypto.createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

const manifestFile = path.join(HERE, '..', 'terrain', 'dem-sha256.json');
const expected: Record<string, string> = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).grids;
const cache = path.join(TERRAIN, 'cache');
const names = fs.existsSync(cache) ? fs.readdirSync(cache).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : [];
let failures = 0;
const seen = new Set<string>();

for (const name of names) {
  const meta: GridMeta = JSON.parse(fs.readFileSync(path.join(cache, `${name}.json`), 'utf8'));
  const raw = path.join(cache, `${name}.f32`), packed = path.join(cache, `${name}${PACKED_EXT}`);
  let a: Float32Array;
  if (fs.existsSync(raw)) { const b = fs.readFileSync(raw); a = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); }
  else if (fs.existsSync(packed)) a = unpackGrid(fs.readFileSync(packed));
  else continue;
  if (a.length !== meta.w * meta.h) { console.error(`✗ ${name}: ${a.length} valores; el .json dice ${meta.w}×${meta.h}`); failures++; continue; }
  const sha = heightsSha256(a);
  seen.add(name);
  if (expected[name] ? expected[name] !== sha : !ANY) {
    console.error(`✗ ${name}: SHA-256 ${sha.slice(0, 12)}…, ${expected[name] ? `se esperaba ${expected[name].slice(0, 12)}…` : 'no está en dem-sha256.json'}`);
    failures++;
    continue;
  }
  if (!OUT) { console.log(`✓ ${name} (${fs.existsSync(raw) ? '.f32' : PACKED_EXT})`); continue; }
  const t = performance.now();
  const buf = packGrid(a, meta.w, meta.h, LEVEL);
  if (heightsSha256(unpackGrid(buf)) !== sha) throw new Error(`${name}: al desempaquetar no sale lo mismo; no se escribe`);
  const outCache = path.join(path.resolve(OUT), 'cache');
  fs.mkdirSync(outCache, { recursive: true });
  fs.writeFileSync(path.join(outCache, `${name}${PACKED_EXT}`), buf);
  fs.copyFileSync(path.join(cache, `${name}.json`), path.join(outCache, `${name}.json`));
  console.log(`✓ ${name}: ${(a.byteLength / 1e6).toFixed(1)} → ${(buf.length / 1e6).toFixed(1)} MB (${((100 * buf.length) / a.byteLength).toFixed(0)} %) en ${((performance.now() - t) / 1000).toFixed(1)} s`);
}
for (const name of Object.keys(expected)) {
  if (!ANY && !seen.has(name)) { console.error(`✗ falta ${name} en ${cache}`); failures++; }
}
if (failures) process.exit(1);
