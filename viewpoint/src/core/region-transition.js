// Transition around a region change (E7.2, #497): the camera rises, the destination preloads with a progress bar, the
// camera comes down over the new region. Pure: no three.js, no DOM, no timers of its own.
import { glidePose } from './drone-pose.js';
import { clampAboveGround } from './camera-limits.js';

export const ASCENT_KM = 6; // how far the camera rises above where it is
export const DESCENT_FROM_KM = 6; // the arrival starts this high above the initial pose of the drone
export const ASCENT_MS = 1000;
export const DESCENT_MS = 1200;
export const FADE_MS = 300;
export const PRELOAD_TIMEOUT_MS = 6000; // after this, it navigates anyway

const lift = (pose, km) => ({ position: { ...pose.position, y: pose.position.y + km }, target: { ...pose.target } });

/** Keeps the camera above the relief (plus the margin of camera-limits.js) in the frames between the two ends. */
function pathBetween(from, to, k, groundAt) {
  if (k <= 0) return { position: { ...from.position }, target: { ...from.target } };
  if (k >= 1) return { position: { ...to.position }, target: { ...to.target } };
  const pose = glidePose(from, to, k);
  return { position: clampAboveGround(pose.position, groundAt), target: pose.target };
}

/** Pose the ascent ends at: straight up from `from`. */
export const ascentEnd = from => lift(from, ASCENT_KM);

/** Pose the descent starts at: straight above `initial`. */
export const descentStart = initial => lift(initial, DESCENT_FROM_KM);

/**
 * Pose of the ascent at progress `k` (0 to 1): exactly `from` at 0 and `ascentEnd(from)` at 1, going up.
 * @param {{position:{x:number,y:number,z:number}, target:{x:number,y:number,z:number}}} from pose of the camera when it starts
 * @param {number} k
 * @param {(x:number, z:number) => number} groundAt
 */
export const ascentPose = (from, k, groundAt) => pathBetween(from, ascentEnd(from), k, groundAt);

/** Pose of the descent at progress `k`: exactly `descentStart(initial)` at 0 and `initial` at 1. */
export const descentPose = (initial, k, groundAt) => pathBetween(descentStart(initial), initial, k, groundAt);

/**
 * Progress (0 to 1) of the preload of several files: `{ loaded, total, done }` each, `total` 0 or missing if unknown.
 * With every size known it is bytes loaded over bytes total; with any unknown, files finished over files.
 */
export function preloadProgress(files) {
  if (!files.length) return 0;
  const clamp = v => Math.min(1, Math.max(0, v));
  if (files.every(f => f.total > 0)) {
    const total = files.reduce((s, f) => s + f.total, 0);
    const loaded = files.reduce((s, f) => s + (f.done ? f.total : Math.min(f.loaded ?? 0, f.total)), 0);
    return clamp(loaded / total);
  }
  return clamp(files.filter(f => f.done).length / files.length);
}

/** A progress that never goes back: `update(files)` returns the maximum seen so far. */
export function createPreloadProgress() {
  let best = 0;
  return { update(files) { best = Math.max(best, preloadProgress(files)); return best; }, get value() { return best; } };
}

/** «fade» with reduced motion or low quality; «flight» otherwise. */
export function transitionMode({ reducedMotion = false, qualityLevel = 'medio', hasScene = true } = {}) {
  return reducedMotion || qualityLevel === 'bajo' || !hasScene ? 'fade' : 'flight';
}

/**
 * How the preload ended: 'ready', 'failed' (it rejected) or 'timeout'. It never rejects: whatever the outcome the page
 * navigates, so the screen never hangs. `wait` is injected for tests.
 */
export function settlePreload(preload, timeoutMs = PRELOAD_TIMEOUT_MS, wait = (ms, fn) => setTimeout(fn, ms), clear = clearTimeout) {
  return new Promise(resolve => {
    const timer = wait(timeoutMs, () => resolve('timeout'));
    Promise.resolve(preload).then(() => resolve('ready'), () => resolve('failed')).finally(() => clear(timer));
  });
}

/** The page it navigates to knows it comes from a region change by this value of the session storage. */
export const ARRIVE_KEY = 'viewpoint-region-arrive';
export const parseArrival = raw => (raw === 'flight' || raw === 'fade' ? raw : null);

/**
 * What the region change does once the preload is over: 'navigate' (ready, failed or timed out: it navigates anyway) or
 * 'restore' (cancelled by the user: camera back, veil open). `outcome` is null when it was cancelled before any outcome.
 */
export const decideChange = ({ outcome, cancelled = false }) => (cancelled || !outcome ? 'restore' : 'navigate');
