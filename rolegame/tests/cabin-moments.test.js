// Light and moments of the cabin (J12.5 #301, J12.7 #303): the pure decisions behind the blue zones on the ground,
// the headlights, the Earth rising, the rover's own shadow and the postcard. The 3D is checked in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  earthGroundTexels, headlightsOn, earthRises, riseSlowdown, riseFlash, roverShadow, lookAtBearing, postcardCaption,
  postcardFile, ownShadowAt, ownShadowUniforms, ownShadowGlsl, RISE_MS, RISE_SLOW, MAX_SHADOW_M, ROVER_HEIGHT_M,
} from '../src/cabin/moments.js';
import { createTables } from '../src/engine/index.js';
import { earthCells } from '../src/earth-layer.js';
import { earthForecastCells } from '../src/earth-outlook.js';
import { endSummary } from '../src/end.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data/lola-mouton');
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const tables = createTables(buf('sun.bin'), scenario, buf('cells.bin'), buf('earth.bin'));

test('la capa del suelo pinta exactamente las celdas de earthCells (R) y la previsión de 24 h (G)', () => {
  for (const h of [0, 40, 100, 140]) {
    const now = earthCells(tables, h), soon = earthForecastCells(tables, h);
    const tex = earthGroundTexels(tables.n, now, soon);
    assert.equal(tex.length, tables.n * tables.n * 4);
    const red = [], green = [];
    for (let i = 0; i < tables.n * tables.n; i++) { if (tex[i * 4]) red.push(i); if (tex[i * 4 + 1]) green.push(i); assert.equal(tex[i * 4 + 3], 255); }
    assert.deepEqual(red, now, `hora ${h}`);
    assert.deepEqual(green, [...soon].sort((a, b) => a - b), `hora ${h}`);
    for (const i of now) assert.equal(tex[i * 4 + 1], 0, 'una celda azul ahora no sale rayada');
  }
});

test('los faros se encienden si y solo si el motor dice que la celda está en sombra (sunFrac ≤ 0,5)', () => {
  assert.equal(headlightsOn(0), true);
  assert.equal(headlightsOn(0.5), true);
  assert.equal(headlightsOn(0.51), false);
  assert.equal(headlightsOn(1), false);
  let both = 0;
  for (let i = 0; i < tables.n * tables.n; i += 37) for (const h of [0, 50, 120]) {
    const f = tables.sunFrac(i, h);
    assert.equal(headlightsOn(f), !(f > 0.5));
    both += headlightsOn(f) ? 1 : 0;
  }
  assert.ok(both > 0, 'hay celdas en sombra en Mouton');
});

test('earthRises solo es cierto cuando la celda pasa de no ver la Tierra a verla', () => {
  assert.equal(earthRises(false, true), true);
  assert.equal(earthRises(true, true), false);
  assert.equal(earthRises(true, false), false);
  assert.equal(earthRises(false, false), false);
  assert.equal(earthRises(null, true), false, 'sin hora anterior (partida nueva) no hay momento');
});

test('la Tierra asoma en Mouton: alguna celda pasa de no verla a verla en la misión', () => {
  let rises = 0;
  for (let i = 0; i < tables.n * tables.n; i++) for (let h = 1; h < tables.hours; h++) {
    if (earthRises(tables.seesEarth(i, h - 1), tables.seesEarth(i, h))) { rises++; break; }
  }
  assert.ok(rises > 0);
});

test('el momento frena el coche un instante y vuelve a 1; sin nada con movimiento reducido', () => {
  assert.equal(riseSlowdown(null), 1);
  assert.equal(riseSlowdown(0), RISE_SLOW);
  assert.ok(riseSlowdown(RISE_MS / 2) > RISE_SLOW && riseSlowdown(RISE_MS / 2) < 1);
  assert.equal(riseSlowdown(RISE_MS), 1);
  assert.equal(riseSlowdown(0, true), 1);
  assert.equal(riseFlash(0, true), 0);
  assert.ok(riseFlash(RISE_MS * 0.12) > 0.99);
  assert.ok(riseFlash(RISE_MS * 0.9) < riseFlash(RISE_MS * 0.3));
  assert.equal(riseFlash(RISE_MS), 0);
});

test('la sombra del rover: larguísima con el Sol rasante, al lado contrario del Sol, y ninguna en sombra', () => {
  const s = roverShadow({ az: 100, el: 1 }, true);
  assert.ok(Math.abs(s.length - ROVER_HEIGHT_M / Math.tan(Math.PI / 180)) < 1e-9);
  assert.ok(s.length > 130 && s.length < 140, `${s.length} m con el Sol a 1°`);
  assert.equal(s.az, 280);
  assert.equal(roverShadow({ az: 300, el: 0.1 }, true).length, MAX_SHADOW_M);
  assert.equal(roverShadow({ az: 300, el: 2 }, true).az, 120);
  assert.equal(roverShadow({ az: 100, el: 1 }, false), null);
  assert.equal(roverShadow({ az: 100, el: -0.5 }, true), null);
});

test('mirar hacia un rumbo: relativo al morro y dentro de lo que gira la cabeza', () => {
  assert.equal(lookAtBearing(90, 0), 90);
  assert.equal(lookAtBearing(350, 10), -20);
  assert.equal(lookAtBearing(179, 0), 110, 'la sombra casi detrás: por encima del hombro, hasta donde llega');
  assert.equal(lookAtBearing(200, 0, 180), -160);
});

test('el pie de la postal usa las cifras del final (J7.1)', () => {
  const state = { over: 'win', t: 206.4, battery: 32.9, sent: 3, level: { need: 3, deadline: 192, minBat: 15 } };
  const end = endSummary(state);
  assert.equal(postcardCaption(end, 'Mons Mouton', texts('es')), 'Día 9 · 14:00 · 32 % · 3 paquetes · Mons Mouton');
  assert.equal(postcardCaption(end, 'Mons Mouton', texts('en')), 'Day 9 · 14:00 · 32% · 3 packets · Mons Mouton');
  assert.equal(postcardCaption({ ...end, sent: 1 }, 'X', texts('es')), 'Día 9 · 14:00 · 32 % · 1 paquete · X');
  assert.equal(postcardFile(end), 'varados-dia-9-1400.png');
});

test('el aviso de la Tierra que asoma usa el rumbo de la serie, no uno escrito a mano', () => {
  assert.equal(texts('es').cabinEarthRise('sureste'), 'La Tierra asoma por el sureste: desde aquí ya se ve');
  const src = readFileSync(join(root, 'src/cabin/panel.js'), 'utf8');
  assert.match(src, /cabinEarthRise\(T\.winds\[compassPoint\(s\.earth\.az\)/);
});

test('la sombra del rover oscurece el suelo detrás del Sol, a todo lo ancho del rover y con penumbra', () => {
  const sh = roverShadow({ az: 90, el: 1 }, true); // Sol al este: sombra hacia el oeste (−x)
  assert.ok(ownShadowAt(-10, 0, sh) < 0.05, 'a 10 m al oeste, en sombra');
  assert.ok(ownShadowAt(-10, 2, sh) > 0.95, 'a 2 m del eje, fuera');
  assert.equal(ownShadowAt(10, 0, sh), 1, 'al este (hacia el Sol), nada');
  assert.ok(ownShadowAt(-19.6, 0, sh) < 0.2, 'a 20 m todavía oscura (la sombra mide 137 m)');
  assert.ok(ownShadowAt(-sh.length + 1, 0, sh) > ownShadowAt(-20, 0, sh), 'más tenue al final');
  assert.equal(ownShadowAt(-10, 0, null), 1, 'sin Sol sobre el rover, ninguna');
});

test('la sombra del rover se dibuja por píxel con los mismos números (GLSL y uniformes)', () => {
  const sh = roverShadow({ az: 90, el: 1 }, true);
  const u = ownShadowUniforms({ x: 0.5, z: -0.2 }, sh);
  assert.deepEqual(u.at, [0.5, -0.2]);
  assert.ok(Math.abs(u.dir[0] + 1) < 1e-9 && Math.abs(u.dir[1]) < 1e-9, 'hacia el oeste');
  assert.equal(u.length, sh.length);
  assert.equal(ownShadowUniforms({ x: 0, z: 0 }, null).length, 0);
  const glsl = ownShadowGlsl();
  assert.match(glsl, /float ownShadow\(vec2 xzKm\)/);
  assert.match(glsl, /0\.0093 \* max\(0\.0, along\) \+ 0\.1/);
  assert.match(glsl, /-0\.950/);
});
