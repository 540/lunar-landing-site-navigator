// "Si aterrizas desviado" in Advanced: the same landing judged on a ring of points around the site
// (mission-service.js, around()). Runs on the simulated engine: deterministic, no API needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionService, ringAround } from '../js/application/mission-service.js';
import { toDomainProfile } from '../js/application/replan-service.js';
import { fakeVisibility } from '../js/adapters/visibility-fake.js';
import { SITES } from '../js/engine/catalog.js';
import { evaluate } from '../../planner/src/rules.js';
import { marginDays, MARGIN_CAP_DAYS } from '../../planner/src/replan.js';

const DAY = 864e5, R = 1737.4, RAD = Math.PI / 180;
const PLANNER_CODE = { viable: 'viable', marginal: 'marginal', 'not-viable': 'not_viable', 'no-data': 'not_viable' };
const mission = { days: 10, batteryHours: 12, minEarthPct: 60 };
const t = Date.parse('2027-04-02T00:00:00Z');

/** Great-circle distance in km. */
function km(a, b) {
  const h = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

test('the ring is at the asked distance, also next to the pole and across the antimeridian', () => {
  for (const site of [{ lat: -89.45, lon: -137.3 }, { lat: -86, lon: 0 }, { lat: -88, lon: 179.99 }, { lat: 0.67, lon: 23.47 }]) {
    for (const radius of [0.5, 1, 2]) {
      const ring = ringAround(site, radius);
      assert.equal(ring.length, 8);
      for (const p of ring) {
        assert.ok(Math.abs(km(site, p) - radius) < 0.001 * radius, `${JSON.stringify(site)} ${p.bearingDeg}°: ${km(site, p)} km`);
        assert.ok(p.lon >= -180 && p.lon < 180);
      }
    }
  }
});

test('the first point is north and they go clockwise', () => {
  const [n, , e, , s, , w] = ringAround({ lat: -86, lon: 0 }, 1);
  assert.ok(n.lat > -86 && s.lat < -86);
  assert.ok(e.lon > 0 && w.lon < 0);
});

test('every point gets the verdict of the planner rules on its own windows', async () => {
  const site = SITES.find(s => s.id === 'shackleton-rim');
  const service = createMissionService({ visibility: { ...fakeVisibility, source: async () => 'fake' }, sites: [site] });
  const res = await service.around(site, t, mission, 1);
  assert.equal(res.points.length, 8);
  assert.equal(res.viable, res.points.filter(p => p.code === 'viable').length);
  const profile = toDomainProfile(mission);
  for (const p of res.points) {
    const w = await fakeVisibility.loadWindows({ id: 'p', name: 'p', lat: p.lat, lon: p.lon }, t - DAY, t + (mission.days + 1) * DAY);
    assert.equal(p.code, PLANNER_CODE[evaluate(w, profile, t).verdict], `${p.bearingDeg}°`);
  }
  assert.equal(service.around(site, t, mission, 1), service.around(site, t, mission, 1), 'asked twice, loaded once');
});

// Issue #106: a point of the ring opens as a point of its own, with its own windows and the same rules.
const fake = { ...fakeVisibility, source: async () => 'fake' };
const ownWindows = (p, landing = t) => fakeVisibility.loadWindows({ id: 'p', name: 'p', lat: p.lat, lon: p.lon }, landing - DAY, landing + (mission.days + MARGIN_CAP_DAYS + 1) * DAY);
const inside = (list, at) => list.some(([a, b]) => a <= at && at < b);

test('a point of the ring opened on its own gets the verdict it has in the ring, with its figures and its margin', async () => {
  const site = SITES.find(s => s.id === 'shackleton-rim');
  const service = createMissionService({ visibility: fake, sites: [site] });
  await service.prepare({ fromMs: t - DAY, toMs: t + 20 * DAY });
  const ring = await service.around(site, t, mission, 1);
  const profile = toDomainProfile(mission);
  for (const [k, p] of ring.points.entries()) {
    const res = await service.point({ id: `${site.id}~1km~${k}`, name: `p${k}`, lat: p.lat, lon: p.lon }, t, mission);
    assert.equal(res.verdict.code, p.code, `${p.bearingDeg}°`);
    assert.equal(res.verdict.reason, p.reason);
    const w = await ownWindows(p), m = evaluate(w, profile, t).metrics;
    assert.equal(res.r.maxDarkHours, m.longestShadowHours);
    assert.equal(res.r.pctEarth, 100 * m.earthFraction);
    assert.equal(res.robustDays, p.code === 'viable' ? marginDays(w, profile, t).days : 0);
    assert.equal(res.band, null, 'the simulated engine has no horizon band');
    assert.equal(res.horizonModel, 'simulated-terrain');
  }
});

test('once opened, the point answers like a site, from its own windows', async () => {
  const site = SITES.find(s => s.id === 'shackleton-rim');
  const service = createMissionService({ visibility: fake, sites: [site] });
  await service.prepare({ fromMs: t - DAY, toMs: t + 20 * DAY });
  const q = ringAround(site, 2)[1], point = { id: 'off', name: 'off', lat: q.lat, lon: q.lon };
  const before = service.visibleAt(site, t);
  assert.equal(service.visibleAt(point, t), null, 'unknown until it is opened');
  assert.equal(service.horizonModel('off'), null);
  await service.point(point, t, mission);
  const w = await ownWindows(q), hours = service.visibleHours(point, t, 48);
  for (let h = 0; h < 48; h++) {
    const at = t + h * 36e5;
    assert.deepEqual(service.visibleAt(point, at), { sun: inside(w.sun, at), earth: inside(w.earth, at) }, `+${h} h`);
    assert.equal(!!hours.sun[h], inside(w.sun, at));
    assert.equal(!!hours.earth[h], inside(w.earth, at));
  }
  assert.equal(service.horizonModel('off'), 'simulated-terrain');
  assert.deepEqual(service.visibleAt(site, t), before, 'the catalogue site is not touched');
});

test('the point answers with the windows of the last landing asked for it, whichever arrives first', async () => {
  const site = SITES.find(s => s.id === 'shackleton-rim');
  let release, calls = 0;
  const held = new Promise(resolve => { release = resolve; }); // the first request waits until the second has answered
  const visibility = { ...fake, async loadWindows(s, from, to) { if (++calls === 1) await held; return fakeVisibility.loadWindows(s, from, to); } };
  const service = createMissionService({ visibility, sites: [] });
  const point = { id: 'off', name: 'off', lat: site.lat, lon: site.lon }, later = t + 40 * DAY, at = later + 5 * DAY;
  const first = service.point(point, t, mission), second = service.point(point, later, mission);
  assert.equal(service.visibleAt(point, at), null, 'nothing answers for the point while its windows are on the way');
  await second;
  release();
  await first;
  const w = await ownWindows(site, later);
  assert.deepEqual(service.visibleAt(point, at), { sun: inside(w.sun, at), earth: inside(w.earth, at) });
  assert.equal(calls, 2);
});
