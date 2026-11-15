// J9.2: the LOLA source of the game scenario, with a synthetic DEM in memory (no download needed), and the
// LOLA scenario already written in rolegame/data/ against the relief of the viewpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lolaWorld, scenarioConfigs, scenarioDir, AZB } from '../game-scenario.mjs';
import { configureDem, llToXY, makeGrid } from '../../backend/src/terrain/dem.ts';
import { createSceneFrame } from '../../viewpoint/src/core/scene-frame.js';

const CENTER = { lat: -89.5, lon: 0 };
const R_KM = 1737.4;
const frame = createSceneFrame({ radiusKm: R_KM, centerLat: CENTER.lat, centerLon: CENTER.lon });
const SMALL = { n: 8, cellM: 250, mapSize: 16 };

/** Synthetic DEM (160 m) of `w` × `w` pixels around the pole with `relief(x, y)` metres, in the polar stereographic plane. */
function syntheticDem(relief, { res = 160, w = 400 } = {}) {
  const X0 = (-w * res) / 2, Y0 = (w * res) / 2;
  const a = new Float32Array(w * w);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) a[j * w + i] = relief(X0 + (i + 0.5) * res, Y0 - (j + 0.5) * res);
  return makeGrid({ res, X0, Y0, w, h: w, a });
}
// A wide hill of 300 m at scene (x, z) km, in the plane of the DEM.
function hillAt(xKm, zKm, heightM = 300, sigmaM = 1500) {
  const { lat, lon } = frame.fromScene(xKm, zKm);
  const [hx, hy] = llToXY(lat, lon);
  return (x, y) => heightM * Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / (2 * sigmaM ** 2));
}
// Scene coordinates (km) of the centre of cell (x, y) of the small grid: −1 km … 1 km, north is −z.
const cellCenter = (x, y) => [-1 + (x + 0.5) * 0.25, -1 + (y + 0.5) * 0.25];

test('una loma al norte del centro sale arriba del mapa, con su altura y tapando el norte de las celdas del sur', () => {
  const hill = hillAt(0.125, -0.625);
  const grid = syntheticDem(hill);
  const W = lolaWorld({ center: CENTER }, { grids: [grid], ...SMALL });
  let top = 0;
  for (let i = 1; i < 64; i++) if (W.H[i] > W.H[top]) top = i;
  assert.ok(Math.floor(top / 8) <= 1, `la cima está en la fila ${Math.floor(top / 8)}`);
  for (const [x, y] of [[4, 1], [0, 0], [7, 7], [3, 5]]) {
    const [sx, sz] = cellCenter(x, y);
    const { lat, lon } = frame.fromScene(sx, sz);
    const [px, py] = llToXY(lat, lon);
    assert.ok(Math.abs(W.H[y * 8 + x] - hill(px, py)) <= 1, `celda (${x}, ${y}): ${W.H[y * 8 + x]} frente a ${hill(px, py)}`);
  }
  // Azimuth 0 (north): the cells south of the hill see it above the horizon; the ones north of its top do not.
  assert.ok(W.M[(7 * 8 + 4) * AZB] > W.M[(0 * 8 + 4) * AZB] + 1, `${W.M[(7 * 8 + 4) * AZB]} frente a ${W.M[(0 * 8 + 4) * AZB]}`);
  assert.equal(W.M.length, 64 * AZB);
  assert.equal(W.map.length, 16 * 16);
  assert.equal(W.source.type, 'lola');
});

test('si el DEM no cubre una celda, falla y dice cuál', () => {
  // 12 × 12 pixels of 160 m: about 1.9 km, smaller than the 2 km of the grid.
  assert.throws(() => lolaWorld({ center: CENTER }, { grids: [syntheticDem(() => 0, { w: 12 })], ...SMALL }), /Ningún DEM cubre la celda \(\d+, \d+\)/);
  configureDem();
});

// The LOLA scenarios written in rolegame/data/ (they need no DEM to be checked).
const written = scenarioConfigs().filter((c) => c.source === 'lola' && existsSync(new URL('scenario.json', scenarioDir(c.id))));

test('hay al menos un escenario LOLA subido', () => assert.ok(written.length > 0));

for (const cfg of written) {
  const dir = scenarioDir(cfg.id);
  const scenario = JSON.parse(readFileSync(new URL('scenario.json', dir), 'utf8'));

  test(`${cfg.id}: scenario.json lleva la fuente LOLA, la carpeta pesa 5 MB como mucho y el primer dibujo 3 MB`, () => {
    assert.equal(scenario.source.type, 'lola');
    assert.match(scenario.source.demVersion, /^lola-[0-9a-f]{12}$/);
    assert.match(scenario.source.citation, /LOLA/);
    assert.deepEqual(scenario.name, cfg.name);
    // Same limits as the procedural scenario since J4 (pipeline/test/game-scenario.test.js, FIRST_DRAW).
    const folder = fileURLToPath(dir);
    const bytes = readdirSync(folder).reduce((a, f) => a + statSync(folder + f).size, 0);
    assert.ok(bytes <= 5 * 1024 * 1024, `${bytes} bytes`);
    const firstDraw = ['scenario.json', 'sun.bin', 'cells.bin', 'earth.bin', 'masks.bin', 'series.json', 'map-normals.png', 'map-albedo.png', 'map-ao.png'];
    const first = firstDraw.reduce((a, f) => a + statSync(folder + f).size, 0);
    assert.ok(first <= 3 * 1024 * 1024, `${first} bytes`);
  });

  test(`${cfg.id}: cells.bin coincide con el relieve del Mirador (diferencia media por debajo de 30 m)`, () => {
    const region = new URL(`../../viewpoint/data/${cfg.siteId}/`, import.meta.url);
    const meta = JSON.parse(readFileSync(new URL('meta.json', region), 'utf8'));
    const lod0 = readFileSync(new URL(meta.heights.file, region));
    const { cols, stepKm } = meta.grid;
    const half = meta.extentKm / 2;
    const { scale, offset } = meta.heights;
    const node = (i, j) => offset + lod0.readUInt16LE((j * cols + i) * 2) * scale;
    const at = (x, z) => {
      const fi = (x + half) / stepKm, fj = (z + half) / stepKm, i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, tz = fj - j;
      return (node(i, j) * (1 - tx) + node(i + 1, j) * tx) * (1 - tz) + (node(i, j + 1) * (1 - tx) + node(i + 1, j + 1) * tx) * tz;
    };
    const cells = readFileSync(new URL('cells.bin', dir));
    const H = new Float32Array(cells.buffer, cells.byteOffset, cells.length / 4);
    const n = scenario.grid.n, cellKm = scenario.grid.cellM / 1000;
    let sum = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const sx = -(n * cellKm) / 2 + (x + 0.5) * cellKm, sz = -(n * cellKm) / 2 + (y + 0.5) * cellKm;
      // The viewpoint keeps the curvature of the sphere: y = (R + h) · cos θ − R; it is taken off.
      const flat = (at(sx, sz) + R_KM) / Math.sqrt(1 - (Math.hypot(sx, sz) / R_KM) ** 2) - R_KM;
      sum += Math.abs(flat * 1000 - H[y * n + x]);
    }
    const mean = sum / (n * n);
    if (process.env.SHOW_DIFF) console.log(`diferencia media ${mean.toFixed(2)} m`);
    assert.ok(mean < 30, `diferencia media ${mean.toFixed(1)} m`);
  });
}
