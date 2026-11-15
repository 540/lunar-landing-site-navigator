// «Máx. sin Tierra seguido» (R6) read from a field: empty means no limit and R6 off, as in Plan (views/plan.js).
// Replan reads its field and the sidebar with earthGapOf, so with or without a limit it must give the verdict of
// Plan and Advanced (the mission service) for every landing.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { earthGapOf, hasEarthGap } from '../js/common/earth-gap.js';
import { createMissionService } from '../js/application/mission-service.js';
import { createReplanService, rangeFor } from '../js/application/replan-service.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { SITES } from '../js/engine/catalog.js';

describe('earthGapOf: the field of the longest stretch without the Earth', () => {
  test('empty, blank, missing or not a number: no limit', () => {
    for (const v of ['', '   ', null, undefined, 'abc']) assert.equal(earthGapOf(v), undefined, JSON.stringify(v));
  });
  test('a number: that limit, never below 0, as Plan reads it', () => {
    assert.equal(earthGapOf('48'), 48);
    assert.equal(earthGapOf('0'), 0);
    assert.equal(earthGapOf('-3'), 0);
    assert.equal(earthGapOf(24), 24);
  });
  test('hasEarthGap: only a finite number limits', () => {
    assert.equal(hasEarthGap(undefined), false);
    assert.equal(hasEarthGap(0), true);
    assert.equal(hasEarthGap(48), true);
  });
});

const DAY = 864e5;
const PLANNER_CODE = { viable: 'viable', marginal: 'marginal', 'not-viable': 'not_viable', 'no-data': 'not_viable' };
const sites = SITES.filter(s => !s.offMap).map(s => ({ ...s }));
const base = { days: 10, batteryHours: 50, minEarthPct: 50 };
const from = Date.parse('2027-04-01T00:00:00Z'), to = Date.parse('2027-04-30T00:00:00Z');
const mission = field => ({ ...base, maxEarthGapHours: earthGapOf(field) });

const plan = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites });
const replan = createReplanService({ visibility: fakeVisibility, sites });
before(() => Promise.all([
  plan.prepare({ fromMs: from - DAY, toMs: to + 60 * DAY }),
  replan.prepare(rangeFor({ originalLandingMs: from, notAfterMs: to, days: base.days })),
]));

const verdicts = (m, judge) => {
  const out = [];
  for (const site of sites) for (let t = from; t <= to; t += 12 * 3600e3) out.push(`${site.id}@${new Date(t).toISOString()}=${judge(site, t, m)}`);
  return out;
};
const planVerdict = (site, t, m) => plan.judge(site, t, m).verdict.code;
const replanVerdict = (site, t, m) => PLANNER_CODE[replan.evaluate(site.id, t, m).verdict];

describe('Replan gives the verdict of Plan and Advanced, with and without a limit', () => {
  test('without a limit (empty field): R6 off in both, the same verdict for every landing', () => {
    assert.deepEqual(verdicts(mission(''), replanVerdict), verdicts(mission(''), planVerdict));
    assert.deepEqual(verdicts(mission(''), planVerdict), verdicts({ ...base }, planVerdict)); // the same as a mission without the field
  });

  test('with a limit of 48 h: the same verdict in both, as before', () => {
    assert.deepEqual(verdicts(mission('48'), replanVerdict), verdicts(mission('48'), planVerdict));
    assert.deepEqual(verdicts(mission('48'), planVerdict), verdicts({ ...base, maxEarthGapHours: 48 }, planVerdict));
  });

  test('no limit is not a limit of 0 h: with these data, 0 h fails landings that hold without a limit', () => {
    const none = verdicts(mission(''), replanVerdict), zero = verdicts({ ...base, maxEarthGapHours: 0 }, replanVerdict);
    assert.notDeepEqual(zero, none);
  });
});
