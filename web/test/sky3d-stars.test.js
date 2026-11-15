// The stars of the 3D sky come from the module shared with the other 3D scenes (G1.2b, #286; #340): text checks on
// sky3d.js, and the lowest point of the stretched mask that takes them down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lowestShownDeg } from '../js/common/sky3d-geometry.js';

const sky = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js/common/sky3d.js'), 'utf8');

test('sky3d.js importa stars.js y ya no define makeStars', () => {
  assert.match(sky, /import \{ belowFor, starField \} from '\.\.\/\.\.\/\.\.\/shared\/render\/stars\.js';/);
  assert.doesNotMatch(sky, /makeStars/);
  // below the horizon down past the mask stretched as much as it can be
  assert.match(sky, /starField\(radius, \{ below: belowFor\(lowestShownDeg\(mask, EXAGGERATION\)\) \}\)/);
  assert.match(sky, /stars = starsOf\(THREE, mask, /);
});

test('lowestShownDeg: lo más bajo de la máscara, estirado sobre la tangente', () => {
  const mask = Array.from({ length: 360 }, (_, az) => (az === 200 ? -2.9 : 1));
  assert.ok(Math.abs(lowestShownDeg(mask) + 2.9) < 1e-9);
  const shown = lowestShownDeg(mask, 3);
  assert.ok(Math.abs(shown - Math.atan(3 * Math.tan(-2.9 * Math.PI / 180)) * 180 / Math.PI) < 1e-9);
  assert.ok(shown < -8.5 && shown > -8.8); // the −8.7° of the issue
  // over the horizon it goes up, stretched as well
  assert.ok(lowestShownDeg(new Array(360).fill(1), 3) > 1);
});
