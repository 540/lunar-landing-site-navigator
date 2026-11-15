// Control cases (#102, AC-21 to AC-23 of the external discovery): checks an expert runs first, because their answer is
// known without any software. Each one runs with the real engine (the data API on an ephemeral port, through the web's
// API adapter) and with the simulated engine (fake adapter), through the same visibility port the views use.
//  - Far side (Chang'e 4): the Earth is never in view, so R2 («Tierra al aterrizar») always fails.
//  - Near-side mid latitude (Apollo 15): Earth always in view, Sun half of a synodic month, lunar days of ~14.8 Earth days.
//  - Exact south pole over a smooth Moon: the Sun never climbs more than the tilt of the lunar axis to the ecliptic
//    (~1.54°). The elevation checked is the one of the disc centre; its upper edge adds the semidiameter (~0.27°).
// If the simulated engine ever fails one of them, it is a limitation of the simulated engine: document it, open its
// issue and skip that case for the fake adapter only; do not tune the thresholds.
// Under `node --test` the backend turns terrain off by itself: the real engine answers over a smooth Moon here.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../data/src/server.ts';
import { configureMasks } from '../../backend/src/horizon.ts';
import { apiVisibility } from '../js/adapters/visibility-api.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { toDomainProfile } from '../js/application/replan-service.js';
import { CONTROL_CASES, SITES, controlHint } from '../js/engine/catalog.js';
import { SITES as BACKEND } from '../../backend/src/sites.ts';
import { evaluateRange } from '../../planner/src/rules.js';

const DAY_MS = 864e5;
const SYNODIC_MONTH_DAYS = 29.530589;
const YEAR = 2027;

let server, baseUrl;
before(async () => {
  configureMasks({ diskCache: false }); // do not write mask caches during the tests
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const ENGINES = [
  { name: 'motor real (API de datos)', visibility: () => apiVisibility({ baseUrl }) },
  { name: 'motor simulado', visibility: () => fakeVisibility },
];

const site = (id) => ({ ...SITES.find((s) => s.id === id) });
const totalMs = (list) => list.reduce((sum, [a, b]) => sum + (b - a), 0);
const months = Array.from({ length: 12 }, (_, m) => [Date.UTC(YEAR, m, 1), Date.UTC(YEAR, m + 1, 1)]);

describe('casos de control (#102)', () => {
  test('Chang\'e 4 y Apolo 15 están en el catálogo de la web como casos de control, fuera del mapa polar y con su nota', () => {
    assert.deepEqual(SITES.filter((s) => s.control).map((s) => [s.id, s.control]), [['apollo15', 'near-side'], ['change4', 'far-side']]);
    for (const id of ['change4', 'apollo15']) {
      const s = SITES.find((x) => x.id === id);
      assert.equal(s.offMap, true, id);
      assert.equal(s.verified, true, id);
      assert.ok(s.note.length > 0, `${id}: sin nota`);
      assert.match(controlHint(s), /^Caso de control: /, id);
    }
    assert.match(SITES.find((x) => x.id === 'change4').note, /cara oculta.*la Tierra nunca se ve/);
    assert.equal(controlHint(SITES.find((x) => x.id === 'shackleton-rim')), '');
  });

  test('la fuente de cada caso de control es la de backend/src/sites.ts', () => {
    for (const c of CONTROL_CASES.filter((x) => x.siteId)) {
      assert.equal(c.source, BACKEND.find((b) => b.id === c.siteId).source ?? null, c.id);
    }
    assert.equal(CONTROL_CASES.find((c) => c.siteId === 'change4').source, 'https://lroc.im-ldi.com/images/1100');
  });

  for (const engine of ENGINES) {
    describe(engine.name, () => {
      test('cara oculta (Chang\'e 4): 0 % de Tierra visible en cada mes de 2027 y R2 falla en cada aterrizaje', async () => {
        const change4 = site('change4');
        const profile = toDomainProfile({ days: 1, batteryHours: 12, minEarthPct: 0 });
        assert.equal(profile.rules.R2.active, true);
        for (const [from, to] of months) {
          const w = await engine.visibility().loadWindows(change4, from, to + 2 * DAY_MS);
          const month = new Date(from).toISOString().slice(0, 7);
          assert.deepEqual(w.earth, [], `${month}: la Tierra no puede verse desde la cara oculta`);
          assert.ok(totalMs(w.sun) > 0, `${month}: el Sol sí sale`);
          for (const r of evaluateRange(w, profile, from, to)) {
            const r2 = r.rules.find((x) => x.id === 'R2');
            assert.equal(r2.passes, false, `${r.t0}: R2 no puede pasar`);
            assert.equal(r.verdict, 'not-viable', r.t0);
          }
        }
      });

      test('Apolo 15: Tierra ≥ 99 %, Sol entre 45 y 55 % en un mes sinódico y días de 14,8 ± 0,5 días terrestres', async () => {
        const apollo15 = site('apollo15');
        const from = Date.UTC(YEAR, 0, 1), to = Date.UTC(YEAR + 1, 0, 1);
        const w = await engine.visibility().loadWindows(apollo15, from, to);
        // One synodic month from the start of every calendar month.
        for (const [start] of months) {
          const end = start + SYNODIC_MONTH_DAYS * DAY_MS;
          const clip = (list) => list.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a);
          const span = end - start, month = new Date(start).toISOString().slice(0, 10);
          const earth = totalMs(clip(w.earth)) / span, sun = totalMs(clip(w.sun)) / span;
          assert.ok(earth >= 0.99, `${month}: Tierra visible el ${(earth * 100).toFixed(1)} %`);
          assert.ok(sun >= 0.45 && sun <= 0.55, `${month}: Sol visible el ${(sun * 100).toFixed(1)} %`);
        }
        // Whole lunar days only: the first and the last window are cut by the range.
        const days = w.sun.filter(([a, b]) => a > from && b < to).map(([a, b]) => (b - a) / DAY_MS);
        assert.ok(days.length >= 11, `${days.length} días lunares completos en ${YEAR}`);
        for (const d of days) assert.ok(Math.abs(d - 14.8) <= 0.5, `día lunar de ${d.toFixed(2)} días terrestres`);
      });

      test('polo sur exacto con Luna lisa: el Sol no sube de 1,4–1,7° en 2027', async () => {
        const pole = { id: 'control-south-pole', name: 'Polo sur', lat: -90, lon: 0 };
        let max = -Infinity;
        // Month by month: /v1/track caps its number of points.
        for (const [from, to] of months) {
          const { series } = await engine.visibility().loadSky(pole, from, to);
          for (const c of series) max = Math.max(max, c.sun.el);
        }
        assert.ok(max >= 1.4 && max <= 1.7, `elevación máxima del centro del Sol: ${max.toFixed(3)}°`);
      });
    });
  }
});
