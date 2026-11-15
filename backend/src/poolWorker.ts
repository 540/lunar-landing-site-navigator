// Worker of the pool (pool.ts): uses the shared DEM, imports the routes of its server and runs the requests it is sent.
import { parentPort, workerData } from 'node:worker_threads';
import { adoptSharedGrids } from './terrain/dem.ts';
import { adoptEphemerisTable } from './ephemerisTable.ts';
import type { EphemerisTable } from './ephemerisTable.ts';
import { terrainStatus } from './horizon.ts';
import { onLockChange } from './terrain/maskCache.ts';
import type { Prepared, RouteTask } from './pool.ts';

const { handler, grids, ephemeris } = workerData as { handler: string; grids: Record<string, SharedArrayBuffer>; ephemeris: EphemerisTable | null };
adoptSharedGrids(grids);
adoptEphemerisTable(ephemeris); // the pool's exact ephemeris table, shared by every worker (null: off)
// The pool hears of every mask lock this worker holds: if it terminates the worker mid-computation, it removes them.
onLockChange((lock, held) => parentPort!.postMessage({ type: 'lock', lock, held }));
const routes = await import(handler) as { compute: (task: RouteTask, hooks: { progress?: (p: unknown) => void }) => Prepared };

const counters = () => {
  const { computed, fromDisk, fromMemory, noCoverage, computeMs, rays, rayHits, rayMs } = terrainStatus();
  return { computed, fromDisk, fromMemory, noCoverage, computeMs, rays, rayHits, rayMs };
};

parentPort!.on('message', (msg: { type: string; id: number; task: RouteTask }) => {
  if (msg.type !== 'run') return;
  let last = 0;
  const progress = (p: unknown): void => {
    const now = performance.now();
    if (now - last < 250) return; // at most 4 messages a second
    last = now;
    parentPort!.postMessage({ type: 'progress', id: msg.id, progress: p });
  };
  try {
    const result = routes.compute(msg.task, msg.task.job ? { progress } : {}); // progress only matters to jobs
    // The body travels without a copy: its buffer is transferred to the main thread.
    parentPort!.postMessage({ type: 'result', id: msg.id, result, stats: counters() }, [result.body.buffer as ArrayBuffer]);
  } catch (err) {
    parentPort!.postMessage({ type: 'error', id: msg.id, message: (err as Error)?.stack ?? String(err), stats: counters() });
  }
});
parentPort!.postMessage({ type: 'ready' });
