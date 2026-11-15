// Mission history (#246): what an entry is, when it is updated and when it is added, the limit and the storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, MAX_MISSIONS, missionEntry, missionKey, recordMission, removeMission, parseHistory, createMissionHistory,
} from '../js/common/mission-history.js';

const T0 = Date.UTC(2027, 10, 17, 12);
const mission = (over = {}) => ({
  siteId: 'malapert', t0: T0, days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48, transitDays: 8,
  profile: 'small-robotic', from: '2027-11-10', to: '2027-11-24', searchSiteId: null, panelHeightM: 2, antennaHeightM: 2,
  savedAt: 1000, verdict: 'viable', ...over,
});

/** A storage like localStorage, in memory. */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, data };
}

test('una entrada guarda los parámetros de la misión y descarta lo que no conoce', () => {
  const e = missionEntry({ ...mission(), result: { sunPct: 61 }, extra: 'x' });
  assert.deepEqual(e, mission());
  assert.equal(JSON.parse(JSON.stringify(e)).maxEarthGapHours, 48);
});

test('sin sitio, sin aterrizaje o sin duración no hay entrada', () => {
  assert.equal(missionEntry(null), null);
  assert.equal(missionEntry(mission({ siteId: '' })), null);
  assert.equal(missionEntry(mission({ t0: NaN })), null);
  assert.equal(missionEntry(mission({ days: 0 })), null);
});

test('los campos opcionales vacíos se quedan sin valor: sin límite de cortes, tránsito de la nave y ventana alrededor', () => {
  const e = missionEntry(mission({ maxEarthGapHours: undefined, transitDays: null, from: '2027-11-30', verdict: 'otro' }));
  assert.equal(e.maxEarthGapHours, undefined);
  assert.equal(e.transitDays, undefined);
  assert.equal('from' in e, false); // from after to: not a window
  assert.equal(e.verdict, null);
});

test('mover el aterrizaje o elegir otro sitio de la misma búsqueda actualiza la entrada', () => {
  let list = recordMission([], mission());
  list = recordMission(list, mission({ t0: T0 + 36e5, savedAt: 2000 }));
  assert.equal(list.length, 1);
  assert.equal(list[0].t0, T0 + 36e5);
  list = recordMission(list, mission({ siteId: 'gerlache', verdict: 'marginal', savedAt: 3000 }));
  assert.equal(list.length, 1);
  assert.equal(list[0].siteId, 'gerlache');
  assert.equal(list[0].savedAt, 3000);
});

test('cambiar la nave, los requisitos, las alturas, el dónde o la ventana es otra misión', () => {
  const changes = [{ profile: 'rover' }, { days: 14 }, { batteryHours: 24 }, { minEarthPct: 80 }, { maxEarthGapHours: undefined },
    { transitDays: 46 }, { panelHeightM: 20 }, { antennaHeightM: 5 }, { searchSiteId: 'malapert' }, { to: '2027-11-30' }];
  let list = recordMission([], mission());
  for (const c of changes) list = recordMission(list, mission(c));
  assert.equal(list.length, changes.length + 1);
  assert.equal(new Set(list.map(missionKey)).size, list.length);
});

test('la misión más reciente va primero y volver a una antigua la sube', () => {
  let list = recordMission([], mission());
  list = recordMission(list, mission({ days: 14 }));
  assert.deepEqual(list.map(m => m.days), [14, 10]);
  list = recordMission(list, mission({ savedAt: 5000 }));
  assert.deepEqual(list.map(m => m.days), [10, 14]);
  assert.equal(list[0].savedAt, 5000);
});

test('grabar otra vez la misma misión, ya la primera, devuelve la misma lista', () => {
  const list = recordMission([], mission());
  assert.equal(recordMission(list, mission({ savedAt: 9000 })), list);
});

test('cambiar la orientación del panel en la misma misión actualiza la entrada (#254)', () => {
  const first = recordMission([], mission({ panel: 'tracking' }));
  const list = recordMission(first, mission({ panel: 'horizontal', savedAt: 2000 }));
  assert.notEqual(list, first);
  assert.equal(list.length, 1);
  assert.equal(list[0].panel, 'horizontal');
  assert.equal(list[0].savedAt, 2000);
});

test(`el historial guarda como mucho ${MAX_MISSIONS} misiones: sale la más antigua`, () => {
  let list = [];
  for (let i = 1; i <= MAX_MISSIONS + 5; i++) list = recordMission(list, mission({ batteryHours: i }));
  assert.equal(list.length, MAX_MISSIONS);
  assert.equal(list[0].batteryHours, MAX_MISSIONS + 5);
  assert.equal(list.at(-1).batteryHours, 6);
});

test('quitar una misión deja las demás', () => {
  const list = recordMission(recordMission([], mission()), mission({ days: 14 }));
  assert.deepEqual(removeMission(list, missionKey(mission())).map(m => m.days), [14]);
});

test('datos corruptos o que no son una lista dan un historial vacío', () => {
  assert.deepEqual(parseHistory('{no es json'), []);
  assert.deepEqual(parseHistory('{"a":1}'), []);
  assert.deepEqual(parseHistory(null), []);
  assert.deepEqual(parseHistory(JSON.stringify([mission(), { siteId: 3 }, 'x', mission()])), [mission()]);
});

test('el historial se guarda en el almacenamiento y se lee al volver', () => {
  const storage = fakeStorage();
  let clock = 100;
  const history = createMissionHistory(storage, { now: () => clock });
  history.record(mission());
  clock = 200;
  history.record(mission({ days: 14 }));
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEY)).length, 2);
  const again = createMissionHistory(storage);
  assert.deepEqual(again.list().map(m => [m.days, m.savedAt]), [[14, 200], [10, 100]]);
});

test('avisa de cada cambio, y no de grabar lo que ya está', () => {
  const calls = [];
  const history = createMissionHistory(fakeStorage(), { onChange: list => calls.push(list.length) });
  history.record(mission());
  history.record(mission());
  history.record(mission({ days: 14 }));
  history.remove(missionKey(mission()));
  history.clear();
  assert.deepEqual(calls, [1, 2, 1, 0]);
  assert.deepEqual(history.list(), []);
});

test('dos pestañas no se pisan: se lee el almacenamiento antes de cada cambio', () => {
  const storage = fakeStorage();
  const a = createMissionHistory(storage), b = createMissionHistory(storage);
  a.record(mission());
  b.record(mission({ days: 14 }));
  assert.equal(a.list().length, 2);
});

test('sin almacenamiento, o si se niega a escribir, el historial dura la visita y no falla', () => {
  const none = createMissionHistory(null);
  none.record(mission());
  assert.equal(none.list().length, 1);

  const blocked = createMissionHistory({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } });
  blocked.record(mission());
  blocked.record(mission({ days: 14 }));
  assert.equal(blocked.list().length, 2);

  const broken = createMissionHistory({ getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } });
  broken.record(mission());
  assert.equal(broken.list().length, 1);
});

test('una misión guardada antes de la tarjeta «Nave propia» no se duplica al abrirla de nuevo (#251)', () => {
  // Before #251 the own spacecraft was saved without a profile, and an example one changed by hand with the example's id;
  // Plan now opens both as the own spacecraft ('custom') and saves them again under that profile.
  for (const old of [mission({ profile: null, days: 7 }), mission({ days: 12 })]) {
    const list = recordMission([], old);
    const again = recordMission(list, { ...old, profile: 'custom', savedAt: 2000 });
    assert.equal(again.length, 1);
    assert.equal(recordMission([mission({ siteId: 'gerlache' }), ...list], { ...old, profile: 'custom' }).length, 2);
  }
  // An example spacecraft with its own requirements is still that one, not the own spacecraft.
  assert.equal(recordMission(recordMission([], mission()), mission({ profile: 'custom' })).length, 2);
});
