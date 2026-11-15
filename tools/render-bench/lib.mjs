// Pure parts of the render bench (no Chrome, no files): argument parsing, statistics, the image diff metric and
// the assembly of the result line. Tested in tests/render-bench.test.mjs.

// Quality values the home page reads from its URL (home/index.html, "Quality"). null: not sent (the value of the
// level in use, shared/render/quality.js).
export const QUALITY_DEFAULTS = { pr: null, shadow: null, cap: null, tex: null, aniso: null, fs: null, rs: null };
// Quality levels of shared/render/quality.js that --q forces (?q=…). Without --q the page picks one from the device.
export const LEVEL_NAMES = ['alto', 'medio', 'bajo'];
// Key of the level stored by the home page (STORAGE_KEY of shared/render/quality.js; the test checks they match)
export const QUALITY_STORAGE_KEY = 'llsn.quality';
export const DEVICE_DEFAULTS = { w: 1920, h: 1080, dpr: 1, gpu: 'hw', cpu: 1 };
// explore: the «Explorar la Luna» mode of the home page (#135)
export const ZONES = ['menu', 'simulador', 'tour', 'rol', 'explore'];
export const GPU_MODES = ['hw', 'sw', 'default'];

const NUMBER_OPTIONS = ['pr', 'shadow', 'cap', 'aniso', 'fs', 'rs', 'w', 'h', 'dpr', 'cpu', 'secs'];
// The page rounds these and ignores values below 1; the device size must be whole pixels. Only rs accepts 0.
const INTEGER_OPTIONS = ['shadow', 'cap', 'fs', 'w', 'h'];
const ZERO_OPTIONS = ['rs'];
const VALUE_OPTIONS = [...NUMBER_OPTIONS, 'q', 'tex', 'gpu', 'zone', 'shot', 'label', 'url'];
// fresh: removes the stored quality level (llsn.quality, #143) before loading the page; lose: after measuring, forces
// the loss of the WebGL context and reads whether the page shows its notice (#144)
const FLAG_OPTIONS = ['motion', 'nosync', 'fresh', 'lose'];

// Command line → { level, q, dev, zone, secs, motion, sync, fresh, lose, shot, label, url }. level: the --q level, or null. Throws on unknown options or bad values.
export function parseArgs(argv) {
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`Argumento no reconocido: ${argv[i]}`);
    const [, name, inline] = m;
    if (FLAG_OPTIONS.includes(name)) { raw[name] = true; continue; }
    if (!VALUE_OPTIONS.includes(name)) throw new Error(`Opción desconocida: --${name}`);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Falta el valor de --${name}`);
    if (NUMBER_OPTIONS.includes(name)) {
      const n = Number(value);
      if (value === '' || !Number.isFinite(n)) throw new Error(`--${name} tiene que ser un número: ${value}`);
      if (INTEGER_OPTIONS.includes(name) && !(Number.isInteger(n) && n >= 1)) throw new Error(`--${name} tiene que ser un número entero ≥ 1: ${value}`);
      if (ZERO_OPTIONS.includes(name) ? n < 0 : n <= 0) throw new Error(`--${name} tiene que ser un número ${ZERO_OPTIONS.includes(name) ? '≥ 0' : '> 0'}: ${value}`);
      // The page turns rocket shadows off only for rs=0 and keeps them for any other value
      if (name === 'rs' && n !== 0 && n !== 1) throw new Error(`--rs tiene que ser 0 o 1: ${value}`);
      raw[name] = n;
    } else raw[name] = value;
  }
  if (raw.q !== undefined && !LEVEL_NAMES.includes(raw.q)) throw new Error(`--q tiene que ser ${LEVEL_NAMES.join(', ')}: ${raw.q}`);
  if (raw.tex !== undefined && !['2k', '4k'].includes(raw.tex)) throw new Error(`--tex tiene que ser 2k o 4k: ${raw.tex}`);
  if (raw.gpu !== undefined && !GPU_MODES.includes(raw.gpu)) throw new Error(`--gpu tiene que ser ${GPU_MODES.join(', ')}: ${raw.gpu}`);
  if (raw.zone !== undefined && !ZONES.includes(raw.zone)) throw new Error(`--zone tiene que ser ${ZONES.join(', ')}: ${raw.zone}`);
  const pick = defaults => Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, raw[k] ?? d]));
  return {
    level: raw.q ?? null,
    q: pick(QUALITY_DEFAULTS),
    dev: pick(DEVICE_DEFAULTS),
    zone: raw.zone ?? 'menu',
    secs: raw.secs ?? 4,
    motion: !!raw.motion,
    sync: !raw.nosync,
    fresh: !!raw.fresh,
    lose: !!raw.lose,
    shot: raw.shot ?? null,
    label: raw.label ?? '',
    url: raw.url ?? null,
  };
}

// Query string for the home page: the level (if set), the quality values that are set, plus bench.
export function qualityQuery(q, level = null) {
  const params = new URLSearchParams();
  if (level) params.set('q', level);
  for (const [k, v] of Object.entries(q)) if (v !== null && v !== undefined) params.set(k, String(v));
  params.set('bench', '');
  return params.toString().replace(/bench=$/, 'bench');
}

const round = (x, d = 3) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

// Nearest-rank percentiles of a list of times: { p50, p95, max } (nulls if the list is empty).
export function percentiles(values) {
  if (!values.length) return { p50: null, p95: null, max: null };
  const s = [...values].sort((a, b) => a - b);
  const rank = p => s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
  return { p50: round(rank(50)), p95: round(rank(95)), max: round(s[s.length - 1]) };
}

// Frames as [start_ms, duration_ms] → render time and interval between frames.
export function frameStats(frames) {
  const intervals = frames.slice(1).map(([t], i) => t - frames[i][0]);
  return { frames: frames.length, renderMs: percentiles(frames.map(f => f[1])), frameMs: percentiles(intervals) };
}

// Difference between two RGBA buffers of the same size (alpha ignored). meanAbs: mean absolute difference per
// RGB channel (0–255); pctOver8 / pctOver24: % of pixels whose largest channel difference is above 8 / 24.
// Self-contained on purpose: diff.mjs runs it inside Chrome via toString().
export function diffStats(a, b) {
  if (a.length !== b.length || a.length % 4) throw new Error('diffStats: buffers of different size');
  const n = a.length / 4;
  let sum = 0, over8 = 0, over24 = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]), dg = Math.abs(a[i + 1] - b[i + 1]), db = Math.abs(a[i + 2] - b[i + 2]);
    sum += dr + dg + db;
    const m = Math.max(dr, dg, db);
    if (m > 8) over8++;
    if (m > 24) over24++;
  }
  const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  return { meanAbs: r(sum / (n * 3), 4), pctOver8: r((over8 / n) * 100, 4), pctOver24: r((over24 / n) * 100, 4) };
}

// Heat map RGBA of the largest channel difference: black (equal) → red (> 24) → yellow (≥ 96). Self-contained too.
export function heatPixels(a, b) {
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i += 4) {
    const m = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    out[i] = Math.min(255, m * 10);
    out[i + 1] = m > 24 ? Math.min(255, (m - 24) * 3.5) : 0;
    out[i + 2] = 0;
    out[i + 3] = 255;
  }
  return out;
}

// Assembles the JSON line from what the page and the system returned. Invalid measurement (context lost, a
// requested colour texture that failed to load, or an error such as a timeout) → error filled in and exit code 1.
// With --lose the context is lost on purpose after measuring: that loss does not make the measurement invalid.
// lostNotice: whether the page showed its "3D not available" notice after it (null without --lose).
export function buildResult({ opts, page = {}, frames = [], heapMB = null, gpuMemDeltaMiB = null, shot = null, error = null, lostNotice = null }) {
  const gpu = page.gpu ?? {};
  const contextLost = (page.lost ?? 0) > 0 || gpu.lost === true;
  const buffer = gpu.buffer ?? null;
  const stats = frameStats(frames);
  // page.quality: level, where it came from (url | stored | auto), the values in use and, with auto, the calibration
  // measurements and whether not even bajo renders continuously (__bench.quality)
  const quality = page.quality ?? null;
  // page.tex: the colour texture actually in use (the page falls back to 2k if the 4k one fails to load, and to a
  // procedural image, "fallback", if the 2k one fails). Expected: the one asked for, or else the one of the level.
  const wanted = opts.q.tex ?? quality?.values?.tex ?? '4k';
  const used = page.tex === 'fallback' ? 'una procedural' : `la de ${page.tex}`;
  const texError = page.tex && page.tex !== wanted ? `Textura de color de ${wanted} no cargada (se usó ${used})` : null;
  const result = {
    label: opts.label,
    q: opts.q,
    dev: opts.dev,
    zone: opts.zone,
    level: quality?.level ?? null,
    levelSource: quality?.source ?? null,
    calibration: quality?.calibration?.map(c => ({ level: c.level, p50: round(c.p50), p95: round(c.p95) })) ?? null,
    tooSlow: quality?.tooSlow ?? null,
    renderMode: quality?.renderMode ?? null,
    // Pixel ratio governor of the home page (#166): { ratio, frozen, changes: [{ at, from, to }] }
    governor: quality?.governor ?? null,
    readyMs: round(page.readyAt ?? null, 1),
    textureMs: round(page.colorAt ?? null, 1),
    frames: stats.frames,
    renderMs: stats.renderMs,
    frameMs: stats.frameMs,
    megapixels: buffer ? round((buffer[0] * buffer[1]) / 1e6, 2) : null,
    buffer,
    info: page.info ?? null,
    heapMB: round(heapMB, 1),
    gpuRenderer: gpu.renderer ?? null,
    maxTex: gpu.maxTextureSize ?? null,
    gpuMemDeltaMiB,
    contextLost,
    lostNotice,
    shot,
    error: contextLost ? 'WebGL context lost' : error ?? texError,
  };
  return { result, exitCode: result.error ? 1 : 0 };
}

// Chrome command line flags for a GPU mode.
export function chromeFlags(gpu, userDataDir) {
  const base = ['--headless=new', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`];
  const byMode = {
    hw: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl-egl'], // ANGLE on Vulkan loses the context headless (Linux + NVIDIA)
    sw: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    default: [],
  };
  return [...base, ...byMode[gpu]];
}

export const CHROME_CANDIDATES = ['google-chrome-stable', 'google-chrome', 'chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];

// First Chrome that exists: $CHROME, then the candidates. resolve(name) → absolute path or null.
export function findChrome(env, resolve) {
  if (env.CHROME) return resolve(env.CHROME);
  for (const c of CHROME_CANDIDATES) { const p = resolve(c); if (p) return p; }
  return null;
}
