// Visibility of a disc (Sun or Earth) above the horizon and search for rises/sets.
import { BODIES, moonFixedVectors, siteFrame, topocentric } from './ephemeris.ts';
import { horizonElevation } from './horizon.ts';
import type { Body, DiscPosition, HorizonMask, Interval, LatLon, MarginSample, Mode, PerBody, SiteFrame, VisibilityEvent } from './types.ts';

/**
 * Visibility criterion:
 *  - 'limb'   : some part of the disc is visible (upper limb above the horizon). Default, and the criterion of
 *               Horizons' own rise/set tables.
 *  - 'center' : the centre of the disc is above the horizon.
 *  - 'full'   : the whole disc is above the horizon.
 */
export const MODES: Record<Mode, number> = { limb: 1, center: 0, full: -1 };

/**
 * Horizon elevation (°) used for a body at `pos`: the mask's, interpolated at its azimuth, or, with the hybrid horizon
 * (mask.refine, horizon.ts refinedMask), the direct ray at the exact azimuth when the interpolated value is within
 * refine.deg of `edge` or `edge2` (the elevations where the decision flips: e.g. the upper limb for 'limb').
 * Without `refine` it is exactly horizonElevation(mask, pos.az).
 */
export function horizonAt(pos: Pick<DiscPosition, 'az'>, mask: HorizonMask | null, edge: number, edge2: number = NaN): number {
  const h = horizonElevation(mask, pos.az);
  const r = mask?.refine;
  if (r && (Math.abs(edge - h) < r.deg || Math.abs(edge2 - h) < r.deg)) return r.elevation(pos.az);
  return h;
}

/** Elevation (°) of the point of the disc that decides `mode` (upper limb, centre or lower limb), minus minElevationDeg. */
export const discEdge = (pos: DiscPosition, mode: Mode, minElevationDeg: number = 0): number => pos.el + MODES[mode] * pos.radiusDeg - minElevationDeg;

/** Signed margin (°) over a given horizon elevation `h` (see margin). */
export function marginOver(pos: DiscPosition, h: number, mode: Mode, minElevationDeg: number = 0): number {
  return pos.el + MODES[mode] * pos.radiusDeg - h - minElevationDeg;
}

/** Visible fraction of the disc over a given horizon elevation `h` (see visibleFraction). */
export function fractionOver(pos: DiscPosition, h: number): number {
  const y = (h - pos.el) / pos.radiusDeg; // horizon relative to the centre, in radii
  if (y <= -1) return 1;
  if (y >= 1) return 0;
  return (Math.acos(y) - y * Math.sqrt(1 - y * y)) / Math.PI;
}

/**
 * Horizon height, in disc radii above the centre, at which the visible fraction is `f` (0..1): 1 for f = 0 (upper
 * limb), 0 for 0.5, −1 for 1. visibleFraction refines around this edge (nightMinSunFraction uses it).
 */
export function fractionEdgeY(f: number): number {
  if (!(f > 0)) return 1;
  if (f >= 1) return -1;
  let y = edgeYs.get(f);
  if (y === undefined) {
    let lo = -1, hi = 1; // the fraction decreases with y
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if ((Math.acos(mid) - mid * Math.sqrt(1 - mid * mid)) / Math.PI > f) lo = mid; else hi = mid;
    }
    y = (lo + hi) / 2;
    if (edgeYs.size > 1000) edgeYs.clear();
    edgeYs.set(f, y);
  }
  return y;
}
const edgeYs: Map<number, number> = new Map();

/**
 * Signed margin (degrees): > 0 visible, < 0 hidden. Its zero crossing is the event.
 * `minElevationDeg` additionally requires a minimum elevation above the horizon (e.g. so that an antenna
 * has the Earth with some clearance and not just "grazing" the horizon).
 * With the hybrid horizon, when |margin| < refine.deg the direct ray at the exact azimuth replaces the mask.
 */
export function margin(pos: DiscPosition, mask: HorizonMask | null, mode: Mode, minElevationDeg: number = 0): number {
  return marginOver(pos, horizonAt(pos, mask, discEdge(pos, mode, minElevationDeg)), mode, minElevationDeg);
}

/**
 * Fraction of the disc above the horizon (0..1), approximating the local horizon as a straight line.
 * Useful as a proxy for the solar power available at rise/set.
 * With the hybrid horizon it refines around the edge at `edgeY` radii above the centre (default 1: the upper limb, where
 * the fraction stops being 0; fractionEdgeY(f) for a threshold f).
 */
export function visibleFraction(pos: DiscPosition, mask: HorizonMask | null, edgeY: number = 1): number {
  return fractionOver(pos, horizonAt(pos, mask, pos.el + edgeY * pos.radiusDeg));
}

/**
 * Samples the visibility margin of each body over [start, end] with step stepMs.
 * Computes the lunar vectors once per instant and reuses them for all bodies.
 */
export function sampleMargins(site: LatLon & { heightKm?: number }, mask: HorizonMask | null, mode: Mode, startMs: number, endMs: number, stepMs: number): MarginSample {
  const frame = siteFrame(site);
  const t: number[] = [];
  const m = Object.fromEntries(BODIES.map((b): [Body, number[]] => [b, []])) as PerBody<number[]>;
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const vecs = moonFixedVectors(new Date(ms));
    t.push(ms);
    for (const b of BODIES) m[b].push(margin(topocentric(frame, vecs[b], b), mask, mode));
  }
  if (t.at(-1) !== endMs) {
    const vecs = moonFixedVectors(new Date(endMs));
    t.push(endMs);
    for (const b of BODIES) m[b].push(margin(topocentric(frame, vecs[b], b), mask, mode));
  }
  return { frame, t, m };
}

/** Refines by bisection the crossing instant between t0 and t1 (ms), down to toleranceMs. */
function bisect(frame: SiteFrame, body: Body, mask: HorizonMask | null, mode: Mode, t0: number, m0: number, t1: number, toleranceMs: number = 1000): number {
  while (t1 - t0 > toleranceMs) {
    const tm = (t0 + t1) / 2;
    const mm = margin(topocentric(frame, moonFixedVectors(new Date(tm))[body], body), mask, mode);
    if (Math.sign(mm) === Math.sign(m0)) { t0 = tm; m0 = mm; } else { t1 = tm; }
  }
  return Math.round((t0 + t1) / 2);
}

/**
 * Rises and sets of a body over the sampled interval.
 * Limitation: if the body rises and sets within one sampling step, that pair is missed.
 * With a 10–15 min step this is irrelevant except for near-tangent grazes of the horizon.
 */
export function findEvents(sample: MarginSample, body: Body, mask: HorizonMask | null, mode: Mode): VisibilityEvent[] {
  const { frame, t, m } = sample;
  const arr = m[body];
  const events: VisibilityEvent[] = [];
  for (let i = 1; i < arr.length; i++) {
    if ((arr[i - 1] > 0) !== (arr[i] > 0)) {
      events.push({
        type: arr[i] > 0 ? 'rise' : 'set',
        time: bisect(frame, body, mask, mode, t[i - 1], arr[i - 1], t[i], 1000),
      });
    }
  }
  return events;
}

/** Converts events into visibility intervals within [startMs, endMs]. */
export function eventsToWindows(events: readonly VisibilityEvent[], visibleAtStart: boolean, startMs: number, endMs: number): Interval[] {
  const windows: Interval[] = [];
  let open: number | null = visibleAtStart ? startMs : null;
  for (const e of events) {
    if (e.type === 'rise') open = e.time;
    else if (open !== null) { windows.push([open, e.time]); open = null; }
  }
  if (open !== null) windows.push([open, endMs]);
  return windows;
}

/** Intersection of two sorted lists of intervals. */
export function intersectWindows(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]), e = Math.min(a[i][1], b[j][1]);
    if (s < e) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

export const totalMs = (windows: readonly Interval[]): number => windows.reduce((acc, [s, e]) => acc + (e - s), 0);
