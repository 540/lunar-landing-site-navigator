// The Sun and Earth tracks of the 3D sky take their colours from the tokens, like their labels (#334): text checks on sky3d.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sky = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js/common/sky3d.js'), 'utf8');

test('sky3d.js no escribe a mano los colores del Sol y de la Tierra', () => {
  for (const banned of ['#f5b83d', '#4f9ef0', 'SUN_COLOR', 'EARTH_COLOR']) assert.ok(!sky.includes(banned), `sobra ${banned}`);
});

test('sky3d.js lee mapSun y mapEarth de theme() para las trazas', () => {
  assert.match(sky, /import \{ theme \} from '\.\/theme\.js';/);
  assert.match(sky, /const \{ mapSun, mapEarth \} = theme\(\);/);
  assert.match(sky, /trackOf\([^)]*'sun', mapSun\)/);
  assert.match(sky, /trackOf\([^)]*'earth', mapEarth\)/);
});
