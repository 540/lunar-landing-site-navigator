// "Comparar escenarios" in Advanced (issue #63): every scenario is a site (or any point) on its own landing date,
// judged with the planner rules, and the service marks the best of each row (mission-service.js, scenario() and
// compareScenarios()). Runs on the simulated engine: deterministic, no API needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionService, compareScenarios, SCENARIO_ROWS } from '../js/application/mission-service.js';
import { toDomainProfile } from '../js/application/replan-service.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { SITES } from '../js/engine/catalog.js';
import { evaluate } from '../../planner/src/rules.js';

const DAY = 864e5;
const PLANNER_CODE = { viable: 'viable', marginal: 'marginal', 'not-viable': 'not_viable', 'no-data': 'not_viable' };
const mission = { days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48 };
const t = Date.parse('2027-04-03T12:00:00Z');
const visibility = { ...fakeVisibility, source: async () => 'fake' };
const site = id => SITES.find(s => s.id === id);

/** A scenario result with the given figures. */
const result = (code, pctSun, pctEarth, maxDarkHours, maxNoEarthHours) => ({ verdict: { code }, r: { pctSun, pctEarth, maxDarkHours, maxNoEarthHours } });
const row = (rows, id) => rows.find(r => r.id === id);

test('the rows are the figures of the issue, in order', () => {
  assert.deepEqual(SCENARIO_ROWS.map(r => r.id), ['verdict', 'sun', 'earth', 'night', 'earthGap']);
});

test('the best of each row: more Sun and Earth, shorter night and Earth gap, better verdict', () => {
  const rows = compareScenarios([
    result('viable', 90, 55, 6, 40),
    result('marginal', 95, 70, 12, 30),
    result('not_viable', 40, 100, 80, 0),
    result('viable', 60, 80, 3, 20),
  ]);
  assert.deepEqual(row(rows, 'verdict').best, [true, false, false, true], 'ties share the mark');
  assert.deepEqual(row(rows, 'sun').best, [false, true, false, false]);
  assert.deepEqual(row(rows, 'earth').best, [false, false, true, false]);
  assert.deepEqual(row(rows, 'night').best, [false, false, false, true]);
  assert.deepEqual(row(rows, 'earthGap').best, [false, false, true, false]);
  assert.deepEqual(row(rows, 'sun').values, [90, 95, 40, 60]);
});

test('a row where every scenario ties marks none, and scenarios without data never win', () => {
  const same = compareScenarios([result('viable', 100, 100, 0, 0), result('viable', 100, 100, 0, 0)]);
  for (const r of same) assert.deepEqual(r.best, [false, false], r.id);

  const noData = { verdict: { code: 'not_viable' }, r: { noData: true, pctSun: 0, pctEarth: 0, maxDarkHours: 0, maxNoEarthHours: 0 } };
  const rows = compareScenarios([result('marginal', 50, 50, 20, 20), noData, null, result('viable', 60, 40, 30, 10)]);
  assert.deepEqual(row(rows, 'night').values, [20, null, null, 30]);
  assert.deepEqual(row(rows, 'night').best, [true, false, false, false], 'the 0 h of a scenario without data is not the shortest night');
  assert.deepEqual(row(rows, 'verdict').best, [false, false, false, true]);

  const alone = compareScenarios([result('viable', 60, 40, 30, 10), null]);
  for (const r of alone) assert.deepEqual(r.best, [false, false], `${r.id}: one scenario with data has nobody to beat`);
});

test('a catalogue site inside the loaded period gives the very same answer as judge()', async () => {
  const service = createMissionService({ visibility, sites: SITES });
  await service.prepare({ fromMs: t - DAY, toMs: t + 40 * DAY });
  for (const s of SITES) {
    for (const when of [t, t + 9 * DAY]) {
      const { r, verdict } = await service.scenario(s, when, mission);
      assert.deepEqual({ r, verdict }, service.judge(s, when, mission), `${s.id} ${new Date(when).toISOString()}`);
    }
  }
});

test('each scenario is judged on its own date, also outside the loaded period', async () => {
  const s = site('shackleton-rim'), profile = toDomainProfile(mission);
  const service = createMissionService({ visibility, sites: SITES });
  await service.prepare({ fromMs: t - DAY, toMs: t + 11 * DAY });
  const far = t + 200 * DAY; // not loaded: the service asks the port for those dates
  assert.equal(service.isReady({ fromMs: far, toMs: far + mission.days * DAY }), false);
  const e = await service.scenario(s, far, mission);
  const w = await fakeVisibility.loadWindows(s, far - DAY, far + (mission.days + 1) * DAY);
  const expected = evaluate(w, profile, far);
  assert.equal(e.r.noData, undefined);
  assert.equal(e.verdict.code, PLANNER_CODE[expected.verdict]);
  assert.equal(e.r.maxDarkHours, expected.metrics.longestShadowHours);
  assert.equal(e.r.maxNoEarthHours, expected.metrics.longestEarthOutageHours);
  assert.equal(e.r.pctSun, 100 * expected.metrics.sunFraction);
  assert.equal(e.r.pctEarth, 100 * expected.metrics.earthFraction);
  assert.equal(service.scenario(s, far, mission), service.scenario(s, far, mission), 'asked twice, loaded once');
});

test('a point of the user (not in the catalogue) is judged with the planner rules on its own windows', async () => {
  const point = { id: 'scenario-point-1', name: 'Punto propio 1', lat: -88.4, lon: 42 }, profile = toDomainProfile(mission);
  const service = createMissionService({ visibility, sites: SITES });
  await service.prepare({ fromMs: t - DAY, toMs: t + 11 * DAY });
  const e = await service.scenario(point, t, mission);
  const w = await fakeVisibility.loadWindows({ ...point }, t - DAY, t + (mission.days + 1) * DAY);
  const expected = evaluate(w, profile, t);
  assert.equal(e.verdict.code, PLANNER_CODE[expected.verdict]);
  assert.equal(e.r.pctSun, 100 * expected.metrics.sunFraction);
  assert.equal(e.horizonModel, 'simulated-terrain');
});

test('four scenarios of two sites and four dates compare side by side', async () => {
  const service = createMissionService({ visibility, sites: SITES });
  await service.prepare({ fromMs: t - DAY, toMs: t + 40 * DAY });
  const list = await Promise.all([
    service.scenario(site('shackleton-rim'), t, mission),
    service.scenario(site('shackleton-rim'), t + 14 * DAY, mission),
    service.scenario(site('malapert'), t, mission),
    service.scenario(site('malapert'), t + 14 * DAY, mission),
  ]);
  const rows = service.compareScenarios(list);
  assert.equal(rows.length, 5);
  for (const r of rows) {
    assert.equal(r.values.length, 4);
    const known = r.values.filter(v => v !== null), top = r.better === 'higher' ? Math.max(...known) : Math.min(...known);
    r.best.forEach((b, i) => { if (b) assert.ok(Math.abs(r.values[i] - top) <= 0.05, `${r.id}: the marked one is the best`); });
  }
});
