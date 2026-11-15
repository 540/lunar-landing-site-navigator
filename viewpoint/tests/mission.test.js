// Mission viewer (V1.2, #73): the indicator comes from the windows of the verdict (visibleAt), never from three.js, and
// the direction of the Sun from the same source as those windows (here, the simulated engine).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionService } from '../../web/js/application/mission-service.js';
import { fakeVisibility } from '../../web/js/adapters/visibility-fake.js';
import { SITES } from '../../web/js/engine/catalog.js';
import { ephemeris } from '../../web/js/engine/model.js';
import { missionFrame, bodyAt, MISMATCH_TOLERANCE_DEG } from '../src/core/mission-state.js';
import { advanceWithin } from '../src/core/timeline.js';

const DAY = 864e5, HOUR = 36e5;
// The example plan: Cresta de Shackleton, 2027-03-29 12:00 UTC, small robotic lander.
const site = { ...SITES.find(s => s.id === 'shackleton-rim') };
const t0 = Date.parse('2027-03-29T12:00:00Z'), days = 10;
const service = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites: [site] });
const ready = service.prepare({ fromMs: t0 - DAY, toMs: t0 + (days + 1) * DAY }).then(() => new Promise(resolve => {
  const hit = service.sky(site, t0, days, resolve);
  if (hit) resolve(hit);
}));

test('at three instants of the example plan the indicator is what visibleAt says', async () => {
  const sky = await ready;
  for (const h of [0, 101.5, 230]) {
    const t = t0 + h * HOUR, f = missionFrame(service, site, sky, t0, t), seen = service.visibleAt(site, t);
    assert.equal(f.sun, seen.sun, `Sol a +${h} h`);
    assert.equal(f.earth, seen.earth, `Tierra a +${h} h`);
  }
});

test('the indicator follows the windows even where the drawn sky says otherwise, and says so', async () => {
  const sky = await ready;
  const lying = { visibleAt: () => ({ sun: false, earth: true }) }; // windows that contradict the drawn sky
  const t = t0 + 6 * HOUR, f = missionFrame(lying, site, sky, t0, t), drawn = bodyAt(sky.series, t0, t, 'sun');
  assert.equal(f.sun, false);
  assert.equal(f.mismatch.includes('sun'), drawn.margin > 0);
});

test('with simulated data, the Sun is drawn where the simulated ephemeris puts it', async () => {
  const sky = await ready;
  for (const h of [0, 48, 200]) {
    const t = t0 + h * HOUR, drawn = bodyAt(sky.series, t0, t, 'sun'), eph = ephemeris(site, t).sun;
    assert.ok(Math.abs(drawn.el - eph.el) < 1e-9 && Math.abs(drawn.az - eph.az) < 1e-9, `+${h} h`);
  }
});

test('bodyAt interpolates between hours and takes azimuths the short way round', () => {
  const series = [{ sun: { az: 359, el: 1, horizon: 0, margin: 1 } }, { sun: { az: 1, el: 2, horizon: 0, margin: 2 } }];
  const mid = bodyAt(series, 0, HOUR / 2, 'sun');
  assert.ok(Math.abs(mid.az) < 1e-9 || Math.abs(mid.az - 360) < 1e-9);
  assert.equal(mid.el, 1.5);
});

test('the mission timeline stops at the end instead of wrapping', () => {
  assert.equal(advanceWithin(9.9, 1, 1, 10), 10);
  assert.equal(advanceWithin(0, -1, 1, 10), 0);
});

test('the battery runs out only when R4 fails (the shadow lasts longer than the battery), with the model of Replan (missionTimeline)', async () => {
  // February 2027: the simulated ridge has shadows of up to ~29.5 h, so some batteries hold and some do not.
  const feb = Date.parse('2027-02-04T00:00:00Z'), svc = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites: [site] });
  await svc.prepare({ fromMs: feb, toMs: feb + 25 * DAY });
  const { batteryAt } = await import('../src/core/mission-state.js');
  let empties = 0, holds = 0;
  for (const batteryHours of [4, 12, 29.5, 48]) {
    const mission = { days: 5, batteryHours, minEarthPct: 60, maxEarthGapHours: 48 };
    for (let h = 0; h <= 14 * 24; h += 7) {
      const t = feb + h * HOUR, tl = svc.timeline(site, t, mission), { r } = svc.judge(site, t, mission);
      if (r.maxDarkHours > 0 && tl.emptyAtMs === null) holds++;
      assert.equal(tl.emptyAtMs !== null, r.maxDarkHours > batteryHours, `${batteryHours} h · +${h} h`);
      if (tl.emptyAtMs !== null) {
        empties++;
        assert.equal(batteryAt(tl, t, tl.emptyAtMs).empty, true);
        assert.equal(batteryAt(tl, t, tl.emptyAtMs - 1).empty, false);
      }
    }
  }
  assert.ok(empties > 0 && holds > 0, `the sample has plans that run out (${empties}) and plans with shadow that hold (${holds})`);
});

test('the jumps go to the longest shadow and Earth outage of the domain metrics, and are null when there are none', async () => {
  const { missionMetrics } = await import('../../planner/src/rules.js');
  const feb = Date.parse('2027-02-08T12:00:00Z'), svc = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites: [site] });
  const mission = { days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48 };
  await svc.prepare({ fromMs: feb - DAY, toMs: feb + 11 * DAY });
  const w = await fakeVisibility.loadWindows(site, feb - 16 * DAY, feb + 26 * DAY);
  const m = missionMetrics(w, feb, 10 * DAY), { r } = svc.judge(site, feb, mission);
  assert.equal(r.longestShadowStart, Date.parse(m.longestShadowStart));
  assert.equal(r.longestEarthOutageStart, Date.parse(m.longestEarthOutageStart));
  // At the start of the longest shadow the windows say: no Sun (the same state the viewer shows there).
  assert.equal(svc.visibleAt(site, r.longestShadowStart).sun, false);
  assert.equal(svc.visibleAt(site, r.longestEarthOutageStart).earth, false);
  // And the drawn sky agrees with them there: no warning in the instant of the jump (#192).
  const sky = await new Promise((resolve, reject) => { const hit = svc.sky(site, feb, 10, (s, err) => (s ? resolve(s) : reject(err ?? new Error('no sky')))); if (hit) resolve(hit); });
  assert.ok(sky.series.length > 0);
  for (const t of [r.longestShadowStart, r.longestEarthOutageStart]) assert.deepEqual(missionFrame(svc, site, sky, feb, t).mismatch, [], new Date(t).toISOString());
  // The March example has no shadow at all: no jump to the shadow.
  await ready;
  const march = service.judge(site, t0, mission).r;
  assert.equal(march.maxDarkHours, 0);
  assert.equal(march.longestShadowStart, null);
});

test('the warning uses the lower edge of the disc, as the windows do, with a tolerance (#192)', () => {
  // The Earth (radius 0.95°) with its centre `centre` degrees over a flat horizon, constant for two hours.
  const sky = centre => ({ series: [0, 1].map(() => ({
    sun: { az: 0, el: -5, horizon: 0, margin: -5, radius: 0.27, fullMargin: -5.27 },
    earth: { az: 90, el: centre, horizon: 0, margin: centre, radius: 0.95, fullMargin: centre - 0.95 },
  })) });
  const windows = earth => ({ visibleAt: () => ({ sun: false, earth }) });
  const at = (centre, earth) => missionFrame(windows(earth), site, sky(centre), 0, HOUR / 2).mismatch;
  assert.equal(MISMATCH_TOLERANCE_DEG, 0.15);
  assert.deepEqual(at(1.0, false), [], 'centre up but lower edge on the horizon: the windows say no Earth, and that is right');
  assert.deepEqual(at(1.5, false), ['earth'], 'the whole disc is up and the windows say no Earth');
  assert.deepEqual(at(-0.5, true), ['earth'], 'the disc is down and the windows say Earth');
  assert.deepEqual(at(2, true), []);
  // Both sides of the tolerance band, for each answer of the windows.
  assert.deepEqual(at(0.85, true), [], 'lower edge 0.10° under the horizon, within the tolerance: no warning');
  assert.deepEqual(at(0.75, true), ['earth'], 'lower edge 0.20° under: warning');
  assert.deepEqual(at(1.05, false), [], 'lower edge 0.10° over, within the tolerance');
  assert.deepEqual(at(1.15, false), ['earth'], 'lower edge 0.20° over: warning');
  // The Sun (radius 0.27°), the body of «Ir a la sombra más larga», with the Earth well down and not seen.
  const sunSky = centre => ({ series: [0, 1].map(() => ({
    sun: { az: 0, el: centre, horizon: 0, margin: centre, radius: 0.27, fullMargin: centre - 0.27 },
    earth: { az: 90, el: -5, horizon: 0, margin: -5, radius: 0.95, fullMargin: -5.95 },
  })) });
  const sunAt = (centre, sun) => missionFrame({ visibleAt: () => ({ sun, earth: false }) }, site, sunSky(centre), 0, HOUR / 2).mismatch;
  assert.deepEqual(sunAt(0.27, false), [], 'Sun: lower edge on the horizon and the windows say no Sun');
  assert.deepEqual(sunAt(0.37, false), [], 'Sun: lower edge 0.10° over, within the tolerance');
  assert.deepEqual(sunAt(0.47, false), ['sun'], 'Sun: lower edge 0.20° over and the windows say no Sun');
  assert.deepEqual(sunAt(0.17, true), [], 'Sun: lower edge 0.10° under, within the tolerance');
  assert.deepEqual(sunAt(0.07, true), ['sun'], 'Sun: lower edge 0.20° under and the windows say Sun');
});

test('bodyAt: a sky without fullMargin (older API) uses the margin of the centre', () => {
  const series = [{ earth: { az: 0, el: 1, horizon: 0, margin: 1 } }, { earth: { az: 0, el: 2, horizon: 0, margin: 2 } }];
  assert.equal(bodyAt(series, 0, HOUR / 2, 'earth').fullMargin, 1.5);
});

test('E6.2 · stepRun stops exactly at the target, does not wrap and says when it is done', async () => {
  const { stepRun, cancelRun } = await import('../src/core/timeline.js');
  assert.deepEqual(stepRun(1, 0.5, 4, 10), { offsetDays: 3, done: false });
  assert.deepEqual(stepRun(9, 0.5, 4, 10), { offsetDays: 10, done: true });
  assert.deepEqual(stepRun(59.9, 1, 4, 60), { offsetDays: 60, done: true }, 'at the end of the window it does not wrap');
});

test('E6.2 · cancelRun clears the run and tells the visit once; without a run it does nothing', async () => {
  const { cancelRun } = await import('../src/core/timeline.js');
  let n = 0;
  const playback = { runTo: { offsetDays: 3, onCancel: () => { n++; } } };
  assert.equal(cancelRun(playback), true);
  assert.equal(playback.runTo, null);
  assert.equal(cancelRun(playback), false);
  assert.equal(n, 1);
});
