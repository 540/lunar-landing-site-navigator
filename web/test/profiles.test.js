// The user's own spacecraft (#251): profile lookup, its source line and when typed requirements stop being a profile's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, CUSTOM_PROFILE, profileById, profileFor, profileSource, profileSwitchNotice, matchesProfile, requirementsOnChoose } from '../js/engine/catalog.js';
import { viewerUrl, planUrl, parseMission } from '../../viewpoint/src/core/mission-link.js';
import { parseHistory, createMissionHistory, missionProfileName } from '../js/common/mission-history.js';

const valuesOf = p => ({ days: String(p.days), batteryHours: String(p.batteryHours), minEarthPct: String(p.minEarthPct),
  maxEarthGapHours: String(p.maxEarthGapHours), transitDays: String(p.transitDays) });

test('profileById: example profiles by id, the own spacecraft for anything else', () => {
  for (const p of PROFILES) assert.equal(profileById(p.id), p);
  assert.equal(profileById('custom'), CUSTOM_PROFILE);
  assert.equal(profileById(null), CUSTOM_PROFILE);
  assert.equal(profileById('unknown'), CUSTOM_PROFILE);
  assert.equal(CUSTOM_PROFILE.name, 'Nave propia');
  assert.ok(!PROFILES.some(p => p.id === CUSTOM_PROFILE.id));
});

test('profileSource: does not throw without an example profile and says the thresholds are the user\'s', () => {
  assert.match(profileSource(CUSTOM_PROFILE), /los pone el usuario/);
  assert.equal(profileSource(undefined), ''); // no profile at all: empty, as on main (callers pass profileById's)
  for (const p of PROFILES) assert.equal(profileSource(p), `Umbrales: ${p.source}. Tránsito de ${p.transitDays} d: ${p.transitSource}`);
});

test('matchesProfile: the values of a profile match it; any change by hand does not', () => {
  for (const p of PROFILES) {
    assert.ok(matchesProfile(p, valuesOf(p)));
    assert.ok(matchesProfile(p, { ...valuesOf(p), days: `${p.days}`.padStart(4, ' ') }));
    assert.ok(!matchesProfile(p, { ...valuesOf(p), days: String(p.days + 1) }));
    assert.ok(!matchesProfile(p, { ...valuesOf(p), maxEarthGapHours: '' }));
    assert.ok(!matchesProfile(p, { ...valuesOf(p), transitDays: '' }));
  }
  assert.ok(!matchesProfile(CUSTOM_PROFILE, {}));
  assert.ok(!matchesProfile(undefined, {}));
});

test('profileFor: an example profile while its requirements are its own; the own spacecraft once one was changed', () => {
  for (const p of PROFILES) {
    assert.equal(profileFor(p.id, { ...p }), p.id);
    assert.equal(profileFor(p.id, { ...p, transitDays: undefined }), p.id); // no transit: its profile's
    assert.equal(profileFor(p.id, { ...p, days: p.days + 1 }), CUSTOM_PROFILE.id); // an old link or history entry
    assert.equal(profileFor(p.id, { ...p, maxEarthGapHours: undefined }), CUSTOM_PROFILE.id);
  }
  assert.equal(profileFor('custom', { ...PROFILES[0] }), CUSTOM_PROFILE.id);
  assert.equal(profileFor(null, { ...PROFILES[0] }), CUSTOM_PROFILE.id);
});

test('requirementsOnChoose: empty for the own spacecraft, the ones on screen when they are kept', () => {
  const current = valuesOf(PROFILES[0]);
  assert.deepEqual(requirementsOnChoose(CUSTOM_PROFILE, current),
    { days: '', batteryHours: '', minEarthPct: '', maxEarthGapHours: '', transitDays: '' });
  assert.deepEqual(requirementsOnChoose(CUSTOM_PROFILE, current, { keep: true }), current);
  for (const p of PROFILES) {
    assert.deepEqual(requirementsOnChoose(p, {}, { keep: true }), {
      days: p.days, batteryHours: p.batteryHours, minEarthPct: p.minEarthPct, maxEarthGapHours: p.maxEarthGapHours, transitDays: p.transitDays });
  }
});

// A plan with the user's own spacecraft, as Plan builds its link and its history entry.
const OWN = { siteId: 'malapert', t0: Date.UTC(2027, 10, 17, 12), days: 7, batteryHours: 30, minEarthPct: 45, maxEarthGapHours: 20,
  transitDays: 12, profile: 'custom', from: '2027-11-10', to: '2027-11-24', pickBest: true };
const REQUIREMENTS_OF = m => ({ profile: m.profile, days: m.days, batteryHours: m.batteryHours, minEarthPct: m.minEarthPct,
  maxEarthGapHours: m.maxEarthGapHours, transitDays: m.transitDays });

test('el enlace al visor 3D y su vuelta a Planificar traen la nave propia con sus requisitos', () => {
  for (const url of [viewerUrl(OWN, ''), planUrl(OWN, '')]) {
    const back = parseMission(new URL(url, 'http://x/web/').search);
    assert.deepEqual(REQUIREMENTS_OF(back), REQUIREMENTS_OF(OWN));
    assert.equal(profileFor(back.profile, back), CUSTOM_PROFILE.id);
  }
});

test('el historial guarda la nave propia con sus requisitos', () => {
  const data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  createMissionHistory(storage).record({ ...OWN, searchSiteId: null, panelHeightM: 2, antennaHeightM: 2, verdict: 'viable' });
  const [entry] = parseHistory(data.get('llsn.missions'));
  assert.deepEqual(REQUIREMENTS_OF(entry), REQUIREMENTS_OF(OWN));
  assert.equal(profileFor(entry.profile, entry), CUSTOM_PROFILE.id);
});

test('adopt(): un plan con nave propia, o con una nave desconocida, no falla y Avanzado dice «Nave propia»', async () => {
  const fields = new Map();
  globalThis.document = { getElementById: id => fields.get(id) ?? fields.set(id, { value: '', textContent: '' }).get(id) };
  globalThis.location = { hash: '#plan' };
  try {
    const { adopt } = await import('../js/common/adopt.js');
    const { state } = await import('../js/common/state.js');
    const option = { site: { id: 'malapert' }, landing: OWN.t0 };
    for (const profile of ['custom', 'unknown', null]) {
      state.searchResult = { conditions: { ...OWN, profile, panelHeightM: 2, antennaHeightM: 2 } };
      assert.doesNotThrow(() => adopt(option, ['malapert'], false));
      assert.equal(fields.get('profile').value, CUSTOM_PROFILE.id);
      assert.match(fields.get('profile-source').textContent, /los pone el usuario/);
    }
    // An example spacecraft whose requirements were changed by hand is the own one in Advanced too.
    const p = PROFILES[0];
    state.searchResult = { conditions: { ...p, profile: p.id, days: p.days + 1, panelHeightM: 2, antennaHeightM: 2 } };
    adopt(option, ['malapert'], false);
    assert.equal(fields.get('profile').value, CUSTOM_PROFILE.id);
    state.searchResult = { conditions: { ...p, profile: p.id, panelHeightM: 2, antennaHeightM: 2 } };
    adopt(option, ['malapert'], false);
    assert.equal(fields.get('profile').value, p.id);
  } finally {
    delete globalThis.document; delete globalThis.location;
  }
});

test('missionProfileName: el historial nombra la nave con la misma regla con la que Planificar la abre', () => {
  const p = PROFILES[0];
  const entry = over => ({ siteId: 'malapert', t0: Date.UTC(2027, 10, 17, 12), ...valuesOf(p), profile: p.id, ...over });
  const asNumbers = e => ({ ...e, days: +e.days, batteryHours: +e.batteryHours, minEarthPct: +e.minEarthPct,
    maxEarthGapHours: +e.maxEarthGapHours, transitDays: +e.transitDays });
  assert.equal(missionProfileName(asNumbers(entry())), p.name);
  // Saved before #251: an example id with a requirement changed by hand opens, and is listed, as the own spacecraft.
  assert.equal(missionProfileName(asNumbers(entry({ days: String(p.days + 1) }))), 'Nave propia');
  // No transit stored: it takes its spacecraft's, so it is still the example one.
  assert.equal(missionProfileName({ ...asNumbers(entry()), transitDays: undefined }), p.name);
  // Without a profile (older entries) or with an unknown one.
  assert.equal(missionProfileName(asNumbers(entry({ profile: null }))), 'Nave propia');
  assert.equal(missionProfileName(asNumbers(entry({ profile: 'unknown' }))), 'Nave propia');
  // Read back from the storage, as the panel lists it.
  const [stored] = parseHistory(JSON.stringify([asNumbers(entry({ days: String(p.days + 1) }))]));
  assert.equal(missionProfileName(stored), profileById(profileFor(stored.profile, stored)).name);
  assert.equal(missionProfileName(stored), 'Nave propia');
});

test('profileSwitchNotice: solo se anuncia el paso de una nave de ejemplo a «Nave propia»', () => {
  for (const p of PROFILES) assert.equal(profileSwitchNotice(p.id, 'custom'), 'Has cambiado un requisito: la nave pasa a ser «Nave propia».');
  assert.equal(profileSwitchNotice('custom', 'custom'), '');
  assert.equal(profileSwitchNotice(null, 'custom'), '');
  assert.equal(profileSwitchNotice(PROFILES[0].id, PROFILES[0].id), '');
  assert.equal(profileSwitchNotice(PROFILES[0].id, PROFILES[1].id), '');
});
