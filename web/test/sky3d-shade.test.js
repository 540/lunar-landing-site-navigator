// The relief of the 3D sky with the Sun hidden (#339): the case the view exists for (what blocks the Sun). With only the
// ambient and the Earth it went almost black on the black sky; the shared bounce keeps it readable. The sRGB is computed
// as three.js r160 draws it: Lambert (albedo / π times the irradiance), the shoulder of the regolith (#393), ACES with the
// view's exposure, then sRGB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirAzEl } from '../js/common/sky3d-geometry.js';
import { tone } from '../../viewpoint/src/core/surface-detail.js'; // the shoulder of the regolith, before ACES
import { AMBIENT, BOUNCE, REGOLITH, SUN } from '../../shared/render/lighting.js';

const sky = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js/common/sky3d.js'), 'utf8');
const EXPOSURE = Number(sky.match(/const EXPOSURE = ([\d.]+);/)[1]);
const WALL_COLOR = Number(sky.match(/const WALL_COLOR = (0x[\da-f]+);/i)[1]);

const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const rgb = hex => [hex >> 16, (hex >> 8) & 255, hex & 255].map(v => toLinear(v / 255));
function aces([r, g, b]) {
  const k = EXPOSURE / 0.6; r *= k; g *= k; b *= k;
  const i = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.07600 * r + 0.90834 * g + 0.01566 * b, 0.02840 * r + 0.13383 * g + 0.83777 * b];
  const f = i.map(v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081));
  return [1.60475 * f[0] - 0.53108 * f[1] - 0.07367 * f[2], -0.10208 * f[0] + 1.10813 * f[1] - 0.00605 * f[2], -0.00327 * f[0] - 0.07276 * f[1] + 1.07602 * f[2]]
    .map(v => Math.min(1, Math.max(0, v)));
}
/** sRGB (0-255) of each channel of a surface with normal n under the given lights. */
function channels(albedo, n, lights) {
  const irr = [0, 0, 0];
  for (const { color, intensity, dir } of lights) {
    const dot = dir ? Math.max(0, n.x * dir.x + n.y * dir.y + n.z * dir.z) : 1;
    rgb(color).forEach((c, j) => { irr[j] += c * intensity * dot; });
  }
  return aces(rgb(albedo).map((a, j) => tone((a / Math.PI) * irr[j]))).map(v => 255 * toSrgb(v));
}
/** The darkest channel: what must stay above the black sky. */
const shaded = (albedo, n, lights) => Math.min(...channels(albedo, n, lights));

test('el cielo 3D tiene el rebote compartido, desde el lado contrario al Sol', () => {
  assert.match(sky, /new THREE\.DirectionalLight\(BOUNCE\.color, BOUNCE\.intensity\)/);
  assert.match(sky, /const b = dirAzEl\(k\.sun\.az \+ 180, BOUNCE\.elevationDeg\);[^\n]*\n\s*bounceLight\.position\.set\(b\.x, b\.y, b\.z\);/);
});

test('con el Sol oculto, el relieve que lo tapa se distingue del cielo negro', () => {
  const sunAz = 137;
  const bounce = { ...BOUNCE, dir: dirAzEl(sunAz + 180, BOUNCE.elevationDeg) };
  const ambient = { ...AMBIENT };
  const flat = { x: 0, y: 1, z: 0 };
  const facing = dirAzEl(sunAz + 180, 0); // the face of the relief at the Sun's azimuth, turned to the observer
  const ground = shaded(REGOLITH, flat, [ambient, bounce]);
  const face = shaded(REGOLITH, facing, [ambient, bounce]);
  const wall = shaded(WALL_COLOR, facing, [ambient, bounce]);
  for (const [name, v] of [['suelo en sombra', ground], ['ladera hacia el observador', face], ['pared del horizonte', wall]]) {
    assert.ok(v >= 15, `${name}: ${v.toFixed(1)} sRGB, demasiado cerca del negro del cielo`);
  }
  assert.ok(shaded(REGOLITH, flat, [ambient]) < 10, 'sin el rebote se iba a negro');
});

test('con el Sol bajo, el suelo llano iluminado queda entre 60 y 120 sRGB, ni negro ni quemado', () => {
  // The Sun lights from its real elevation (lightDir), so the flat ground gets sin(el) of it whatever the stretch.
  const sunAz = 137;
  const flat = { x: 0, y: 1, z: 0 };
  for (const el of [1, 2, 3]) {
    const lights = [{ ...AMBIENT }, { ...BOUNCE, dir: dirAzEl(sunAz + 180, BOUNCE.elevationDeg) }, { ...SUN, dir: dirAzEl(sunAz, el) }];
    const c = channels(REGOLITH, flat, lights);
    const luma = 255 * toSrgb(0.2126 * toLinear(c[0] / 255) + 0.7152 * toLinear(c[1] / 255) + 0.0722 * toLinear(c[2] / 255));
    const shown = `${c.map(v => v.toFixed(0)).join(',')} sRGB (luminancia ${luma.toFixed(0)})`;
    assert.ok(luma >= 60 && luma <= 120, `Sol a ${el}°: ${shown}`);
    assert.ok(Math.max(...c) <= 120, `Sol a ${el}°, quemado: ${shown}`);
  }
});
