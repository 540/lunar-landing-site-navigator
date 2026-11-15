// Transition around a region change (E7.2, #497).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ascentPose, descentPose, ascentEnd, descentStart, preloadProgress, createPreloadProgress, transitionMode, settlePreload, decideChange, parseArrival, ASCENT_KM } from '../src/core/region-transition.js';
import { GROUND_MARGIN_KM } from '../src/core/camera-limits.js';
import { dronePose } from '../src/core/drone-pose.js';
import { readFileSync } from 'node:fs';
import { preloadRegion } from '../src/region.js';
import { TEXTS } from '../src/texts.js';
import { EN } from '../src/texts.en.js';

const hills = (x, z) => 0.4 * Math.sin(x / 3) + 0.3 * Math.cos(z / 2);
const initial = dronePose({ x: 1.2, z: -0.7 }, 229.72, hills);
const from = { position: { x: 2, y: 1.4, z: 1 }, target: { x: 0, y: 0.2, z: 0 } };
const ks = Array.from({ length: 101 }, (_, i) => i / 100);

test('ascent: starts and ends exactly in its poses and goes up', () => {
  assert.deepEqual(ascentPose(from, 0, hills), from);
  assert.deepEqual(ascentPose(from, 1, hills), ascentEnd(from));
  assert.equal(ascentEnd(from).position.y, from.position.y + ASCENT_KM);
  const ys = ks.map(k => ascentPose(from, k, hills).position.y);
  ys.forEach((y, i) => i && assert.ok(y >= ys[i - 1]));
});

test('descent: starts and ends exactly in its poses and goes down', () => {
  assert.deepEqual(descentPose(initial, 0, hills), descentStart(initial));
  assert.deepEqual(descentPose(initial, 1, hills), initial);
  const ys = ks.map(k => descentPose(initial, k, hills).position.y);
  ys.forEach((y, i) => i && assert.ok(y <= ys[i - 1]));
});

test('both paths stay above the ground plus the margin', () => {
  const slope = x => 2 + Math.max(0, x); // a slope under the way
  const low = { position: { x: 0, y: 2.1, z: 0 }, target: { x: 4, y: 6, z: 0 } };
  const cases = [[hills, k => ascentPose(from, k, hills)], [hills, k => descentPose(initial, k, hills)], [slope, k => ascentPose(low, k, slope)]];
  for (const [g, at] of cases) {
    for (const k of ks.slice(1)) { // k = 0 is the pose it starts from, as it is
      const { position: p } = at(k);
      assert.ok(p.y >= g(p.x, p.z) + GROUND_MARGIN_KM - 1e-9, `k=${k}`);
    }
  }
});

test('progress by bytes goes from 0 to 1', () => {
  const files = [{ loaded: 0, total: 100 }, { loaded: 0, total: 300 }];
  assert.equal(preloadProgress(files), 0);
  files[0].loaded = 100; files[0].done = true;
  assert.equal(preloadProgress(files), 0.25);
  files[1].loaded = 150;
  assert.equal(preloadProgress(files), 0.625);
  files[1].loaded = 300; files[1].done = true;
  assert.equal(preloadProgress(files), 1);
  assert.equal(preloadProgress([]), 0);
});

test('progress without a known size advances per finished file', () => {
  const files = [{ loaded: 10 }, { loaded: 0, total: 0 }, { loaded: 5, total: 0 }];
  assert.equal(preloadProgress(files), 0);
  files[1].done = true;
  assert.equal(preloadProgress(files), 1 / 3);
  files.forEach(f => { f.done = true; });
  assert.equal(preloadProgress(files), 1);
});

test('the tracked progress never goes back', () => {
  const p = createPreloadProgress();
  assert.equal(p.update([{ loaded: 50, total: 100 }]), 0.5);
  assert.equal(p.update([{ loaded: 50, total: 100 }, { loaded: 0, total: 300 }]), 0.5); // a new file: the ratio would drop
  assert.equal(p.update([{ loaded: 100, total: 100, done: true }, { loaded: 300, total: 300, done: true }]), 1);
  assert.equal(p.update([{ loaded: 0, total: 100 }]), 1);
});

test('reduced motion or low quality choose the fade', () => {
  assert.equal(transitionMode({ reducedMotion: true, qualityLevel: 'alto' }), 'fade');
  assert.equal(transitionMode({ reducedMotion: false, qualityLevel: 'bajo' }), 'fade');
  assert.equal(transitionMode({ reducedMotion: false, qualityLevel: 'medio', hasScene: false }), 'fade');
  assert.equal(transitionMode({ reducedMotion: false, qualityLevel: 'alto' }), 'flight');
  assert.equal(transitionMode({ reducedMotion: false, qualityLevel: 'medio' }), 'flight');
});

test('a failed or late preload still lets it navigate; it never rejects', async () => {
  assert.equal(await settlePreload(Promise.resolve(1)), 'ready');
  assert.equal(await settlePreload(Promise.reject(new Error('HTTP 404'))), 'failed');
  assert.equal(await settlePreload(new Promise(() => {}), 10), 'timeout');
});

test('the arrival flag only accepts the two modes', () => {
  assert.equal(parseArrival('flight'), 'flight');
  assert.equal(parseArrival('fade'), 'fade');
  assert.equal(parseArrival(null), null);
  assert.equal(parseArrival('x'), null);
});

test('texts of the transition in both languages', () => {
  for (const T of [TEXTS, EN]) {
    const t = T.regionTransition;
    assert.ok(t && typeof t.loading('A') === 'string' && typeof t.percent(50) === 'string' && t.progressLabel);
  }
});

test('decideChange: navigates whatever the outcome of the preload, restores only when cancelled', () => {
  for (const outcome of ['ready', 'failed', 'timeout']) assert.equal(decideChange({ outcome, cancelled: false }), 'navigate');
  assert.equal(decideChange({ outcome: 'ready', cancelled: true }), 'restore');
  assert.equal(decideChange({ outcome: null, cancelled: true }), 'restore');
  assert.equal(decideChange({ outcome: null }), 'restore');
});

const metaText = readFileSync(new URL('../data/shackleton-rim/meta.json', import.meta.url), 'utf8');
const fakeFetch = (missing = []) => async url => {
  const file = String(url).split('/').pop();
  if (file === 'meta.json') return { ok: true, json: async () => JSON.parse(metaText) };
  if (missing.includes(file)) return { ok: false, status: 404 };
  const chunks = [new Uint8Array(40), new Uint8Array(60)];
  return { ok: true, headers: new Map([['content-length', '100']]), body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }) }) } };
};

test('preloadRegion: progress per file, all done at the end', async t => {
  t.mock.method(globalThis, 'fetch', fakeFetch());
  const seen = [];
  await preloadRegion('shackleton-rim', files => seen.push(files));
  const last = seen.at(-1);
  assert.ok(last.length >= 5 && last.every(f => f.done && f.loaded === 100));
});

test('preloadRegion: a missing detail grid does not fail it, a missing relief does', async t => {
  t.mock.method(globalThis, 'fetch', fakeFetch(['terrain-lod3.bin']));
  await preloadRegion('shackleton-rim');
  t.mock.method(globalThis, 'fetch', fakeFetch(['terrain-lod0.bin']));
  await assert.rejects(preloadRegion('shackleton-rim'));
});

test('preloadRegion: rejects when it aborts', async t => {
  const abort = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => { abort.abort(); signal.throwIfAborted(); });
  await assert.rejects(preloadRegion('shackleton-rim', () => {}, abort.signal));
});
