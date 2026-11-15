// Render quality levels (#142, epic #138): what each level draws, which level a device starts at, how a short
// measurement moves it (#143), how the chosen level is stored, when the home page draws (#144) and how its pixel
// ratio follows the frame times (#166).
// Pure: no DOM, no three.js and no window; everything comes in as arguments, so node:test can check it
// (tests/quality.test.mjs). Used by home/index.html, viewpoint/src/scene.js and web/js/common/sky3d.js.

// Values measured in the epic #138. pr: pixel ratio cap; shadow: side of the Sun shadow map; cap: grid of the
// polar cap; tex: colour texture; aniso: anisotropy cap; fs: samples of the polar average; rs: rocket shadows.
export const LEVELS = Object.freeze({
  bajo: Object.freeze({ pr: 1.25, shadow: 2048, cap: 230, tex: '2k', aniso: 8, fs: 8, rs: false }),
  medio: Object.freeze({ pr: 1.5, shadow: 3072, cap: 320, tex: '4k', aniso: 4, fs: 16, rs: true }),
  alto: Object.freeze({ pr: 2, shadow: 4096, cap: 460, tex: '4k', aniso: 16, fs: 16, rs: true }),
});

// Cap of painted pixels (3840 × 2160), in every level (#325)
export const MAX_PIXELS = 8294400;

const SOFTWARE_RENDERERS = ['swiftshader', 'llvmpipe', 'softpipe', 'software', 'basic render'];

// true if the WebGL renderer name (WEBGL_debug_renderer_info) is a software one
export function isSoftwareRenderer(name) {
  if (typeof name !== 'string') return false;
  const n = name.toLowerCase();
  return SOFTWARE_RENDERERS.some(s => n.includes(s));
}

// Signals for initialLevel from a WebGL context and an object shaped like navigator (both can be fakes in tests).
// Without WEBGL_debug_renderer_info the name comes from gl.RENDERER (Firefox gives a sanitized real name there); an
// unknown name does not count, so softwareRenderer is false. A field the browser does not give stays undefined.
export function readSignals(gl, nav = {}) {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    softwareRenderer: isSoftwareRenderer(String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    saveData: nav?.connection?.saveData,
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
  };
}

const isNumber = x => typeof x === 'number' && Number.isFinite(x);

// Level to start at: "bajo" if any signal says the device is modest, "alto" otherwise. A missing signal does not
// count. Without ?q= or a stored level the home page measures the device from calibrationStart (#143).
export function initialLevel(signals = {}) {
  const { softwareRenderer, maxTextureSize, saveData, deviceMemory, hardwareConcurrency } = signals;
  const modest = softwareRenderer === true
    || (isNumber(maxTextureSize) && maxTextureSize < 4096)
    || saveData === true
    || (isNumber(deviceMemory) && deviceMemory <= 4)
    || (isNumber(hardwareConcurrency) && hardwareConcurrency <= 4);
  return modest ? 'bajo' : 'alto';
}

// Pixel ratio for a canvas of cssWidth × cssHeight: the level cap (or maxRatio, from ?pr=) and the screen
// density, and no more than MAX_PIXELS painted pixels in any level (#325: before, only in alto, so medio painted more
// than alto on a 5K screen).
export function pixelRatio(level, cssWidth, cssHeight, devicePixelRatio, maxRatio = LEVELS[level].pr) {
  let ratio = Math.min(maxRatio, devicePixelRatio > 0 ? devicePixelRatio : 1);
  const area = cssWidth * cssHeight;
  if (area > 0) ratio = Math.min(ratio, Math.sqrt(MAX_PIXELS / area));
  return ratio;
}

// Number knob: a non-numeric or <= 0 value is ignored. Integer knobs are rounded first, so 0.4 is ignored too.
function num(params, key) {
  if (!params.has(key)) return undefined;
  const v = Number(params.get(key));
  return Number.isFinite(v) && v > 0 ? v : undefined;
}
function int(params, key) {
  const v = num(params, key);
  if (v === undefined) return undefined;
  const r = Math.round(v);
  return r >= 1 ? r : undefined;
}

// Values of a level with the bench knobs of the URL (pr, shadow, cap, tex, aniso, fs, rs) on top.
export function levelValues(level, params) {
  const values = { ...LEVELS[level] };
  const knobs = { pr: num(params, 'pr'), shadow: int(params, 'shadow'), cap: int(params, 'cap'), aniso: num(params, 'aniso'), fs: int(params, 'fs') };
  for (const [k, v] of Object.entries(knobs)) if (v !== undefined) values[k] = v;
  const tex = params.get('tex');
  if (tex === '2k' || tex === '4k') values.tex = tex;
  // rs=0 turns rocket shadows off; any other value turns them on
  if (params.has('rs')) values.rs = params.get('rs') !== '0';
  return values;
}

const isLevel = x => typeof x === 'string' && Object.hasOwn(LEVELS, x);

// Level and values. Precedence: q of the URL ("url"), then the stored level ("stored", see decodeStored), then
// calibrationStart(signals) ("auto": the home page measures the device from there).
// params: URLSearchParams or anything with has() and get(). → { level, source: "url" | "stored" | "auto", values }
export function resolveQuality({ params, signals = {}, stored = null }) {
  const q = params.get('q');
  const [level, source] = isLevel(q) ? [q, 'url'] : isLevel(stored) ? [stored, 'stored'] : [calibrationStart(signals), 'auto'];
  return { level, source, values: levelValues(level, params) };
}

// ---------- Calibration (#143) ----------
// Thresholds in ms of the time of one frame (render plus GPU sync), measured on an RTX 3060 for the epic #138.
// No rule on the 95th percentile (#325): the noise of the page load triggered it on devices with room to spare; the
// pixel ratio governor (#166) covers later hitches.
export const THRESHOLDS = Object.freeze({ upMs: 5, altoDownMs: 8, medioDownMs: 11, tooSlowMs: 33 });

// Nearest-rank median and 95th percentile of a list of frame times (ms). → { p50, p95 } (nulls if empty)
export function frameStats(samplesMs) {
  const s = samplesMs.filter(isNumber).sort((a, b) => a - b);
  if (!s.length) return { p50: null, p95: null };
  const rank = p => s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
  return { p50: rank(50), p95: rank(95) };
}

// Of two batches of frame stats of the same level ({ p50, p95 } or null), the one with the lower median (#325): what
// the device managed once, it can do, and a load spike should not lower the level. A batch that is null or without
// p50 does not count; with neither, null.
export function bestBatch(a, b) {
  const ok = x => !!x && isNumber(x.p50);
  if (!ok(a)) return ok(b) ? b : null;
  if (!ok(b)) return a;
  return b.p50 < a.p50 ? b : a;
}

// Stats of one level's measurement (#325) from its frame times: warm (warm-up frames), batches (the measured
// batches, in order) and cut (the time ran out; then the last batch is the one it cut, maybe empty, or there is none
// if the cut came during the warm-up). The best full batch (bestBatch); a cut batch counts only when no batch ended,
// so a handful of frames does not override a full batch; with neither, the warm-up frames. → { p50, p95 } (nulls if
// nothing was measured).
export function measuredStats({ warm = [], batches = [], cut = false }) {
  const full = cut ? batches.slice(0, -1) : batches;
  const best = full.map(frameStats).reduce(bestBatch, null);
  if (best) return best;
  const partial = cut && batches.length ? frameStats(batches[batches.length - 1]) : null;
  return bestBatch(partial, null) ?? frameStats(warm);
}

// Where one measurement of a level points (only its median counts). → { level, tooSlow }; tooSlow: not even bajo
// renders continuously.
export function calibrationStep(level, { p50 }) {
  const T = THRESHOLDS;
  if (level === 'bajo') {
    if (p50 <= T.upMs) return { level: 'medio', tooSlow: false };
    return { level: 'bajo', tooSlow: p50 > T.tooSlowMs };
  }
  if (level === 'medio') {
    if (p50 <= T.upMs) return { level: 'alto', tooSlow: false };
    if (p50 > T.medioDownMs) return { level: 'bajo', tooSlow: false };
    return { level: 'medio', tooSlow: false };
  }
  return { level: p50 > T.altoDownMs ? 'medio' : 'alto', tooSlow: false };
}

// First level to measure: bajo on a device the signals call modest, medio otherwise.
export function calibrationStart(signals = {}) {
  return initialLevel(signals) === 'bajo' ? 'bajo' : 'medio';
}

const RANK = { bajo: 0, medio: 1, alto: 2 };
export const MAX_CALIBRATIONS = 2;

// Next level to measure, or null once decided. history: [{ level, stats }] already measured, in order; start: the
// level of the first measurement (calibrationStart). At most two measurements: the second only if the first one
// points to another level.
export function nextCalibration(history, start = 'medio') {
  if (!history.length) return start;
  if (history.length >= MAX_CALIBRATIONS) return null;
  const [{ level, stats }] = history;
  const step = calibrationStep(level, stats);
  return step.level === level ? null : step.level;
}

// Level the measurements decide. → { level, tooSlow } (level null with an empty history). If the second
// measurement contradicts the first (it went up and the new level asks to go down, or the other way round), the
// lower of the two measured levels stays: no back and forth. A level that was not measured is never chosen.
export function calibrationResult(history) {
  if (!history.length) return { level: null, tooSlow: false };
  const [first, second] = history;
  const s1 = calibrationStep(first.level, first.stats);
  if (!second) return s1;
  const s2 = calibrationStep(second.level, second.stats);
  const dir1 = Math.sign(RANK[s1.level] - RANK[first.level]), dir2 = Math.sign(RANK[s2.level] - RANK[second.level]);
  if (dir2 !== 0 && dir2 === -dir1) {
    const lower = RANK[first.level] < RANK[second.level] ? first : second;
    return { level: lower.level, tooSlow: lower === second && s2.tooSlow };
  }
  return { level: second.level, tooSlow: s2.tooSlow };
}

// What the home page does once the calibration ends. history: [{ level, stats }] as measured (a measurement cut by
// the time cap is in it if at least one frame ended); cut: the cap stopped it; current: the level in use then.
// → { level, tooSlow, store }. Not cut: the level calibrationResult() decides, stored. Cut: the level in use stays
// for this load, and it is stored only if the cut measurement was of that level and already points to it (as on a
// software renderer, slow in bajo). If the cut measurement was of that level and asks to go down, the lower level is
// taken and stored: going down is the safe direction, and a few frames over the threshold already show it. If it
// asked to go up or was not of the level in use, the level in use stays and the next visit measures again.
export function calibrationOutcome(history, { cut, current }) {
  if (!cut) {
    const r = calibrationResult(history);
    return { level: r.level ?? current, tooSlow: r.tooSlow, store: true };
  }
  const last = history[history.length - 1];
  const s = last && last.level === current ? calibrationStep(last.level, last.stats) : null;
  if (s && RANK[s.level] < RANK[current]) return { level: s.level, tooSlow: s.tooSlow, store: true };
  const agrees = !!s && s.level === current;
  return { level: current, tooSlow: agrees && s.tooSlow, store: agrees };
}

// ---------- Stored level ----------
export const STORAGE_KEY = 'llsn.quality';
// How long a stored level lasts: alto, 7 days; medio or bajo, 1 day, so a pessimistic calibration is put right on
// the next day's visit (#325).
export const STORED_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export const STORED_LOW_MAX_AGE_MS = 24 * 3600 * 1000;

// { level, renderer, at, tooSlow? } → string for localStorage. renderer: WebGL renderer name; at: ms since the
// epoch; tooSlow (#144): the calibration said not even bajo renders continuously (stored only when true).
export function encodeStored({ level, renderer, at, tooSlow }) {
  return JSON.stringify(tooSlow === true ? { level, renderer, at, tooSlow } : { level, renderer, at });
}

// The stored record if it is valid, of this renderer and not older than its level allows (alto: STORED_MAX_AGE_MS;
// medio or bajo: STORED_LOW_MAX_AGE_MS); null otherwise.
function storedRecord(raw, { renderer, now }) {
  if (typeof raw !== 'string') return null;
  let v;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object' || !isLevel(v.level) || typeof v.renderer !== 'string' || !isNumber(v.at)) return null;
  if (v.renderer !== renderer) return null;
  const age = now - v.at;
  if (!(age >= 0 && age <= (v.level === 'alto' ? STORED_MAX_AGE_MS : STORED_LOW_MAX_AGE_MS))) return null;
  return v;
}

// Stored level, or null if the string is not valid, was saved with another renderer or is too old (see storedRecord).
export function decodeStored(raw, { renderer, now }) {
  return storedRecord(raw, { renderer, now })?.level ?? null;
}

// true only if the stored record is valid (same rules as decodeStored) and says tooSlow (#144).
export function decodeStoredTooSlow(raw, { renderer, now }) {
  return storedRecord(raw, { renderer, now })?.tooSlow === true;
}

// ---------- Render mode (#144) ----------
// How long the home page keeps drawing after the last activity in onDemand mode (ms).
export const WAKE_MS = 1200;

// "onDemand" (draw only after activity: a still image the rest of the time) on a software renderer, a device too
// slow for continuous rendering or with prefers-reduced-motion; "continuous" otherwise.
export function renderMode({ softwareRenderer, tooSlow, reducedMotion } = {}) {
  return softwareRenderer === true || tooSlow === true || reducedMotion === true ? 'onDemand' : 'continuous';
}

// Whether a frame is drawn: always in continuous mode; in onDemand, while something animates or until awakeUntil
// (the last activity plus WAKE_MS).
export function shouldRender({ mode, now, awakeUntil, animating }) {
  if (mode !== 'onDemand') return true;
  return animating === true || now < awakeUntil;
}

// How close an eased value must be to its target to count as settled.
export const SETTLE = 0.005;

// Whether every eased value has reached its target ([value, target] pairs) and now >= holdUntil (an effect that runs
// for a fixed time, such as the touchdown dust). While false, the home page keeps an onDemand loop awake so the
// still image is never one caught halfway.
export function settledEased({ eased = [], holdUntil = 0, now }) {
  return now >= holdUntil && eased.every(([value, target]) => Math.abs(target - value) < SETTLE);
}

// ---------- Pixel ratio governor (#166) ----------
// While the home page draws continuously, the pixel ratio goes down one step when frames run late and up again when
// they run with room to spare; the level (shadow, grid, texture) does not change. Times in ms; windows of
// windowFrames intervals between painted frames.
export const GOVERNOR = Object.freeze({
  steps: Object.freeze([1, 1.25, 1.5, 2]),
  windowFrames: 60,
  slowMs: 20,
  slowShare: 0.75,
  fastMs: 18,
  fastShare: 0.95,
  slowWindowsToDrop: 2,
  fastMsToRaise: 5000,
  cooldownMs: 3000,
  relapseMs: 10000,
  vetoMs: 30000,
  minGain: 0.1,
});

// Pixel ratio steps up to maxRatio: the GOVERNOR steps that do not exceed it, plus maxRatio itself, sorted. The fixed
// step just below maxRatio is dropped when it saves too few pixels ((s / maxRatio)² > 1 − minGain): going down to it
// could never improve the frame time by minGain, and the governor would freeze for nothing. Below 1 (out of scope: the
// governor never goes under 1) the only step is maxRatio.
export function governorSteps(maxRatio) {
  const max = isNumber(maxRatio) && maxRatio > 0 ? maxRatio : 1;
  if (max < 1) return [max];
  const steps = GOVERNOR.steps.filter(s => s < max).sort((a, b) => a - b);
  const below = steps[steps.length - 1];
  if (below !== undefined && (below / max) ** 2 > 1 - GOVERNOR.minGain) steps.pop();
  steps.push(max);
  return steps;
}

// Initial state, at the highest step. index: step in use; slowRun: slow windows in a row; fastMs: time of fast
// windows in a row; changedAt: time of the last change; check: after going down, { from, median } to compare the next
// valid window with; raisedAt: time of the last raise (for a relapse); vetoes: { [index]: { count, until } }.
export function governorInit(maxRatio) {
  const steps = governorSteps(maxRatio);
  return Object.freeze({
    steps, index: steps.length - 1, frozen: false, slowRun: 0, fastMs: 0, changedAt: -Infinity,
    check: null, raisedAt: null, vetoes: Object.freeze({}),
  });
}

// Pixel ratio of a governor state.
export function governorRatio(state) {
  return state.steps[state.index];
}

// The same governor for a new top (the cap of the level moved: window size in alto, screen density). Keeps what it
// learnt: frozen, a drop and the vetoes. At its top it stays at the new top; below it, on the highest new step that is
// not above the ratio in use. Vetoes and the pending check move by ratio to the highest new step not above theirs.
export function governorRetop(state, maxRatio) {
  const steps = governorSteps(maxRatio);
  const old = state.steps;
  if (steps.length === old.length && steps.every((s, i) => s === old[i])) return state;
  const at = ratio => {
    let i = 0;
    while (i + 1 < steps.length && steps[i + 1] <= ratio) i++;
    return i;
  };
  const index = state.index === old.length - 1 ? steps.length - 1 : at(old[state.index]);
  const vetoes = {};
  for (const [k, v] of Object.entries(state.vetoes)) {
    const j = at(old[k]), prev = vetoes[j];
    vetoes[j] = Object.freeze(prev ? { count: Math.max(prev.count, v.count), until: Math.max(prev.until, v.until) } : v);
  }
  const from = state.check ? at(old[state.check.from]) : null;
  const check = state.check && from !== index ? Object.freeze({ ...state.check, from }) : null;
  return Object.freeze({ ...state, steps, index, check, vetoes: Object.freeze(vetoes) });
}

// What a window of frame intervals says. → { slow, fast, median, duration }
function governorWindow(samples) {
  const s = samples.filter(isNumber);
  const share = test => s.filter(test).length / s.length;
  return {
    slow: share(x => x > GOVERNOR.slowMs) >= GOVERNOR.slowShare,
    fast: share(x => x < GOVERNOR.fastMs) >= GOVERNOR.fastShare,
    median: frameStats(s).p50,
    duration: s.reduce((a, b) => a + b, 0),
  };
}

const vetoed = (state, index, now) => {
  const v = state.vetoes[index];
  return !!v && now < v.until;
};

// One window of frame intervals (ms) through the governor. Pure: the state comes in and a new one goes out.
// { samples, tainted }: tainted windows (resize, tab back, texture load, camera move…) do not count and reset the
// slow and fast counters. now: time at the end of the window. → { state, ratio }; ratio: the new pixel ratio, or
// null if it does not change.
export function governorStep(state, { samples = [], tainted = false } = {}, now) {
  const G = GOVERNOR;
  const same = { state, ratio: null };
  if (state.frozen) return same;
  if (tainted) return { state: Object.freeze({ ...state, slowRun: 0, fastMs: 0 }), ratio: null };
  if (!samples.some(isNumber)) return same;
  // Right after a change the window is not trusted, whatever it says
  if (now - state.changedAt < G.cooldownMs) return same;
  const w = governorWindow(samples);
  const change = (next, extra = {}) => {
    const s = Object.freeze({ ...state, index: next, slowRun: 0, fastMs: 0, changedAt: now, check: null, raisedAt: null, ...extra });
    return { state: s, ratio: governorRatio(s) };
  };

  // After going down: the first valid window has to improve the median by minGain; if not, the pixels were not the
  // limit (a 30 Hz screen, power saving, the CPU) and the governor goes back up and stops for good
  if (state.check) {
    if (!(w.median <= state.check.median * (1 - G.minGain))) return change(state.check.from, { frozen: true });
    state = Object.freeze({ ...state, check: null });
  }

  // Slow soon after going up: back down at once, and that step is vetoed (vetoMs the first time, for good the second)
  if (w.slow && state.raisedAt !== null && now - state.raisedAt <= G.relapseMs && state.index > 0) {
    const up = state.index, count = (state.vetoes[up]?.count ?? 0) + 1;
    const vetoes = Object.freeze({ ...state.vetoes, [up]: Object.freeze({ count, until: count >= 2 ? Infinity : now + G.vetoMs }) });
    return change(up - 1, { vetoes });
  }

  const slowRun = w.slow ? state.slowRun + 1 : 0;
  const fastMs = w.fast ? state.fastMs + w.duration : 0;
  if (slowRun >= G.slowWindowsToDrop && state.index > 0) {
    return change(state.index - 1, { check: Object.freeze({ from: state.index, median: w.median }) });
  }
  if (fastMs >= G.fastMsToRaise && state.index < state.steps.length - 1 && !vetoed(state, state.index + 1, now)) {
    return change(state.index + 1, { raisedAt: now });
  }
  return { state: Object.freeze({ ...state, slowRun, fastMs }), ratio: null };
}
