// Hard constraints on the metrics of a period (evals scenarios and the landing-date sweep): feasible / not feasible.
import { uncertifiedReason } from './terrain/slope.ts';
import type { Constraints, MetricKey, Metrics, SlopeSummary } from './types.ts';

const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;

/** Supported constraints: name → [metric, comparison]. */
export const CONSTRAINTS: Readonly<Record<string, [MetricKey, '>=' | '<=']>> = {
  minEnergy: ['energy', '>='],
  minSunFraction: ['sunFraction', '>='],
  minEarthFraction: ['earthFraction', '>='],
  minBothFraction: ['bothFraction', '>='],
  maxLongestNightH: ['longestNightH', '<='],
  maxLongestNoEarthH: ['longestNoEarthH', '<='],
  minLongestBothH: ['longestBothH', '>='],
  maxBatteryKg: ['batteryKg', '<='], // turns `battery` on with its defaults if the caller does not set it
  maxSlopeDeg: ['slopeDeg', '<='], // terrain slope (terrain/slope.ts); turns the slope on (100 m) if the caller does not set it
};

/**
 * Checks the hard constraints. Returns the list of violations (empty = feasible). `uncertified` (metric → reason) marks
 * metrics whose value cannot be trusted against a limit, such as an underestimated slope: a constraint on them is
 * never met, whatever the value («slopeDeg=4.2 (<= 10) sin certificar: …»).
 */
export function checkConstraints(m: Metrics, constraints: Constraints, uncertified: Partial<Record<MetricKey, string>> = {}): string[] {
  const violations: string[] = [];
  for (const [name, limit] of Object.entries(constraints)) {
    const [metric, op] = CONSTRAINTS[name];
    const value = m[metric] ?? NaN; // optional metric that was not computed: violation
    const reason = uncertified[metric];
    if (reason && Number.isFinite(value)) { violations.push(`${metric}=${round(value, 3)} (${op} ${limit}) ${reason}`); continue; }
    const ok = op === '>=' ? value >= limit : value <= limit;
    if (!ok) violations.push(`${metric}=${round(value, 3)} (${op} ${limit})`);
  }
  return violations;
}

/** Constraint violations of some metrics, with the uncertified-slope rule (the evals, the landing-date sweep). */
export function constraintViolations(m: Metrics, constraints: Constraints, slope: SlopeSummary | null): string[] {
  const uncertified: Partial<Record<MetricKey, string>> = slope?.underestimated ? { slopeDeg: uncertifiedReason(slope)! } : {};
  return checkConstraints(m, constraints, uncertified);
}

/** Names of the constraints some metrics miss, in the order given (a metric that was not computed counts as missed). */
export function violatedConstraints(m: Partial<Metrics>, constraints: Constraints): (keyof Constraints)[] {
  return (Object.entries(constraints) as [keyof Constraints, number][]).filter(([name, limit]) => {
    const [metric, op] = CONSTRAINTS[name];
    const value = m[metric] ?? NaN;
    return !(op === '>=' ? value >= limit : value <= limit);
  }).map(([name]) => name);
}
