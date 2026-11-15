// Validation matrix against official sources (matrix.ts): computes every row with the engine and checks its limits.
//
//   npm run validate              prints the matrix; exits with an error if some row is ❌ (out of its limits)
//   npm run validate -- --write   also writes VALIDATION.md at the root of the repo
//   npm run validate -- --view    also writes the human view, a self-contained HTML page with every point (view.ts),
//                                 prints its path and opens it in the browser (--no-open: does not open it)
//   npm run validate -- --view --cached   the view of the last run (validation/out/validation-points.json), without measuring
//
// Every run writes the points of every row to validation/out/validation-points.json (ignored by git).
// From backend/ or the root. The terrain rows need the LOLA DEM in backend/terrain/cache (`node scripts/fetch-dem.ts`):
// without it they are reported as not run, they do not fail. The measurement units (measure.ts) run in worker threads
// that share one copy of the DEM; with 16 cores it takes ~2 min (most of it, 18.6 years of hourly samples at 101 points and two
// heights). LUNAR_VALIDATE_WORKERS changes the number of workers.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { adoptSharedGrids, configureDem, defaultTerrainDir, loadSharedGrids } from '../src/terrain/dem.ts';
import { configureLdrm } from '../src/terrain/ldrm.ts';
import { configureMasks } from '../src/horizon.ts';
import { allUnits, NEEDS, runUnit, terrainData, unitKey } from './measure.ts';
import type { Unit } from './measure.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TERRAIN = defaultTerrainDir() ?? path.join(HERE, '..', 'terrain');

/** Engine set-up of every thread: the terrain folder and no disk cache of masks (hermetic, as the tests). */
function setUp(): void {
  configureDem({ dir: TERRAIN });
  configureLdrm({ dir: TERRAIN });
  configureMasks({ diskCache: false });
}

if (!isMainThread) {
  adoptSharedGrids((workerData as { grids: Record<string, SharedArrayBuffer> }).grids);
  setUp();
  parentPort!.on('message', (u: Unit) => {
    try { parentPort!.postMessage({ key: unitKey(u), result: runUnit(u) }); } catch (err) { parentPort!.postMessage({ key: unitKey(u), error: (err as Error)?.stack ?? String(err) }); }
  });
} else if (process.argv.includes('--cached')) {
  const { readPoints, writeHtml } = await import('./view.ts');
  showView(writeHtml(readPoints()));
} else {
  const { evaluate, renderMarkdown, ROWS } = await import('./matrix.ts');
  const { toViewData, writeHtml, writePoints } = await import('./view.ts');
  setUp();
  const terrain = terrainData();
  const units = allUnits().filter((u) => { const need = NEEDS[u.kind]; return !need || (need === 'dem' ? terrain.dem : terrain.cap); });
  const t0 = performance.now();
  const grids = terrain.dem ? await loadSharedGrids(TERRAIN) : {};
  const size = Math.max(1, Math.min(units.length, Number(process.env.LUNAR_VALIDATE_WORKERS) || availableParallelism() - 1));
  const results = new Map<string, unknown>();
  const errors: string[] = [];
  const queue = [...units];
  let done = 0;
  await Promise.all(Array.from({ length: size }, () => new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { grids } });
    const next = (): void => { const u = queue.shift(); if (u) worker.postMessage(u); else void worker.terminate().then(() => resolve()); };
    worker.on('message', (m: { key: string; result?: unknown; error?: string }) => {
      if (m.error) errors.push(`${m.key}: ${m.error}`); else results.set(m.key, m.result);
      process.stderr.write(`\r${++done}/${units.length} unidades (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
      next();
    });
    worker.once('error', reject);
    next();
  })));
  process.stderr.write('\n');
  if (errors.length) {
    console.error(errors.join('\n\n'));
    process.exit(1);
  }
  const rows = ROWS.map((spec) => evaluate(spec, results));
  const report = renderMarkdown(rows, { demVersion: terrain.demVersion });
  console.log(report);
  console.error(`${((performance.now() - t0) / 1000).toFixed(0)} s con ${size} hilos`);
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(HERE, '..', '..', 'VALIDATION.md'), report);
  const view = toViewData(rows, { generatedAt: new Date().toISOString(), demVersion: terrain.demVersion, commit: gitCommit(), seconds: Math.round((performance.now() - t0) / 1000), workers: size });
  writePoints(view);
  if (process.argv.includes('--view')) showView(writeHtml(view));
  const bad = rows.filter((r) => r.status === '❌');
  if (bad.length) {
    console.error(`Fuera de límites: ${bad.map((r) => `${r.spec.what.slice(0, 60)}… (${r.note})`).join('\n  ')}`);
    process.exitCode = 1;
  }
}

/** Short commit of the measured code, «+cambios» if the working tree has changes; null outside git. */
function gitCommit(): string | null {
  try {
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain', '--untracked-files=no') ? ' +cambios' : '');
  } catch { return null; }
}

/** Prints the path of the page and, unless --no-open, tries to open it (a failure only leaves the path). */
function showView(file: string): void {
  console.error(`Vista de la matriz: ${file}`);
  if (process.argv.includes('--no-open')) return;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* the path is printed */ }
}
