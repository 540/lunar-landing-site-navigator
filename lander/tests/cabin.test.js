import test from 'node:test';
import assert from 'node:assert/strict';
import { blocked, resolve } from '../src/sim/collision.js';
import { BOUNDS, OBSTACLES, PLAYER_RADIUS, SEATS, STAND_SPOT } from '../src/sim/layout.js';
import { PAD_RADIUS_M, createTerrain } from '../src/sim/terrain.js';
import { SITE, skyVector } from '../src/site.js';

const at = (x, z) => resolve({ x, z }, PLAYER_RADIUS, BOUNDS, OBSTACLES);

test('un mueble empuja al astronauta fuera, por la cara más cercana', () => {
  const box = [[0, 1, 0, 1]], wide = { minX: -9, maxX: 9, minZ: -9, maxZ: 9 };
  assert.deepEqual(resolve({ x: -0.1, z: 0.5 }, 0.2, wide, box), { x: -0.2, z: 0.5 });
  const inside = resolve({ x: 0.9, z: 0.5 }, 0.2, wide, box);
  assert.ok(Math.abs(inside.x - 1.2) < 1e-9 && inside.z === 0.5);
  assert.deepEqual(resolve({ x: 3, z: 3 }, 0.2, wide, box), { x: 3, z: 3 });
});

test('las paredes de la cabina no se atraviesan', () => {
  const p = at(40, -40);
  assert.ok(p.x <= BOUNDS.maxX - PLAYER_RADIUS + 1e-9 && p.z >= BOUNDS.minZ + PLAYER_RADIUS - 1e-9);
  assert.equal(blocked({ x: 40, z: 0.5 }, PLAYER_RADIUS, BOUNDS, OBSTACLES), true);
});

test('al levantarse hay sitio de pie, y pasillo hasta la esclusa', () => {
  assert.equal(blocked(STAND_SPOT, PLAYER_RADIUS, BOUNDS, OBSTACLES), false);
  for (const [x, z] of [[0, 0.5], [1.2, 0.5], [-1.2, 0.5], [0, 1.4], [0, 2.0]]) assert.equal(blocked({ x, z }, PLAYER_RADIUS, BOUNDS, OBSTACLES), false, `(${x}, ${z}) debería estar libre`);
});

test('los asientos y las consolas son sólidos', () => {
  for (const seat of Object.values(SEATS)) assert.equal(blocked(seat, PLAYER_RADIUS, BOUNDS, OBSTACLES), true);
  assert.equal(blocked({ x: 0, z: -0.6 }, PLAYER_RADIUS, BOUNDS, OBSTACLES), true, 'pedestal');
  assert.equal(blocked({ x: 0, z: -1.4 }, PLAYER_RADIUS, BOUNDS, OBSTACLES), true, 'consola principal');
});

test('el relieve es determinista y el sitio está despejado y casi llano', () => {
  const a = createTerrain(), b = createTerrain();
  for (const [x, z] of [[-4600, 0], [-800, 120], [35, -20], [9000, 4000]]) {
    assert.equal(a.heightAt(x, z), b.heightAt(x, z));
    assert.ok(Number.isFinite(a.heightAt(x, z)));
  }
  assert.ok(Math.abs(a.heightAt(0, 0)) < 0.01);
  for (let x = -PAD_RADIUS_M / 2; x <= PAD_RADIUS_M / 2; x += 3) assert.ok(Math.abs(a.slopeDegAt(x)) < 1.5, `pendiente en ${x}: ${a.slopeDegAt(x)}`);
  for (const c of a.craters) assert.ok(Math.hypot(c.x, c.z) > c.radius + PAD_RADIUS_M, 'ningún cráter sobre el sitio');
  assert.notEqual(createTerrain(7).heightAt(-800, 120), a.heightAt(-800, 120));
});

test('el cielo del sitio: Sol rasante a la izquierda y detrás, Tierra baja por delante a la izquierda', () => {
  assert.ok(SITE.sun.elDeg > 0 && SITE.sun.elDeg < 10);
  assert.ok(SITE.earth.elDeg > 0 && SITE.earth.elDeg < 10);
  const [sx, sy, sz] = skyVector(SITE.sun), [ex, ey, ez] = skyVector(SITE.earth);
  assert.ok(sx < 0 && sz < 0 && sy > 0);
  assert.ok(ex > 0 && ez < 0 && ey > 0);
  assert.ok(Math.abs(Math.hypot(sx, sy, sz) - 1) < 1e-12);
});
