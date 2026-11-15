// The jumps of the mission viewer against the data API (#192): at the start of the longest Earth outage (and of the
// longest shadow) the state says what the windows say, and the drawn sky does not contradict it (no `mismatch`).
// Two APIs: one in memory (under `node --test` the backend turns terrain off: spherical horizon), always; and the one
// at LUNAR_API_URL (e.g. the one of `npm start` in data/, http://localhost:3100), with LOLA relief, only when that
// variable is set explicitly and the API answers: opt-in, so `npm test` never depends on whatever server is running. That one reproduces the case of the issue: landing on 2027-01-14T12:00Z, 14 days, the five polar sites.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../data/src/server.ts';
import { configureMasks } from '../../backend/src/horizon.ts';
import { apiVisibility } from '../../web/js/adapters/visibility-api.js';
import { createMissionService } from '../../web/js/application/mission-service.js';
import { SITES } from '../../web/js/engine/catalog.js';
import { missionFrame } from '../src/core/mission-state.js';

const DAY = 864e5;
const LANDING = Date.parse('2027-01-14T12:00:00Z');
const MISSION = { days: 14, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48 };
const POLAR = ['shackleton-rim', 'ridge-slope', 'malapert', 'gerlache', 'im2-objetivo'].map(id => SITES.find(s => s.id === id));

/** For each polar site, the frame of the viewer at the start of the longest Earth outage and of the longest shadow. */
async function framesAtJumps(baseUrl) {
  const out = [];
  for (const site of POLAR) {
    const service = createMissionService({ visibility: { ...apiVisibility({ baseUrl }), source: async () => 'api' }, sites: [site] });
    await service.prepare({ fromMs: LANDING - DAY, toMs: LANDING + (MISSION.days + 1) * DAY });
    const sky = await new Promise((resolve, reject) => {
      const hit = service.sky(site, LANDING, MISSION.days, (s, err) => (s ? resolve(s) : reject(err ?? new Error('sin cielo'))));
      if (hit) resolve(hit);
    });
    const { r } = service.judge(site, LANDING, MISSION);
    for (const [jump, t] of [['earth', r.longestEarthOutageStart], ['sun', r.longestShadowStart]]) {
      if (t !== null) out.push({ site: site.id, jump, t, frame: missionFrame(service, site, sky, LANDING, t) });
    }
  }
  return out;
}

function assertNoMismatch(frames) {
  assert.ok(frames.some(f => f.jump === 'earth'), 'some site has an Earth outage to jump to');
  for (const { site, jump, t, frame } of frames) {
    const at = `${site}, ${jump} a ${new Date(t).toISOString()}`;
    assert.equal(frame[jump], false, `${at}: el estado dice que no se ve`);
    assert.deepEqual(frame.mismatch, [], `${at}: lo dibujado no contradice el cálculo`);
  }
}

describe('saltos del visor contra la API en memoria (horizonte esférico)', () => {
  let server, baseUrl;
  before(async () => {
    configureMasks({ diskCache: false }); // do not write mask caches during the tests
    server = createApp();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise(resolve => server.close(resolve)));

  test('el cielo trae el radio de cada disco y el margen de su borde inferior', async () => {
    const sky = await apiVisibility({ baseUrl }).loadSky(POLAR[0], LANDING, LANDING + DAY);
    for (const k of sky.series) {
      assert.ok(k.earth.radius > 0.85 && k.earth.radius < 1.05 && k.sun.radius > 0.25 && k.sun.radius < 0.28);
      for (const b of ['sun', 'earth']) assert.ok(Math.abs(k[b].fullMargin - (k[b].margin - k[b].radius)) < 1e-9);
    }
  });

  test('en el corte de Tierra y en la sombra más largos de los cinco sitios polares no hay aviso', async () => {
    assertNoMismatch(await framesAtJumps(baseUrl));
  });
});

const LIVE = process.env.LUNAR_API_URL;
const live = LIVE && await fetch(new URL('/v1/health', LIVE), { signal: AbortSignal.timeout(1500) })
  .then(res => (res.ok ? res.json() : null), () => null);
const [major, minor] = String(live?.apiVersion ?? '0.0').split('.').map(Number);
const skipLive = !LIVE ? 'opcional: pon LUNAR_API_URL (p. ej. http://localhost:3100, con npm start en data/) para probar contra la API con relieve'
  : !live ? `la API de ${LIVE} no responde (arráncala con npm start en data/ o pon LUNAR_API_URL)`
  : major === 1 && minor < 22 ? `la API de ${LIVE} es la ${live.apiVersion}: el radio de los discos llega en la 1.22.0`
  : live.terrain?.dem === false ? `la API de ${LIVE} no tiene el DEM LOLA` : false;

describe(`saltos del visor contra la API de ${LIVE ?? 'LUNAR_API_URL'} con relieve (#192)`, { skip: skipLive }, () => {
  test('aterrizaje el 2027-01-14T12:00Z, 14 días: en el corte de Tierra más largo, «sin Tierra» y sin aviso', { timeout: 600e3 }, async () => {
    assertNoMismatch(await framesAtJumps(LIVE));
  });
});
