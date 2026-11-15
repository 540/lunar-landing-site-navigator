// Orchestration of the region change (E7.2, #497), with fakes for the page, the storage and the scene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegionChange, FOCUS_KEY } from '../src/region-change.js';
import { ARRIVE_KEY } from '../src/core/region-transition.js';

const T = { progressLabel: 'Carga', loading: n => `Cargando ${n}`, cancel: 'Cancelar', percent: n => `${n} %` };

function fakeEl(id) {
  const listeners = {};
  return {
    id, hidden: false, inert: false, textContent: '', style: {}, attrs: {}, focused: 0, classes: new Set(),
    setAttribute(k, v) { this.attrs[k] = v; },
    focus() { this.focused++; },
    addEventListener(t, f) { (listeners[t] ||= new Set()).add(f); },
    removeEventListener(t, f) { listeners[t]?.delete(f); },
    fire(t, ev = {}) { [...(listeners[t] ?? [])].forEach(f => f(ev)); },
    classList: { add(c) { this.owner.classes.add(c); }, remove(c) { this.owner.classes.delete(c); }, owner: null },
  };
}

function setup({ preload, view, reduced = false } = {}) {
  const ids = ['region-progress', 'region-progress-bar', 'region-progress-fill', 'region-progress-text', 'region-veil', 'region-cancel', 'region-select'];
  const els = Object.fromEntries(ids.map(id => { const e = fakeEl(id); e.classList.owner = e; return [id, e]; }));
  const other = fakeEl('main');
  const doc = { getElementById: id => els[id], body: { children: [other, els['region-progress'], els['region-veil']] } };
  const win = fakeEl('win');
  win.matchMedia = () => ({ matches: reduced });
  const store = new Map();
  const storage = { setItem: (k, v) => store.set(k, v), getItem: k => store.get(k) ?? null };
  const navigated = [];
  let veilOpened = 0;
  const timers = { setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), setInterval: (f, ms) => setInterval(f, ms), clearInterval: t => clearInterval(t) };
  const rc = createRegionChange({
    doc, win, storage, getView: () => view, texts: T, timers,
    preload: preload ?? (async (_id, onProgress) => { onProgress([{ loaded: 5, total: 10, done: false }]); }),
    navigate: id => navigated.push(id), openVeil: () => { veilOpened++; els['region-veil'].classes.delete('is-on'); },
  });
  return { rc, els, other, win, store, navigated, get veilOpened() { return veilOpened; } };
}

const flightOf = () => {
  const f = { cancelled: 0, resolve: null };
  f.done = new Promise(r => { f.resolve = r; });
  f.cancel = async () => { f.cancelled++; };
  return f;
};

test('it navigates once the preload is ready and leaves the arrival marks', async () => {
  const flight = flightOf();
  const s = setup({ view: { quality: { level: 'alto' }, ascend: () => flight } });
  const run = s.rc.change('im2-objetivo', 'IM-2');
  assert.equal(s.els['region-progress'].hidden, false);
  assert.equal(s.els['region-progress-text'].textContent, 'Cargando IM-2');
  assert.equal(s.els['region-cancel'].focused, 1);
  assert.equal(s.other.inert, true);
  assert.equal(s.els['region-progress'].inert, false);
  flight.resolve(true);
  assert.equal(await run, 'navigated');
  assert.deepEqual(s.navigated, ['im2-objetivo']);
  assert.equal(s.store.get(ARRIVE_KEY), 'flight');
  assert.equal(s.store.get(FOCUS_KEY), '1');
  assert.equal(s.els['region-progress-bar'].attrs['aria-valuenow'], '100');
});

test('reduced motion: fade veil, no flight', async () => {
  const s = setup({ reduced: true, view: { quality: { level: 'alto' }, ascend: () => { throw new Error('no flight'); } } });
  assert.equal(await s.rc.change('x', 'X'), 'navigated');
  assert.equal(s.store.get(ARRIVE_KEY), 'fade');
});

test('Escape cancels: the camera goes back, the page comes back and the focus returns to the selector', async () => {
  const flight = flightOf();
  const never = new Promise(() => {});
  const s = setup({ preload: () => never, view: { quality: { level: 'alto' }, ascend: () => flight } });
  const run = s.rc.change('x', 'X');
  s.win.fire('keydown', { key: 'a' });
  s.win.fire('keydown', { key: 'Escape' });
  assert.equal(await run, 'restored');
  assert.equal(flight.cancelled, 1);
  assert.equal(s.els['region-progress'].hidden, true);
  assert.equal(s.other.inert, false);
  assert.equal(s.els['region-select'].focused, 1);
  assert.equal(s.rc.changing, false);
  assert.deepEqual(s.navigated, []);
  assert.equal(s.store.has(ARRIVE_KEY), false);
});

test('the Cancel button cancels the fade and opens the veil', async () => {
  const never = new Promise(() => {});
  const s = setup({ preload: () => never, view: null });
  const run = s.rc.change('x', 'X');
  assert.ok(s.els['region-veil'].classes.has('is-on'));
  s.els['region-cancel'].fire('click');
  assert.equal(await run, 'restored');
  assert.equal(s.veilOpened, 1);
  assert.ok(!s.els['region-veil'].classes.has('is-on'));
});

test('a failed preload still navigates', async () => {
  const s = setup({ view: null, preload: async () => { throw new Error('offline'); } });
  assert.equal(await s.rc.change('x', 'X'), 'navigated');
  assert.deepEqual(s.navigated, ['x']);
});

test('pageshow from the bfcache undoes a change in progress; a normal pageshow does not', async () => {
  const flight = flightOf();
  const never = new Promise(() => {});
  const s = setup({ preload: () => never, view: { quality: { level: 'alto' }, ascend: () => flight } });
  s.rc.change('x', 'X');
  s.win.fire('pageshow', { persisted: false });
  assert.equal(s.els['region-progress'].hidden, false);
  s.win.fire('pageshow', { persisted: true });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(s.els['region-progress'].hidden, true);
  assert.equal(s.other.inert, false);
  assert.equal(flight.cancelled, 1);
  assert.equal(s.rc.changing, false);
});
