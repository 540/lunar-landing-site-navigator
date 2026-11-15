// Evaluation harness (evals) to search for the best landing position iteratively and reproducibly.
//
// Concepts:
//  - SCENARIO: describes the mission (region, possible landing dates, duration, requirements, weights).
//    Several dates = robustness against delays: a good site must stay good if the mission slips.
//  - EVAL of a candidate (lat, lon): metrics on each date → aggregate (mean or worst case)
//    → hard constraints (feasible / not feasible) → score 0..100.
//  - OPTIMIZER: coarse grid → refine around the best ones with a finer grid → … until convergence.
//    Every iteration is recorded so runs can be compared (changes in weights, model, terrain…).
//
// Everything is deterministic: same scenario + same code → same result.
import { gridCells, neighborhood, normalizeWeights, redundancyWarnings, scoreBreakdown, scoreMetrics, distanceKm } from '../src/search.ts';
import { sampleVectors } from '../src/service.ts';
import { getSite } from '../src/sites.ts';
import { resolveTerrain } from '../src/horizon.ts';
import { BATTERY_DEFAULTS, checkNightMinSunFraction, resolveBattery } from '../src/night.ts';
import { checkPanel } from '../src/panel.ts';
import { checkSlopeBaseline, slopeDataVersion, slopeSummary } from '../src/terrain/slope.ts';
import { evaluatePeriod } from '../src/useCases.ts';
import { demVersion } from '../src/terrain/dem.ts';
import type {
  Aggregate, Baseline, Candidate, CellResult, Cell, DateEvaluation, Evaluation, IterationRecord, LatLon, MetricKey, Metrics, NightOptions, Ranked, RawScenario,
  Region, SampledVectors, Scenario, ScenarioDefaults, ScenarioDraft, StopReason, Constraints, Weights,
} from '../src/types.ts';

const DAY_MS = 86400e3;
const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;
const key = (c: LatLon): string => `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;

/** Scenario defaults (anything not given is taken from here). */
export const SCENARIO_DEFAULTS: ScenarioDefaults = {
  missionDays: 14,
  stepMinutes: 60,
  mode: 'limb', // Sun visibility (and Earth's if earthMode is not given)
  earthMode: null, // Earth visibility: limb | center | full (null = same as mode)
  earthMinElevationDeg: 0, // minimum Earth elevation required to count as "communication" (antenna margin)
  aggregate: 'worst', // 'worst' (the worst REAL date) or 'mean' (mean over dates)
  weights: {},
  constraints: {},
  search: { spacingKm: 20, maxIterations: 6, keepTop: 5, minSpacingKm: 0.5, stopDelta: 0.01, patience: 2 },
  baselines: [],
  // Spatial robustness: when enabled, each candidate is scored by its WORST value among the center and its neighbors
  // at `radiusKm` (landing error). E.g.: { radiusKm: 1, directions: 8, rings: 1 }. null = disabled.
  robustness: null,
};

// Constraints live in src/constraints.ts (shared with the landing-date sweep); re-exported here for the evals.
export { CONSTRAINTS, checkConstraints } from '../src/constraints.ts';
import { CONSTRAINTS, constraintViolations } from '../src/constraints.ts';

/** Fills a scenario with the defaults and validates it. */
export function resolveScenario(raw: RawScenario): Scenario {
  const s: ScenarioDraft = {
    ...SCENARIO_DEFAULTS,
    ...raw,
    search: { ...SCENARIO_DEFAULTS.search, ...(raw.search ?? {}) },
    constraints: { ...(raw.constraints ?? {}) },
  };
  if (!s.name) throw new Error('El escenario necesita "name"');
  if (!s.region && !s.points) throw new Error('El escenario necesita "region" {latMin, latMax, lonMin, lonMax} o "points" (lista de puntos a evaluar)');
  if (s.points) {
    if (!Array.isArray(s.points) || s.points.length === 0) throw new Error('"points" debe ser una lista no vacía');
    s.points = s.points.map((p) => {
      if (typeof p === 'string') {
        const site = getSite(p);
        if (!site) throw new Error(`Sitio desconocido en points: ${p}`);
        return { lat: site.lat, lon: site.lon, name: site.name, siteId: site.id };
      }
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) throw new Error(`Punto no válido: ${JSON.stringify(p)}`);
      return { lat: p.lat, lon: p.lon, name: p.name ?? `(${p.lat}, ${p.lon})` };
    });
  }
  if (!Array.isArray(s.dates) || s.dates.length === 0) throw new Error('El escenario necesita "dates" (fechas de alunizaje candidatas)');
  if (!['worst', 'mean'].includes(s.aggregate)) throw new Error('aggregate debe ser "worst" o "mean"');
  for (const k of Object.keys(s.constraints)) if (!CONSTRAINTS[k]) throw new Error(`Restricción desconocida: ${k}. Válidas: ${Object.keys(CONSTRAINTS).join(', ')}`);
  s.weights = normalizeWeights(s.weights);
  s.earthMode = s.earthMode ?? s.mode;
  if (!['limb', 'center', 'full'].includes(s.earthMode)) throw new Error('earthMode debe ser limb, center o full');
  if (!Number.isFinite(s.earthMinElevationDeg) || s.earthMinElevationDeg < 0 || s.earthMinElevationDeg > 30) throw new Error('earthMinElevationDeg debe estar entre 0 y 30');
  if (s.robustness) {
    const r = { directions: 8, rings: 1, ...s.robustness };
    if (!(r.radiusKm > 0 && r.radiusKm <= 50)) throw new Error('robustness.radiusKm debe estar entre 0 y 50 km');
    if (!Number.isInteger(r.directions) || r.directions < 4 || r.directions > 36) throw new Error('robustness.directions debe ser un entero entre 4 y 36');
    if (!Number.isInteger(r.rings) || r.rings < 1 || r.rings > 3) throw new Error('robustness.rings debe ser 1, 2 o 3');
    s.robustness = r;
  }
  // Terrain: terrain = { enabled, observerHeightM (2), panelHeightM, antennaHeightM, resolution ('fast' | 'precise') }.
  // Stored with the cached DEM version (demVersion), so it is part of the fingerprint. Without `terrain` (or
  // enabled=false) the scenario is unchanged. panelHeightM (Sun) and antennaHeightM (Earth) default to observerHeightM
  // and are stored only when one of them differs from it, so scenarioHash of the existing scenarios does not change.
  const terrain = resolveTerrain(raw.terrain, 'fast');
  if (terrain) s.terrain = terrain; else delete s.terrain;
  // Night and battery (src/night.ts). Only stored when on, so scenarioHash of the existing scenarios does not change.
  const nightMinSunFraction = checkNightMinSunFraction(raw.nightMinSunFraction);
  if (nightMinSunFraction > 0) s.nightMinSunFraction = nightMinSunFraction; else delete s.nightMinSunFraction;
  if (raw.fullNight !== undefined && typeof raw.fullNight !== 'boolean') throw new Error('fullNight debe ser true o false');
  if (raw.fullNight) s.fullNight = true; else delete s.fullNight;
  const battery = resolveBattery(raw.battery ?? (s.constraints.maxBatteryKg !== undefined ? { ...BATTERY_DEFAULTS } : null));
  if (battery) s.battery = battery; else delete s.battery;
  // Solar panel orientation (src/panel.ts), only for `energy`. Stored only when it is not 'tracking' (the default), so
  // scenarioHash of the existing scenarios does not change.
  const panel = checkPanel(raw.panel);
  if (panel !== 'tracking') s.panel = panel; else delete s.panel;
  // Terrain slope (src/terrain/slope.ts): metric slopeDeg of each candidate, with `slope: {baselineM}` or the maxSlopeDeg
  // constraint. Stored only then (with the cached DEM version), so scenarioHash of the existing scenarios does not change.
  if (raw.slope !== undefined && raw.slope !== null && (typeof raw.slope !== 'object' || Array.isArray(raw.slope))) throw new Error('slope debe ser un objeto {baselineM}');
  if (raw.slope || s.constraints.maxSlopeDeg !== undefined) s.slope = { baselineM: checkSlopeBaseline(raw.slope?.baselineM), demVersion: slopeDataVersion() };
  else delete s.slope;
  s.dateMs = s.dates.map((d) => {
    const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d}Z`);
    if (Number.isNaN(ms)) throw new Error(`Fecha no válida: ${d}`);
    return ms;
  });
  return s as Scenario;
}

/** Time samples (Sun/Earth vectors) for each candidate date: computed once per scenario. */
export function prepareSamples(s: Scenario): SampledVectors[] {
  const stepMs = s.stepMinutes * 60e3;
  return s.dateMs.map((ms) => sampleVectors(ms, ms + s.missionDays * DAY_MS, stepMs));
}

/** Aggregates metrics over several dates: mean or worst case (fractions → minimum; outage durations → maximum). */
export function aggregateMetrics(list: readonly Metrics[], how: Aggregate): Metrics {
  const keys = metricKeysOf(list[0]);
  // longer / heavier = worse
  const worse: Partial<Record<MetricKey, (...values: number[]) => number>> = {
    longestNightH: Math.max, longestNoEarthH: Math.max, longestNightFullH: Math.max, batteryKWh: Math.max, batteryKg: Math.max,
  };
  const out = {} as Metrics;
  for (const k of keys) {
    const vals = list.map((m) => m[k] as number);
    if (how === 'mean') out[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
    else out[k] = (worse[k] ?? Math.min)(...vals);
  }
  return out;
}

const PER_DATE_KEYS: MetricKey[] = ['energy', 'sunFraction', 'earthFraction', 'bothFraction', 'longestNightH', 'longestNoEarthH', 'longestBothH'];
/** Optional metrics, after the core ones and only when present (fullNight, battery): existing results keep their keys. */
const OPTIONAL_KEYS: MetricKey[] = ['longestNightFullH', 'batteryKWh', 'batteryKg', 'slopeDeg'];
const metricKeysOf = (m: Partial<Metrics>): MetricKey[] => [...PER_DATE_KEYS, ...OPTIONAL_KEYS.filter((k) => m[k] !== undefined)];

/** Night options of a scenario for evaluateCell (empty when all are off). */
const nightOptionsOf = (s: Scenario): NightOptions => ({
  ...(s.nightMinSunFraction ? { nightMinSunFraction: s.nightMinSunFraction } : {}),
  ...(s.fullNight ? { fullNight: true } : {}),
  ...(s.battery ? { battery: s.battery } : {}),
});

/**
 * Evaluates a candidate on every scenario date.
 *  - Each date is scored and checked separately (with its real period: number of samples × step).
 *  - 'worst': takes the WORST REAL DATE (infeasible ones first, then the lowest score), with ALL its
 *    metrics. Previously the per-metric minimum was taken, which could mix dates and create a "ghost case".
 *  - 'mean': mean of the metrics; feasibility is checked on the mean.
 */
export function evaluateCandidate(cell: Cell, s: Scenario, samples: readonly SampledVectors[]): Evaluation {
  const stepMs = s.stepMinutes * 60e3;
  const opts = {
    mode: s.mode, stepMs, weights: s.weights, earthMode: s.earthMode, earthMinElevationDeg: s.earthMinElevationDeg, ...(s.terrain ? { terrain: s.terrain } : {}),
    ...nightOptionsOf(s), ...(s.panel ? { panel: s.panel } : {}), constraints: s.constraints,
  };
  let horizon: CellResult['horizon'], heightM: number | undefined;
  // Slope: the same on every date (absent when no DEM contains the point: then maxSlopeDeg is not met).
  const slope = s.slope ? slopeSummary(cell.lat, cell.lon, { baselineM: s.slope.baselineM }) : null;
  // The same use case as the API (src/useCases.ts): evaluation, slope and constraints (an uncertified slope never meets maxSlopeDeg).
  const perDate = samples.map((sampled, i): DateEvaluation => {
    const { result: e, metrics: em, violations } = evaluatePeriod(cell, sampled, opts, slope);
    horizon = e.horizon; heightM = e.heightM;
    const m = Object.fromEntries(metricKeysOf(em).map((k): [MetricKey, number] => [k, em[k]!])) as Metrics;
    return { date: s.dates[i], periodH: e.periodH, score: round(scoreMetrics(m, s.weights, e.periodH), 3), feasible: violations.length === 0, violations, ...m };
  });
  let metrics: Metrics, score: number, breakdown: Partial<Weights>, violations: string[], worstDate: string | null = null;
  if (s.aggregate === 'worst') {
    const w = perDate.reduce((a: Ranked<DateEvaluation>, b: Ranked<DateEvaluation>) => ((a.feasible - b.feasible) || (a.score - b.score)) <= 0 ? a : b);
    worstDate = w.date;
    metrics = Object.fromEntries(metricKeysOf(w).map((k): [MetricKey, number] => [k, w[k]!])) as Metrics;
    score = w.score;
    breakdown = scoreBreakdown(metrics, s.weights, w.periodH);
    violations = perDate.flatMap((d) => d.violations.map((v) => `${v} [${d.date}]`));
  } else {
    metrics = aggregateMetrics(perDate, 'mean');
    const periodH = perDate[0].periodH;
    score = round(scoreMetrics(metrics, s.weights, periodH), 3);
    breakdown = scoreBreakdown(metrics, s.weights, periodH);
    violations = constraintViolations(metrics, s.constraints, slope);
  }
  return {
    lat: round(cell.lat, 5),
    lon: round(cell.lon, 5),
    ...(cell.id ? { id: cell.id } : {}),
    ...(s.terrain ? { horizon, ...(heightM !== undefined ? { heightM } : {}) } : {}),
    score,
    breakdown,
    feasible: violations.length === 0,
    violations,
    worstDate,
    metrics: Object.fromEntries(Object.entries(metrics).map(([k, v]): [string, number] => [k, round(v, 4)])) as Metrics,
    perDate,
    ...(slope ? { slope } : {}),
  };
}

/** Points around `c`: `rings` rings (r/rings, 2r/rings, …, r) with `directions` directions each. */
export function neighborsAround(c: LatLon, radiusKm: number, directions: number = 8, rings: number = 1): LatLon[] {
  const R = 1737.4, DEG = Math.PI / 180;
  const out: LatLon[] = [];
  for (let k = 1; k <= rings; k++) {
    const d = (radiusKm * k) / rings;
    for (let i = 0; i < directions; i++) {
      const az = (2 * Math.PI * i) / directions;
      const lat = c.lat + (d * Math.cos(az)) / R / DEG;
      const cosLat = Math.max(1e-6, Math.cos(c.lat * DEG));
      let lon = c.lon + (d * Math.sin(az)) / (R * cosLat) / DEG;
      lon = ((((lon + 180) % 360) + 360) % 360) - 180;
      // If the ring crosses the pole, it is reflected (lat < −90 → other side of the pole).
      out.push(lat < -90 ? { lat: -180 - lat, lon: lon > 0 ? lon - 180 : lon + 180 } : lat > 90 ? { lat: 180 - lat, lon: lon > 0 ? lon - 180 : lon + 180 } : { lat, lon });
    }
  }
  return out;
}

const ckey = (c: LatLon): string => `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;

/** Nominal evaluation with cache (neighbors of nearby candidates overlap). */
function evaluateCached(cell: Cell, s: Scenario, samples: readonly SampledVectors[], cache: Map<string, Evaluation> | undefined): Evaluation {
  if (!cache) return evaluateCandidate(cell, s, samples);
  const k = ckey(cell);
  let ev = cache.get(k);
  if (!ev) { ev = evaluateCandidate(cell, s, samples); cache.set(k, ev); }
  return ev;
}

/**
 * Evaluation with spatial robustness (if the scenario enables it):
 *  - score = the WORST among the center and its neighbors at radiusKm;
 *  - feasible only if the center and ALL neighbors are feasible.
 * Without robustness, returns the nominal evaluation as is.
 */
export function evaluateRobust(cell: Cell, s: Scenario, samples: readonly SampledVectors[], cache?: Map<string, Evaluation>): Evaluation {
  const center = evaluateCached(cell, s, samples, cache);
  if (!s.robustness) return center;
  const { radiusKm, directions, rings } = s.robustness;
  const ns = neighborsAround(cell, radiusKm, directions, rings).map((n) => evaluateCached(n, s, samples, cache));
  const worst = [center, ...ns].reduce((a, b) => (better(a, b) > 0 ? a : b));
  const failing = ns.filter((n) => !n.feasible);
  const feasible = center.feasible && failing.length === 0;
  return {
    ...center,
    score: worst.score,
    feasible,
    violations: center.feasible && failing.length
      ? [`vecino a ${radiusKm} km no cumple (${failing.length}/${ns.length}): ${failing[0].violations[0] ?? ''}`]
      : center.violations,
    nominalScore: center.score,
    robustness: {
      radiusKm,
      points: ns.length + 1,
      worstScore: worst.score,
      worstAt: { lat: worst.lat, lon: worst.lon },
      spread: Math.round((center.score - worst.score) * 1000) / 1000,
      failingNeighbors: failing.length,
    },
  };
}

/** Total order: feasible first, then by score, then a deterministic tie-break. */
export const better = (a: Ranked<Evaluation>, b: Ranked<Evaluation>): number => (b.feasible - a.feasible) || (b.score - a.score) || (a.lat - b.lat) || (a.lon - b.lon);

const inRegion = (c: LatLon, r: Region): boolean => c.lat >= r.latMin - 1e-9 && c.lat <= r.latMax + 1e-9 && c.lon >= r.lonMin - 1e-9 && c.lon <= r.lonMax + 1e-9;

/**
 * Iterative optimizer (generator): yields one record per iteration.
 * Iteration 0: coarse grid over the region. Iteration k: neighborhood of the `keepTop` best with half the spacing.
 * Stops when: maxIterations is reached, the grid goes below minSpacingKm, or the improvement is < stopDelta for `patience` iterations.
 */
export function* optimize(s: Scenario, samples: readonly SampledVectors[] = prepareSamples(s)): Generator<IterationRecord, void, unknown> {
  const { spacingKm, maxIterations, keepTop, minSpacingKm, stopDelta, patience } = s.search;
  const seen: Map<string, Candidate> = new Map();
  const cache: Map<string, Evaluation> = new Map(); // nominal evaluations (centers and neighbors), shared across the whole run
  let spacing = spacingKm;
  let candidates = gridCells(s.region!, spacing);
  let prevBest: Candidate | null = null;
  let stale = 0;
  for (let it = 0; it < maxIterations; it++) {
    const t0 = performance.now();
    const fresh: Candidate[] = [];
    for (const c of candidates) {
      if (!inRegion(c, s.region!) || seen.has(key(c))) continue;
      const ev = { ...evaluateRobust(c, s, samples, cache), iteration: it };
      seen.set(key(c), ev);
      fresh.push(ev);
    }
    const added = fresh.length;
    const ranked = [...seen.values()].sort(better);
    const best = ranked[0];
    const improvement = prevBest ? round(best.score - prevBest.score, 4) : null;
    const moveKm = prevBest ? round(distanceKm(prevBest, best), 3) : null;
    stale = improvement !== null && improvement < stopDelta ? stale + 1 : 0;
    const record: Omit<IterationRecord, 'stop'> & { stop?: StopReason | null } = {
      iteration: it,
      spacingKm: round(spacing, 4),
      evaluated: added,
      totalEvaluated: seen.size,
      feasibleCount: ranked.filter((c) => c.feasible).length,
      best,
      top: ranked.slice(0, keepTop).map(({ perDate, ...c }) => c),
      improvement,
      bestMovedKm: moveKm,
      elapsedMs: Math.round(performance.now() - t0),
    };
    // Candidates evaluated in this iteration (with per-date metrics). Non-enumerable: not written to the JSONL,
    // but consumers of the generator (e.g. the database) can read it.
    Object.defineProperty(record, 'candidates', { value: fresh, enumerable: false });
    const next = spacing / 2;
    const done = it === maxIterations - 1 || next < minSpacingKm || stale >= patience;
    record.stop = done ? (it === maxIterations - 1 ? 'maxIterations' : next < minSpacingKm ? 'minSpacing' : 'converged') : null;
    yield record as IterationRecord;
    if (done) return;
    prevBest = best;
    candidates = ranked.slice(0, keepTop).flatMap((b) => neighborhood(b, spacing, next));
    spacing = next;
  }
}

/** Evaluates the reference sites (baselines) with the same scenario, for comparison. */
export function evaluateBaselines(s: Scenario, samples: readonly SampledVectors[]): Baseline[] {
  return s.baselines.map((id) => {
    const site = getSite(id);
    if (!site) return { id, error: 'sitio desconocido' };
    return { name: site.name, ...evaluateRobust(site, s, samples, new Map()) };
  });
}

/** Is the best point on the region boundary? (if so, there may be something better outside). */
export function boundaryWarning(best: LatLon, s: Pick<Scenario, 'search'> & { region: Region }): string | null {
  const tolDeg = (s.search.spacingKm / 1737.4) * (180 / Math.PI);
  const edges: string[] = [];
  if (best.lat - s.region.latMin < tolDeg && s.region.latMin > -90) edges.push('latMin');
  if (s.region.latMax - best.lat < tolDeg && s.region.latMax < 90) edges.push('latMax');
  const fullLon = s.region.lonMax - s.region.lonMin >= 360 - 1e-9;
  if (!fullLon && best.lon - s.region.lonMin < tolDeg / Math.max(0.05, Math.cos(best.lat * Math.PI / 180))) edges.push('lonMin');
  if (!fullLon && s.region.lonMax - best.lon < tolDeg / Math.max(0.05, Math.cos(best.lat * Math.PI / 180))) edges.push('lonMax');
  return edges.length ? `El mejor punto está en el borde de la región (${edges.join(', ')}): amplía la región, puede haber algo mejor fuera.` : null;
}

/**
 * "Point list" mode: evaluates exactly the scenario's points (no grid or refinement).
 * Returns a single iteration record, shaped like optimize()'s, to reuse the report and the database.
 */
export function evaluatePoints(s: Scenario, samples: readonly SampledVectors[] = prepareSamples(s)): IterationRecord {
  const t0 = performance.now();
  const cache: Map<string, Evaluation> = new Map();
  const evaluated = s.points!.map((p): Candidate => ({ ...evaluateRobust(p, s, samples, cache), name: p.name, ...(p.siteId ? { siteId: p.siteId } : {}), iteration: 0 }));
  const ranked = [...evaluated].sort(better);
  const record: IterationRecord = {
    iteration: 0, spacingKm: null, evaluated: evaluated.length, totalEvaluated: evaluated.length,
    feasibleCount: ranked.filter((c) => c.feasible).length, best: ranked[0],
    top: ranked.map(({ perDate, ...c }) => c), improvement: null, bestMovedKm: null,
    elapsedMs: Math.round(performance.now() - t0), stop: 'points',
  };
  Object.defineProperty(record, 'candidates', { value: evaluated, enumerable: false });
  return record;
}
