// The shared lunar globe (G1.2, #140): text checks, like render-perf.test.mjs (three.js is not installed for Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THREE_VERSION, THREE_URL } from '../shared/render/three-version.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const globe = read('shared/render/moon-globe.js');
const home = read('home/index.html');

test('las texturas de la Luna están junto al módulo y ya no en home/tex/', () => {
  for (const f of ['moon-color-2k.jpg', 'moon-color-4k.jpg', 'moon-height.jpg']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'shared/render/tex', f)), f);
    assert.ok(!fs.existsSync(path.join(ROOT, 'home/tex', f)), `home/tex/${f} sigue ahí`);
    assert.match(globe, new RegExp(`new URL\\('tex/${f.replace('.', '\\.')}', import\\.meta\\.url\\)`));
  }
});

test('createMoonGlobe(renderer, options) lleva el material, el shader del polo, el de profundidad y el casquete', () => {
  assert.match(globe, /export function createMoonGlobe\(renderer, \{/);
  assert.match(globe, /export const POLE_DISP = `/);
  assert.match(globe, /export function capGeometry\(N\)/);
  assert.match(globe, /new THREE\.MeshDepthMaterial\(/);
  assert.match(globe, /customProgramCacheKey = \(\) => 'fs' \+ samples\(\)/);
  assert.match(globe, /setCapGrid\(N\) \{ const g = cap\.geometry; cap\.geometry = capGeometry\(N\); g\.dispose\(\); \}/);
  assert.doesNotMatch(globe, /Math\.random/);
});

test('la portada importa el globo y ya no lo copia', () => {
  assert.match(home, /import \{MOON_TEX,createMoonGlobe,moonFallback\} from "\.\.\/shared\/render\/moon-globe\.js";/);
  assert.match(home, /const MOON=createMoonGlobe\(renderer,\{load:tex,/);
  assert.match(home, /moon\.add\(MOON\.group\)/);
  assert.doesNotMatch(home, /POLE_DISP|function capGeometry|MeshDepthMaterial|tex\/moon-/);
});

test('las estrellas de la portada salen de una semilla fija', () => {
  assert.match(home, /const starRand=/);
  const stars = home.slice(home.indexOf('const starRand='), home.indexOf('/* Luz:'));
  assert.doesNotMatch(stars, /Math\.random/);
});

test('three.js se fija en un solo sitio: todas las importmap usan THREE_VERSION', () => {
  assert.equal(THREE_URL, `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`);
  for (const page of ['home/index.html', 'web/index.html', 'viewpoint/index.html', 'rolegame/index.html']) {
    const html = read(page);
    for (const m of html.matchAll(/three@([0-9.]+)/g)) assert.equal(m[1], THREE_VERSION, `${page} usa three@${m[1]}`);
  }
});

test('MOON_RELIEF dice a qué altura dibuja el globo el relieve: ×0,75 del real (#328)', () => {
  const literal = globe.match(/export const MOON_RELIEF = (Object\.freeze\(\{[^\n]*\}\));/);
  assert.ok(literal, 'shared/render/moon-globe.js no exporta MOON_RELIEF en una línea');
  const relief = new Function(`return ${literal[1]};`)();
  assert.equal(relief.scale, .0085);
  assert.ok(Math.abs(relief.factor - 0.75) <= 0.01, `factor ${relief.factor}`);
  const rest = globe.replace(literal[0], '');
  assert.doesNotMatch(rest, /\.0085|\.00425/, 'quedan literales del desplazamiento fuera de MOON_RELIEF');
  assert.match(globe, /displacementScale: MOON_RELIEF\.scale, displacementBias: -MOON_RELIEF\.scale \/ 2/);
});

test('la portada y su README dan el factor real del relieve, no «exagerado ×2» (#328)', () => {
  for (const [f, text] of [['home/index.html', home], ['home/README.md', read('home/README.md')]]) {
    assert.doesNotMatch(text, /exagerado ×2/, f);
    assert.match(text, /×0,75/, f);
  }
});
