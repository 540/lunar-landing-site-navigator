// The Mirador uses the quality levels of the home (G1.7, #145): text checks on scene.js, without WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scene = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/scene.js'), 'utf8');

test('scene.js importa el módulo de calidad compartido', () => {
  assert.match(scene, /import \{[^}]*\bresolveQuality\b[^}]*\} from '\.\.\/\.\.\/shared\/render\/quality\.js';/);
  assert.match(scene, /resolveQuality\(\{ params: new URLSearchParams\(location\.search\), signals: readSignals\(/);
});

test('el pixel ratio sale del nivel, también al cambiar de tamaño', () => {
  assert.ok(!scene.includes('Math.min(window.devicePixelRatio, 2)'), 'queda el pixel ratio fijo');
  assert.match(scene, /pixelRatio\(quality\.level, w, h, window\.devicePixelRatio \|\| 1, quality\.values\.pr\)/);
  const resize = scene.slice(scene.indexOf('function resize()'), scene.indexOf("window.addEventListener('resize', resize)"));
  assert.ok(resize.length > 0, 'no hay function resize()');
  assert.match(resize, /renderer\.setPixelRatio\(qualityPixelRatio\(w, h\)\)/);
});

test('el mapa de sombras mide values.shadow, como mucho maxTextureSize', () => {
  assert.ok(!scene.includes('SHADOW_MAP_SIZE'), 'queda la constante SHADOW_MAP_SIZE');
  assert.match(scene, /const shadowMapSize = Math\.min\(quality\.values\.shadow, renderer\.capabilities\.maxTextureSize\);/);
  assert.match(scene, /light\.shadow\.mapSize\.set\(shadowMapSize, shadowMapSize\);/);
});

test('createScene devuelve el nivel y su origen', () => {
  assert.match(scene, /quality: \{ level: quality\.level, source: quality\.source \}/);
});
