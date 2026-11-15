// The Mirador draws the Earth at its real size, with the constants it shares with the 3D sky (#336): text checks on scene.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scene = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/scene.js'), 'utf8');

test('scene.js no dibuja la Tierra más grande que la real', () => {
  for (const banned of ['0.0145', 'Drawn larger than']) assert.ok(!scene.includes(banned), `sobra ${banned}`);
});

test('scene.js toma el tamaño de la Tierra de shared/render/sky-bodies.js', () => {
  assert.match(scene, /from '\.\.\/\.\.\/shared\/render\/sky-bodies\.js';/);
  assert.match(scene, /EARTH_RADIUS = radiusAt\(SUN_DISTANCE, EARTH_DIAMETER_DEG\)/);
});

test('scene.js dibuja el disco del Sol a su tamaño real y el resplandor como estaba (#342)', () => {
  assert.ok(!scene.includes('SUN_DISTANCE * 0.09'), 'sobra el tamaño del Sol escrito a mano');
  assert.match(scene, /SUN_DISC_WIDTH = 2 \* radiusAt\(SUN_DISTANCE, SUN_DIAMETER_DEG\)/);
  assert.match(scene, /sunDisc\.scale\.set\(SUN_DISC_WIDTH, SUN_DISC_WIDTH, 1\)/);
  assert.match(scene, /sun\.scale\.set\(SUN_GLOW_WIDTH, SUN_GLOW_WIDTH, 1\)/);
});
