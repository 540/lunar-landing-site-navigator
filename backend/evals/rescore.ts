#!/usr/bin/env node
// Re-scores candidates ALREADY STORED in the database with other weights, without recomputing ephemerides.
// Metrics do not depend on the weights, so changing weights is just re-summing: instant even with hundreds of thousands of points.
//
// Usage:
//   node evals/rescore.ts --scenario reto-polo-sur --w comm=0.5,energy=0.2,commGap=0.3
//   node evals/rescore.ts --scenario reto-polo-sur --w energy=1 --top 5
//   node evals/rescore.ts --run 80 --w both=1
//   node evals/rescore.ts --vars          # list of variables and their meaning
//
// Notes:
//   - Constraints (feasible / not feasible) do not change: they depend on the metrics, not on the weights.
//   - Only runs with the same dates, duration, step, mode and aggregate are mixed (otherwise the metrics are not comparable).
import { DEFAULT_DB, openDb } from './db.ts';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_WEIGHTS, SCORE_VARIABLES, distanceKm, normalizeWeights, scoreBreakdown, scoreMetrics } from '../src/search.ts';
import { row, rows } from './db.ts';
import type { CountRow, CoreMetricKey, Metrics, Weights } from '../src/types.ts';

/** Run settings that must coincide for metrics to be comparable. */
interface RunSettingsRow { dates_json: string; mission_days: number; step_minutes: number; mode: string; aggregate: string; earth_mode: string; earth_min: number }
/** Stored candidate with its metric columns (COLS). */
type ScoredRow = { lat: number; lon: number; old_score: number; feasible: number } & Record<string, number>;
/** Candidate re-scored: `feasible` stays as stored (0/1). */
export interface Rescored { lat: number; lon: number; feasible: number; oldScore: number; score: number; breakdown: Partial<Weights>; metrics: Metrics }
export interface Rescoring { periodH: number; total: number; ranked: (Rescored & { rank: number; oldRank: number | undefined })[]; oldBest: Rescored }

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes('--vars')) {
  console.log('Variables de la puntuación (peso por defecto entre paréntesis):');
  const defaults: Readonly<Record<string, number>> = DEFAULT_WEIGHTS;
  for (const [k, v] of Object.entries(SCORE_VARIABLES)) console.log(`  ${k.padEnd(11)} (${defaults[k]})  ${v.label}`);
  process.exit(0);
}

/** "a=1,b=0.5" → {a:1, b:0.5}. Unlisted ones are 0 (scoring uses ONLY what is requested). */
export function parseWeights(text: string): Weights {
  const w: Record<string, number> = Object.fromEntries(Object.keys(SCORE_VARIABLES).map((k) => [k, 0]));
  for (const part of text.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [k, v] = part.split('=');
    if (!(k in SCORE_VARIABLES)) throw new Error(`Variable desconocida: ${k}. Usa --vars para ver la lista.`);
    w[k] = Number(v);
    if (!Number.isFinite(w[k]) || w[k] < 0) throw new Error(`Peso no válido para ${k}: ${v}`);
  }
  return normalizeWeights(w);
}

const COLS: Record<CoreMetricKey, string> = { energy: 'energy', sunFraction: 'sun_fraction', earthFraction: 'earth_fraction', bothFraction: 'both_fraction', longestNightH: 'longest_night_h', longestNoEarthH: 'longest_no_earth_h', longestBothH: 'longest_both_h' };

/** Re-scores: returns unique candidates (lat, lon) sorted, with the new and the original score. */
export function rescore(db: DatabaseSync, { scenario, run, weights }: { scenario?: string; run?: number; weights: Weights }): Rescoring {
  const where = run ? 'r.id = ?' : 'r.scenario = ?';
  const key = run ?? scenario ?? null; // neither: no run matches
  const runs = rows<RunSettingsRow>(db.prepare(`SELECT DISTINCT dates_json, mission_days, step_minutes, mode, aggregate,
    COALESCE(earth_mode, mode) AS earth_mode, COALESCE(earth_min_elevation_deg, 0) AS earth_min FROM runs r WHERE ${where}`), key);
  if (!runs.length) throw new Error('No hay ejecuciones con ese criterio');
  if (runs.length > 1) throw new Error('Las ejecuciones seleccionadas usan fechas/duración/paso/modo/margen de la Tierra/agregado distintos: filtra con --run');
  // Real period: samples include start and end (missionDays·24·60/step + 1 samples).
  const periodH = runs[0].mission_days * 24 + runs[0].step_minutes / 60;
  const robust = row<CountRow>(db.prepare(`SELECT COUNT(*) AS n FROM runs r WHERE ${where} AND robustness_json IS NOT NULL`), key)!.n;
  if (robust) process.stderr.write('⚠️  Hay ejecuciones con robustez espacial: se re-puntúa la puntuación NOMINAL del centro (la robusta exige re-evaluar los vecinos con run.ts).\n');
  const scored = rows<ScoredRow>(db.prepare(`
    SELECT c.lat, c.lon, COALESCE(c.nominal_score, c.score) AS old_score, c.feasible, ${Object.values(COLS).map((c) => `c.${c}`).join(', ')}
    FROM candidates c JOIN runs r ON r.id = c.run_id WHERE ${where}`), key);
  const seen: Map<string, Rescored> = new Map();
  for (const r of scored) {
    const k = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`; // ~10 m: closer points are considered the same
    if (seen.has(k)) continue;
    const m = Object.fromEntries(Object.entries(COLS).map(([mk, col]) => [mk, r[col]])) as Metrics;
    seen.set(k, { lat: r.lat, lon: r.lon, feasible: r.feasible, oldScore: r.old_score, score: scoreMetrics(m, weights, periodH), breakdown: scoreBreakdown(m, weights, periodH), metrics: m });
  }
  const order = (by: 'score' | 'oldScore') => (a: Rescored, b: Rescored): number => (b.feasible - a.feasible) || (b[by] - a[by]) || (a.lat - b.lat) || (a.lon - b.lon);
  const all = [...seen.values()];
  const id = (c: Rescored): string => `${c.lat.toFixed(4)},${c.lon.toFixed(4)}`;
  const oldRank = new Map([...all].sort(order('oldScore')).map((c, i) => [id(c), i + 1]));
  return { periodH, total: all.length, ranked: all.sort(order('score')).map((c, i) => ({ rank: i + 1, oldRank: oldRank.get(id(c)), ...c })), oldBest: [...all].sort(order('oldScore'))[0] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (!opt('--w')) throw new Error('Indica los pesos: --w energy=0.5,comm=0.5 (usa --vars para ver las variables)');
    const weights = parseWeights(opt('--w')!);
    const top = Number(opt('--top') ?? 10);
    const db = openDb(opt('--db') ?? DEFAULT_DB);
    const t0 = performance.now();
    const r = rescore(db, { scenario: opt('--scenario'), run: opt('--run') ? Number(opt('--run')) : undefined, weights });
    const ms = Math.round(performance.now() - t0);
    const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;
    console.log(`Re-puntuados ${r.total} candidatos únicos en ${ms} ms · periodo ${r.periodH} h`);
    console.log(`Pesos: ${Object.entries(weights).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}\n`);
    console.log('| # | antes | Posición | Puntuación | Desglose (puntos) | Cumple | Energía | Tierra | Ambos | Noche máx | Apagón máx |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of r.ranked.slice(0, top)) {
      const m = c.metrics;
      console.log(`| ${c.rank} | ${c.oldRank} | (${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}) | ${c.score.toFixed(2)} | ${Object.entries(c.breakdown).map(([k, v]) => `${k} ${v}`).join(' · ')} | ${c.feasible ? '✅' : '❌'} | ${pct(m.energy)} | ${pct(m.earthFraction)} | ${pct(m.bothFraction)} | ${m.longestNightH} h | ${m.longestNoEarthH} h |`);
    }
    const nb = r.ranked[0];
    console.log(`\nMejor con estos pesos: (${nb.lat.toFixed(4)}, ${nb.lon.toFixed(4)}) · antes era el nº ${nb.oldRank} · a ${distanceKm(nb, r.oldBest).toFixed(1)} km del mejor con los pesos originales.`);
    db.close();
  } catch (e) {
    console.error(`✖ ${(e as Error).message}`);
    process.exit(1);
  }
}
