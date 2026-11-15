// Render quality levels (shared/render/quality.js, #142), the calibration and the stored level (#143) and how
// home/index.html uses them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOVERNOR, LEVELS, MAX_PIXELS, STORAGE_KEY, STORED_LOW_MAX_AGE_MS, STORED_MAX_AGE_MS, THRESHOLDS, WAKE_MS, bestBatch, calibrationOutcome, calibrationResult, calibrationStart, calibrationStep, decodeStored,
  decodeStoredTooSlow, encodeStored, frameStats, governorInit, governorRatio, governorRetop, governorStep, governorSteps, initialLevel, isSoftwareRenderer, levelValues, measuredStats, nextCalibration, pixelRatio, readSignals, renderMode,
  resolveQuality, SETTLE, settledEased, shouldRender,
} from '../shared/render/quality.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.readFileSync(path.join(ROOT, 'home/index.html'), 'utf8');

test('LEVELS tiene exactamente los valores medidos en la épica', () => {
  assert.deepEqual(LEVELS, {
    bajo: { pr: 1.25, shadow: 2048, cap: 230, tex: '2k', aniso: 8, fs: 8, rs: false },
    medio: { pr: 1.5, shadow: 3072, cap: 320, tex: '4k', aniso: 4, fs: 16, rs: true },
    alto: { pr: 2, shadow: 4096, cap: 460, tex: '4k', aniso: 16, fs: 16, rs: true },
  });
  assert.equal(MAX_PIXELS, 3840 * 2160);
});

test('initialLevel: sin señales, alto; cualquiera de las cinco, bajo', () => {
  assert.equal(initialLevel({}), 'alto');
  assert.equal(initialLevel(), 'alto');
  for (const signals of [{ softwareRenderer: true }, { maxTextureSize: 2048 }, { saveData: true }, { deviceMemory: 4 }, { hardwareConcurrency: 4 }]) {
    assert.equal(initialLevel(signals), 'bajo', JSON.stringify(signals));
  }
  assert.equal(initialLevel({ deviceMemory: 8, hardwareConcurrency: 16, maxTextureSize: 16384 }), 'alto');
  assert.equal(initialLevel({ softwareRenderer: false, maxTextureSize: 4096, saveData: false, deviceMemory: 4.5, hardwareConcurrency: 5 }), 'alto');
});

test('initialLevel: los campos undefined (o null) no cuentan', () => {
  const none = { softwareRenderer: undefined, maxTextureSize: undefined, saveData: undefined, deviceMemory: undefined, hardwareConcurrency: undefined };
  assert.equal(initialLevel(none), 'alto');
  assert.equal(initialLevel({ maxTextureSize: null, deviceMemory: null, hardwareConcurrency: null }), 'alto');
});

test('isSoftwareRenderer reconoce los renderers por software, sin distinguir mayúsculas', () => {
  assert.equal(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), true);
  assert.equal(isSoftwareRenderer('llvmpipe (LLVM 17.0.6, 256 bits)'), true);
  assert.equal(isSoftwareRenderer('Gallium 0.4 on softpipe'), true);
  assert.equal(isSoftwareRenderer('Microsoft Basic Render Driver'), true);
  assert.equal(isSoftwareRenderer('Software Rasterizer'), true);
  assert.equal(isSoftwareRenderer('ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL ES 3.2)'), false);
  assert.equal(isSoftwareRenderer('Apple GPU'), false);
  assert.equal(isSoftwareRenderer(undefined), false);
});

test('pixelRatio: tope del nivel, densidad y tope de píxeles en todos los niveles (#325)', () => {
  assert.equal(pixelRatio('alto', 1920, 1080, 1), 1);
  assert.equal(pixelRatio('alto', 1512, 982, 2), 2);
  assert.equal(pixelRatio('alto', 2560, 1440, 2), 1.5);
  assert.equal(pixelRatio('alto', 5120, 2880, 1), 0.75);
  assert.equal(pixelRatio('medio', 1512, 982, 2), 1.5);
  assert.equal(pixelRatio('bajo', 390, 844, 3), 1.25);
  assert.equal(pixelRatio('medio', 5120, 2880, 1), 0.75);
  assert.equal(pixelRatio('bajo', 5120, 2880, 1), 0.75);
  assert.equal(pixelRatio('medio', 3840, 2160, 2), 1);
  // En 5K, medio y bajo ya no pintan más píxeles que alto (8,29 MP)
  for (const level of ['alto', 'medio', 'bajo']) {
    const pr = pixelRatio(level, 5120, 2880, 1);
    assert.ok(5120 * pr * 2880 * pr <= MAX_PIXELS, level);
  }
});

test('pixelRatio: el tope de ?pr= sustituye al del nivel', () => {
  assert.equal(pixelRatio('bajo', 390, 844, 3, 2), 2);
  assert.equal(pixelRatio('alto', 2560, 1440, 2, 1.25), 1.25);
});

// WebGL context and navigator, simulated: only what readSignals reads
const DEBUG_INFO = { UNMASKED_RENDERER_WEBGL: 0x9246 };
const fakeGl = ({ renderer = 'Apple GPU', maxTextureSize = 16384, debugInfo = true, basicRenderer = 'WebKit WebGL' } = {}) => ({
  MAX_TEXTURE_SIZE: 0x0d33,
  RENDERER: 0x1f01,
  getExtension: name => (name === 'WEBGL_debug_renderer_info' && debugInfo ? DEBUG_INFO : null),
  getParameter(p) {
    if (p === DEBUG_INFO.UNMASKED_RENDERER_WEBGL) return renderer;
    if (p === this.MAX_TEXTURE_SIZE) return maxTextureSize;
    if (p === this.RENDERER) return basicRenderer;
    return null;
  },
});

test('readSignals devuelve las cinco señales a partir del contexto WebGL y de navigator', () => {
  const nav = { connection: { saveData: true }, deviceMemory: 8, hardwareConcurrency: 12 };
  assert.deepEqual(readSignals(fakeGl({ renderer: 'llvmpipe (LLVM 17.0.6, 256 bits)', maxTextureSize: 8192 }), nav),
    { softwareRenderer: true, maxTextureSize: 8192, saveData: true, deviceMemory: 8, hardwareConcurrency: 12 });
  assert.deepEqual(readSignals(fakeGl(), nav),
    { softwareRenderer: false, maxTextureSize: 16384, saveData: true, deviceMemory: 8, hardwareConcurrency: 12 });
});

test('readSignals: sin WEBGL_debug_renderer_info, softwareRenderer es false; sin connection, saveData es undefined', () => {
  const signals = readSignals(fakeGl({ renderer: 'SwiftShader', debugInfo: false }), { hardwareConcurrency: 2 });
  assert.equal(signals.softwareRenderer, false);
  assert.equal(signals.saveData, undefined);
  assert.equal(signals.deviceMemory, undefined);
  assert.equal(signals.maxTextureSize, 16384);
  assert.equal(signals.hardwareConcurrency, 2);
  assert.deepEqual(Object.keys(signals).sort(), ['deviceMemory', 'hardwareConcurrency', 'maxTextureSize', 'saveData', 'softwareRenderer']);
});

test('readSignals: sin WEBGL_debug_renderer_info, lee el nombre de gl.RENDERER', () => {
  assert.equal(readSignals(fakeGl({ debugInfo: false, basicRenderer: 'llvmpipe' }), {}).softwareRenderer, true);
  assert.equal(readSignals(fakeGl({ debugInfo: false, basicRenderer: null }), {}).softwareRenderer, false);
});

const resolve = (search, signals = {}, stored = null) => resolveQuality({ params: new URLSearchParams(search), signals, stored });

test('resolveQuality: q fuerza el nivel y un q desconocido se ignora', () => {
  assert.deepEqual(resolve('?q=bajo'), { level: 'bajo', source: 'url', values: { ...LEVELS.bajo } });
  assert.deepEqual(resolve('?q=medio', { softwareRenderer: true }), { level: 'medio', source: 'url', values: { ...LEVELS.medio } });
  assert.deepEqual(resolve('?q=xx'), { level: 'medio', source: 'auto', values: { ...LEVELS.medio } });
  assert.deepEqual(resolve('?q=xx', { hardwareConcurrency: 2 }), { level: 'bajo', source: 'auto', values: { ...LEVELS.bajo } });
  assert.deepEqual(resolve(''), { level: 'medio', source: 'auto', values: { ...LEVELS.medio } });
  assert.equal(resolve('?q=Bajo').source, 'auto');
});

test('resolveQuality: los parámetros del banco sustituyen valores sueltos del nivel', () => {
  assert.deepEqual(resolve('?q=bajo&shadow=4096').values, { ...LEVELS.bajo, shadow: 4096 });
  assert.deepEqual(resolve('?q=bajo&pr=2&shadow=4096&cap=460&tex=4k&aniso=16&fs=16&rs=1').values, { ...LEVELS.alto });
  assert.deepEqual(resolve('?pr=1.5&shadow=3072&cap=320&tex=2k&aniso=4&fs=8&rs=0').values,
    { pr: 1.5, shadow: 3072, cap: 320, tex: '2k', aniso: 4, fs: 8, rs: false });
  assert.equal(resolve('?shadow=3071.6').values.shadow, 3072);
});

test('resolveQuality: un valor no numérico, ≤ 0 o que redondea a 0 se ignora', () => {
  assert.equal(resolve('?q=alto&pr=abc').values.pr, 2);
  for (const v of ['abc', '0', '-2', '', 'Infinity']) {
    const q = resolve(`?q=medio&pr=${v}&shadow=${v}&cap=${v}&aniso=${v}&fs=${v}`).values;
    assert.deepEqual([q.pr, q.shadow, q.cap, q.aniso, q.fs], [1.5, 3072, 320, 4, 16], `valor ${v}`);
  }
  const q = resolve('?q=alto&shadow=0.3&cap=0.2&fs=0.4').values;
  assert.deepEqual([q.shadow, q.cap, q.fs], [4096, 460, 16]);
});

test('resolveQuality: rs solo apaga las sombras con 0; tex solo acepta 2k y 4k', () => {
  for (const v of ['1', '2', 'no', '']) assert.equal(resolve(`?q=bajo&rs=${v}`).values.rs, true, `rs=${v}`);
  assert.equal(resolve('?rs=0').values.rs, false);
  assert.equal(resolve('?q=bajo').values.rs, false);
  for (const v of ['8k', '2K', '']) {
    assert.equal(resolve(`?q=alto&tex=${v}`).values.tex, '4k', `tex=${v}`);
    assert.equal(resolve(`?q=bajo&tex=${v}`).values.tex, '2k', `q=bajo&tex=${v}`);
  }
  assert.equal(resolve('?q=bajo&tex=4k').values.tex, '4k');
});

test('resolveQuality no cambia LEVELS', () => {
  resolve('?q=bajo&shadow=4096').values.cap = 1;
  assert.equal(LEVELS.bajo.shadow, 2048);
  assert.equal(LEVELS.bajo.cap, 230);
});

test('la portada importa el módulo de calidad y lo usa', () => {
  assert.match(home, /import \{[^}]*\bresolveQuality\b[^}]*\} from "\.\.\/shared\/render\/quality\.js";/);
  // Sin la escena entera (el aviso de 7 s llega antes que las texturas) no se calibra ni se guarda
  assert.match(home, /const sceneComplete=\(\)=>color2k&&heightDone;/);
  assert.match(home, /setTimeout\(\(\)=>start\(true\),7000\)/);
  assert.match(home, /if\(ready\|\|\(!late&&!sceneComplete\(\)\)\)return;/);
  assert.match(home, /const SIGNALS=readSignals\(renderer\.getContext\(\),navigator\);/);
  assert.match(home, /resolveQuality\(\{params:QS,signals:SIGNALS,stored:STORED\}\)/);
  assert.match(home, /import \{[^}]*\breadSignals\b[^}]*\} from "\.\.\/shared\/render\/quality\.js";/);
  assert.doesNotMatch(home, /WEBGL_debug_renderer_info[^\n]*\n[^\n]*softwareRenderer:/, 'las señales no se montan en línea');
  assert.match(home, /antialias:true/);
});

test('resize() recalcula el pixel ratio, con el tope del gobernador (#166)', () => {
  const resize = home.slice(home.indexOf('function resize(){'), home.indexOf('addEventListener("resize",resize)'));
  assert.ok(resize.length > 0, 'no hay function resize()');
  assert.match(resize, /renderer\.setPixelRatio\(governedPixelRatio\(\)\)/);
  const governed = home.slice(home.indexOf('function governedPixelRatio(){'), home.indexOf('const benchGovernor='));
  assert.match(governed, /const top=qualityPixelRatio\(W,Hh\);if\(!gov\)return top;/);
  assert.match(governed, /gov=governorRetop\(gov,top\);/);
  assert.doesNotMatch(governed, /governorInit\(/, 'un tope nuevo no reinicia el gobernador');
  assert.match(governed, /return Math\.min\(top,governorRatio\(gov\)\);/);
  assert.match(home, /const qualityPixelRatio=\(w,h\)=>pixelRatio\(QUALITY\.level,w,h,devicePixelRatio\|\|1,Q\.pr\)/);
});

test('con ?bench, __bench.quality da nivel, origen y valores, y __bench.explore abre «Explorar la Luna»', () => {
  assert.match(home, /quality:\{level:QUALITY\.level,source:QUALITY\.source,values:\{\.\.\.QUALITY\.values\},calibration:\[\],tooSlow:false,renderMode:RENDER_MODE\}/);
  assert.match(home, /explore:\(\)=>\{openExplore\(\);return mode!=="menu";\}/);
});

// ---------- Calibration and stored level (#143) ----------

test('THRESHOLDS: los umbrales medidos para la épica', () => {
  assert.deepEqual(THRESHOLDS, { upMs: 5, altoDownMs: 8, medioDownMs: 11, tooSlowMs: 33 });
  assert.equal(Object.hasOwn(THRESHOLDS, 'medioDownP95Ms'), false);
});

test('frameStats: mediana y percentil 95 de rango más cercano', () => {
  assert.deepEqual(frameStats([1, 2, 3, 4, 100]), { p50: 3, p95: 100 });
  assert.deepEqual(frameStats([100, 4, 3, 2, 1]), { p50: 3, p95: 100 });
  assert.deepEqual(frameStats([7]), { p50: 7, p95: 7 });
  assert.deepEqual(frameStats([]), { p50: null, p95: null });
  const thirty = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.deepEqual(frameStats(thirty), { p50: 15, p95: 29 });
});

test('calibrationStep: sube, baja o se queda según la mediana; el percentil 95 no cuenta (#325)', () => {
  const step = (level, p50, p95 = p50) => calibrationStep(level, { p50, p95 });
  assert.deepEqual(step('bajo', 4), { level: 'medio', tooSlow: false });
  assert.deepEqual(step('bajo', 40), { level: 'bajo', tooSlow: true });
  assert.deepEqual(step('bajo', 12), { level: 'bajo', tooSlow: false });
  assert.deepEqual(step('medio', 4), { level: 'alto', tooSlow: false });
  assert.deepEqual(step('medio', 12), { level: 'bajo', tooSlow: false });
  assert.deepEqual(step('medio', 8, 20), { level: 'medio', tooSlow: false });
  assert.deepEqual(step('medio', 8, 200), { level: 'medio', tooSlow: false });
  assert.deepEqual(step('medio', 8, 12), { level: 'medio', tooSlow: false });
  assert.deepEqual(step('alto', 9), { level: 'medio', tooSlow: false });
  assert.deepEqual(step('alto', 6), { level: 'alto', tooSlow: false });
  // En los umbrales justos
  assert.equal(step('bajo', 5).level, 'medio');
  assert.equal(step('bajo', 33).tooSlow, false);
  assert.equal(step('medio', 11, 16).level, 'medio');
  assert.equal(step('alto', 8).level, 'alto');
});

test('measuredStats: la mejor tanda completa; la cortada solo si no acabó ninguna; si no, el calentamiento (#325)', () => {
  const n = (ms, k = 30) => Array(k).fill(ms);
  const warm = n(20, 15);
  // Without a cut: the full batch with the lower median
  assert.deepEqual(measuredStats({ warm, batches: [n(7), n(3)], cut: false }), { p50: 3, p95: 3 });
  assert.deepEqual(measuredStats({ warm, batches: [n(3), n(7)], cut: false }), { p50: 3, p95: 3 });
  // Cut during the second batch: two fast frames do not override the full first batch
  assert.deepEqual(measuredStats({ warm, batches: [n(9), [7, 7]], cut: true }), { p50: 9, p95: 9 });
  assert.deepEqual(measuredStats({ warm, batches: [n(9), []], cut: true }), { p50: 9, p95: 9 });
  // Cut during the first batch: the cut batch is what there is
  assert.deepEqual(measuredStats({ warm, batches: [[7, 7, 9]], cut: true }), { p50: 7, p95: 9 });
  // Cut at the start of the first batch or during the warm-up: the warm-up frames
  assert.deepEqual(measuredStats({ warm, batches: [[]], cut: true }), { p50: 20, p95: 20 });
  assert.deepEqual(measuredStats({ warm: [12, 14], batches: [], cut: true }), { p50: 12, p95: 14 });
  // Cut before the first warm-up frame: nothing measured
  assert.deepEqual(measuredStats({ warm: [], batches: [], cut: true }), { p50: null, p95: null });
});

test('bestBatch: de dos tandas, la de menor mediana; una null no cuenta (#325)', () => {
  assert.deepEqual(bestBatch({ p50: 7, p95: 9 }, { p50: 3, p95: 12 }), { p50: 3, p95: 12 });
  assert.deepEqual(bestBatch({ p50: 3, p95: 12 }, { p50: 7, p95: 9 }), { p50: 3, p95: 12 });
  assert.deepEqual(bestBatch(null, { p50: 7, p95: 9 }), { p50: 7, p95: 9 });
  assert.deepEqual(bestBatch({ p50: 7, p95: 9 }, null), { p50: 7, p95: 9 });
  assert.equal(bestBatch(null, null), null);
  // Una tanda sin mediana (sin frames) tampoco cuenta
  assert.deepEqual(bestBatch({ p50: null, p95: null }, { p50: 7, p95: 9 }), { p50: 7, p95: 9 });
  assert.deepEqual(bestBatch({ p50: 7, p95: 9 }, { p50: null, p95: null }), { p50: 7, p95: 9 });
  assert.equal(bestBatch({ p50: null, p95: null }, undefined), null);
});

test('calibrationStart: bajo en un equipo modesto; medio en otro caso', () => {
  assert.equal(calibrationStart({ softwareRenderer: true }), 'bajo');
  assert.equal(calibrationStart({ hardwareConcurrency: 2 }), 'bajo');
  assert.equal(calibrationStart({}), 'medio');
  assert.equal(calibrationStart(), 'medio');
  assert.equal(calibrationStart({ deviceMemory: 8, hardwareConcurrency: 16, maxTextureSize: 16384 }), 'medio');
});

const m = (level, p50, p95 = p50) => ({ level, stats: { p50, p95 } });

test('nextCalibration: como mucho dos mediciones y sin ida y vuelta', () => {
  assert.notEqual(nextCalibration([]), null);
  assert.equal(nextCalibration([]), 'medio');
  assert.equal(nextCalibration([], 'bajo'), 'bajo');
  assert.equal(nextCalibration([m('medio', 4)]), 'alto');
  assert.equal(nextCalibration([m('medio', 8, 12)]), null);
  assert.equal(nextCalibration([m('medio', 12)]), 'bajo');
  assert.equal(nextCalibration([m('bajo', 40)]), null);
  assert.equal(nextCalibration([m('bajo', 4)]), 'medio');
  // Tras medio (4) y alto (9): se decide, y se queda en medio
  assert.equal(nextCalibration([m('medio', 4), m('alto', 9)]), null);
  assert.equal(calibrationResult([m('medio', 4), m('alto', 9)]).level, 'medio');
  // Tras medio (4) y alto (6): alto
  assert.equal(nextCalibration([m('medio', 4), m('alto', 6)]), null);
  assert.equal(calibrationResult([m('medio', 4), m('alto', 6)]).level, 'alto');
  // Nunca hay tercera medición, digan lo que digan las dos primeras
  for (const a of [1, 6, 9, 12, 40]) for (const b of [1, 6, 9, 12, 40]) for (const [l1, l2] of [['bajo', 'medio'], ['medio', 'alto'], ['medio', 'bajo']]) {
    assert.equal(nextCalibration([m(l1, a), m(l2, b)]), null, `${l1} ${a}, ${l2} ${b}`);
  }
});

test('nextCalibration simulada: cada equipo acaba en un nivel con una o dos mediciones', () => {
  // Tiempo de frame (ms) de cada nivel en equipos inventados
  const devices = [
    { name: 'potente', start: 'medio', ms: { bajo: 2, medio: 3, alto: 4 }, want: 'alto', runs: 2 },
    { name: 'medio', start: 'medio', ms: { bajo: 4, medio: 7, alto: 12 }, want: 'medio', runs: 1 },
    { name: 'justo en alto', start: 'medio', ms: { bajo: 2, medio: 4.5, alto: 9 }, want: 'medio', runs: 2 },
    { name: 'flojo', start: 'medio', ms: { bajo: 9, medio: 14, alto: 25 }, want: 'bajo', runs: 2 },
    { name: 'por software', start: 'bajo', ms: { bajo: 120, medio: 200, alto: 300 }, want: 'bajo', runs: 1, tooSlow: true },
    { name: 'modesto que va bien', start: 'bajo', ms: { bajo: 3, medio: 4, alto: 6 }, want: 'medio', runs: 2 },
  ];
  for (const d of devices) {
    const history = [];
    for (let level = nextCalibration(history, d.start); level; level = nextCalibration(history, d.start)) {
      history.push(m(level, d.ms[level]));
      assert.ok(history.length <= 2, d.name);
    }
    assert.equal(history.length, d.runs, d.name);
    assert.deepEqual(calibrationResult(history), { level: d.want, tooSlow: !!d.tooSlow }, d.name);
  }
});

test('calibrationResult: si la segunda contradice a la primera, el más bajo de los dos medidos', () => {
  assert.deepEqual(calibrationResult([]), { level: null, tooSlow: false });
  assert.deepEqual(calibrationResult([m('bajo', 40)]), { level: 'bajo', tooSlow: true });
  // Bajó a bajo y bajo pide subir: se queda en bajo
  assert.deepEqual(calibrationResult([m('medio', 12), m('bajo', 4)]), { level: 'bajo', tooSlow: false });
  // Bajó y bajo tampoco puede: bajo, demasiado lento
  assert.deepEqual(calibrationResult([m('medio', 40), m('bajo', 40)]), { level: 'bajo', tooSlow: true });
  // Subió dos veces: no salta a un nivel sin medir
  assert.deepEqual(calibrationResult([m('bajo', 4), m('medio', 4)]), { level: 'medio', tooSlow: false });
});

test('calibrationOutcome: sin corte, el nivel decidido y se guarda', () => {
  assert.deepEqual(calibrationOutcome([m('medio', 4), m('alto', 6)], { cut: false, current: 'alto' }), { level: 'alto', tooSlow: false, store: true });
  // La segunda contradice a la primera: vuelve a medio aunque esté en alto
  assert.deepEqual(calibrationOutcome([m('medio', 4), m('alto', 9)], { cut: false, current: 'alto' }), { level: 'medio', tooSlow: false, store: true });
  assert.deepEqual(calibrationOutcome([m('medio', 8, 12)], { cut: false, current: 'medio' }), { level: 'medio', tooSlow: false, store: true });
  assert.deepEqual(calibrationOutcome([m('bajo', 40)], { cut: false, current: 'bajo' }), { level: 'bajo', tooSlow: true, store: true });
});

test('calibrationOutcome: con corte, baja si la medición cortada lo pide; si no, vale el nivel en uso y solo se guarda si lo confirma', () => {
  // Primera medición cortada que pide bajar (medio a 45 ms): baja a bajo y se guarda
  assert.deepEqual(calibrationOutcome([m('medio', 45)], { cut: true, current: 'medio' }), { level: 'bajo', tooSlow: false, store: true });
  // Primera medición cortada en bajo que pide subir: se queda en bajo y no se guarda
  assert.deepEqual(calibrationOutcome([m('bajo', 4)], { cut: true, current: 'bajo' }), { level: 'bajo', tooSlow: false, store: false });
  // Primera medición cortada que confirma el nivel: se guarda
  assert.deepEqual(calibrationOutcome([m('medio', 8, 12)], { cut: true, current: 'medio' }), { level: 'medio', tooSlow: false, store: true });
  // Por software, cortada en bajo y demasiado lenta: bajo, tooSlow y se guarda
  assert.deepEqual(calibrationOutcome([m('bajo', 120)], { cut: true, current: 'bajo' }), { level: 'bajo', tooSlow: true, store: true });
  // Segunda medición cortada sin ningún frame: el nivel en uso (alto), sin guardar
  assert.deepEqual(calibrationOutcome([m('medio', 4)], { cut: true, current: 'alto' }), { level: 'alto', tooSlow: false, store: false });
  // Segunda medición cortada que pide bajar: baja a medio y se guarda
  assert.deepEqual(calibrationOutcome([m('medio', 4), m('alto', 9)], { cut: true, current: 'alto' }), { level: 'medio', tooSlow: false, store: true });
  // Segunda medición cortada que confirma: se guarda
  assert.deepEqual(calibrationOutcome([m('medio', 4), m('alto', 6)], { cut: true, current: 'alto' }), { level: 'alto', tooSlow: false, store: true });
  // Cortada en el calentamiento, sin nada medido: el nivel en uso, sin guardar
  assert.deepEqual(calibrationOutcome([], { cut: true, current: 'medio' }), { level: 'medio', tooSlow: false, store: false });
});

test('decodeStored: solo vale un nivel conocido, del mismo renderer y no más antiguo de lo que permite su nivel', () => {
  const renderer = 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL ES 3.2)';
  const now = Date.UTC(2026, 10, 14);
  const day = 24 * 3600 * 1000;
  const raw = encodeStored({ level: 'alto', renderer, at: now - day });
  assert.equal(STORAGE_KEY, 'llsn.quality');
  assert.equal(decodeStored(raw, { renderer, now }), 'alto');
  assert.equal(decodeStored(encodeStored({ level: 'alto', renderer, at: now - 7 * day }), { renderer, now }), 'alto');
  assert.equal(decodeStored(encodeStored({ level: 'bajo', renderer, at: now - day }), { renderer, now }), 'bajo');
  for (const bad of [null, undefined, '', 'alto', '{', '[]', 'null', '{"level":"ultra","renderer":"x","at":1}', JSON.stringify({ level: 'alto', renderer, at: 'ayer' })]) {
    assert.equal(decodeStored(bad, { renderer, now }), null, String(bad));
  }
  assert.equal(decodeStored(raw, { renderer: 'Apple GPU', now }), null);
  assert.equal(decodeStored(encodeStored({ level: 'alto', renderer, at: now - 7 * day - 1 }), { renderer, now }), null);
  assert.equal(decodeStored(encodeStored({ level: 'alto', renderer, at: now + day }), { renderer, now }), null);
});

test('decodeStored: alto vale 7 días; medio y bajo, 1 día (#325)', () => {
  const renderer = 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL ES 3.2)';
  const now = Date.UTC(2026, 10, 14);
  const day = 24 * 3600 * 1000, hour = 3600 * 1000;
  assert.equal(STORED_MAX_AGE_MS, 7 * day);
  assert.equal(STORED_LOW_MAX_AGE_MS, day);
  const dec = (level, age, extra = {}) => encodeStored({ level, renderer, at: now - age, ...extra });
  assert.equal(decodeStored(dec('alto', 6 * day), { renderer, now }), 'alto');
  assert.equal(decodeStored(dec('medio', 6 * day), { renderer, now }), null);
  assert.equal(decodeStored(dec('medio', 20 * hour), { renderer, now }), 'medio');
  assert.equal(decodeStored(dec('bajo', 20 * hour), { renderer, now }), 'bajo');
  assert.equal(decodeStored(dec('medio', day), { renderer, now }), 'medio');
  assert.equal(decodeStored(dec('medio', day + 1), { renderer, now }), null);
  assert.equal(decodeStored(dec('bajo', 2 * day), { renderer, now }), null);
  // tooSlow sigue la misma regla de antigüedad que el nivel del registro
  assert.equal(decodeStoredTooSlow(dec('bajo', 2 * day, { tooSlow: true }), { renderer, now }), false);
  assert.equal(decodeStoredTooSlow(dec('bajo', 20 * hour, { tooSlow: true }), { renderer, now }), true);
});

test('resolveQuality: q gana al nivel guardado y el guardado a las señales', () => {
  assert.deepEqual(resolve('?q=bajo', {}, 'alto'), { level: 'bajo', source: 'url', values: { ...LEVELS.bajo } });
  assert.deepEqual(resolve('', { softwareRenderer: true }, 'alto'), { level: 'alto', source: 'stored', values: { ...LEVELS.alto } });
  assert.deepEqual(resolve('?q=xx', {}, 'bajo'), { level: 'bajo', source: 'stored', values: { ...LEVELS.bajo } });
  assert.deepEqual(resolve('', { softwareRenderer: true }), { level: 'bajo', source: 'auto', values: { ...LEVELS.bajo } });
  assert.deepEqual(resolve('', {}, null), { level: 'medio', source: 'auto', values: { ...LEVELS.medio } });
  assert.equal(resolve('', {}, 'ultra').source, 'auto');
  // Los parámetros del banco valen también sobre el nivel guardado
  assert.equal(resolve('?shadow=4096', {}, 'bajo').values.shadow, 4096);
});

test('levelValues: los valores del nivel con los parámetros del banco encima', () => {
  assert.deepEqual(levelValues('alto', new URLSearchParams('')), { ...LEVELS.alto });
  assert.deepEqual(levelValues('bajo', new URLSearchParams('?cap=460&rs=1')), { ...LEVELS.bajo, cap: 460, rs: true });
});

test('la portada define applyLevel, calibra solo con source auto y guarda el nivel dentro de un try', () => {
  assert.match(home, /function applyLevel\(/);
  assert.match(home, /if\(QUALITY\.source==="auto"&&sceneComplete\(\)\)\{calibrating=true;return;\}/);
  assert.match(home, /if\(calibrating&&ready\)\{calibrate\(\);reveal\(\);\}/);
  assert.match(home, /try\{return decodeStored\(localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(home, /try\{localStorage\.setItem\(STORAGE_KEY,encodeStored\(/);
  // Every use of localStorage with the level is inside a try
  for (const line of home.split('\n').filter(l => l.includes('STORAGE_KEY') && l.includes('localStorage'))) assert.match(line, /try\{[^}]*localStorage/);
  assert.match(home, /resolveQuality\(\{params:QS,signals:[\s\S]*?stored:STORED\}\)/);
});

test('la calibración: 15 frames de calentamiento, dos tandas de 30 medidos con readPixels, vale la mejor, y tope de 1,5 s', () => {
  assert.match(home, /const CAL=\{warmup:15,frames:30,batches:2,budgetMs:1500\}/);
  const measure = home.slice(home.indexOf('function measureLevel('), home.indexOf('function calibrate('));
  assert.match(measure, /drawRaw\(scene,camera\);gl\.readPixels\(0,0,1,1,/);
  assert.match(measure, /performance\.now\(\)>deadline/);
  // The loop only collects the times; measuredStats() (bestBatch inside) picks the stats
  assert.match(measure, /measuredStats\(\{warm,batches,cut\}\)/);
  assert.match(measure, /for\(let b=0;b<CAL\.batches;b\+\+\)\{const batch=\[\];batches\.push\(batch\);/);
  assert.match(measure, /if\(performance\.now\(\)>deadline\)return done\(true\);warm\.push\(frame\(\)\)/);
  assert.match(measure, /if\(performance\.now\(\)>deadline\)return done\(true\);batch\.push\(frame\(\)\)/);
  assert.match(measure, /return done\(false\);\}/);
  assert.match(fs.readFileSync(path.join(ROOT, 'shared/render/quality.js'), 'utf8'), /reduce\(bestBatch, null\)/);
  const cal = home.slice(home.indexOf('function calibrate('), home.indexOf('function applyLevel('));
  assert.match(cal, /nextCalibration\(history,first\)/);
  assert.match(cal, /const r=calibrationOutcome\(history,\{cut,current:QUALITY\.level\}\)/);
  assert.match(cal, /if\(r\.level!==QUALITY\.level\)applyLevel\(r\.level\)/);
  assert.match(cal, /B\.quality\.calibration=/);
  assert.match(cal, /B\.quality\.tooSlow=r\.tooSlow/);
  assert.match(cal, /if\(r\.store\)try\{localStorage\.setItem\(STORAGE_KEY,/);
});

test('applyLevel libera lo que sustituye y el programa de la Luna depende de fs', () => {
  const apply = home.slice(home.indexOf('function applyLevel('), home.indexOf('/* ---------- Bucle'));
  assert.match(apply, /renderer\.setPixelRatio\(qualityPixelRatio\(W,Hh\)\)/);
  assert.match(apply, /sun\.shadow\.map\.dispose\(\);sun\.shadow\.map=null/);
  assert.match(apply, /MOON\.setCapGrid\(Q\.cap\)/);
  assert.match(apply, /ensureColor\(\)/);
  assert.match(home, /samples:\(\)=>Q\.fs/);
});

// ---------- Imagen fija donde no hay aceleración 3D y aviso si el 3D falla (#144) ----------

test('renderMode: continuous sin señales; onDemand con render por software, tooSlow o movimiento reducido', () => {
  assert.equal(renderMode({}), 'continuous');
  assert.equal(renderMode(), 'continuous');
  for (const field of ['softwareRenderer', 'tooSlow', 'reducedMotion']) assert.equal(renderMode({ [field]: true }), 'onDemand', field);
  assert.equal(renderMode({ softwareRenderer: false, tooSlow: false, reducedMotion: false }), 'continuous');
});

test('shouldRender: continuous siempre; onDemand mientras anima o hasta awakeUntil', () => {
  assert.equal(WAKE_MS, 1200);
  for (const now of [0, 100, 300, 1e9]) assert.equal(shouldRender({ mode: 'continuous', now, awakeUntil: 0, animating: false }), true);
  assert.equal(shouldRender({ mode: 'onDemand', now: 300, awakeUntil: 200, animating: true }), true);
  assert.equal(shouldRender({ mode: 'onDemand', now: 100, awakeUntil: 200, animating: false }), true);
  assert.equal(shouldRender({ mode: 'onDemand', now: 300, awakeUntil: 200, animating: false }), false);
});

test('encodeStored con tooSlow y decodeStoredTooSlow; decodeStored sigue dando el nivel', () => {
  const renderer = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
  const now = Date.UTC(2026, 10, 14);
  const day = 24 * 3600 * 1000;
  const slow = encodeStored({ level: 'bajo', renderer, at: now - day, tooSlow: true });
  const plain = encodeStored({ level: 'bajo', renderer, at: now - day });
  assert.equal(decodeStoredTooSlow(slow, { renderer, now }), true);
  assert.equal(decodeStoredTooSlow(plain, { renderer, now }), false);
  assert.equal(decodeStoredTooSlow(encodeStored({ level: 'bajo', renderer, at: now - day, tooSlow: false }), { renderer, now }), false);
  assert.equal(decodeStoredTooSlow(slow, { renderer: 'Apple GPU', now }), false);
  assert.equal(decodeStoredTooSlow(encodeStored({ level: 'bajo', renderer, at: now - 7 * day - 1, tooSlow: true }), { renderer, now }), false);
  for (const bad of [null, undefined, '', '{', 'null', '{"level":"ultra","renderer":"x","at":1,"tooSlow":true}']) {
    assert.equal(decodeStoredTooSlow(bad, { renderer, now }), false, String(bad));
  }
  assert.equal(decodeStored(slow, { renderer, now }), 'bajo');
  assert.equal(decodeStored(plain, { renderer, now }), 'bajo');
  // Sin tooSlow el registro guardado no cambia de forma
  assert.deepEqual(JSON.parse(plain), { level: 'bajo', renderer, at: now - day });
});

test('settledEased: los valores suavizados en su destino y pasado holdUntil', () => {
  assert.equal(SETTLE, 0.005);
  assert.equal(settledEased({ now: 0 }), true);
  assert.equal(settledEased({ now: 0, eased: [[1, 1], [0.999, 1], [0.003, 0]] }), true);
  assert.equal(settledEased({ now: 0, eased: [[1, 1], [0.9, 1]] }), false);
  assert.equal(settledEased({ now: 0, eased: [[-0.01, 0]] }), false);
  assert.equal(settledEased({ now: 1000, holdUntil: 1600 }), false);
  assert.equal(settledEased({ now: 1600, holdUntil: 1600 }), true);
  assert.equal(settledEased({ now: 2000, holdUntil: 1600, eased: [[0.5, 1]] }), false);
});

test('la portada: aviso #glost, frame con shouldRender, animate de un frame en onDemand y #loading accesible', () => {
  const glost = home.match(/<div class="glost" id="glost" role="alertdialog" aria-modal="true" aria-label="[^"]+" aria-describedby="glostText" hidden>[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(glost, '#glost oculto, alertdialog modal con nombre y descripción');
  assert.match(glost[0], /<p id="glostText">/);
  assert.match(glost[0], /La vista 3D no está disponible en este equipo o se ha detenido\./);
  assert.match(glost[0], /<a href="\.\.\/web\/">Simulador de misiones<\/a>/);
  assert.match(glost[0], /<a href="\.\.\/viewpoint\/">Mirador del Polo Sur<\/a>/);
  assert.match(glost[0], /<a href="\.\.\/rolegame\/">Juego de rol<\/a>/);
  assert.match(glost[0], /<button[^>]*id="glostReload"[^>]*>Recargar<\/button>/);
  assert.match(home, /\$\("glostReload"\)\.addEventListener\("click",\(\)=>location\.reload\(\)\)/);
  // El comportamiento del aviso se prueba en tests/lost-notice.test.mjs; aquí, que la portada lo usa
  assert.match(home, /import \{createLostNotice,createRendererOrNotice,watchContextLoss\} from "\.\.\/shared\/render\/lost-notice\.js"/);
  assert.match(home, /const lost=createLostNotice\(\{notice:\$\("glost"\),loading:\$\("loading"\),roots:\[app,document\.body\],/);
  assert.match(home, /fallbackFocus:\(\)=>mode==="screen"\?\$\("scrBack"\):\$\("lightBtn"\)/);
  assert.match(home, /const contextLoss=watchContextLoss\(canvas,\{notice:lost,deferWhile:\(\)=>mode==="screen",onRestore:\(\)=>wake\(\)\}\)/);
  // Una pérdida con la pantalla de misión abierta espera a que se salga de ella
  const leave = home.slice(home.indexOf('function leaveScreen('), home.indexOf('function leaveScreen(') + 300);
  assert.match(leave, /if\(contextLoss\.showIfLost\(\)\)return;/);
  // Sin WebGL, el aviso y nada más de la escena
  assert.match(home, /const renderer=createRendererOrNotice\(\(\)=>new THREE\.WebGLRenderer\(/);
  const frame = home.slice(home.indexOf('function frame('), home.indexOf('renderDock();\nrequestAnimationFrame(frame);'));
  assert.match(frame, /if\(!shouldRender\(\{mode:RENDER_MODE,now,awakeUntil,animating:!!anim/);
  assert.ok(frame.indexOf('shouldRender(') < frame.indexOf('renderer.render('));
  assert.match(frame, /const still=reduce\|\|RENDER_MODE==="onDemand"/);
  // Los valores suavizados mantienen el bucle despierto hasta su estado final: la imagen fija nunca queda a medias
  assert.match(frame, /swayAmt=still\?0:/);
  for (const eased of ['sunEl+=(LIGHT[light].el-sunEl)*(still?1:', 'o.hv+=((o===z?1:0)-o.hv)*(still?1:', 'SAT.hv+=((on?1:0)-SAT.hv)*(still?1:']) assert.ok(frame.includes(eased), eased);
  assert.match(frame, /if\(!settled\(now\)\)wake\(\);/);
  // Cambiar la luz o el resaltado despierta el bucle aunque no haya puntero (teclado, foco, tutorial)
  assert.match(home, /function setLight\(k\)\{light=k;wake\(\);/);
  assert.match(home, /function setHover\(z\)\{if\(mode!=="menu"\)return;hover=z;wake\(\);/);
  assert.ok(frame.indexOf('if(!settled(now))wake();') < frame.indexOf('renderer.render('));
  const settled = home.slice(home.indexOf('const settled='), home.indexOf('function frame('));
  for (const eased of ['settledEased(', '[sunEl,LIGHT[light].el]', '[o.hv,o===hover?1:0]', '[SAT.hv,', 'holdUntil:td?td+TOUCHDOWN_MS:0']) assert.ok(settled.includes(eased), eased);
  // En onDemand nada se mueve con el tiempo: la imagen fija no salta en cada wake()
  for (const timed of ['const bob=still?0:', 'if(!still){r.rotateX(', 'const fl=thrust*(still?1:', 'setRGB(still||', 'o.lz.rotation.z=still?0:', 'if(!still){sat.position.y+=', 'fl=still?0:(c<.07', 'bc=still?0:Math.max(']) assert.ok(frame.includes(timed), timed);
  assert.doesNotMatch(frame, /reduce\?[01]:/, 'dentro de frame() las animaciones se condicionan con `still` (movimiento reducido o imagen fija, #144), no solo con `reduce`: cambia `reduce?…:` por `still?…:`');
  // La captura del banco espera a la GPU (lectura síncrona): dos pasadas en onDemand dan la misma imagen
  assert.match(home, /shot:\(\)=>\{const s=B\.sync;B\.sync=true;renderer\.render\(scene,camera\);B\.sync=s;return canvas\.toDataURL\("image\/png"\);\}/);
  assert.match(home, /function animate\(to,dur,done\)\{wake\(\);anim=\{from:\{\.\.\.view\},to,t0:performance\.now\(\),dur:\(reduce\|\|RENDER_MODE==="onDemand"\)\?1:dur/);
  assert.match(home, /<div class="loading" id="loading" role="status" aria-live="polite">/);
  assert.match(home, /let RENDER_MODE=renderMode\(\{softwareRenderer:SIGNALS\.softwareRenderer,tooSlow:STORED_TOO_SLOW,reducedMotion:reduce\}\)/);
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'resize']) assert.ok(home.includes(`"${type}"`), type);
  assert.match(home, /document\.addEventListener\("visibilitychange",wake\)/);
  assert.match(home, /function reveal\(\)\{wake\(\);/);
  const cal = home.slice(home.indexOf('function calibrate('), home.indexOf('function applyLevel('));
  assert.match(cal, /if\(r\.tooSlow\)RENDER_MODE=renderMode\(\{softwareRenderer:SIGNALS\.softwareRenderer,tooSlow:true,reducedMotion:reduce\}\)/);
  assert.match(cal, /encodeStored\(\{level:QUALITY\.level,renderer:GPU_NAME,at:Date\.now\(\),tooSlow:r\.tooSlow\}\)/);
  assert.match(home, /renderMode:RENDER_MODE/);
  assert.match(home, /loseContext:\(\)=>\{const ext=renderer\.getContext\(\)\.getExtension\("WEBGL_lose_context"\)/);
  assert.match(home, /lostNotice:\(\)=>lost\.visible\(\)/);
});

// ---------- Pixel ratio governor (#166) ----------
const SLOW = 25, FAST = 10, MID = 19;
const win = ms => Array(GOVERNOR.windowFrames).fill(ms);
// Feeds windows of equal intervals in order; each one ends ms × windowFrames after the previous one.
// → { state, now, ratios: the ratio returned by each window (null: no change) }
function feed(state, now, list) {
  const ratios = [];
  for (const item of list) {
    const { ms, tainted = false } = typeof item === 'number' ? { ms: item } : item;
    now += ms * GOVERNOR.windowFrames;
    const r = governorStep(state, { samples: win(ms), tainted }, now);
    state = r.state;
    ratios.push(r.ratio);
  }
  return { state, now, ratios };
}
const times = (n, ms) => Array(n).fill(ms);
// Two slow windows from 2 (down to 1.5) and a window at 12 ms that confirms the drop, with the cooldown waited out
function droppedTo15() {
  let { state, now, ratios } = feed(governorInit(2), 10000, [SLOW, SLOW]);
  assert.deepEqual(ratios, [null, 1.5]);
  now += GOVERNOR.cooldownMs;
  ({ state, now, ratios } = feed(state, now, [12]));
  assert.deepEqual(ratios, [null]);
  return { state, now };
}

test('GOVERNOR tiene los valores de la historia', () => {
  assert.deepEqual(GOVERNOR, {
    steps: [1, 1.25, 1.5, 2], windowFrames: 60, slowMs: 20, slowShare: 0.75, fastMs: 18, fastShare: 0.95,
    slowWindowsToDrop: 2, fastMsToRaise: 5000, cooldownMs: 3000, relapseMs: 10000, vetoMs: 30000, minGain: 0.1,
  });
});

test('governorSteps: los escalones hasta el tope, con el tope; por debajo de 1, solo el tope', () => {
  assert.deepEqual(governorSteps(2), [1, 1.25, 1.5, 2]);
  assert.deepEqual(governorSteps(1.5), [1, 1.25, 1.5]);
  // El escalón fijo justo por debajo del tope se descarta si ahorra muy pocos píxeles: (1,25 / 1,3)² ≈ 0,92 > 0,9
  assert.deepEqual(governorSteps(1.3), [1, 1.3]);
  assert.deepEqual(governorSteps(1.52), [1, 1.25, 1.52]);
  assert.deepEqual(governorSteps(0.75), [0.75]);
  assert.deepEqual(governorSteps(1), [1]);
});

test('gobernador: desde un tope de 1,52, ventanas lentas que mejoran al bajar de píxeles bajan del tope sin congelarse', () => {
  // Limitado por la GPU: el intervalo crece con los píxeles, 30 ms a 1,52
  const msAt = ratio => 30 * (ratio / 1.52) ** 2;
  let state = governorInit(1.52), now = 10000;
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const ms = msAt(governorRatio(state));
    now += ms * GOVERNOR.windowFrames;
    const r = governorStep(state, { samples: win(ms) }, now);
    state = r.state;
    if (r.ratio !== null) seen.push(r.ratio);
    if (r.ratio === 1) break;
  }
  assert.deepEqual(seen, [1.25, 1]);
  assert.equal(state.frozen, false);
});

test('governorInit empieza en el escalón más alto', () => {
  assert.equal(governorRatio(governorInit(2)), 2);
  assert.equal(governorRatio(governorInit(1.3)), 1.3);
  assert.equal(governorInit(2).frozen, false);
});

test('gobernador: una ventana lenta no cambia nada; la segunda seguida baja a 1,5', () => {
  const { ratios, state } = feed(governorInit(2), 10000, [SLOW, SLOW]);
  assert.deepEqual(ratios, [null, 1.5]);
  assert.equal(governorRatio(state), 1.5);
});

test('gobernador: una ventana tainted entre dos lentas impide la bajada', () => {
  const { ratios, state } = feed(governorInit(2), 10000, [SLOW, { ms: SLOW, tainted: true }, SLOW]);
  assert.deepEqual(ratios, [null, null, null]);
  assert.equal(governorRatio(state), 2);
  // Una ventana tainted pura (de intervalos holgados) tampoco cuenta
  assert.deepEqual(feed(governorInit(2), 10000, [SLOW, { ms: FAST, tainted: true }, SLOW, SLOW]).ratios, [null, null, null, 1.5]);
});

test('gobernador: tras bajar, una ventana que mejora mantiene el escalón; si no mejora el 10 %, vuelve y se congela', () => {
  const { state } = droppedTo15();
  assert.equal(governorRatio(state), 1.5);
  assert.equal(state.frozen, false);

  let { state: s, now } = feed(governorInit(2), 10000, [SLOW, SLOW]);
  now += GOVERNOR.cooldownMs;
  let r = feed(s, now, [24]);
  assert.deepEqual(r.ratios, [2]);
  assert.equal(r.state.frozen, true);
  r = feed(r.state, r.now + GOVERNOR.cooldownMs, times(10, SLOW));
  assert.deepEqual(r.ratios, times(10, null));
  r = feed(r.state, r.now, times(20, FAST));
  assert.ok(r.ratios.every(x => x === null));
  assert.equal(governorRatio(r.state), 2);
});

test('gobernador: 5 s holgados acumulados suben un escalón; menos, no', () => {
  const { state, now } = droppedTo15();
  // La ventana de 12 ms que da por buena la bajada ya es holgada: 720 ms
  const before = Math.ceil((GOVERNOR.fastMsToRaise - 12 * 60) / (FAST * 60)) - 1;
  let r = feed(state, now, times(before, FAST));
  assert.ok(r.ratios.every(x => x === null));
  assert.equal(governorRatio(r.state), 1.5);
  r = feed(r.state, r.now, [FAST]);
  assert.deepEqual(r.ratios, [2]);
});

test('gobernador: una ventana media rompe la racha holgada', () => {
  const { state, now } = droppedTo15();
  const r = feed(state, now, [...times(6, FAST), MID, ...times(6, FAST)]);
  assert.ok(r.ratios.every(x => x === null));
});

// From 1.5 (drop confirmed), fast windows until it goes up to 2. → { state, now } right after the raise
function raisedTo2() {
  let { state, now } = droppedTo15();
  for (;;) {
    const r = feed(state, now, [FAST]);
    ({ state, now } = r);
    if (r.ratios[0] === 2) return { state, now };
  }
}

test('gobernador: lenta a los 4 s de subir baja y veta 2 durante 30 s; el segundo veto es definitivo', () => {
  let { state, now } = raisedTo2();
  const raisedAt = now;
  // Una ventana lenta que acaba 4 s después de subir
  let r = governorStep(state, { samples: win(SLOW) }, raisedAt + 4000);
  assert.equal(r.ratio, 1.5);
  state = r.state;now = raisedAt + 4000;
  const vetoAt = now;
  // Holgado durante más de 5 s, pero dentro del veto: no sube
  now += GOVERNOR.cooldownMs;
  r = feed(state, now, times(12, FAST));
  assert.ok(r.ratios.every(x => x === null));
  assert.ok(r.now < vetoAt + GOVERNOR.vetoMs);
  ({ state, now } = r);
  // Sigue holgado hasta pasar el veto: sube a 2
  let up = null;
  while (up === null) {
    const f = feed(state, now, [FAST]);
    ({ state, now } = f);up = f.ratios[0];
    assert.ok(up === null || now >= vetoAt + GOVERNOR.vetoMs);
  }
  assert.equal(up, 2);
  // Recae otra vez: veto definitivo
  r = governorStep(state, { samples: win(SLOW) }, now + 4000);
  assert.equal(r.ratio, 1.5);
  ({ state } = r);now += 4000;
  r = feed(state, now + GOVERNOR.cooldownMs, times(200, FAST));
  assert.ok(r.ratios.every(x => x === null));
  assert.equal(governorRatio(r.state), 1.5);
});

test('gobernador: lenta pasados 10 s desde la subida no es recaída (dos lentas seguidas para bajar)', () => {
  const { state, now } = raisedTo2();
  const r = governorStep(state, { samples: win(SLOW) }, now + GOVERNOR.relapseMs + 1);
  assert.equal(r.ratio, null);
});

test('gobernador: durante los 3 s posteriores a un cambio no hay otro cambio, pase lo que pase', () => {
  const { state, now } = feed(governorInit(2), 10000, [SLOW, SLOW]);
  assert.equal(governorRatio(state), 1.5);
  for (const ms of [SLOW, FAST, 24, 50]) {
    for (const dt of [1, 1500, GOVERNOR.cooldownMs - 1]) {
      let s = state;
      for (let i = 0; i < 5; i++) {
        const r = governorStep(s, { samples: win(ms) }, now + dt);
        assert.equal(r.ratio, null, `${ms} ms a los ${dt} ms`);
        s = r.state;
      }
    }
  }
});

test('gobernador: las ventanas medias (19 ms) no suben ni bajan nunca', () => {
  assert.ok(feed(governorInit(2), 10000, times(500, MID)).ratios.every(x => x === null));
  const { state, now } = droppedTo15();
  assert.ok(feed(state, now, times(500, MID)).ratios.every(x => x === null));
});

test('gobernador: en el escalón más bajo las ventanas lentas no cambian nada', () => {
  assert.ok(feed(governorInit(1), 10000, times(20, SLOW)).ratios.every(x => x === null));
  assert.ok(feed(governorInit(0.75), 10000, times(20, SLOW)).ratios.every(x => x === null));
  // Bajando desde 1,25 hasta 1, y ahí se queda
  let { state, now, ratios } = feed(governorInit(1.25), 10000, [SLOW, SLOW]);
  assert.deepEqual(ratios, [null, 1]);
  ({ state, ratios } = feed(state, now + GOVERNOR.cooldownMs, [12, ...times(20, SLOW)]));
  assert.ok(ratios.every(x => x === null));
  assert.equal(governorRatio(state), 1);
});

test('gobernador: es puro, no cambia el estado que recibe', () => {
  const s0 = governorInit(2);
  const copy = JSON.stringify(s0);
  const r1 = governorStep(s0, { samples: win(SLOW) }, 10000);
  governorStep(r1.state, { samples: win(SLOW) }, 11500);
  assert.equal(JSON.stringify(s0), copy);
  assert.equal(r1.state.slowRun, 1);
  assert.equal(s0.slowRun, 0);
});

test('la portada usa el gobernador solo en continuous y escucha los cambios de densidad', () => {
  assert.match(home, /governorStep\(/);
  const frame = home.slice(home.indexOf('function frame('), home.indexOf('renderDock();\nrequestAnimationFrame(frame);'));
  assert.match(frame, /if\(RENDER_MODE==="continuous"&&!calibrating&&gov\)/);
  assert.match(home, /function governorWindow\([^)]*\)\{[^]*?governorStep\(/);
  assert.match(home, /matchMedia\(`\(resolution: \$\{devicePixelRatio\}dppx\)`\)\.addEventListener\("change",/);
  assert.match(home, /renderer\.setPixelRatio\(Math\.min\(qualityPixelRatio\(W,Hh\),ratio\)\);renderer\.setSize\(W,Hh,false\);/);
  assert.doesNotMatch(home.slice(home.indexOf('function governorWindow(')), /localStorage\.setItem\([^)]*gov/);
});

test('la portada marca tainted cada ventana con resize, vuelta de pestaña, textura, cámara, cambio de modo o recién revelada', () => {
  assert.match(home, /const taintGovernor=\(\)=>\{govTaint=true;\};/);
  const resize = home.slice(home.indexOf('function resize(){'), home.indexOf('addEventListener("resize",resize)'));
  assert.match(resize, /taintGovernor\(\);renderer\.setPixelRatio\(governedPixelRatio\(\)\)/);
  assert.match(home, /document\.addEventListener\("visibilitychange",taintGovernor\)/);
  const tex = home.slice(home.indexOf('function tex('), home.indexOf('\n', home.indexOf('function tex(')));
  assert.equal(tex.match(/taintGovernor\(\)/g)?.length, 2, 'las dos llamadas de tex(): carga y error');
  assert.match(home, /loader\.load\("tex\/logo-540\.png",\(\)=>\{wake\(\);taintGovernor\(\);\}\)/);
  assert.match(home, /const GOV_SETTLE_MS=2000;/);
  const win = home.slice(home.indexOf('function governorWindow('), home.indexOf('/* ---------- Calibration'));
  assert.match(win, /if\(anim\|\|mode!==govMode\|\|now<revealAt\+GOV_SETTLE_MS\)govTaint=true;govMode=mode;/);
  assert.match(win, /governorStep\(gov,\{samples:govSamples,tainted:govTaint\},now\)/);
  assert.match(home, /revealAt=t0;govTaint=true;/);
});

test('governorRetop: un tope nuevo conserva la bajada, los vetos y la congelación', () => {
  const base = governorInit(1.5);
  // Mismo tope: el mismo estado
  assert.equal(governorRetop(base, 1.5), base);
  // En el tope, sigue en el tope nuevo
  assert.equal(governorRatio(governorRetop(base, 1.8)), 1.8);
  assert.equal(governorRatio(governorRetop(base, 1.3)), 1.3);
  // Bajado de 1,5 a 1,25 (y dado por bueno): con el tope a 1,8 sigue en 1,25, no vuelve arriba
  let { state, now } = feed(base, 10000, [SLOW, SLOW]);
  assert.equal(governorRatio(state), 1.25);
  ({ state, now } = feed(state, now + GOVERNOR.cooldownMs, [12]));
  let r = governorRetop(state, 1.8);
  assert.deepEqual(r.steps, [1, 1.25, 1.5, 1.8]);
  assert.equal(governorRatio(r), 1.25);
  assert.equal(r.check, null);
  // Por debajo del ratio en uso: el escalón más alto que no lo supera
  assert.equal(governorRatio(governorRetop(state, 1.1)), 1.1);
  // Congelado sigue congelado
  assert.equal(governorRetop(Object.freeze({ ...base, frozen: true }), 1.8).frozen, true);
  // Vetos por ratio: el veto definitivo de 1,5 sigue sobre 1,5 con tope 1,8 y pasa a 1,3 con tope 1,3
  const vetoed = Object.freeze({ ...state, vetoes: Object.freeze({ 2: Object.freeze({ count: 2, until: Infinity }) }) });
  assert.deepEqual(governorRetop(vetoed, 1.8).vetoes, { 2: { count: 2, until: Infinity } });
  r = governorRetop(vetoed, 1.3);
  assert.deepEqual(r.steps, [1, 1.3]);
  assert.deepEqual(r.vetoes, { 1: { count: 2, until: Infinity } });
  // Y el veto sigue funcionando: horas holgadas no suben de 1,25
  assert.ok(feed(governorRetop(vetoed, 1.8), now + GOVERNOR.cooldownMs, times(2000, FAST)).ratios.every(x => x === null));
  // La comprobación pendiente tras bajar apunta al mismo ratio en los escalones nuevos
  ({ state } = feed(base, 10000, [SLOW, SLOW]));
  r = governorRetop(state, 1.8);
  assert.equal(r.steps[r.check.from], 1.5);
  // No cambia el estado que recibe
  const copy = JSON.stringify(state);
  governorRetop(state, 1.1);
  assert.equal(JSON.stringify(state), copy);
});
