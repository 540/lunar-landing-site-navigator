// Apparent size of the Sun in the lander's sky, worked out from the sprites that scene/world.js draws (#342).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sunSpriteWidth } from '../../shared/render/sky-bodies.js';
import {
  EARTH_ANGULAR_DEG, SUN_ANGULAR_DEG, SUN_CORE_STOP_LANDER, SUN_DISC_STOPS, SUN_HALO_OPACITY, SUN_HALO_SHARE,
  SUN_HALO_STOPS, SUN_SKY_SHARE,
} from '../src/site.js';

const D2R = Math.PI / 180;
const world = readFileSync(new URL('../src/scene/world.js', import.meta.url), 'utf8');

/** Luminance × alpha of a CSS colour of the gradients ('#fff' or 'rgba(r,g,b,a)'). */
function light(colour) {
  if (colour === '#fff') return 1;
  const [r, g, b, a] = colour.match(/rgba\(([^)]+)\)/)[1].split(',').map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 * a;
}

/** Value of a radial gradient at fraction `f` of its radius, interpolated between its stops. */
function sample(stops, f) {
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i];
    if (f <= b) return light(ca) + (light(cb) - light(ca)) * (f - a) / (b - a);
  }
  return 0;
}

/** Widest angular diameter, in degrees, where the two additive sprites add up to `threshold` of full brightness. */
function brightDiameter(threshold) {
  const skyR = 1, distance = skyR * SUN_SKY_SHARE;
  const discRadius = sunSpriteWidth(distance, SUN_ANGULAR_DEG, SUN_CORE_STOP_LANDER) / 2, haloRadius = skyR * SUN_HALO_SHARE / 2;
  let deg = 0;
  for (; deg < 5; deg += 0.0005) {
    const off = distance * Math.tan(deg * D2R);
    if (sample(SUN_DISC_STOPS, off / discRadius) + SUN_HALO_OPACITY * sample(SUN_HALO_STOPS, off / haloRadius) < threshold) break;
  }
  return 2 * deg;
}

test('world.js dibuja el Sol con los tamaños y degradados de site.js (#342)', () => {
  assert.match(world, /sunSprite\(sunSpriteWidth\(SKY_R \* SUN_SKY_SHARE, SUN_ANGULAR_DEG, SUN_CORE_STOP_LANDER\), SUN_DISC_STOPS, 1\)/);
  assert.match(world, /sunSprite\(SKY_R \* SUN_HALO_SHARE, SUN_HALO_STOPS, SUN_HALO_OPACITY\)/);
  assert.match(world, /multiplyScalar\(SKY_R \* SUN_SKY_SHARE\)/);
  assert.equal(SUN_DISC_STOPS[1][0], SUN_CORE_STOP_LANDER);
  assert.equal(light(SUN_DISC_STOPS[1][1]), 1, 'el núcleo llega entero hasta SUN_CORE_STOP_LANDER');
});

test('el núcleo del Sol mide SUN_ANGULAR_DEG (1,06°) en el cielo del lander (#342)', () => {
  const distance = SUN_SKY_SHARE, coreRadius = sunSpriteWidth(distance, SUN_ANGULAR_DEG, SUN_CORE_STOP_LANDER) / 2 * SUN_CORE_STOP_LANDER;
  assert.ok(Math.abs(2 * Math.atan(coreRadius / distance) / D2R - SUN_ANGULAR_DEG) < 1e-9);
});

test('el disco del Sol que se ve entero mantiene la proporción Tierra/Sol en 3,6 ± 0,2 (#342)', () => {
  const disc = brightDiameter(0.95);
  const ratio = EARTH_ANGULAR_DEG / disc;
  assert.ok(Math.abs(ratio - 3.6) <= 0.2, `Tierra/Sol = ${ratio.toFixed(2)} (disco visible ${disc.toFixed(3)}°)`);
});
