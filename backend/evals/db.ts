// Evaluations database (SQLite via node:sqlite, no dependencies).
//
// Stores every harness run with EVERYTHING evaluated, so metrics can be extracted later:
//   runs            one row per run (scenario, label, code version, result)
//   iterations      one row per optimizer iteration (convergence)
//   candidates      every evaluated point, with its aggregated metrics and whether it meets the constraints
//   candidate_dates metrics of each candidate on each landing date (robustness against delays)
//   violations      which constraint each candidate violates (to know which one is "binding")
//   baselines       reference sites evaluated in the same scenario
//   warnings        run warnings
// Plus SQL views with the usual metrics (see METRIC_VIEWS).
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, StatementSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ColumnInfoRow, IterationRecord, RunSummary } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB = path.join(HERE, 'evals.db');

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY,
  run_id          TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL,
  scenario        TEXT NOT NULL,
  label           TEXT,
  code_version    TEXT,
  description     TEXT,
  mode            TEXT,
  aggregate       TEXT,
  mission_days    REAL,
  step_minutes    REAL,
  dates_json      TEXT,
  region_json     TEXT,
  weights_json    TEXT,
  constraints_json TEXT,
  search_json     TEXT,
  iterations      INTEGER,
  total_evaluated INTEGER,
  stop_reason     TEXT,
  elapsed_ms      INTEGER,
  best_lat        REAL,
  best_lon        REAL,
  best_score      REAL,
  best_feasible   INTEGER
);

CREATE TABLE IF NOT EXISTS iterations (
  run_id          INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  iteration       INTEGER NOT NULL,
  spacing_km      REAL,
  evaluated       INTEGER,
  total_evaluated INTEGER,
  feasible_count  INTEGER,
  best_lat        REAL,
  best_lon        REAL,
  best_score      REAL,
  best_feasible   INTEGER,
  improvement     REAL,
  best_moved_km   REAL,
  elapsed_ms      INTEGER,
  stop            TEXT,
  PRIMARY KEY (run_id, iteration)
);

CREATE TABLE IF NOT EXISTS candidates (
  id               INTEGER PRIMARY KEY,
  run_id           INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  iteration        INTEGER NOT NULL,
  lat              REAL NOT NULL,
  lon              REAL NOT NULL,
  score            REAL NOT NULL,
  feasible         INTEGER NOT NULL,
  energy           REAL,
  sun_fraction     REAL,
  earth_fraction   REAL,
  both_fraction    REAL,
  longest_night_h  REAL,
  longest_no_earth_h REAL,
  longest_both_h   REAL
);
CREATE INDEX IF NOT EXISTS idx_candidates_run_score ON candidates(run_id, feasible DESC, score DESC);

CREATE TABLE IF NOT EXISTS candidate_dates (
  candidate_id     INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  date             TEXT NOT NULL,
  energy           REAL,
  earth_fraction   REAL,
  both_fraction    REAL,
  longest_night_h  REAL,
  PRIMARY KEY (candidate_id, date)
);

CREATE TABLE IF NOT EXISTS violations (
  candidate_id     INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  metric           TEXT NOT NULL,
  detail           TEXT
);
CREATE INDEX IF NOT EXISTS idx_violations_metric ON violations(metric);

CREATE TABLE IF NOT EXISTS baselines (
  run_id           INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  site_id          TEXT NOT NULL,
  name             TEXT,
  lat              REAL,
  lon              REAL,
  score            REAL,
  feasible         INTEGER,
  energy           REAL,
  earth_fraction   REAL,
  both_fraction    REAL,
  longest_night_h  REAL,
  error            TEXT,
  PRIMARY KEY (run_id, site_id)
);

CREATE TABLE IF NOT EXISTS competitions (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL,
  benchmark        TEXT NOT NULL,
  config_json      TEXT,
  code_intact      INTEGER,
  judge_run_id     INTEGER REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS competition_agents (
  competition_id   TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  agent            TEXT NOT NULL,
  tool             TEXT,
  model            TEXT,
  strategy         TEXT,
  prefix           TEXT,
  exit_code        INTEGER,
  duration_s       INTEGER,
  cost_usd         REAL,
  tokens           INTEGER,
  valid_runs       INTEGER,
  invalid_runs     INTEGER,
  best_robust      REAL,
  best_nominal     REAL,
  best_lat         REAL,
  best_lon         REAL,
  best_feasible    INTEGER,
  PRIMARY KEY (competition_id, agent)
);

CREATE TABLE IF NOT EXISTS warnings (
  run_id           INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  text             TEXT NOT NULL
);
`;

// Views with the evaluation metrics. Always recreated (so they can be improved without migrations).
export const METRIC_VIEWS: Readonly<Record<string, string>> = {
  // Per-run summary: result, efficiency and margin over the known sites.
  v_run_summary: `
    SELECT r.id, r.run_id, r.created_at, r.scenario, r.label, r.code_version,
           r.best_lat, r.best_lon, r.best_score, r.best_feasible,
           r.iterations, r.total_evaluated, r.stop_reason, r.elapsed_ms,
           ROUND(1000.0 * r.total_evaluated / NULLIF(r.elapsed_ms, 0), 0)            AS candidates_per_s,
           (SELECT ROUND(AVG(c.feasible), 4) FROM candidates c WHERE c.run_id = r.id) AS feasible_rate,
           (SELECT MAX(b.score) FROM baselines b WHERE b.run_id = r.id AND b.error IS NULL) AS best_baseline_score,
           ROUND(r.best_score - (SELECT MAX(b.score) FROM baselines b WHERE b.run_id = r.id AND b.error IS NULL), 3) AS gain_vs_baseline
    FROM runs r`,

  // Convergence: how much the optimizer improves over the coarse grid and how many iterations it needs.
  v_convergence: `
    SELECT r.id, r.scenario, r.label,
           (SELECT best_score FROM iterations i WHERE i.run_id = r.id AND i.iteration = 0) AS score_it0,
           r.best_score                                                                     AS score_final,
           ROUND(r.best_score - (SELECT best_score FROM iterations i WHERE i.run_id = r.id AND i.iteration = 0), 4) AS refine_gain,
           (SELECT MIN(iteration) FROM iterations i WHERE i.run_id = r.id AND i.best_score >= r.best_score - 1e-9) AS iteration_of_best,
           r.iterations, r.stop_reason,
           (SELECT ROUND(SUM(best_moved_km), 2) FROM iterations i WHERE i.run_id = r.id)    AS total_best_moved_km
    FROM runs r`,

  // Robustness of the best candidate against delays: how much its metrics vary across landing dates.
  v_best_robustness: `
    SELECT r.id, r.scenario, r.label, r.best_lat, r.best_lon,
           COUNT(d.date)                                   AS dates,
           ROUND(MIN(d.energy), 4)          AS energy_min,  ROUND(MAX(d.energy), 4)         AS energy_max,
           ROUND(MAX(d.energy) - MIN(d.energy), 4)          AS energy_spread,
           ROUND(MIN(d.earth_fraction), 4)  AS earth_min,   ROUND(MAX(d.earth_fraction), 4) AS earth_max,
           ROUND(MAX(d.earth_fraction) - MIN(d.earth_fraction), 4) AS earth_spread,
           MAX(d.longest_night_h)                           AS worst_night_h
    FROM runs r
    JOIN candidates c ON c.run_id = r.id AND c.lat = r.best_lat AND c.lon = r.best_lon
    JOIN candidate_dates d ON d.candidate_id = c.id
    GROUP BY r.id`,

  // Which constraint discards the most candidates (the "binding" one).
  v_binding_constraints: `
    SELECT r.id, r.scenario, r.label, v.metric,
           COUNT(*) AS violations,
           ROUND(1.0 * COUNT(*) / (SELECT COUNT(*) FROM candidates c2 WHERE c2.run_id = r.id), 4) AS share_of_candidates
    FROM violations v
    JOIN candidates c ON c.id = v.candidate_id
    JOIN runs r ON r.id = c.run_id
    GROUP BY r.id, v.metric`,

  // Stability across runs of the same scenario: how much the score and position change from the previous one.
  v_run_deltas: `
    SELECT r.id, r.scenario, r.label, r.created_at, r.best_score,
           ROUND(r.best_score - LAG(r.best_score) OVER w, 3) AS delta_score,
           ROUND(1737.4 * ACOS(MIN(1.0,
             SIN(RADIANS(r.best_lat)) * SIN(RADIANS(LAG(r.best_lat) OVER w)) +
             COS(RADIANS(r.best_lat)) * COS(RADIANS(LAG(r.best_lat) OVER w)) * COS(RADIANS(r.best_lon - LAG(r.best_lon) OVER w))
           )), 2) AS moved_km
    FROM runs r
    WINDOW w AS (PARTITION BY r.scenario ORDER BY r.created_at, r.id)`,

  // Determinism: runs with the SAME fingerprint must give the SAME result (1 distinct result per fingerprint).
  v_determinism: `
    SELECT fingerprint, scenario, MIN(node_version) AS node_version, MIN(code_hash) AS code_hash,
           COUNT(*) AS runs, COUNT(DISTINCT result_hash) AS distinct_results,
           CASE WHEN COUNT(DISTINCT result_hash) = 1 THEN 'determinista' ELSE 'NO DETERMINISTA' END AS verdict,
           GROUP_CONCAT(id) AS run_ids
    FROM runs WHERE fingerprint IS NOT NULL
    GROUP BY fingerprint, scenario`,

  // Score distribution of each run (to see whether there is a clear optimum or a plateau).
  v_score_distribution: `
    WITH ranked AS (
      SELECT run_id, score,
             ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY score) AS rn,
             COUNT(*)     OVER (PARTITION BY run_id)                AS n
      FROM candidates)
    SELECT r.id, r.scenario, r.label, MAX(n) AS n,
           ROUND(MIN(score), 2) AS p0,
           ROUND(MAX(CASE WHEN rn <= 0.50 * n THEN score END), 2) AS p50,
           ROUND(MAX(CASE WHEN rn <= 0.90 * n THEN score END), 2) AS p90,
           ROUND(MAX(CASE WHEN rn <= 0.99 * n THEN score END), 2) AS p99,
           ROUND(MAX(score), 2) AS p100,
           SUM(CASE WHEN score >= (SELECT MAX(score) FROM candidates c3 WHERE c3.run_id = r.id) - 1 THEN 1 ELSE 0 END) AS within_1pt_of_best
    FROM ranked JOIN runs r ON r.id = ranked.run_id
    GROUP BY r.id`,
};

// Columns added after the first schema version (automatic migration).
const MIGRATIONS: Readonly<Record<'runs' | 'candidates' | 'candidate_dates', Readonly<Record<string, string>>>> = {
  runs: {
    fingerprint: 'TEXT', scenario_hash: 'TEXT', code_hash: 'TEXT', lock_hash: 'TEXT',
    node_version: 'TEXT', engine_version: 'TEXT', result_hash: 'TEXT',
    earth_mode: 'TEXT', earth_min_elevation_deg: 'REAL', robustness_json: 'TEXT', terrain_json: 'TEXT',
  },
  candidates: { worst_date: 'TEXT', nominal_score: 'REAL', robust_spread: 'REAL', robust_failing_neighbors: 'INTEGER' },
  candidate_dates: {
    sun_fraction: 'REAL', longest_no_earth_h: 'REAL', longest_both_h: 'REAL', period_h: 'REAL', score: 'REAL', feasible: 'INTEGER',
  },
};

/**
 * Rows of a query, typed. node:sqlite returns Record<string, SQLOutputValue>: the row interface (src/types.ts) is the
 * contract of the SQL, and this is the only place where it is asserted.
 */
export function rows<T>(stmt: StatementSync, ...params: SQLInputValue[]): T[] {
  return stmt.all(...params) as T[];
}

/** First row of a query, typed (undefined if there is none). See rows(). */
export function row<T>(stmt: StatementSync, ...params: SQLInputValue[]): T | undefined {
  return stmt.get(...params) as T | undefined;
}

function migrate(db: DatabaseSync): void {
  for (const [table, cols] of Object.entries(MIGRATIONS)) {
    const have = new Set(rows<ColumnInfoRow>(db.prepare(`PRAGMA table_info(${table})`)).map((c) => c.name));
    for (const [col, type] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
}

/** Opens (and creates if needed) the database. */
export function openDb(file: string = DEFAULT_DB): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 15000;'); // several processes may write at once: wait instead of failing
  db.exec(SCHEMA);
  migrate(db);
  // SQLite is not always compiled with trigonometry: we register it from JS (for v_run_deltas).
  for (const [name, fn] of Object.entries({ SIN: Math.sin, COS: Math.cos, ACOS: Math.acos, RADIANS: (d: number) => (d * Math.PI) / 180 })) {
    // SQLite passes REAL columns as numbers (or null).
    db.function(name, { deterministic: true }, (x) => (x === null ? null : fn(x as number)));
  }
  for (const [name, sql] of Object.entries(METRIC_VIEWS)) {
    db.exec(`DROP VIEW IF EXISTS ${name}; CREATE VIEW ${name} AS ${sql};`);
  }
  return db;
}

const metricOf = (detail: string): string => detail.split('=')[0];

/**
 * Stores a complete run. `iterations` are the optimizer records
 * (with the non-enumerable `candidates` property), `summary` is runScenario's summary.
 * All in one transaction: either the whole run is stored or nothing is.
 */
export function saveRun(db: DatabaseSync, summary: RunSummary, iterations: readonly IterationRecord[]): number {
  const s = summary.scenario;
  db.exec('BEGIN');
  try {
    const { lastInsertRowid: runId } = db.prepare(`
      INSERT INTO runs (run_id, created_at, scenario, label, code_version, description, mode, aggregate, mission_days, step_minutes,
        dates_json, region_json, weights_json, constraints_json, search_json, iterations, total_evaluated, stop_reason, elapsed_ms,
        best_lat, best_lon, best_score, best_feasible)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      summary.runId, new Date().toISOString(), s.name, summary.label, summary.codeVersion, s.description ?? null, s.mode, s.aggregate,
      s.missionDays, s.stepMinutes, JSON.stringify(s.dates), JSON.stringify(s.region), JSON.stringify(s.weights),
      JSON.stringify(s.constraints), JSON.stringify(s.search), summary.iterations, summary.totalEvaluated, summary.stop, summary.elapsedMs,
      summary.best.lat, summary.best.lon, summary.best.score, summary.best.feasible ? 1 : 0,
    );

    const insIt = db.prepare(`INSERT INTO iterations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insC = db.prepare(`INSERT INTO candidates (run_id, iteration, lat, lon, score, feasible, energy, sun_fraction, earth_fraction,
      both_fraction, longest_night_h, longest_no_earth_h, longest_both_h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insD = db.prepare(`INSERT INTO candidate_dates (candidate_id, date, energy, earth_fraction, both_fraction, longest_night_h,
      sun_fraction, longest_no_earth_h, longest_both_h, period_h, score, feasible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insV = db.prepare(`INSERT INTO violations VALUES (?, ?, ?)`);
    const setWorst = db.prepare('UPDATE candidates SET worst_date = ? WHERE id = ?');
    const setRobust = db.prepare('UPDATE candidates SET nominal_score = ?, robust_spread = ?, robust_failing_neighbors = ? WHERE id = ?');
    for (const r of iterations) {
      insIt.run(runId, r.iteration, r.spacingKm, r.evaluated, r.totalEvaluated, r.feasibleCount, r.best.lat, r.best.lon, r.best.score,
        r.best.feasible ? 1 : 0, r.improvement, r.bestMovedKm, r.elapsedMs, r.stop);
      for (const c of r.candidates ?? []) {
        const m = c.metrics;
        const { lastInsertRowid: cid } = insC.run(runId, c.iteration, c.lat, c.lon, c.score, c.feasible ? 1 : 0, m.energy, m.sunFraction,
          m.earthFraction, m.bothFraction, m.longestNightH, m.longestNoEarthH, m.longestBothH);
        if (c.worstDate) setWorst.run(c.worstDate, cid);
        if (c.robustness) setRobust.run(c.nominalScore!, c.robustness.spread, c.robustness.failingNeighbors, cid);
        for (const d of c.perDate ?? []) {
          insD.run(cid, d.date, d.energy, d.earthFraction, d.bothFraction, d.longestNightH, d.sunFraction ?? null, d.longestNoEarthH ?? null,
            d.longestBothH ?? null, d.periodH ?? null, d.score ?? null, d.feasible === undefined ? null : (d.feasible ? 1 : 0));
        }
        for (const v of c.violations ?? []) insV.run(cid, metricOf(v), v);
      }
    }
    const insB = db.prepare(`INSERT INTO baselines VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const b of summary.baselines) {
      if ('error' in b) insB.run(runId, b.id, null, null, null, null, null, null, null, null, null, b.error);
      else insB.run(runId, b.id!, b.name, b.lat, b.lon, b.score, b.feasible ? 1 : 0, b.metrics.energy, b.metrics.earthFraction,
        b.metrics.bothFraction, b.metrics.longestNightH, null);
    }
    const insW = db.prepare(`INSERT INTO warnings VALUES (?, ?)`);
    for (const w of summary.warnings) insW.run(runId, w);
    if (summary.fingerprint) {
      const f = summary.fingerprint;
      db.prepare(`UPDATE runs SET fingerprint = ?, scenario_hash = ?, code_hash = ?, lock_hash = ?, node_version = ?, engine_version = ?, result_hash = ?
                  WHERE id = ?`).run(f.fingerprint, f.scenarioHash, f.codeHash, f.lockHash, f.nodeVersion, f.engineVersion, f.resultHash, runId);
    }
    db.prepare('UPDATE runs SET earth_mode = ?, earth_min_elevation_deg = ?, robustness_json = ?, terrain_json = ? WHERE id = ?')
      .run(s.earthMode ?? s.mode, s.earthMinElevationDeg ?? 0, s.robustness ? JSON.stringify(s.robustness) : null, s.terrain ? JSON.stringify(s.terrain) : null, runId);
    db.exec('COMMIT');
    return Number(runId);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
