// Camera limits of the tour (E2.1, #152): never under the relief, never out of the region.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_NEAR_KM, clampAboveGround, clampToRegion, limitCamera, GROUND_MARGIN_KM } from '../src/core/camera-limits.js';

const ground = () => 1; // flat
const wall = (x) => x; // a 45° slope

test('clampAboveGround: a position under the relief rises to the ground plus the margin', () => {
  const p = clampAboveGround({ x: 2, y: 0, z: 5 }, ground);
  assert.equal(p.y, ground(2) + GROUND_MARGIN_KM);
  assert.equal(p.x, 2);
  assert.equal(p.z, 5);
});

test('clampAboveGround: a position above does not change', () => {
  assert.deepEqual(clampAboveGround({ x: 2, y: 10, z: 5 }, ground), { x: 2, y: 10, z: 5 });
});

test('clampAboveGround: within the margin it rises to it', () => {
  const p = clampAboveGround({ x: 0, y: 1, z: 0 }, ground, 0.5);
  assert.equal(p.y, 1.5);
});

test('clampToRegion: keeps the position inside the extent', () => {
  assert.deepEqual(clampToRegion({ x: 30, y: 1, z: -30 }, 20), { x: 10, y: 1, z: -10 });
  assert.deepEqual(clampToRegion({ x: 3, y: 1, z: -4 }, 20), { x: 3, y: 1, z: -4 });
});

test('the margin above the ground is larger than the near plane of the camera', () => {
  assert.ok(GROUND_MARGIN_KM > CAMERA_NEAR_KM);
});

test('clampAboveGround: on a 45° wall the plane of the near distance stays clear of the relief', () => {
  const p = clampAboveGround({ x: 0, y: -5, z: 0 }, wall);
  const perpendicular = (p.y - wall(p.x)) * Math.cos(Math.PI / 4); // distance to the slope along its normal
  assert.ok(perpendicular > CAMERA_NEAR_KM, `${perpendicular} km must exceed the near plane`);
});

test('limitCamera: clamps camera and target together and says if it moved', () => {
  const r = limitCamera({ x: 30, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }, ground, 20);
  assert.equal(r.position.x, 10);
  assert.ok(r.position.y > 1);
  assert.deepEqual(r.target, { x: 0, y: 5, z: 0 });
  assert.equal(r.moved, true);
  assert.equal(limitCamera({ x: 0, y: 5, z: 0 }, { x: 1, y: 5, z: 0 }, ground, 20).moved, false);
});

// The drone's ceiling (#340): a pan along the camera's up vector (screenSpacePanning) cannot take the drone over
// droneCeilingKm, the height star-floor.js counts on to bring the stars under the edge of the far ring.
test('limitCamera: tras un paneo hacia arriba, el dron no pasa del techo de star-floor.js en ninguna región', async () => {
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { droneCeilingKm, topOfRegionKm } = await import('../src/core/star-floor.js');
  const dataDir = new URL('../data/', import.meta.url);
  const regions = readdirSync(dataDir).filter(id => existsSync(new URL(`${id}/meta.json`, dataDir)));
  assert.ok(regions.length > 0);
  for (const id of regions) {
    const meta = JSON.parse(readFileSync(new URL(`${id}/meta.json`, dataDir), 'utf8'));
    const top = topOfRegionKm(meta), ceiling = droneCeilingKm(meta);
    const groundAt = () => top; // the worst ground: the highest of the region everywhere
    let position = { x: 0, y: top + meta.extentKm, z: meta.extentKm / 2 }, target = { x: 0, y: top, z: 0 };
    for (let i = 0; i < 50; i++) { // pan up 20 km at a time, then clamp, as scene.js does on every change
      ({ position, target } = limitCamera({ ...position, y: position.y + 20 }, { ...target, y: target.y + 20 }, groundAt, meta.extentKm, ceiling));
      assert.ok(position.y <= ceiling, `${id}: cámara a ${position.y} km > ${ceiling} km`);
      assert.ok(target.y <= ceiling, `${id}: objetivo a ${target.y} km > ${ceiling} km`);
    }
  }
});

test('limitCamera: sin techo no limita la altura', () => {
  assert.equal(limitCamera({ x: 0, y: 500, z: 0 }, { x: 0, y: 400, z: 0 }, ground, 20).position.y, 500);
});

// The mission viewer's orbit (scene.js: maxPolarAngle = π/2 + 0.15, maxDistance = extentKm) goes under its target's
// horizon: zooming out at that angle sank the drone into the relief and the ground showed in tatters (sky through it).
test('limitCamera: al alejarse con la órbita del visor de misión por debajo del horizonte, el dron no se mete bajo el relieve', () => {
  const hills = (x, z) => 0.4 * Math.sin(x / 3) * Math.cos(z / 4) + 0.02 * x; // gentle hills and a slope, km
  const extentKm = 40, polar = Math.PI / 2 + 0.15;
  const target = { x: 0, y: hills(0, 0) + 0.3, z: 0 }; // the drone looks 300 m over the flag
  for (let az = 0; az < 2 * Math.PI; az += Math.PI / 8) {
    for (let d = 0.5; d <= extentKm; d *= 1 / 0.7) {
      const orbit = {
        x: target.x + d * Math.sin(polar) * Math.sin(az),
        y: target.y + d * Math.cos(polar),
        z: target.z + d * Math.sin(polar) * Math.cos(az),
      };
      const { position: p } = limitCamera(orbit, target, hills, extentKm, 45);
      assert.ok(p.y >= hills(p.x, p.z) + GROUND_MARGIN_KM - 1e-9, `az ${az.toFixed(2)}, d ${d.toFixed(2)} km: ${p.y} under the ground ${hills(p.x, p.z)}`);
      assert.ok(p.y <= 45, 'and never over the ceiling');
    }
  }
});
