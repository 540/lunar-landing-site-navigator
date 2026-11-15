// Light of the 3D sky (#339): ACES like the Mirador and the cabin, and the Sun lights the relief from its real elevation,
// whatever the stretch of the heights (before, the ×3 also raised the light and the flat ground came out brighter).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirAzEl, lightDir } from '../js/common/sky3d-geometry.js';

const sky = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js/common/sky3d.js'), 'utf8');

test('lightDir es la dirección real del astro, un vector unitario', () => {
  for (const [az, el] of [[0, 0.5], [137, 1.8], [270, 6], [45, -0.3]]) {
    const d = lightDir({ az, el }), real = dirAzEl(az, el);
    assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-12);
    assert.deepEqual(d, real);
    assert.ok(Math.abs(Math.asin(d.y) * 180 / Math.PI - el) < 1e-9, `elevación de la luz ${el}°`);
  }
});

test('la dirección de la luz solar no depende del factor de estiramiento', () => {
  // The direction the scene used to give the light, (x, y·stretch, z), against the one it gives now.
  const stretched = (az, el, stretch) => { const d = dirAzEl(az, el); return { x: d.x, y: d.y * stretch, z: d.z }; };
  const sunUp = (v) => v.y / Math.hypot(v.x, v.y, v.z); // sine of the angle over the flat ground: how much it lights it
  const sun = { az: 120, el: 1.5 };
  assert.ok(sunUp(stretched(sun.az, sun.el, 3)) > 2.9 * sunUp(stretched(sun.az, sun.el, 1)), 'el ×3 sí estiraba la luz');
  assert.equal(lightDir.length, 1, 'lightDir solo recibe el astro, no el estiramiento');
  assert.ok(Math.abs(sunUp(lightDir(sun)) - Math.sin(sun.el * Math.PI / 180)) < 1e-12);
});

test('setInstant coloca las luces con lightDir y no con skyDir', () => {
  const start = sky.indexOf('function setInstant(');
  const end = sky.indexOf('\n  function ', start + 1);
  const body = sky.slice(start, end);
  assert.match(body, /const d = lightDir\(k\.sun\)/);
  assert.match(body, /sunLight\.position\.set\(d\.x, d\.y, d\.z\)/);
  assert.match(body, /earthLight\.position\.set\(e\.x, e\.y, e\.z\)/);
  assert.doesNotMatch(body, /const [de] = skyDir/);
  assert.match(body, /sunLight\.intensity = SUN\.intensity \* sunDiscFraction/);
});

test('el cielo 3D usa ACES y no tiñe el Sol, la Tierra, las estrellas ni las trazas', () => {
  assert.match(sky, /renderer\.toneMapping = THREE\[TONE_MAPPING\];/);
  assert.match(sky, /renderer\.toneMappingExposure = EXPOSURE;/);
  for (const m of [/PointsMaterial\(\{ size: 1\.2[^}]*vertexColors: true, toneMapped: false/, /SpriteMaterial\(\{ map: sunTexture\(THREE\)[^}]*toneMapped: false/,
    /MeshBasicMaterial\(\{ map: earthMap, toneMapped: false/, /PointsMaterial\(\{ color, size: 2[^}]*toneMapped: false/]) assert.match(sky, m);
});
