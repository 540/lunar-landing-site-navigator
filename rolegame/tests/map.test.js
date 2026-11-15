// J4: light of the map (map-light.js) and the WebGL relief (map-gl.js, checked as text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables } from '../src/engine/index.js';
import { sunVector, shade, sunGrid, mapMode } from '../src/map-light.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const near = (a, b, tol = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${a} != ${b}`));

test('sunVector: norte −y, este +x, cénit +z', () => {
  near(sunVector(0, 0), [0, -1, 0]);
  near(sunVector(90, 0), [1, 0, 0]);
  near(sunVector(0, 90), [0, 0, 1]);
  near(sunVector(180, 0), [0, 1, 0]);
});

test('shade: un píxel llano sin Sol solo tiene luz ambiente, y con el Sol a 1° el brillo crece con sun', () => {
  const flat = { normal: [0, 0, 1], albedo: 0.6, ao: 1 };
  near(shade({ ...flat, light: sunVector(90, 1), sun: 0 }), [0.1323, 0.13524, 0.147], 1e-4);
  const at = (sun) => shade({ ...flat, light: sunVector(90, 1), sun })[0];
  assert.ok(at(0) < at(0.5) && at(0.5) < at(1));
  // A slope facing the Sun is brighter than flat ground.
  const tilt = Math.SQRT1_2;
  assert.ok(shade({ ...flat, normal: [tilt, 0, tilt], light: sunVector(90, 1), sun: 1 })[0] > at(1));
});

test('sunGrid: la fracción de Sol de cada celda a esa hora, 0 a 255', () => {
  const N = 2, H = 4;
  const sun = new Uint8Array(H * N * N);
  for (let h = 0; h < H; h++) for (let c = 0; c < N * N; c++) sun[h * N * N + c] = c === 1 ? 255 : h * 50;
  const t = createTables(sun.buffer, { grid: { n: N, cellM: 250 }, hours: H });
  assert.deepEqual([...sunGrid(t, 2)], [100, 255, 100, 100]);
  assert.deepEqual([...sunGrid(t, 1.5)], [75, 255, 75, 75]);
});

test('mapMode: 2d sin WebGL o con render por software, gl en otro caso', () => {
  assert.equal(mapMode({ webgl: false, softwareRenderer: false }), '2d');
  assert.equal(mapMode({ webgl: true, softwareRenderer: true }), '2d');
  assert.equal(mapMode({ webgl: true, softwareRenderer: false }), 'gl');
  assert.equal(mapMode({ webgl: true }), 'gl');
});

test('el shader repite la fórmula de shade (mismas constantes)', () => {
  const src = readFileSync(join(root, 'src/map-gl.js'), 'utf8');
  // The ambient constants travel as a uniform from AMBIENT of map-light.js (#309).
  for (const k of ['-1.7', '7.0', '0.85', 'ambient.x + ambient.y * es', 'vec3(0.99, 0.965, 0.92)', 'amb * ambientTint', 'uniform3fv(u(\'ambientTint\'), AMBIENT_TINT)']) assert.ok(src.includes(k), k);
});

test('la pantalla apila #map-gl bajo #map y el motor no sabe nada del mapa', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.ok(html.indexOf('id="map-gl"') < html.indexOf('id="map"'), '#map-gl va antes (debajo)');
  assert.match(html, /<canvas id="map-gl" aria-hidden="true" hidden>/);
});

// ---- Horizon per pixel (J4.2), quality (J4.3) and legend (J4.4) ----
import { inflateSync } from 'node:zlib';
import { horizonAt, pixelSun, SUN_DISC, LIT } from '../src/map-light.js';
import { mapQuality, MAP_LEVELS } from '../src/map-quality.js';
import { MAP_COLORS, legendItems, scaleBar, bearingPoint, compassPoint } from '../src/map-legend.js';
import { TEXTS } from '../src/texts.js';

const dir = join(root, 'data/procedural-shackleton');
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const series = JSON.parse(readFileSync(join(dir, 'series.json'), 'utf8'));
const sunBin = readFileSync(join(dir, 'sun.bin'));

// Grey PNG of the pipeline (single IDAT, filter 0 or 1 per row) → bytes.
function readGreyPng(file) {
  const png = readFileSync(join(dir, file));
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20), len = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + len)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)];
    for (let x = 0; x < w; x++) {
      const b = raw[y * (w + 1) + 1 + x];
      out[y * w + x] = f === 1 && x > 0 ? (b + out[y * w + x - 1]) & 255 : b;
    }
  }
  return out;
}

test('horizonAt: exacto en los nodos y la media en el centro y entre dos direcciones', () => {
  // 2 × 2 points, 4 directions in a 2 × 2 atlas; value = degrees (offset 0, step 1).
  const meta = { size: 2, directions: 4, cols: 2, offset: 0, step: 1 };
  const width = 4, hz = new Uint8Array(16);
  const put = (d, x, y, v) => { hz[(Math.floor(d / 2) * 2 + y) * width + (d % 2) * 2 + x] = v; };
  for (let d = 0; d < 4; d++) { put(d, 0, 0, 10 * d); put(d, 1, 0, 10 * d + 2); put(d, 0, 1, 10 * d + 4); put(d, 1, 1, 10 * d + 6); }
  assert.equal(horizonAt(hz, meta, 0.25, 0.25, 0), 0);
  assert.equal(horizonAt(hz, meta, 0.75, 0.75, 90), 16);
  assert.equal(horizonAt(hz, meta, 0.5, 0.5, 0), 3);
  assert.equal(horizonAt(hz, meta, 0.25, 0.25, 45), 5);
  assert.equal(horizonAt(hz, meta, 0.25, 0.25, 315), 15, 'entre la última dirección y la primera');
});

test('pixelSun: 0,5 en el horizonte, 1 a 0,265° o más por encima, 0 a 0,265° o más por debajo', () => {
  const meta = { size: 2, directions: 1, cols: 1, offset: 0, step: 1 };
  const flat = new Uint8Array(4).fill(2);
  assert.equal(pixelSun(flat, meta, 0.5, 0.5, 0, 2), 0.5);
  assert.equal(pixelSun(flat, meta, 0.5, 0.5, 0, 2.2651), 1);
  assert.equal(pixelSun(flat, meta, 0.5, 0.5, 0, 1.7349), 0);
  assert.equal(pixelSun(flat, meta, 0.5, 0.5, 0, 2.1, false), 1);
  assert.equal(pixelSun(flat, meta, 0.5, 0.5, 0, 1.9, false), 0);
  assert.equal(SUN_DISC, 0.53);
  assert.equal(LIT, 0.5);
});

// Share of cell-hour pairs where the map (at the cell centre) and sun.bin agree on «lit».
function agreement(file, meta, penumbra) {
  const hz = readGreyPng(file), n = scenario.grid.n;
  let ok = 0, total = 0;
  for (let h = 0; h < scenario.hours; h++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ps = pixelSun(hz, meta, (x + 0.5) / n, (y + 0.5) / n, series.sun.az[h], series.sun.el[h], penumbra);
    if ((ps > LIT) === (sunBin[h * n * n + y * n + x] / 255 > LIT)) ok++;
    total++;
  }
  return ok / total;
}

test('coherencia: el mapa por píxel y sun.bin coinciden en ≥ 99 % de las parejas celda-hora', () => {
  const share = agreement('map-horizon.png', scenario.files.horizon, true);
  assert.ok(share >= 0.99, `${(share * 100).toFixed(2)} %`);
});

test('coherencia con el horizonte bajo y sin penumbra: ≥ 97 %', () => {
  const share = agreement('map-horizon-low.png', scenario.files.horizonLow, false);
  assert.ok(share >= 0.97, `${(share * 100).toFixed(2)} %`);
});

test('el shader usa las mismas constantes que pixelSun (0,53 y 0,5)', () => {
  const src = readFileSync(join(root, 'src/map-gl.js'), 'utf8');
  assert.match(src, /\/ 0\.53 \+ 0\.5/);
});

test('mapQuality: ?q=bajo da horizonte bajo sin penumbra; el nivel guardado manda sin q', () => {
  const p = (q) => new URLSearchParams(q);
  assert.deepEqual(mapQuality({ params: p('q=bajo'), webgl: true }), { mode: 'gl', level: 'bajo', source: 'url', horizon: 'low', penumbra: false });
  const stored = mapQuality({ params: p(''), stored: 'alto', webgl: true });
  assert.equal(stored.horizon, 'full');
  assert.equal(stored.source, 'stored');
  assert.equal(stored.penumbra, true);
});

test('mapQuality: 2d sin WebGL, con render por software o con el registro «demasiado lento»', () => {
  const params = new URLSearchParams('');
  assert.equal(mapQuality({ params, webgl: false }).mode, '2d');
  assert.equal(mapQuality({ params, webgl: true, signals: { softwareRenderer: true } }).mode, '2d');
  assert.equal(mapQuality({ params, webgl: true, tooSlow: true }).mode, '2d');
  assert.equal(mapQuality({ params, webgl: true }).mode, 'gl');
});

test('mapQuality sin q ni nivel guardado: bajo en un equipo modesto, medio con señales de sobra', () => {
  const params = new URLSearchParams('');
  assert.equal(mapQuality({ params, webgl: true, signals: { deviceMemory: 4 } }).level, 'bajo');
  assert.equal(mapQuality({ params, webgl: true, signals: { deviceMemory: 16, hardwareConcurrency: 12, maxTextureSize: 16384 } }).level, 'medio');
  assert.deepEqual(Object.keys(MAP_LEVELS).sort(), ['alto', 'bajo', 'medio']);
});

test('legendItems: la fila de la Tierra solo con su capa; cada fila con texto y color', () => {
  assert.ok(!legendItems({ earthLayer: false }).some((r) => r.id === 'earth'));
  assert.ok(legendItems({ earthLayer: true }).some((r) => r.id === 'earth'));
  for (const r of legendItems({ earthLayer: true })) {
    assert.equal(typeof TEXTS.legend[r.id], 'string', r.id);
    assert.equal(r.color, MAP_COLORS[r.id]);
  }
});

test('scaleBar, bearingPoint y compassPoint', () => {
  assert.deepEqual(scaleBar(250), { km: 2, cells: 8 });
  const b0 = bearingPoint(0, 100, 10), b90 = bearingPoint(90, 100, 10), b180 = bearingPoint(180, 100, 10);
  assert.ok(Math.abs(b0.x - 50) < 1e-9 && Math.abs(b0.y - 10) < 1e-9);
  assert.ok(Math.abs(b90.x - 90) < 1e-9 && Math.abs(b90.y - 50) < 1e-9);
  assert.ok(Math.abs(b180.x - 50) < 1e-9 && Math.abs(b180.y - 90) < 1e-9);
  assert.equal(compassPoint(0), 'n');
  assert.equal(compassPoint(359), 'n');
  assert.equal(compassPoint(45), 'ne');
  assert.equal(compassPoint(100), 'e');
  assert.equal(compassPoint(300), 'no');
});

test('la fila del Sol de la leyenda dice el rumbo en palabras y la elevación', () => {
  assert.equal(TEXTS.legendSun(TEXTS.winds[compassPoint(45).toUpperCase()], 0.84), 'Sol: al noreste, a 0,8°');
});

test('#309: en sombra el relieve se ve (no es negro) y el Sol sigue destacando claramente', async () => {
  const { AMBIENT } = await import('../src/map-light.js');
  const flat = { normal: [0, 0, 1], albedo: 0.6, ao: 1, light: sunVector(90, 1) };
  const shadow = shade({ ...flat, sun: 0 })[1];
  const lit = shade({ ...flat, sun: 1 })[1];
  assert.ok(shadow * 255 > 25, `sombra ${Math.round(shadow * 255)} de 255`);
  assert.ok(lit > 2 * shadow, `al Sol ${lit.toFixed(3)} frente a sombra ${shadow.toFixed(3)}`);
  // A slope in shadow and a flat one in shadow differ: the relief reads.
  const slopeShadow = shade({ ...flat, normal: [0, -Math.SQRT1_2, Math.SQRT1_2], sun: 0 })[1];
  assert.notEqual(Math.round(slopeShadow * 255), Math.round(shadow * 255));
  // The shader uses the same ambient as shade().
  const gl = readFileSync(new URL('../src/map-gl.js', import.meta.url), 'utf8');
  assert.match(gl, /ambient\.x \+ ambient\.y \* es/);
  assert.match(gl, /uniform2f\(u\('ambient'\), AMBIENT\[0\], AMBIENT\[1\]\)/);
  assert.equal(AMBIENT.length, 2);
  // Nearly neutral: blue is for the Earth layer (J3.2).
  const [r, , b] = shade({ ...flat, sun: 0 });
  assert.ok(b / r < 1.15, `sombra azulada: ${(b / r).toFixed(2)}`);
});

test('#309: el velo del modo ligero no deja la sombra en negro', async () => {
  const { veilAlpha, SHADOW_VEIL } = await import('../src/map-2d.js');
  assert.equal(veilAlpha(1), 0);
  assert.equal(veilAlpha(0), SHADOW_VEIL);
  assert.ok(SHADOW_VEIL < 200);
});
