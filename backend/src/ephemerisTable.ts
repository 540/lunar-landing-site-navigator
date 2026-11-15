// Exact ephemeris table shared by every thread of a server (#417, epic #413).
//
// moonFixedVectors (ephemeris.ts) costs ~12 µs per instant in astronomy-engine, and windows, sweeps, rankings and
// sun-earth sample the same instants again and again. This table keeps the Moon→Sun and Moon→Earth vectors of a fixed
// grid of instants (every 15 min from 2026-01-01T00:00Z to 2031-01-01T00:00Z, both included: the validated range of
// useCases.ts) in two SharedArrayBuffers, so that an instant is computed once for the whole server, by whichever thread
// needs it first, and then read by all of them.
//
//  - Exact: it stores the computed Float64 values, so a read gives the same bits as computing again (no interpolation).
//  - On demand: nothing is precomputed; an entry is filled the first time some thread asks for it.
//  - Memory: 6 Float64 per entry (Sun x, y, z and Earth x, y, z, ~8.4 MB) plus 1 byte per entry for the `filled` flag.
//  - Threads: the values are written first and the flag is set afterwards with Atomics.store; a reader only trusts the
//    values after Atomics.load sees the flag. Two threads that fill the same entry at once write the same bits.
//
// Who creates it: the pool (pool.ts) creates one and hands it to every worker (poolWorker.ts adopts it); without a pool
// the data/ server adopts its own in the main thread. LUNAR_EPHEMERIS_TABLE=0 turns it off; under node --test it is off
// unless a test asks for it (like the pool and the result cache).
import type { PerBody, Vec3 } from './types.ts';

export const TABLE_START_MS = Date.UTC(2026, 0, 1);
export const TABLE_END_MS = Date.UTC(2031, 0, 1);
export const TABLE_STEP_MS = 15 * 60e3;
export const TABLE_ENTRIES = (TABLE_END_MS - TABLE_START_MS) / TABLE_STEP_MS + 1;
const FIELDS = 6;

/** The shared buffers of a table: what travels to the workers. */
export interface EphemerisTable { vectors: SharedArrayBuffer; filled: SharedArrayBuffer }

let vectors: Float64Array | null = null;
let filled: Uint8Array | null = null;
const stats = { hits: 0, misses: 0 };

/** A new, empty table (nothing is computed until it is used). */
export function createEphemerisTable(): EphemerisTable {
  return {
    vectors: new SharedArrayBuffer(TABLE_ENTRIES * FIELDS * Float64Array.BYTES_PER_ELEMENT),
    filled: new SharedArrayBuffer(TABLE_ENTRIES),
  };
}

/** Makes this thread use `table` (null: stop using one). */
export function adoptEphemerisTable(table: EphemerisTable | null): void {
  if (!table) { vectors = filled = null; return; }
  if (table.vectors.byteLength !== TABLE_ENTRIES * FIELDS * Float64Array.BYTES_PER_ELEMENT || table.filled.byteLength !== TABLE_ENTRIES) {
    throw new Error('La tabla de efemérides no tiene el tamaño de la rejilla');
  }
  vectors = new Float64Array(table.vectors);
  filled = new Uint8Array(table.filled);
}

/** Hits and misses of the table in this thread since it started (instants outside the grid count as neither). */
export const ephemerisTableStats = (): { hits: number; misses: number } => ({ ...stats });

/** Entries of `table` already filled (for measurements and tests). */
export function ephemerisTableFilled(table: EphemerisTable): number {
  const f = new Uint8Array(table.filled);
  let n = 0;
  for (let k = 0; k < f.length; k++) n += Atomics.load(f, k);
  return n;
}

/** Whether the servers use a table: LUNAR_EPHEMERIS_TABLE=0 turns it off; unset, on except under node --test. */
export function ephemerisTableEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.LUNAR_EPHEMERIS_TABLE ?? '';
  if (raw === '') return !env.NODE_TEST_CONTEXT;
  if (raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`LUNAR_EPHEMERIS_TABLE debe valer 0 o 1 (vale «${raw}»)`);
}

/** Index of the entry of instant `ms` in the grid, or -1 if it is not on the grid (or no table is adopted). */
export function ephemerisTableIndex(ms: number): number {
  if (!filled || !Number.isInteger(ms) || ms < TABLE_START_MS || ms > TABLE_END_MS) return -1;
  const off = ms - TABLE_START_MS;
  return off % TABLE_STEP_MS === 0 ? off / TABLE_STEP_MS : -1;
}

/**
 * Vectors of entry `k` (from ephemerisTableIndex): read from the table if it is filled (in new arrays on every call),
 * otherwise computed with `compute`, stored and returned.
 */
export function tableVectors(k: number, compute: () => PerBody<Vec3>): PerBody<Vec3> {
  const v = vectors!, f = filled!, i = k * FIELDS;
  if (Atomics.load(f, k) === 1) {
    stats.hits++;
    return { sun: [v[i], v[i + 1], v[i + 2]], earth: [v[i + 3], v[i + 4], v[i + 5]] };
  }
  stats.misses++;
  const r = compute();
  v[i] = r.sun[0]; v[i + 1] = r.sun[1]; v[i + 2] = r.sun[2];
  v[i + 3] = r.earth[0]; v[i + 4] = r.earth[1]; v[i + 5] = r.earth[2];
  Atomics.store(f, k, 1);
  return r;
}
