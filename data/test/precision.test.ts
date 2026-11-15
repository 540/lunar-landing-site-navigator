// Accuracy of the pure ephemeris functions against JPL Horizons (issue #2). No server and no network:
// the reference is checked in as fixtures/horizons.json (regenerate it with fixtures/fetch-horizons.ts).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { positionsAt } from '../../backend/src/ephemeris.ts';
import { BUDGET_DEG, directionErrors, directionReference as ref, directionSite as siteOf, instantOf as instant } from './accuracy.ts';
import type { DirectionSeries } from './accuracy.ts';
import type { Body } from '../../backend/src/types.ts';

// Budget, in km, for the difference in distance between two observers at the same instant.
// Same vertical at 0 and 12 km: measured 0.001 km (ignoring the height gives 12 km).
// Near side against far side: measured 0.36 km (a lunar radius 0.7 km too large gives 1.6 km).
const BUDGET_PARALLAX_KM = { height: 0.05, radius: 0.6 };

describe('dirección del Sol y de la Tierra frente a JPL Horizons', () => {
  test('la referencia cubre 2026–2030 con miles de instantes por serie', () => {
    assert.equal(ref.start, '2026-01-01T00:00:00Z');
    assert.ok(instant(ref.count - 1) >= new Date('2030-12-01T00:00:00Z'));
    assert.ok(ref.count >= 2000);
    for (const s of ref.series) for (const k of ['az', 'el', 'distKm'] as const) assert.equal(s[k].length, ref.count, `${s.site}/${s.body}/${k}`);
  });

  for (const s of ref.series) {
    test(`${s.site} · ${s.body}: cada punto dentro del presupuesto`, () => {
      const { maxDeg, rmsDeg, worst } = directionErrors(s);
      assert.ok(maxDeg <= BUDGET_DEG.max,
        `peor punto ${maxDeg.toFixed(5)}° > ${BUDGET_DEG.max}° en ${worst.date}: az/el ${worst.got} frente a ${worst.want} de Horizons`);
      assert.ok(rmsDeg <= BUDGET_DEG.rms, `media cuadrática ${rmsDeg.toFixed(5)}° > ${BUDGET_DEG.rms}°`);
    });
  }
});

// The model's direction error (~0.005°) hides what a few km of observer position move (≤ 0.002°). The difference in
// distance between two observers at the same instant cancels that common error and exposes the site geometry.
describe('geometría del observador frente a JPL Horizons', () => {
  const series = (site: string, body: Body): DirectionSeries => ref.series.find((s) => s.site === site && s.body === body)!;

  /** Worst disagreement, in km, of (distance from a − distance from b) between the computation and Horizons. */
  function worstParallaxErrorKm(a: string, b: string, body: Body): number {
    const ra = series(a, body), rb = series(b, body);
    let worst = 0;
    for (let i = 0; i < ref.count; i++) {
      const got = positionsAt(siteOf(a), instant(i))[body].distKm - positionsAt(siteOf(b), instant(i))[body].distKm;
      worst = Math.max(worst, Math.abs(got - (ra.distKm[i] - rb.distKm[i])));
    }
    return worst;
  }

  test('la altura del sitio acerca o aleja al observador lo que dice Horizons', () => {
    const err = worstParallaxErrorKm('equator-12km', 'equator', 'earth');
    assert.ok(err <= BUDGET_PARALLAX_KM.height, `${err.toFixed(3)} km > ${BUDGET_PARALLAX_KM.height} km`);
  });

  test('el radio lunar separa a dos observadores lo que dice Horizons', () => {
    const err = worstParallaxErrorKm('equator', 'far-side', 'earth');
    assert.ok(err <= BUDGET_PARALLAX_KM.radius, `${err.toFixed(3)} km > ${BUDGET_PARALLAX_KM.radius} km`);
  });
});
