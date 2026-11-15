// IDENTITY REFERENCE of the horizon ray-march (#414, epic #413). DO NOT OPTIMIZE OR EDIT THIS FILE.
//
// Literal copy of horizonRay and computeHorizon (src/terrain/horizonMask.ts) and of bilinear, llToXY and R_M
// (src/terrain/dem.ts) as they were in `main` when story B1.1 started. It imports nothing from horizonMask.ts nor
// bilinear from dem.ts, so later changes to src/ cannot move it: test/marchIdentity.test.ts and
// `npm run bench -- --identity <N>` compare src/ against it bit by bit (Object.is on every elevation, same samples
// and misses). If src/ ever has to give different numbers on purpose, that is a new story, not an edit here.
import type { Grid, Layer } from '../../src/types.ts';

export const R_M = 1737400;
const D2R = Math.PI / 180;

export const llToXY = (lat: number, lon: number): [number, number] => {
  const rho = 2 * R_M * Math.tan(((90 + lat) * D2R) / 2);
  return [rho * Math.sin(lon * D2R), rho * Math.cos(lon * D2R)];
};

/** Height (m) by bilinear interpolation; NaN outside the grid. */
export function bilinear(g: Grid, x: number, y: number): number {
  const fx = (x - g.X0) / g.res - 0.5 - g.c0, fy = (g.Y0 - y) / g.res - 0.5 - g.r0;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.w - 1 || j >= g.h - 1) return NaN;
  const u = fx - i, v = fy - j, a = g.a, k = j * g.w + i;
  return (1 - u) * (1 - v) * a[k] + u * (1 - v) * a[k + 1] + (1 - u) * v * a[k + g.w] + u * v * a[k + g.w + 1];
}

/** Options of the march, shared by the mask and the direct ray (RESOLUTIONS in dem.ts). */
export interface MarchOptions { observerHeightM?: number; stepFrac?: number; grow?: number }
/** One ray: elevation (°) of the horizon, samples taken and samples without data. */
export interface RayResult { el: number; samples: number; miss: number }

/**
 * Ray tracer of a site: `trace(azDeg)` marches along the great circle at azimuth azDeg (exact, 0 = north, clockwise)
 * with the same layers, curvature, step and growth as computeHorizon, which calls it for each of its azimuths: at the
 * mask azimuths both give exactly the same elevation (before the mask is rounded to 0.01°).
 * Throws if no layer has data at the site.
 */
export function horizonRay(
  lat: number, lon: number, layers: readonly Layer[], { observerHeightM = 2, stepFrac = 0.5, grow = 0.003 }: MarchOptions = {},
): { groundM: number; trace: (azDeg: number) => RayResult } {
  const [sx, sy] = llToXY(lat, lon);
  let ground = NaN;
  for (const L of layers) { ground = bilinear(L.g, sx, sy); if (!Number.isNaN(ground)) break; }
  if (Number.isNaN(ground)) throw new Error(`Sin DEM en (${lat}, ${lon})`);
  const r0 = R_M + ground + observerHeightM;
  const la = lat * D2R, lo = lon * D2R;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const dEnd = Math.max(...layers.map((l) => l.maxD));
  const last = layers.length - 1;
  const trace = (azDeg: number): RayResult => {
    const az = azDeg * D2R, ca = Math.cos(az), sa = Math.sin(az);
    const tx = ca * north[0] + sa * east[0], ty = ca * north[1] + sa * east[1], tz = ca * north[2] + sa * east[2];
    let best = -Infinity, li = 0, d = layers[0].g.res * 0.5, miss = 0, samples = 0;
    while (d <= dEnd) {
      while (li < last && layers[li].maxD < d) li++;
      const de = d / R_M, cd = Math.cos(de), sd = Math.sin(de);
      // great-circle point at distance d and its south polar stereographic projection
      const qx = cd * up[0] + sd * tx, qy = cd * up[1] + sd * ty, qz = cd * up[2] + sd * tz;
      const f = (2 * R_M) / (1 - qz), x = f * qy, y = f * qx;
      let z = NaN, lj = li;
      for (; lj <= last; lj++) { if (layers[lj].maxD < d) continue; z = bilinear(layers[lj].g, x, y); if (!Number.isNaN(z)) break; }
      samples++;
      if (Number.isNaN(z)) { miss++; lj = last; } else {
        const t = ((R_M + z) * cd - r0) / ((R_M + z) * sd); // tangent of the apparent elevation
        if (t > best) best = t;
      }
      d += Math.max(layers[lj].g.res * stepFrac, grow * d);
    }
    return { el: best === -Infinity ? 0 : Math.atan(best) / D2R, samples, miss };
  };
  return { groundM: ground, trace };
}

/**
 * @param {number} lat @param {number} lon degrees
 * @param {{g: object, maxD: number}[]} layers fine to coarse
 * @param {{nAz?: number, observerHeightM?: number, stepFrac?: number, grow?: number}} [o]
 * @returns {{groundM: number, el: Float64Array, miss: number, samples: number}} el[k] = elevation (°) at azimuth k·360/nAz
 *          (0 = north, clockwise); miss = samples without data (outside every grid).
 */
export function computeHorizon(
  lat: number, lon: number, layers: readonly Layer[],
  { nAz = 720, ...march }: { nAz?: number } & MarchOptions = {}
): { groundM: number; el: Float64Array; miss: number; samples: number } {
  const { groundM, trace } = horizonRay(lat, lon, layers, march);
  const el = new Float64Array(nAz);
  let miss = 0, samples = 0;
  for (let k = 0; k < nAz; k++) {
    const r = trace((k * 360) / nAz);
    el[k] = r.el; miss += r.miss; samples += r.samples;
  }
  return { groundM, el, miss, samples };
}
