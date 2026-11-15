// The 3D sky takes the angular sizes of the Sun and the Earth from shared/render/sky-bodies.js (#336): text checks on sky3d.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sky = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js/common/sky3d.js'), 'utf8');

test('sky3d.js importa los tamaños de shared/render/sky-bodies.js', () => {
  assert.match(sky, /from '\.\.\/\.\.\/\.\.\/shared\/render\/sky-bodies\.js';/);
});

test('setScene no escribe a mano los tamaños angulares', () => {
  const start = sky.indexOf('function setScene(');
  assert.ok(start >= 0, 'falta setScene');
  const end = sky.indexOf('\n  function ', start + 1);
  const body = sky.slice(start, end < 0 ? undefined : end);
  for (const banned of ['0.53 *', '0.95 *']) assert.ok(!body.includes(banned), `sobra ${banned}`);
  assert.match(body, /sunSpriteWidth\(bodyDistance, SUN_DIAMETER_DEG \* PLANNER_SKY_MAGNIFY\)/);
  assert.match(body, /radiusAt\(bodyDistance, EARTH_DIAMETER_DEG \* PLANNER_SKY_MAGNIFY\)/);
});

test('el aumento llega a los dos astros y el estirado del relieve a ninguno (#342)', () => {
  const start = sky.indexOf('function setScene(');
  const body = sky.slice(start, sky.indexOf('\n  function ', start + 1));
  assert.ok(!body.includes('1.5 *'), 'sobra un 1.5 escrito a mano');
  assert.ok(!/(sun|earth)\.scale\.[a-z]+\s*=\s*stretch/.test(sky), 'los discos no se estiran con el relieve');
});
