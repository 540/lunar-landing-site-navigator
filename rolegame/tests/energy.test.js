import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, pass } from '../src/engine/index.js';
import { batteryLevel, darkHours, batteryValueText } from '../src/battery.js';
import { energyHint, announceHint } from '../src/energy-hint.js';
import { TEXTS } from '../src/texts.js';

const here = dirname(fileURLToPath(import.meta.url));
const level = JSON.parse(readFileSync(join(here, '../data/levels.json'), 'utf8')).beg;

// One-cell scenario whose only cell has the given Sun fraction at every hour.
const N = 1;
const HOURS = 400;
const scenario = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 0, y: 0 }, pad: { x: 0, y: 0 } };
const withSun = (frac) => createTables(new Uint8Array(HOURS).fill(Math.round(frac * 255)).buffer, scenario);
const game = (frac, battery) => ({ ...newGame(scenario, level, withSun(frac)), battery });

test('batteryLevel: rojo bajo el mínimo, amarillo bajo 40 % y verde desde 40 %', () => {
  const lvl = { minBat: 15 };
  assert.equal(batteryLevel(14, lvl), 'bad');
  assert.equal(batteryLevel(15, lvl), 'warn');
  assert.equal(batteryLevel(39, lvl), 'warn');
  assert.equal(batteryLevel(40, lvl), 'good');
  assert.equal(batteryLevel(level.bat0, level), 'good');
});

test('darkHours: horas enteras que aguanta parado en sombra', () => {
  assert.equal(darkHours(60, { loadDark: 1.2 }), 50);
  assert.equal(darkHours(0, { loadDark: 1.2 }), 0);
  assert.equal(darkHours(85, level), 70);
});

test('el medidor dice el porcentaje y si está por debajo del mínimo', () => {
  assert.equal(batteryValueText(85.6, level, TEXTS), '85 %, por encima del mínimo para despegar (15 %)');
  assert.equal(batteryValueText(14.2, level, TEXTS), '14 %, por debajo del mínimo para despegar (15 %)');
  assert.match(TEXTS.darkHoursValue(70), /^~70 h parado en sombra$/);
});

test('energyHint: en sombra y con menos de 60 % avisa; al Sol o con 60 % no', () => {
  assert.equal(energyHint(game(0.3, 59)), 'shadow-low');
  assert.equal(energyHint(game(0.3, 60)), null);
  assert.equal(energyHint(game(0.8, 10)), null);
});

test('energyHint: sunFrac 0,5 cuenta como sombra (umbral estricto)', () => {
  // 0,5 exacto no cabe en un byte de sun.bin: se comprueba la regla con una tabla que devuelve 0,5.
  const half = { ...game(0, 30), tables: { n: 1, sunFrac: () => 0.5 } };
  assert.equal(energyHint(half), 'shadow-low');
  const justOver = { ...half, tables: { n: 1, sunFrac: () => 0.51 } };
  assert.equal(energyHint(justOver), null);
});

test('energyHint: con la partida acabada no se muestra', () => {
  const over = pass(game(0, 5), 100);
  assert.ok(over.over);
  assert.equal(energyHint(over), null);
});

test('la pista se anuncia una vez cada vez que aparece', () => {
  assert.equal(announceHint(null, 'shadow-low'), true);
  assert.equal(announceHint('shadow-low', 'shadow-low'), false);
  assert.equal(announceHint('shadow-low', null), false);
  assert.equal(announceHint(null, null), false);
  assert.match(TEXTS.energyShadowLow, /^Estás en sombra y la batería baja: muévete a una zona iluminada o espera al Sol\.$/);
});
