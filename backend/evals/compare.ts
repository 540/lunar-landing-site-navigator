#!/usr/bin/env node
// Compares evals runs (directories in evals/runs/). Without arguments: compares the latest of each scenario.
//
// Usage:
//   node evals/compare.ts                       # table of all runs
//   node evals/compare.ts runs/A runs/B …       # only those
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Candidate, LatLon, RunSummary } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS = path.join(HERE, 'runs');
const R = 1737.4, DEG = Math.PI / 180;
const dist = (a: LatLon, b: LatLon): number => R * Math.acos(Math.min(1, Math.sin(a.lat * DEG) * Math.sin(b.lat * DEG) + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos((b.lon - a.lon) * DEG)));

const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (fs.existsSync(RUNS) ? fs.readdirSync(RUNS).sort().map((d) => path.join(RUNS, d)) : []);
const runs = dirs
  .map((d) => path.join(d, 'summary.json'))
  .filter((f) => fs.existsSync(f))
  .map((f) => ({ dir: path.basename(path.dirname(f)), ...(JSON.parse(fs.readFileSync(f, 'utf8')) as RunSummary) }));

if (!runs.length) {
  console.log('No hay ejecuciones. Lanza antes: node evals/run.ts evals/scenarios/<escenario>.json');
  process.exit(0);
}

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
console.log('| Ejecución | Escenario | Etiqueta | Código | Mejor (lat, lon) | Punt. | Cumple | Energía | Tierra | Ambos | Noche máx | Δ vs anterior |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
const prevByScenario: Record<string, Candidate> = {};
for (const r of runs) {
  const b = r.best, m = b.metrics;
  const prev = prevByScenario[r.scenario.name];
  const delta = prev ? `${(b.score - prev.score >= 0 ? '+' : '')}${(b.score - prev.score).toFixed(2)} pts · ${dist(prev, b).toFixed(1)} km` : '—';
  console.log(`| ${r.runId.slice(0, 19)} | ${r.scenario.name} | ${r.label ?? ''} | ${r.codeVersion} | (${b.lat.toFixed(3)}, ${b.lon.toFixed(3)}) | ${b.score} | ${b.feasible ? '✅' : '❌'} | ${pct(m.energy)} | ${pct(m.earthFraction)} | ${pct(m.bothFraction)} | ${m.longestNightH} h | ${delta} |`);
  prevByScenario[r.scenario.name] = b;
}
