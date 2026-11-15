import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSameDem, AZIMUTHS, buildMaskGrid, MASKS_FILE, regionDir, seriesDemVersion, toCenterAxes } from '../mask-grid.mjs';
import { configureDem, demVersion, llToXY, makeGrid } from '../../backend/src/terrain/dem.ts';
import { buildMask, dipDeg } from '../../backend/src/terrain/horizonMask.ts';
import { series } from '../../backend/src/service.ts';
import { BODIES, moonFixedVectors, siteFrame, topocentric } from '../../backend/src/ephemeris.ts';
import { createSceneFrame } from '../../viewpoint/src/core/scene-frame.js';
import { decodeMaskGrid, discFraction, maskAt } from '../../viewpoint/src/core/mask-grid.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const TERRAIN_DIR = path.join(ROOT, 'backend', 'terrain');
const HOUR_MS = 3600e3;
// A site near the pole, like the real ones: the local north turns about 3.4° per km here.
const CENTER = { lat: -89.5, lon: 0 };
const RADIUS_KM = 1737.4;
const frame = createSceneFrame({ radiusKm: RADIUS_KM, centerLat: CENTER.lat, centerLon: CENTER.lon });

/** Synthetic DEM (160 m, ±32 km around the pole) with `relief(x, y)` metres above the sphere, in the polar stereographic plane. */
function syntheticDem(relief, { res = 160, w = 400 } = {}) {
  const X0 = (-w * res) / 2;
  const Y0 = (w * res) / 2;
  const a = new Float32Array(w * w);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) a[j * w + i] = relief(X0 + (i + 0.5) * res, Y0 - (j + 0.5) * res);
  return makeGrid({ res, X0, Y0, w, h: w, a });
}
/** A hill of `heightM` at `scene` (x east, z south, km) from the centre, as the plane of the DEM sees it. */
function hillAt(sceneKm, heightM, sigmaM) {
  const { lat, lon } = frame.fromScene(sceneKm.x, sceneKm.z);
  const [hx, hy] = llToXY(lat, lon);
  return (x, y) => heightM * Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / (2 * sigmaM ** 2));
}
const SMALL = { center: CENTER, radiusKm: RADIUS_KM, extentKm: 0.6, stepKm: 0.2, azimuths: 720 };

test('with a flat DEM every mask is the geometric horizon of an observer at 2 m, in the axes of the centre', () => {
  configureDem({ grids: [syntheticDem(() => 0)] });
  const { maskGrid, bin } = buildMaskGrid(SMALL);
  const grid = decodeMaskGrid(maskGrid, bin);
  const dip = -dipDeg(2);
  for (let p = 0; p < grid.cols * grid.rows; p++) {
    for (let k = 0; k < grid.azimuths; k++) {
      // 0.01° of rounding plus the tilt of the vertical (0.03°/km) over the half diagonal of the square
      assert.ok(Math.abs(grid.data[p * grid.azimuths + k] - dip) < 0.05, `point ${p}, azimuth ${k}: ${grid.data[p * grid.azimuths + k]}`);
    }
  }
  assert.equal(maskGrid.demVersion, demVersion());
  assert.equal(bin.length, grid.cols * grid.rows * grid.azimuths * 2);
});

test('with a hill to the east, the points near it see it higher than those far from it, and the north of the centre is the one of the series', () => {
  configureDem({ grids: [syntheticDem(hillAt({ x: 2, z: 0 }, 80, 300))] });
  const { maskGrid, bin } = buildMaskGrid({ ...SMALL, extentKm: 1, stepKm: 0.5 });
  const grid = decodeMaskGrid(maskGrid, bin);
  const peak = (m) => {
    let best = -Infinity;
    // the hill is at azimuth ~90° of the centre; ±20° around it covers the hill from every point of the square
    for (let k = Math.round(70 / m.stepDeg); k <= Math.round(110 / m.stepDeg); k++) best = Math.max(best, m.el[k]);
    return best;
  };
  const west = maskAt(grid, -0.5, 0);
  const east = maskAt(grid, 0.5, 0);
  assert.ok(peak(east) > peak(west) + 0.2, `east ${peak(east)}°, west ${peak(west)}°`);
  // the peak of the hill is where it is: ~80 m at 1.5 km from the point of the east (≈ 3°)
  assert.ok(peak(east) > 2 && peak(east) < 4, `${peak(east)}°`);
  // away from the hill, the geometric horizon
  assert.ok(Math.abs(west.el[Math.round(270 / west.stepDeg)] + dipDeg(2)) < 0.06);
});

test('the rotation to the axes of the centre keeps the horizon of the centre and turns the one of a point away from the pole', () => {
  configureDem({ grids: [syntheticDem(hillAt({ x: 2, z: 0 }, 80, 300))] });
  const mask = buildMask(CENTER.lat, CENTER.lon, { observerHeightM: 2, resolution: 'precise' });
  const same = toCenterAxes(mask.el, CENTER, CENTER, 720);
  for (let k = 0; k < 720; k++) assert.ok(Math.abs(same[k] - mask.el[k]) < 1e-9);
  // a point 1 km to the east: the hill is seen from there, but at an azimuth of the centre about 3.4° apart (the local north turns)
  const p = frame.fromScene(1, 0);
  const own = buildMask(p.lat, p.lon, { observerHeightM: 2, resolution: 'precise' });
  const rotated = toCenterAxes(own.el, p, CENTER, 720);
  const argmax = (a, from, to) => { let b = from; for (let k = from; k <= to; k++) if (a[k] > a[b]) b = k; return b; };
  const shift = (argmax(rotated, 120, 240) - argmax(own.el, 120, 240)) * 0.5;
  assert.ok(Math.abs(Math.abs(shift) - 3.4) < 0.6, `the peak moved ${shift}°`);
});

test('two runs with the same DEM give the same bytes', () => {
  configureDem({ grids: [syntheticDem(hillAt({ x: 1, z: -1 }, 40, 300))] });
  const a = buildMaskGrid(SMALL);
  const b = buildMaskGrid(SMALL);
  assert.ok(a.bin.equals(b.bin));
  assert.deepEqual(a.maskGrid, b.maskGrid);
});

test('the script fails when the DEM of the grid is not the one of the series', () => {
  assert.equal(seriesDemVersion({ source: 'backend/src (astronomy-engine), horizonModel: mask, demVersion: lola-abc123' }), 'lola-abc123');
  assert.equal(seriesDemVersion({ source: 'sin versión' }), null);
  assert.doesNotThrow(() => assertSameDem('lola-abc123', 'lola-abc123'));
  assert.throws(() => assertSameDem('lola-abc123', 'lola-def456'), /lola-def456.*no coincide.*lola-abc123/);
  assert.throws(() => assertSameDem('lola-abc123', null), /No hay DEM/);
  assert.throws(() => assertSameDem(null, 'lola-abc123'), /no declara/);
  // and the command itself, with a cache of another DEM (a 1-pixel-wide grid is enough to give another version)
  const dir = mkdtempSync(path.join(tmpdir(), 'mask-grid-'));
  mkdirSync(path.join(dir, 'cache'));
  const meta = { product: 'SINTETICO', res: 160, X0: -320, Y0: 320, c0: 0, r0: 0, w: 4, h: 4 };
  writeFileSync(path.join(dir, 'cache', 'sintetico.json'), JSON.stringify(meta));
  writeFileSync(path.join(dir, 'cache', 'sintetico.f32'), Buffer.alloc(4 * 4 * 4));
  const run = spawnSync(process.execPath, [path.join(HERE, '..', 'mask-grid.mjs'), '--site', 'shackleton-rim'], {
    env: { ...process.env, LUNAR_TERRAIN_DIR: dir }, encoding: 'utf8',
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /no coincide con la de la serie/);
});

/**
 * Share of the hours (of 60 days of 2027) in which the visible fraction of the Sun and of the Earth at a point of the grid, from the
 * mask of the grid and the series of the CENTRE, agrees (±0.05) with the engine's series() at that point with its own mask.
 */
function parityShare({ frame: f, center, grid, scene, days = 60 }) {
  const startMs = Date.parse('2027-01-01T00:00:00Z');
  const endMs = startMs + days * 24 * HOUR_MS - HOUR_MS;
  const p = f.fromScene(scene.x, scene.z);
  const own = (pt) => buildMask(pt.lat, pt.lon, { observerHeightM: 2, resolution: 'precise' });
  const truth = series({ id: 'p', name: 'p', ...p }, startMs, endMs, HOUR_MS, { mask: own(p) });
  const region = series({ id: 'c', name: 'c', ...center }, startMs, endMs, HOUR_MS, { mask: own(center) });
  const centerFrame = siteFrame(center);
  const mask = maskAt(grid, scene.x, scene.z);
  const out = {};
  for (const b of BODIES) {
    let ok = 0;
    for (let i = 0; i < region.t.length; i++) {
      const radius = topocentric(centerFrame, moonFixedVectors(new Date(startMs + i * HOUR_MS))[b], b).radiusDeg;
      if (Math.abs(discFraction(mask, region[b].az[i], region[b].el[i], radius) - truth[b].visibleFraction[i]) <= 0.05) ok++;
    }
    out[b] = ok / region.t.length;
  }
  return out;
}

/** Relief that is NOT symmetric around the centre: hills at different bearings and distances, so a mask turned the wrong way gives another horizon. */
const asymmetricRelief = (sigmaM = 300) => {
  const hills = [
    hillAt({ x: 2.6, z: 0.4 }, 90, sigmaM), // east
    hillAt({ x: -2.2, z: -1.8 }, 110, sigmaM), // north-west
    hillAt({ x: 0.6, z: 3.0 }, 70, sigmaM), // south
    hillAt({ x: -3.0, z: 1.2 }, 60, sigmaM), // west-south-west
    hillAt({ x: 1.0, z: -2.4 }, 50, sigmaM), // north-north-east
  ];
  return (x, y) => hills.reduce((m, h) => Math.max(m, h(x, y)), 0);
};

test('parity with the engine (synthetic DEM, relief off-centre): at the centre and at points of a full 4 km grid, edges and corners included, the Sun and the Earth agree in ≥ 98 % of the hours of 60 days', () => {
  configureDem({ grids: [syntheticDem(asymmetricRelief())] });
  // the 4 km square of the real grid, with a coarser step to keep the test fast; the points below are nodes, so the test measures the
  // rotation and not the bilinear interpolation between masks of sharp relief
  const { maskGrid, bin } = buildMaskGrid({ center: CENTER, radiusKm: RADIUS_KM, stepKm: 0.5, azimuths: 720 });
  assert.equal(maskGrid.extentKm, 4);
  const grid = decodeMaskGrid(maskGrid, bin);
  // the farthest ones are ~2.7 km from the centre, where the local north has turned ~9°
  for (const scene of [{ x: 0, z: 0 }, { x: 1.5, z: -1.5 }, { x: -2, z: 2 }, { x: 2, z: 1.5 }, { x: -1, z: -2 }]) {
    const share = parityShare({ frame, center: CENTER, grid, scene });
    for (const b of BODIES) assert.ok(share[b] >= 0.98, `${b} at ${JSON.stringify(scene)}: ${share[b]}`);
  }
});

test('the parity test notices a mask that was not turned to the axes of the centre (a mask copied as it is fails near the edge)', () => {
  configureDem({ grids: [syntheticDem(asymmetricRelief())] });
  const { maskGrid, bin } = buildMaskGrid({ center: CENTER, radiusKm: RADIUS_KM, extentKm: 4, stepKm: 2, azimuths: 720 });
  const scene = { x: -2, z: 2 };
  const rotated = decodeMaskGrid(maskGrid, bin);
  const p = frame.fromScene(scene.x, scene.z);
  const own = buildMask(p.lat, p.lon, { observerHeightM: 2, resolution: 'precise' });
  // the same grid, but with the mask of that corner copied from its own axes
  const copied = { ...rotated, data: Float32Array.from(rotated.data) };
  const corner = (scene.z + 2) / 2 * rotated.cols + (scene.x + 2) / 2;
  for (let k = 0; k < 720; k++) copied.data[corner * 720 + k] = own.el[k] / 100;
  const good = parityShare({ frame, center: CENTER, grid: rotated, scene });
  const bad = parityShare({ frame, center: CENTER, grid: copied, scene });
  for (const b of BODIES) assert.ok(good[b] >= 0.98, `${b} turned: ${good[b]}`);
  assert.ok(Math.min(...BODIES.map((b) => bad[b])) < 0.98, `copied: ${JSON.stringify(bad)}`);
});

/** A DEM at the resolution of the real one (20 m per cell, ±20 km) with narrow crests (σ 30 m): the worst case for a coarse azimuth step. */
const SHARP = () => syntheticDem(asymmetricRelief(30), { res: 20, w: 2000 });
const MEASURE_POINTS = [{ x: 0, z: 0 }, { x: 1, z: -1 }, { x: -2, z: 2 }, { x: 0, z: 2 }];

/** Smallest of the candidate azimuth counts whose grid reaches the parity (≥ 98 % of the hours, both bodies, every point). */
function smallestAzimuthsWithParity(candidates, measure) {
  const shares = {};
  for (const azimuths of candidates) {
    shares[azimuths] = measure(azimuths);
    if (shares[azimuths] >= 0.98) return { azimuths, shares };
  }
  return { azimuths: null, shares };
}

test('360 or 720 azimuths: the one of the script is the smallest that keeps the parity (≥ 98 %) on the sharpest relief', () => {
  configureDem({ grids: [SHARP()] });
  const measure = (azimuths) => {
    const { maskGrid, bin } = buildMaskGrid({ center: CENTER, radiusKm: RADIUS_KM, stepKm: 1, azimuths });
    const grid = decodeMaskGrid(maskGrid, bin);
    let worst = 1;
    for (const scene of MEASURE_POINTS) {
      const share = parityShare({ frame, center: CENTER, grid, scene, days: 30 });
      for (const b of BODIES) worst = Math.min(worst, share[b]);
    }
    return worst;
  };
  const { azimuths, shares } = smallestAzimuthsWithParity([360, 720], measure);
  console.log(`# parity share by azimuths (sharp synthetic relief): ${JSON.stringify(shares)}`);
  assert.notEqual(azimuths, null, `neither 360 nor 720 reaches the parity: ${JSON.stringify(shares)}`);
  assert.equal(AZIMUTHS, azimuths, `AZIMUTHS is ${AZIMUTHS} but the smallest with parity is ${azimuths} (${JSON.stringify(shares)})`);
});

const REAL_REGIONS = ['shackleton-rim', 'im2-objetivo'];
for (const id of REAL_REGIONS) {
  const dir = regionDir(id);
  const metaFile = new URL('meta.json', dir);
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : null;

  test(`${id}: masks.bin and meta.maskGrid come together (relief.mjs rewrites meta.json and would drop the block)`, () => {
    const hasBin = existsSync(new URL(MASKS_FILE, dir));
    assert.equal(Boolean(meta?.maskGrid), hasBin, hasBin ? 'masks.bin sin meta.maskGrid: regenera con node pipeline/mask-grid.mjs --site ' + id : 'meta.maskGrid sin masks.bin');
  });

  test(`${id}: the committed masks.bin weighs what its meta says and under 2.5 MB`, { skip: !meta?.maskGrid && 'sin maskGrid' }, () => {
    const g = meta.maskGrid;
    const bytes = readFileSync(new URL(MASKS_FILE, dir));
    assert.equal(g.extentKm, 4);
    assert.equal(g.stepKm, 0.1);
    assert.equal(g.cols * g.rows, 1681);
    assert.equal(g.encoding, 'int16-le');
    assert.equal(g.observerHeightM, 2);
    assert.ok(bytes.length < 2.5e6, `${bytes.length} bytes`);
    assert.equal(decodeMaskGrid(meta, bytes).data.length, g.cols * g.rows * g.azimuths);
    assert.equal(g.demVersion, seriesDemVersion(JSON.parse(readFileSync(new URL('series-2027.json', dir), 'utf8'))), 'same DEM as the series');
  });

  const haveDem = meta?.maskGrid && existsSync(path.join(TERRAIN_DIR, 'cache')) && configureDem({ dir: TERRAIN_DIR }) === meta.maskGrid.demVersion;
  test(`${id}: the azimuths of the committed grid are the smallest that keep the parity over the real DEM`, { skip: !haveDem && 'sin el DEM de la versión del fichero (cd backend && node scripts/fetch-dem.ts)' }, () => {
    configureDem({ dir: TERRAIN_DIR });
    const f = createSceneFrame(meta.sceneFrame);
    const center = { lat: meta.sceneFrame.centerLat, lon: meta.sceneFrame.centerLon };
    const measure = (azimuths) => {
      const { maskGrid, bin } = buildMaskGrid({ center, radiusKm: meta.sceneFrame.radiusKm, stepKm: 1, azimuths });
      const grid = decodeMaskGrid(maskGrid, bin);
      let worst = 1;
      for (const scene of MEASURE_POINTS) {
        const share = parityShare({ frame: f, center, grid, scene, days: 30 });
        for (const b of BODIES) worst = Math.min(worst, share[b]);
      }
      return worst;
    };
    const { azimuths, shares } = smallestAzimuthsWithParity([360, 720], measure);
    assert.notEqual(azimuths, null, `neither 360 nor 720 reaches the parity: ${JSON.stringify(shares)}`);
    assert.equal(meta.maskGrid.azimuths, azimuths, `${JSON.stringify(shares)}`);
  });

  test(`${id}: parity with the engine over the real DEM (centre and 3 points of the committed grid)`, { skip: !haveDem && 'sin el DEM de la versión del fichero (cd backend && node scripts/fetch-dem.ts)' }, () => {
    configureDem({ dir: TERRAIN_DIR });
    const f = createSceneFrame(meta.sceneFrame);
    const center = { lat: meta.sceneFrame.centerLat, lon: meta.sceneFrame.centerLon };
    const grid = decodeMaskGrid(meta, readFileSync(new URL(MASKS_FILE, dir)));
    for (const scene of [{ x: 0, z: 0 }, { x: -1.3, z: 0.9 }, { x: 0.7, z: -1.6 }, { x: 1.8, z: 1.1 }]) {
      const share = parityShare({ frame: f, center, grid, scene });
      for (const b of BODIES) assert.ok(share[b] >= 0.98, `${id} ${b} at ${JSON.stringify(scene)}: ${share[b]}`);
    }
  });
}
