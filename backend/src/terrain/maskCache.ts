// On-disk cache of on-demand horizon masks (horizon.ts maskFor), shared by every process and worker thread.
//
// Format (v2): ONE SMALL FILE PER MASK, <dir>/v2/<demVersion>/<resolution>_h<height>/<shard>/<latE5>_<lonE5>.bin, with the
// same record as the old format: header (latE5, lonE5, ground height in dm: 3 × Int32 LE) + Int16[nAz] (hundredths of a
// degree) + coverage in ‰ (UInt16). Why one file per mask and not an index: a lookup reads ~1–1.5 KB and nothing else
// (the old format read the whole file, 600 MB for a polar grid, into each process), a write is atomic (temporary file +
// rename: a reader sees the whole mask or nothing, never half of it, even with several workers or servers at once), a
// lock file next to it coalesces concurrent computations of the same mask, and the LRU eviction is deleting the files
// with the oldest mtime (a hit touches its file).
//
// Bounds:
//  - maxBytes (LUNAR_MASK_CACHE_MAX_MB, 1024 by default): disk usage (allocated blocks) of v2. When a thread has written
//    5 % of it since its last sweep, it walks the cache and deletes the least recently used files down to 90 %.
//  - Heights: the computation is NOT quantized (an observer at 2.3 m gets the 2.3 m mask, as before), but only heights
//    on a grid of heightStepM (LUNAR_MASK_DISK_HEIGHT_STEP_M, 0.5 m: 2, 2.5, 3, 5, 10 m…) are written to disk; any other
//    height lives only in memory. At most 201 height folders (0–100 m), whatever the requests ask for.
//  - Coordinates: already rounded to 1e-5° by maskFor (the computation is done at the rounded point).
//
// Old format (<dir>/<demVersion>_<resolution>_h<height>.bin, append-only, before 1.10.0): read only, never written nor
// deleted. Its records are found through a compact sorted index (16 bytes per mask) built the first time a thread
// needs that file; the masks are read one by one, not the whole file. LUNAR_MASK_CACHE_LEGACY=0 ignores it.
import fs from 'node:fs';
import path from 'node:path';
import { threadId } from 'node:worker_threads';
import type { Resolution } from '../types.ts';

/** Mask data as stored: ground height (m), elevations (°, hundredths) and coverage (0–1). */
export interface MaskRecord { heightM: number; el: Float64Array; coverage: number }
export interface MaskKey { version: string; resolution: Resolution; h: number; latE5: number; lonE5: number; nAz: number }

export interface MaskCacheConfig {
  /** Folder of the cache (null = no disk cache). */
  dir: string | null;
  enabled: boolean;
  /** Disk budget of the v2 store, bytes. */
  maxBytes: number;
  /** Only heights multiple of this step (m) are written to disk (0 = every height). */
  heightStepM: number;
  /** Read the old append-only files too. */
  legacy: boolean;
  /** How long to wait for another thread that is computing the same mask before computing it too (ms). */
  lockWaitMs: number;
  /** A lock older than this is from a thread that died: it is removed (ms). */
  lockStaleMs: number;
  /** Minimum time between two sweeps of the cache, shared through a marker file (ms). */
  sweepIntervalMs: number;
}

const HEADER = 12;
const recSize = (nAz: number): number => HEADER + 2 * nAz + 2;
const envNumber = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== '' && Number.isFinite(v) && v >= 0 ? v : fallback;
};

/** Default configuration from the environment; `dir` is the terrain folder's cache/masks unless LUNAR_MASK_CACHE_DIR. */
export function maskCacheDefaults(terrainDir: string | null): MaskCacheConfig {
  const env = process.env.LUNAR_MASK_CACHE_DIR;
  const dir = env !== undefined && env !== '' ? (env === 'none' ? null : path.resolve(env)) : terrainDir ? path.join(terrainDir, 'cache', 'masks') : null;
  return {
    dir,
    enabled: true,
    maxBytes: envNumber('LUNAR_MASK_CACHE_MAX_MB', 1024) * 1024 * 1024,
    heightStepM: envNumber('LUNAR_MASK_DISK_HEIGHT_STEP_M', 0.5),
    legacy: process.env.LUNAR_MASK_CACHE_LEGACY !== '0',
    lockWaitMs: 30000,
    lockStaleMs: 60000,
    sweepIntervalMs: 10000,
  };
}

let cfg: MaskCacheConfig = maskCacheDefaults(null);
let writtenSinceSweep = Infinity; // the first write of a thread checks the budget (the cache may already be over it)
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms: number): void => { Atomics.wait(sleeper, 0, 0, ms); };

/** Counters of this thread (summed over the workers by the pool, and the tests). */
export const diskStats = { reads: 0, legacyReads: 0, writes: 0, lockWaits: 0, sweeps: 0, evicted: 0 };

export function configureMaskCache(c: Partial<MaskCacheConfig>): MaskCacheConfig {
  cfg = { ...cfg, ...c };
  writtenSinceSweep = Infinity;
  for (const st of legacy.values()) if (st) try { fs.closeSync(st.fd); } catch { /* already closed */ }
  legacy.clear();
  for (const k of Object.keys(diskStats) as (keyof typeof diskStats)[]) diskStats[k] = 0;
  return cfg;
}
export const maskCacheConfig = (): Readonly<MaskCacheConfig> => cfg;

const active = (): boolean => cfg.enabled && cfg.dir !== null;
const heightTag = (h: number): string => String(h);

/** Is this height written to disk? (multiple of heightStepM) */
export function persistsHeight(h: number): boolean {
  if (!(cfg.heightStepM > 0)) return true;
  const k = h / cfg.heightStepM;
  return Math.abs(k - Math.round(k)) < 1e-9;
}

/** v2 file of a mask. */
export function maskFile(k: MaskKey): string {
  const shard = (((k.latE5 * 31 + k.lonE5) % 256) + 256) % 256;
  return path.join(cfg.dir!, 'v2', k.version, `${k.resolution}_h${heightTag(k.h)}`, shard.toString(16).padStart(2, '0'), `${k.latE5}_${k.lonE5}.bin`);
}

export function encode(k: MaskKey, m: MaskRecord): Buffer {
  const rec = Buffer.alloc(recSize(k.nAz));
  rec.writeInt32LE(k.latE5, 0); rec.writeInt32LE(k.lonE5, 4); rec.writeInt32LE(Math.round(m.heightM * 10), 8);
  for (let i = 0; i < k.nAz; i++) rec.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(m.el[i] * 100))), HEADER + 2 * i);
  rec.writeUInt16LE(Math.round(m.coverage * 1000), HEADER + 2 * k.nAz);
  return rec;
}

function decode(buf: Buffer, off: number, nAz: number): MaskRecord {
  const el = new Float64Array(nAz);
  for (let i = 0; i < nAz; i++) el[i] = buf.readInt16LE(off + HEADER + 2 * i) / 100;
  return { heightM: buf.readInt32LE(off + 8) / 10, el, coverage: buf.readUInt16LE(off + HEADER + 2 * nAz) / 1000 };
}

/** Reads a v2 file; null if it does not exist or is not a whole record of this key (then it is ignored). */
function readV2(file: string, k: MaskKey): MaskRecord | null {
  let buf: Buffer;
  try { buf = fs.readFileSync(file); } catch { return null; }
  if (buf.length !== recSize(k.nAz) || buf.readInt32LE(0) !== k.latE5 || buf.readInt32LE(4) !== k.lonE5) return null;
  const now = new Date();
  try { fs.utimesSync(file, now, now); } catch { /* read-only disk: no LRU touch */ }
  diskStats.reads++;
  return decode(buf, 0, k.nAz);
}

// ---------- old format (read only) ----------
interface LegacyIndex { fd: number; keys: Float64Array; offsets: Float64Array; size: number }
const legacy: Map<string, LegacyIndex | null> = new Map();
const packKey = (latE5: number, lonE5: number): number => (latE5 + 10_000_000) * 50_000_000 + (lonE5 + 25_000_000);

function legacyIndex(file: string, nAz: number): LegacyIndex | null {
  if (legacy.has(file)) return legacy.get(file)!;
  let st: LegacyIndex | null = null;
  try {
    const fd = fs.openSync(file, 'r');
    const size = recSize(nAz), n = Math.floor(fs.fstatSync(fd).size / size);
    const keys = new Float64Array(n);
    const per = Math.max(1, Math.floor((8 << 20) / size));
    const chunk = Buffer.alloc(per * size);
    for (let i = 0; i < n; i += per) {
      const m = Math.min(per, n - i);
      fs.readSync(fd, chunk, 0, m * size, i * size);
      for (let j = 0; j < m; j++) keys[i + j] = packKey(chunk.readInt32LE(j * size), chunk.readInt32LE(j * size + 4));
    }
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => keys[a] - keys[b]);
    const sorted = new Float64Array(n), offsets = new Float64Array(n);
    for (let i = 0; i < n; i++) { sorted[i] = keys[order[i]]; offsets[i] = order[i] * size; }
    st = { fd, keys: sorted, offsets, size };
  } catch { st = null; }
  legacy.set(file, st);
  return st;
}

function readLegacy(k: MaskKey): MaskRecord | null {
  if (!cfg.legacy) return null;
  const idx = legacyIndex(path.join(cfg.dir!, `${k.version}_${k.resolution}_h${k.h}.bin`), k.nAz);
  if (!idx) return null;
  const want = packKey(k.latE5, k.lonE5);
  let lo = 0, hi = idx.keys.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.keys[mid] < want) lo = mid + 1; else if (idx.keys[mid] > want) hi = mid - 1; else {
      const buf = Buffer.alloc(idx.size);
      try { fs.readSync(idx.fd, buf, 0, idx.size, idx.offsets[mid]); } catch { return null; }
      diskStats.legacyReads++;
      return decode(buf, 0, k.nAz);
    }
  }
  return null;
}

// ---------- writing, locks and eviction ----------
function writeAtomic(file: string, data: Buffer): void {
  const tmp = `${file}.${process.pid}.${threadId}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file); // atomic on POSIX: readers see the old state or the whole new file
    diskStats.writes++;
    writtenSinceSweep += data.length;
  } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ } } // read-only disk: memory only
}

// Owner of a lock: its file holds «<pid>:<threadId>» (since API 1.13.0). A thread that dies while it holds a lock (a
// worker terminated after a 504) leaves the file behind; two ways to clear it without waiting lockStaleMs:
//  - another process: a waiter sees that the pid no longer exists and removes the lock;
//  - a worker of this process: the pool (pool.ts) hears of every lock its workers take and release (onLockChange) and,
//    when it replaces a terminated worker, removes the locks that worker still held (removeOrphanLocks, asynchronous).
let lockListener: ((lock: string, held: boolean) => void) | null = null;
/** Hears every lock this thread takes (held = true) and releases (false). The pool worker forwards them to the pool. */
export function onLockChange(fn: ((lock: string, held: boolean) => void) | null): void { lockListener = fn; }

const lockOwner = (): string => `${process.pid}:${threadId}`;

function tryLock(lock: string): boolean {
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const fd = fs.openSync(lock, 'wx');
    try { fs.writeSync(fd, lockOwner()); } finally { fs.closeSync(fd); }
    lockListener?.(lock, true);
    return true;
  } catch (e) {
    // EEXIST: another thread holds it. Anything else (read-only disk): carry on without a lock.
    return (e as NodeJS.ErrnoException).code !== 'EEXIST';
  }
}

function releaseLock(lock: string): void {
  try { fs.rmSync(lock, { force: true }); } catch { /* read-only */ }
  lockListener?.(lock, false);
}

/** Is the process `pid` gone? (signal 0 only checks; EPERM means it exists but belongs to someone else) */
function processGone(pid: number): boolean {
  try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
}

/** A lock to remove: older than lockStaleMs, or held by a process that no longer exists. */
function staleLock(lock: string): boolean {
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs > cfg.lockStaleMs) return true;
    const [pid] = fs.readFileSync(lock, 'utf8').split(':').map(Number);
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && processGone(pid);
  } catch { return false; }
}

/**
 * Removes the locks a dead thread of this process (`ownerThreadId`) left behind, without blocking: only the ones whose
 * file still names it as the owner (another thread may have taken the same lock since). Returns how many it removed.
 */
export async function removeOrphanLocks(locks: Iterable<string>, ownerThreadId: number): Promise<number> {
  const owner = `${process.pid}:${ownerThreadId}`;
  let removed = 0;
  await Promise.all([...locks].map(async (lock) => {
    try {
      if ((await fs.promises.readFile(lock, 'utf8')) !== owner) return;
      await fs.promises.rm(lock, { force: true });
      removed++;
    } catch { /* already gone */ }
  }));
  return removed;
}

/**
 * The mask of `k` from the disk cache or, if missing, computed ONCE by `compute` and stored. When another thread (or
 * process) is already computing it, waits for its file instead of computing it again (up to lockWaitMs). Returns the
 * record and where it came from.
 */
export function obtainMask(k: MaskKey, compute: () => MaskRecord): { record: MaskRecord; from: 'disk' | 'computed' } {
  if (!active()) return { record: compute(), from: 'computed' };
  const persist = persistsHeight(k.h);
  const file = persist ? maskFile(k) : null;
  const cached = (file && readV2(file, k)) || readLegacy(k);
  if (cached) return { record: cached, from: 'disk' };
  if (!file) return { record: compute(), from: 'computed' };
  const lock = `${file}.lock`;
  const deadline = Date.now() + cfg.lockWaitMs;
  let waited = false;
  for (;;) {
    if (tryLock(lock)) {
      try {
        const done = readV2(file, k); // finished by another thread between our read and our lock
        if (done) return { record: done, from: 'disk' };
        const record = compute();
        writeAtomic(file, encode(k, record));
        maybeSweep();
        return { record, from: 'computed' };
      } finally { releaseLock(lock); }
    }
    if (!waited) { waited = true; diskStats.lockWaits++; }
    if (staleLock(lock)) { try { fs.rmSync(lock, { force: true }); } catch { /* someone else removed it */ } continue; }
    if (Date.now() > deadline) {
      const record = compute();
      writeAtomic(file, encode(k, record));
      return { record, from: 'computed' };
    }
    sleep(5);
    const done = readV2(file, k);
    if (done) return { record: done, from: 'disk' };
  }
}

function maybeSweep(): void {
  if (writtenSinceSweep < Math.max(64 * 1024, cfg.maxBytes * 0.05)) return;
  const marker = path.join(cfg.dir!, 'v2', '.last-sweep');
  try {
    if (Date.now() - fs.statSync(marker).mtimeMs < cfg.sweepIntervalMs) return; // another thread swept recently
  } catch { /* no marker yet */ }
  try { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, ''); } catch { return; }
  sweepMaskCache();
}

/**
 * Walks the v2 store and deletes the least recently used masks (oldest mtime) until it uses at most 90 % of maxBytes.
 * Also removes temporary files and locks left by threads that died. Returns what it found and what it deleted.
 */
export function sweepMaskCache(maxBytes: number = cfg.maxBytes): { files: number; bytes: number; evicted: number; bytesAfter: number } {
  writtenSinceSweep = 0;
  diskStats.sweeps++;
  const root = cfg.dir ? path.join(cfg.dir, 'v2') : null;
  const entries: { file: string; bytes: number; mtimeMs: number }[] = [];
  let bytes = 0;
  const walk = (dir: string): void => {
    let list: fs.Dirent[];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      const file = path.join(dir, d.name);
      if (d.isDirectory()) { walk(file); continue; }
      let st: fs.Stats;
      try { st = fs.statSync(file); } catch { continue; }
      if (d.name.endsWith('.tmp') || d.name.endsWith('.lock')) {
        if (Date.now() - st.mtimeMs > cfg.lockStaleMs) try { fs.rmSync(file, { force: true }); } catch { /* gone */ }
        continue;
      }
      if (!d.name.endsWith('.bin')) continue;
      const size = st.blocks ? st.blocks * 512 : st.size;
      entries.push({ file, bytes: size, mtimeMs: st.mtimeMs });
      bytes += size;
    }
  };
  if (root) walk(root);
  let after = bytes, evicted = 0;
  if (bytes > maxBytes) {
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const e of entries) {
      if (after <= maxBytes * 0.9) break;
      try { fs.rmSync(e.file, { force: true }); after -= e.bytes; evicted++; } catch { /* in use or gone */ }
    }
  }
  diskStats.evicted += evicted;
  return { files: entries.length, bytes, evicted, bytesAfter: after };
}
