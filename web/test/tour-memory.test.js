// What the guided tour remembers (#205): seen tours and the «No mostrar más tutoriales» switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEEN_KEY, DISABLED_KEY, seenViews, markSeen, autoToursDisabled, disableAutoTours, shouldAutoStart } from '../js/common/tour-memory.js';

function fakeStorage() {
  const data = new Map();
  return { data, getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}
const brokenStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
function withStorage(storage, run) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try { run(storage); } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before); else delete globalThis.localStorage;
  }
}

test('a tour opens by itself only until it has been seen', () => withStorage(fakeStorage(), () => {
  assert.equal(shouldAutoStart('home'), true);
  markSeen('home');
  assert.equal(shouldAutoStart('home'), false);
  assert.equal(shouldAutoStart('tour'), true, 'other screens still show theirs');
  assert.deepEqual(seenViews(), { home: true });
}));

test('«No mostrar más tutoriales» turns off the automatic tour of every screen and view', () => withStorage(fakeStorage(), storage => {
  disableAutoTours();
  assert.equal(autoToursDisabled(), true);
  for (const id of ['home', 'plan', 'advanced', 'tour', 'juego']) assert.equal(shouldAutoStart(id), false, id);
  assert.equal(storage.data.get(DISABLED_KEY), '1', 'kept in localStorage');
  assert.equal(storage.data.has(SEEN_KEY), false, 'it does not mark the tours as seen');
}));

test('the choice survives a reload: it is read back from localStorage', () => withStorage(fakeStorage(), storage => {
  storage.data.set(DISABLED_KEY, '1');
  assert.equal(shouldAutoStart('home'), false);
}));

test('without localStorage nothing fails and the tours behave as on a first visit', () => {
  for (const storage of [brokenStorage, undefined]) withStorage(storage, () => {
    assert.doesNotThrow(() => { disableAutoTours(); markSeen('home'); });
    assert.equal(autoToursDisabled(), false);
    assert.equal(shouldAutoStart('home'), true);
  });
});

test('a corrupt value in localStorage does not break the tours', () => withStorage(fakeStorage(), storage => {
  storage.data.set(SEEN_KEY, '{not json');
  assert.deepEqual(seenViews(), {});
  assert.equal(shouldAutoStart('home'), true);
}));
