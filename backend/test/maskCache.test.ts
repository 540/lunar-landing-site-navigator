// Disk cache of on-demand masks (terrain/maskCache.ts): one file per mask written atomically, LRU with a budget, heights
// kept on disk only on the 0.5 m grid, old append-only format read without loading it whole, and locks that make a
// thread wait for the mask another one is computing.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { configureDem, makeGrid } from '../src/terrain/dem.ts';
import { configureMasks, maskFor, terrainStatus } from '../src/horizon.ts';
import { diskStats, encode, maskFile, persistsHeight, sweepMaskCache } from '../src/terrain/maskCache.ts';
import type { MaskKey } from '../src/terrain/maskCache.ts';
import type { Grid } from '../src/types.ts';

function synthetic(res: number, halfKm: number, z: (x: number, y: number) => number): Grid {
  const n = Math.round((2 * halfKm * 1000) / res), a = new Float32Array(n * n);
  const X0 = -halfKm * 1000, Y0 = halfKm * 1000;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = z(X0 + (i + 0.5) * res, Y0 - (j + 0.5) * res);
  return makeGrid({ name: 'synth', res, X0, Y0, w: n, h: n, a });
}
const version = configureDem({ grids: [synthetic(240, 200, (x, y) => 800 * Math.sin(x / 9000) * Math.cos(y / 7000))] })!;
const dirs: string[] = [];
const tmp = (): string => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mask-cache-')); dirs.push(d); return d; };
/** Every file under a folder (relative paths), but the sweep marker. */
const files = (dir: string): string[] => (fs.existsSync(dir) ? (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(dir, f)).isFile() && !f.endsWith('.last-sweep')) : []);
const key = (lat: number, lon: number, h = 2, resolution: 'fast' | 'precise' = 'fast'): MaskKey =>
  ({ version, resolution, h, latE5: Math.round(lat * 1e5), lonE5: Math.round(lon * 1e5), nAz: resolution === 'fast' ? 360 : 720 });

afterEach(() => {
  configureMasks({ diskCache: false, cacheDir: null, memoryMax: 10000, legacy: true, lockWaitMs: 30000, lockStaleMs: 60000, sweepIntervalMs: 10000 });
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

test('un fichero por máscara, escrito de forma atómica (sin temporales ni cerrojos al acabar) e idéntico al recalcularlo', () => {
  const dir = tmp();
  configureMasks({ diskCache: true, cacheDir: dir });
  const a = maskFor(-89.2, 40.1234567, 2, 'fast')!;
  assert.equal(terrainStatus().computed, 1);
  const list = files(dir);
  assert.deepEqual(list.map((f) => path.basename(f)), ['-8920000_4012346.bin']);
  assert.ok(list.every((f) => !f.endsWith('.tmp') && !f.endsWith('.lock')));
  assert.equal(path.join(dir, list[0]), maskFile(key(-89.2, 40.1234567)));
  configureMasks({}); // memory cleared, disk kept
  const b = maskFor(-89.2, 40.1234567, 2, 'fast')!;
  assert.deepEqual({ ...terrainStatus(), computeMs: 0 }, { ...terrainStatus(), computed: 0, fromDisk: 1, computeMs: 0 });
  assert.deepEqual(b, a, 'la máscara leída del disco es la misma (campos, orden y source) que la calculada');
  assert.equal(JSON.stringify(b), JSON.stringify(a));
});

test('un fichero incompleto o ajeno se ignora y se recalcula', () => {
  const dir = tmp();
  configureMasks({ diskCache: true, cacheDir: dir });
  const file = maskFile(key(-89.3, 10));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(100)); // half a record
  const m = maskFor(-89.3, 10, 2, 'fast')!;
  assert.equal(terrainStatus().computed, 1);
  assert.equal(fs.statSync(file).size, 12 + 2 * 360 + 2, 'reemplazado por el registro completo');
  configureMasks({});
  assert.deepEqual(maskFor(-89.3, 10, 2, 'fast'), m);
  assert.equal(terrainStatus().fromDisk, 1);
});

test('alturas: solo las de la rejilla de 0,5 m van al disco; el cálculo nunca se cuantiza', () => {
  const dir = tmp();
  configureMasks({ diskCache: true, cacheDir: dir });
  assert.ok([2, 2.5, 3, 5, 10].every(persistsHeight));
  assert.ok(![2.3, 0.1, 7.25].some(persistsHeight));
  const m23 = maskFor(-89.25, 20, 2.3, 'fast')!, m25 = maskFor(-89.25, 20, 2.5, 'fast')!;
  assert.equal(m23.observerHeightM, 2.3);
  assert.notDeepEqual(Array.from(m23.el), Array.from(m25.el), '2,3 m no se calcula a 2,5 m');
  assert.deepEqual(files(dir).map((f) => f.split(path.sep)[2]), ['fast_h2.5']);
});

test('LRU en memoria con tope y en disco con presupuesto: se expulsan las menos usadas', async () => {
  const dir = tmp();
  configureMasks({ diskCache: true, cacheDir: dir, memoryMax: 2 });
  const pts = [10, 20, 30, 40, 50, 60].map((lon) => [-89.4, lon] as const);
  for (const [lat, lon] of pts) maskFor(lat, lon, 2, 'fast');
  assert.equal(terrainStatus().computed, 6);
  maskFor(-89.4, 10, 2, 'fast'); // out of the memory LRU (2 entries): read from disk, which touches its file
  assert.equal(terrainStatus().fromDisk, 1);
  // The first five files get an old mtime (the one just read, a bit less old): they are the least recently used.
  const old = Date.now() / 1000 - 3600;
  pts.slice(0, 5).forEach(([lat, lon], i) => fs.utimesSync(maskFile(key(lat, lon)), old + i, old + i));
  fs.utimesSync(maskFile(key(-89.4, 10)), old + 100, old + 100);
  const one = sweepMaskCache(Infinity).bytes / 6;
  const r = sweepMaskCache(one * 3.5); // budget of 3.5 masks → down to 90 %: 3 masks stay
  assert.equal(r.files, 6);
  assert.equal(r.evicted, 3);
  const left = files(dir).map((f) => path.basename(f)).sort();
  assert.deepEqual(left, ['-8940000_1000000.bin', '-8940000_5000000.bin', '-8940000_6000000.bin'].sort());
});

test('formato antiguo (anexado): se lee registro a registro, sin escribirlo ni borrarlo; LUNAR_MASK_CACHE_LEGACY=0 lo ignora', () => {
  const ref = tmp(), dir = tmp();
  configureMasks({ diskCache: true, cacheDir: ref });
  const ks = [[-89.1, 5], [-89.2, 6], [-89.3, 7]] as const;
  const recs = ks.map(([lat, lon]) => { maskFor(lat, lon, 2, 'fast'); return fs.readFileSync(maskFile(key(lat, lon))); });
  const legacyFile = path.join(dir, `${version}_fast_h2.bin`);
  fs.writeFileSync(legacyFile, Buffer.concat([recs[2], recs[0], recs[1]])); // order of arrival, not sorted
  const before = fs.statSync(legacyFile).mtimeMs;
  configureMasks({ diskCache: true, cacheDir: dir });
  const m = maskFor(-89.2, 6, 2, 'fast')!;
  assert.equal(terrainStatus().fromDisk, 1);
  assert.equal(terrainStatus().computed, 0);
  assert.equal(diskStats.legacyReads, 1);
  configureMasks({ diskCache: true, cacheDir: ref });
  assert.deepEqual(maskFor(-89.2, 6, 2, 'fast'), m);
  assert.deepEqual(files(dir), [path.basename(legacyFile)], 'una lectura antigua no escribe nada nuevo');
  assert.equal(fs.statSync(legacyFile).mtimeMs, before);
  configureMasks({ diskCache: true, cacheDir: dir, legacy: false });
  maskFor(-89.2, 6, 2, 'fast');
  assert.equal(terrainStatus().computed, 1);
});

test('cerrojo: si otro hilo está calculando la máscara, se espera a su fichero en lugar de calcularla otra vez', async () => {
  const ref = tmp(), dir = tmp();
  configureMasks({ diskCache: true, cacheDir: ref });
  maskFor(-89.45, 33, 2, 'fast');
  const rec = fs.readFileSync(maskFile(key(-89.45, 33)));
  configureMasks({ diskCache: true, cacheDir: dir });
  const file = maskFile(key(-89.45, 33));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.lock`, '');
  // Another thread "finishes" the mask 300 ms later: temporary file, rename, lock released.
  const w = new Worker(`
    const fs = require('node:fs'); const { workerData: d } = require('node:worker_threads');
    setTimeout(() => { fs.writeFileSync(d.file + '.x.tmp', Buffer.from(d.rec)); fs.renameSync(d.file + '.x.tmp', d.file); fs.rmSync(d.file + '.lock'); }, 300);
  `, { eval: true, workerData: { file, rec: rec } });
  await new Promise((r) => w.once('online', r));
  const t0 = Date.now();
  maskFor(-89.45, 33, 2, 'fast');
  assert.ok(Date.now() - t0 >= 250, 'ha esperado al otro hilo');
  assert.equal(terrainStatus().computed, 0);
  assert.equal(terrainStatus().fromDisk, 1);
  assert.equal(diskStats.lockWaits, 1);
  await w.terminate();
});

test('un cerrojo abandonado (hilo muerto) caduca y la máscara se calcula', () => {
  const dir = tmp();
  configureMasks({ diskCache: true, cacheDir: dir, lockStaleMs: 1000 });
  const file = maskFile(key(-89.5, 44));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.lock`, '');
  const old = Date.now() / 1000 - 60;
  fs.utimesSync(`${file}.lock`, old, old);
  assert.ok(maskFor(-89.5, 44, 2, 'fast'));
  assert.equal(terrainStatus().computed, 1);
  assert.ok(!fs.existsSync(`${file}.lock`));
  assert.ok(fs.existsSync(file));
});

test('encode es la inversa del registro del disco', () => {
  const k = key(-89, 1);
  const buf = encode(k, { heightM: 123.4, el: Float64Array.from({ length: 360 }, (_, i) => (i % 7) / 100 - 0.02), coverage: 0.987 });
  assert.equal(buf.length, 12 + 720 + 2);
  assert.equal(buf.readInt32LE(8), 1234);
});
