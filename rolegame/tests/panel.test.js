// J13.4 (#312): the mission panel as in the mock-up: buttons with their real keys, the goal with the figures in
// bold and the panoramic horizon ring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables } from '../src/engine/index.js';
import { stripScale, stripX, stripY, stripLabels, sunTrack, drawStrip, STRIP_LO, STRIP_HI } from '../src/horizon-strip.js';
import { buttonKey, keyMatches, BUTTON_ICONS, ICON_PATHS } from '../src/panel-actions.js';
import { cellMask, ringSeries } from '../src/ring.js';
import { WAIT_ACTIONS } from '../src/wait.js';
import { TEXTS } from '../src/texts.js';
import { EN } from '../src/texts.en.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data/procedural-shackleton');
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const series = JSON.parse(readFileSync(join(dir, 'series.json'), 'utf8'));
const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const tables = createTables(buf('sun.bin'), scenario, buf('cells.bin'), buf('earth.bin'));
const masks = new Int16Array(buf('masks.bin'));
const PAD = scenario.pad.y * tables.n + scenario.pad.x;

// ---- Keys on the buttons ----

test('cada botón muestra la tecla que de verdad lo activa, y ninguna tecla inventada', () => {
  for (const id of ['transmit', ...WAIT_ACTIONS.map((a) => a.id)]) {
    const key = buttonKey(id);
    if (key !== null) assert.ok(keyMatches(id), `${id}: ${key} no activa ${id}`);
  }
  // The mock-up's keys, now also the map's (J13): every button has one.
  assert.deepEqual(['transmit', 'wait-2', 'wait-6', 'wait-sun', 'wait-earth'].map(buttonKey), ['T', '2', '6', 'S', 'E']);
});

test('los iconos de los botones existen', () => {
  for (const name of [...Object.values(BUTTON_ICONS), 'warn']) assert.ok(ICON_PATHS[name]?.length, name);
});

test('el objetivo en piezas dice lo mismo que el objetivo, con las cifras en negrita', () => {
  for (const T of [TEXTS, EN]) {
    const parts = T.goalRich(3, 15, 14);
    assert.equal(parts.map((p) => (typeof p === 'string' ? p : p.b)).join(''), T.goal(3, 15, 14));
    assert.ok(parts.filter((p) => typeof p !== 'string').length >= 3);
  }
  assert.equal(TEXTS.missionKicker, 'Parte 2 · Atascados');
});

// ---- Panoramic ring ----

test('stripX: el sur en los dos bordes, el oeste a un cuarto, el norte en el centro y el este a tres cuartos', () => {
  assert.equal(stripX(180, 360), 0);
  assert.equal(stripX(270, 360), 90);
  assert.equal(stripX(0, 360), 180);
  assert.equal(stripX(90, 360), 270);
  assert.equal(stripX(179.999, 360) > 359, true);
  assert.deepEqual(stripLabels(360, TEXTS.stripWinds).map((l) => l.text), ['S', 'O', 'N', 'E', 'S']);
  assert.deepEqual(stripLabels(360, EN.stripWinds).map((l) => l.text), ['S', 'W', 'N', 'E', 'S']);
});

test('stripScale: −4° … 11° por defecto, ampliada si un astro se sale', () => {
  const row = (s, e) => ({ sun: { el: s }, earth: { el: e } });
  assert.deepEqual(stripScale([row(1, 2)]), { lo: STRIP_LO, hi: STRIP_HI });
  assert.deepEqual(stripScale([row(1, -7.4)]), { lo: -9, hi: 11 });
  assert.deepEqual(stripScale([row(12.2, 0)]), { lo: -4, hi: 14 });
  const scale = { lo: -4, hi: 11 };
  assert.equal(stripY(-4, scale, 80), 80 - 14);
  assert.equal(stripY(11, scale, 80), 6);
  assert.equal(stripY(40, scale, 80), 6, 'el relieve más alto que la franja se recorta');
  assert.ok(stripY(0, scale, 80) > stripY(1, scale, 80));
});

// A 2D context that records what is drawn.
function recorder() {
  const calls = [];
  const g = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...args) => { calls.push([k, ...args]); return { addColorStop() {} }; }),
    set: (t, k, v) => { t[k] = v; calls.push(['set', k, v]); return true; },
  });
  return { g, calls };
}

test('drawStrip pone el Sol y la Tierra en su azimut y elevación, y el relieve con cellMask', () => {
  const mask = cellMask(masks, PAD);
  const rows = ringSeries(series, mask, tables.hours);
  const { g, calls } = recorder();
  const w = 360, h = 80, idx = 10;
  const scale = drawStrip(g, { mask, rows, idx, w, h, colors: {
    skyTop: 'a', skyBottom: 'b', zero: 'c', ground: 'd', skyline: 'e', sunTrack: 'f', sun: 'SUN', earth: 'EARTH', label: 'g',
  }, winds: TEXTS.stripWinds });
  assert.deepEqual(scale, stripScale(rows));
  const arcs = calls.filter((c) => c[0] === 'arc');
  const at = (b) => [stripX(b.az, w), stripY(b.el, scale, h)];
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  for (const b of [rows[idx].sun, rows[idx].earth]) {
    const [x, y] = at(b);
    assert.ok(arcs.some((c) => near(c[1], x) && near(c[2], y)), `falta un astro en ${x}, ${y}`);
  }
  // The skyline passes through the mask at the north (az 0, middle of the strip).
  const lines = calls.filter((c) => c[0] === 'lineTo');
  assert.ok(lines.some((c) => near(c[1], stripX(0, w)) && near(c[2], stripY(mask[0], scale, h))), 'el relieve no sale de cellMask');
});

test('la estela del Sol se corta al cruzar el sur, sin una raya de lado a lado', () => {
  const mask = cellMask(masks, PAD);
  const rows = ringSeries(series, mask, tables.hours);
  for (const seg of sunTrack(rows, 0, 360, stripScale(rows), 80)) {
    for (let k = 1; k < seg.length; k++) assert.ok(Math.abs(seg[k][0] - seg[k - 1][0]) <= 180);
  }
});

test('el resumen del anillo para el lector de pantalla habla del anillo, en los dos idiomas', () => {
  const mask = cellMask(masks, PAD);
  const c = ringSeries(series, mask, 1)[0];
  assert.match(TEXTS.ringSummary(c), /^Anillo del horizonte\. Sol al .+\. Tierra al .+: \d/);
  assert.match(EN.ringSummary(c), /^Horizon ring\. Sun to the .+\. Earth to the /);
  assert.equal(TEXTS.ringRange(-4, 11), '−4° … 11°');
});
