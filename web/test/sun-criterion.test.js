// «Horas con Sol» and the panel energy measure different things, and the texts say so. Against the real API on an
// ephemeral port, no doubles. With the LOLA DEM, at the Shackleton connecting ridge landing on 2027-04-10 12:00 for 10
// days, Plan showed «Horas con Sol 0 %» beside a panel energy of 11 % and a sunTimeFraction of 0.365 in /v1/rank: the
// Sun never shows its whole disc (the figure of Plan, from /v1/windows mode=full, as the verdict rules) but it peeps
// over the terrain a third of the time (/v1/rank counts with mode=limb) and the panel gets energy from that. Under
// `node --test` there is no DEM and the horizon is the smooth Moon: the same happens there on 2027-02-25, when the Sun
// grazes the horizon of the pole with less than its radius.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../data/src/server.ts';
import { configureMasks } from '../../backend/src/horizon.ts';
import { apiVisibility } from '../js/adapters/visibility-api.js';
import { createMissionService } from '../js/application/mission-service.js';
import { SITES } from '../js/engine/catalog.js';
import { DICTS } from '../js/i18n/index.js';

const DAY_MS = 864e5;
const ridge = SITES.find(s => s.id === 'shackleton-rim');
const T0 = Date.UTC(2027, 1, 25, 12), DAYS = 10;
const MISSION = { days: DAYS, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48, transitDays: 8 };
const HEIGHTS = { panelHeightM: 2, antennaHeightM: 2 };

let server, baseUrl;
before(async () => {
  configureMasks({ diskCache: false });
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

async function get(path, params) {
  const res = await fetch(`${baseUrl}${path}?${new URLSearchParams(params)}`);
  assert.equal(res.status, 200, path);
  return res.json();
}
const where = { lat: String(ridge.lat), lon: String(ridge.lon), terrain: '1', panelHeightM: '2', antennaHeightM: '2' };
const sunWindows = mode => get('/v1/windows', { ...where, start: new Date(T0).toISOString(), end: new Date(T0 + DAYS * DAY_MS).toISOString(), mode })
  .then(r => r.sun.summary.fractionOfTime);

test('«Horas con Sol» es el Sol entero (mode=full); la sunTimeFraction de /v1/rank, cualquier parte del disco (limb)', async () => {
  const ms = createMissionService({ visibility: { ...apiVisibility({ baseUrl }), source: async () => 'api' }, sites: [ridge] });
  await ms.prepare({ fromMs: T0 - DAY_MS, toMs: T0 + (DAYS + 2) * DAY_MS, ...HEIGHTS });
  const { r } = ms.judge(ridge, T0, MISSION);
  const [full, limb] = await Promise.all([sunWindows('full'), sunWindows('limb')]);
  const rank = (await get('/v1/rank', { sites: `${ridge.lat}:${ridge.lon}`, start: new Date(T0).toISOString(), days: String(DAYS), terrain: '1', ...HEIGHTS })).results[0].metrics;

  assert.ok(Math.abs(r.pctSun - 100 * full) < 1, `la cifra de Planificar (${r.pctSun}) es la de las ventanas full (${full})`);
  assert.ok(Math.abs(rank.sunTimeFraction - limb) < 0.03, `rank (${rank.sunTimeFraction}) cuenta como las ventanas limb (${limb})`);
  // The case of the report: no whole Sun, but the Sun peeps over the horizon and the panel gets energy from it.
  assert.ok(r.pctSun < 1, `sin el Sol entero: ${r.pctSun}`);
  assert.ok(rank.sunTimeFraction > 0.2 && rank.meanSunDiskFraction > 0.02, JSON.stringify(rank));
  assert.ok(rank.meanSunDiskFraction >= full, 'la energía de un seguidor nunca es menor que el tiempo con el Sol entero');
});

test('los textos dicen qué mide cada cifra, en castellano y en inglés', () => {
  const { es, en } = DICTS;
  assert.match(es['plan.fig.sunReq'], /Sol entero/);
  assert.match(en['plan.fig.sunReq'], /whole Sun/);
  assert.match(es['advanced.fig.sunNote'], /Sol entero/);
  assert.match(en['advanced.fig.sunNote'], /whole Sun/);
  // The energy line names the figure it differs from with the label on screen.
  assert.ok(es['plan.energy.partial'].includes(`«${es['plan.fig.sun']}»`), es['plan.energy.partial']);
  assert.ok(en['plan.energy.partial'].includes(`«${en['plan.fig.sun']}»`), en['plan.energy.partial']);
});
