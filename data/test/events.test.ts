// Rises and sets of the pure `windows` function against JPL Horizons (issue #13). No server and no network:
// the reference is checked in as fixtures/horizons-events.json (regenerate it with fixtures/fetch-horizons-events.ts).
//
// This is a fast slice, a different stretch of 2026–2030 for each site and mode. The whole campaign (every
// catalogue site, mode and year) is `npm run accuracy`.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BUDGET_DEG, compareEvents, eventsReference } from './accuracy.ts';
import type { UnpairedEvent } from './accuracy.ts';
import type { Body, Mode } from '../../backend/src/types.ts';

const DAY_MS = 86_400_000;
// Equatorial, far side, mid-high latitude and two polar sites; the polar ones are the only ones where the Earth
// rises and sets.
const SITES = ['apollo11', 'change4', 'chandrayaan3', 'im2-alunizaje', 'shackleton-rim'];
const MODES: Mode[] = ['limb', 'center', 'full'];
// One and a half synodic months: at least two rises and sets of the Sun away from the poles.
const SLICE_DAYS = 45;
// Spreads the 15 slices from March 2026 to mid 2030.
const SLICE_SPACING_DAYS = 110;
const FIRST_SLICE = Date.UTC(2026, 2, 1);

const describeEvent = (e: UnpairedEvent): string => `${e.type} ${e.time}`;

describe('ortos y ocasos frente a JPL Horizons', () => {
  const compared: Record<Body, Set<Mode>> = { sun: new Set(), earth: new Set() };

  SITES.forEach((siteId, i) => MODES.forEach((mode, j) => {
    const startMs = FIRST_SLICE + (i * MODES.length + j) * SLICE_SPACING_DAYS * DAY_MS;
    const endMs = startMs + SLICE_DAYS * DAY_MS;
    test(`${siteId} · ${mode} · ${SLICE_DAYS} días desde ${new Date(startMs).toISOString().slice(0, 10)}`, () => {
      assert.ok(endMs < Date.parse(eventsReference.end), 'el tramo se sale de la referencia');
      const result = compareEvents(siteId, mode, startMs, endMs);
      for (const [body, { pairs, missing, extra, visibleHours }] of Object.entries(result)) {
        assert.deepEqual(missing.map(describeEvent), [], `${body}: Horizons tiene eventos que el cálculo no encuentra`);
        assert.deepEqual(extra.map(describeEvent), [], `${body}: el cálculo saca eventos que Horizons no tiene`);
        for (const p of pairs) {
          assert.ok(p.equivalentDeg <= BUDGET_DEG.max,
            `${body}: ${describeEvent(p)} se desvía ${p.errorSeconds.toFixed(0)} s, que a ${p.ratePerHour} °/h son ${p.equivalentDeg.toFixed(5)}° > ${BUDGET_DEG.max}°`);
        }
        const hoursOff = Math.abs(visibleHours.computed - visibleHours.reference);
        assert.ok(hoursOff <= visibleHours.toleranceHours,
          `${body}: ${visibleHours.computed} h visibles frente a ${visibleHours.reference.toFixed(3)} h de Horizons (tolerancia ${visibleHours.toleranceHours.toFixed(3)} h)`);
        if (pairs.length > 0) compared[body as Body].add(mode);
      }
    });
  }));

  test('los tramos comparan ortos y ocasos del Sol y de la Tierra en los tres modos', () => {
    assert.deepEqual([...compared.sun].sort(), [...MODES].sort());
    assert.deepEqual([...compared.earth].sort(), [...MODES].sort());
  });
});
