// Deep Space Network (DSN): is the Moon above the minimum elevation of at least one of its three complexes?
//
// The Earth being above the horizon of a lunar site does not guarantee that a ground station has the Moon above its own
// horizon (issue #103; PGDA warns that its Earth visibility is optimistic for DSN-only link studies). This module gives
// the elevation of the Moon seen from Goldstone, Madrid and Canberra and the intervals in which at least one of them has
// it above DSN_MIN_ELEVATION_DEG.
//
// Model: geocentric Moon (astronomy-engine GeoMoon, EQJ), minus the station's position on the WGS84 ellipsoid
// (ObserverVector), rotated to the station's horizon (Rotation_EQJ_HOR: precession and nutation of date). No
// refraction (the "airless" elevation of JPL Horizons), centre of the lunar disc. Checked against JPL Horizons with the
// observer at each station (test/dsn.test.ts, fixtures/dsn-horizons.json): error ≤ 0.01° in elevation.
import * as A from 'astronomy-engine';
import { eventsToWindows } from './visibility.ts';
import type { Interval, VisibilityEvent } from './types.ts';

/** A DSN antenna used as the reference of its complex (geodetic WGS84 coordinates). */
export interface DsnStation {
  id: 'goldstone' | 'madrid' | 'canberra';
  name: string;
  /** Reference antenna of the complex (the 70 m one). */
  antenna: string;
  lat: number;
  /** East-positive longitude, degrees. */
  lon: number;
  heightM: number;
}

/**
 * The three complexes, each with its 70 m antenna. Source: DSN Telecommunications Link Design Handbook (JPL 810-005),
 * module 301, "Coverage and Geometry", table of geodetic antenna coordinates (the same ones JPL Horizons uses for its
 * DSS-14, DSS-43 and DSS-63 observer sites).
 */
export const DSN_STATIONS: readonly DsnStation[] = [
  { id: 'goldstone', name: 'Goldstone', antenna: 'DSS-14', lat: 35.4259009, lon: -116.8895382, heightM: 1001.39 },
  { id: 'madrid', name: 'Madrid', antenna: 'DSS-63', lat: 40.4312097, lon: -4.2480085, heightM: 864.82 },
  { id: 'canberra', name: 'Canberra', antenna: 'DSS-43', lat: -35.4024242, lon: 148.9812673, heightM: 688.87 },
];

/**
 * Minimum elevation of the Moon above a station's horizon to count it as available. 10° is a working ASSUMPTION
 * (issue #103) until it is backed by an official source; DSN_MIN_ELEVATION_ASSUMED says so in the API.
 */
export const DSN_MIN_ELEVATION_DEG = 10;
export const DSN_MIN_ELEVATION_ASSUMED = true;

const observers = new Map<DsnStation['id'], A.Observer>(DSN_STATIONS.map((s) => [s.id, new A.Observer(s.lat, s.lon, s.heightM)]));

/** Elevation (°) of the centre of the Moon seen from each station at `ms`, in the order of DSN_STATIONS. */
export function moonElevations(ms: number): number[] {
  const t = A.MakeTime(new Date(ms));
  const moon = A.GeoMoon(t);
  return DSN_STATIONS.map((s) => {
    const obs = observers.get(s.id)!;
    const o = A.ObserverVector(t, obs, false);
    const topo = new A.Vector(moon.x - o.x, moon.y - o.y, moon.z - o.z, t);
    return A.HorizonFromVector(A.RotateVector(A.Rotation_EQJ_HOR(t, obs), topo), '').lat;
  });
}

/** Signed margin (°): the highest Moon elevation among the stations minus `minElevationDeg` (> 0: some station has it). */
export const dsnMargin = (ms: number, minElevationDeg: number = DSN_MIN_ELEVATION_DEG): number => Math.max(...moonElevations(ms)) - minElevationDeg;

// The DSN intervals depend only on the instants, not on the lunar site: the web asks /v1/windows for every site over the
// same range, so the last few grids are kept (a pure function of the grid: same result with or without the memo).
const MEMO_MAX = 8;
const memo = new Map<string, Interval[]>();

/**
 * Intervals of [t[0], t.at(-1)] in which at least one station has the Moon above `minElevationDeg`, from the margin
 * sampled at the instants `t` (ms, ascending) and each crossing refined by bisection to one second. As with
 * visibility.ts findEvents, a gap or a pass shorter than one sampling step can be missed.
 */
export function dsnWindows(t: readonly number[], minElevationDeg: number = DSN_MIN_ELEVATION_DEG): Interval[] {
  const key = `${minElevationDeg}|${t.length}|${t[0]}|${t[1]}|${t.at(-2)}|${t.at(-1)}`;
  let wins = memo.get(key);
  if (!wins) {
    wins = computeDsnWindows(t, minElevationDeg);
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value!);
    memo.set(key, wins);
  }
  return wins.map(([s, e]): Interval => [s, e]);
}

function computeDsnWindows(t: readonly number[], minElevationDeg: number): Interval[] {
  const m = t.map((ms) => dsnMargin(ms, minElevationDeg));
  const events: VisibilityEvent[] = [];
  for (let i = 1; i < t.length; i++) {
    if ((m[i - 1] > 0) === (m[i] > 0)) continue;
    let t0 = t[i - 1], t1 = t[i];
    const up = m[i - 1] > 0;
    while (t1 - t0 > 1000) {
      const tm = (t0 + t1) / 2;
      if ((dsnMargin(tm, minElevationDeg) > 0) === up) t0 = tm; else t1 = tm;
    }
    events.push({ type: m[i] > 0 ? 'rise' : 'set', time: Math.round((t0 + t1) / 2) });
  }
  return eventsToWindows(events, m[0] > 0, t[0], t.at(-1)!);
}
