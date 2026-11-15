import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intersect } from '../src/intervals.js';
import { VERDICT, launchDate } from '../src/rules.js';
import { marginDays } from '../src/replan.js';
import { bestLandings, missionProfile, rankingRange, PRIORITIES, RANK_STEP_HOURS, DEFAULT_TRANSIT_DAYS } from '../src/ranking.js';

const H = 3600e3, D = 24 * H;
const T0 = Date.parse('2027-01-01T00:00:00Z');
const at = (hours) => T0 + hours * H;
const MISSION = { days: 10, batteryHours: 12, minEarthPct: 60 };
const FROM = T0, TO = at(10 * 24);
const RANGE = rankingRange({ from: FROM, to: TO, days: MISSION.days });

// Ventanas hechas a mano, en horas desde T0. Por defecto, la Tierra se ve todo el periodo.
// La pendiente (R9), como la da /v1/windows con slope=1&maxSlopeDeg=10: por defecto, 3° certificados.
const slopeOf = (deg, underestimated = false) => ({ slopeDeg: deg, slopeBaselineM: underestimated ? 480 : 100, requestedBaselineM: 100, demResolutionM: underestimated ? 160 : 20, underestimated, meetsMaxSlope: deg <= 10 });
function windows(id, sunHours, earthHours = [[0, (RANGE.toMs - T0) / H]], slope = slopeOf(3)) {
  const sun = sunHours.map(([a, b]) => [at(a), at(b)]), earth = earthHours.map(([a, b]) => [at(a), at(b)]);
  return { site: { id, name: id, latDeg: -89, lonDeg: 0, horizonModel: 'mask' }, startMs: RANGE.fromMs, endMs: RANGE.toMs, sun, earth, sunAndEarth: intersect(sun, earth), slope };
}
const END = (RANGE.toMs - T0) / H;

test('el sitio con Sol siempre gana, viable y con la primera fecha; el que no tiene Sol queda detrás', () => {
  const w = { always: windows('always', [[0, END]]), never: windows('never', []) };
  const r = bestLandings({ windowsBySite: w, sites: [{ id: 'never' }, { id: 'always' }], from: FROM, to: TO, mission: MISSION, priority: 'energy' });
  assert.equal(r.stepHours, RANK_STEP_HOURS);
  assert.equal(r.tested, 2 * (10 * 24 / RANK_STEP_HOURS + 1));
  assert.deepEqual(r.options.map((o) => o.siteId), ['always', 'never']);
  const [a, n] = r.options;
  assert.equal(a.verdict, VERDICT.VIABLE);
  assert.equal(a.landing, FROM, 'con todo igual, aterrizar antes puntúa más');
  assert.equal(a.viableInWindow, a.landings.length);
  assert.equal(a.robustness.maxDelayDays, marginDays(w.always, missionProfile(MISSION), a.landing).days);
  assert.equal(a.reasons[0], 'Sol durante toda la misión');
  assert.equal(n.verdict, VERDICT.NOT_VIABLE);
  assert.match(n.reason, /El Sol no se ve al aterrizar/);
  assert.deepEqual(n.reasons, [n.reason]);
  assert.ok(a.score > 1 && n.score < 1);
});

test('una noche más larga que la batería tumba el aterrizaje; la mejor fecha la esquiva', () => {
  // Sol del día 0 al 6, 2 días de noche, Sol de nuevo: una misión de 10 días que empiece antes del día 8 pasa 48 h a oscuras.
  const w = { s: windows('s', [[0, 6 * 24], [8 * 24, END]]) };
  const r = bestLandings({ windowsBySite: w, sites: [{ id: 's' }], from: FROM, to: TO, mission: MISSION, priority: 'energy' });
  const [o] = r.options;
  assert.equal(o.verdict, VERDICT.VIABLE);
  assert.ok(o.landing >= at(8 * 24), `aterriza después de la noche (${new Date(o.landing).toISOString()})`);
  for (const k of o.landings.filter((x) => x.t < at(6 * 24 - 240))) assert.notEqual(k.verdict, VERDICT.VIABLE);
});

test('la prioridad cambia el orden: aterrizar antes frente a más comunicación', () => {
  const total = [[0, END]];
  const w = {
    early: windows('early', total, [[0, END]]),
    // Tierra el 70 % del tiempo pero solo viable desde el día 5 (antes, no se ve la Tierra al aterrizar).
    late: windows('late', total, [[5 * 24, END]]),
  };
  const sites = [{ id: 'early' }, { id: 'late' }];
  const byEarly = bestLandings({ windowsBySite: w, sites, from: FROM, to: TO, mission: MISSION, priority: 'early' });
  assert.equal(byEarly.options[0].siteId, 'early');
  assert.ok(PRIORITIES.some((p) => p.id === 'comms'));
});

test('R6: con maxEarthGapHours, un corte de Tierra más largo tumba el aterrizaje; sin él, no cuenta', () => {
  // Sol siempre; la Tierra se va 30 h a mitad del periodo (días 6 a 7,25), dentro de toda misión de 10 días que empiece en la ventana.
  const w = { s: windows('s', [[0, END]], [[0, 6 * 24], [6 * 24 + 30, END]]) };
  const run = (mission) => bestLandings({ windowsBySite: w, sites: [{ id: 's' }], from: FROM, to: at(5 * 24), mission, priority: 'energy' }).options[0];
  assert.equal(run(MISSION).verdict, VERDICT.VIABLE);
  const strict = run({ ...MISSION, maxEarthGapHours: 24 });
  assert.equal(strict.verdict, VERDICT.NOT_VIABLE);
  assert.match(strict.reason, /Hueco más largo sin Tierra: 1 d 6 h/);
  assert.equal(run({ ...MISSION, maxEarthGapHours: 48 }).verdict, VERDICT.VIABLE);
});

test('R9: una pendiente de más de 10° tumba el sitio; sin certificar no pasa de «justo»', () => {
  const sun = [[0, END]], earth = [[0, END]];
  const w = { flat: windows('flat', sun, earth), steep: windows('steep', sun, earth, slopeOf(11.4)), coarse: windows('coarse', sun, earth, slopeOf(4, true)) };
  const r = bestLandings({ windowsBySite: w, sites: [{ id: 'steep' }, { id: 'coarse' }, { id: 'flat' }], from: FROM, to: TO, mission: MISSION, priority: 'energy' });
  const by = Object.fromEntries(r.options.map((o) => [o.siteId, o]));
  assert.equal(by.flat.verdict, VERDICT.VIABLE);
  assert.equal(by.steep.verdict, VERDICT.NOT_VIABLE);
  assert.match(by.steep.reason, /Pendiente de 11,4° en 100 m \(máximo 10°\)/);
  assert.equal(by.coarse.verdict, VERDICT.MARGINAL);
  assert.deepEqual(r.options.map((o) => o.siteId), ['flat', 'coarse', 'steep']);
});

test('missionProfile: el tránsito de la nave solo cambia la fecha de lanzamiento (#67)', () => {
  assert.equal(missionProfile(MISSION).transitDays, DEFAULT_TRANSIT_DAYS);
  const slow = missionProfile({ ...MISSION, transitDays: 46 });
  assert.equal(slow.transitDays, 46);
  assert.equal(launchDate('2027-03-02T00:00:00.000Z', slow), '2027-01-15T00:00:00.000Z');
  assert.deepEqual({ ...slow, transitDays: 0 }, { ...missionProfile(MISSION), transitDays: 0 }, 'las reglas no cambian');
});
