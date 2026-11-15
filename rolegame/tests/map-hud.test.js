// State over the map (J13.2, #310): model of the pills, rover heading and reading line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame } from '../src/engine/index.js';
import { hudModel, roverHeading, readoutParts, LATE_HOURS } from '../src/map-hud.js';
import { cellReport } from '../src/cell-report.js';
import { TEXTS, texts } from '../src/texts.js';

const here = dirname(fileURLToPath(import.meta.url));
const levels = JSON.parse(readFileSync(join(here, '../data/levels.json'), 'utf8'));
const level = levels.beg;
const N = 3, HOURS = 400;
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
const START_MS = Date.parse('2027-08-21T10:00:00.000Z');
const viewOf = (s) => ({ x: s.x, y: s.y, t: s.t, battery: s.battery, route: s.route });
const model = (s, showEarth = true) => hudModel({ state: s, view: viewOf(s), level: s.level, tables: s.tables, startMs: START_MS, showEarth });

test('hudModel: batería, reloj, paquetes y comprobaciones del estado', () => {
  const s = { ...newGame(scenario, level, world(() => 255, () => true)), t: 30.5, battery: 38.7, sent: 1 };
  const m = model(s);
  assert.deepEqual(m.battery, { pct: 38, fill: 38.7, tone: 'warn', minBat: level.minBat, raw: 38.7 });
  assert.equal(m.clock.day, 2);
  assert.equal(m.clock.hour, 6);
  assert.equal(m.clock.utc, START_MS + 30.5 * 3600e3);
  assert.ok(Math.abs(m.clock.daysLeft - (level.deadline - 30.5) / 24) < 1e-9);
  assert.equal(m.clock.late, false);
  assert.deepEqual(m.packets, { sent: 1, need: level.need });
  assert.deepEqual(m.checks, { packets: false, ready: false });
  const done = model({ ...s, sent: level.need });
  assert.deepEqual(done.checks, { packets: true, ready: true });
  assert.equal(model({ ...s, battery: level.minBat - 1 }).battery.tone, 'bad');
});

test('hudModel: el reloj se pone en rojo a menos de 48 h del día límite', () => {
  const s = newGame(scenario, level, world(() => 255, () => true));
  assert.equal(LATE_HOURS, 48);
  assert.equal(model({ ...s, t: level.deadline - 48 }).clock.late, false);
  assert.equal(model({ ...s, t: level.deadline - 47.5 }).clock.late, true);
});

test('hudModel: Sol y Tierra en la celda del rover; la Tierra solo si su capa está en el mapa', () => {
  const lit = newGame(scenario, level, world(() => 255, () => true));
  assert.equal(model(lit).lit, true);
  assert.equal(model(lit).earth, true);
  assert.equal(model(lit, false).earth, null, 'sin capa no se dice');
  const dark = newGame(scenario, level, world(() => 0, () => false));
  assert.equal(model(dark).lit, false);
  assert.equal(model(dark).earth, false);
});

test('roverHeading: hacia el último paso, o hacia la plataforma antes de moverse', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  near(roverHeading([{ x: 1, y: 1 }, { x: 1, y: 0 }], { x: 5, y: 5 }), 0);
  near(roverHeading([{ x: 1, y: 1 }, { x: 2, y: 1 }], { x: 5, y: 5 }), Math.PI / 2);
  near(roverHeading([{ x: 1, y: 1 }, { x: 1, y: 2 }], { x: 5, y: 5 }), Math.PI);
  near(roverHeading([{ x: 0, y: 0 }], { x: 3, y: 3 }), (3 * Math.PI) / 4);
  near(roverHeading([{ x: 2, y: 2 }], { x: 2, y: 2 }), 0);
});

test('la línea bajo el mapa dice lo mismo que el anuncio del cursor', () => {
  const tables = world(() => 255, () => true);
  const report = cellReport({ tables, scenario, cell: { x: 0, y: 1 }, hour: 0, seesEarth: tables.seesEarth });
  const parts = readoutParts(report, false, TEXTS);
  assert.equal(parts.head, '1·2');
  assert.equal(`Columna 1, fila 2 · ${parts.rest}`, TEXTS.liveCursor(report, false));
  assert.match(readoutParts(report, true, TEXTS).rest, /tu rover está aquí$/);
  assert.match(readoutParts(report, true, texts('en')).rest, /your rover is here$/);
});

test('textos de las píldoras en español e inglés', () => {
  const en = texts('en');
  const ms = Date.parse('2027-08-21T10:00:00.000Z');
  assert.equal(TEXTS.hudUtcShort(ms), '21 ago · 10:00 UTC');
  assert.equal(en.hudUtcShort(ms), '21 Aug · 10:00 UTC');
  assert.equal(TEXTS.hudDaysLeft(13.62), '−13,6 d');
  assert.equal(en.hudDaysLeft(13.62), '−13.6 d');
  assert.equal(TEXTS.checkPackets(1, 3), 'Paquetes 1/3');
  assert.equal(en.checkPackets(1, 3), 'Packets 1/3');
  for (const k of ['statLit', 'statDark', 'statEarth', 'statNoEarth', 'checkReady', 'legendButton', 'hudBatteryTitle']) {
    assert.equal(typeof TEXTS[k], 'string', k);
    assert.notEqual(TEXTS[k], en[k], k);
  }
});

test('el juego monta la capa sobre el mapa y ya no repite batería, reloj ni paquetes en el panel', () => {
  const src = readFileSync(join(here, '../src/game.js'), 'utf8');
  assert.match(src, /createMapHud\(canvas\.parentElement/);
  assert.match(src, /drawRover\(ctx/);
  assert.doesNotMatch(src, /\[TEXTS\.hudBattery, /);
  assert.doesNotMatch(src, /\[TEXTS\.hudClock, /);
  assert.doesNotMatch(src, /\[TEXTS\.hudPackets, /);
});

test('#382: dos celdas juntas que ven la Tierra llevan una sola etiqueta «Ve la Tierra»', async () => {
  const { spotLabels } = await import('../src/map-hud.js');
  const n = 48;
  const at = (x, y) => y * n + x;
  const kept = spotLabels([at(0, 10), at(0, 11), at(1, 11), at(20, 30)], n);
  assert.deepEqual([...kept], [at(0, 10), at(20, 30)]);
});
