// Worker-thread pool for the HTTP server of the public API (data/src/server.ts).
//
// The calculation engine is synchronous: a search, a sweep or a mask blocks the thread that runs it. The servers send
// the WHOLE request to a worker (not just the masks): the worker runs the same route code as before, so the response is
// the same byte for byte, and the main thread only parses URLs, queues, compresses (zlib in libuv's thread pool) and
// writes. Masks and direct rays are computed deep inside the engine (refinement of a search, hybrid horizon), so sending
// only them would mean making the engine asynchronous.
//
//  - One copy of the DEM: the pool reads the grids once into SharedArrayBuffers (dem.ts loadSharedGrids) and every
//    worker uses them.
//  - One ephemeris table: the pool creates an exact table of Sun/Earth vectors (ephemerisTable.ts) in SharedArrayBuffers
//    and every worker, replacements included, fills it on demand and reads it (off with LUNAR_EPHEMERIS_TABLE=0).
//  - Queue: at most `queueMax` tasks wait; one more → QueueFullError (the server answers 503 with Retry-After).
//    Light tasks (a snapshot) go before heavy ones (a search); asynchronous jobs go last.
//  - Reserved workers (`lightReserved`, LUNAR_LIGHT_WORKERS; 1 by default from 2 workers up): they only take light
//    tasks, so a light request never waits behind a queue of heavy ones (since API 1.13.0). The other workers take
//    light tasks too.
//  - Timeout per task, counted from when it is queued: still queued → it leaves the queue; running → its worker is
//    terminated (the only way to stop synchronous code) and replaced.
//  - Coalescing of masks: workers share the disk cache, and its lock files make two workers that need the same mask
//    compute it once (terrain/maskCache.ts). Each worker tells the pool which locks it holds; when a worker is
//    terminated (timeout) the pool removes the locks it left, so the next request does not wait for them.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { loadSharedGrids } from './terrain/dem.ts';
import { createEphemerisTable, ephemerisTableEnabled } from './ephemerisTable.ts';
import type { EphemerisTable } from './ephemerisTable.ts';
import { removeOrphanLocks } from './terrain/maskCache.ts';
import type { TerrainCounters } from './types.ts';

export type Priority = 'light' | 'heavy' | 'job';

/** What a worker runs: a request of one of the servers (method, URL and, for a POST, its body), optionally as an asynchronous job. */
export interface RouteTask { method: string; url: string; job?: boolean; body?: string }

/** A computed response, ready to send: body already encoded and its ETag (hash of the body), if any. */
export interface Prepared { status: number; headers: Record<string, string>; body: Uint8Array; etag: string | null }

export interface PoolOptions {
  size: number;
  queueMax: number;
  /** Workers that only take light tasks (default defaultLightReserved(size)); never all of them. */
  lightReserved?: number;
  /** Module the workers import: it must export compute(task, hooks) → Prepared (routes of one server). */
  handler: string;
  /** Terrain folder whose DEM is shared (default, the one of the environment). */
  terrainDir?: string | null;
  /** Environment of the workers (default, the process one). */
  env?: Record<string, string | undefined>;
}

export class QueueFullError extends Error {}
export class TaskTimeoutError extends Error {
  readonly queued: boolean;
  constructor(queued: boolean) { super(queued ? 'timeout en cola' : 'timeout'); this.queued = queued; }
}

interface Pending {
  id: number;
  task: RouteTask;
  priority: Priority;
  resolve: (p: Prepared) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout | null;
  onProgress?: (p: unknown) => void;
  onStart?: () => void;
}
interface Slot {
  worker: Worker;
  threadId: number;
  /** Only takes light tasks. */
  lightOnly: boolean;
  ready: boolean;
  started: boolean;
  job: Pending | null;
  stats: TerrainCounters | null;
  /** Mask locks (maskCache.ts) the worker holds right now. */
  locks: Set<string>;
}

/** Default size: one worker per core but one (the main thread). LUNAR_WORKERS changes it; 0 = no pool. */
export function defaultPoolSize(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LUNAR_WORKERS;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  if (env.NODE_TEST_CONTEXT) return 0; // node --test: in-process and deterministic unless a test asks for a pool
  return Math.max(1, os.availableParallelism() - 1);
}

/** Workers reserved for light tasks by default: 1 when there are at least 2 (LUNAR_LIGHT_WORKERS changes it, httpServe.ts). */
export const defaultLightReserved = (size: number): number => (size >= 2 ? 1 : 0);

const ZERO: TerrainCounters = { computed: 0, fromDisk: 0, fromMemory: 0, noCoverage: 0, computeMs: 0, rays: 0, rayHits: 0, rayMs: 0 };

export class WorkerPool {
  readonly size: number;
  readonly queueMax: number;
  readonly lightReserved: number;
  readonly ready: Promise<void>;
  /** Exact ephemeris table shared by the workers (null when LUNAR_EPHEMERIS_TABLE turns it off). */
  readonly ephemerisTable: EphemerisTable | null;
  private readonly opts: PoolOptions;
  private slots: Slot[] = [];
  private queues: Record<Priority, Pending[]> = { light: [], heavy: [], job: [] };
  private nextId = 1;
  private grids: Record<string, SharedArrayBuffer> = {};
  private closed = false;
  private startFailures = 0;
  private retired: TerrainCounters = { ...ZERO };
  private counters = { done: 0, rejectedFull: 0, timeouts: 0, restarts: 0, orphanLocks: 0 };

  constructor(opts: PoolOptions) {
    this.opts = opts;
    const size = Math.max(1, opts.size);
    this.size = size;
    this.queueMax = opts.queueMax;
    const reserved = Math.max(0, Math.min(opts.lightReserved ?? defaultLightReserved(size), size - 1));
    this.lightReserved = reserved;
    this.ephemerisTable = ephemerisTableEnabled(opts.env ?? process.env) ? createEphemerisTable() : null;
    this.ready = (async () => {
      this.grids = await loadSharedGrids(opts.terrainDir === undefined ? undefined : opts.terrainDir);
      for (let i = 0; i < size; i++) this.slots.push(this.spawn(i < reserved));
      await Promise.all(this.slots.map((s) => new Promise<void>((resolve, reject) => {
        s.worker.once('message', () => resolve());
        s.worker.once('error', reject);
      })));
      this.dispatch();
    })();
  }

  private spawn(lightOnly: boolean): Slot {
    const env = this.opts.env ?? process.env;
    const terrainEnv = this.opts.terrainDir !== undefined ? { LUNAR_TERRAIN_DIR: this.opts.terrainDir ?? 'none' } : {};
    const worker = new Worker(new URL('./poolWorker.ts', import.meta.url), {
      workerData: { handler: this.opts.handler, grids: this.grids, ephemeris: this.ephemerisTable },
      env: { ...env, ...terrainEnv },
    });
    const slot: Slot = { worker, threadId: worker.threadId, lightOnly, ready: false, started: false, job: null, stats: null, locks: new Set() };
    worker.on('message', (msg: { type: string; id?: number; result?: Prepared; progress?: unknown; message?: string; stats?: TerrainCounters; lock?: string; held?: boolean }) => {
      if (msg.type === 'ready') { slot.ready = slot.started = true; this.startFailures = 0; this.dispatch(); return; }
      if (msg.type === 'lock') { if (msg.held) slot.locks.add(msg.lock!); else slot.locks.delete(msg.lock!); return; }
      const job = slot.job;
      if (!job || msg.id !== job.id) return;
      if (msg.type === 'progress') { job.onProgress?.(msg.progress); return; }
      if (msg.stats) slot.stats = msg.stats;
      slot.job = null;
      if (job.timer) clearTimeout(job.timer);
      this.counters.done++;
      if (msg.type === 'result') job.resolve(msg.result!);
      else job.reject(new Error(msg.message ?? 'error en el worker'));
      this.dispatch();
    });
    worker.on('error', (err) => { console.error('[pool] worker:', err); });
    worker.on('exit', () => {
      const i = this.slots.indexOf(slot);
      if (slot.stats) this.addRetired(slot.stats);
      const job = slot.job;
      slot.job = null;
      if (job) { if (job.timer) clearTimeout(job.timer); job.reject(new Error('El worker terminó de forma inesperada')); }
      // Locks of masks the worker was computing when it was terminated: removed now, so no other worker waits for them.
      if (slot.locks.size) {
        const locks = [...slot.locks];
        slot.locks.clear();
        void removeOrphanLocks(locks, slot.threadId).then((n) => { this.counters.orphanLocks += n; });
      }
      if (i < 0 || this.closed) return;
      // A worker that dies before being ready (broken module, out of memory) is not restarted in a loop.
      if (!slot.started && ++this.startFailures > 3) { console.error('[pool] los workers no arrancan; no se reinician más'); return; }
      this.counters.restarts++;
      this.slots[i] = this.spawn(slot.lightOnly);
    });
    return slot;
  }

  private addRetired(s: TerrainCounters): void {
    for (const k of Object.keys(ZERO) as (keyof TerrainCounters)[]) this.retired[k] += s[k];
  }

  private queued(): number { return this.queues.light.length + this.queues.heavy.length + this.queues.job.length; }

  private dispatch(): void {
    // Light tasks first to the reserved workers (the others stay free for heavy ones), then to any free worker.
    const free = this.slots.filter((s) => s.ready && !s.job).sort((a, b) => Number(b.lightOnly) - Number(a.lightOnly));
    for (const slot of free) {
      const next = this.queues.light.shift() ?? (slot.lightOnly ? undefined : this.queues.heavy.shift() ?? this.queues.job.shift());
      if (!next) continue;
      slot.job = next;
      next.onStart?.();
      slot.worker.postMessage({ type: 'run', id: next.id, task: next.task });
    }
  }

  /**
   * Runs a task in a worker. Rejects with QueueFullError if `queueMax` tasks are already waiting and with
   * TaskTimeoutError if it takes longer than `timeoutMs` (from now, queue included).
   */
  run(task: RouteTask, { priority = 'heavy', timeoutMs = 0, onProgress, onStart }: { priority?: Priority; timeoutMs?: number; onProgress?: (p: unknown) => void; onStart?: () => void } = {}): Promise<Prepared> {
    if (this.closed) return Promise.reject(new Error('pool cerrado'));
    const idle = this.slots.some((s) => s.ready && !s.job && (priority === 'light' || !s.lightOnly));
    if (!idle && this.queued() >= this.queueMax) {
      this.counters.rejectedFull++;
      return Promise.reject(new QueueFullError('cola llena'));
    }
    return new Promise<Prepared>((resolve, reject) => {
      const job: Pending = { id: this.nextId++, task, priority, resolve, reject, timer: null, onProgress, onStart };
      if (timeoutMs > 0) {
        job.timer = setTimeout(() => {
          this.counters.timeouts++;
          const q = this.queues[priority], i = q.indexOf(job);
          if (i >= 0) { q.splice(i, 1); reject(new TaskTimeoutError(true)); return; }
          const slot = this.slots.find((s) => s.job === job);
          if (slot) { slot.job = null; slot.ready = false; reject(new TaskTimeoutError(false)); void slot.worker.terminate(); }
        }, timeoutMs);
        job.timer.unref?.();
      }
      this.queues[priority].push(job);
      this.dispatch();
    });
  }

  /** Mask counters of all workers (last report of each, plus those of workers that were replaced). */
  terrainCounters(): TerrainCounters {
    const sum = { ...this.retired };
    for (const s of this.slots) if (s.stats) for (const k of Object.keys(ZERO) as (keyof TerrainCounters)[]) sum[k] += s.stats[k];
    return sum;
  }

  status(): { workers: number; lightReserved: number; ready: number; busy: number; queued: number; queueMax: number; done: number; rejectedFull: number; timeouts: number; restarts: number; orphanLocks: number } {
    return { workers: this.slots.length, lightReserved: this.lightReserved, ready: this.slots.filter((s) => s.ready).length, busy: this.slots.filter((s) => s.job).length, queued: this.queued(), queueMax: this.queueMax, ...this.counters };
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const q of Object.values(this.queues)) for (const j of q.splice(0)) { if (j.timer) clearTimeout(j.timer); j.reject(new Error('pool cerrado')); }
    await this.ready.catch(() => {});
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
  }
}
