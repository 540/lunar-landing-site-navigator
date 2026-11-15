// J7.2: illumination map of the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame } from '../src/engine/index.js';
import { illumination, illuminationSummary, illuminationPixels, MIN_HOURS } from '../src/illumination.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));
const dir = join(root, 'data/procedural-shackleton');
const realScenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };

// 2 × 2 cells, 48 h: cell 0 always lit, cell 1 lit in hours 0 to 11, cells 2 and 3 never.
const N = 2, HOURS = 48;
const scenario = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 0, y: 0 }, pad: { x: 1, y: 1 } };
const sun = new Uint8Array(HOURS * N * N);
for (let h = 0; h < HOURS; h++) { sun[h * N * N] = 255; if (h < 12) sun[h * N * N + 1] = 255; }
const tables = createTables(sun.buffer, scenario);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('media hora a hora, con un mínimo de 24 h', () => {
  assert.equal(MIN_HOURS, 24);
  near(illumination(tables, 23)[0], 1);
  near(illumination(tables, 23)[1], 0.5);
  near(illumination(tables, 10)[1], 0.5);
  near(illumination(tables, 48)[1], 0.25);
  near(illumination(tables, 48)[2], 0);
});

test('con tEnd mayor que la tabla no lee fuera de ella', () => {
  const illum = illumination(tables, 500);
  near(illum[1], 0.25);
  assert.ok([...illum].every(Number.isFinite));
});

test('illuminationSummary: el máximo y la celda del rover, en porcentaje entero', () => {
  const state = { ...newGame(scenario, levels.beg, tables), x: 1, y: 0 };
  assert.deepEqual(illuminationSummary(illumination(tables, 48), state), { bestPct: 100, herePct: 25 });
  assert.equal(texts('es').illumSummary(100, 25), 'El sitio más iluminado tuvo Sol el 100 % del tiempo; donde acabaste, el 25 %.');
});

test('la capa ámbar: color --sun y opacidad round(150 × f)', () => {
  const px = illuminationPixels(new Float32Array([1, 0.5, 0]));
  assert.deepEqual([...px.slice(0, 4)], [242, 163, 58, 150]);
  assert.equal(px[7], 75);
  assert.equal(px[11], 0);
});

test('con las tablas reales, 336 h tardan menos de 50 ms', () => {
  const real = createTables(buf('sun.bin'), realScenario, buf('cells.bin'));
  illumination(real, 336);
  const times = [];
  for (let k = 0; k < 5; k++) { const t0 = performance.now(); illumination(real, 336); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  assert.ok(times[2] < 50, `${times[2]} ms`);
});

test('las tres lecciones, en orden y traducidas', () => {
  const es = texts('es').lessons.map((l) => l.title);
  assert.deepEqual(es, ['El Sol rueda rasante.', 'El relieve manda.', 'La Tierra roza el horizonte.']);
  assert.equal(texts('en').lessons.length, 3);
});
