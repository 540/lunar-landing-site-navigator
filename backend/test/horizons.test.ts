// Precision against JPL Horizons (test/fixtures/horizons.json, generated with `npm run fixture`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BODIES, moonFixedVectors, siteFrame, topocentric } from '../src/ephemeris.ts';
import { windows } from '../src/service.ts';
import type { Body } from '../src/types.ts';

/** test/fixtures/horizons.json (scripts/fetch-horizons-fixture.ts): az/el of each body every stepMinutes. */
interface HorizonsFixture {
  start: string;
  stepMinutes: number;
  count: number;
  sites: ({ id: string; lat: number; lon: number } & Record<Body, { az: number[]; el: number[] }>)[];

}

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/horizons.json', import.meta.url), 'utf8')) as HorizonsFixture;
const start = Date.parse(fixture.start);
const stepMs = fixture.stepMinutes * 60e3;
const end = start + (fixture.count - 1) * stepMs;
const DEG = Math.PI / 180;

const unit = (az: number, el: number): number[] => [Math.cos(el * DEG) * Math.sin(az * DEG), Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG)];
const separation = (a: { az: number; el: number }, b: { az: number; el: number }): number => {
  const u = unit(a.az, a.el), v = unit(b.az, b.el);
  const c = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const x = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
  return Math.atan2(x, c) / DEG;
};

// Lunar vectors computed once for every instant of the fixture.
const vecs = Array.from({ length: fixture.count }, (_, i) => moonFixedVectors(new Date(start + i * stepMs)));

for (const site of fixture.sites) {
  for (const body of BODIES) {
    test(`precisión ${site.id}/${body} frente a Horizons`, () => {
      const frame = siteFrame(site);
      const ref = site[body];
      let maxEl = 0, maxSep = 0;
      for (let i = 0; i < fixture.count; i++) {
        const p = topocentric(frame, vecs[i][body], body);
        maxEl = Math.max(maxEl, Math.abs(p.el - ref.el[i]));
        maxSep = Math.max(maxSep, separation(p, { az: ref.az[i], el: ref.el[i] }));
      }
      console.log(`# ${site.id}/${body}: error máx. elevación ${maxEl.toFixed(5)}°, separación máx. ${maxSep.toFixed(5)}°`);
      assert.ok(maxEl < 0.005, `error de elevación ${maxEl}° >= 0.005°`);
      assert.ok(maxSep < 0.005, `separación ${maxSep}° >= 0.005°`);
    });
  }
}

/** Zero crossings of the fixture elevation, linearly interpolated. */
function referenceCrossings(el: number[]): { type: 'rise' | 'set'; time: number }[] {
  const out: { type: 'rise' | 'set'; time: number }[] = [];
  for (let i = 1; i < el.length; i++) {
    if ((el[i - 1] > 0) !== (el[i] > 0)) {
      const f = el[i - 1] / (el[i - 1] - el[i]);
      out.push({ type: el[i] > 0 ? 'rise' : 'set', time: start + (i - 1 + f) * stepMs });
    }
  }
  return out;
}

for (const site of fixture.sites) {
  test(`ortos y ocasos (modo center) de ${site.id} frente a Horizons`, () => {
    const w = windows({ name: site.id, ...site }, start, end, { mode: 'center', stepMs: 15 * 60e3 }); // the fixture sites have no name
    for (const body of BODIES) {
      const ref = referenceCrossings(site[body].el);
      const ours = w[body].events.map((e) => ({ type: e.type, time: Date.parse(e.time) }));
      assert.equal(ours.length, ref.length, `${body}: ${ours.length} eventos frente a ${ref.length} en Horizons`);
      let maxMin = 0;
      ref.forEach((r, i) => {
        assert.equal(ours[i].type, r.type);
        maxMin = Math.max(maxMin, Math.abs(ours[i].time - r.time) / 60e3);
      });
      console.log(`# ${site.id}/${body}: ${ref.length} eventos, desfase máx. ${maxMin.toFixed(2)} min`);
      assert.ok(maxMin < 10, `${body}: desfase ${maxMin} min >= 10 min`);
    }
  });
}
