// Horizon mask by ray-marching over the DEM (exact sphere curvature).
//
// For each azimuth we march along the great circle leaving the observer and keep the largest apparent elevation of the
// terrain. At each distance the finest layer with data is used (nested grids); the step is `stepFrac` pixels of
// that layer and grows with distance (`grow`·d), because far away the same angular error allows larger steps.
// Measured against a fine reference (0.1° azimuth, 0.25 px step, 20/40/80 m): 20 m ≤ 10 km + 160 m, bilinear,
// 0.5 px step → rms 0.014°; nearest neighbour 0.37°; no curvature 0.76°; uniform 240 m 1.3° (polar ridges).
//
// The mask (720 azimuths in precise mode, 360 in fast, rounded to 0.01°) is interpolated linearly between azimuths.
// horizonRay traces the same march at any exact azimuth; the hybrid horizon (horizon.ts refinedMask) uses it where a body
// is within 0.1° of the horizon. Measured over 2027 (1 h step, 8760 instants, 11 polar and mid-latitude sites) against
// the ray at the exact azimuth: interpolation error max 0.04–0.06° (rms ~0.005°) in precise mode, up to 0.12° in fast;
// every decision change happened with |margin| < 0.04° (precise), so X = 0.1° removes them all; the longest night moved
// 2–4 h at three island sites (e.g. 128 → 124 h at (−89.76432, −156.86311), the fine reference's value) and the energy
// ≤ 1e-4. A ray costs ~0.06 ms in precise mode (~0.015 ms in fast); the worst site needs ~370 per year at 1 h.
// In fast mode the march itself dominates (160/240 m, 1 %·d growth, no 20 m layer): at shackleton-rim it flips the
// Sun's visibility in 406 hours of 2027 and the longest night goes from 111 h to 274 h against a fine reference, which
// a ray with the same march cannot fix; hence the polar warning of fast mode (horizon.ts fastModeWarning).
import { R_M, bilinear, layersFor, demVersion, llToXY } from './dem.ts';
import type { DemMask, Layer, Resolution } from '../types.ts';

const D2R = Math.PI / 180;

/** Options of the march, shared by the mask and the direct ray (RESOLUTIONS in dem.ts). */
export interface MarchOptions { observerHeightM?: number; stepFrac?: number; grow?: number }
/** One ray: elevation (°) of the horizon, samples taken and samples without data. */
export interface RayResult { el: number; samples: number; miss: number }

/**
 * Ray tracer of a site: `trace(azDeg)` marches along the great circle at azimuth azDeg (exact, 0 = north, clockwise)
 * with the same layers, curvature, step and growth as computeHorizon, which calls it for each of its azimuths: at the
 * mask azimuths both give exactly the same elevation (before the mask is rounded to 0.01°).
 * `tableSize()` is the length of its cos/sin table (for tests). Throws if no layer has data at the site.
 */
export function horizonRay(
  lat: number, lon: number, layers: readonly Layer[], { observerHeightM = 2, stepFrac = 0.5, grow = 0.003 }: MarchOptions = {},
): { groundM: number; trace: (azDeg: number) => RayResult; tableSize: () => number } {
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
  // Grid fields of each layer read once per site (g.a is a getter in dem.ts); the interpolation below is bilinear()
  // inlined with the same arithmetic in the same order, so it gives the same bits.
  const L = layers.map(({ g, maxD }) => ({ a: g.a, w: g.w, h: g.h, res: g.res, X0: g.X0, Y0: g.Y0, c0: g.c0, r0: g.r0, maxD }));
  // cos and sin of d/R_M by step index: the distances of a ray are nearly always the same at every azimuth of a site.
  // An entry is used only when its d is exactly the ray's d, so the values are the same Math.cos/Math.sin of the same d.
  // Only nominal steps are added: once a ray has stepped with another layer than li (samples without data, or the site
  // close to the edge of a layer) its distances may leave the nominal sequence, and from there it no longer adds to the
  // table (it still uses an entry whose d matches exactly), so a deviating first ray leaves the tail for the next nominal one.
  const tabD: number[] = [], tabC: number[] = [], tabS: number[] = [];
  const trace = (azDeg: number): RayResult => {
    const az = azDeg * D2R, ca = Math.cos(az), sa = Math.sin(az);
    const tx = ca * north[0] + sa * east[0], ty = ca * north[1] + sa * east[1], tz = ca * north[2] + sa * east[2];
    let best = -Infinity, li = 0, d = L[0].res * 0.5, miss = 0, samples = 0, idx = 0, deviated = false;
    while (d <= dEnd) {
      while (li < last && L[li].maxD < d) li++;
      let cd: number, sd: number;
      if (idx < tabD.length && tabD[idx] === d) { cd = tabC[idx]; sd = tabS[idx]; } else {
        const de = d / R_M;
        cd = Math.cos(de); sd = Math.sin(de);
        if (idx < tabD.length) deviated = true;
        else if (!deviated) { tabD.push(d); tabC.push(cd); tabS.push(sd); }
      }
      idx++;
      // great-circle point at distance d and its south polar stereographic projection
      const qx = cd * up[0] + sd * tx, qy = cd * up[1] + sd * ty, qz = cd * up[2] + sd * tz;
      const f = (2 * R_M) / (1 - qz), x = f * qy, y = f * qx;
      let z = NaN, lj = li;
      for (; lj <= last; lj++) {
        const { a, w, h, res, X0, Y0, c0, r0: row0, maxD } = L[lj];
        if (maxD < d) continue;
        const fx = (x - X0) / res - 0.5 - c0, fy = (Y0 - y) / res - 0.5 - row0;
        const i = Math.floor(fx), j = Math.floor(fy);
        if (i < 0 || j < 0 || i >= w - 1 || j >= h - 1) continue;
        const u = fx - i, v = fy - j, k = j * w + i;
        z = (1 - u) * (1 - v) * a[k] + u * (1 - v) * a[k + 1] + (1 - u) * v * a[k + w] + u * v * a[k + w + 1];
        if (!Number.isNaN(z)) break;
      }
      samples++;
      if (Number.isNaN(z)) { miss++; lj = last; } else {
        const t = ((R_M + z) * cd - r0) / ((R_M + z) * sd); // tangent of the apparent elevation
        if (t > best) best = t;
      }
      if (lj !== li) deviated = true;
      d += Math.max(L[lj].res * stepFrac, grow * d);
    }
    return { el: best === -Infinity ? 0 : Math.atan(best) / D2R, samples, miss };
  };
  return { groundM: ground, trace, tableSize: () => tabD.length };
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

/** Relief around a site as rings: heightsM[j][k] = terrain height (m above the sphere) at distancesM[j] along azimuth k·stepDeg; null without data. */
export interface ReliefRings { groundM: number; stepDeg: number; distancesM: number[]; heightsM: (number | null)[][] }

/**
 * Terrain heights around a site, sampled on the SAME great circles the horizon march follows (0 = north, clockwise),
 * at `nDist` distances in geometric progression from `minM` to `radiusM` (denser near the site). At each distance the
 * finest layer with data is used, as in horizonRay. It is only for drawing (the 3D sky of web/): a client that places
 * each sample with tan(elevation) = ((R + z)·cos(d/R) − r0) / ((R + z)·sin(d/R)), r0 = R + groundM + observer height,
 * gets a relief whose silhouette is the mask's out to `radiusM`, up to the sampling (the rings are sparser than the march).
 * Throws if no layer has data at the site.
 */
export function reliefRings(
  lat: number, lon: number, layers: readonly Layer[], { radiusM, nAz = 360, nDist = 64, minM = 5 }: { radiusM: number; nAz?: number; nDist?: number; minM?: number },
): ReliefRings {
  const [sx, sy] = llToXY(lat, lon);
  let ground = NaN;
  for (const L of layers) { ground = bilinear(L.g, sx, sy); if (!Number.isNaN(ground)) break; }
  if (Number.isNaN(ground)) throw new Error(`Sin DEM en (${lat}, ${lon})`);
  const la = lat * D2R, lo = lon * D2R;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const ratio = Math.pow(radiusM / minM, 1 / (nDist - 1));
  const distancesM = Array.from({ length: nDist }, (_, j) => Math.round(minM * Math.pow(ratio, j) * 100) / 100);
  distancesM[nDist - 1] = radiusM;
  const heightsM = distancesM.map((d) => {
    const de = d / R_M, cd = Math.cos(de), sd = Math.sin(de);
    const ring: (number | null)[] = new Array(nAz);
    for (let k = 0; k < nAz; k++) {
      const az = ((k * 360) / nAz) * D2R, ca = Math.cos(az), sa = Math.sin(az);
      const tx = ca * north[0] + sa * east[0], ty = ca * north[1] + sa * east[1], tz = ca * north[2] + sa * east[2];
      // great-circle point at distance d and its south polar stereographic projection (as in horizonRay)
      const qx = cd * up[0] + sd * tx, qy = cd * up[1] + sd * ty, qz = cd * up[2] + sd * tz;
      const f = (2 * R_M) / (1 - qz), x = f * qy, y = f * qx;
      let z = NaN;
      for (const L of layers) { if (L.maxD < d) continue; z = bilinear(L.g, x, y); if (!Number.isNaN(z)) break; }
      ring[k] = Number.isNaN(z) ? null : Math.round(z * 100) / 100;
    }
    return ring;
  });
  return { groundM: ground, stepDeg: 360 / nAz, distancesM, heightsM };
}

/**
 * Direct ray of a mask computed from the DEM (buildMask, maskFor or the catalogue): same site, observer height,
 * resolution and therefore the same layers and march as the mask. null when the mask has no DEM behind it (hand-made
 * masks, catalogue masks of another DEM version or with no DEM in the cache).
 */
export function rayForMask(mask: Partial<Pick<DemMask, 'lat' | 'lon' | 'observerHeightM' | 'resolution' | 'demVersion'>>): ((azDeg: number) => number) | null {
  const { lat, lon, observerHeightM, resolution, demVersion: version } = mask;
  if (lat === undefined || lon === undefined || observerHeightM === undefined || !resolution || !version || version !== demVersion()) return null;
  const sel = layersFor(lat, lon, resolution);
  if (!sel) return null;
  try {
    const { trace } = horizonRay(lat, lon, sel.layers, { observerHeightM, stepFrac: sel.cfg.stepFrac, grow: sel.cfg.grow });
    return (azDeg) => trace(azDeg).el;
  } catch { return null; }
}

/** Geometric dip of the horizon (°) for an observer `h` m above a smooth sphere: acos(R/(R+h)). */
export const dipDeg = (h: number): number => Math.acos(R_M / (R_M + h)) / D2R;

/**
 * Mask ready to use/store. Format:
 *   { lat, lon, heightM, observerHeightM, stepDeg, el: number[] (hundredths of a degree), source, demVersion, resolution, coverage }
 * Values are ALWAYS rounded to 0.01° (in memory too): so a freshly computed mask and the same one read from the
 * disk cache are bit-identical, and the evals stay deterministic.
 * Returns null if no DEM in the cache contains the point.
 */
export function buildMask(lat: number, lon: number, { observerHeightM = 2, resolution = 'precise' }: { observerHeightM?: number; resolution?: Resolution } = {}): DemMask<number[]> | null {
  const sel = layersFor(lat, lon, resolution);
  if (!sel) return null;
  const { cfg } = sel;
  const hz = computeHorizon(lat, lon, sel.layers, { nAz: cfg.nAz, observerHeightM, stepFrac: cfg.stepFrac, grow: cfg.grow });
  return {
    lat, lon,
    heightM: Math.round(hz.groundM * 10) / 10,
    observerHeightM,
    stepDeg: 360 / cfg.nAz,
    el: Array.from(hz.el, (v) => Math.round(v * 100) / 100),
    source: `LOLA ${sel.products.join(' + ')} (${resolution === 'fast' ? 'rápido' : 'preciso'}, observador a ${observerHeightM} m)`,
    demVersion: demVersion(),
    resolution,
    coverage: Math.round((1 - hz.miss / hz.samples) * 1000) / 1000,
  };
}
