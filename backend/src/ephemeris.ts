// Ephemeris core: position of the Sun and the Earth seen from a point on the lunar surface.
//
// Model:
//  - Geocentric positions of Sun and Moon with astronomy-engine (EQJ = J2000 equatorial).
//  - Moon orientation with the IAU model (RotationAxis), roughly equivalent to IAU_MOON / Mean Earth.
//  - Spherical Moon, R = 1737.4 km (same as Horizons). No refraction (no atmosphere).
// Validated against JPL Horizons (DE441, MEAN_ME): direction error ≤ 0.006° over 2026–2030 (see test/horizons.test.ts and data/test/precision.test.ts).
import * as A from 'astronomy-engine';
import { ephemerisTableIndex, tableVectors } from './ephemerisTable.ts';
import type { Body, Mat3, PerBody, Site, SiteFrame, Topocentric, Vec3 } from './types.ts';

export const R_MOON_KM = 1737.4;
export const AU_KM = 149597870.7;
export const BODY_RADIUS_KM: PerBody<number> = { sun: 695700, earth: 6378.137 };
export const BODIES: readonly Body[] = ['sun', 'earth'];

const DEG = Math.PI / 180;

const rotZ = (a: number): Mat3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
};
const rotX = (a: number): Mat3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, s], [0, -s, c]];
};
const matMul
 = (a: Mat3, b: Mat3): Mat3 => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j])) as Mat3;
const matVec = (m: Mat3, v: readonly number[]): Vec3 => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as Vec3;

/** Unit vector from selenographic latitude/longitude (degrees, east-positive longitude). */
export function unitVector(latDeg: number, lonDeg: number): Vec3 {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

// Optional memo of moonFixedVectors for one scope (withVectorCache): the GraphQL layer (data/src/graphql) runs every field
// of a request inside one, so several fields, sites or sweeps that sample the same instants evaluate the ephemeris once.
// The vectors are a pure function of the instant, so the results are bit-identical with or without the memo.
let vectorMemo: Map<number, PerBody<Vec3>> | null = null;
let vectorMemoMax = 0;
const vectorStats = { hits: 0, misses: 0 };

/**
 * Runs `fn` with moonFixedVectors memoized by instant (at most `maxEntries` instants; past that, computed as usual).
 * Scopes nest: an inner scope starts empty and the outer one is restored afterwards.
 */
export function withVectorCache<T>(fn: () => T, maxEntries: number = 200000): T {
  const prev = vectorMemo, prevMax = vectorMemoMax;
  vectorMemo = new Map();
  vectorMemoMax = maxEntries;
  try { return fn(); } finally { vectorMemo = prev; vectorMemoMax = prevMax; }
}

/** Hits and misses of the vector memo since the thread started (for measurements and tests). */
export const vectorCacheStats = (): { hits: number; misses: number } => ({ ...vectorStats });

/**
 * Moon→Sun and Moon→Earth vectors in the Moon-fixed frame (km), for one instant.
 * This is the expensive part of the computation; it is shared by all sites at the same instant.
 * Looked up first in the memo of withVectorCache, then in the shared exact table (ephemerisTable.ts), then computed.
 */
export function moonFixedVectors(date: Date): PerBody<Vec3> {
  if (!vectorMemo) return sharedVectors(date);
  const ms = date.getTime();
  const hit = vectorMemo.get(ms);
  if (hit) { vectorStats.hits++; return hit; }
  vectorStats.misses++;
  const v = sharedVectors(date);
  if (vectorMemo.size < vectorMemoMax) vectorMemo.set(ms, v);
  return v;
}

/** From the shared table when the instant is on its grid (and a table is adopted); otherwise computed as always. */
function sharedVectors(date: Date): PerBody<Vec3> {
  const k = ephemerisTableIndex(date.getTime());
  return k < 0 ? computeVectors(date) : tableVectors(k, () => computeVectors(date));
}

function computeVectors(date: Date): PerBody<Vec3> {
  const t = A.MakeTime(date);
  const axis = A.RotationAxis(A.Body.Moon, t);
  // EQJ → Moon-fixed: Rz(W) · Rx(90° − δ) · Rz(90° + α)
  const R = matMul(rotZ(axis.spin * DEG), matMul(rotX((90 - axis.dec) * DEG), rotZ((90 + axis.ra * 15) * DEG)));
  const moon = A.GeoMoon(t);
  const sun = A.GeoVector(A.Body.Sun, t, true);
  return {
    sun: matVec(R, [sun.x - moon.x, sun.y - moon.y, sun.z - moon.z].map((x) => x * AU_KM)),
    earth: matVec(R, [-moon.x, -moon.y, -moon.z].map((x) => x * AU_KM)),
  };
}

/** Local east/north/up basis of a site (can be precomputed). */
export function siteFrame(site: Pick<Site, 'lat' | 'lon' | 'heightKm'>): SiteFrame {
  const la = site.lat * DEG, lo = site.lon * DEG;
  const up: Vec3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const r = R_MOON_KM + (site.heightKm ?? 0);
  return {
    pos: up.map((x) => x * r) as Vec3,
    up,
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
  };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Topocentric coordinates of a body seen from a site.
 * @returns {{az:number, el:number, distKm:number, radiusDeg:number}} az from north towards east, in degrees.
 */
export function topocentric(frame: SiteFrame, centerVec: Vec3, body: Body): Topocentric {
  const v: Vec3 = [centerVec[0] - frame.pos[0], centerVec[1] - frame.pos[1], centerVec[2] - frame.pos[2]];
  const d = Math.hypot(v[0], v[1], v[2]);
  const e = dot(v, frame.east) / d, n = dot(v, frame.north) / d, u = dot(v, frame.up) / d;
  let az = Math.atan2(e, n) / DEG;
  if (az < 0) az += 360;
  return {
    az,
    el: Math.asin(Math.max(-1, Math.min(1, u))) / DEG,
    distKm: d,
    radiusDeg: Math.asin(BODY_RADIUS_KM[body] / d) / DEG,
  };
}

/** Shortcut: positions of all bodies for a site and instant. */
export function positionsAt(site: Pick<Site, 'lat' | 'lon' | 'heightKm'>, date: Date, frame: SiteFrame = siteFrame(site)): PerBody<Topocentric> {
  const vecs = moonFixedVectors(date);
  return Object.fromEntries(BODIES.map((b) => [b, topocentric(frame, vecs[b], b)])) as PerBody<Topocentric>;
}
