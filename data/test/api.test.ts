// Integration: real server on an ephemeral port; every response is validated against openapi.yaml.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server.ts';
import { validate } from './schema.ts';
import type { MediaType, OpenApiResponse, OpenApiSpec } from './schema.ts';
import type { V1Error, V1Rank, V1SiteList } from '../src/types.ts';

const spec = parseYaml(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as OpenApiSpec;

let server: Server, base: string;
before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** GET; `body` is the parsed JSON (typed as the route documents it) or null if the response is not JSON. */
const get = async <T = unknown>(path: string): Promise<{ status: number; headers: Headers; text: string; body: T }> => {
  const res = await fetch(base + path);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: (res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null) as T };
};

/** Documented response schema for (route, status), resolving `$ref` to components/responses. */
function responseSchema(route: string, status: number): MediaType {
  let r = spec.paths[route]?.get?.responses?.[String(status)];
  assert.ok(r, `openapi.yaml no documenta ${status} en ${route}`);
  if (r.$ref) r = r.$ref.slice(2).split('/').reduce((n: unknown, k) => (n as Record<string, unknown>)[k], spec) as OpenApiResponse;
  return r.content['application/json'];
}

const assertConforms = (route: string, status: number, body: unknown): void => {
  const errors = validate(spec, responseSchema(route, status).schema, body);
  assert.deepEqual(errors, [], `La respuesta de ${route} (${status}) no cumple el esquema:\n${errors.join('\n')}`);
};

const OK = [
  '/v1/health',
  '/v1/sites',
  '/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z',
  '/v1/sun-earth?lat=-89.5&lon=0&date=2027-01-15&mode=center',
  '/v1/sun-earth?lat=10&lon=350&heightKm=2&date=2027-01-15T12:00:00%2B02:00&mode=full',
  '/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&mode=center',
  '/v1/windows?lat=0&lon=0&start=2027-01-01',
  '/v1/rank?sites=all&start=2027-01-01&days=10',
  '/v1/rank?sites=apollo11,-89.5:0&start=2027-01-01&days=5&mode=full',
  // terrain=1: here (node --test) no terrain is available -> spherical horizon, explained in `terrain` (see terrain.test.ts)
  '/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z&terrain=1',
  '/v1/windows?lat=-89.5&lon=0&start=2027-01-01&end=2027-01-10&terrain=true&observerHeightM=10',
  '/v1/rank?sites=shackleton-rim,apollo11&start=2027-01-01&days=5&terrain=1',
  '/v1/track?site=shackleton-rim&start=2027-01-01&end=2027-01-03',
  '/v1/track?lat=-89.5&lon=0&start=2027-01-01&end=2027-01-02&step=30m&terrain=1',
  '/v1/horizon?site=shackleton-rim',
  '/v1/best-landings?sites=shackleton-rim,im1,-89.5:0&start=2027-10-01&end=2027-10-05&days=5',
  '/v1/best-landings?sites=shackleton-rim&start=2027-10-01T00:00:00Z&end=2027-10-03T00:00:00Z&days=3&batteryHours=24&minEarthPct=40&maxEarthGapHours=48&priority=delays&terrain=1',
  '/v1/light-map?radiusKm=20&spacingKm=10&start=2027-10-11T12:00:00Z&days=2',
  '/v1/light-map?site=shackleton-rim&radiusKm=2&spacingKm=1&start=2027-10-11&days=1&mode=full&observerHeightM=10',
  '/v1/horizon?lat=10&lon=20&observerHeightM=10',
  '/v1/landing-dates?site=im1&start=2027-01-01&end=2027-03-01',
  '/v1/landing-dates?lat=-65.31485&lon=-3.05572&start=2027-01-01&end=2027-02-01&dateStep=12h&days=10&minMeanSunDiskFraction=0.8&fullNight=1&battery=1&panel=vertical-rotating&terrain=1',
  '/v1/search?region=polo-sur&spacingKm=20&refineLevels=1&refineTop=3&top=2&start=2027-01-01&days=10',
  '/v1/search?latMin=-89.6&latMax=-89.3&lonMin=-180&lonMax=180&spacingKm=8&refineLevels=0&start=2027-01-01&days=3&terrain=1&fullNight=1&battery=1&panel=horizontal',
  // Since 1.15.0: what the old internal API /api/* offered.
  '/v1/regions',
  '/v1/windows?site=apollo11&start=2027-01-01&end=2027-01-20&events=1',
  '/v1/rank?sites=apollo11,shackleton-rim&start=2027-01-01&days=5&step=30m&earthMode=center&weightShortNights=10&weightSunAndEarthTimeFraction=20',
  '/v1/landing-dates?site=im1&start=2027-01-01&end=2027-01-10&earthMode=full&weightShortEarthOutages=1',
  '/v1/search?region=polo-sur&spacingKm=40&refineLevels=1&top=3&start=2027-01-01&days=5&cells=1&slope=1&maxSlopeDeg=10&step=3h&earthMode=center',
];

describe('200 y conformidad con el esquema', () => {
  for (const path of OK) {
    test(path, async () => {
      const r = await get(path);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.headers.get('access-control-allow-origin'), '*');
      assertConforms(new URL(path, base).pathname, 200, r.body);
    });
  }

  test('todas las rutas de la especificación están cubiertas', () => {
    const covered = new Set(OK.map((p) => p.split('?')[0]));
    // The asynchronous jobs of /v1/search (POST and GET by id) are covered in search.test.ts.
    assert.deepEqual(Object.keys(spec.paths).filter((p) => !covered.has(p) && !p.startsWith('/v1/search/jobs')), []);
  });
});

const BAD = [
  ['/v1/sun-earth', '/v1/sun-earth'], // neither site nor lat/lon
  ['/v1/sun-earth?lat=100&lon=0', '/v1/sun-earth'],
  ['/v1/sun-earth?lat=abc&lon=0', '/v1/sun-earth'],
  ['/v1/sun-earth?site=apollo11&mode=half', '/v1/sun-earth'],
  ['/v1/sun-earth?site=apollo11&date=ayer', '/v1/sun-earth'],
  ['/v1/windows?site=apollo11&start=2027-02-01&end=2027-01-01', '/v1/windows'],
  ['/v1/windows?site=apollo11&start=2027-01-01&end=2029-01-01', '/v1/windows'],
  ['/v1/rank?days=0', '/v1/rank'],
  ['/v1/rank?days=500', '/v1/rank'],
  ['/v1/rank?sites=' + Array(11).fill('apollo11').join(','), '/v1/rank'],
  ['/v1/sun-earth?site=apollo11&terrain=si', '/v1/sun-earth'],
  ['/v1/windows?site=apollo11&terrain=1&observerHeightM=500', '/v1/windows'],
  ['/v1/rank?sites=apollo11&terrain=1&observerHeightM=-1', '/v1/rank'],
  ['/v1/landing-dates', '/v1/landing-dates'], // neither site nor lat/lon
  ['/v1/landing-dates?site=apollo11&start=2027-01-01&end=2028-03-01', '/v1/landing-dates'],
  ['/v1/landing-dates?site=apollo11&dateStep=10m', '/v1/landing-dates'],
  ['/v1/landing-dates?site=apollo11&days=0.3', '/v1/landing-dates'],
];

describe('400 con parámetros malos', () => {
  for (const [path, route] of BAD) {
    test(path, async () => {
      const r = await get<V1Error>(path);
      assert.equal(r.status, 400, r.text);
      assert.equal(r.body.error.code, 'invalid_parameter');
      assertConforms(route, 400, r.body);
    });
  }
});

describe('404', () => {
  for (const [path, route] of [
    ['/v1/sun-earth?site=atlantis', '/v1/sun-earth'],
    ['/v1/windows?site=atlantis', '/v1/windows'],
    ['/v1/rank?sites=apollo11,atlantis', '/v1/rank'],
    ['/v1/landing-dates?site=atlantis', '/v1/landing-dates'],
  ]) {
    test(`sitio desconocido: ${path}`, async () => {
      const r = await get<V1Error>(path);
      assert.equal(r.status, 404, r.text);
      assert.equal(r.body.error.code, 'not_found');
      assert.match(r.body.error.message, /atlantis/);
      assertConforms(route, 404, r.body);
    });
  }

  test('ruta desconocida', async () => {
    const r = await get('/v1/nope');
    assert.equal(r.status, 404);
    assert.deepEqual(validate(spec, spec.components.schemas.Error, r.body), []);
  });
});

describe('especificación y documentación', () => {
  test('/openapi.yaml sirve el fichero tal cual', async () => {
    const r = await get('/openapi.yaml');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /yaml/);
    assert.equal(r.text, readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
  });

  test('/openapi.json es la misma especificación', async () => {
    const r = await get<OpenApiSpec>('/openapi.json');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, spec);
    assert.equal(r.body.openapi, '3.1.0');
  });

  test('/docs carga Swagger UI con versión fijada y apunta a /openapi.yaml', async () => {
    const r = await get('/docs');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/html/);
    assert.match(r.text, /cdn\.jsdelivr\.net\/npm\/swagger-ui-dist@\d+\.\d+\.\d+\/swagger-ui-bundle\.js/);
    assert.match(r.text, /url: '\/openapi\.yaml'/);
  });

  test('preflight CORS', async () => {
    const res = await fetch(base + '/v1/sites', { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});

describe('los ejemplos de openapi.yaml son reales', () => {
  // `example` or, if there are several, `examples.<name>.value` (the first one is the default, without terrain).
  const examples = (route: string): unknown[] => {
    const c = responseSchema(route, 200);
    return c.examples ? Object.values(c.examples).map((e) => e.value) : [c.example];
  };
  const example = (route: string): unknown => examples(route)[0];

  // Each route's response examples must satisfy its own schema.
  for (const route of Object.keys(spec.paths).filter((r) => spec.paths[r].get)) {
    test(`los ejemplos de ${route} cumplen el esquema`, () => { for (const e of examples(route)) assertConforms(route, 200, e); });
  }

  test('sun-earth: el ejemplo sin relieve coincide con la respuesta real', async () => {
    const r = await get('/v1/sun-earth?site=shackleton-rim&date=2027-01-15T00:00:00Z');
    assert.deepEqual(r.body, example('/v1/sun-earth'));
  });

  test('windows: el ejemplo coincide con la respuesta real', async () => {
    const r = await get('/v1/windows?site=shackleton-rim&start=2027-01-01&end=2027-03-01&mode=center');
    assert.deepEqual(r.body, example('/v1/windows'));
  });

  test('rank: el ejemplo coincide con la respuesta real (recortado a los 2 primeros)', async () => {
    const r = await get<V1Rank>('/v1/rank?sites=all&start=2027-01-01&days=30');
    assert.deepEqual({ ...r.body, results: r.body.results.slice(0, 2) }, example('/v1/rank'));
  });

  test('search: el ejemplo coincide con la respuesta real', async () => {
    const r = await get('/v1/search?region=polo-sur&spacingKm=20&refineLevels=1&refineTop=3&top=2&start=2027-01-01&days=10');
    assert.deepEqual(r.body, example('/v1/search'));
  });

  test('sites: los sitios del ejemplo están en el catálogo real', async () => {
    const r = await get<V1SiteList>('/v1/sites');
    const documented = example('/v1/sites') as V1SiteList;
    for (const s of documented.sites) assert.deepEqual(r.body.sites.find((x) => x.id === s.id), s);
    assert.equal(r.body.count, documented.count);
  });
});

describe('validador de esquemas', () => {
  const Body = spec.components.schemas.SunEarth;
  test('detecta campos que faltan, tipos erróneos y campos no documentados', () => {
    const errs = validate(spec, Body, { site: {}, date: 3, extra: true });
    assert.ok(errs.some((e) => /falta el campo obligatorio mode/.test(e)));
    assert.ok(errs.some((e) => /\$\.date: se esperaba string/.test(e)));
    assert.ok(errs.some((e) => /no documentado extra/.test(e)));
    assert.ok(errs.some((e) => /\$\.site: falta el campo obligatorio latDeg/.test(e)));
  });
});
