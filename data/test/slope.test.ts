// Terrain slope (1.7.0): slope, slopeBaselineM and maxSlopeDeg in /v1/sun-earth, /v1/windows, /v1/rank and
// /v1/landing-dates. Without them the v1 contract does not change byte for byte (hashes of 1.4.0, also with a DEM loaded).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.ts';
import { API_VERSION } from '../src/v1.ts';
import { configureDem, llToXY, makeGrid } from '../../backend/src/terrain/dem.ts';
import { validate } from './schema.ts';
import { legacyText } from './contract.ts';
import type { MediaType, OpenApiSpec } from './schema.ts';
import type { V1Error, V1Health, V1LandingDates, V1Rank, V1SunEarth, V1Windows } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const spec = parseYaml(fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;
const content = (route: string): MediaType => spec.paths[route].get!.responses!['200'].content['application/json'];
const D2R = Math.PI / 180;

let server: Server, base: string;
before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  configureDem({ dir: null });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = async <T = unknown>(p: string): Promise<{ status: number; text: string; body: T }> => {
  const res = await fetch(base + p);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as T };
};
const assertConforms = (route: string, body: unknown): void => {
  const errors = validate(spec, content(route).schema, body);
  assert.deepEqual(errors, [], `La respuesta de ${route} no cumple el esquema:\n${errors.join('\n')}`);
};

/** Cone of 20° flanks and 3 km radius centred at (−89.5, 0) on a 20 m grid; flat elsewhere. */
function hill() {
  const [cx, cy] = llToXY(-89.5, 0);
  const res = 20, half = 40000, n = Math.round((2 * half) / res), a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + (i + 0.5) * res, y = half - (j + 0.5) * res;
    a[j * n + i] = Math.max(0, 3000 - Math.hypot(x - cx, y - cy)) * Math.tan(20 * D2R);
  }
  return makeGrid({ name: 'cerro', res, X0: -half, Y0: half, w: n, h: n, a });
}

describe('contrato: sin los parámetros de pendiente la respuesta no cambia, aunque haya DEM', () => {
  const hashes = JSON.parse(fs.readFileSync(new URL('./fixtures/v1-contract-1.4.0.json', import.meta.url), 'utf8')) as Record<string, string>;
  for (const [p, hash] of Object.entries(hashes)) {
    // terrain=1 and /v1/horizon (always with terrain) depend on the DEM loaded, here a synthetic one.
    if (p.includes('terrain=1') || p.startsWith('/v1/horizon')) continue;
    test(p, async () => {
      configureDem({ grids: [hill()] });
      const r = await get(p);
      assert.equal(r.status, 200);
      assert.equal(createHash('sha256').update(legacyText(p, r.text)).digest('hex'), hash, 'la respuesta ha cambiado byte a byte');
    });
  }
  test('health anuncia la versión de openapi.yaml', async () => {
    const r = await get<V1Health>('/v1/health');
    assert.equal(r.body.apiVersion, API_VERSION);
    assert.equal((spec as unknown as { info: { version: string } }).info.version, API_VERSION);
  });
});

describe('pendiente', () => {
  test('/v1/sun-earth y /v1/windows con slope=1: pendiente del sitio, conforme al esquema', async () => {
    configureDem({ grids: [hill()] });
    const flank = await get<V1SunEarth>('/v1/sun-earth?lat=-89.45&lon=0&date=2027-01-15&slope=1&maxSlopeDeg=10');
    assert.equal(flank.status, 200, flank.text);
    assertConforms('/v1/sun-earth', flank.body);
    const s = flank.body.slope!;
    assert.ok(Math.abs(s.slopeDeg! - 20) < 0.1, `${s.slopeDeg}`);
    assert.equal(s.slopeBaselineM, 100);
    assert.equal(s.demResolutionM, 20);
    assert.equal(s.underestimated, false);
    assert.equal(s.source, 'dem-20m');
    assert.equal(s.meetsMaxSlope, false);
    assert.ok(!('meetsMaxSlopeReason' in s));
    assert.match(s.note, /Artemis III/);
    const w = await get<V1Windows>('/v1/windows?lat=-89.3&lon=0&start=2027-01-01&end=2027-01-03&slope=1&slopeBaselineM=10');
    assertConforms('/v1/windows', w.body);
    assert.equal(w.body.slope!.slopeDeg, 0);
    assert.equal(w.body.slope!.underestimated, true, 'el DEM de 20 m no resuelve 10 m');
    assert.equal(w.body.slope!.slopeBaselineM, 60);
    assert.match(w.body.slope!.note, /subestimada/);
    // 1.12.0: uncertified (underestimated) is never apt, whatever the value: meetsMaxSlope null with the reason.
    const u = await get<V1Windows>('/v1/windows?lat=-89.3&lon=0&start=2027-01-01&end=2027-01-03&slopeBaselineM=10&maxSlopeDeg=10');
    assertConforms('/v1/windows', u.body);
    assert.equal(u.body.slope!.slopeDeg, 0);
    assert.equal(u.body.slope!.meetsMaxSlope, null);
    assert.equal(u.body.slope!.meetsMaxSlopeReason, 'sin certificar: la base real es de 60 m (se pidieron 10 m)');
  });

  test('/v1/landing-dates con slope=1: pendiente del sitio; las fechas no cambian', async () => {
    configureDem({ grids: [hill()] });
    const q = '/v1/landing-dates?lat=-89.45&lon=0&start=2027-01-01&end=2027-01-03&days=2';
    const plain = await get<V1LandingDates>(q), withSlope = await get<V1LandingDates>(`${q}&slope=1`);
    assertConforms('/v1/landing-dates', withSlope.body);
    assert.ok(!('slope' in plain.body));
    assert.ok(Math.abs(withSlope.body.slope!.slopeDeg! - 20) < 0.1);
    const { slope: _s, ...rest } = withSlope.body;
    assert.deepEqual(rest, plain.body);
  });

  test('/v1/rank con maxSlopeDeg: saca las laderas del ranking y las lista; la puntuación no cambia', async () => {
    configureDem({ grids: [hill()] });
    const q = '/v1/rank?sites=-89.45:0,-89.3:0,apollo11&start=2027-01-01&days=3';
    const plain = await get<V1Rank>(q), r = await get<V1Rank>(`${q}&maxSlopeDeg=10`);
    assert.equal(r.status, 200, r.text);
    assertConforms('/v1/rank', r.body);
    assert.deepEqual(r.body.results.map((c) => c.siteId), ['custom:-89.3,0']);
    assert.deepEqual(r.body.slope!.excludedSiteIds!.sort(), ['apollo11', 'custom:-89.45,0']);
    assert.equal(r.body.slope!.maxSlopeDeg, 10);
    assert.match(r.body.slope!.note, /fuera del DEM/);
    const same = plain.body.results.find((c) => c.siteId === 'custom:-89.3,0')!;
    const { slope, rank: _r, ...kept } = r.body.results[0];
    assert.deepEqual(kept, (({ rank: _x, ...c }) => c)(same));
    assert.equal(slope!.slopeDeg, 0);
    const all = await get<V1Rank>(`${q}&slope=1`);
    assert.equal(all.body.results.length, 3);
    assert.ok(!('excludedSiteIds' in all.body.slope!));
    assert.equal(all.body.results.find((c) => c.siteId === 'apollo11')!.slope!.slopeDeg, null);
    // since 1.9.0: each excluded site with its reason and slope
    assert.deepEqual([...r.body.slope!.excluded!].sort((a, b) => a.siteId.localeCompare(b.siteId)).map((e) => [e.siteId, e.reason, e.slopeDeg === null ? null : Math.round(e.slopeDeg)]),
      [['apollo11', 'slopeUnknown', null], ['custom:-89.45,0', 'slopeAboveMax', 20]]);
    assert.equal(r.body.slope!.uncertified, 'exclude');
  });

  test('1.12.0: /v1/rank saca las pendientes sin certificar (slopeUncertified=exclude) o las marca (keep)', async () => {
    configureDem({ grids: [hill()] });
    // slopeBaselineM=10: the 20 m DEM does not resolve it (base 60 m) -> every slope is uncertified, even the flat one.
    const q = '/v1/rank?sites=-89.45:0,-89.3:0,apollo11&start=2027-01-01&days=3&slopeBaselineM=10&maxSlopeDeg=10';
    const ex = await get<V1Rank>(q);
    assertConforms('/v1/rank', ex.body);
    assert.deepEqual(ex.body.results, []);
    assert.equal(ex.body.slope!.uncertified, 'exclude');
    assert.deepEqual([...ex.body.slope!.excluded!].sort((a, b) => a.siteId.localeCompare(b.siteId)).map((e) => [e.siteId, e.reason]),
      [['apollo11', 'slopeUnknown'], ['custom:-89.3,0', 'slopeUncertified'], ['custom:-89.45,0', 'slopeUncertified']]);
    const keep = await get<V1Rank>(`${q}&slopeUncertified=keep`);
    assertConforms('/v1/rank', keep.body);
    assert.equal(keep.body.slope!.uncertified, 'keep');
    assert.deepEqual(keep.body.results.map((c) => c.siteId).sort(), ['custom:-89.3,0', 'custom:-89.45,0']);
    for (const c of keep.body.results) {
      assert.equal(c.slope!.meetsMaxSlope, null);
      assert.match(c.slope!.meetsMaxSlopeReason!, /^sin certificar: la base real es de 60 m \(se pidieron 10 m\)/);
    }
    assert.match(keep.body.results.find((c) => c.siteId === 'custom:-89.45,0')!.slope!.meetsMaxSlopeReason!, /ya en esa base supera 10°$/);
    assert.deepEqual(keep.body.slope!.excludedSiteIds, ['apollo11']);
    // Without maxSlopeDeg it is ignored (warning); a bad value is a 400.
    const ignored = await get<V1Rank>('/v1/rank?sites=-89.3:0&start=2027-01-01&days=1&slope=1&slopeUncertified=keep');
    assert.deepEqual(ignored.body.warnings!.map((w) => [w.code, w.parameter]), [['ignored_parameter', 'slopeUncertified']]);
    const bad = await get<V1Error>(`${q}&slopeUncertified=quizá`);
    assert.equal(bad.status, 400);
    assert.match(bad.body.error.message, /slopeUncertified debe ser exclude o keep/);
    // Site endpoints: it is not their parameter.
    const site = await get<V1SunEarth>('/v1/sun-earth?lat=-89.3&lon=0&date=2027-01-15&maxSlopeDeg=10&slopeUncertified=keep');
    assert.equal(site.body.warnings![0].code, 'unused_parameter');
  });

  test('1.9.0: meetsMaxSlope es null (no false) sin pendiente conocida', async () => {
    configureDem({ grids: [hill()] });
    for (const p of ['/v1/sun-earth?site=apollo11&date=2027-01-15&maxSlopeDeg=10', '/v1/windows?site=apollo11&start=2027-01-01&end=2027-01-02&maxSlopeDeg=10',
      '/v1/landing-dates?site=apollo11&start=2027-01-01&end=2027-01-02&maxSlopeDeg=10']) {
      const r = await get<{ slope: V1SunEarth['slope'] }>(p);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.slope!.slopeDeg, null, p);
      assert.equal(r.body.slope!.meetsMaxSlope, null, p);
    }
    const ok = await get<V1SunEarth>('/v1/sun-earth?lat=-89.3&lon=0&date=2027-01-15&maxSlopeDeg=10');
    assert.equal(ok.body.slope!.meetsMaxSlope, true);
  });

  test('1.9.0: /v1/rank calcula la pendiente con las coordenadas exactas, no con las redondeadas de la respuesta', async () => {
    configureDem({ grids: [hill()] });
    // On the cone flank the slope is constant, so use its edge (3 km from the top), where the ~1 m of rounding to 4
    // decimals matters: 10.27° at the exact point, 10.61° at the rounded one.
    const lat = -89.40106499, lon = 0;
    const site = await get<V1SunEarth>(`/v1/sun-earth?lat=${lat}&lon=${lon}&date=2027-01-15&slope=1`);
    const rank = await get<V1Rank>(`/v1/rank?sites=${lat}:${lon}&start=2027-01-01&days=1&slope=1`);
    assert.equal(rank.body.results[0].latDeg, Math.round(lat * 1e4) / 1e4);
    const { note: _n, ...siteSlope } = site.body.slope!;
    assert.deepEqual(rank.body.results[0].slope, siteSlope);
    assert.equal(siteSlope.slopeDeg, 10.27);
  });

  test('1.9.0: la pendiente se valida antes de calcular', async () => {
    // A request that would take long (366 days of windows) answers the bad maxSlopeDeg at once.
    const t0 = performance.now();
    const r = await get<V1Error>('/v1/windows?site=apollo11&start=2027-01-01&end=2028-01-01&fullNight=1&battery=1&maxSlopeDeg=91');
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /maxSlopeDeg/);
    assert.ok(performance.now() - t0 < 200, `${performance.now() - t0} ms`);
  });

  test('validación con mensajes en español', async () => {
    for (const [p, msg] of [
      ['/v1/rank?sites=all&maxSlopeDeg=100', /maxSlopeDeg debe ser un número entre 0 y 90/],
      ['/v1/sun-earth?site=im1&slopeBaselineM=0', /slopeBaselineM debe ser un número entre 1 y 5000/],
      ['/v1/windows?site=im1&slope=quizá', /slope debe ser 1, true, 0 o false/],
      ['/v1/landing-dates?site=im1&maxSlopeDeg=abc', /maxSlopeDeg debe ser un número decimal/],
    ] as const) {
      const r = await get<V1Error>(p);
      assert.equal(r.status, 400, p);
      assert.equal(r.body.error.code, 'invalid_parameter');
      assert.match(r.body.error.message, msg);
    }
  });
});

// Real LOLA DEM (backend/terrain/cache, outside git): the v3 winner does not meet Artemis III; (−60.75, −7.2881) does.
const REAL = path.join(HERE, '..', '..', 'backend', 'terrain');
const hasRealDem = fs.existsSync(path.join(REAL, 'cache')) && fs.readdirSync(path.join(REAL, 'cache')).some((f) => f.startsWith('LDEM_60S_240MPP'));
test('DEM real: maxSlopeDeg=10 no da por apto ningún sitio del benchmark v3 (240 m: sin certificar)', { skip: hasRealDem ? false : 'sin DEM LOLA en backend/terrain/cache' }, async () => {
  configureDem({ dir: REAL });
  const q = '/v1/rank?sites=-65.31485:-3.05572,-72.4792:-5.64746,-60.75:-7.2881&start=2027-01-10&days=14&maxSlopeDeg=10';
  const r = await get<V1Rank>(q);
  assertConforms('/v1/rank', r.body);
  // Up to 1.11.0 the flat one (−60.75, −7.2881) passed with 3.7° measured over ~670 m: uncertified since 1.12.0.
  assert.deepEqual(r.body.results, []);
  assert.deepEqual(r.body.slope!.excluded!.map((e) => [e.siteId, e.reason]),
    [['custom:-65.31485,-3.05572', 'slopeUncertified'], ['custom:-72.4792,-5.64746', 'slopeUncertified'], ['custom:-60.75,-7.2881', 'slopeUncertified']]);
  assert.match(r.body.slope!.note, /subestimada/);
  const keep = await get<V1Rank>(`${q}&slopeUncertified=keep`);
  const flat = keep.body.results.find((c) => c.siteId === 'custom:-60.75,-7.2881')!;
  assert.equal(flat.slope!.demResolutionM, 240);
  assert.equal(flat.slope!.source, 'dem-240m');
  assert.equal(flat.slope!.underestimated, true);
  assert.equal(flat.slope!.meetsMaxSlope, null);
  assert.match(flat.slope!.meetsMaxSlopeReason!, /^sin certificar: la base real es de 6\d\d m \(se pidieron 100 m\)$/);
});
