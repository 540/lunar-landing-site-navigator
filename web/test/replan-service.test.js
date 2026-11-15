// The replan service over the simulated engine: what Replanificar compares (issue #30). No API, no DOM.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { createReplanService, rangeFor, verdictSource } from '../js/application/replan-service.js';
import { SITES } from '../js/engine/catalog.js';

const DAY_MS = 864e5;
// The scenario of the test mode (?test=1): de Gerlache on 2027-03-30, small robotic lander.
const LANDING = Date.parse('2027-03-30T00:00:00Z');
const MISSION = { days: 10, batteryHours: 12, minEarthPct: 60 };
const original = { siteId: 'gerlache', landingMs: LANDING };

const service = createReplanService({ visibility: fakeVisibility, sites: SITES.filter((s) => !s.offMap) });
before(() => service.prepare(rangeFor({ originalLandingMs: LANDING, notAfterMs: LANDING + 60 * DAY_MS, days: MISSION.days })));

describe('evaluate: one landing with the rules of the options', () => {
  test('the original plan without delay is what the options call current when there is no delay', () => {
    const options = service.options({ mission: MISSION, original, plan: original, notBeforeMs: LANDING, notAfterMs: LANDING + 60 * DAY_MS });
    const own = service.evaluate('gerlache', LANDING, MISSION);
    assert.equal(own.verdict, options.current.verdict);
    assert.deepEqual(own.evaluation.metrics, options.current.evaluation.metrics);
  });

  test('with the delay of the test mode the same site no longer holds, and its figures change', () => {
    const before = service.evaluate('gerlache', LANDING, MISSION);
    const delayed = service.evaluate('gerlache', LANDING + 3 * DAY_MS, MISSION);
    assert.equal(before.verdict, 'viable');
    assert.notEqual(delayed.verdict, 'viable');
    assert.ok(delayed.evaluation.metrics.longestShadowHours > MISSION.batteryHours);
  });

  test('a site without loaded windows is an error, not a silent verdict', () => {
    assert.throws(() => service.evaluate('nowhere', LANDING, MISSION), /nowhere/);
  });
});

describe('toDomainProfile: the longest stretch without the Earth (R6)', () => {
  test('is a rule only when the mission sets a limit', async () => {
    const { toDomainProfile } = await import('../js/application/replan-service.js');
    assert.equal(toDomainProfile(MISSION).rules.R6.active, false);
    assert.deepEqual(toDomainProfile({ ...MISSION, maxEarthGapHours: 48 }).rules.R6, { active: true, threshold: 48 });
  });

  test('a long blackout breaks a plan that the share of Earth alone would pass', () => {
    // Find a landing that is viable without R6 but has an Earth gap, then ask for a stricter limit than that gap.
    let found = null;
    for (let t = LANDING; t < LANDING + 40 * DAY_MS && !found; t += DAY_MS / 4) {
      const e = service.evaluate('shackleton-rim', t, MISSION).evaluation;
      if (e.verdict === 'viable' && e.metrics.longestEarthOutageHours >= 6) found = { t, gap: e.metrics.longestEarthOutageHours };
    }
    assert.ok(found, 'no hay en el escenario un aterrizaje viable con un corte de Tierra');
    const strict = service.evaluate('shackleton-rim', found.t, { ...MISSION, maxEarthGapHours: Math.floor(found.gap / 2) }).evaluation;
    assert.notEqual(strict.verdict, 'viable');
    assert.equal(strict.limiting.id, 'R6');
  });
});

describe('origen de los veredictos para la nota del relieve (#331)', () => {
  test('sin ventanas cargadas no se sabe: null, y la nota no dice «veredictos con datos de ejemplo»', () => {
    assert.equal(verdictSource({}), null);
  });
  test('todo del motor simulado (?data=fake): fake', () => {
    assert.equal(verdictSource({ a: 'simulated-terrain', b: 'simulated-terrain' }), 'fake');
  });
  test('de la API, con relieve o sin él: api', () => {
    assert.equal(verdictSource({ a: 'mask', b: 'sphere' }), 'api');
    assert.equal(verdictSource({ a: 'mask', b: 'mask' }), 'api');
  });
  test('una mezcla con algún sitio de la API: api', () => {
    assert.equal(verdictSource({ a: 'simulated-terrain', b: 'mask' }), 'api');
  });
  test('el servicio cargado con el motor simulado da fake', () => {
    assert.equal(verdictSource(service.horizonModels()), 'fake');
  });
});
