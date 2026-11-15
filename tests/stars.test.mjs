// The star field shared by the 3D scenes (shared/render/stars.js, #286 and #340): the Mirador, the cabin of the game,
// the 3D sky of the planner and the lander, with the same density and brightness, and down past the lowest point of
// the sky each of them can show.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAR_DENSITY, STAR_MARGIN_DEG, belowFor, starBrightness, starColors, starCount, starField, starPositions } from '../shared/render/stars.js';
import { droneCeilingKm, lowestVisibleDeg } from '../viewpoint/src/core/star-floor.js';
import { lowestShownDeg } from '../web/js/common/sky3d-geometry.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const D2R = Math.PI / 180;

// Copy of the generator the Mirador and the 3D sky had (#286): the positions keep coming from it.
function legacyStars(count, radius, below) {
  const positions = new Float32Array(count * 3);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < count; i++) {
    const u = rnd() * (1 + below) - below;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    positions.set([radius * s * Math.cos(th), radius * u, radius * s * Math.sin(th)], i * 3);
  }
  return positions;
}

const distances = p => Array.from({ length: p.length / 3 }, (_, i) => Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
const elevations = p => Array.from({ length: p.length / 3 }, (_, i) => Math.asin(p[i * 3 + 1] / Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])) / D2R);

test('starPositions sigue dando, valor a valor, las posiciones del generador de semilla 5', () => {
  assert.deepEqual(starPositions(2500, 5000), legacyStars(2500, 5000, 0));
  assert.deepEqual(starPositions(1800, 40, { below: 0.1 }), legacyStars(1800, 40, 0.1));
});

test('todas las estrellas están a distancia radius del origen (tolerancia 1e-3)', () => {
  for (const [count, radius, opts] of [[2500, 5000, {}], [1800, 40, { below: 0.1 }], [3000, 190000, { below: 1 }]]) {
    for (const d of distances(starPositions(count, radius, opts))) assert.ok(Math.abs(d - radius) / radius <= 1e-6, `${d} ≠ ${radius}`);
  }
});

test('con below 0 ninguna estrella baja del horizonte; con below 0.1, algunas sí', () => {
  const up = starPositions(2500, 5000);
  for (let i = 1; i < up.length; i += 3) assert.ok(up[i] >= 0);
  const sky = starPositions(1800, 40, { below: 0.1 });
  assert.ok(Array.from({ length: 1800 }, (_, i) => sky[i * 3 + 1]).some(y => y < 0));
});

test('unas 300 estrellas por estereorradián, también con el cielo bajo el horizonte', () => {
  assert.equal(STAR_DENSITY, 300);
  assert.equal(starCount(0), Math.round(300 * 2 * Math.PI));
  assert.equal(starCount(1), Math.round(300 * 4 * Math.PI));
  for (const below of [0, 0.2, 0.47, 1]) {
    const { count } = starField(1, { below });
    assert.ok(Math.abs(count / (2 * Math.PI * (1 + below)) - 300) < 1, `below ${below}: ${count}`);
  }
  // the cut of «bajo» in the cabin: half of them
  assert.equal(starField(1, { share: 0.5 }).count, Math.round(starCount(0) * 0.5));
});

test('el brillo es 0,25 + r⁴ · 0,75, gris y siempre el mismo', () => {
  assert.equal(starBrightness(0), 0.25);
  assert.equal(starBrightness(1), 1);
  assert.equal(starBrightness(0.5), 0.25 + 0.0625 * 0.75);
  const c = starColors(500);
  for (let i = 0; i < 500; i++) {
    assert.ok(c[i * 3] >= 0.25 - 1e-6 && c[i * 3] <= 1 + 1e-6);
    assert.equal(c[i * 3], c[i * 3 + 1]); assert.equal(c[i * 3], c[i * 3 + 2]);
  }
  assert.deepEqual(starColors(500), c);
  const field = starField(10, { below: 0.3 });
  assert.equal(field.positions.length, field.count * 3);
  assert.equal(field.colors.length, field.count * 3);
});

test('belowFor baja el campo hasta lo más bajo que se ve, más el margen', () => {
  assert.equal(belowFor(0), 0);
  assert.equal(belowFor(5), 0);
  assert.ok(Math.abs(belowFor(-10) - Math.sin((10 + STAR_MARGIN_DEG) * D2R)) < 1e-12);
  assert.equal(belowFor(-120), 1);
});

// The Mirador from its drone: the edge of the far ring from the highest the drone gets, for every region of the repo.
const REGIONS = fs.readdirSync(path.join(ROOT, 'viewpoint/data')).filter(id => fs.existsSync(path.join(ROOT, 'viewpoint/data', id, 'meta.json')));

test('Mirador: desde la altura máxima del dron, las estrellas llegan por debajo del borde del anillo lejano', () => {
  assert.match(read('viewpoint/src/scene.js'), /controls\.maxDistance = meta\.extentKm;/); // the drone's ceiling of star-floor.js
  // ...and the pan cannot lift the drone over it: scene.js passes the ceiling to limitCamera (viewpoint/tests/camera-limits.test.js)
  assert.match(read('viewpoint/src/scene.js'), /limitCamera\([^)]*droneCeilingKm\(meta\)\)/);
  // ...also in the mission viewer (mission.js creates the scene without explore, with the far ring and the pan on)
  assert.match(read('viewpoint/src/mission.js'), /createScene\(/);
  assert.match(read('viewpoint/src/scene.js'), /if \(!foot\?\.active\) keepInBounds\(\);/);
  const SKY_RADIUS = Number(read('viewpoint/src/scene.js').match(/const SKY_RADIUS = (\d+);/)[1]);
  assert.ok(REGIONS.length > 0);
  for (const id of REGIONS) {
    const meta = JSON.parse(read(`viewpoint/data/${id}/meta.json`));
    assert.ok(meta.far, `${id}: sin anillo lejano`);
    // The edge of the ring, worked out here from scratch: the drone at its ceiling (the highest ground + the 40 km
    // the camera can get away from the ground) over the edge of the region, the nearest point of the ring's edge at
    // its lowest height, and the parallax of the sky sphere, centred on the origin.
    const top = meta.heights.offset + 65535 * meta.heights.scale;
    const ceiling = top + meta.extentKm;
    assert.equal(droneCeilingKm(meta), ceiling);
    const edgeDeg = -Math.atan((ceiling - meta.far.heights.offset) / ((meta.far.extentKm - meta.extentKm) / 2)) / D2R;
    const parallaxDeg = Math.asin(Math.hypot(meta.extentKm / 2, meta.extentKm / 2, ceiling) / SKY_RADIUS) / D2R;
    const lowest = lowestVisibleDeg(meta, SKY_RADIUS);
    assert.ok(lowest <= edgeDeg - parallaxDeg + 1e-9, `${id}: ${lowest} > ${edgeDeg - parallaxDeg}`);
    const stars = elevations(starPositions(starCount(belowFor(lowest)), SKY_RADIUS, { below: belowFor(lowest) }));
    const bottom = Math.min(...stars);
    assert.ok(bottom < edgeDeg - parallaxDeg, `${id}: la estrella más baja (${bottom.toFixed(2)}°) no pasa del borde (${(edgeDeg - parallaxDeg).toFixed(2)}°)`);
    // a margin of stars under the edge, not one by chance
    assert.ok(stars.filter(e => e < edgeDeg - parallaxDeg).length > 20, id);
  }
});

// The 3D sky with its relief ×3: the lowest mask of the repo.
test('Cielo 3D: con ×3 las estrellas llegan por debajo de la máscara más baja del repo', () => {
  const sky = read('web/js/common/sky3d.js');
  assert.match(sky, /export const EXAGGERATION = 3;/);
  assert.match(sky, /belowFor\(lowestShownDeg\(mask, EXAGGERATION\)\)/);
  const dir = path.join(ROOT, 'backend/terrain/masks');
  const masks = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.ok(masks.length > 0);
  const lowest = masks.reduce((a, m) => (Math.min(...m.el) < Math.min(...a.el) ? m : a));
  const low = Math.min(...lowest.el);
  assert.ok(low < 0, 'la máscara más baja queda bajo el horizonte');
  // ×3 on the tangent, as the stretched wall draws it
  const shown = Math.atan(3 * Math.tan(low * D2R)) / D2R;
  assert.ok(Math.abs(lowestShownDeg(lowest.el, 3) - shown) < 1e-9);
  const below = belowFor(lowestShownDeg(lowest.el, 3));
  const stars = elevations(starPositions(starCount(below), 40, { below }));
  assert.ok(Math.min(...stars) < shown, `${Math.min(...stars)} ≥ ${shown}`);
  assert.ok(stars.filter(e => e < shown).length > 20);
});

test('el Mirador, la cabina, el cielo 3D y el lander sacan sus estrellas de stars.js; la portada, el globo y el fondo 2D no', () => {
  const sky3d = read('web/js/common/sky3d.js'), lander = read('lander/src/scene/world.js');
  const viewpoint = read('viewpoint/src/scene.js'), cabin = read('rolegame/src/cabin/scene.js'), meshes = read('shared/render/sky-meshes.js');
  assert.match(meshes, /import \{ starField \} from '\.\/stars\.js';/);
  assert.match(viewpoint, /starPoints\(SKY_RADIUS, \{ below: belowFor\(lowestVisibleDeg\(meta, SKY_RADIUS\)\) \}\)/);
  assert.match(cabin, /starPoints\(SKY_RADIUS, \{ size: 1\.4, share: level === 'bajo' \? 0\.5 : 1 \}\)/);
  assert.match(sky3d, /import \{ belowFor, starField \} from '\.\.\/\.\.\/\.\.\/shared\/render\/stars\.js';/);
  assert.match(lander, /import \{ starField \} from '\.\.\/\.\.\/\.\.\/shared\/render\/stars\.js';/);
  // no scene of these four sets its own brightness: no opacity on their stars
  assert.doesNotMatch(sky3d.slice(sky3d.indexOf('function starsOf'), sky3d.indexOf('function meshOf')), /opacity/);
  assert.doesNotMatch(lander.slice(lander.indexOf('starField('), lander.indexOf('const sunSprite')), /opacity/);
  for (const other of ['home/index.html', 'rolegame/src/moon3d.js', 'web/js/common/sky.js']) assert.doesNotMatch(read(other), /stars\.js/, other);
  // the header of stars.js says who uses it
  const header = read('shared/render/stars.js').split('\n').filter(l => l.startsWith('//')).join('\n');
  for (const user of ['viewpoint/src/scene.js', 'rolegame/src/cabin/scene.js', 'web/js/common/sky3d.js', 'lander/src/scene/world.js']) assert.ok(header.includes(user), user);
});
