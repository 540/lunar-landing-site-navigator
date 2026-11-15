// Engine benchmark without a DEM (#414): scripts/bench-engine.ts ends with code 0, times the rows without terrain,
// reports the terrain rows as not run and, with --json, writes them. No time thresholds: times are only printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NO_DEM = 'no ejecutado: falta el DEM';

/** Runs the benchmark with no DEM (LUNAR_TERRAIN_DIR=none), outside the test runner's context. */
function runBench(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, LUNAR_TERRAIN_DIR: 'none' };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['scripts/bench-engine.ts', ...args], { cwd: BACKEND, env, encoding: 'utf8' });
}

test('banco sin DEM: código 0, filas sin relieve con tiempo, las de relieve sin ejecutar y --json con rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  try {
    const file = path.join(dir, 'banco.json');
    const r = runBench(['--json', file]);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n');
    const timed = lines.filter((l) => /\d+\.\d ms$/.test(l)), skipped = lines.filter((l) => l.endsWith(NO_DEM));
    for (const name of ['Efemérides, un año a 1 h', 'Ventanas de 30 d a 15 min, sin relieve', 'sun-earth de un instante, sin relieve',
      'Búsqueda polo sur, 15 km, 30 d, 1 h, sin relieve', 'Barrido de fechas de un año cada 6 h, misión de 14 d, sin relieve']) {
      assert.ok(timed.some((l) => l.startsWith(name)), `fila con tiempo: ${name}`);
    }
    for (const name of ['Máscara precisa', 'Máscara rápida', 'Ventanas de un año a 15 min, relieve preciso', 'Búsqueda polo sur, relieve rápido',
      'Ranking de 10 sitios', 'Barrido de fechas de un año cada 6 h, misión de 14 d, relieve preciso']) {
      assert.ok(skipped.some((l) => l.startsWith(name)), `fila sin ejecutar: ${name}`);
    }
    const out = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(out.node, process.version);
    assert.equal(out.demVersion, null);
    assert.equal(out.rows.length, timed.length + skipped.length);
    for (const row of out.rows) {
      assert.equal(typeof row.name, 'string');
      if (row.skipped) assert.equal(row.ms, null);
      else assert.ok(typeof row.ms === 'number' && row.ms >= 0, row.name);
    }
    assert.ok(out.rows.some((row: { skipped?: string }) => row.skipped) && out.rows.some((row: { ms: number | null }) => row.ms !== null));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('identidad sin DEM: dice que falta y termina con código 0', () => {
  const r = runBench(['--identity', '5']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /falta el DEM/);
});
