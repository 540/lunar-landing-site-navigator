// Exact ephemeris table shared between threads (#417): moonFixedVectors gives the same bits with and without it, instants
// off its grid do not touch it, every hit returns new arrays, another thread reads what one filled, the operations give
// the same results, and the memo of withVectorCache still comes first.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { moonFixedVectors, vectorCacheStats, withVectorCache } from '../src/ephemeris.ts';
import {
  TABLE_END_MS, TABLE_ENTRIES, TABLE_START_MS, TABLE_STEP_MS, adoptEphemerisTable, createEphemerisTable,
  ephemerisTableEnabled, ephemerisTableFilled, ephemerisTableIndex, ephemerisTableStats,
} from '../src/ephemerisTable.ts';
import type { EphemerisTable } from '../src/ephemerisTable.ts';
import { sweepLandingDates } from '../src/landingSweep.ts';
import { REGIONS, searchGrid } from '../src/search.ts';
import { snapshot, windows } from '../src/service.ts';
import { getSite } from '../src/sites.ts';
import { VALIDATED_DATES } from '../src/useCases.ts';
import type { PerBody, Vec3 } from '../src/types.ts';

const HOUR = 3600e3, DAY = 24 * HOUR, T0 = Date.UTC(2027, 0, 10);
const six = (v: PerBody<Vec3>): number[] => [...v.sun, ...v.earth];
const sameBits = (a: PerBody<Vec3>, b: PerBody<Vec3>, what: string): void => {
  const x = six(a), y = six(b);
  assert.equal(x.length, 6);
  for (let i = 0; i < 6; i++) assert.ok(Object.is(x[i], y[i]), `${what}: componente ${i} ${x[i]} ≠ ${y[i]}`);
};
const plain = (ms: number): PerBody<Vec3> => { adoptEphemerisTable(null); return moonFixedVectors(new Date(ms)); };
const delta = (before: { hits: number; misses: number }) => {
  const now = ephemerisTableStats();
  return { hits: now.hits - before.hits, misses: now.misses - before.misses };
};

afterEach(() => adoptEphemerisTable(null));

test('la rejilla: cada 15 min de 2026-01-01 a 2031-01-01, ambos incluidos, el rango validado', () => {
  assert.equal(TABLE_START_MS, VALIDATED_DATES.startMs);
  assert.equal(TABLE_END_MS, VALIDATED_DATES.endMs);
  assert.equal(TABLE_STEP_MS, 900_000);
  assert.equal(TABLE_ENTRIES, 175_297);
  const t = createEphemerisTable();
  assert.equal(t.vectors.byteLength, TABLE_ENTRIES * 6 * 8);
  assert.equal(t.filled.byteLength, TABLE_ENTRIES);
  assert.equal(ephemerisTableFilled(t), 0, 'no precalcula nada');
});

test('LUNAR_EPHEMERIS_TABLE: 0 la apaga; sin definir, encendida salvo bajo node --test', () => {
  assert.equal(ephemerisTableEnabled({}), true);
  assert.equal(ephemerisTableEnabled({ NODE_TEST_CONTEXT: 'child-v8' }), false);
  assert.equal(ephemerisTableEnabled({ NODE_TEST_CONTEXT: 'child-v8', LUNAR_EPHEMERIS_TABLE: '1' }), true);
  assert.equal(ephemerisTableEnabled({ LUNAR_EPHEMERIS_TABLE: '0' }), false);
  assert.throws(() => ephemerisTableEnabled({ LUNAR_EPHEMERIS_TABLE: 'sí' }), /LUNAR_EPHEMERIS_TABLE/);
});

test('identidad bit a bit: fallo y acierto dan lo mismo que sin tabla en 2 000 instantes del rango', () => {
  const N = 2000, instants: number[] = [];
  for (let i = 0; i < N; i++) instants.push(TABLE_START_MS + Math.round((i * (TABLE_ENTRIES - 1)) / (N - 1)) * TABLE_STEP_MS);
  assert.equal(instants[0], TABLE_START_MS);
  assert.equal(instants[N - 1], TABLE_END_MS);
  const reference = instants.map(plain);
  const table = createEphemerisTable();
  adoptEphemerisTable(table);
  const before = ephemerisTableStats();
  instants.forEach((ms, i) => sameBits(moonFixedVectors(new Date(ms)), reference[i], `fallo ${new Date(ms).toISOString()}`));
  assert.deepEqual(delta(before), { hits: 0, misses: N });
  instants.forEach((ms, i) => sameBits(moonFixedVectors(new Date(ms)), reference[i], `acierto ${new Date(ms).toISOString()}`));
  assert.deepEqual(delta(before), { hits: N, misses: N });
  assert.equal(ephemerisTableFilled(table), N);
});

test('fuera de la rejilla o del rango no toca la tabla y da lo mismo que sin ella', () => {
  const off = [T0 + 1, TABLE_START_MS - TABLE_STEP_MS, TABLE_END_MS + TABLE_STEP_MS, T0 + 60e3];
  const reference = off.map(plain);
  const table = createEphemerisTable();
  adoptEphemerisTable(table);
  const before = ephemerisTableStats();
  off.forEach((ms, i) => sameBits(moonFixedVectors(new Date(ms)), reference[i], new Date(ms).toISOString()));
  assert.deepEqual(delta(before), { hits: 0, misses: 0 });
  assert.equal(ephemerisTableFilled(table), 0);
  // A Date truncates its milliseconds, so non-integer instants are checked on the index itself.
  assert.equal(ephemerisTableIndex(T0 + 0.5), -1);
  assert.equal(ephemerisTableIndex(Number.NaN), -1);
  assert.equal(ephemerisTableIndex(T0), (T0 - TABLE_START_MS) / TABLE_STEP_MS);
  adoptEphemerisTable(null);
  assert.equal(ephemerisTableIndex(T0), -1, 'sin tabla adoptada, nada está en ella');
});

test('cada acierto devuelve arrays nuevos: mutarlos no cambia la tabla', () => {
  const reference = plain(T0);
  adoptEphemerisTable(createEphemerisTable());
  moonFixedVectors(new Date(T0)); // fills the entry
  const a = moonFixedVectors(new Date(T0)), b = moonFixedVectors(new Date(T0));
  assert.notEqual(a, b);
  assert.notEqual(a.sun, b.sun);
  assert.notEqual(a.earth, b.earth);
  a.sun[0] = 0; a.earth[2] = 0;
  sameBits(b, reference, 'segundo acierto');
  sameBits(moonFixedVectors(new Date(T0)), reference, 'la tabla');
});

/** Runs moonFixedVectors in another thread that adopts `table`; returns its values and its hits and misses. */
function inWorker(table: EphemerisTable, instants: number[]): Promise<{ values: number[][]; hits: number; misses: number }> {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const eph = await import(workerData.ephemeris);
      const tab = await import(workerData.table);
      tab.adoptEphemerisTable(workerData.shared);
      const values = workerData.instants.map((ms) => { const v = eph.moonFixedVectors(new Date(ms)); return [...v.sun, ...v.earth]; });
      parentPort.postMessage({ values, ...tab.ephemerisTableStats() });
    })().catch((err) => { throw err; });
  `;
  return new Promise((resolve, reject) => {
    const w = new Worker(code, {
      eval: true,
      workerData: {
        ephemeris: new URL('../src/ephemeris.ts', import.meta.url).href,
        table: new URL('../src/ephemerisTable.ts', import.meta.url).href,
        shared: table, instants,
      },
    });
    w.once('message', (m) => { resolve(m); void w.terminate(); });
    w.once('error', reject);
  });
}

test('worker_threads: un hilo rellena la tabla y otro que la adopta lee aciertos con los mismos bits', async () => {
  const instants = Array.from({ length: 200 }, (_, i) => T0 + i * 7 * TABLE_STEP_MS);
  const table = createEphemerisTable();
  const first = await inWorker(table, instants);
  assert.deepEqual({ hits: first.hits, misses: first.misses }, { hits: 0, misses: instants.length });
  assert.equal(ephemerisTableFilled(table), instants.length);
  const second = await inWorker(table, instants);
  assert.deepEqual({ hits: second.hits, misses: second.misses }, { hits: instants.length, misses: 0 });
  // This thread also adopts it: hits, with the bits of the computation without a table.
  const reference = instants.map(plain);
  adoptEphemerisTable(table);
  const before = ephemerisTableStats();
  instants.forEach((ms, i) => {
    const want = six(reference[i]);
    for (let j = 0; j < 6; j++) {
      assert.ok(Object.is(first.values[i][j], want[j]) && Object.is(second.values[i][j], want[j]), `${new Date(ms).toISOString()}: componente ${j}`);
    }
    sameBits(moonFixedVectors(new Date(ms)), reference[i], 'hilo principal');
  });
  assert.deepEqual(delta(before), { hits: instants.length, misses: 0 });
});

test('windows, snapshot, sweepLandingDates y searchGrid dan lo mismo con la tabla, en frío y ya rellena', () => {
  const site = getSite('shackleton-rim')!;
  const strip = <T extends object>(r: T): T => { const { timingMs: _t, ...rest } = r as T & { timingMs?: unknown }; return rest as T; };
  const run = () => ({
    windows: windows(site, T0, T0 + 10 * DAY, { stepMs: TABLE_STEP_MS, mask: null }),
    windowsOffGrid: windows(site, T0 + 7 * 60e3, T0 + 2 * DAY, { stepMs: 10 * 60e3, mask: null }),
    snapshot: snapshot(site, T0, { mask: null, lookaheadDays: 10 }),
    sweep: strip(sweepLandingDates(site, { startMs: T0, endMs: T0 + 20 * DAY, dateStepMs: DAY, missionDays: 5, stepMs: HOUR, mode: 'limb' })),
    search: strip(searchGrid(REGIONS['polo-sur'], { startMs: T0, endMs: T0 + 5 * DAY, stepMs: HOUR, mode: 'limb', spacingKm: 40, refine: 2, refineTop: 3, top: 5 })),
  });
  const reference = run();
  const table = createEphemerisTable();
  adoptEphemerisTable(table);
  const before = ephemerisTableStats();
  assert.deepStrictEqual(run(), reference, 'en frío');
  const cold = delta(before);
  assert.ok(cold.misses > 0 && ephemerisTableFilled(table) === cold.misses, `rellena la tabla (${cold.misses})`);
  assert.deepStrictEqual(run(), reference, 'con la tabla ya rellena');
  const warm = delta(before);
  assert.equal(warm.misses, cold.misses, 'la segunda vez todo son aciertos');
  assert.ok(warm.hits > cold.hits);
});

test('dentro de withVectorCache el memo sigue ganando: mismo resultado y mismos contadores', () => {
  const site = getSite('im1')!;
  const scoped = () => {
    const before = vectorCacheStats();
    const r = withVectorCache(() => [windows(site, T0, T0 + 3 * DAY, { mask: null }), windows(site, T0, T0 + 3 * DAY, { mask: null })]);
    const after = vectorCacheStats();
    return { r, hits: after.hits - before.hits, misses: after.misses - before.misses };
  };
  const reference = scoped();
  adoptEphemerisTable(createEphemerisTable());
  const tableBefore = ephemerisTableStats();
  const withTable = scoped();
  assert.deepStrictEqual(withTable, reference);
  // The table only sees the misses of the memo (the instants on its grid), never its hits.
  assert.ok(delta(tableBefore).misses + delta(tableBefore).hits <= reference.misses);
  const d = new Date(T0);
  withVectorCache(() => {
    const x = moonFixedVectors(d);
    assert.equal(moonFixedVectors(d), x, 'mismo objeto: el memo, no la tabla');
  });
});
