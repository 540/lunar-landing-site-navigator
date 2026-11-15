// The best landings the server computes (/v1/best-landings) are the ones the browser computes from the same windows:
// both run planner/src/ranking.js. Real API on an ephemeral port, no doubles. Under `node --test` the backend turns
// terrain off by itself, so a synthetic DEM in memory gives the sites a real horizon (and real differences).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../data/src/server.ts';
import { configureMasks } from '../../backend/src/horizon.ts';
import { configureDem, makeGrid } from '../../backend/src/terrain/dem.ts';
import { bestLandings, rankingRange } from '../../planner/src/ranking.js';
import { apiVisibility } from '../js/adapters/visibility-api.js';
import { SITES } from '../js/engine/catalog.js';

let server, baseUrl;
before(async () => {
  configureMasks({ diskCache: false });
  // Flat bowl of 25 km radius around the pole surrounded by a 1500 m plateau: the sites inside see less Sun.
  const res = 240, half = 60000, n = Math.round((2 * half) / res), a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = Math.hypot(-half + (i + 0.5) * res, half - (j + 0.5) * res) > 25000 ? 1500 : 0;
  configureDem({ grids: [makeGrid({ name: 'synthetic', res, X0: -half, Y0: half, w: n, h: n, a })] });
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { configureDem({ grids: [] }); await new Promise((resolve) => server.close(resolve)); });

test('el servidor ordena igual que el navegador con las mismas ventanas', async () => {
  const api = apiVisibility({ baseUrl });
  const sites = SITES.filter((s) => !s.offMap);
  const cond = { sites, from: Date.UTC(2027, 9, 1), to: Date.UTC(2027, 9, 21), days: 10, batteryHours: 12, minEarthPct: 60, priority: 'energy' };
  const server = await api.loadBestLandings(cond);
  // The browser: the windows of each site through the same adapter (/v1/windows), then planner/src/ranking.js.
  const range = rankingRange(cond);
  const windowsBySite = Object.fromEntries(await Promise.all(sites.map(async (s) => [s.id, await api.loadWindows(s, range.fromMs, range.toMs)])));
  const browser = bestLandings({ windowsBySite, sites, from: cond.from, to: cond.to, mission: cond, priority: cond.priority });
  assert.equal(server.tested, browser.tested);
  assert.deepEqual(server.options.map((o) => o.siteId), browser.options.map((o) => o.siteId), 'mismo orden');
  for (const [i, s] of server.options.entries()) {
    const b = browser.options[i];
    assert.equal(s.landing, b.landing, `${s.siteId}: misma mejor fecha`);
    assert.equal(s.verdict, b.verdict, `${s.siteId}: mismo veredicto`);
    assert.equal(s.reason, b.reason);
    assert.deepEqual(s.reasons, b.reasons);
    assert.ok(Math.abs(s.score - b.score) < 1e-3, `${s.siteId}: misma puntuación (${s.score} frente a ${b.score})`);
    assert.equal(s.robustness.maxDelayDays, b.robustness.maxDelayDays);
    assert.equal(s.robustness.nextWindow, b.robustness.nextWindow);
    assert.deepEqual(s.landings.map((k) => [k.t, k.verdict, k.streak]), b.landings.map((k) => [k.t, k.verdict, k.streak]));
  }
});
