// Plan, Advanced and Replan must give the same verdict for the same landing (docs/adr/0001, «Seguimiento»).
// Plan and Advanced ask web/js/application/mission-service.js; Replan, replan-service.js with planner/src/replan.js.
// Both read the same visibility windows: here, those of the simulated engine (deterministic, no API needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionService } from '../js/application/mission-service.js';
import { toDomainProfile } from '../js/application/replan-service.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { SITES } from '../js/engine/catalog.js';
import { evaluate } from '../../planner/src/rules.js';
import { marginDays } from '../../planner/src/replan.js';

const DAY = 864e5;
const PLANNER_CODE = { viable: 'viable', marginal: 'marginal', 'not-viable': 'not_viable', 'no-data': 'not_viable' };
const sites = SITES.filter(s => !s.offMap).map(s => ({ ...s }));
const mission = { days: 10, batteryHours: 12, minEarthPct: 60 };
const from = Date.parse('2027-03-25T00:00:00Z'), to = Date.parse('2027-04-20T12:00:00Z');

const service = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites });
const loading = service.prepare({ fromMs: from - DAY, toMs: to + 60 * DAY });
const windowsOf = async site => fakeVisibility.loadWindows(site, from - 16 * DAY, to + 75 * DAY);

test('Plan/Advanced (mission service) and Replan (planner rules) give the same verdict for every landing', async () => {
  await loading;
  const profile = toDomainProfile(mission); // the profile replan-service.js gives planner/src/replan.js
  for (const site of sites) {
    const w = await windowsOf(site);
    for (let t = from; t <= to; t += 12 * 3600e3) {
      const web = service.judge(site, t, mission).verdict.code;
      const replan = PLANNER_CODE[evaluate(w, profile, t).verdict];
      assert.equal(web, replan, `${site.id} · ${new Date(t).toISOString()}`);
    }
  }
});

test('the search ranks with those verdicts and measures the margin against delays like Replan', async () => {
  await loading;
  const res = await service.search({ sites, from, to, priority: 'energy', profile: 'small-robotic', ...mission });
  const profile = toDomainProfile(mission);
  assert.equal(res.options.length, sites.length);
  for (const o of res.options) {
    assert.equal(o.verdict.code, service.judge(o.site, o.landing, mission).verdict.code);
    for (const k of o.landings) assert.equal(k.code, service.judge(o.site, k.t, mission).verdict.code);
    if (o.verdict.code === 'viable') {
      const w = await windowsOf(o.site);
      assert.equal(o.robustness.maxDelayDays, marginDays(w, profile, o.landing).days, o.site.id);
    }
  }
});
