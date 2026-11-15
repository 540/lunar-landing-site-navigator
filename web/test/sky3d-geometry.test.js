// Geometry of the 3D sky (issue #62): the relief mesh hides exactly what the horizon mask of the 2D sky hides, and a
// body is placed at its azimuth and elevation. Pure geometry: no browser and no three.js.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSkyMesh, meshProblem, cellPerKm, silhouetteDeg, dirAzEl, ringDistancesKm, smoothTan, sunDiscFraction, SPOKES } from '../js/common/sky3d-geometry.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { SITES } from '../js/engine/catalog.js';
import * as M from '../js/engine/model.js';

const D2R = Math.PI / 180;
const wavyMask = () => Float32Array.from({ length: 360 }, (_, a) => 2 * Math.sin(a * D2R * 3) - 0.5);

describe('cielo 3D: geometría', () => {
  test('un astro queda en su acimut y elevación (norte hacia -z, este hacia +x)', () => {
    for (const [az, el] of [[0, 0], [90, 0], [229.72, 0.38], [129.46, 4.8], [300, -2]]) {
      const d = dirAzEl(az, el);
      assert.ok(Math.abs(Math.atan2(d.y, Math.hypot(d.x, d.z)) / D2R - el) < 1e-9);
      assert.ok(Math.abs((((Math.atan2(d.x, -d.z) / D2R) % 360) + 360) % 360 - az) < 1e-9);
    }
  });

  test('sin relieve: suelo liso y la silueta es la máscara, grado a grado', () => {
    const mask = wavyMask(), mesh = buildSkyMesh({ mask });
    const top = silhouetteDeg(mesh);
    for (let a = 0; a < SPOKES; a++) assert.ok(Math.abs(top[a] - mask[a]) < 1e-4, `acimut ${a}: ${top[a]} vs ${mask[a]}`);
    assert.equal(mesh.clamped, 0);
    assert.equal(mesh.radiusKm, 30);
  });

  test('con relieve: ningún vértice supera la máscara y la silueta sigue siendo la máscara', () => {
    const mask = wavyMask(), distancesKm = ringDistancesKm(0.005, 20, 40);
    const tan = new Float32Array(distancesKm.length * 360);
    // A ridge 5° high to the east (above the mask there) and smooth ground elsewhere; one sample without data.
    distancesKm.forEach((d, j) => { for (let k = 0; k < 360; k++) tan[j * 360 + k] = k > 60 && k < 120 && d > 1 ? Math.tan(5 * D2R) : smoothTan(d); });
    tan[10 * 360 + 200] = NaN;
    const mesh = buildSkyMesh({ mask, relief: { azimuthStepDeg: 1, distancesKm, tan } });
    const top = silhouetteDeg(mesh);
    for (let a = 0; a < SPOKES; a++) assert.ok(Math.abs(top[a] - mask[a]) < 1e-4, `acimut ${a}: ${top[a]} vs ${mask[a]}`);
    assert.ok(mesh.clamped > 0, 'la cresta se recorta a la máscara');
    assert.equal(mesh.radiusKm, 20);
    assert.ok(mesh.terrain.positions.every(Number.isFinite) && mesh.wall.positions.every(Number.isFinite));
    assert.equal(Math.max(...mesh.terrain.indices), mesh.terrain.positions.length / 3 - 1);
  });

  test('motor simulado: su relieve da el mismo horizonte que su máscara (misma proyección)', async () => {
    const site = SITES.find(s => !s.offMap);
    site.horizon ??= M.computeHorizon(site);
    const relief = await fakeVisibility.loadRelief(site);
    assert.equal(relief.source, 'simulated');
    const nAz = 360;
    let above = 0, sum = 0;
    for (let a = 0; a < nAz; a++) {
      let best = -Infinity;
      relief.distancesKm.forEach((d, j) => { if (d >= 0.3) best = Math.max(best, relief.tan[j * nAz + a]); }); // the mask starts at 300 m
      const el = Math.atan(best) / D2R;
      if (el > site.horizon.mask[a] + 0.3) above++;
      sum += site.horizon.mask[a] - el;
    }
    assert.equal(above, 0, 'el relieve cercano no sobresale de la máscara');
    assert.ok(Math.abs(sum / nAz) < 1.5, `el relieve hasta 30 km se parece a la máscara (diferencia media ${(sum / nAz).toFixed(2)}°)`);
    assert.equal(await fakeVisibility.loadRelief(SITES.find(s => s.offMap)), null);
  });

  test('la luz del Sol sigue a la parte del disco sobre el relieve', () => {
    assert.equal(sunDiscFraction(1), 1);
    assert.equal(sunDiscFraction(-1), 0);
    assert.ok(Math.abs(sunDiscFraction(0) - 0.5) < 1e-9);
  });
});

describe('cellPerKm (the regolith of the 3D sky, #393)', () => {
  test('is the jump between rings over the distance, or 1° across the spokes if the rings are denser', () => {
    const rings = ringDistancesKm(0.005, 30, 64), ratio = rings[1] / rings[0];
    assert.ok(Math.abs(cellPerKm(rings) - (ratio - 1)) < 1e-9);
    assert.ok(Math.abs(cellPerKm([1, 1.001, 1.002]) - Math.PI / 180) < 1e-12);
  });
  test('buildSkyMesh gives it, from the rings of the relief or the default ones', () => {
    const mask = new Float32Array(SPOKES).fill(1);
    const rings = ringDistancesKm();
    assert.ok(Math.abs(buildSkyMesh({ mask }).cellPerKm - cellPerKm(rings)) < 1e-12);
    const relief = { azimuthStepDeg: 1, distancesKm: [0.1, 0.2, 0.4], tan: new Float32Array(3 * 360).fill(0) };
    assert.equal(buildSkyMesh({ mask, relief }).cellPerKm, 1);
  });
});

describe('cielo 3D: avisar si no se puede construir el terreno', () => {
  const mask = () => Float32Array.from({ length: 360 }, () => -1.1);
  test('una malla normal no da problema, ni con relieve del tipo de shackleton-rim (máscara bajo cero, sin huecos)', () => {
    const distancesKm = ringDistancesKm(0.005, 30, 64);
    const tan = new Float32Array(distancesKm.length * 360).fill(Math.tan(-4 * D2R));
    assert.equal(meshProblem(buildSkyMesh({ mask: mask() })), null);
    assert.equal(meshProblem(buildSkyMesh({ mask: mask(), relief: { azimuthStepDeg: 1, distancesKm, tan } })), null);
  });
  test('una máscara con un hueco (NaN) deja vértices que no son números: se avisa', () => {
    const m = mask(); m[200] = NaN;
    assert.equal(meshProblem(buildSkyMesh({ mask: m })), 'nonFinite');
  });
  test('un terreno sin triángulos se avisa como vacío', () => {
    const mesh = buildSkyMesh({ mask: mask() });
    assert.equal(meshProblem({ ...mesh, terrain: { positions: mesh.terrain.positions, indices: new Uint32Array(0) } }), 'empty');
  });
});
