// Measures the pure calculation functions against the JPL Horizons references in fixtures/. Shared by the tests,
// which assert the budgets, and by accuracy-report.ts, which prints the numbers. No server and no network.
import { readFileSync } from 'node:fs';
import { positionsAt } from '../../backend/src/ephemeris.ts';
import { windows } from '../../backend/src/service.ts';
import type { Body, Mode, PerBody } from '../../backend/src/types.ts';

/** One series of fixtures/horizons.json: az/el (°) and distance (km) of a body at every instant of the grid. */
export interface DirectionSeries { site: string; body: Body; az: number[]; el: number[]; distKm: number[] }
/** fixtures/horizons.json */
export interface DirectionReference {
  source: string;
  fetchedAt: string;
  start: string;
  stepMinutes: number;
  count: number;
  sites: { id: string; lat: number; lon: number; heightKm: number }[];
  series: DirectionSeries[];
}
/** Rises and sets of a body in one mode: crossings are [time in ms, elevation rate in °/h] (> 0 rise). */
export interface BodyEvents { visibleAtStart: boolean; crossings: [number, number][] }
export interface EventsReferenceSite { id: string; lat: number; lon: number; events: PerBody<Record<Mode, BodyEvents>> }
/** fixtures/horizons-events.json */
export interface EventsReference { source: string; fetchedAt: string; start: string; end: string; sites: EventsReferenceSite[] }

export interface DirectionErrors {
  points: number;
  maxDeg: number;
  p99Deg: number;
  rmsDeg: number;
  worst: { errorDeg: number; date?: string; got?: number[]; want?: number[] };
}
export interface EventPair { type: 'rise' | 'set'; time: string; errorSeconds: number; ratePerHour: number; equivalentDeg: number }
export interface UnpairedEvent { type: 'rise' | 'set'; time: string }
export interface EventsComparison {
  pairs: EventPair[];
  missing: UnpairedEvent[];
  extra: UnpairedEvent[];
  visibleHours: { computed: number; reference: number; toleranceHours: number };
}

const load = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
/** Azimuth, elevation and distance on a regular grid of instants (fixtures/fetch-horizons.ts). */
export const directionReference = load('horizons.json') as DirectionReference;
/** Rises and sets of every catalogue site in the three visibility modes (fixtures/fetch-horizons-events.ts). */
export const eventsReference = load('horizons-events.json') as EventsReference;

// Direction error budget, in degrees. Measured over 2026–2030: 0.0047° worst point, 0.0020° RMS overall.
// The maximum bounds the worst instant; the RMS catches systematic biases that stay below the maximum.
export const BUDGET_DEG = { max: 0.006, rms: 0.0025 };

const DEG = Math.PI / 180;
const HOUR_MS = 3_600_000;
// A computed event further than this from every reference event of its type has no counterpart.
const MATCH_WINDOW_MS = 72 * HOUR_MS;

export const instantOf = (i: number): Date => new Date(Date.parse(directionReference.start) + i * directionReference.stepMinutes * 60_000);
export const directionSite = (id: string): DirectionReference['sites'][number] => directionReference.sites.find((s) => s.id === id)!;

/** Angular separation on the sky between two (az, el) directions, in degrees. Well conditioned at the zenith too. */
export function separationDeg(az1: number, el1: number, az2: number, el2: number): number {
  const a = el1 * DEG, b = el2 * DEG, d = (az1 - az2) * DEG;
  const h = Math.sin((a - b) / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(d / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(h))) / DEG;
}

/** Value below which the fraction `p` of an ascending list falls. */
export const percentile = (sorted: readonly number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/**
 * Direction error of `positionsAt` over one reference series.
 * `maxDeg` is the worst point counting both the separation on the sky and the elevation on its own, because
 * elevation is what decides rises and sets.
 */
export function directionErrors(series: DirectionSeries): DirectionErrors {
  const site = directionSite(series.site);
  const separations: number[] = [];
  let worst: DirectionErrors['worst'] = { errorDeg: 0 }, sumSquares = 0;
  for (let i = 0; i < directionReference.count; i++) {
    const p = positionsAt(site, instantOf(i))[series.body];
    const separation = separationDeg(p.az, p.el, series.az[i], series.el[i]);
    const errorDeg = Math.max(separation, Math.abs(p.el - series.el[i]));
    separations.push(separation);
    sumSquares += separation * separation;
    if (errorDeg > worst.errorDeg) worst = { errorDeg, date: instantOf(i).toISOString(), got: [p.az, p.el], want: [series.az[i], series.el[i]] };
  }
  separations.sort((a, b) => a - b);
  return { points: separations.length, maxDeg: worst.errorDeg, p99Deg: percentile(separations, 0.99), rmsDeg: Math.sqrt(sumSquares / separations.length), worst };
}

/**
 * Rises and sets computed by `windows` for one reference site and mode in [startMs, endMs], paired with Horizons'.
 *
 * The time error of an event is its direction error divided by how fast the body crosses the horizon, so a budget
 * in minutes would mean nothing: 0.005° is half a minute at the equator and over an hour at the pole. Each pair
 * carries `equivalentDeg`, the time error times the elevation rate, which is comparable across sites.
 *
 * `visibleHours` compares the total time above the horizon, which also covers the bodies that never cross it.
 * Its tolerance is what the events of the interval may shift without leaving the direction budget.
 */
export function compareEvents(siteId: string, mode: Mode, startMs: number, endMs: number): PerBody<EventsComparison> {
  const ref = eventsReference.sites.find((s) => s.id === siteId)!;
  // Horizons knows no terrain: `mask: null` forces the spherical horizon even where the catalogue has a LOLA mask.
  // The site name only labels the response, which is not compared.
  const computed = windows({ id: siteId, name: siteId, lat: ref.lat, lon: ref.lon }, startMs, endMs, { mode, mask: null });
  const result = {} as PerBody<EventsComparison>;
  for (const body of ['sun', 'earth'] as const) {
    const { visibleAtStart, crossings } = ref.events[body][mode];
    const expected = crossings.map(([time, ratePerHour]) => ({ type: ratePerHour > 0 ? 'rise' as const : 'set' as const, time, ratePerHour }));
    const taken: Set<number> = new Set();
    const pairs: EventPair[] = [], extra: UnpairedEvent[] = [];
    for (const event of computed[body].events) {
      const time = Date.parse(event.time);
      let best = -1, bestGap = MATCH_WINDOW_MS;
      expected.forEach((e, i) => {
        const gap = Math.abs(e.time - time);
        if (!taken.has(i) && e.type === event.type && gap < bestGap) { best = i; bestGap = gap; }
      });
      if (best < 0) { extra.push({ type: event.type, time: event.time }); continue; }
      taken.add(best);
      const e = expected[best];
      const errorSeconds = (time - e.time) / 1000;
      pairs.push({ type: e.type, time: new Date(e.time).toISOString(), errorSeconds, ratePerHour: e.ratePerHour,
        equivalentDeg: Math.abs((errorSeconds / 3600) * e.ratePerHour) });
    }
    // A reference event closer to an end of the interval than the budget may fall outside it in the computation.
    const insideByMoreThanBudget = (e: { time: number; ratePerHour: number }): boolean => (Math.min(e.time - startMs, endMs - e.time) / HOUR_MS) * Math.abs(e.ratePerHour) > BUDGET_DEG.max;
    const missing = expected
      .filter((e, i) => !taken.has(i) && e.time > startMs && e.time < endMs && insideByMoreThanBudget(e))
      .map((e) => ({ type: e.type, time: new Date(e.time).toISOString() }));

    // Reference time above the horizon: walk the crossings from the start of the reference, flipping the state.
    let visible = visibleAtStart, since = startMs, referenceMs = 0, toleranceHours = 0.002; // totalHours has 3 decimals
    for (const e of expected) {
      if (e.time >= endMs) break;
      if (e.time > startMs) {
        if (visible) referenceMs += e.time - since;
        since = e.time;
        toleranceHours += BUDGET_DEG.max / Math.abs(e.ratePerHour);
      }
      visible = e.type === 'rise';
    }
    if (visible) referenceMs += endMs - since;
    result[body] = { pairs, missing, extra,
      visibleHours: { computed: computed[body].totalHours, reference: referenceMs / HOUR_MS, toleranceHours } };
  }
  return result;
}
