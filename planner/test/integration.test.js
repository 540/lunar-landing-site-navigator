// Integration: the planner against the real API v1, the data/ app started in memory (data/src/server.ts), with no
// external network and no DEM. If a v1 change breaks the planner, this test breaks in CI.
//
// Terrain is turned on on purpose, as in data/test/terrain.test.ts: LUNAR_TERRAIN_DIR points to a temporary folder
// with the catalog masks (backend/terrain/masks, in git) and without the DEM cache. So the polar catalog sites get
// their mask, free coordinates fall back to the sphere and the slope comes back as null.
//
// It needs the dependencies of backend/ and data/ (npm ci --prefix backend && npm ci --prefix data, as the root
// npm test and the CI do). Without them it is skipped outside the CI, so `npm test` in planner/ still works alone.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadWindows } from '../src/api.js';
import { PROFILES } from '../src/profiles.js';
import { VERDICT, evaluate } from '../src/rules.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const missing = ['backend/node_modules', 'data/node_modules'].filter((d) => !fs.existsSync(path.join(ROOT, d)));
const skip = missing.length && !process.env.CI ? `faltan ${missing.join(' y ')}: npm ci --prefix backend && npm ci --prefix data` : false;

const clps = PROFILES['clps-lunar-day'];
const T0 = Date.parse('2027-01-15T00:00:00Z');
const RANGE = { start: '2027-01-01T00:00:00Z', end: '2027-07-01T00:00:00Z' };

describe('planner contra la API v1 en memoria', { skip }, () => {
  let server, base, terrainDir;
  before(async () => {
    terrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-terrain-'));
    fs.cpSync(path.join(ROOT, 'backend', 'terrain', 'masks'), path.join(terrainDir, 'masks'), { recursive: true });
    process.env.LUNAR_TERRAIN_DIR = terrainDir; // before importing the engine: the catalog is loaded on import
    const { createApp } = await import('../../data/src/server.ts');
    const { configureMasks } = await import('../../backend/src/horizon.ts');
    configureMasks({ diskCache: false });
    server = createApp();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (terrainDir) fs.rmSync(terrainDir, { recursive: true, force: true });
  });

  test('las fixtures de test/fixtures siguen siendo lo que responde la API', async () => {
    for (const [site, mode] of [['apollo11', 'full'], ['im1', 'full'], ['shackleton-rim', 'full'], ['shackleton-rim', 'center']]) {
      const name = `windows-${site}-${mode}`;
      const res = await fetch(`${base}/v1/windows?site=${site}&start=2027-01-01&end=2027-07-01&mode=${mode}`);
      const fixture = JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
      assert.deepEqual(await res.json(), fixture, `${name}: regrabar como dice planner/README.md («Fixtures»)`);
    }
  });

  test('sin relieve, el borde de Shackleton es provisional y el aviso de Luna lisa sale una sola vez', async () => {
    const w = await loadWindows({ baseUrl: base, site: 'shackleton-rim', ...RANGE });
    const r = evaluate(w, clps, T0);
    assert.deepEqual(r.horizon, { model: 'sphere' });
    assert.equal(r.provisional, true);
    assert.deepEqual(r.warnings.map((x) => x.code), ['no-terrain']);
  });

  test('con relieve (máscara del catálogo) el veredicto es firme y dice las alturas', async () => {
    const w = await loadWindows({ baseUrl: base, site: 'shackleton-rim', ...RANGE, terrain: true });
    const r = evaluate(w, clps, T0);
    assert.equal(w.terrain.applied, true);
    assert.equal(w.terrain.source, 'catalog');
    assert.deepEqual(r.horizon, { model: 'mask', panelHeightM: 2, antennaHeightM: 2 });
    assert.equal(r.provisional, false);
    // Only the deep polar warning of the API (1.23.0, #437): shackleton-rim is south of 85°S. It does not make the verdict provisional.
    assert.deepEqual(r.warnings.map((x) => x.code), ['api:deep_polar_uncertainty']);
    assert.notEqual(r.verdict, VERDICT.NO_DATA);

    const alto = await loadWindows({ baseUrl: base, site: 'shackleton-rim', ...RANGE, terrain: true, panelHeightM: 2, antennaHeightM: 10 });
    assert.deepEqual(evaluate(alto, clps, T0).horizon, { model: 'mask', panelHeightM: 2, antennaHeightM: 10 });
    assert.deepEqual(alto.sun, w.sun, 'el panel sigue a 2 m: el Sol no cambia');
  });

  test('sin DEM: coordenadas libres caen a Luna lisa y la pendiente queda sin certificar', async () => {
    const w = await loadWindows({ baseUrl: base, site: { lat: -85.42, lon: 31.6 }, ...RANGE, terrain: true, maxSlopeDeg: 10 });
    assert.equal(w.terrain.applied, false);
    assert.equal(w.slope.meetsMaxSlope, null);
    const r = evaluate(w, { ...clps, rules: { ...clps.rules, R9: { active: true, threshold: 10 } } }, T0);
    assert.equal(r.provisional, true);
    assert.match(r.warnings[0].message, /Se pidió relieve, pero la API no lo aplicó/);
    assert.equal(r.rules.find((x) => x.id === 'R9').passes, null);
    assert.notEqual(r.verdict, VERDICT.VIABLE);
  });

  test('DEM grueso (API 1.12.0): la pendiente subestimada llega sin certificar (meetsMaxSlope null) y R9 no la da por buena', async () => {
    const { configureDem, makeGrid } = await import('../../backend/src/terrain/dem.ts');
    // Flat 240 m grid around the pole: 0° measured over ~720 m, not over the 100 m that R9 asks for.
    const n = 600, a = new Float32Array(n * n);
    configureDem({ grids: [makeGrid({ name: 'llano240', res: 240, X0: -72000, Y0: 72000, w: n, h: n, a })] });
    try {
      const w = await loadWindows({ baseUrl: base, site: { lat: -89.5, lon: 0 }, ...RANGE, maxSlopeDeg: 10 });
      assert.equal(w.slope.slopeDeg, 0);
      assert.equal(w.slope.underestimated, true);
      assert.equal(w.slope.source, 'dem-240m');
      assert.equal(w.slope.meetsMaxSlope, null);
      assert.match(w.slope.meetsMaxSlopeReason, /^sin certificar: la base real es de 7\d\d m/);
      const r = evaluate(w, { ...clps, rules: { ...clps.rules, R9: { active: true, threshold: 10 } } }, T0);
      assert.equal(r.rules.find((x) => x.id === 'R9').passes, null);
      assert.notEqual(r.verdict, VERDICT.VIABLE);
    } finally {
      configureDem({ grids: [] });
    }
  });

  test('los avisos de la API llegan al resultado', async () => {
    const w = await loadWindows({ baseUrl: base, site: 'apollo11', start: '2031-01-01', end: '2031-02-01' });
    const r = evaluate(w, clps, Date.parse('2031-01-05T00:00:00Z'));
    assert.ok(r.warnings.some((x) => x.code === 'api:outside_validated_dates'), JSON.stringify(r.warnings));
  });

  test('la terminal: relieve por defecto en el polo sur, sin NaN, y --json', async () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // the CLI is not a test
    const cli = (...args) => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), '--api', base, ...args], { env });

    const { stdout } = await cli('--site', 'shackleton-rim', '--date', '2027-01-15');
    assert.match(stdout, /Calculado con relieve LOLA \(panel a 2 m, antena a 2 m\)/);
    assert.doesNotMatch(stdout, /NaN|provisional/);

    const liso = await cli('--site', 'shackleton-rim', '--date', '2027-01-15', '--no-terrain');
    assert.match(liso.stdout, /Calculado con Luna lisa, sin relieve: veredicto provisional/);

    const ecuador = JSON.parse((await cli('--site', 'apollo11', '--date', '2027-01-13T12:00', '--json')).stdout);
    assert.deepEqual(ecuador.result.horizon, { model: 'sphere' }, 'lejos del polo sur no se pide relieve');
    assert.equal(ecuador.result.verdict, VERDICT.VIABLE);

    await assert.rejects(cli('--site', 'apollo11', '--date', '2027-01-13', '--no-terrain', '--panel-height', '3'), /necesitan relieve/);
  });
});
