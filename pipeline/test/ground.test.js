// The 5 m ground of the Mirador (pipeline/ground.mjs): it reproduces the site DEM it reads, and adds nothing where the DEM
// does not cover the square whole. A synthetic GeoTIFF stands in for PGDA (no network in the tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { buildGround, GROUND_LEVEL } from '../ground.mjs';
import { llToXY } from '../../backend/src/terrain/dem.ts';
import { decodeGrid } from '../../viewpoint/src/core/relief.js';

const META = { center: { lat: -89.44027, lon: -137.12649 } };
const [CX, CY] = llToXY(META.center.lat, META.center.lon);
const plane = (x, y) => 1950 + 0.02 * (x - CX) - 0.01 * (y - CY); // m

/** A synthetic 5 m site DEM: a square of `sideM` round (cx, cy), pixel values from fn, with an optional hole. */
function fakeSite({ cx = CX, cy = CY, sideM = 6000, fn = plane, hole = null } = {}) {
  const res = 5, w = Math.round(sideM / res), h = w, x0 = cx - sideM / 2, y1 = cy + sideM / 2;
  const nodata = -3.4028234663852886e38;
  return {
    site: 'SiteXX', x0, y0: y1 - sideM, x1: x0 + sideM, y1, res, width: w, height: h, nodata,
    image: {
      async readRasters({ window: [c0, r0, c1, r1] }) {
        const out = new Float32Array((c1 - c0) * (r1 - r0));
        for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
          const x = x0 + (c + 0.5) * res, y = y1 - (r + 0.5) * res;
          out[(r - r0) * (c1 - c0) + (c - c0)] = hole && Math.hypot(x - hole.x, y - hole.y) < hole.r ? nodata : fn(x, y);
        }
        return [out];
      },
    },
  };
}
const opener = site => async (_name, kind = 'surf') => (kind === 'ldec' ? { ...site, image: { readRasters: async ({ window: [c0, r0, c1, r1] }) => [new Float32Array((c1 - c0) * (r1 - r0)).map((_, k) => (k % 10 === 0 ? 1 : 0))] } } : site);

test('ground: reproduces the site DEM on the 513 × 513 grid of 4.88 m, with the curvature of the scene', async () => {
  const g = await buildGround(META, { sites: ['SiteXX'], open: opener(fakeSite()) });
  assert.ok(g);
  assert.equal(g.meta.grid.cols, GROUND_LEVEL.size);
  assert.equal(g.meta.extentKm, GROUND_LEVEL.extentKm);
  const h = decodeGrid(g.meta, new Uint8Array(gunzipSync(g.bin)));
  const mid = (GROUND_LEVEL.size - 1) / 2;
  assert.ok(Math.abs(h[mid * GROUND_LEVEL.size + mid] * 1000 - 1950) < 0.01, 'the centre of the plane, to the centimetre');
  assert.ok(Math.abs(g.meta.measured - 0.1) < 0.01, 'one pixel in ten with a shot');
  assert.deepEqual(g.meta.products, ['LOLA_5MPP_SiteXX@5m']);
  assert.match(g.meta.citation, /Barker et al\. 2021/);
});

test('ground: nothing where the DEM does not cover the whole square, nor where it has a hole of no data', async () => {
  const far = fakeSite({ cx: CX + 50_000 });
  assert.equal(await buildGround(META, { sites: ['SiteXX'], open: opener(far) }), null);
  const small = fakeSite({ sideM: 1500 });
  assert.equal(await buildGround(META, { sites: ['SiteXX'], open: opener(small) }), null);
  const holed = fakeSite({ hole: { x: CX + 300, y: CY - 200, r: 40 } });
  assert.equal(await buildGround(META, { sites: ['SiteXX'], open: opener(holed) }), null);
});
