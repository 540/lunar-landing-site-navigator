// The 3D sky uses the quality levels of the home (G1.7, #145): text checks on sky3d.js, without WebGL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sky = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js/common/sky3d.js'), 'utf8');

test('sky3d.js importa el módulo de calidad compartido', () => {
  assert.match(sky, /import \{[^}]*\bresolveQuality\b[^}]*\} from '\.\.\/\.\.\/\.\.\/shared\/render\/quality\.js';/);
  assert.match(sky, /resolveQuality\(\{ params: new URLSearchParams\(location\.search\), signals: readSignals\(/);
});

test('el pixel ratio sale del nivel y del tamaño del bloque en cada render', () => {
  assert.ok(!sky.includes('Math.min(window.devicePixelRatio || 1, 2)'), 'queda el pixel ratio fijo');
  const render = sky.slice(sky.indexOf('function render()'), sky.indexOf('renderer.setSize('));
  assert.ok(render.length > 0, 'no hay function render() con setSize');
  assert.match(render, /const ratio = qualityPixelRatio\(w, h\);/);
  assert.match(render, /renderer\.setPixelRatio\(ratio\)/);
});
