// Handler of a test pool (test/locks.test.ts): takes the lock of one mask of the disk cache. /hang never finishes the
// computation (the pool terminates the worker at its timeout, lock held); /mask asks for the same mask and says where it
// came from and how long it waited.
import { obtainMask } from '../../src/terrain/maskCache.ts';
import { prepare } from '../../src/httpServe.ts';
import type { Prepared, RouteTask } from '../../src/httpServe.ts';

const KEY = { version: 'test', resolution: 'fast' as const, h: 2, latE5: -8945000, lonE5: 3300000, nAz: 4 };
const record = () => ({ heightM: 0, el: new Float64Array(KEY.nAz), coverage: 1 });

export function compute(task: RouteTask): Prepared {
  if (task.url === '/hang') obtainMask(KEY, () => { for (;;) { /* stuck: only terminate() stops it */ } });
  const t0 = performance.now();
  const got = obtainMask(KEY, record);
  return prepare({ status: 200, headers: {}, body: JSON.stringify({ from: got.from, waitedMs: performance.now() - t0 }) });
}
