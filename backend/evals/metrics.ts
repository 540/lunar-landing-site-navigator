#!/usr/bin/env node
// Metrics of the evaluations stored in the database.
//
// Usage:
//   node evals/metrics.ts                     # all metrics, all runs
//   node evals/metrics.ts --scenario polo-sur-verano-2027
//   node evals/metrics.ts --json              # JSON output (for the dashboard or other scripts)
//   node evals/metrics.ts --db other.db
//   sqlite3 evals/evals.db "SELECT * FROM v_run_summary"   # or ad-hoc queries
import { DEFAULT_DB, openDb } from './db.ts';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = opt('--db') ?? DEFAULT_DB;
const scenario = opt('--scenario');
const asJson = args.includes('--json');

if (!fs.existsSync(file)) {
  console.log(`No existe ${file}. Lanza antes alguna evaluación: npm run eval -- evals/scenarios/<escenario>.json`);
  process.exit(0);
}
const db = openDb(file);

/** [title, view, explanation, columns] */
export const SECTIONS: [string, string, string, string[]][] = [
  ['Resumen por ejecución', 'v_run_summary',
    'Resultado, eficiencia (candidatos/s), % de candidatos que cumplen y ganancia frente al mejor sitio conocido.',
    ['id', 'scenario', 'label', 'best_lat', 'best_lon', 'best_score', 'best_feasible', 'iterations', 'total_evaluated', 'candidates_per_s', 'feasible_rate', 'best_baseline_score', 'gain_vs_baseline']],
  ['Convergencia del optimizador', 'v_convergence',
    'Cuánto mejora el refinamiento sobre la malla gruesa y en qué iteración aparece el mejor.',
    ['id', 'scenario', 'label', 'score_it0', 'score_final', 'refine_gain', 'iteration_of_best', 'iterations', 'stop_reason', 'total_best_moved_km']],
  ['Robustez del mejor frente a retrasos', 'v_best_robustness',
    'Variación de las métricas del mejor punto entre las fechas de alunizaje candidatas (spread alto = sensible a retrasos).',
    ['id', 'scenario', 'label', 'dates', 'energy_min', 'energy_max', 'energy_spread', 'earth_min', 'earth_max', 'earth_spread', 'worst_night_h']],
  ['Restricciones que más descartan', 'v_binding_constraints',
    'Qué requisito incumplen más candidatos: es el que limita la elección.',
    ['id', 'scenario', 'label', 'metric', 'violations', 'share_of_candidates']],
  ['Estabilidad entre ejecuciones', 'v_run_deltas',
    'Cambio de puntuación y desplazamiento del mejor punto respecto a la ejecución anterior del mismo escenario.',
    ['id', 'scenario', 'label', 'best_score', 'delta_score', 'moved_km']],
  ['Determinismo', 'v_determinism',
    'Ejecuciones con la misma huella (escenario + código + dependencias + Node) deben dar un único resultado.',
    ['fingerprint', 'scenario', 'node_version', 'code_hash', 'runs', 'distinct_results', 'verdict', 'run_ids']],
  ['Distribución de puntuaciones', 'v_score_distribution',
    'Percentiles de la puntuación de todos los candidatos; muchos puntos a <1 pt del mejor = meseta (la elección depende de otros criterios, p. ej. relieve).',
    ['id', 'scenario', 'label', 'n', 'p0', 'p50', 'p90', 'p99', 'p100', 'within_1pt_of_best']],
];

const where = scenario ? ' WHERE scenario = ?' : '';
const out: Record<string, Record<string, unknown>[]> = {};
for (const [title, view, help, cols] of SECTIONS) {
  const order = cols.includes('id') ? 'id' : cols[0];
  const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${view}${where} ORDER BY ${order}`).all(...(scenario ? [scenario] : []));
  out[view] = rows;
  if (asJson) continue;
  console.log(`\n## ${title}\n_${help}_\n`);
  if (!rows.length) { console.log('(sin datos)'); continue; }
  console.log(`| ${cols.join(' | ')} |`);
  console.log(`|${cols.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${cols.map((c) => (r[c] ?? '—')).join(' | ')} |`);
}
if (asJson) console.log(JSON.stringify(out, null, 2));
db.close();
