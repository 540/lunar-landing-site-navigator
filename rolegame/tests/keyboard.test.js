// J10.3: keyboard and screen reader on the map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame } from '../src/engine/index.js';
import { distanceKm, compassDir, cellReport, keyAction, missionStatus, SHORTCUTS } from '../src/cell-report.js';
import { padDistanceKm } from '../src/hint.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const realScenario = JSON.parse(readFileSync(join(root, 'data/procedural-shackleton/scenario.json'), 'utf8'));
const level = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8')).beg;
const ES = texts('es');
const EN = texts('en');

test('distanceKm: en línea recta, y padDistanceKm da lo mismo que antes', () => {
  assert.ok(Math.abs(distanceKm({ x: 24, y: 31 }, { x: 34, y: 11 }, 250) - 5.59) <= 0.01);
  const before = Math.hypot(realScenario.pad.x - realScenario.start.x, realScenario.pad.y - realScenario.start.y) * realScenario.grid.cellM / 1000;
  assert.equal(padDistanceKm(realScenario, realScenario.grid.cellM), before);
});

test('compassDir: ocho puntos por el signo, norte hacia arriba', () => {
  assert.equal(compassDir({ x: 0, y: 5 }, { x: 0, y: 1 }), 'n');
  assert.equal(compassDir({ x: 0, y: 5 }, { x: 3, y: 1 }), 'ne');
  assert.equal(compassDir({ x: 5, y: 0 }, { x: 1, y: 4 }), 'so');
  assert.equal(compassDir({ x: 2, y: 2 }, { x: 2, y: 2 }), '');
});

// 4 × 4 cells, 2 hours. Cell 5 has Sun 1 at hour 0, cell 6 has 0.5; the Earth is visible from cell 5 at hour 0.
const N = 4, HOURS = 2;
const scenario = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 0, y: 0 }, pad: { x: 3, y: 0 } };
const sun = new Uint8Array(HOURS * N * N);
sun[5] = 255; sun[6] = 128;
const bits = new Uint8Array(Math.ceil((HOURS * N * N) / 8));
bits[0] = 1 << 5;
const tables = createTables(sun.buffer, scenario, undefined, bits.buffer);
const half = createTables(Uint8Array.from(sun, (v, i) => (i === 6 ? 127 : v)).buffer, scenario);

test('cellReport: Sol, Tierra y plataforma de la celda', () => {
  const lit = cellReport({ tables, seesEarth: tables.seesEarth, scenario, cell: { x: 1, y: 1 }, hour: 0 });
  assert.equal(lit.lit, true);
  assert.equal(lit.earth, true);
  assert.deepEqual([lit.col, lit.row, lit.padDir], [2, 2, 'ne']);
  const halfSun = cellReport({ tables: half, scenario, cell: { x: 2, y: 1 }, hour: 0 });
  assert.equal(half.sunFrac(6, 0), 127 / 255);
  assert.equal(halfSun.lit, false, 'sunFrac ≤ 0,5 es sombra');
  assert.equal(halfSun.earth, null, 'sin seesEarth no hay Tierra que contar');
  assert.doesNotMatch(ES.liveCursor(halfSun), /Tierra/);
});

test('liveCursor: celda al Sol, con la Tierra, plataforma a 0,4 km al noreste', () => {
  const report = { col: 34, row: 13, lit: true, earth: true, padKm: distanceKm({ x: 33, y: 12 }, { x: 34, y: 11 }, 250), padDir: compassDir({ x: 33, y: 12 }, { x: 34, y: 11 }) };
  assert.equal(ES.liveCursor(report), 'Columna 34, fila 13 · al Sol · Tierra visible · ASCENSO a 0,4 km al noreste');
  assert.equal(EN.liveCursor(report), 'Column 34, row 13 · sunlit · Earth visible · ASCENT 0.4 km to the northeast');
  assert.match(ES.liveCursor(report, true), /^Tu rover · Columna 34/);
});

test('liveCursor: en la plataforma dice «ASCENSO, aquí»', () => {
  const r = cellReport({ tables, scenario, cell: scenario.pad, hour: 0 });
  assert.match(ES.liveCursor(r), /ASCENSO, aquí$/);
  assert.match(EN.liveCursor(r), /ASCENT is here$/);
});

test('keyAction: los atajos de la maqueta (T, 2, 6, S, E, L, O, R), más C, P y ?; con Ctrl, Cmd o Alt, nada', () => {
  const expected = {
    t: 'transmit', 2: 'wait-2', 6: 'wait-6', s: 'wait-sun', e: 'wait-earth', l: 'earth-layer', o: 'goal', r: 'status',
    c: 'cursor-rover', p: 'cursor-pad', '?': 'help',
  };
  for (const [key, action] of Object.entries(expected)) {
    assert.equal(keyAction({ key }), action, key);
    assert.equal(keyAction({ key: key.toUpperCase(), shiftKey: true }), action, `Mayús+${key}`);
  }
  assert.equal(keyAction({ key: 'v' }), null, 'la V de J6.5 pasó a L');
  assert.equal(keyAction({ key: 'x' }), null);
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    for (const key of Object.keys(expected)) assert.equal(keyAction({ key, [mod]: true }), null, `${mod}+${key}`);
  }
  // Each action has one key and each key one action.
  assert.equal(new Set(Object.values(SHORTCUTS)).size, Object.keys(SHORTCUTS).length);
});

test('R lee el estado de la misión: batería, reloj, paquetes, Sol y Tierra', () => {
  const s = missionStatus({ ...newGame(scenario, level, tables), battery: 61.7, t: 30.5, sent: 1 });
  assert.deepEqual({ battery: s.battery, day: s.day, hour: s.hour, sent: s.sent, need: s.need }, { battery: 61, day: 2, hour: 6, sent: 1, need: level.need });
  assert.equal(s.hoursLeft, Math.floor(level.deadline - 30.5));
  assert.match(ES.liveStatus(s), /^Batería 61 % \(mínimo \d+ %\)\. Día 2 · 06:00, quedan \d+ h\. Paquetes 1 de \d\. (Al Sol|En sombra), (se ve la Tierra|la Tierra no se ve)\.$/);
  assert.match(EN.liveStatus(s), /^Battery 61% \(minimum \d+%\)\. Day 2 · 06:00, \d+ h left\. Packets 1 of \d\. (Sunlit|In shadow), Earth is (not )?visible\.$/);
  assert.doesNotMatch(ES.liveStatus(missionStatus(newGame(scenario, level, tables), { earthShown: false })), /Tierra/);
});

test('la ayuda y el nombre del mapa hablan de los atajos, en los dos idiomas', () => {
  for (const T of [ES, EN]) {
    assert.match(T.mapLabel, /\?|interrogación|question mark/);
    for (const key of ['T', '2', '6', 'S', 'E', 'L', 'O', 'R', 'C', 'P']) assert.match(T.shortcutsHelp, new RegExp(`\\b${key}\\b`));
  }
  assert.equal(ES.shortcutTitle(SHORTCUTS['wait-sun']), 'Atajo en el mapa: S');
  assert.equal(EN.shortcutTitle(SHORTCUTS.transmit), 'Map shortcut: T');
});
