// Cabin (J12): why «Transmitir» is off, the Earth hidden by the relief, and where the rover heads (guide line,
// heading in the compass, cone on the minimap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, transmit, slope } from '../src/engine/index.js';
import { transmitDisabled, transmitReason } from '../src/transmit.js';
import { guidePath, slopeTone, headingLabel, STEEP_SHARE } from '../src/cabin/guide.js';
import { transmitWhy } from '../src/cabin/panel.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));
const beg = levels.beg;

// 9 × 9 cells of 250 m, Sun everywhere; Earth from the cells `seen(c)`.
const N = 9, HOURS = 50;
const scenario = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 4, y: 4 }, pad: { x: 8, y: 8 } };
function world(seen, heights = null) {
  const sun = new Uint8Array(HOURS * N * N).fill(255);
  const bits = new Uint8Array(Math.ceil((HOURS * N * N) / 8));
  for (let h = 0; h < HOURS; h++) for (let c = 0; c < N * N; c++) { const o = h * N * N + c; if (seen(c)) bits[o >> 3] |= 1 << (o & 7); }
  return createTables(sun.buffer, scenario, heights ? new Float32Array(heights).buffer : undefined, bits.buffer);
}

test('el motivo de «Transmitir» coincide con transmitDisabled en cada caso, también con la regla de 1 km', () => {
  const everywhere = world(() => true);
  const g = newGame(scenario, beg, everywhere);
  const cases = [
    [g, {}],
    [newGame(scenario, beg, world(() => false)), {}],
    [{ ...g, over: 'time' }, {}],
    [{ ...g, sent: beg.need }, {}],
    [g, { planned: true }],
    [g, { busy: true }],
    [transmit(g), {}], // a package sent from this cell: the next one has to go from more than 1 km away
  ];
  const seen = new Set();
  for (const [s, opts] of cases) {
    const o = { planned: false, busy: false, ...opts };
    const reason = transmitReason(s, o);
    assert.equal(reason === null, !transmitDisabled(s, o), JSON.stringify({ reason, opts }));
    seen.add(reason);
  }
  assert.deepEqual([...seen].sort(), [null, 'all-sent', 'busy', 'near-sent', 'no-earth', 'over', 'planned'].sort());
});

test('el texto del motivo dice adónde ir, el kilómetro de la regla o que ya están todos', () => {
  const T = texts('es');
  const windOf = (az) => T.winds[['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(az / 45) % 8]];
  assert.equal(transmitWhy({ reason: null }, T, windOf), '');
  assert.equal(transmitWhy({ reason: 'planned' }, T, windOf), '');
  assert.equal(transmitWhy({ reason: 'no-earth', zone: { km: 1.2, bearing: 45, now: true } }, T, windOf),
    'Desde aquí no se ve la Tierra: ve a una zona azul (1,2 km al noreste).');
  assert.match(transmitWhy({ reason: 'no-earth', zone: { km: 3, bearing: 135, now: false } }, T, windOf), /pronto .* 3,0 km al sureste/);
  assert.equal(transmitWhy({ reason: 'no-earth', zone: null }, T, windOf), 'Desde aquí no se ve la Tierra.');
  assert.equal(transmitWhy({ reason: 'near-sent', minKm: 1 }, T, windOf), 'Ya enviaste cerca: busca otra zona a más de 1 km.');
  assert.equal(transmitWhy({ reason: 'all-sent' }, T, windOf), 'Ya están todos los paquetes enviados.');
  const E = texts('en');
  assert.match(transmitWhy({ reason: 'no-earth', zone: { km: 1.2, bearing: 45, now: true } }, E, () => 'northeast'), /go to a blue zone \(1\.2 km to the northeast\)/);
});

test('tono de la pendiente: verde transitable, amarillo cuesta y rojo imposible según maxSlope', () => {
  assert.equal(slopeTone(0, 26), 'ok');
  assert.equal(slopeTone(26 * STEEP_SHARE + 0.1, 26), 'steep');
  assert.equal(slopeTone(26, 26), 'steep');
  assert.equal(slopeTone(26.1, 26), 'no');
});

test('la línea guía va hacia el rumbo del rover y toma el tono de la celda en la que entra', () => {
  // A wall of 600 m one cell to the east (x = 5): impossible to enter from (4, 4).
  const heights = Array.from({ length: N * N }, (_, i) => (i % N === 5 ? 600 : 0));
  const t = world(() => true, heights);
  const cellSlope = (a, b) => (b.x < 0 || b.y < 0 || b.x >= N || b.y >= N ? null : slope(t, a.y * N + a.x, b.y * N + b.x));
  const opts = { cellM: 250, n: N, maxSlope: beg.maxSlope, cellSlope, lengthKm: 0.4, stepKm: 0.05 };
  const east = guidePath({ x: 4, y: 4, heading: Math.PI / 2 }, opts);
  assert.ok(east.every((p) => Math.abs(p.y - 4) < 1e-9), 'al este no cambia de fila');
  assert.ok(east[east.length - 1].x > 5, 'llega a la celda de la pared');
  assert.equal(east[0].tone, 'ok', 'dentro de su celda');
  assert.equal(east.find((p) => Math.round(p.x) === 5).tone, 'no', 'la pared es imposible');
  const north = guidePath({ x: 4, y: 4, heading: 0 }, opts);
  assert.ok(north[north.length - 1].y < 4, 'al norte, y baja');
  assert.ok(north.every((p) => p.tone === 'ok'), 'al norte es llano');
  // It stops at the edge of the grid.
  assert.ok(guidePath({ x: 0, y: 4, heading: -Math.PI / 2 }, opts).length <= 2);
});

test('rumbo en la brújula: viento y tres cifras', () => {
  const T = texts('es'), E = texts('en');
  assert.equal(headingLabel(Math.PI / 4, T.windsAbbr), 'NE · 045°');
  assert.equal(headingLabel(0, T.windsAbbr), 'N · 000°');
  assert.equal(headingLabel((3 * Math.PI) / 2, T.windsAbbr), 'O · 270°');
  assert.equal(headingLabel((3 * Math.PI) / 2, E.windsAbbr), 'W · 270°');
  assert.equal(headingLabel(-Math.PI / 4, E.windsAbbr), 'NW · 315°');
});

test('la cabina se apoya en el motor: Tierra del cielo, motivo, línea guía y cono del minimapa', () => {
  const panel = readFileSync(join(root, 'src/cabin/panel.js'), 'utf8');
  assert.match(panel, /earthSeen: game\.earthSeenHere\?\.\(\)/);
  assert.match(panel, /game\.cabinTransmit\?\.\(\)/);
  assert.match(panel, /game\.setCabinHeading\?\.\(car\.heading\)/);
  assert.match(panel, /setCabinHeading\?\.\(null\)/);
  const scene = readFileSync(join(root, 'src/cabin/scene.js'), 'utf8');
  assert.match(scene, /const hidden = !earthSeen && e\.el > 0/);
  const game = readFileSync(join(root, 'src/game.js'), 'utf8');
  assert.match(game, /transmitReason\(state, \{ planned: Boolean\(plan\), busy \}\)/);
  assert.match(game, /drawHeadingCone\(/);
  // The guide can be switched off in «Ajustes».
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /id="guide-btn" role="switch"/);
  for (const lang of ['es', 'en']) for (const k of ['cabinGuide', 'cabinGuideDesc', 'cabinEarthHidden', 'cabinTxAllSent']) assert.equal(typeof texts(lang)[k], 'string');
});
