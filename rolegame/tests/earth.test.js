// J3: transmitting, the «Tierra visible» layer, the horizon ring and the Earth hints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, transmit, pass } from '../src/engine/index.js';
import { transmitLabel, transmitDisabled, transmitAnnouncement, missingPackets, seesEarthNow, transmitDurationMs } from '../src/transmit.js';
import { earthLayerOn, earthCells } from '../src/earth-layer.js';
import { cellMask, ringSeries, bearingPoint, maskAt, seriesRow } from '../src/ring.js';
import { missionHint, missionHintText } from '../src/mission-hint.js';
import { energyHint } from '../src/energy-hint.js';
import { waitDurationMs } from '../src/wait.js';
import { bearing } from '../../web/js/common/sky-polar.js';
import { TEXTS } from '../src/texts.js';
import { endAnnouncement } from '../src/end.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data/procedural-shackleton');
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));
const beg = levels.beg;
const realScenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const series = JSON.parse(readFileSync(join(dir, 'series.json'), 'utf8'));
const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const real = createTables(buf('sun.bin'), realScenario, buf('cells.bin'), buf('earth.bin'));
const masks = new Int16Array(buf('masks.bin'));
const START = realScenario.start.y * real.n + realScenario.start.x;
const PAD = realScenario.pad.y * real.n + realScenario.pad.x;

// Small synthetic world: 3 × 3 cells, 100 h.
const N = 3, HOURS = 100;
const scenario = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 0, y: 0 }, pad: { x: 2, y: 2 } };
function world(sunFill, visible) {
  const sun = new Uint8Array(HOURS * N * N);
  const bits = new Uint8Array(Math.ceil((HOURS * N * N) / 8));
  for (let h = 0; h < HOURS; h++) for (let c = 0; c < N * N; c++) {
    const o = h * N * N + c;
    sun[o] = sunFill(h, c);
    if (visible(h, c)) bits[o >> 3] |= 1 << (o & 7);
  }
  return createTables(sun.buffer, scenario, undefined, bits.buffer);
}
const game = (sunFill, visible, extra = {}) => ({ ...newGame(scenario, beg, world(sunFill, visible)), ...extra });

// ---- Transmit (J3.1) ----

test('el botón dice las horas y el gasto extra del nivel', () => {
  assert.equal(transmitLabel(beg, TEXTS), 'Transmitir · 1 h · −2 %');
  assert.equal(transmitLabel(levels.mid, TEXTS), 'Transmitir · 2 h · −3 %');
});

test('transmitDisabled: solo activo con la Tierra a la vista, paquetes pendientes y nada en marcha', () => {
  const g = game(() => 255, () => true);
  assert.equal(transmitDisabled(g, { planned: false, busy: false }), false);
  assert.equal(transmitDisabled(g, { planned: true, busy: false }), true);
  assert.equal(transmitDisabled(g, { planned: false, busy: true }), true);
  assert.equal(transmitDisabled({ ...g, over: 'time' }, { planned: false, busy: false }), true);
  assert.equal(transmitDisabled({ ...g, sent: beg.need }, { planned: false, busy: false }), true);
  assert.equal(transmitDisabled(game(() => 255, () => false), { planned: false, busy: false }), true);
});

test('el anuncio dice el paquete enviado, la batería y el reloj, o el final de partida', () => {
  const g = game(() => 255, () => true);
  const after = transmit(g);
  assert.equal(transmitAnnouncement(g, after, TEXTS), `Paquete enviado (1/3). Batería ${Math.floor(after.battery)} %, día 1 · 01:00`);
  const dead = { ...game(() => 0, () => true), battery: 1 };
  assert.equal(transmitAnnouncement(dead, transmit(dead), TEXTS), endAnnouncement(transmit(dead), TEXTS));
  assert.equal(transmitDurationMs(beg), waitDurationMs(1));
});

test('missingPackets: en ASCENSO con batería suficiente y sin todos los paquetes', () => {
  const atPad = game(() => 255, () => true, { x: 2, y: 2 });
  assert.equal(missingPackets(atPad), 3);
  assert.equal(missingPackets({ ...atPad, sent: 1 }), 2);
  assert.equal(missingPackets({ ...atPad, sent: 3 }), 0);
  assert.equal(missingPackets({ ...atPad, battery: beg.minBat - 1 }), 0);
  assert.equal(missingPackets(game(() => 255, () => true)), 0, 'fuera de la plataforma');
  assert.equal(TEXTS.missingPackets(2), 'Estás en ASCENSO, pero faltan 2 paquetes por enviar.');
  assert.equal(TEXTS.missingPackets(1), 'Estás en ASCENSO, pero falta 1 paquete por enviar.');
});

test('el objetivo de la misión sale del nivel', () => {
  assert.equal(TEXTS.goal(beg.need, beg.minBat, beg.deadline / 24),
    'Control de misión necesita tu informe para autorizar el despegue: envíalo a la Tierra en 3 paquetes, cada uno desde una zona distinta, y llega a ASCENSO con al menos 15 % de batería antes del día 14.');
});

// ---- «Tierra visible» layer (J3.2) ----

test('earthLayerOn: siempre con on, a voluntad con toggle y nunca con none', () => {
  assert.equal(earthLayerOn({ earth: 'on' }, false), true);
  assert.equal(earthLayerOn({ earth: 'on' }, true), true);
  assert.equal(earthLayerOn({ earth: 'toggle' }, true), true);
  assert.equal(earthLayerOn({ earth: 'toggle' }, false), false);
  assert.equal(earthLayerOn({ earth: 'none' }, true), false);
  assert.equal(earthLayerOn(beg, false), true);
});

test('earthCells en el escenario real: 1.458 celdas a 0 h, 884 a 168 h, 8 a 240 h y ninguna a 300 h', () => {
  assert.equal(earthCells(real, 0).length, 1458);
  assert.equal(earthCells(real, 168).length, 884);
  assert.equal(earthCells(real, 240).length, 8);
  assert.equal(earthCells(real, 300).length, 0);
});

test('earthCells: la salida no ve la Tierra nunca y la plataforma sí a 0 h', () => {
  for (let h = 0; h < real.hours; h++) assert.ok(!earthCells(real, h).includes(START), `hora ${h}`);
  assert.ok(earthCells(real, 0).includes(PAD));
});

test('liveCursor dice si desde la celda se ve la Tierra', async () => {
  const { cellReport } = await import('../src/cell-report.js');
  const at = (cell) => TEXTS.liveCursor(cellReport({ tables: real, seesEarth: real.seesEarth, scenario: realScenario, cell, hour: 0 }));
  assert.match(at(realScenario.pad), /· Tierra visible ·/);
  assert.doesNotMatch(at(realScenario.start), /Tierra/);
});

// ---- Horizon ring (J3.4) ----

test('cellMask: 360 valores que coinciden con masks.bin en los múltiplos de 5°', () => {
  for (const cell of [0, START, PAD, real.n * real.n - 1]) {
    const mask = cellMask(masks, cell);
    assert.equal(mask.length, 360);
    for (let k = 0; k < 72; k++) assert.equal(mask[k * 5], masks[cell * 72 + k] / 100);
    // In between, linear: the middle of two knots is their mean.
    assert.ok(Math.abs(mask[2.5 * 2] - mask[5]) < 1e-9);
    assert.ok(Math.abs(maskAt(mask, 2.5) - (mask[0] + mask[5]) / 2) < 1e-9);
  }
});

test('el anillo dice lo mismo que earth.bin y sun.bin en todas las celdas y horas (salvo redondeo)', () => {
  let checked = 0;
  for (let cell = 0; cell < real.n * real.n; cell++) {
    const rows = ringSeries(series, cellMask(masks, cell), real.hours);
    assert.equal(rows.length, real.hours);
    for (let h = 0; h < real.hours; h++) {
      const { sun, earth } = rows[h];
      if (Math.abs(earth.margin) > 0.02) assert.equal(earth.margin > 0, real.seesEarth(cell, h), `Tierra celda ${cell} hora ${h}`);
      if (Math.abs(sun.margin) > 0.02) assert.equal(sun.margin > 0, real.sunFrac(cell, h) > 0.5, `Sol celda ${cell} hora ${h}`);
      checked++;
    }
  }
  assert.equal(checked, real.n * real.n * real.hours);
});

test('en la salida a 0 h la Tierra está tapada por el relieve y en ASCENSO, sobre él', () => {
  assert.ok(ringSeries(series, cellMask(masks, START), 1)[0].earth.margin <= 0);
  assert.ok(ringSeries(series, cellMask(masks, PAD), 1)[0].earth.margin > 0);
});

test('bearingPoint: norte arriba, este a la derecha, sur abajo', () => {
  const near = (p, x, y) => assert.ok(Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9, JSON.stringify(p));
  near(bearingPoint(0, 100, 10), 50, 10);
  near(bearingPoint(90, 100, 10), 90, 50);
  near(bearingPoint(180, 100, 10), 50, 90);
  near(bearingPoint(270, 100, 10), 10, 50);
});

test('la flecha de la Tierra apunta al azimut de la serie (hoy, abajo a la derecha del mapa)', () => {
  for (let h = 0; h < real.hours; h++) {
    const az = series.earth.az[h];
    assert.ok(az >= 130 && az <= 145, `hora ${h}: ${az}`);
    const p = bearingPoint(az, 640, 14);
    assert.ok(p.x > 320 && p.y > 320, `hora ${h}`);
  }
  assert.equal(seriesRow(real.hours, 400), real.hours - 1);
  assert.equal(seriesRow(real.hours, 5.9), 5);
});

// ---- Mission hints (J3.5) ----

test('a 0 h solo sale la pista de energía', () => {
  assert.equal(missionHint(game(() => 255, () => true)), null);
  assert.equal(missionHint(game(() => 0, () => true, { battery: 59 })), 'shadow-low');
});

test('prioridad de las pistas con t > 0', () => {
  const t = 3;
  assert.equal(missionHint(game(() => 0, () => false, { t, sent: 3, battery: 10 })), 'all-sent');
  assert.equal(missionHint(game(() => 0, () => true, { t, battery: 59 })), 'shadow-low');
  assert.equal(missionHint(game(() => 255, () => true, { t })), 'earth-here');
  // Another cell sees the Earth: go there. No cell sees it at all (#382): it is too low, say when it rises.
  assert.equal(missionHint(game(() => 255, (_h, c) => c === 8, { t })), 'earth-elsewhere');
  assert.equal(missionHint(game(() => 255, () => false, { t })), 'earth-few');
  assert.equal(missionHint(game(() => 255, () => true, { t, over: 'win' })), null);
});

test('el texto de earth-elsewhere habla de las zonas azules o del anillo, con el rumbo de la serie', () => {
  assert.match(missionHintText('earth-elsewhere', { earthLayer: true, wind: 'SE' }, TEXTS), /zonas azules/);
  const wind = bearing(series.earth.az[0]).wind;
  assert.equal(wind, 'SE');
  const ring = missionHintText('earth-elsewhere', { earthLayer: false, wind }, TEXTS);
  assert.match(ring, /anillo del horizonte/);
  assert.match(ring, /sureste/);
  assert.equal(missionHintText('all-sent', {}, TEXTS), 'Ya está todo enviado: ve a ASCENSO con batería de sobra.');
  assert.equal(missionHintText('earth-here', {}, TEXTS), 'Desde aquí se ve la Tierra: puedes transmitir.');
  assert.equal(missionHintText('shadow-low', {}, TEXTS), TEXTS.energyShadowLow);
  assert.equal(missionHintText(null, {}, TEXTS), null);
});

test('ningún texto dice que la Tierra está al norte', () => {
  const src = readFileSync(join(root, 'src/texts.js'), 'utf8');
  assert.doesNotMatch(src, /Tierra[^'`]*(al|por el) norte/);
});

test('la regla de energía de J2.4 no cambia', () => {
  const g = game(() => 0, () => true, { t: 2, battery: 59 });
  assert.equal(energyHint(g), 'shadow-low');
  assert.equal(energyHint({ ...g, battery: 60 }), null);
});

test('el escenario real: transmitir en la plataforma a 0 h funciona y la salida no puede', () => {
  const g = newGame(realScenario, beg, real);
  assert.equal(seesEarthNow(g), false);
  assert.equal(transmit(g), g);
  const atPad = { ...g, x: realScenario.pad.x, y: realScenario.pad.y };
  assert.equal(transmit(atPad).sent, 1);
  assert.ok(pass(g, 1).t === 1);
});

// ---- Packages from different zones (J3.6, #293) ----

test('J3.6: con la Tierra a la vista pero un envío cerca, el botón se apaga y dice por qué', async () => {
  const { transmitBlock } = await import('../src/transmit.js');
  const g = game(() => 255, () => true, { t: 2 });
  assert.equal(transmitBlock(g), null);
  const sent = transmit(g);
  assert.equal(transmitDisabled(sent, { planned: false, busy: false }), true);
  assert.equal(transmitBlock(sent), 'near-sent');
  assert.equal(missionHint(sent), 'earth-near-sent');
  assert.equal(missionHintText('earth-near-sent', { minKm: 1 }, TEXTS),
    'Desde aquí se ve la Tierra, pero ya enviaste un paquete cerca: busca otra zona azul a más de 1 km.');
  assert.equal(TEXTS.transmitNearSent(1), 'Ya enviaste desde aquí: busca otra zona azul a más de 1 km.');
  // Without the Earth in sight the reason is the layer, not the distance.
  assert.equal(transmitBlock(game(() => 255, () => false, { t: 2 })), null);
});

test('J3.6: el cursor dice si desde la celda ya se envió cerca', async () => {
  const { cellReport } = await import('../src/cell-report.js');
  const { sentTooClose } = await import('../src/engine/index.js');
  const s = { ...newGame(realScenario, beg, real), x: realScenario.pad.x, y: realScenario.pad.y };
  const sent = transmit(s);
  const report = (cell) => cellReport({ tables: real, scenario: realScenario, cell, hour: sent.t, seesEarth: real.seesEarth, nearSent: (c) => sentTooClose(sent, c) });
  const here = report(realScenario.pad);
  assert.equal(here.earth, true);
  assert.equal(here.nearSent, true);
  assert.match(TEXTS.liveCursor(here), /Tierra visible, pero ya enviaste cerca/);
  const far = report({ x: realScenario.pad.x, y: realScenario.pad.y + 6 });
  assert.equal(far.nearSent, false);
});

test('J3.6: la leyenda solo enseña los círculos tras el primer envío', async () => {
  const { legendItems, sentRadiusPx } = await import('../src/map-legend.js');
  assert.ok(!legendItems({ earthLayer: true }).some((r) => r.id === 'sent'));
  assert.ok(legendItems({ earthLayer: true, sent: 1 }).some((r) => r.id === 'sent'));
  assert.equal(typeof TEXTS.legend.sent, 'string');
  assert.equal(sentRadiusPx(1, 250, 10), 40);
});
