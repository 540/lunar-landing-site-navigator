// Light and stability of the cabin (fix of J12.1 and J12.2): the ground of the cabin is lit with the same Sun as the
// map and the rules (the horizon per pixel of map-horizon.png), and the camera is stabilised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createTables } from '../src/engine/index.js';
import { cellToScene } from '../src/cabin/logic.js';
import { cabinSunAt, mapUv, stabilise, stabiliserOn, cellCorrections, correctedSun, STABLE_TAU, LOOSE_TAU, jumped, rigHeight, settling, SINK_KM, JUMP_KM } from '../src/cabin/light.js';
import { sunFromMapChunk } from '../src/cabin/light-glsl.js';
import { cabinMapLight } from '../src/cabin/panel.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data/lola-mouton');
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const series = JSON.parse(readFileSync(join(dir, 'series.json'), 'utf8'));
const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const tables = createTables(buf('sun.bin'), scenario, buf('cells.bin'), buf('earth.bin'));

// Grey PNG of the pipeline (single IDAT, filter 0 or 1 per row) → bytes (as tests/map.test.js).
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

test('la luz del suelo de la cabina coincide con sunFrac > 0,5 en el centro de las celdas de Mons Mouton', () => {
  const meta = scenario.files.horizon;
  const horizon = readGreyPng(meta.file);
  const half = (scenario.grid.n * scenario.grid.cellM) / 2000;
  const n = tables.n;
  let same = 0, raw = 0, total = 0;
  const misses = [];
  for (let h = 0; h < tables.hours; h += 7) {
    const sun = { az: series.sun.az[h], el: series.sun.el[h] };
    const fix = cellCorrections((i) => tables.sunFrac(i, h), n, horizon, meta, sun.az, sun.el);
    for (let i = 0; i < n * n; i += 3) {
      const x = i % n, y = (i - x) / n;
      const frac = tables.sunFrac(i, h);
      if (frac === 0.5) continue;
      const p = cellToScene(scenario, x, y);
      const atlas = cabinSunAt(horizon, meta, p.x, p.z, half, sun.az, sun.el);
      const lit = correctedSun(atlas, fix[i * 4]);
      total++;
      if ((atlas > 0.5) === (frac > 0.5)) raw++;
      if ((lit > 0.5) === (frac > 0.5)) same++; else if (misses.length < 5) misses.push({ x, y, h, frac, atlas, lit });
    }
  }
  assert.ok(total > 10000, `${total} muestras`);
  assert.ok(raw / total > 0.9, `solo el atlas: ${((raw / total) * 100).toFixed(2)} %`);
  assert.equal(same, total, `${total - same} centros no coinciden; p. ej. ${JSON.stringify(misses)}`);
});

test('mapUv: el centro de cada celda cae en su píxel del mapa (norte arriba)', () => {
  const half = (scenario.grid.n * scenario.grid.cellM) / 2000;
  const n = scenario.grid.n;
  for (const [x, y] of [[0, 0], [10, 32], [47, 47]]) {
    const p = cellToScene(scenario, x, y), { u, v } = mapUv(p.x, p.z, half);
    assert.ok(Math.abs(u - (x + 0.5) / n) < 1e-9 && Math.abs(v - (y + 0.5) / n) < 1e-9);
  }
  assert.equal(cabinSunAt(new Uint8Array(1), scenario.files.horizon, half * 1.01, 0, half, 0, 1), null, 'fuera de la rejilla: la luz de la región');
});

test('la cabina usa el horizonte del nivel de calidad del mapa', () => {
  const full = cabinMapLight(scenario, { horizon: 'full', penumbra: true });
  assert.equal(full.url, 'data/lola-mouton/map-horizon.png');
  assert.equal(full.penumbra, true);
  const low = cabinMapLight(scenario, { horizon: 'low', penumbra: false });
  assert.equal(low.url, 'data/lola-mouton/map-horizon-low.png');
  assert.equal(low.penumbra, false);
  assert.equal(full.halfKm, 6);
  assert.equal(cabinMapLight({ files: {} }), null);
});

test('el sombreado cambia la sombra de la región por la del mapa solo en la luz del Sol', () => {
  const chunk = 'x\n\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], a, b, c, vDirectionalShadowCoord[ i ] ) : 1.0;\ny';
  const out = sunFromMapChunk(chunk);
  assert.match(out, /mix\( 1\.0, getShadow\( directionalShadowMap\[ i \],/);
  assert.match(out, /vDirectionalShadowCoord\[ i \] \), hzShadowWeight \) : 1\.0;\n\t\tdirectLight\.color \*= hzLit;/);
  assert.throws(() => sunFromMapChunk('otra cosa'), /unexpected/);
});

test('estabilizador: filtra cabeceo, alabeo y altura; sin él sigue más deprisa; con movimiento reducido, horizonte quieto', () => {
  const s0 = { pitch: 0, roll: 0, y: 1 };
  const bump = { pitch: 0.2, roll: -0.1, y: 1.001 };
  const on = stabilise(s0, bump, 1 / 60, { on: true });
  const off = stabilise(s0, bump, 1 / 60, { on: false });
  assert.ok(on.pitch > 0 && on.pitch < off.pitch, 'con estabilizador cabecea menos en un fotograma');
  assert.ok(Math.abs(on.pitch - 0.2 * (1 - Math.exp(-1 / 60 / STABLE_TAU))) < 1e-12);
  assert.ok(Math.abs(off.pitch - 0.2 * (1 - Math.exp(-1 / 60 / LOOSE_TAU))) < 1e-12);
  let s = s0;
  for (let k = 0; k < 240; k++) s = stabilise(s, bump, 1 / 60, { on: true });
  assert.ok(Math.abs(s.pitch - 0.2) < 1e-3, 'acaba siguiendo la pendiente');
  let r = s0;
  for (let k = 0; k < 120; k++) r = stabilise(r, bump, 1 / 60, { reduced: true });
  assert.equal(r.pitch, 0); assert.equal(r.roll, 0);
  assert.ok(Math.abs(r.y - 1.001) < 1e-5);
  assert.deepEqual(stabilise(null, bump, 0.016), bump);
  assert.equal(stabiliserOn(null), true);
  assert.equal(stabiliserOn('off'), false);
  assert.equal(stabiliserOn('on'), true);
});

// Fix: with «Reducir movimiento», the cabin drew the sky from under the relief at ASCENSO (Mons Mouton). The scene only
// redraws when something changes, so the filtered height of the start cell (5,190 km) stayed under the pad (5,243 km).
test('la cámara nunca queda bajo el relieve: tras un salto, con movimiento reducido y con el estabilizador', () => {
  const startQ = cellToScene(scenario, scenario.start.x, scenario.start.y);
  const padQ = cellToScene(scenario, scenario.pad.x, scenario.pad.y);
  const startY = 5.190, padY = 5.243; // km: what the cabin's relief gives at those two cells
  const at = (q, y) => ({ q, target: { pitch: 0.05, roll: -0.02, y } });
  // The rig settles on the start cell.
  let s = null, placed = null;
  const frame = (step, dt, opts) => {
    const j = jumped(placed, step.q);
    placed = step.q;
    s = stabilise(s, step.target, dt, { ...opts, jumped: j });
    return rigHeight(s.y, step.target.y);
  };
  for (const opts of [{ on: true }, { on: false }, { reduced: true }]) {
    s = null; placed = null;
    for (let k = 0; k < 30; k++) frame(at(startQ, startY), 1 / 60, opts);
    // A route driven from the map moves the rover 4,8 km in one go; the first frame after it may have dt = 0.
    const y = frame(at(padQ, padY), 0, opts);
    assert.ok(y >= padY - SINK_KM, `${JSON.stringify(opts)}: la cámara a ${((y - padY) * 1000).toFixed(1)} m del suelo`);
    assert.equal(settling(s, at(padQ, padY).target, opts), false, 'no queda nada por asentar tras el salto');
  }
  // Driving (small moves) is filtered, but the eye never goes more than SINK_KM under the ground.
  assert.equal(jumped({ x: 0, z: 0 }, { x: JUMP_KM / 2, z: 0 }), false);
  assert.equal(jumped({ x: 0, z: 0 }, { x: JUMP_KM * 2, z: 0 }), true);
  assert.equal(jumped(null, { x: 0, z: 0 }), true);
  s = { pitch: 0, roll: 0, y: 1 };
  const climbing = stabilise(s, { pitch: 0, roll: 0, y: 1.01 }, 1 / 60, { on: true });
  assert.ok(climbing.y < 1.01 - SINK_KM, 'el filtro va por detrás en una cuesta…');
  assert.equal(rigHeight(climbing.y, 1.01), 1.01 - SINK_KM, '…pero la cámara no se hunde más de SINK_KM');
  assert.equal(settling(climbing, { pitch: 0, roll: 0, y: 1.01 }), true, 'y la escena sigue dibujando hasta asentarse');
});
