// Relief of the tour: SceneFrame, meta.json and terrain-lod0.bin, and the pipeline that writes them (pipeline/relief.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSceneFrame } from '../src/core/scene-frame.js';
import { validateMeta, decodeHeights, decodeGrid, detailLevels, buildLevels, surfaceHeightAt, expectedBytes, buildTerrainArrays, heightAt, shadowBounds, fitShadowFrustum, reliefNoticeKey, isGzipped, unpackDelta16 } from '../src/core/relief.js';
import { elevation, toMap } from '../../web/js/engine/model.js';
import { SITES as WEB_SITES } from '../../web/js/engine/catalog.js';
import { dirAzEl } from '../src/core/direction.js';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { buildRelief, parseArgs, packDelta16, EXTENT_KM, GRID_SIZE, DETAIL_LEVELS, DETAIL_ENCODING } from '../../pipeline/relief.mjs';
import { GROUND_LEVEL } from '../../pipeline/ground.mjs';
import { makeGrid, llToXY } from '../../backend/src/terrain/dem.ts';
import { startFromSearch } from '../src/core/timeline.js';
import { REGION_IDS, DEFAULT_REGION_ID, regionFromSearch, hasApproximateCoordinates, regionOptions, shouldApplyRegion, approxDescribedBy, regionSearch, dayFromSearch } from '../src/core/regions.js';
import { TEXTS } from '../src/texts.js';
import { siteFrame } from '../../backend/src/ephemeris.ts';
import { getSite } from '../../backend/src/sites.ts';

// masks.bin (the mask grid of E2.0) has its own budget (2.5 MB per region, in pipeline/test/mask-grid.test.js): the relief size tests leave it out.
const notMasks = (f) => f !== 'masks.bin';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'viewpoint/data/shackleton-rim');
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
const bin = fs.readFileSync(path.join(DIR, 'terrain-lod0.bin'));
const frame = createSceneFrame(meta.sceneFrame);
const site = getSite('shackleton-rim');
const R_KM = meta.sceneFrame.radiusKm;
const KM_PER_DEG = (Math.PI / 180) * meta.sceneFrame.radiusKm;

test('SceneFrame: near the pole one km sideways changes the longitude by about 3.4°', () => {
  const east = frame.fromScene(1, 0);
  const dLon = Math.abs(east.lon - site.lon);
  assert.ok(dLon > 3 && dLon < 4, `dLon ${dLon}`);
  assert.ok(KM_PER_DEG > 30);
});

test('meta.json has the required fields and terrain-lod0.bin has rows × cols × bytes', () => {
  validateMeta(meta);
  assert.equal(meta.source.type, 'lola');
  assert.equal(bin.length, meta.grid.rows * meta.grid.cols * 2);
  assert.equal(bin.length, expectedBytes(meta));
  assert.throws(() => decodeHeights(meta, bin.subarray(0, bin.length - 2)), /bytes/);
  for (const key of ['id', 'center', 'grid', 'heights', 'sceneFrame']) {
    const broken = { ...meta };
    delete broken[key];
    assert.throws(() => validateMeta(broken), new RegExp(key));
  }
});

test('the files of the region weigh less than 1.25 MB in total (series included)', () => {
  const total = fs.readdirSync(DIR).filter(notMasks).reduce((sum, f) => sum + fs.statSync(path.join(DIR, f)).size, 0);
  assert.ok(total < 1_250_000, `${total} bytes`);
});

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// sha256 of the procedural files that were committed before LOLA (E9.1): --source procedural must still generate exactly them (the meta gained only `coordinatesVerified`, #155; the binary is unchanged)
const PROCEDURAL_META_SHA = '32533d0e98995e029a5367a52c5375ee0666458c5e8ddeb096196e086b9a8093';
const PROCEDURAL_BIN_SHA = '1f9dbe66ebfc0357a8126bcbaa338139b74c3f1ce402596df9f779cdbc9a6254';

test('--source procedural generates exactly the procedural files of before, deterministically', () => {
  const a = buildRelief();
  const b = buildRelief({ source: 'procedural' });
  assert.ok(a.bin.equals(b.bin));
  assert.equal(JSON.stringify(a.meta), JSON.stringify(b.meta));
  assert.equal(sha(a.bin), PROCEDURAL_BIN_SHA);
  assert.equal(sha(JSON.stringify(a.meta, null, 2) + '\n'), PROCEDURAL_META_SHA);
  assert.equal(a.meta.source.type, 'procedural');
});

test('the relief of the repo is LOLA: citation, products and a flag height within 50 m of the mask catalogue', () => {
  assert.equal(meta.source.type, 'lola');
  assert.equal(meta.source.citation, 'LOLA LDEM (PGDA/GSFC), Barker et al. 2023');
  assert.ok(meta.source.products.length > 0 && meta.source.products.every((p) => /@\d+m$/.test(p)));
  assert.match(meta.source.demVersion, /^lola-/);
  assert.deepEqual([meta.extentKm, meta.grid.cols, meta.grid.rows], [EXTENT_KM, GRID_SIZE, GRID_SIZE]);
  const mask = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/terrain/masks/shackleton-rim.json'), 'utf8'));
  assert.equal(mask.heightM, 1958.6);
  const h = decodeHeights(meta, new Uint8Array(bin));
  const flagM = heightAt(meta, h, 0, 0) * 1000;
  assert.ok(Math.abs(flagM - mask.heightM) < 50, `bandera a ${flagM} m`);
  assert.ok(heightAt(meta, h, 0, -11) < heightAt(meta, h, 0, 0) - 1, 'Shackleton crater to the north');
});

// Synthetic DEM: a tilted plane on the polar stereographic grid. Heights in m above the 1737.4 km sphere.
const planeM = (x, y) => 500 + 0.02 * x - 0.01 * y;
function syntheticGrids(height = planeM) {
  const res = 240;
  const w = 834; // ±100 km around the pole, it covers the 40 km region (about 34 km from the pole)
  const a = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) a[r * w + c] = height(-100000 + (c + 0.5) * res, 100000 - (r + 0.5) * res);
  return [makeGrid({ name: 'plano', product: 'SINTETICO', res, X0: -100000, Y0: 100000, w, h: w, a })];
}
const centralCos = (lat, lon) => {
  const D = Math.PI / 180;
  return Math.sin(lat * D) * Math.sin(site.lat * D) + Math.cos(lat * D) * Math.cos(site.lat * D) * Math.cos((lon - site.lon) * D);
};

test('LOLA with a synthetic DEM: every node is (R + h) · cos θ − R, within scale + 1 m', () => {
  const r = buildRelief({ source: 'lola', grids: syntheticGrids() });
  validateMeta(r.meta);
  assert.equal(r.bin.length, GRID_SIZE * GRID_SIZE * 2);
  const h = decodeHeights(r.meta, new Uint8Array(r.bin));
  const tol = r.meta.heights.scale + 0.001;
  const step = EXTENT_KM / (GRID_SIZE - 1);
  let worst = 0;
  for (let j = 0; j < GRID_SIZE; j += 8) {
    for (let i = 0; i < GRID_SIZE; i += 8) {
      const { lat, lon } = frame.fromScene(-EXTENT_KM / 2 + i * step, -EXTENT_KM / 2 + j * step);
      const [px, py] = llToXY(lat, lon);
      const expected = (R_KM + planeM(px, py) / 1000) * centralCos(lat, lon) - R_KM;
      worst = Math.max(worst, Math.abs(h[j * GRID_SIZE + i] - expected));
    }
  }
  assert.ok(worst < tol, `error ${worst * 1000} m`);
  assert.equal(r.meta.source.type, 'lola');
  assert.deepEqual(r.meta.source.products, ['SINTETICO@240m']);
});

test('LOLA with a flat DEM at height 0: the centre is at 0 m and the corner falls 230 ± 2 m', () => {
  const r = buildRelief({ source: 'lola', grids: syntheticGrids(() => 0) });
  const h = decodeHeights(r.meta, new Uint8Array(r.bin));
  const mid = (GRID_SIZE - 1) / 2;
  assert.ok(Math.abs(h[mid * GRID_SIZE + mid]) * 1000 < 1.5, 'centre');
  for (const k of [0, GRID_SIZE - 1, GRID_SIZE * (GRID_SIZE - 1), GRID_SIZE * GRID_SIZE - 1]) {
    assert.ok(Math.abs(h[k] * 1000 + 230) < 2, `corner ${k}: ${h[k] * 1000} m`);
  }
});

test('LOLA with a synthetic DEM: two runs give the same bytes', () => {
  const a = buildRelief({ source: 'lola', grids: syntheticGrids() });
  const b = buildRelief({ source: 'lola', grids: syntheticGrids() });
  assert.ok(a.bin.equals(b.bin));
  assert.equal(JSON.stringify(a.meta), JSON.stringify(b.meta));
});

test('LOLA without a DEM fails with the command that downloads it; a bad --source is rejected', () => {
  assert.throws(() => buildRelief({ source: 'lola', demDir: path.join(ROOT, 'tests/no-such-terrain') }), /fetch-dem/);
  assert.throws(() => buildRelief({ source: 'otra' }), /--source/);
  assert.deepEqual(parseArgs(['--source', 'lola', '--dem-dir', '/x']), { source: 'lola', demDir: '/x' });
  assert.deepEqual(parseArgs(['--far-only']), { farOnly: true });
  assert.throws(() => parseArgs(['--nada']), /desconocida/);
});

test('validateMeta accepts the three source types and rejects an unknown one', () => {
  validateMeta({ ...meta, source: { type: 'procedural' } });
  validateMeta({ ...meta, source: { type: 'lola' } });
  validateMeta({ ...meta, source: { type: 'simulated' } });
  assert.throws(() => validateMeta({ ...meta, source: { type: 'otra' } }), /fuente/);
});

test('the notice says «Relieve LOLA» for LOLA files and «Relieve inventado» for procedural ones (#338)', () => {
  assert.equal(TEXTS.notice.lola, 'Relieve LOLA');
  assert.equal(TEXTS.notice.procedural, 'Relieve inventado');
  for (const type of ['lola', 'procedural']) assert.ok(TEXTS.notice[type]);
});

// ---- Simulated relief (V2.1, #76): the terrain of the simulated verdict, for any polar site of the web ----

const POLAR = WEB_SITES.filter((s) => !s.offMap);

test('simulated: the height at the centre is elevation(toMap(lat, lon)) of the simulated engine, for every polar site', () => {
  for (const s of POLAR) {
    const r = buildRelief({ source: 'simulated', site: s.id });
    const h = decodeHeights(r.meta, r.bin);
    const half = (GRID_SIZE - 1) / 2; // the centre is a node: no curvature there (θ = 0)
    const p = toMap(s.lat, s.lon);
    const expected = elevation(p.x, p.y);
    assert.ok(Math.abs(h[half * GRID_SIZE + half] - expected) <= r.meta.heights.scale, `${s.id}: ${h[half * GRID_SIZE + half]} vs ${expected}`);
    assert.deepEqual(r.meta.center, { lat: s.lat, lon: s.lon });
    assert.equal(r.meta.id, s.id);
    assert.equal(r.meta.name.es, s.name);
  }
});

test('simulated: every node is elevation() of its lat/lon with the curvature of SceneFrame, within the quantisation', () => {
  const s = WEB_SITES.find((x) => x.id === 'malapert');
  const r = buildRelief({ source: 'simulated', site: s.id });
  const h = decodeHeights(r.meta, r.bin);
  const f = createSceneFrame(r.meta.sceneFrame);
  const step = EXTENT_KM / (GRID_SIZE - 1);
  for (const [i, j] of [[0, 0], [256, 0], [0, 256], [256, 256], [40, 200], [128, 10]]) {
    const x = -EXTENT_KM / 2 + i * step;
    const z = -EXTENT_KM / 2 + j * step;
    const { lat, lon } = f.fromScene(x, z);
    const p = toMap(lat, lon);
    const want = (R_KM + elevation(p.x, p.y)) * Math.sqrt(1 - (Math.hypot(x, z) / R_KM) ** 2) - R_KM;
    assert.ok(Math.abs(h[j * GRID_SIZE + i] - want) <= r.meta.heights.scale, `node ${i},${j}`);
  }
  // the massif is the highest thing of the region, and it is at the centre (the site is on top of it)
  let max = -Infinity, kMax = 0;
  for (let k = 0; k < h.length; k++) if (h[k] > max) { max = h[k]; kMax = k; }
  const [ci, cj] = [kMax % GRID_SIZE, Math.floor(kMax / GRID_SIZE)];
  assert.ok(Math.hypot(ci - 128, cj - 128) * step < 3, `top at ${ci},${cj}`);
});

test('simulated: same bytes every run, the format of the region and a source that says it is invented', () => {
  const a = buildRelief({ source: 'simulated', site: 'gerlache' });
  const b = buildRelief({ source: 'simulated', site: 'gerlache' });
  assert.equal(sha(a.bin), sha(b.bin));
  assert.deepEqual(a.meta, b.meta);
  assert.equal(a.bin.length, GRID_SIZE * GRID_SIZE * 2);
  assert.equal(a.meta.extentKm, EXTENT_KM);
  assert.equal(a.meta.heights.encoding, 'uint16-le');
  assert.equal(a.meta.source.type, 'simulated');
  assert.match(a.meta.source.note, /inventado/);
  validateMeta(a.meta);
});

test('the regions of the other polar sites in the repo are LOLA, centred on the site of the web catalogue', () => {
  for (const id of ['ridge-slope', 'malapert', 'gerlache', 'im2-objetivo']) {
    const s = WEB_SITES.find((x) => x.id === id);
    const dir = path.join(ROOT, 'viewpoint/data', id);
    const m = validateMeta(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')));
    assert.equal(m.source.type, 'lola', id);
    assert.equal(m.source.citation, 'LOLA LDEM (PGDA/GSFC), Barker et al. 2023');
    assert.ok(m.source.products.length > 0, id);
    assert.deepEqual(m.center, { lat: s.lat, lon: s.lon }, id);
    assert.deepEqual(m.sceneFrame.centerLat, s.lat);
    assert.equal(fs.statSync(path.join(dir, 'terrain-lod0.bin')).size, expectedBytes(m), id);
  }
});

test('LOLA for a polar site of the web: the region is centred on its coordinates and follows the DEM', () => {
  const s = WEB_SITES.find((x) => x.id === 'ridge-slope');
  const r = buildRelief({ source: 'lola', site: s.id, grids: syntheticGrids(() => 0) });
  assert.equal(r.meta.id, 'ridge-slope');
  assert.deepEqual(r.meta.center, { lat: s.lat, lon: s.lon });
  assert.equal(r.meta.name.es, s.name);
  const h = decodeHeights(r.meta, r.bin);
  assert.ok(Math.abs(h[128 * GRID_SIZE + 128]) * 1000 < 1.5, 'flat DEM: the centre at 0');
  assert.ok(Math.abs(h[0] * 1000 + 230) < 2, 'and the corner falls with the curvature');
});

test('simulated: --site is required, must be a polar site of the web, and LOLA and procedural are only for Shackleton', () => {
  assert.throws(() => buildRelief({ source: 'simulated' }), /--site/);
  assert.throws(() => buildRelief({ source: 'simulated', site: 'nada' }), /desconocido/);
  assert.throws(() => buildRelief({ source: 'simulated', site: 'apollo15' }), /fuera del mapa/);
  assert.throws(() => buildRelief({ source: 'procedural', site: 'malapert' }), /simulated/);
  assert.deepEqual(parseArgs(['--source', 'simulated', '--site', 'mouton']), { source: 'simulated', site: 'mouton' });
  assert.throws(() => parseArgs(['--site']), /Falta/);
});

test('the notice says where the relief comes from, and warns when the verdict has another source (V2.3, #78)', () => {
  assert.equal(TEXTS.notice.simulated, 'Relieve inventado');
  assert.equal(reliefNoticeKey('lola', 'api'), 'lola');
  assert.equal(reliefNoticeKey('simulated', 'fake'), 'simulated');
  assert.equal(reliefNoticeKey('lola', 'fake'), 'fakeOverReal');
  assert.equal(reliefNoticeKey('simulated', 'api'), 'realOverInvented');
  assert.equal(reliefNoticeKey('procedural', 'api'), 'realOverInvented');
  assert.equal(reliefNoticeKey('simulated', null), 'simulated');
  assert.match(TEXTS.notice.fakeOverReal, /Relieve LOLA.*veredicto con datos de ejemplo/);
  assert.match(TEXTS.notice.realOverInvented, /Relieve inventado.*veredicto con datos reales/);
});

test('the procedural relief is the one of the prototype: a deep crater to the north and mountains at the sides', () => {
  const pr = buildRelief();
  const h = decodeHeights(pr.meta, new Uint8Array(pr.bin));
  assert.ok(heightAt(pr.meta, h, 0, -11) < heightAt(pr.meta, h, 0, 0) - 3, 'Shackleton crater floor');
  assert.ok(heightAt(pr.meta, h, 13, 7) > heightAt(pr.meta, h, 8, 12) + 0.3, 'mountain at (13, 7)');
  assert.ok(Math.abs(heightAt(pr.meta, h, 0, 0)) < 0.5, 'the flag stands near the zero of the region');
});

test('the mesh is built in under 100 ms', () => {
  const h = decodeHeights(meta, new Uint8Array(bin));
  buildTerrainArrays(meta, h); // warm-up
  const t0 = performance.now();
  const { positions, indices } = buildTerrainArrays(meta, decodeHeights(meta, new Uint8Array(bin)));
  const ms = performance.now() - t0;
  assert.equal(positions.length, meta.grid.rows * meta.grid.cols * 3);
  assert.equal(indices.length, (meta.grid.rows - 1) * (meta.grid.cols - 1) * 6);
  assert.ok(ms < 100, `${ms} ms`);
});

test('heightAt: nodes, cell midpoint, clamping outside the region and the last row and column', () => {
  const m = { extentKm: 4, grid: { rows: 3, cols: 3 } };
  // rows are z = -2, 0, 2 (north to south); columns are x = -2, 0, 2
  const h = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(heightAt(m, h, -2, -2), 0);
  assert.equal(heightAt(m, h, 0, 0), 4);
  assert.equal(heightAt(m, h, 2, 0), 5);
  assert.equal(heightAt(m, h, 0, 2), 7);
  assert.equal(heightAt(m, h, 2, 2), 8, 'last row and column (u = 1, v = 1)');
  assert.equal(heightAt(m, h, -1, -1), 2, 'midpoint of the first cell');
  assert.equal(heightAt(m, h, 1, 1), 6, 'midpoint of the last cell');
  assert.equal(heightAt(m, h, 25, 0), 5, 'clamps to the east edge');
  assert.equal(heightAt(m, h, -25, -25), 0, 'clamps to the north-west corner');
  assert.equal(heightAt(m, h, 25, 25), 8, 'clamps to the south-east corner');
});

// ---- every region of the tour (E9.3): same format, size and flag tests ----
const REGION_FLAG_M = { 'shackleton-rim': 1958.6 };
for (const id of REGION_IDS) {
  const dir = path.join(ROOT, 'viewpoint/data', id);
  const rMeta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const rBin = fs.readFileSync(path.join(dir, rMeta.heights.file));
  const rSite = getSite(id);
  const mask = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/terrain/masks', `${id}.json`), 'utf8'));

  test(`[${id}] meta.json is valid, LOLA, and the binary has rows × cols × 2 bytes`, () => {
    validateMeta(rMeta);
    assert.equal(rMeta.id, id);
    assert.equal(rMeta.source.type, 'lola');
    assert.equal(rBin.length, rMeta.grid.rows * rMeta.grid.cols * 2);
    assert.equal(rBin.length, expectedBytes(rMeta));
    assert.deepEqual([rMeta.extentKm, rMeta.grid.cols, rMeta.grid.rows], [EXTENT_KM, GRID_SIZE, GRID_SIZE]);
    assert.ok(rMeta.name.es.length > 0);
  });

  test(`[${id}] the files of the region weigh less than 1.25 MB in total`, () => {
    const total = fs.readdirSync(dir).filter(notMasks).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
    assert.ok(total < 1_250_000, `${total} bytes`);
  });

  test(`[${id}] the flag is at the catalogue coordinates and its height is within 50 m of the mask`, () => {
    assert.deepEqual(rMeta.center, { lat: rSite.lat, lon: rSite.lon });
    assert.deepEqual([rMeta.sceneFrame.centerLat, rMeta.sceneFrame.centerLon], [rSite.lat, rSite.lon]);
    const flag = createSceneFrame(rMeta.sceneFrame).toScene(rSite.lat, rSite.lon);
    assert.ok(Math.abs(flag.x) < 1e-9 && Math.abs(flag.z) < 1e-9);
    const h = decodeHeights(rMeta, new Uint8Array(rBin));
    const flagM = heightAt(rMeta, h, flag.x, flag.z) * 1000;
    assert.ok(Math.abs(flagM - mask.heightM) < 50, `bandera a ${flagM} m, máscara ${mask.heightM} m`);
    if (REGION_FLAG_M[id]) assert.equal(mask.heightM, REGION_FLAG_M[id]);
  });

  test(`[${id}] SceneFrame: fromScene(toScene(p)) returns p with an error under 1 m over the whole region`, () => {
    const rFrame = createSceneFrame(rMeta.sceneFrame);
    const half = rMeta.extentKm / 2;
    let worstM = 0;
    for (let ix = -4; ix <= 4; ix++) {
      for (let iz = -4; iz <= 4; iz++) {
        const x = (ix / 4) * half;
        const z = (iz / 4) * half;
        const { lat, lon } = rFrame.fromScene(x, z);
        const p = rFrame.toScene(lat, lon);
        worstM = Math.max(worstM, Math.hypot(p.x - x, p.z - z) * 1000);
      }
    }
    assert.ok(worstM < 1, `error ${worstM} m`);
    // and the other way round, from coordinates around the centre of the region
    const kmPerDeg = (Math.PI / 180) * rMeta.sceneFrame.radiusKm;
    for (const [dN, dE] of [[0.3, 0.2], [-0.4, 0.5], [0.1, -0.6], [-0.2, -0.3]]) {
      const lat = rSite.lat + dN;
      const lon = rSite.lon + (dE * (rMeta.extentKm / 2)) / (kmPerDeg * Math.cos((rSite.lat * Math.PI) / 180)) * 0.5;
      const { x, z } = rFrame.toScene(lat, lon);
      const back = rFrame.fromScene(x, z);
      const q = rFrame.toScene(back.lat, back.lon);
      assert.ok(Math.hypot(q.x - x, q.z - z) * 1000 < 1);
      assert.ok(Math.abs(back.lat - lat) < 1e-6);
    }
  });

  test(`[${id}] SceneFrame: the catalogue point is the origin and agrees with siteFrame() (local north is -z, local east is +x)`, () => {
    const rFrame = createSceneFrame(rMeta.sceneFrame);
    const { x: ox, z: oz } = rFrame.toScene(rSite.lat, rSite.lon);
    assert.ok(Math.abs(ox) < 1e-9 && Math.abs(oz) < 1e-9);
    const f = siteFrame(rSite);
    for (const az of [0, 90, 180, 229.6, 300]) {
      const d = dirAzEl(rFrame.azimuthToScene(az), 0);
      const dir = f.north.map((n, i) => n * -d.z + f.east[i] * d.x);
      const p = f.pos.map((c, i) => c + dir[i] * 1);
      const lat = Math.asin(p[2] / Math.hypot(...p)) * (180 / Math.PI);
      const lon = Math.atan2(p[1], p[0]) * (180 / Math.PI);
      const s = rFrame.toScene(lat, lon);
      assert.ok(Math.abs(s.x - d.x) < 1e-3 && Math.abs(s.z - d.z) < 1e-3, `az ${az}: (${s.x}, ${s.z}) vs (${d.x}, ${d.z})`);
    }
  });

  test(`[${id}] series-2027.json exists for the region (the tour loads it before the relief)`, () => {
    const series = JSON.parse(fs.readFileSync(path.join(dir, 'series-2027.json'), 'utf8'));
    assert.equal(series.siteId, id);
    assert.equal(series.lat, rSite.lat);
    assert.equal(series.lon, rSite.lon);
    assert.equal(series.count, 8760);
  });

  test(`[${id}] shadow camera: fitted to the Sun, it holds the region from every azimuth and elevation`, () => {
    const heights = decodeHeights(rMeta, new Uint8Array(rBin));
    const bounds = shadowBounds([{ extentKm: rMeta.extentKm, grid: rMeta.grid, heights }]);
    const half = rMeta.extentKm / 2;
    for (let az = 0; az < 360; az += 15) {
      for (const el of [0, 0.39, 10, 45, 90]) {
        const d = dirAzEl(az, el);
        const f = fitShadowFrustum(bounds, d);
        assert.ok(f.near > 0 && f.far > f.near);
        for (const [x, z] of [[-half, -half], [half, -half], [-half, half], [half, half], [0, 0]]) {
          for (const y of [bounds.minY, bounds.maxY]) {
            const depth = f.distance - (x * d.x + y * d.y + z * d.z);
            assert.ok(depth >= f.near && depth <= f.far, `depth az ${az} el ${el}`);
            const up = (-x * d.x * d.y + y * (1 - d.y * d.y) - z * d.z * d.y) / Math.hypot(d.x, d.z, 1e-12);
            if (Math.hypot(d.x, d.z) > 1e-9) assert.ok(up <= f.top + 1e-9 && up >= f.bottom - 1e-9, `height az ${az} el ${el}`);
          }
        }
      }
    }
  });
}

test('im2-objetivo is Mons Mouton, with a Spanish name for the screen', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'viewpoint/data/im2-objetivo/meta.json'), 'utf8'));
  assert.deepEqual(m.center, { lat: -84.7754, lon: 29.128 });
  assert.match(m.name.es, /Mons Mouton/);
});

test('regionFromSearch: ?region=im2-objetivo opens Mons Mouton; none or an unknown id open Shackleton and report it', () => {
  assert.equal(regionFromSearch('?region=im2-objetivo'), 'im2-objetivo');
  assert.equal(regionFromSearch(''), DEFAULT_REGION_ID);
  assert.equal(DEFAULT_REGION_ID, 'shackleton-rim');
  const seen = [];
  assert.equal(regionFromSearch('?region=xyz', (id) => seen.push(id)), 'shackleton-rim');
  assert.deepEqual(seen, ['xyz']);
  assert.equal(regionFromSearch('?region=', (id) => seen.push(id)), 'shackleton-rim');
  assert.deepEqual(seen, ['xyz', '']);
});

test('--site: parseArgs reads it, procedural is only for Shackleton and unknown sites are rejected', () => {
  assert.deepEqual(parseArgs(['--site', 'im2-objetivo', '--source', 'lola']), { site: 'im2-objetivo', source: 'lola' });
  assert.throws(() => buildRelief({ site: 'im2-objetivo' }), /procedural/);
  assert.throws(() => buildRelief({ site: 'no-existe', source: 'lola', grids: syntheticGrids() }), /catálogo/);
});

test('the tutorial names no region: it is the same for every region of the tour', () => {
  const text = TEXTS.tutorialSteps.map((st) => `${st.title} ${st.text}`).join(' ');
  for (const id of REGION_IDS) {
    const rMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'viewpoint/data', id, 'meta.json'), 'utf8'));
    for (const word of rMeta.name.es.split(/\s+/).filter((w) => w.length > 3)) assert.ok(!text.includes(word), `el tutorial nombra «${word}»`);
  }
  assert.ok(!/Shackleton|Mouton/.test(text));
  assert.ok(!/grado y medio/.test(text), 'the range of the Sun depends on the region');
});

// ---- E9.2 · far horizon: terrain-far.bin, blend, ring mesh, horizon ----
import { decodeFarHeights, validateFar, blendHeight, blendFineHeights, buildRingArrays, matchSeamNormals, horizonFrom, farMeta, BLEND_KM } from '../src/core/far-relief.js';
import { loadRegion } from '../src/region.js';
import { buildFarRelief, assertFarOnlyMeta, FAR_EXTENT_KM, FAR_GRID_SIZE, FAR_FILE } from '../../pipeline/relief.mjs';

const farPath = path.join(DIR, 'terrain-far.bin');
const farBin = fs.existsSync(farPath) ? fs.readFileSync(farPath) : null;

test('meta.far describes terrain-far.bin: 300 × 300 km, 257 × 257, under 200 KB, the whole region under 1.2 MB', () => {
  validateFar(meta);
  assert.ok(farBin, 'terrain-far.bin missing');
  assert.equal(meta.far.file, 'terrain-far.bin');
  assert.deepEqual([meta.far.extentKm, meta.far.grid.cols, meta.far.grid.rows], [FAR_EXTENT_KM, FAR_GRID_SIZE, FAR_GRID_SIZE]);
  assert.equal(farBin.length, FAR_GRID_SIZE * FAR_GRID_SIZE * 2);
  assert.ok(farBin.length < 200_000);
  const total = fs.readdirSync(DIR).filter(notMasks).reduce((sum, f) => sum + fs.statSync(path.join(DIR, f)).size, 0);
  assert.ok(total < 1_200_000, `${total} bytes`);
  assert.throws(() => validateFar({ ...meta, far: { ...meta.far, extentKm: 10 } }), /far/);
  assert.throws(() => decodeFarHeights(meta, farBin.subarray(2)), /bytes/);
  assert.throws(() => decodeFarHeights({ ...meta, far: undefined }, farBin), /far/);
});

test('blend: the fine mesh and the ring give the same height at every node of the edge (no step), and the fine zone is untouched inside', () => {
  const fine = decodeHeights(meta, new Uint8Array(bin));
  const far = decodeFarHeights(meta, new Uint8Array(farBin));
  const blended = blendFineHeights(meta, fine, far);
  const n = meta.grid.cols;
  const fm = farMeta(meta);
  const { positions } = buildRingArrays(meta, far);
  const half = meta.extentKm / 2;
  const step = meta.extentKm / (n - 1);
  let worst = 0;
  for (let k = 0; k < n; k++) {
    const t = -half + k * step;
    for (const [i, j, x, z] of [[k, 0, t, -half], [k, n - 1, t, half], [0, k, -half, t], [n - 1, k, half, t]]) {
      worst = Math.max(worst, Math.abs(blended[j * n + i] - heightAt(fm, far, x, z)) * 1000);
    }
  }
  assert.ok(worst < 1, `edge step ${worst} m`);
  // the vertices of the ring on the edge of the hole have the same height as the fine edge nodes
  let ringWorst = 0;
  let onEdge = 0;
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v];
    const z = positions[v + 2];
    if (Math.max(Math.abs(x), Math.abs(z)) > half + 1e-6 || Math.abs(Math.abs(x) - half) > 1e-6 && Math.abs(Math.abs(z) - half) > 1e-6) continue;
    onEdge++;
    ringWorst = Math.max(ringWorst, Math.abs(positions[v + 1] - blendHeight(meta, fine, far, x, z)) * 1000);
  }
  assert.ok(onEdge > 100 && ringWorst < 1, `${onEdge} vertices, ${ringWorst} m`);
  // further than the strip from the edge nothing changes
  const c = (n - 1) / 2;
  assert.equal(blended[c * n + c], fine[c * n + c]);
  const inner = Math.round((half - BLEND_KM) / step) - 1;
  assert.equal(blended[(c + inner) * n + c], fine[(c + inner) * n + c]);
  // smoothstep in the strip: halfway it is the average of fine and ring
  const x = half - BLEND_KM / 2;
  const avg = (heightAt(meta, fine, x, 0) + heightAt(fm, far, x, 0)) / 2;
  assert.ok(Math.abs(blendHeight(meta, fine, far, x, 0) - avg) < 1e-9);
  assert.equal(blendHeight(meta, fine, far, half + 5, 0), heightAt(fm, far, half + 5, 0));
});

test('the ring mesh has the hole of the fine zone, covers the whole 300 km and is wound counter-clockwise (normals up)', () => {
  const far = decodeFarHeights(meta, new Uint8Array(farBin));
  const { positions, indices } = buildRingArrays(meta, far);
  const half = meta.extentKm / 2;
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((o) => indices[t + o] * 3);
    const cross = (positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a]) - (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]); // y of the normal
    const cx = (positions[a] + positions[b] + positions[c]) / 3;
    const cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    assert.ok(Math.max(Math.abs(cx), Math.abs(cz)) > half, 'a triangle inside the hole');
    assert.ok(cross > 0, 'winding'); // normal +y, as buildTerrainArrays
    area += cross / 2;
  }
  assert.ok(Math.abs(area - (FAR_EXTENT_KM ** 2 - meta.extentKm ** 2)) < 1e-3, `area ${area}`);
});

test('horizonFrom the flag (observer at 2 m) matches the LOLA mask: median error < 0.25° and p95 < 0.75° over 720 azimuths', () => {
  const fine = decodeHeights(meta, new Uint8Array(bin));
  const far = decodeFarHeights(meta, new Uint8Array(farBin));
  const mask = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/terrain/masks/shackleton-rim.json'), 'utf8'));
  assert.equal(mask.stepDeg, 0.5);
  const el = horizonFrom(meta, fine, far, 0, 0, mask.observerHeightM / 1000);
  assert.equal(el.length, 720);
  const err = Array.from(el, (e, k) => Math.abs(e - mask.el[k])).sort((a, b) => a - b);
  const median = err[359.5 | 0];
  const p95 = err[Math.ceil(0.95 * err.length) - 1];
  assert.ok(median < 0.25 && p95 < 0.75, `median ${median}°, p95 ${p95}°`);
});

// A flat DEM at height 0 big enough for the 300 km ring (±320 km around the pole, 240 m)
function flatFarGrids() {
  const res = 240;
  const w = 2667;
  return [makeGrid({ name: 'plano-lejano', product: 'SINTETICO', res, X0: -320000, Y0: 320000, w, h: w, a: new Float32Array(w * w) })];
}

test('far ring with a flat synthetic DEM: deterministic, and the corner falls where the curvature formula says (± 5 m)', () => {
  const a = buildFarRelief({ grids: flatFarGrids() });
  const b = buildFarRelief({ grids: flatFarGrids() });
  assert.ok(a.bin.equals(b.bin));
  assert.equal(JSON.stringify(a.far), JSON.stringify(b.far));
  assert.equal(a.bin.length, FAR_GRID_SIZE ** 2 * 2);
  const m = { ...meta, far: a.far };
  validateFar(m);
  const h = decodeFarHeights(m, new Uint8Array(a.bin));
  const half = FAR_EXTENT_KM / 2;
  const expected = (rho) => R_KM * Math.sqrt(1 - (rho / R_KM) ** 2) - R_KM;
  for (const k of [0, FAR_GRID_SIZE - 1, FAR_GRID_SIZE * (FAR_GRID_SIZE - 1), FAR_GRID_SIZE ** 2 - 1]) {
    const e = expected(half * Math.SQRT2);
    assert.ok(Math.abs(h[k] - e) * 1000 < 5, `corner ${k}: ${h[k] * 1000} m, expected ${e * 1000} m`);
  }
  assert.ok(Math.abs(h[(FAR_GRID_SIZE - 1) / 2 * FAR_GRID_SIZE + FAR_GRID_SIZE - 1] - expected(half)) * 1000 < 5, 'edge midpoint ≈ 6.5 km down at 150 km');
  assert.ok(Math.abs(expected(150) * 1000 + 6475) < 60);
  assert.throws(() => buildFarRelief({ grids: syntheticGrids() }), /Ningún DEM/);
});

test('the far ring is centred on the centre it is given (#430): on a sloped DEM its middle node has the height of that point', () => {
  const res = 240;
  const w = 2667;
  const slopeM = (X) => 0.01 * X; // 1 cm per metre eastwards in the polar projection
  const a = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) a[r * w + c] = slopeM(-320000 + (c + 0.5) * res);
  const grids = [makeGrid({ name: 'rampa', product: 'SINTETICO', res, X0: -320000, Y0: 320000, w, h: w, a })];
  const mid = (FAR_GRID_SIZE - 1) / 2;
  for (const center of [{ lat: site.lat, lon: site.lon }, { lat: -89.463, lon: -151.2 }, { lat: -89.2, lon: 60 }]) {
    const { far, bin: farBytes } = buildFarRelief({ center, grids });
    const h = decodeFarHeights({ ...meta, far }, new Uint8Array(farBytes));
    const expected = slopeM(llToXY(center.lat, center.lon)[0]) / 1000;
    assert.ok(Math.abs(h[mid * FAR_GRID_SIZE + mid] - expected) < far.heights.scale + 1e-3, `${center.lat}, ${center.lon}: ${h[mid * FAR_GRID_SIZE + mid]} km, expected ${expected} km`);
  }
  // without a centre, the Shackleton ridge, as before
  assert.ok(buildFarRelief({ grids }).bin.equals(buildFarRelief({ center: { lat: site.lat, lon: site.lon }, grids }).bin));
});

test('every LOLA region of the repo has its far ring (#430), centred on its own site: along the edge of the zone it matches the zone grid', () => {
  const ids = fs.readdirSync(path.join(ROOT, 'viewpoint/data'));
  assert.ok(ids.length >= 6);
  for (const id of ids) {
    const dir = path.join(ROOT, 'viewpoint/data', id);
    const m = validateFar(validateMeta(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))));
    if (m.source.type !== 'lola') continue;
    assert.ok(m.far, `${id}: no far in meta.json`);
    assert.deepEqual([m.far.file, m.far.extentKm, m.far.grid.cols, m.far.grid.rows], [FAR_FILE, FAR_EXTENT_KM, FAR_GRID_SIZE, FAR_GRID_SIZE], id);
    const fine = decodeHeights(m, fs.readFileSync(path.join(dir, m.heights.file)));
    const far = decodeFarHeights(m, new Uint8Array(fs.readFileSync(path.join(dir, FAR_FILE))));
    const fm = farMeta(m);
    const half = m.extentKm / 2;
    const err = [];
    for (let t = -half; t <= half; t += 0.5) {
      for (const [x, z] of [[t, -half], [t, half], [-half, t], [half, t]]) err.push(Math.abs(heightAt(m, fine, x, z) - heightAt(fm, far, x, z)) * 1000);
    }
    err.sort((p, q) => p - q);
    // a ring centred elsewhere (5 km off) differs by hundreds of metres; the same DEM at 1.2 km and 156 m, by a few metres
    assert.ok(err[err.length >> 1] < 20, `${id}: median ${err[err.length >> 1]} m between the zone edge and the ring`);
  }
});

test('without `far` (procedural files) there is nothing to validate and the client keeps the fine zone alone', () => {
  const pr = buildRelief();
  assert.equal(pr.meta.far, undefined);
  assert.equal(validateFar(pr.meta), pr.meta);
});

test('the blend is C1: the slope is 0 at both ends of the strip (fine flat at 0, ring flat at 1 km)', () => {
  const m = {
    extentKm: 20, grid: { cols: 21, rows: 21 },
    far: { file: 'f', extentKm: 60, grid: { cols: 61, rows: 61 }, heights: { encoding: 'uint16-le', unit: 'km', scale: 1, offset: 0 } },
  };
  const fine = new Float32Array(21 * 21);
  const far = new Float32Array(61 * 61).fill(1);
  const h = (x) => blendHeight(m, fine, far, x, 0);
  const d = 0.01;
  assert.ok(Math.abs(h(10 - BLEND_KM + d) - h(10 - BLEND_KM)) < 1e-3, 'inner end');
  assert.ok(Math.abs(h(10 - d) - h(10)) < 1e-3 && h(10) === 1, 'edge');
  assert.ok(Math.abs(h(10 - BLEND_KM / 2) - 0.5) < 1e-9);
});

test('matchSeamNormals copies the fine edge normals onto the ring vertices of the hole boundary only', () => {
  const m = { extentKm: 4, grid: { cols: 5, rows: 5 } };
  const fineNormals = new Float32Array(25 * 3).fill(0.5);
  const ringPositions = new Float32Array([2, 0, 0, 0, 0, 2, 10, 0, 10, 1, 0, 1]); // two on the boundary, one outside, one inside
  const ringNormals = new Float32Array(12);
  assert.equal(matchSeamNormals(m, fineNormals, ringPositions, ringNormals), 2);
  assert.deepEqual(Array.from(ringNormals), [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 0]);
});

test('--far-only only accepts a LOLA meta.json', () => {
  assertFarOnlyMeta({ source: { type: 'lola' } });
  for (const type of ['procedural', 'simulated']) assert.throws(() => assertFarOnlyMeta({ source: { type } }), /npm run pipeline:relief:lola/);
  assert.throws(() => assertFarOnlyMeta({}), /--far-only/);
});

test('loadRegion fetches the ring when meta.far exists, returns far: null without it and survives a failing ring', async () => {
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const fineBin = fs.readFileSync(path.join(DIR, meta.heights.file));
  const files = { 'meta.json': Buffer.from(JSON.stringify(meta)), [meta.heights.file]: fineBin, 'terrain-far.bin': farBin };
  for (const level of detailLevels(meta)) files[level.heights.file] = fs.readFileSync(path.join(DIR, level.heights.file));
  const mock = (overrides = {}, metaOverride) => {
    const calls = [];
    globalThis.fetch = async (url) => {
      const name = String(url).split('/').pop();
      calls.push(name);
      if (name === 'meta.json' && metaOverride) return { ok: true, json: async () => metaOverride };
      const body = name in overrides ? overrides[name] : files[name];
      if (!body) return { ok: false, status: 404 };
      return { ok: true, json: async () => JSON.parse(body.toString()), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
    };
    return calls;
  };
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    let calls = mock();
    let region = await loadRegion('x');
    assert.ok(calls.includes('terrain-far.bin'));
    assert.equal(region.far.length, FAR_GRID_SIZE * FAR_GRID_SIZE);
    assert.deepEqual(region.detail.map((h) => h.length), detailLevels(meta).map((d) => d.grid.cols * d.grid.rows), 'the detail grids, gunzipped and decoded');

    const { far: _far, ...noFar } = meta;
    calls = mock({}, noFar);
    region = await loadRegion('x');
    assert.equal(region.far, null);
    assert.ok(!calls.includes('terrain-far.bin'));

    mock({ 'terrain-far.bin': null });
    region = await loadRegion('x');
    assert.equal(region.far, null);
    assert.ok(region.heights.length > 0);

    mock({ 'terrain-far.bin': farBin.subarray(2) });
    region = await loadRegion('x');
    assert.equal(region.far, null);
    assert.equal(warnings.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
});

// ---- Detail grids around the site (#97) ----
// The bytes of a detail grid as decodeGrid takes them: gunzipped when the file is.
const unzipped = (level, bytes) => (isGzipped(level) ? zlib.gunzipSync(bytes) : bytes);
const readDetail = (dir, m) => detailLevels(m).map((level) => unzipped(level, fs.readFileSync(path.join(dir, level.heights.file))));
const detailBins = readDetail(DIR, meta);
const loadLevels = () => buildLevels(meta, decodeHeights(meta, new Uint8Array(bin)), detailLevels(meta).map((level, k) => decodeGrid(level, detailBins[k])));

test('meta.detail: the grids of the pipeline, finer and smaller each time, down to 20 m around the site and 5 m under your feet', () => {
  const detail = detailLevels(meta);
  // the levels of the 20 m DEM, then the real 5 m ground of the site (pipeline/ground.mjs)
  assert.deepEqual(detail.map((d) => [d.heights.file, d.extentKm, d.grid.cols, d.grid.rows]), [...DETAIL_LEVELS, GROUND_LEVEL].map((d) => [d.file, d.extentKm, d.size, d.size]));
  detail.forEach((level, k) => {
    assert.equal(level.heights.encoding, DETAIL_ENCODING);
    assert.equal(detailBins[k].length, expectedBytes(level));
    assert.ok(fs.statSync(path.join(DIR, level.heights.file)).size < expectedBytes(level) * 0.6, 'packed: well under the plain size');
    assert.ok(level.products.length > 0 && level.products.every((p) => /@\d+m$/.test(p)));
    assert.throws(() => decodeGrid(level, detailBins[k].subarray(2)), new RegExp(level.heights.file));
  });
  const twenty = detail[DETAIL_LEVELS.length - 1];
  assert.ok(twenty.grid.stepKm <= 0.02 && twenty.extentKm >= 10, 'tens of metres over at least 10 km');
  assert.deepEqual(twenty.products, ['LDEM_80S_20MPP_ADJ@20m']);
  const ground = detail.at(-1);
  assert.deepEqual(ground.products, ['LOLA_5MPP_Site01@5m'], 'the connecting ridge of PGDA product 78');
  assert.ok(ground.grid.stepKm < 0.005, 'under 5 m a cell');
});

test('meta.detail: a grid that does not fit the one before is rejected, and a meta without detail is still valid', () => {
  const { detail, ...plain } = meta;
  validateMeta(plain);
  assert.deepEqual(detailLevels(plain), []);
  assert.equal(buildLevels(plain, decodeHeights(plain, new Uint8Array(bin))).length, 1);
  const broken = (change) => ({ ...meta, detail: [{ ...detail[0], ...change }] });
  assert.throws(() => detailLevels(broken({ extentKm: 40 })), /no encaja/);
  assert.throws(() => detailLevels(broken({ extentKm: 20.1 })), /no encaja/, 'border off the grid lines of the region');
  assert.throws(() => detailLevels(broken({ grid: { cols: 1, rows: 1 } })), /rejilla de detalle/);
  assert.throws(() => detailLevels(broken({ heights: { ...detail[0].heights, encoding: 'float32' } })), /detalle/);
});

test('a detail grid that fails to load ends the levels there: the region is drawn with the ones before', () => {
  const h = decodeHeights(meta, new Uint8Array(bin));
  const first = decodeGrid(meta.detail[0], new Uint8Array(detailBins[0]));
  assert.equal(buildLevels(meta, h, [null, decodeGrid(meta.detail[1], new Uint8Array(detailBins[1]))]).length, 1);
  assert.equal(buildLevels(meta, h, [first, null]).length, 2);
});

test('levels meet without a step: on its border a level has the height and the normal of the one before', () => {
  const levels = loadLevels();
  assert.equal(levels.length, 1 + detailLevels(meta).length);
  for (let k = 1; k < levels.length; k++) {
    const level = levels[k];
    const parent = levels[k - 1];
    const { cols, rows } = level.grid;
    const half = level.extentKm / 2;
    const step = level.extentKm / (cols - 1);
    const ratio = Math.round(parent.extentKm / (parent.grid.cols - 1) / step);
    const pCols = parent.grid.cols;
    const pFirst = Math.round((parent.extentKm / 2 - half) / (parent.extentKm / (pCols - 1)));
    let worst = 0;
    for (let i = 0; i < cols; i++) {
      for (const j of [0, rows - 1]) {
        for (const [a, b] of [[i, j], [j, i]]) { // the four sides
          const x = -half + a * step;
          const z = -half + b * step;
          worst = Math.max(worst, Math.abs(level.heights[b * cols + a] - heightAt(parent, parent.heights, x, z)));
          const n = level.normals.subarray((b * cols + a) * 3, (b * cols + a) * 3 + 3);
          assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-5 && n[1] > 0, 'unit normal, pointing up');
          if (a % ratio === 0 && b % ratio === 0) {
            // a node of the level before: same height and same normal, exactly what the level before draws there
            const pk = (pFirst + b / ratio) * pCols + pFirst + a / ratio;
            assert.ok(Math.abs(level.heights[b * cols + a] - parent.heights[pk]) < 1e-6);
            for (let q = 0; q < 3; q++) assert.ok(Math.abs(n[q] - parent.normals[pk * 3 + q]) < 1e-5);
          }
        }
      }
    }
    assert.ok(worst < 1e-6, `step of ${worst * 1000} m at the border of level ${k}`);
  }
});

test('levels: away from the border the heights are the ones of the file, and the flag stands on the finest one', () => {
  const levels = loadLevels();
  const finest = levels.at(-1);
  const raw = decodeGrid(meta.detail.at(-1), new Uint8Array(detailBins.at(-1)));
  const mid = (finest.grid.cols - 1) / 2;
  for (const [i, j] of [[mid, mid], [100, 200], [400, 60]]) assert.equal(finest.heights[j * finest.grid.cols + i], raw[j * finest.grid.cols + i]);
  const mask = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/terrain/masks/shackleton-rim.json'), 'utf8'));
  assert.equal(surfaceHeightAt(levels, 0, 0), finest.heights[mid * finest.grid.cols + mid]);
  assert.ok(Math.abs(surfaceHeightAt(levels, 0, 0) * 1000 - mask.heightM) < 5, `bandera a ${surfaceHeightAt(levels, 0, 0) * 1000} m`);
  assert.equal(surfaceHeightAt(levels, 15, 15), heightAt(meta, levels[0].heights, 15, 15), 'outside the detail: the region grid');
  assert.equal(surfaceHeightAt(levels, 7, -7), heightAt(levels[1], levels[1].heights, 7, -7), 'between both: the middle level');
});

test('each level leaves a hole for the next one: no cell is drawn twice and none is missing', () => {
  const levels = loadLevels();
  let areaKm2 = 0;
  levels.forEach((level, k) => {
    const next = levels[k + 1];
    const { positions, indices } = buildTerrainArrays(level, level.heights, next?.extentKm ?? 0);
    const cells = (level.grid.cols - 1) * (level.grid.rows - 1);
    const holeCells = next ? Math.round((next.extentKm / level.extentKm) * (level.grid.cols - 1)) ** 2 : 0;
    assert.equal(indices.length, (cells - holeCells) * 6);
    assert.equal(positions.length, level.grid.cols * level.grid.rows * 3);
    areaKm2 += (indices.length / 6) * (level.extentKm / (level.grid.cols - 1)) ** 2;
    if (next) {
      // no triangle of this level has a vertex strictly inside the hole
      const inner = next.extentKm / 2 - 1e-9;
      for (let t = 0; t < indices.length; t += 997) assert.ok(Math.max(Math.abs(positions[indices[t] * 3]), Math.abs(positions[indices[t] * 3 + 2])) >= inner);
    }
  });
  assert.ok(Math.abs(areaKm2 - meta.extentKm ** 2) < 1e-6, `${areaKm2} km²`);
});

test('the levels and their meshes are built in under 300 ms', () => {
  loadLevels(); // warm-up
  const t0 = performance.now();
  const levels = loadLevels();
  levels.forEach((level, k) => buildTerrainArrays(level, level.heights, levels[k + 1]?.extentKm ?? 0));
  const ms = performance.now() - t0;
  assert.ok(ms < 300, `${ms} ms`);
});

// The synthetic plane again, plus a 20 m window of it around the site (±20 km), as the 20 m LOLA windows of the cache.
function syntheticGridsWithWindow() {
  const [cx, cy] = llToXY(site.lat, site.lon);
  const res = 20;
  const w = 2000;
  const X0 = Math.round(cx / res) * res - (w / 2) * res;
  const Y0 = Math.round(cy / res) * res + (w / 2) * res;
  const a = new Float32Array(w * w);
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) a[r * w + c] = planeM(X0 + (c + 0.5) * res, Y0 - (r + 0.5) * res);
  return [...syntheticGrids(), makeGrid({ name: 'ventana', product: 'SINTETICO', res, X0, Y0, w, h: w, a })];
}

test('delta16-gzip: unpackDelta16 undoes packDelta16, also when the differences wrap around', () => {
  const cols = 5;
  const values = Uint16Array.from([0, 65535, 1, 40000, 3, 12, 65000, 7, 7, 7, 300, 2, 65535, 0, 9]);
  const plain = Buffer.from(values.buffer);
  const packed = packDelta16(plain, cols);
  assert.deepEqual([...unpackDelta16(zlib.gunzipSync(packed), cols)], [...plain]);
  assert.ok(packDelta16(plain, cols).equals(packed), 'same bytes every time');
});

test('LOLA with a synthetic DEM: the detail grids hold the same surface as the region, node by node', () => {
  const r = buildRelief({ source: 'lola', grids: syntheticGridsWithWindow() });
  assert.deepEqual(r.detail.map((d) => d.file), DETAIL_LEVELS.map((d) => d.file));
  detailLevels(r.meta).forEach((level, k) => {
    assert.deepEqual(level.products, ['SINTETICO@20m']);
    const h = decodeGrid(level, unzipped(level, r.detail[k].bin));
    const { cols } = level.grid;
    const step = level.extentKm / (cols - 1);
    let worst = 0;
    for (let j = 0; j < cols; j += 16) {
      for (let i = 0; i < cols; i += 16) {
        const { lat, lon } = frame.fromScene(-level.extentKm / 2 + i * step, -level.extentKm / 2 + j * step);
        const [px, py] = llToXY(lat, lon);
        worst = Math.max(worst, Math.abs(h[j * cols + i] - ((R_KM + planeM(px, py) / 1000) * centralCos(lat, lon) - R_KM)));
      }
    }
    assert.ok(worst < level.heights.scale + 0.001, `error ${worst * 1000} m`);
  });
});

test('detail grids are only written where the DEM is fine enough: not with a 240 m DEM, nor procedural, nor simulated', () => {
  const coarse = buildRelief({ source: 'lola', grids: syntheticGrids() });
  assert.equal(coarse.detail.length, 0, 'a 240 m DEM has nothing to add to a 156 m grid');
  assert.equal(coarse.meta.detail, undefined);
  for (const r of [buildRelief(), buildRelief({ source: 'simulated', site: 'malapert' })]) {
    assert.equal(r.detail.length, 0, r.meta.source.type);
    assert.equal(r.meta.detail, undefined);
    assert.equal(buildLevels(r.meta, decodeHeights(r.meta, r.bin)).length, 1, 'and the viewer draws it with the region grid alone');
  }
});

test('the regions of the repo: detail down to 20 m where the region has a 20 m DEM under it, and a bounded total weight', () => {
  let total = 0;
  const withDetail = [], withGround = [];
  for (const id of fs.readdirSync(path.join(ROOT, 'viewpoint/data'))) {
    const dir = path.join(ROOT, 'viewpoint/data', id);
    const m = validateMeta(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')));
    const fine = m.source.products.some((p) => p.endsWith('@20m'));
    // the 5 m ground only where a PGDA site DEM covers the square (pipeline/ground.mjs): real data or nothing
    const ground = detailLevels(m).some((d) => d.heights.file === GROUND_LEVEL.file);
    assert.equal(detailLevels(m).length, fine ? DETAIL_LEVELS.length + (ground ? 1 : 0) : 0, id);
    if (ground) withGround.push(id);
    if (fine) withDetail.push(id);
    const files = fs.readdirSync(dir);
    assert.deepEqual(files.filter((f) => /^terrain-lod[1-9]/.test(f)).sort(), detailLevels(m).map((d) => d.heights.file).sort(), `${id}: no stray detail files`);
    const levels = buildLevels(m, decodeHeights(m, fs.readFileSync(path.join(dir, 'terrain-lod0.bin'))), readDetail(dir, m).map((bytes, k) => decodeGrid(m.detail[k], bytes)));
    assert.equal(levels.length, 1 + detailLevels(m).length, id);
    // the finest grid agrees with the region grid at the site: the same DEM, to within what 156 m cells smooth away
    assert.ok(Math.abs(surfaceHeightAt(levels, 0, 0) - heightAt(m, levels[0].heights, 0, 0)) < 0.05, id);
    total += files.filter(notMasks).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
  }
  // `mouton` (#80) is read from the 160 m DEM alone: no detail, and the viewer draws it with its region grid
  assert.deepEqual(withDetail.sort(), ['gerlache', 'im2-objetivo', 'malapert', 'ridge-slope', 'shackleton-rim']);
  // the PGDA 5 m site DEMs cover the connecting ridge (Site01) and Malapert (Site23); not De Gerlache nor the IM-2 target
  assert.deepEqual(withGround.sort(), ['malapert', 'ridge-slope', 'shackleton-rim']);
  // +0.73 MB for the three 5 m grounds (about 240 KB each) and +0.66 MB for the far rings of the other five regions (#430,
  // 132 KB each); a region downloads only its own
  assert.ok(total < 4_800_000, `viewpoint/data weighs ${total} bytes`);
});

test('detail and far ring together: the levels are built on the region grid blended into the ring, and nothing moves near the site', () => {
  const fine = decodeHeights(meta, new Uint8Array(bin));
  const ring = decodeFarHeights(meta, new Uint8Array(farBin));
  const blended = blendFineHeights(meta, fine, ring);
  const detail = detailLevels(meta).map((level, k) => decodeGrid(level, detailBins[k]));
  const withRing = buildLevels(meta, blended, detail);
  const without = buildLevels(meta, fine, detail);
  assert.equal(withRing.length, 1 + detail.length);
  // the strip that blends into the ring (BLEND_KM from the edge) is far from the detail grids: they are the same either way
  assert.ok(meta.extentKm / 2 - BLEND_KM > withRing[1].extentKm / 2 + 1);
  for (let k = 1; k < withRing.length; k++) assert.deepEqual(withRing[k].heights, without[k].heights);
  assert.equal(withRing[0].heights, blended);
  // the ring takes the normals of the region grid on the seam: the array of level 0 has the layout matchSeamNormals reads
  assert.equal(withRing[0].normals.length, meta.grid.rows * meta.grid.cols * 3);
});

test('shadow camera: fitted to the Sun, it holds the whole region from every azimuth and elevation', () => {
  const bounds = shadowBounds(loadLevels());
  assert.equal(bounds.half, meta.extentKm / 2);
  assert.ok(bounds.minY < -2.9 && bounds.maxY > 1.9 && bounds.maxY < 2.1);
  for (let az = 0; az < 360; az += 7.5) {
    for (const el of [-2, 0, 0.39, 2, 10, 45, 90]) {
      const d = dirAzEl(az, el);
      const f = fitShadowFrustum(bounds, d);
      assert.ok(f.near > 0 && f.far > f.near, `near/far az ${az} el ${el}`);
      // the axes of a three.js camera at d · distance that looks at the origin with +y up
      const flat = Math.hypot(d.x, d.z);
      const ax = flat > 1e-9 ? [d.z / flat, 0, -d.x / flat] : [1, 0, 0];
      const ay = [d.y * ax[2] - d.z * ax[1], d.z * ax[0] - d.x * ax[2], d.x * ax[1] - d.y * ax[0]];
      for (const x of [-bounds.half, 0, bounds.half]) for (const y of [bounds.minY, bounds.maxY]) for (const z of [-bounds.half, 0, bounds.half]) {
        const across = x * ax[0] + y * ax[1] + z * ax[2];
        const up = x * ay[0] + y * ay[1] + z * ay[2];
        const depth = f.distance - (x * d.x + y * d.y + z * d.z);
        assert.ok(across >= f.left && across <= f.right && up >= f.bottom && up <= f.top && depth >= f.near && depth <= f.far, `az ${az} el ${el}`);
      }
    }
  }
});

test('shadow camera: with the Sun grazing the horizon it is a thin slab, metres per texel in height', () => {
  const bounds = shadowBounds(loadLevels());
  const relief = bounds.maxY - bounds.minY;
  for (const az of [0, 42, 229.6]) {
    const f = fitShadowFrustum(bounds, dirAzEl(az, 0.39));
    assert.ok(f.top - f.bottom < relief + 1, `${f.top - f.bottom} km tall`);
    assert.ok((f.top - f.bottom) / 4096 < 0.002, 'under 2 m per texel with a 4096 map');
    assert.ok(f.right - f.left <= meta.extentKm * Math.SQRT2 + 0.2);
  }
  // before #97 the camera was as tall as the diagonal of the region: over 60 km
  assert.ok(fitShadowFrustum(bounds, dirAzEl(0, 0.39)).top - fitShadowFrustum(bounds, dirAzEl(0, 0.39)).bottom < 60 / 8);
});

test('the region selector lists exactly REGION_IDS, each with a name in meta.json (E2.4, #155)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'viewpoint/index.html'), 'utf8');
  assert.match(html, /<select id="region-select"><\/select>/);
  assert.doesNotMatch(html, /aria-describedby="region-approx"/, 'set from JS only while the warning is shown');
  assert.match(html, /<button type="button" class="region-go" id="region-go"/);
  assert.match(html, /<label class="sr-only" for="region-select"/);
  for (const id of REGION_IDS) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'viewpoint/data', id, 'meta.json'), 'utf8'));
    assert.equal(m.id, id);
    assert.ok(m.name.es.length > 0);
    assert.equal(typeof m.coordinatesVerified, 'boolean');
    assert.equal(m.coordinatesVerified, getSite(id).verified, `${id}: coordinatesVerified must follow the catalogue`);
  }
  assert.equal(regionFromSearch('?region=desconocida'), DEFAULT_REGION_ID);
});

test('regionOptions gives one option per id, in order, named from meta.name.es with the id as fallback', () => {
  const metas = REGION_IDS.map(id => JSON.parse(fs.readFileSync(path.join(ROOT, 'viewpoint/data', id, 'meta.json'), 'utf8')));
  const options = regionOptions(REGION_IDS, metas);
  assert.deepEqual(options.map(o => o.id), REGION_IDS);
  assert.deepEqual(options.map(o => o.label), metas.map(m => m.name.es));
  const withFailure = regionOptions(REGION_IDS, REGION_IDS.map((_, i) => (i === 0 ? null : metas[i])));
  assert.equal(withFailure[0].label, REGION_IDS[0]);
  assert.equal(withFailure[1].label, metas[1].name.es);
  assert.deepEqual(regionOptions(REGION_IDS, []).map(o => o.label), REGION_IDS);
});

test('shouldApplyRegion only accepts a known region other than the current one', () => {
  const [a, b] = REGION_IDS;
  assert.equal(shouldApplyRegion(a, b), true);
  assert.equal(shouldApplyRegion(a, a), false);
  assert.equal(shouldApplyRegion(a, 'desconocida'), false);
  assert.equal(shouldApplyRegion(a, ''), false);
});

test('aria-describedby points at the warning only when the coordinates are not verified', () => {
  assert.equal(approxDescribedBy({ coordinatesVerified: false }, 'w'), 'w');
  assert.equal(approxDescribedBy({ coordinatesVerified: true }, 'w'), null);
  assert.equal(approxDescribedBy(null, 'w'), null);
});

test('the approximate-coordinates warning only appears when coordinatesVerified is false', () => {
  assert.equal(hasApproximateCoordinates({ coordinatesVerified: false }), true);
  assert.equal(hasApproximateCoordinates({ coordinatesVerified: true }), false);
  assert.equal(hasApproximateCoordinates({}), false);
});

test('changing region keeps the start date and the day of the timeline', () => {
  const search = regionSearch('?region=shackleton-rim', 'im2-objetivo', { start: '2027-03-02', offsetDays: 12.5 });
  assert.equal(regionFromSearch(search), 'im2-objetivo');
  const params = new URLSearchParams(search);
  assert.equal(params.get('start'), '2027-03-02');
  assert.equal(dayFromSearch(search, 60), 12.5);
  assert.equal(dayFromSearch('?day=99', 60), null);
  assert.equal(dayFromSearch('?day=abc', 60), null);
  assert.equal(dayFromSearch('', 60), null);
});

test('changing region takes the state of the timeline as main.js keeps it, so the day never goes out as NaN', () => {
  const state = { start: '2027-03-01', offsetDays: 12.5, playing: false, speedIndex: 1 };
  const search = regionSearch('?day=3&start=2027-03-01', 'im2-objetivo', state);
  assert.equal(new URLSearchParams(search).get('day'), '12.5');
  assert.equal(dayFromSearch(search, 60), 12.5);
});

test('changing region round-trips start and day and keeps unrelated parameters', () => {
  const search = regionSearch('?foo=1&region=shackleton-rim', 'im2-objetivo', { start: '2027-03-02', offsetDays: 12.5 });
  assert.equal(new URLSearchParams(search).get('foo'), '1');
  assert.equal(startFromSearch(search, 'X'), '2027-03-02');
  assert.equal(dayFromSearch(search, 60), 12.5);
});

test('5 m ground: real data that agrees with the 20 m DEM it sits in (a finer look at the same ground, not another one)', () => {
  for (const id of ['shackleton-rim', 'ridge-slope', 'malapert']) {
    const dir = path.join(ROOT, 'viewpoint/data', id);
    const m = validateMeta(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')));
    const levels = detailLevels(m);
    const ground = levels.at(-1), twenty = levels.at(-2);
    assert.equal(ground.heights.file, GROUND_LEVEL.file, id);
    assert.equal(Math.round(twenty.grid.stepKm / ground.grid.stepKm), 4, `${id}: four 5 m cells to a 19.5 m one`);
    assert.ok(/^LOLA_5MPP_Site\d\d@5m$/.test(ground.products[0]) && /Barker et al\. 2021/.test(ground.citation), id);
    const raw = decodeGrid(ground, unzipped(ground, fs.readFileSync(path.join(dir, ground.heights.file))));
    const twentyH = decodeGrid(twenty, unzipped(twenty, fs.readFileSync(path.join(dir, twenty.heights.file))));
    // compare on the nodes of the 20 m grid inside the square: RMS of the differences, and the mean (no offset between the products)
    const n = ground.grid.cols, half = ground.extentKm / 2, step = ground.grid.stepKm;
    let sum = 0, sum2 = 0, count = 0;
    for (let j = 0; j < n; j += 4) for (let i = 0; i < n; i += 4) {
      const d = raw[j * n + i] - heightAt(twenty, twentyH, -half + i * step, -half + j * step);
      sum += d; sum2 += d * d; count++;
    }
    const meanM = (sum / count) * 1000, rmsM = Math.sqrt(sum2 / count) * 1000;
    assert.ok(Math.abs(meanM) < 3, `${id}: mean difference ${meanM.toFixed(2)} m`);
    assert.ok(rmsM < 6, `${id}: RMS difference ${rmsM.toFixed(2)} m`);
  }
});
