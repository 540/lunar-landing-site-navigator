// Orphan mask locks (terrain/maskCache.ts, pool.ts): a worker terminated after a timeout (a 504) while it computes a mask
// leaves its .lock behind. Before 1.13.0 the next request for that mask blocked its worker 30 s (lockWaitMs); now the
// pool removes the locks of the worker it replaces, and a waiter removes the lock of a process that no longer exists.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskTimeoutError, WorkerPool } from '../src/pool.ts';
import { configureMasks } from '../src/horizon.ts';
import { maskFile, obtainMask } from '../src/terrain/maskCache.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-locks-'));
after(() => {
  configureMasks({ diskCache: false, cacheDir: null, lockWaitMs: 30000, lockStaleMs: 60000 });
  fs.rmSync(dir, { recursive: true, force: true });
});
const KEY = { version: 'test', resolution: 'fast' as const, h: 2, latE5: -8945000, lonE5: 3300000, nAz: 4 };
const record = () => ({ heightM: 0, el: new Float64Array(KEY.nAz), coverage: 1 });

test('un worker terminado por timeout no deja su cerrojo: la siguiente petición de la máscara no espera', async () => {
  const cacheDir = path.join(dir, 'pool');
  const pool = new WorkerPool({
    size: 2, lightReserved: 0, queueMax: 4, terrainDir: null,
    handler: new URL('./fixtures/lockHandler.ts', import.meta.url).href,
    env: { ...process.env, LUNAR_MASK_CACHE_DIR: cacheDir },
  });
  try {
    await pool.ready;
    configureMasks({ diskCache: true, cacheDir });
    const lock = `${maskFile(KEY)}.lock`;
    await assert.rejects(pool.run({ method: 'GET', url: '/hang' }, { timeoutMs: 300 }), TaskTimeoutError);
    const t0 = performance.now();
    while (fs.existsSync(lock) && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 2));
    const recoveryMs = performance.now() - t0;
    assert.ok(!fs.existsSync(lock), 'el cerrojo del worker terminado sigue ahí');
    assert.ok(recoveryMs < 1000, `el cerrojo ha tardado ${recoveryMs.toFixed(0)} ms en desaparecer`);
    const r = JSON.parse(new TextDecoder().decode((await pool.run({ method: 'GET', url: '/mask' }, { timeoutMs: 10000 })).body));
    assert.equal(r.from, 'computed');
    assert.ok(r.waitedMs < 1000, `ha esperado ${r.waitedMs} ms a un cerrojo huérfano`);
    assert.equal(pool.status().orphanLocks, 1);
    assert.equal(pool.status().restarts, 1);
  } finally { await pool.close(); }
});

test('el cerrojo de un proceso que ya no existe se retira sin esperar a que caduque', () => {
  const cacheDir = path.join(dir, 'pid');
  configureMasks({ diskCache: true, cacheDir, lockWaitMs: 30000, lockStaleMs: 60000 });
  const file = maskFile(KEY);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.lock`, '999999999:1'); // a pid above any pid_max
  const t0 = performance.now();
  assert.equal(obtainMask(KEY, record).from, 'computed');
  assert.ok(performance.now() - t0 < 1000);
  assert.ok(!fs.existsSync(`${file}.lock`));
});

test('el cerrojo guarda su dueño (pid:hilo) y se retira al terminar', () => {
  const cacheDir = path.join(dir, 'owner');
  configureMasks({ diskCache: true, cacheDir });
  const file = maskFile(KEY);
  let seen = '';
  obtainMask(KEY, () => { seen = fs.readFileSync(`${file}.lock`, 'utf8'); return record(); });
  assert.equal(seen, `${process.pid}:0`);
  assert.ok(!fs.existsSync(`${file}.lock`));
});
