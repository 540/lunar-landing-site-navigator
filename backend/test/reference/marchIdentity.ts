// Bit-by-bit comparison of the ray-march of src/ (src/terrain/horizonMask.ts) with the frozen reference
// (horizonMarchReference.ts). Shared by test/marchIdentity.test.ts (synthetic grids) and
// `npm run bench -- --identity <N>` (real DEM).
import { computeHorizon, horizonRay } from '../../src/terrain/horizonMask.ts';
import type { Layer } from '../../src/types.ts';
import * as ref from './horizonMarchReference.ts';

/** March of one comparison: the mask's azimuth count plus the RESOLUTIONS step and growth. */
export interface MarchCase { nAz: number; observerHeightM: number; stepFrac: number; grow: number }

/** Result of comparing one point: what was compared and every difference found (empty = identical). */
export interface MarchComparison { azimuths: number; rays: number; samples: number; miss: number; diffs: string[] }

/** Deterministic pseudo-random generator in [0, 1) (mulberry32): same seed, same sequence. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` arbitrary azimuths (°) in [0, 360), rounded to 1e-4°. */
export const randomAzimuths = (rand: () => number, n: number): number[] =>
  Array.from({ length: n }, () => Math.round(rand() * 360 * 1e4) / 1e4);

/**
 * Compares computeHorizon (Object.is on groundM and on every elevation, same samples and misses) and then
 * horizonRay(...).trace: first every mask azimuth, then `rayAzimuths`, with the SAME tracer of each side (a tracer that
 * keeps state between calls must still give the same bits).
 */
export function compareMarch(lat: number, lon: number, layers: readonly Layer[], c: MarchCase, rayAzimuths: readonly number[]): MarchComparison {
  const diffs: string[] = [];
  const where = `(${lat}, ${lon}) h=${c.observerHeightM} m nAz=${c.nAz}`;
  const march = { observerHeightM: c.observerHeightM, stepFrac: c.stepFrac, grow: c.grow };
  const got = computeHorizon(lat, lon, layers, { nAz: c.nAz, ...march });
  const want = ref.computeHorizon(lat, lon, layers, { nAz: c.nAz, ...march });
  if (!Object.is(got.groundM, want.groundM)) diffs.push(`${where}: groundM ${got.groundM} ≠ ${want.groundM}`);
  if (got.samples !== want.samples) diffs.push(`${where}: samples ${got.samples} ≠ ${want.samples}`);
  if (got.miss !== want.miss) diffs.push(`${where}: miss ${got.miss} ≠ ${want.miss}`);
  if (got.el.length !== want.el.length) diffs.push(`${where}: ${got.el.length} acimuts ≠ ${want.el.length}`);
  for (let k = 0; k < want.el.length; k++) {
    if (!Object.is(got.el[k], want.el[k])) diffs.push(`${where}: máscara, acimut ${(k * 360) / c.nAz}°: ${got.el[k]} ≠ ${want.el[k]}`);
  }
  const srcRay = horizonRay(lat, lon, layers, march), refRay = ref.horizonRay(lat, lon, layers, march);
  if (!Object.is(srcRay.groundM, refRay.groundM)) diffs.push(`${where}: rayo, groundM ${srcRay.groundM} ≠ ${refRay.groundM}`);
  const azimuths = [...Array.from({ length: c.nAz }, (_, k) => (k * 360) / c.nAz), ...rayAzimuths];
  for (const az of azimuths) {
    const a = srcRay.trace(az), b = refRay.trace(az);
    if (!Object.is(a.el, b.el) || a.samples !== b.samples || a.miss !== b.miss) {
      diffs.push(`${where}: rayo a ${az}°: el ${a.el}/${b.el}, samples ${a.samples}/${b.samples}, miss ${a.miss}/${b.miss}`);
    }
  }
  return { azimuths: c.nAz, rays: rayAzimuths.length, samples: want.samples, miss: want.miss, diffs };
}
