// Computation service: pure functions returning JSON-serializable objects (dates in ISO 8601 UTC).
import { BODIES, moonFixedVectors, siteFrame, topocentric } from './ephemeris.ts';
import { describeMask, getMask, refinedMask } from './horizon.ts';
import { discEdge, eventsToWindows, findEvents, fractionOver, horizonAt, intersectWindows, margin, marginOver, totalMs, visibleFraction } from './visibility.ts';
import { NIGHT_EXTENSION_LIMIT_DAYS, nightOfSample } from './night.ts';
import { dsnWindows } from './dsn.ts';
import type {
  Body, BodyMasks, BodyNow, BodySeries, Cell, Comparison, HorizonMask, Interval, MarginSample, Mode, NextEvents, NightOptions, NightSummary, PerBody, SampledVectors, Series,
  Site, SiteInfo, Snapshot, Windows, WindowsBreakdown, WindowJson, WindowSummary,
} from './types.ts';

const HOUR_MS = 3600e3;
const DAY_MS = 86400e3;
export const DEFAULT_STEP_MS = 15 * 60e3;

const iso = (ms: number): string => new Date(ms).toISOString();
const round = <T extends number | null>(x: T, d: number): T => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d) as T;
const hours = (ms: number): number => round(ms / HOUR_MS, 3);

/** Public site information, with the description of its horizon. */
function siteInfo(site: Site, mask: HorizonMask | null = getMask(site.id)): SiteInfo {
  const { id, name, region, program, lat, lon, verified, custom } = site;
  return {
    id, name, region, program, lat, lon,
    heightKm: site.heightKm ?? 0,
    verified: verified ?? false,
    ...(custom ? { custom: true } : {}),
    horizon: describeMask(mask),
  };
}

/**
 * Samples the lunar vectors once for [startMs, endMs] (last point = endMs).
 * They are reused for several sites (compare) because they are the expensive part of the computation.
 */
export function sampleVectors(startMs: number, endMs: number, stepMs: number): SampledVectors {
  const t: number[] = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) t.push(ms);
  if (t.at(-1) !== endMs) t.push(endMs);
  return { t, vecs: t.map((ms) => moonFixedVectors(new Date(ms))) };
}

/** Builds the {frame, t, m} sample that findEvents expects from already computed vectors (each body with its own mask). */
function marginsFromVectors(site: Cell, masks: BodyMasks, mode: Mode, sampled: SampledVectors): MarginSample {
  const frame = siteFrame(site);
  const m = Object.fromEntries(BODIES.map((b): [Body, number[]] => [b, sampled.vecs.map((v) => margin(topocentric(frame, v[b], b), masks[b], mode))])) as PerBody<number[]>;
  return { frame, t: sampled.t, m };
}

/**
 * Finds the next rise and set of each body after dateMs, in chunks,
 * and stops as soon as it has them all or the look-ahead runs out.
 */
function nextEvents(site: Site, masks: BodyMasks, mode: Mode, dateMs: number, lookaheadMs: number, stepMs: number): PerBody<NextEvents> {
  const found = Object.fromEntries(BODIES.map((b): [Body, NextEvents] => [b, { rise: null, set: null }])) as PerBody<NextEvents>;
  const chunkMs = Math.max(2 * DAY_MS, stepMs);
  const limit = dateMs + lookaheadMs;
  for (let a = dateMs; a < limit; a += chunkMs) {
    const b = Math.min(a + chunkMs, limit);
    const sample = marginsFromVectors(site, masks, mode, sampleVectors(a, b, stepMs));
    for (const body of BODIES) {
      for (const e of findEvents(sample, body, masks[body], mode)) {
        if (e.time > dateMs && found[body][e.type] === null) found[body][e.type] = e.time;
      }
    }
    if (BODIES.every((body) => found[body].rise !== null && found[body].set !== null)) break;
  }
  return found;
}

/**
 * Mask to use: the one given in `opts.mask` (null = sphere) or, if not given, the site's own (registered or from the
 * catalogue), with the hybrid horizon when the DEM it came from is in the cache (refinedMask; otherwise unchanged).
 */
const siteMask = (site: Pick<Site, 'id'>): HorizonMask | null => refinedMask(getMask(site.id));
const maskOf = (site: Site, chosen: HorizonMask | null | undefined): HorizonMask | null => (chosen === undefined ? siteMask(site) : chosen);

/**
 * Masks per body: `mask` (panel height) for the Sun and `earthMask` (antenna height) for the Earth. Without `earthMask`
 * the Earth uses the same mask as the Sun, as before the two heights existed.
 */
const masksOf = (site: Site, chosen: HorizonMask | null | undefined, chosenEarth: HorizonMask | null | undefined): BodyMasks => {
  const sun = maskOf(site, chosen);
  return { sun, earth: chosenEarth === undefined ? sun : chosenEarth };
};

/**
 * State of the Sun and the Earth at an instant, with the next rise and set.
 * @param {object} site
 * @param {number} dateMs
 * @param {{mode?: string, lookaheadDays?: number, stepMs?: number, mask?: object|null, earthMask?: object|null}} [opts]
 *   mask: explicitly chosen mask (null = spherical horizon). Without it, getMask(site.id) as always.
 *   earthMask: mask for the Earth (antenna height); without it, the Earth uses `mask` too.
 */
export function snapshot(
  site: Site, dateMs: number,
  { mode = 'limb', lookaheadDays = 45, stepMs = DEFAULT_STEP_MS, mask: chosen, earthMask }: { mode?: Mode; lookaheadDays?: number; stepMs?: number; mask?: HorizonMask | null; earthMask?: HorizonMask | null } = {}
): Snapshot {
  const masks = masksOf(site, chosen, earthMask);
  const frame = siteFrame(site);
  const vecs = moonFixedVectors(new Date(dateMs));
  const next = nextEvents(site, masks, mode, dateMs, lookaheadDays * DAY_MS, stepMs);
  const bodies = {} as PerBody<BodyNow>;
  for (const b of BODIES) {
    const mask = masks[b];
    const pos = topocentric(frame, vecs[b], b);
    // One horizon for the state, the fraction and the reported elevation (hybrid horizon near the mode edge and the limb).
    const h = horizonAt(pos, mask, discEdge(pos, mode), pos.el + pos.radiusDeg);
    const visible = marginOver(pos, h, mode) > 0;
    const { rise, set } = next[b];
    bodies[b] = {
      azimuthDeg: round(pos.az, 4),
      elevationDeg: round(pos.el, 4),
      angularRadiusDeg: round(pos.radiusDeg, 4),
      distanceKm: round(pos.distKm, 1),
      horizonElevationDeg: round(h, 4),
      visible,
      visibleFraction: round(fractionOver(pos, h), 4),
      nextRise: rise === null ? null : iso(rise),
      nextSet: set === null ? null : iso(set),
      ...(visible
        ? { hoursToNextSet: set === null ? null : hours(set - dateMs) }
        : { hoursToNextRise: rise === null ? null : hours(rise - dateMs) }),
    };
  }
  return { site: siteInfo(site, masks.sun), date: iso(dateMs), mode, lookaheadDays, bodies };
}

/** Time series of azimuth, elevation, visible fraction and apparent radius of each body. `mask` and `earthMask` as in snapshot (default: the site's own). */
export function series(
  site: Site, startMs: number, endMs: number, stepMs: number,
  { mask: chosen, earthMask }: { mask?: HorizonMask | null; earthMask?: HorizonMask | null } = {},
): Series {
  const masks = masksOf(site, chosen, earthMask);
  const frame = siteFrame(site);
  const { t, vecs } = sampleVectors(startMs, endMs, stepMs);
  const out = { site: siteInfo(site, masks.sun), start: iso(startMs), end: iso(endMs), stepMinutes: stepMs / 60e3, t: t.map(iso) } as Series;
  for (const b of BODIES) {
    const mask = masks[b];
    const az: number[] = [], el: number[] = [], visibleFractionArr: number[] = [], radius: number[] = [];
    for (const v of vecs) {
      const pos = topocentric(frame, v[b], b);
      az.push(round(pos.az, 4));
      el.push(round(pos.el, 4));
      visibleFractionArr.push(round(visibleFraction(pos, mask), 4));
      radius.push(round(pos.radiusDeg, 4));
    }
    out[b] = { az, el, visibleFraction: visibleFractionArr, angularRadiusDeg: radius } satisfies BodySeries;
  }
  return out;
}

/** Summary of a list of windows [start, end] (ms) within an interval. */
function summarize(wins: readonly Interval[], startMs: number, endMs: number): WindowSummary {
  const total = totalMs(wins);
  return {
    count: wins.length,
    totalHours: hours(total),
    fractionOfTime: round(total / (endMs - startMs), 4),
    longestWindowHours: hours(wins.reduce((acc, [s, e]) => Math.max(acc, e - s), 0)),
  };
}

const windowsJson = (wins: readonly Interval[]): WindowJson[] => wins.map(([s, e]) => ({ start: iso(s), end: iso(e), hours: hours(e - s) }));

/**
 * Computes events and windows from an existing sample. With `dsn` (intervals in which some DSN station has the Moon
 * above its minimum elevation, dsn.ts) also `earthDsn`: the Earth visible from the site within those intervals.
 */
function windowsFromSample(sample: MarginSample, masks: BodyMasks, mode: Mode, startMs: number, endMs: number, dsn?: readonly Interval[]): WindowsBreakdown {
  const raw = {} as PerBody<Interval[]>;
  const out = {} as WindowsBreakdown;
  for (const b of BODIES) {
    const events = findEvents(sample, b, masks[b], mode);
    raw[b] = eventsToWindows(events, sample.m[b][0] > 0, startMs, endMs);
    out[b] = {
      ...summarize(raw[b], startMs, endMs),
      events: events.map((e) => ({ type: e.type, time: iso(e.time) })),
      windows: windowsJson(raw[b]),
    };
  }
  const both = intersectWindows(raw.sun, raw.earth);
  out.sunAndEarth = { ...summarize(both, startMs, endMs), windows: windowsJson(both) };
  if (dsn) {
    const earthDsn = intersectWindows(raw.earth, dsn);
    out.earthDsn = { ...summarize(earthDsn, startMs, endMs), windows: windowsJson(earthDsn) };
  }
  return out;
}

/**
 * Rises, sets and visibility windows of each body, plus the Sun ∩ Earth intersection.
 * Windows are clipped to [start, end]: the first may start at start and the last may end at end.
 * `mask` and `earthMask` as in snapshot; the night uses the Sun's mask (`mask`, panel height).
 * `sampled`: vectors already sampled with sampleVectors(startMs, endMs, stepMs), to share them between several calls
 * over the same range (the horizon band); the result is the same as without it.
 * `dsnMinElevationDeg`: also `earthDsn`, the Earth visible from the site while at least one DSN station has the Moon
 * above that elevation (dsn.ts), on the same sampling instants; without it nothing changes.
 */
export function windows(
  site: Site, startMs: number, endMs: number,
  { mode = 'limb', stepMs = DEFAULT_STEP_MS, mask: chosen, earthMask, night, sampled: given, dsnMinElevationDeg }:
  { mode?: Mode; stepMs?: number; mask?: HorizonMask | null; earthMask?: HorizonMask | null; night?: NightOptions | null; sampled?: SampledVectors; dsnMinElevationDeg?: number } = {}
): Windows {
  const masks = masksOf(site, chosen, earthMask);
  const mask = masks.sun;
  const sampled = given ?? sampleVectors(startMs, endMs, stepMs);
  const sample = marginsFromVectors(site, masks, mode, sampled);
  return {
    site: siteInfo(site, mask),
    start: iso(startMs),
    end: iso(endMs),
    mode,
    stepMinutes: stepMs / 60e3,
    ...windowsFromSample(sample, masks, mode, startMs, endMs, dsnMinElevationDeg === undefined ? undefined : dsnWindows(sampled.t, dsnMinElevationDeg)),
    ...(night ? { night: nightSummary(sample.frame, mask, sampled, stepMs, mode, night) } : {}),
  };
}

/**
 * Longest night of [start, end] measured on the windows sample (resolution: one step) and, with `fullNight`, the whole
 * night that touches the interval; with `battery`, the pack that gets through it (night.ts).
 */
function nightSummary(frame: MarginSample['frame'], mask: HorizonMask | null, sampled: SampledVectors, stepMs: number, mode: Mode, o: NightOptions): NightSummary {
  const nightMinSunFraction = o.nightMinSunFraction ?? 0;
  const r = nightOfSample(frame, mask, sampled, stepMs, { mode, nightMinSunFraction, fullNight: o.fullNight, battery: o.battery });
  return {
    minSunFraction: nightMinSunFraction,
    stepMinutes: stepMs / 60e3,
    longestNightHours: r.longestNightH,
    ...(r.longestNightFullH !== undefined ? { longestNightFullHours: r.longestNightFullH, extensionLimitDays: NIGHT_EXTENSION_LIMIT_DAYS } : {}),
    ...(r.fullNightTruncated ? { fullNightTruncated: true as const } : {}),
    ...(r.battery && o.battery ? { battery: { ...o.battery, nightHours: r.battery.nightH, kWh: r.battery.kWh, kg: r.battery.kg } } : {}),
  };
}

/** Compares several sites: snapshot at dateMs and window summary over [dateMs, dateMs + days]. */
export function compare(
  sites: readonly Site[], dateMs: number, days: number,
  { mode = 'limb', stepMs = DEFAULT_STEP_MS, lookaheadDays = 45 }: { mode?: Mode; stepMs?: number; lookaheadDays?: number } = {}
): Comparison {
  const endMs = dateMs + days * DAY_MS;
  const sampled = sampleVectors(dateMs, endMs, stepMs); // shared by all sites
  const strip = ({ events, windows: _w, ...summary }: WindowSummary & { events?: unknown; windows: unknown }): WindowSummary => summary;
  return {
    date: iso(dateMs),
    end: iso(endMs),
    days,
    mode,
    sites: sites.map((site) => {
      const mask = siteMask(site);
      const masks = { sun: mask, earth: mask };
      const snap = snapshot(site, dateMs, { mode, lookaheadDays, stepMs });
      const w = windowsFromSample(marginsFromVectors(site, masks, mode, sampled), masks, mode, dateMs, endMs);
      return {
        site: snap.site,
        now: snap.bodies,
        summary: { sun: strip(w.sun), earth: strip(w.earth), sunAndEarth: strip(w.sunAndEarth) },
      };
    }),
  };
}
