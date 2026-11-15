// Render bench (tools/render-bench/, #139, #142): the pure parts of lib.mjs and how home/index.html uses the quality values
// (the values themselves: tests/quality.test.mjs).
// No Chrome and no GPU: bench.mjs and diff.mjs are run by hand (npm run bench:render / bench:diff).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUALITY_STORAGE_KEY, buildResult, chromeFlags, diffStats, findChrome, frameStats, parseArgs, percentiles, qualityQuery } from '../tools/render-bench/lib.mjs';
import { STORAGE_KEY } from '../shared/render/quality.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.readFileSync(path.join(ROOT, 'home/index.html'), 'utf8');

test('sin argumentos, sin nivel ni valores de calidad (los decide la portada) y el dispositivo por defecto', () => {
  assert.deepEqual(parseArgs([]), {
    level: null,
    q: { pr: null, shadow: null, cap: null, tex: null, aniso: null, fs: null, rs: null },
    dev: { w: 1920, h: 1080, dpr: 1, gpu: 'hw', cpu: 1 },
    zone: 'menu', secs: 4, motion: false, sync: true, fresh: false, lose: false, shot: null, label: '', url: null,
  });
});

test('los argumentos cambian calidad, dispositivo, zona y salida', () => {
  const o = parseArgs(['--pr', '1.5', '--shadow=3072', '--cap', '320', '--tex', '2k', '--aniso', '4', '--fs', '8', '--rs', '0',
    '--w', '390', '--h', '844', '--dpr', '3', '--gpu', 'sw', '--cpu', '4', '--zone', 'simulador', '--secs', '2',
    '--motion', '--nosync', '--shot', 'a.png', '--label', 'medio', '--url', 'http://localhost:4540']);
  assert.deepEqual(o.q, { pr: 1.5, shadow: 3072, cap: 320, tex: '2k', aniso: 4, fs: 8, rs: 0 });
  assert.deepEqual(o.dev, { w: 390, h: 844, dpr: 3, gpu: 'sw', cpu: 4 });
  assert.equal(o.zone, 'simulador');
  assert.equal(o.secs, 2);
  assert.equal(o.motion, true);
  assert.equal(o.sync, false);
  assert.equal(o.shot, 'a.png');
  assert.equal(o.label, 'medio');
  assert.equal(o.url, 'http://localhost:4540');
});

test('opciones o valores no válidos se rechazan', () => {
  assert.throws(() => parseArgs(['--nada', '1']), /desconocida/);
  assert.throws(() => parseArgs(['--pr', 'mucho']), /número/);
  assert.throws(() => parseArgs(['--gpu', 'metal']), /--gpu/);
  assert.throws(() => parseArgs(['--zone', 'marte']), /--zone/);
  assert.throws(() => parseArgs(['--tex', '8k']), /--tex/);
  assert.throws(() => parseArgs(['--q', 'ultra']), /--q/);
  assert.throws(() => parseArgs(['--q', 'Alto']), /--q/);
  assert.throws(() => parseArgs(['--q']), /Falta/);
  assert.throws(() => parseArgs(['--secs']), /Falta/);
});

test('los números que la portada o Chrome ignorarían se rechazan: 0, negativos y enteros con decimales', () => {
  for (const name of ['pr', 'shadow', 'cap', 'aniso', 'fs', 'w', 'h', 'dpr', 'cpu', 'secs']) {
    assert.throws(() => parseArgs([`--${name}`, '0']), /> 0|≥ 1/, `--${name} 0`);
    assert.throws(() => parseArgs([`--${name}`, '-1']), /> 0|≥ 1/, `--${name} -1`);
  }
  for (const name of ['shadow', 'cap', 'fs', 'w', 'h']) assert.throws(() => parseArgs([`--${name}`, '0.4']), /entero/, `--${name} 0.4`);
  assert.throws(() => parseArgs(['--rs', '-1']), /≥ 0/);
  assert.equal(parseArgs(['--rs', '0']).q.rs, 0);
  assert.equal(parseArgs(['--rs', '1']).q.rs, 1);
  assert.throws(() => parseArgs(['--rs', '0.5']), /0 o 1/);
  assert.throws(() => parseArgs(['--rs', '2']), /0 o 1/);
  assert.equal(parseArgs(['--pr', '0.5']).q.pr, 0.5);
});

test('--q fija el nivel de calidad: alto, medio o bajo', () => {
  for (const level of ['alto', 'medio', 'bajo']) {
    assert.equal(parseArgs(['--q', level]).level, level);
    assert.equal(parseArgs([`--q=${level}`]).level, level);
  }
  const o = parseArgs(['--q', 'bajo', '--shadow', '4096']);
  assert.equal(o.q.shadow, 4096);
  assert.equal(o.q.pr, null);
});

test('--fresh borra el nivel guardado de la portada antes de cargar', () => {
  assert.equal(parseArgs(['--fresh']).fresh, true);
  assert.equal(parseArgs([]).fresh, false);
  assert.equal(QUALITY_STORAGE_KEY, STORAGE_KEY);
});

test('calibración y tooSlow leídos de __bench.quality; sin ellos, null', () => {
  const quality = { level: 'alto', source: 'auto', values: { tex: '4k' }, calibration: [{ level: 'medio', p50: 3.1, p95: 4 }, { level: 'alto', p50: 4.2, p95: 6 }], tooSlow: false };
  const { result } = buildResult({ opts: parseArgs([]), page: { tex: '4k', quality }, frames: [[0, 2]] });
  assert.deepEqual(result.calibration, quality.calibration);
  assert.equal(result.tooSlow, false);
  const none = buildResult({ opts: parseArgs([]), page: {}, frames: [] }).result;
  assert.equal(none.calibration, null);
  assert.equal(none.tooSlow, null);
});

test('--lose fuerza la pérdida de contexto tras medir; lostNotice y renderMode en la salida (#144)', () => {
  assert.equal(parseArgs(['--lose']).lose, true);
  assert.equal(parseArgs(['--zone', 'simulador', '--lose', '--secs', '2']).lose, true);
  const quality = { level: 'bajo', source: 'auto', values: { tex: '2k' }, renderMode: 'onDemand' };
  // La pérdida provocada llega después de leer la página: la medición sigue siendo válida
  const { result, exitCode } = buildResult({ opts: parseArgs(['--lose']), page: { ...page, tex: '2k', quality }, frames: [[0, 2]], lostNotice: true });
  assert.equal(result.lostNotice, true);
  assert.equal(result.renderMode, 'onDemand');
  assert.equal(result.contextLost, false);
  assert.equal(exitCode, 0);
  const none = buildResult({ opts: parseArgs([]), page: {}, frames: [] }).result;
  assert.equal(none.lostNotice, null);
  assert.equal(none.renderMode, null);
});

test('governor leído de __bench.quality (#166); sin él, null', () => {
  const governor = { ratio: 2, frozen: false, changes: [] };
  const { result } = buildResult({ opts: parseArgs([]), page: { quality: { level: 'alto', source: 'url', values: { tex: '4k' }, governor } }, frames: [[0, 2]] });
  assert.deepEqual(result.governor, governor);
  assert.equal(buildResult({ opts: parseArgs([]), page: {}, frames: [] }).result.governor, null);
});

test('--zone explore mide el modo «Explorar la Luna»', () => {
  assert.equal(parseArgs(['--zone', 'explore']).zone, 'explore');
  assert.equal(parseArgs(['--zone=explore', '--q', 'medio']).zone, 'explore');
});

test('la URL de la portada lleva el nivel, los valores fijados y bench', () => {
  assert.equal(qualityQuery(parseArgs([]).q), 'bench');
  assert.equal(qualityQuery(parseArgs(['--q', 'bajo']).q, 'bajo'), 'q=bajo&bench');
  assert.equal(qualityQuery(parseArgs(['--q', 'bajo', '--shadow', '4096', '--tex', '4k']).q, 'bajo'), 'q=bajo&shadow=4096&tex=4k&bench');
  assert.equal(qualityQuery({ pr: 1.25, aniso: 8, rs: 0 }), 'pr=1.25&aniso=8&rs=0&bench');
});

test('percentiles p50, p95 y máximo de una lista conocida', () => {
  const times = Array.from({ length: 100 }, (_, i) => 100 - i); // 1..100, desordenada
  assert.deepEqual(percentiles(times), { p50: 50, p95: 95, max: 100 });
  assert.deepEqual(percentiles([3, 1, 2]), { p50: 2, p95: 3, max: 3 });
  assert.deepEqual(percentiles([]), { p50: null, p95: null, max: null });
});

test('tiempo de render y entre frames a partir de [inicio, duración]', () => {
  const s = frameStats([[0, 2], [4, 3], [8, 2], [16, 5]]);
  assert.equal(s.frames, 4);
  assert.deepEqual(s.renderMs, { p50: 2, p95: 5, max: 5 });
  assert.deepEqual(s.frameMs, { p50: 4, p95: 8, max: 8 });
});

test('diferencia de dos imágenes RGBA sintéticas', () => {
  // Cuatro píxeles: igual, +6 en rojo, +10 en verde, +30 en azul (alfa distinto, no cuenta)
  const a = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255, 100, 100, 100, 255]);
  const b = new Uint8ClampedArray([100, 100, 100, 0, 106, 100, 100, 255, 100, 110, 100, 255, 100, 100, 130, 255]);
  // meanAbs = (6 + 10 + 30) / (4 píxeles × 3 canales); por encima de 8: dos de cuatro; de 24: uno de cuatro
  assert.deepEqual(diffStats(a, b), { meanAbs: 3.8333, pctOver8: 50, pctOver24: 25 });
  assert.deepEqual(diffStats(a, a), { meanAbs: 0, pctOver8: 0, pctOver24: 0 });
  assert.throws(() => diffStats(a, a.subarray(4)), /size/);
});

const opts = parseArgs(['--zone', 'simulador', '--label', 'x']);
const page = { lost: 0, readyAt: 1890.44, colorAt: 1950.1, gpu: { renderer: 'ANGLE (NVIDIA)', maxTextureSize: 32768, buffer: [1920, 1080], lost: false },
  info: { triangles: 494686, calls: 52, textures: 13, geometries: 164 } };

test('una medición válida: todos los campos, megapíxeles y código 0', () => {
  const { result, exitCode } = buildResult({ opts, page, frames: [[0, 2], [4, 3]], heapMB: 15.04, gpuMemDeltaMiB: 533, shot: 'a.png' });
  assert.equal(exitCode, 0);
  assert.deepEqual(Object.keys(result), ['label', 'q', 'dev', 'zone', 'level', 'levelSource', 'calibration', 'tooSlow', 'renderMode', 'governor', 'readyMs', 'textureMs', 'frames', 'renderMs', 'frameMs', 'megapixels',
    'buffer', 'info', 'heapMB', 'gpuRenderer', 'maxTex', 'gpuMemDeltaMiB', 'contextLost', 'lostNotice', 'shot', 'error']);
  assert.equal(result.megapixels, 2.07);
  assert.equal(result.readyMs, 1890.4);
  assert.equal(result.gpuRenderer, 'ANGLE (NVIDIA)');
  assert.equal(result.maxTex, 32768);
  assert.equal(result.contextLost, false);
  assert.equal(result.error, null);
  assert.equal(result.level, null);
  assert.equal(result.levelSource, null);
});

test('nivel y origen leídos de __bench.quality', () => {
  const quality = { level: 'bajo', source: 'auto', values: { pr: 1.25, shadow: 2048, cap: 230, tex: '2k', aniso: 8, fs: 8, rs: false } };
  const { result, exitCode } = buildResult({ opts: parseArgs(['--gpu', 'sw']), page: { ...page, tex: '2k', quality }, frames: [[0, 2]] });
  assert.equal(result.level, 'bajo');
  assert.equal(result.levelSource, 'auto');
  // bajo pide la textura de 2k: que se use la de 2k no es un error
  assert.equal(exitCode, 0);
  const failed = buildResult({ opts: parseArgs(['--q', 'bajo']), page: { ...page, tex: 'fallback', quality: { ...quality, source: 'url' } } });
  assert.match(failed.result.error, /2k.*procedural/);
  assert.equal(failed.result.levelSource, 'url');
  // --tex manda sobre el nivel
  const asked4k = buildResult({ opts: parseArgs(['--q', 'bajo', '--tex', '4k']), page: { ...page, tex: '2k', quality } });
  assert.match(asked4k.result.error, /4k/);
});

test('contexto perdido: contextLost, error y código 1', () => {
  const lost = buildResult({ opts, page: { ...page, lost: 1 }, frames: [[0, 2]] });
  assert.equal(lost.result.contextLost, true);
  assert.equal(lost.result.error, 'WebGL context lost');
  assert.equal(lost.exitCode, 1);
  const lostAtEnd = buildResult({ opts, page: { ...page, gpu: { ...page.gpu, lost: true } } });
  assert.equal(lostAtEnd.result.contextLost, true);
  assert.equal(lostAtEnd.exitCode, 1);
});

test('textura de 4k que no cargó: error y código 1; con la de 4k o pidiendo 2k, válida', () => {
  const failed = buildResult({ opts, page: { ...page, tex: '2k' }, frames: [[0, 2]] });
  assert.match(failed.result.error, /4k/);
  assert.equal(failed.exitCode, 1);
  assert.equal(buildResult({ opts, page: { ...page, tex: '4k' }, frames: [[0, 2]] }).exitCode, 0);
  const opts2k = parseArgs(['--tex', '2k']);
  assert.equal(buildResult({ opts: opts2k, page: { ...page, tex: '2k' }, frames: [[0, 2]] }).exitCode, 0);
});

test('textura de 2k que no cargó (la portada usa una procedural): error y código 1, pida 2k o 4k', () => {
  const failed2k = buildResult({ opts: parseArgs(['--tex', '2k']), page: { ...page, tex: 'fallback' }, frames: [[0, 2]] });
  assert.match(failed2k.result.error, /2k.*procedural/);
  assert.equal(failed2k.exitCode, 1);
  const failed4k = buildResult({ opts, page: { ...page, tex: 'fallback' }, frames: [[0, 2]] });
  assert.match(failed4k.result.error, /4k/);
  assert.equal(failed4k.exitCode, 1);
});

test('home/index.html marca la textura procedural en __bench.tex si la de 2k no carga', () => {
  assert.match(home, /if\(err2&&B\)B\.tex="fallback"/);
});

test('tiempo agotado: error y código 1', () => {
  const { result, exitCode } = buildResult({ opts, error: 'Tiempo agotado esperando a que cargue la portada' });
  assert.equal(result.contextLost, false);
  assert.match(result.error, /Tiempo agotado/);
  assert.equal(result.megapixels, null);
  assert.equal(exitCode, 1);
});

test('banderas de Chrome por modo de GPU', () => {
  const always = ['--headless=new', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--mute-audio'];
  for (const gpu of ['hw', 'sw', 'default']) for (const f of always) assert.ok(chromeFlags(gpu, '/tmp/x').includes(f), `${gpu}: ${f}`);
  assert.ok(chromeFlags('hw', '/tmp/x').includes('--use-angle=gl-egl'));
  assert.ok(chromeFlags('sw', '/tmp/x').includes('--use-angle=swiftshader'));
  assert.ok(!chromeFlags('default', '/tmp/x').some(f => f.startsWith('--use-angle')));
});

test('Chrome: primero $CHROME, luego los nombres conocidos; si no hay, null', () => {
  const have = new Set(['/usr/bin/chromium', '/opt/chrome']);
  const resolve = n => (n.includes('/') ? (have.has(n) ? n : null) : have.has(`/usr/bin/${n}`) ? `/usr/bin/${n}` : null);
  assert.equal(findChrome({ CHROME: '/opt/chrome' }, resolve), '/opt/chrome');
  assert.equal(findChrome({}, resolve), '/usr/bin/chromium');
  assert.equal(findChrome({}, () => null), null);
});

test('home/index.html usa los valores de calidad que resuelve shared/render/quality.js', () => {
  assert.match(home, /const Q=\{\.\.\.QUALITY\.values,bench:QS\.has\("bench"\)\}/);
  assert.match(home, /shadow\.mapSize\.set\(Q\.shadow,Q\.shadow\)/);
  assert.match(home, /capGrid:Q\.cap/);
  assert.match(home, /MOON\.setCapGrid\(Q\.cap\)/);
  assert.match(home, /Math\.min\(Q\.aniso,renderer\.capabilities\.getMaxAnisotropy\(\)\)/);
  assert.match(home, /samples:\(\)=>Q\.fs/);
  assert.match(home, /castShadow=Q\.rs/);
  assert.match(home, /if\(Q\.tex!=="4k"\)/);
});

test('window.__bench solo existe con ?bench', () => {
  const assignments = [...home.matchAll(/window\.__bench\s*=/g)];
  assert.equal(assignments.length, 1);
  assert.match(home, /const B=Q\.bench\?window\.__bench=\{/);
});

test('las estrellas usan una semilla fija, no Math.random', () => {
  const stars = home.slice(home.indexOf('const N=3200'), home.indexOf('PointsMaterial'));
  assert.ok(stars.length > 0);
  assert.doesNotMatch(stars, /Math\.random/);
});
