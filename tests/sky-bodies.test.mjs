// Angular sizes of the Sun and the Earth shared by every view (shared/render/sky-bodies.js, #336 and #342).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BODY_MARKER_RADIUS_PX, EARTH_DIAMETER_DEG, LANDER_MAGNIFY, PLANNER_SKY_MAGNIFY, radiusAt, SUN_CORE_STOP, SUN_DIAMETER_DEG,
  SUN_GLOW_SHARE, sunSpriteWidth,
} from '../shared/render/sky-bodies.js';
import { EARTH_ANGULAR_DEG, SUN_ANGULAR_DEG } from '../lander/src/site.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const deg = rad => rad * 180 / Math.PI;
/** Apparent diameter, in degrees, of a body of `radius` at `distance`. */
const apparent = (radius, distance) => 2 * deg(Math.atan(radius / distance));
const REAL_RATIO = 3.6, TOLERANCE = 0.2;
const near = (ratio, what) => assert.ok(Math.abs(ratio - REAL_RATIO) <= TOLERANCE, `${what}: Tierra/Sol = ${ratio.toFixed(2)}`);

test('la Tierra mide 1,9° y el Sol 0,53°', () => {
  assert.equal(EARTH_DIAMETER_DEG, 1.9);
  assert.equal(SUN_DIAMETER_DEG, 0.53);
});

test('radiusAt da el radio de la Tierra a la distancia del Sol del Mirador', () => {
  assert.ok(Math.abs(radiusAt(4000, EARTH_DIAMETER_DEG) - 66.33) <= 0.05);
});

test('radiusAt da el radio del disco del Sol', () => {
  assert.ok(Math.abs(radiusAt(100, SUN_DIAMETER_DEG) - 0.4625) <= 0.001);
});

test('sunSpriteWidth deja el núcleo del Sol al diámetro pedido', () => {
  for (const d of [SUN_DIAMETER_DEG, SUN_DIAMETER_DEG * PLANNER_SKY_MAGNIFY]) {
    assert.ok(Math.abs(apparent(sunSpriteWidth(4000, d) * SUN_CORE_STOP / 2, 4000) - d) < 1e-9);
  }
});

test('Mirador y cabina: el disco del Sol y la Tierra guardan la proporción real (#342)', () => {
  const distance = 4000; // SUN_DISTANCE of both scenes
  near(apparent(radiusAt(distance, EARTH_DIAMETER_DEG), distance) / apparent(radiusAt(distance, SUN_DIAMETER_DEG), distance), 'Mirador y cabina');
  for (const file of ['viewpoint/src/scene.js', 'rolegame/src/cabin/scene.js']) {
    const src = read(file);
    assert.match(src, /SUN_DISC_WIDTH = 2 \* radiusAt\(SUN_DISTANCE, SUN_DIAMETER_DEG\)/, file);
    assert.match(src, /sunDisc\.scale\.set\(SUN_DISC_WIDTH, SUN_DISC_WIDTH, 1\)/, file);
    assert.match(src, /map: sunDiscTexture\(\)/, file);
    assert.match(src, /EARTH_RADIUS = radiusAt\(SUN_DISTANCE, EARTH_DIAMETER_DEG\)/, file);
    assert.ok(!src.includes('SUN_DISTANCE * 0.09'), `${file}: sobra el Sol escrito a mano`);
  }
});

test('Mirador y cabina: el resplandor del Sol (su halo) se queda como estaba (#342)', () => {
  assert.equal(SUN_GLOW_SHARE, 0.09);
  for (const file of ['viewpoint/src/scene.js', 'rolegame/src/cabin/scene.js']) {
    const src = read(file);
    assert.match(src, /SUN_GLOW_WIDTH = SUN_DISTANCE \* SUN_GLOW_SHARE/, file);
    assert.match(src, /sun\.scale\.set\(SUN_GLOW_WIDTH, SUN_GLOW_WIDTH, 1\)/, file);
  }
  assert.match(read('rolegame/src/cabin/scene.js'), /halo\.scale\.set\(SUN_DISTANCE \* 0\.5, SUN_DISTANCE \* 0\.5, 1\)/);
});

test('cielo 3D: el aumento ×1,5 a los dos astros mantiene la proporción (#342)', () => {
  near((EARTH_DIAMETER_DEG * PLANNER_SKY_MAGNIFY) / (SUN_DIAMETER_DEG * PLANNER_SKY_MAGNIFY), 'cielo 3D');
  assert.equal(PLANNER_SKY_MAGNIFY, 1.5);
});

test('lander: el ×2 llega también al Sol (1,06° y 3,8°) (#342)', () => {
  assert.equal(LANDER_MAGNIFY, 2);
  assert.ok(Math.abs(SUN_ANGULAR_DEG - 1.06) < 1e-9);
  assert.ok(Math.abs(EARTH_ANGULAR_DEG - 3.8) < 1e-9);
  near(EARTH_ANGULAR_DEG / SUN_ANGULAR_DEG, 'lander');
});

test('2D, Brújula y mapa de Avanzado: Sol y Tierra con el mismo radio (#342)', () => {
  assert.equal(BODY_MARKER_RADIUS_PX, 6);
  const charts = read('web/js/common/charts.js'), polar = read('web/js/common/sky-polar.js'), advanced = read('web/js/views/advanced.js');
  assert.match(charts, /disc\(c\.sun, t\.sun, BODY_MARKER_RADIUS_PX\); disc\(c\.earth, t\.earth, BODY_MARKER_RADIUS_PX, together\);/);
  assert.match(polar, /disc\(c\.sun, t\.sun, BODY_MARKER_RADIUS_PX\);\n\s+disc\(c\.earth, t\.earth, BODY_MARKER_RADIUS_PX, markersOverlap\(/);
  assert.match(advanced, /ctx\.arc\(end\.x, end\.y, BODY_MARKER_RADIUS_PX, 0, 2 \* Math\.PI\)/);
  assert.ok(!advanced.includes("body === 'sun' ? 6 : 5"), 'sobra el radio distinto por astro');
});

test('el desglose del tour no dice que «Visible» sigue el criterio center', () => {
  assert.ok(!read('docs/desglose-tour-lunar.md').includes('sigue el criterio `center`'));
});

test('Mirador, cabina y cielo 3D: el resplandor se atenúa junto al núcleo para no ensanchar el disco (#342)', () => {
  for (const file of ['shared/render/sky-meshes.js', 'web/js/common/sky3d.js']) {
    assert.match(read(file), /addColorStop\(0\.11, 'rgba\(255,232,190,\.35\)'\)/, file);
  }
});

test('markersOverlap: solapan cuando los centros están a menos de dos radios', async () => {
  const { markersOverlap, BODY_MARKER_RADIUS_PX: R } = await import('../shared/render/sky-bodies.js');
  assert.equal(markersOverlap({ x: 5, y: 5 }, { x: 5, y: 5 }), true);
  assert.equal(markersOverlap({ x: 0, y: 0 }, { x: 2 * R - 0.1, y: 0 }), true);
  assert.equal(markersOverlap({ x: 0, y: 0 }, { x: 2 * R, y: 0 }), false);
  assert.equal(markersOverlap({ x: 0, y: 0 }, { x: R * 1.5, y: R * 1.5 }), false);
});
