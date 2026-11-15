// J10.4 (#245): light map mode, its downloads and its independence from the rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseMapMode, toggledMapMode, MAP_KEY, LIGHT_FILES } from '../src/map-mode.js';
import { createTables, newGame, move, pathTo, wait, transmit } from '../src/engine/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data/procedural-shackleton');

test('chooseMapMode: ligero sin WebGL, con render por software, si va lento o si se eligió; completo si no', () => {
  assert.equal(chooseMapMode({ webgl: false }), 'light');
  assert.equal(chooseMapMode({ webgl: true, softwareRenderer: true }), 'light');
  assert.equal(chooseMapMode({ webgl: true, tooSlow: true }), 'light');
  assert.equal(chooseMapMode({ webgl: true, saved: 'light' }), 'light');
  assert.equal(chooseMapMode({ webgl: true }), 'full');
  assert.equal(chooseMapMode({ webgl: true, softwareRenderer: true, saved: 'full' }), 'full');
  assert.equal(chooseMapMode({ webgl: false, saved: 'full' }), 'light');
  assert.equal(chooseMapMode({ webgl: true, saved: 'otro' }), 'full');
  assert.equal(toggledMapMode('light'), 'full');
  assert.equal(toggledMapMode('full'), 'light');
  assert.equal(MAP_KEY, 'llsn.gameMap');
});

test('lo que descarga el modo ligero suma 1,3 MB o menos, sin texturas ni map-horizon.bin', () => {
  const bytes = LIGHT_FILES.reduce((a, f) => a + statSync(join(dir, f)).size, 0) + statSync(join(root, 'data/levels.json')).size;
  assert.ok(bytes <= 1.3 * 1024 * 1024, `${bytes} bytes`);
  const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
  const heavy = ['normals', 'albedo', 'ao', 'horizon'].map((k) => scenario.files[k]?.file).filter(Boolean);
  for (const f of [...heavy, 'map-horizon.bin']) assert.ok(!LIGHT_FILES.includes(f), f);
  // game.js fetches exactly these before the first drawing; the textures only load in map-backdrop.js, in WebGL.
  const game = readFileSync(join(root, 'src/game.js'), 'utf8');
  for (const f of LIGHT_FILES) assert.match(game, new RegExp(`\\$\\{DATA\\}${f.replace('.', '\\.')}`), f);
  for (const f of heavy) assert.doesNotMatch(game, new RegExp(f.replace('.', '\\.')), f);
});

test('el renderizador ligero no importa three.js ni pide un contexto WebGL', () => {
  // Code only: the comments may say what it does not use.
  const src = readFileSync(join(root, 'src/map-2d.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /three|webgl|import\s/i);
  assert.match(src, /getContext\('2d'\)/);
});

test('el motor no depende del renderizador: mismas acciones, mismo estado', () => {
  for (const f of readdirSync(join(root, 'src/engine'))) {
    assert.doesNotMatch(readFileSync(join(root, 'src/engine', f), 'utf8'), /map-(2d|gl|backdrop|mode|light)/, f);
  }
  const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
  const level = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8')).beg;
  const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  // Each mode loads its own copy of the same tables: the light one and the full one read the same files.
  const play = () => {
    const tables = createTables(buf('sun.bin'), scenario, buf('cells.bin'), buf('earth.bin'));
    let s = newGame(scenario, level, tables);
    s = move(s, pathTo(s, { x: 24, y: 29 }));
    s = transmit(s);
    s = wait(s, 6);
    const { tables: _t, ...rest } = s;
    return rest;
  };
  assert.deepEqual(play(), play());
});
