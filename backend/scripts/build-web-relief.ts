#!/usr/bin/env node
// Shaded relief of the lunar south pole for the web map (web/assets/south-pole-relief.png), from the cached LOLA DEM.
//
//   node scripts/build-web-relief.ts            # 1024 px, 190 km of radius around the pole
//   options: --size 1024   --radius-km 190   --out <file.png>
//
// The image uses the projection of the web map (web/js/engine/model.js, toMap): azimuthal equidistant centred on the
// south pole, meridian 0° (Earth-facing side) up, 90°E to the right. Greyscale PNG, written without dependencies.
// Needs the DEM cache: `node scripts/fetch-dem.js` first.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { bilinear, layersFor, llToXY } from '../src/terrain/dem.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const SIZE = Number(opt('--size', '1024'));
const RADIUS_KM = Number(opt('--radius-km', '190'));
const OUT = path.resolve(opt('--out', path.join(HERE, '..', '..', 'web', 'assets', 'south-pole-relief.png')));

const KM_PER_DEGREE = (Math.PI / 180) * 1737.4;
const grid = layersFor(-90, 0, 'fast')?.layers[0].g;
if (!grid) { process.stderr.write('✖ No hay DEM en la caché: ejecuta antes `node scripts/fetch-dem.js`\n'); process.exit(1); }

// Height (m) of each pixel centre, plus a one-pixel border for the slopes.
const N = SIZE + 2, kmPerPx = (2 * RADIUS_KM) / SIZE, h = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = (i - 0.5 - SIZE / 2) * kmPerPx, y = (SIZE / 2 - (j - 0.5)) * kmPerPx; // km in the web map
  const lat = -90 + Math.hypot(x, y) / KM_PER_DEGREE, lon = (Math.atan2(x, y) * 180) / Math.PI;
  h[j * N + i] = bilinear(grid, ...llToXY(lat, lon));
}

// Hillshade: light from the upper left, 40° above the horizon. Slopes are not exaggerated.
const AZ = (315 * Math.PI) / 180, ALT = (40 * Math.PI) / 180;
const light = [Math.sin(AZ) * Math.cos(ALT), Math.cos(AZ) * Math.cos(ALT), Math.sin(ALT)];
const raw = Buffer.alloc(SIZE * (SIZE + 1)); // each row starts with the PNG filter byte (0 = none)
let min = Infinity, max = -Infinity;
for (let j = 1; j <= SIZE; j++) for (let i = 1; i <= SIZE; i++) {
  const k = j * N + i, z = h[k];
  if (Number.isFinite(z)) { if (z < min) min = z; if (z > max) max = z; }
}
for (let j = 1; j <= SIZE; j++) {
  const row = (j - 1) * (SIZE + 1);
  for (let i = 1; i <= SIZE; i++) {
    const k = j * N + i;
    const dzdx = (h[k + 1] - h[k - 1]) / (2 * kmPerPx * 1000), dzdy = (h[k - N] - h[k + N]) / (2 * kmPerPx * 1000);
    const norm = Math.hypot(dzdx, dzdy, 1);
    const shade = Math.max(0, (-dzdx * light[0] - dzdy * light[1] + light[2]) / norm); // 0..1; flat ground = sin(ALT)
    const tint = (h[k] - min) / (max - min); // higher ground slightly lighter
    const v = Number.isFinite(shade) ? 22 + 150 * shade ** 1.25 + 36 * tint : 0;
    raw[row + i] = Math.max(0, Math.min(255, Math.round(v)));
  }
}

// ---------- PNG (8-bit greyscale) ----------
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0); header.writeUInt32BE(SIZE, 4); header[8] = 8; header[9] = 0; // bit depth 8, colour type 0 (grey)
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('tEXt', Buffer.from(`Source\0LOLA ${grid.product} (${grid.res} m), PGDA/GSFC, Barker et al. 2023. Radius ${RADIUS_KM} km`, 'latin1')),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`✔ ${path.relative(process.cwd(), OUT)}: ${SIZE}×${SIZE} px, ${(png.length / 1024).toFixed(0)} KB · alturas de ${Math.round(min)} a ${Math.round(max)} m (${grid.product}, ${grid.res} m)`);
