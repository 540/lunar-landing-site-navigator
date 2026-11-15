// The planner's sidebar is hidden in every view (#333): its «Polo sur» map and its site list are gone, and only
// the hidden fields that config() and adopt.js read are left.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const web = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, web), 'utf8');
const html = read('index.html');
const jsFiles = readdirSync(new URL('js/', web), { recursive: true }).filter(f => f.endsWith('.js'));

test('map.js ya no pinta el mapa lateral y sigue dando el relieve a Avanzado y Replanificar', () => {
  const source = read('js/common/map.js');
  for (const gone of ['renderMap', 'lightLayer', 'const dark']) assert.ok(!source.includes(gone), `map.js contiene ${gone}`);
  assert.match(source, /export function getTerrain\b/);
  assert.match(source, /export const resetTerrain\b/);
  assert.match(source, /export const MAP_RADIUS_KM\b/);
});

test('index.html no tiene el mapa «Polo sur» ni la lista de sitios, y sí los campos ocultos de la misión', () => {
  for (const gone of ['id="map"', 'data-layer', 'id="map-cursor"', 'id="sites"']) assert.ok(!html.includes(gone), `index.html contiene ${gone}`);
  const kept = ['date', 'delay', 'delay-value', 'days', 'battery', 'min-earth', 'max-earth-gap', 'transit',
    'panel-height', 'antenna-height', 'profile', 'profile-source'];
  for (const id of kept) assert.ok(html.includes(`id="${id}"`), `falta id="${id}" en index.html`);
});

test('ningún módulo importa ni llama a renderMap, renderSites o toggleSite', () => {
  const uses = [];
  for (const file of jsFiles) {
    const source = readFileSync(new URL(`js/${file}`, web), 'utf8');
    for (const name of ['renderMap', 'renderSites', 'toggleSite']) if (new RegExp(`\\b${name}\\b`).test(source)) uses.push(`${file}: ${name}`);
  }
  assert.deepEqual(uses, []);
});

test('todo data-explain de index.html tiene su explicación', async () => {
  const { EXPLANATIONS } = await import('../js/common/explanations.js');
  const missing = [...new Set([...html.matchAll(/data-explain="([^"]+)"/g)].map(m => m[1]))].filter(k => !(k in EXPLANATIONS));
  assert.deepEqual(missing, []);
});
