// #382: where and when the Earth will be in sight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame } from '../src/engine/index.js';
import { earthOutlook, earthForecastCells, nextEarthHour, earthCounts, fewThreshold, FEW_EARTH_CELLS, outlookDay } from '../src/earth-outlook.js';
import { missionHint, missionHintText, outlookText } from '../src/mission-hint.js';
import { cellReport } from '../src/cell-report.js';
import { hudModel } from '../src/map-hud.js';
import { legendItems } from '../src/map-legend.js';
import { TEXTS } from '../src/texts.js';
import { EN } from '../src/texts.en.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function real(id) {
  const dir = join(root, 'data', id);
  const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
  const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  return { scenario, tables: createTables(buf('sun.bin'), scenario, buf('cells.bin'), buf('earth.bin')) };
}
const mouton = real('lola-mouton');
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));

test('Mouton a 40 h: 1 celda ve la Tierra; empieza a asomar el día 4 y el día 5 se ve desde muchas zonas', () => {
  const o = earthOutlook(mouton.tables, 40);
  assert.equal(o.now, 1);
  assert.equal(o.few, true);
  assert.equal(o.riseHour, 88);
  assert.equal(outlookDay(o.riseHour), 4);
  assert.equal(o.manyHour, 104);
  assert.equal(outlookDay(o.manyHour), 5);
  assert.equal(earthOutlook(mouton.tables, 0).now, 2);
  assert.equal(earthOutlook(mouton.tables, 140).few, false);
});

test('earthCounts cuenta las celdas de earth.bin hora a hora (las cifras de la issue)', () => {
  const c = earthCounts(mouton.tables);
  assert.deepEqual([c[0], c[24], c[40], c[64], c[100], c[140]], [2, 1, 1, 5, 65, 756]);
  assert.equal(earthCounts(mouton.tables), c, 'se calcula una vez por tablas');
});

test('earthForecastCells: celdas que aún no ven la Tierra pero la verán en 24 h', () => {
  const { tables } = mouton;
  for (const h of [40, 80, 100]) {
    const soon = earthForecastCells(tables, h);
    for (const i of soon) {
      assert.equal(tables.seesEarth(i, h), false);
      const next = nextEarthHour(tables, i, h);
      assert.ok(next > h && next <= h + 24, `celda ${i} hora ${h}: ${next}`);
    }
  }
  assert.ok(earthForecastCells(tables, 80).length > 0);
});

test('nextEarthHour: la propia hora cuenta, y null si no la ve en todo el escenario', () => {
  const { tables, scenario } = mouton;
  const start = scenario.start.y * tables.n + scenario.start.x;
  const h = nextEarthHour(tables, start, 0);
  assert.ok(h > 0 && tables.seesEarth(start, h) && !tables.seesEarth(start, h - 1));
  assert.equal(nextEarthHour(tables, start, h), h);
  assert.equal(nextEarthHour(tables, start, 0, h), null, 'con un límite anterior');
});

test('umbral de «pocas»: 20 celdas en la rejilla del juego y el 1 % en rejillas pequeñas', () => {
  assert.equal(fewThreshold(mouton.tables), FEW_EARTH_CELLS);
  assert.equal(fewThreshold({ n: 3 }), 1);
});

test('la pista earth-few dice cuántos sitios, que están marcados y los días, en español y en inglés', () => {
  const o = earthOutlook(mouton.tables, 40);
  const es = outlookText(o, { earthLayer: true }, TEXTS);
  assert.match(es, /solo la ve 1 sitio, marcado con un círculo en el mapa/);
  assert.match(es, /asomar el día 4 y el día 5 se verá desde muchas zonas/);
  assert.doesNotMatch(outlookText(o, { earthLayer: false }, TEXTS), /círculo/);
  assert.match(outlookText(o, { earthLayer: true }, EN), /rise on day 4 and on day 5/);
  assert.match(TEXTS.hintEarthFew({ now: 0, marked: false, riseDay: 3, manyDay: 3 }), /bajo el horizonte.*día 3, y desde muchas zonas/);
  assert.match(TEXTS.hintEarthFew({ now: 2, marked: true, riseDay: null, manyDay: null }), /No volverá a asomar/);
  assert.equal(missionHintText('earth-few', { earthLayer: true, outlook: o }, TEXTS), es);
});

test('en Mouton a 40 h, con batería de sobra y lejos de la única celda, la pista es earth-few', () => {
  const g = { ...newGame(mouton.scenario, levels.beg, mouton.tables), t: 40, battery: 100 };
  assert.equal(missionHint(g), 'earth-few');
  assert.equal(missionHint({ ...g, x: mouton.scenario.pad.x, y: mouton.scenario.pad.y }), 'earth-few');
});

test('el HUD sobre el mapa avisa con pocas celdas y solo con la capa a la vista', () => {
  const g = { ...newGame(mouton.scenario, levels.beg, mouton.tables), t: 40 };
  const view = { x: g.x, y: g.y, t: 40, battery: g.battery };
  const args = { state: g, view, level: levels.beg, tables: mouton.tables, startMs: 0 };
  const o = earthOutlook(mouton.tables, 40);
  assert.deepEqual(hudModel({ ...args, showEarth: true, outlook: o }).outlook, { now: 1, riseDay: 4 });
  assert.equal(hudModel({ ...args, showEarth: false, outlook: o }).outlook, null);
  assert.equal(hudModel({ ...args, showEarth: true, outlook: earthOutlook(mouton.tables, 140) }).outlook, null);
  assert.equal(TEXTS.outlookPill({ now: 1, riseDay: 4 }), 'Tierra: 1 sitio · asoma el día 4');
  assert.equal(TEXTS.outlookPill({ now: 0, riseDay: 4 }), 'Tierra bajo el horizonte · asoma el día 4');
});

test('cursor: dice en cuántas horas se verá la Tierra desde la celda', () => {
  const { tables, scenario } = mouton;
  const r = cellReport({ tables, scenario, cell: scenario.start, hour: 0, seesEarth: tables.seesEarth, earthIn: () => 5 });
  assert.equal(r.earth, false);
  assert.equal(r.earthIn, 5);
  assert.match(TEXTS.liveCursor(r), /la Tierra se verá desde aquí en 5 h/);
  assert.match(EN.liveCursor(r), /Earth will be visible from here in 5 h/);
  const hidden = cellReport({ tables, scenario, cell: scenario.start, hour: 0, seesEarth: null, earthIn: () => 5 });
  assert.equal(hidden.earthIn, null, 'sin capa no se dice');
});

test('la leyenda tiene la fila de la previsión solo con la capa', () => {
  assert.ok(legendItems({ earthLayer: true }).some((r) => r.id === 'earthSoon' && r.shape === 'hatch'));
  assert.ok(!legendItems({ earthLayer: false }).some((r) => r.id === 'earthSoon'));
  assert.equal(TEXTS.legend.earthSoon, 'Verá la Tierra en las próximas 24 h');
});
