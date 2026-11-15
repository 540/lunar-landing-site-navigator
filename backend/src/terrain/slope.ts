// Terrain slope at a point from the cached LOLA DEM (dem.ts).
//
// Method: least-squares plane z = a + b·east + c·north fitted to the DEM heights inside a circle whose DIAMETER is the
// baseline (default 100 m, the Artemis III requirement: slope < 10° over 100 m). The heights are sampled by bilinear
// interpolation on a regular lattice (step ≈ half a ground pixel), so the result varies smoothly with the position.
// slope = atan(|∇z|) of that plane; roughness = standard deviation of the residuals of the fit.
//
// Resolution: the finest grid that contains the point (20 m only in some polar windows, 160 m down to 80°S, 240 m down
// to 60°S). A plane needs about 3 pixels across: if the requested baseline is shorter than 3 ground pixels, the minimum
// possible one is used and the result is flagged `underestimated` (on rough terrain the slope over a long baseline is
// gentler than over a short one). Distances are on the ground: the stereographic scale k = 2/(1 − sin lat) is removed.
//
// Official product first: for baselines of 100, 400 and 800 m, where the PGDA LDRM slope is cached (ldrm.ts, ~80°S to
// the pole), that value is used as is (same definition: plane fitted over a baseline, Barker et al. 2023). Order of
// sources: LDRM of the requested baseline → DEM fit on the finest grid that resolves it (20 m windows) → coarse DEM with
// the minimum baseline, `underestimated`. `source` says which one (`pgda-ldrm-100m`, `dem-20m`, `dem-160m`…).
//
// Certification: a slope is certified only when it is measured on the requested baseline. An underestimated slope never
// meets maxSlopeDeg (meetsMaxSlope null, «sin certificar»): with a 160 m DEM the «100 m» slope is really over ~480 m and
// 9.6 % of the points with LDRM 100 m ≥ 10° passed as < 10° (comparison with PGDA, 2026-11).
import { bilinear, covers, demVersion, gridsCovering, llToXY } from './dem.ts';
import { LDRM_PRODUCTS, ldrmSlopeAt, ldrmVersion } from './ldrm.ts';
import type { SlopeOptions, SlopeResult, SlopeSource, SlopeSummary, SlopeUncertifiedPolicy } from '../types.ts';

const D2R = Math.PI / 180;
export const SLOPE_DEFAULT_BASELINE_M = 100;
/** Accepted baselines (m): from a few metres (always clamped to the DEM) to 5 km. */
export const SLOPE_BASELINE_LIMITS: readonly [number, number] = [1, 5000];
/** Minimum baseline in ground pixels for a meaningful plane. */
export const SLOPE_MIN_PIXELS = 3;
/** Most lattice samples per side (keeps a long baseline on a fine grid cheap). */
const MAX_SAMPLES_PER_SIDE = 33;

/** Validated baseline in metres (undefined → default). Throws with a message for the user. */
export function checkSlopeBaseline(value: unknown): number {
  if (value === undefined || value === null) return SLOPE_DEFAULT_BASELINE_M;
  const [min, max] = SLOPE_BASELINE_LIMITS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`slopeBaselineM debe ser un número entre ${min} y ${max} (metros)`);
  }
  return value;
}

/** Stereographic scale factor at a latitude (projected metres per ground metre), true scale at the south pole. */
const scaleAt = (lat: number): number => 2 / (1 - Math.sin(lat * D2R));

/** Identifier of the data the slope comes from (DEM and, if cached, LDRM): part of the evals fingerprint. */
export function slopeDataVersion(): string | null {
  const dem = demVersion(), ldrm = ldrmVersion();
  return ldrm ? `${dem ?? 'sin-dem'}+${ldrm}` : dem;
}

/**
 * Slope of the terrain at (lat, lon) over a baseline (diameter, ground metres): the PGDA LDRM product when it is cached
 * for that baseline and place, otherwise the plane fitted to the DEM. null when neither contains the point (north of
 * ~60°S or no DEM at all). `ldrm: false` gives only the DEM fit (validation against PGDA).
 */
export function slopeAt(lat: number, lon: number, { baselineM, ldrm = true }: SlopeOptions = {}): SlopeResult | null {
  const requested = checkSlopeBaseline(baselineM);
  const fit = demSlopeAt(lat, lon, requested);
  if (!ldrm || !LDRM_PRODUCTS[requested]) return fit;
  const [x, y] = llToXY(lat, lon);
  const official = ldrmSlopeAt(x, y, requested);
  if (!official) return fit;
  const { grid } = official;
  return {
    slopeDeg: official.slopeDeg,
    slopeBaselineM: requested,
    requestedBaselineM: requested,
    demResolutionM: grid.res,
    pixelGroundM: grid.res / scaleAt(lat),
    underestimated: false,
    // LDRM has no roughness: the DEM one only when the DEM resolves the same baseline (20 m windows).
    roughnessM: fit && !fit.underestimated ? fit.roughnessM : null,
    samples: fit?.samples ?? 0,
    product: `${grid.product}@${grid.res}m`,
    source: `pgda-ldrm-${requested}m`,
    demVersion: slopeDataVersion(),
  };
}

/** Plane fitted to the cached DEM (the method described at the top). */
function demSlopeAt(lat: number, lon: number, requested: number): SlopeResult | null {
  const [x, y] = llToXY(lat, lon);
  const k = scaleAt(lat);
  // Finest grid that contains the whole footprint (at least 3 pixels) plus two pixels of margin for the interpolation.
  const footprintM = (res: number): number => Math.max(requested, (SLOPE_MIN_PIXELS * res) / k);
  const g = gridsCovering(x, y).find((grid) => covers(grid, x, y, (footprintM(grid.res) / 2) * k + 2 * grid.res));
  if (!g) return null;
  const pixelGroundM = g.res / k;
  const minBaseline = SLOPE_MIN_PIXELS * pixelGroundM;
  const used = footprintM(g.res);
  const r = used / 2; // ground metres
  const step = Math.max(pixelGroundM / 2, used / (MAX_SAMPLES_PER_SIDE - 1));
  const n = Math.floor(r / step);
  let count = 0, se = 0, sn = 0, sz = 0, see = 0, snn = 0, sen = 0, sez = 0, snz = 0;
  const samples: number[] = [];
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const e = i * step, nn = j * step;
      if (e * e + nn * nn > r * r + 1e-9) continue;
      // Ground offsets → projected offsets. East/north are along +x/+y rotated by the longitude; the slope magnitude does
      // not depend on the orientation of the axes, so the projected axes are used directly (scaled to the ground).
      const z = bilinear(g, x + e * k, y + nn * k);
      if (!Number.isFinite(z)) continue;
      count++; se += e; sn += nn; sz += z; see += e * e; snn += nn * nn; sen += e * nn; sez += e * z; snz += nn * z;
      samples.push(e, nn, z);
    }
  }
  if (count < 6) return null;
  // Centred normal equations of the plane.
  const me = se / count, mn = sn / count, mz = sz / count;
  const cee = see - count * me * me, cnn = snn - count * mn * mn, cen = sen - count * me * mn;
  const cez = sez - count * me * mz, cnz = snz - count * mn * mz;
  const det = cee * cnn - cen * cen;
  if (!(Math.abs(det) > 0)) return null;
  const b = (cez * cnn - cnz * cen) / det, c = (cnz * cee - cez * cen) / det;
  let rss = 0;
  for (let s = 0; s < samples.length; s += 3) {
    const res = samples[s + 2] - (mz + b * (samples[s] - me) + c * (samples[s + 1] - mn));
    rss += res * res;
  }
  return {
    slopeDeg: Math.atan(Math.hypot(b, c)) / D2R,
    slopeBaselineM: used,
    requestedBaselineM: requested,
    demResolutionM: g.res,
    pixelGroundM,
    underestimated: requested < minBaseline,
    roughnessM: Math.sqrt(rss / Math.max(1, count - 3)),
    samples: count,
    product: `${g.product}@${g.res}m`,
    source: `dem-${g.res}m` as SlopeSource,
    demVersion: demVersion(),
  };
}

const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;

/** Artemis III landing requirement the default baseline comes from (NASA, Artemis overview for the Space Apps challenge, 2025). */
export const ARTEMIS_SLOPE_REQUIREMENT = 'Artemis III pide una pendiente menor de 10° en una base de 100 m (NASA, «Artemis Overview», 2025).';

/** Validated maximum slope in degrees (undefined → no filter). Throws with a message for the user. */
export function checkMaxSlope(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 90) throw new Error('maxSlopeDeg debe ser un número entre 0 y 90 (grados)');
  return value;
}

/** Validated policy for uncertified slopes under maxSlopeDeg (undefined → 'exclude'). Throws with a message for the user. */
export function checkUncertifiedPolicy(value: unknown): SlopeUncertifiedPolicy {
  if (value === undefined || value === null) return 'exclude';
  if (value !== 'exclude' && value !== 'keep') throw new Error('slopeUncertified debe ser exclude o keep');
  return value;
}

/** Why a slope cannot be checked against maxSlopeDeg (null = it can): unknown, or uncertified (underestimated). */
export function uncertifiedReason(s: Pick<SlopeSummary, 'slopeDeg' | 'slopeBaselineM' | 'requestedBaselineM' | 'underestimated'>): string | null {
  if (s.slopeDeg === null) return 'sin pendiente: el punto queda fuera del DEM LOLA en caché';
  if (s.underestimated) return `sin certificar: la base real es de ${Math.round(s.slopeBaselineM!)} m (se pidieron ${s.requestedBaselineM} m)`;
  return null;
}

/**
 * Slope of a point for the API responses: rounded, JSON-friendly, with null fields when no DEM contains the point.
 * With `maxSlopeDeg`, also whether the point meets it: true/false only when the slope is certified; null (with the
 * reason) when it is underestimated, never true; false (with the reason) when there is no slope.
 */
export function slopeSummary(lat: number, lon: number, { baselineM, maxSlopeDeg, ldrm }: SlopeOptions & { maxSlopeDeg?: number } = {}): SlopeSummary {
  const r = slopeAt(lat, lon, { baselineM, ldrm });
  const s: SlopeSummary = {
    slopeDeg: r ? round(r.slopeDeg, 2) : null,
    slopeBaselineM: r ? round(r.slopeBaselineM, 0) : null,
    requestedBaselineM: checkSlopeBaseline(baselineM),
    demResolutionM: r ? r.demResolutionM : null,
    underestimated: r ? r.underestimated : false,
    roughnessM: r && r.roughnessM !== null ? round(r.roughnessM, 2) : null,
    source: r ? r.source : null,
  };
  if (maxSlopeDeg === undefined) return s;
  const reason = uncertifiedReason({ ...s, slopeBaselineM: r?.slopeBaselineM ?? null });
  if (!r) return { ...s, meetsMaxSlope: false, meetsMaxSlopeReason: reason! };
  // Uncertified even when it is already above the limit on the longer baseline (then most likely steep, but not measured).
  if (reason) return { ...s, meetsMaxSlope: null, meetsMaxSlopeReason: r.slopeDeg > maxSlopeDeg ? `${reason}; ya en esa base supera ${maxSlopeDeg}°` : reason };
  return { ...s, meetsMaxSlope: r.slopeDeg <= maxSlopeDeg };
}

/** Explanation that goes with the slope of a point (or of a set of points: then `summaries` are all of them). */
export function slopeNote(summaries: readonly SlopeSummary[], requestedBaselineM: number): string {
  const missing = summaries.filter((s) => s.slopeDeg === null).length;
  const under = summaries.filter((s) => s.underestimated);
  const official = summaries.filter((s) => s.source?.startsWith('pgda-ldrm-')).length;
  const fitted = summaries.filter((s) => s.source?.startsWith('dem-'));
  const res = [...new Set(fitted.map((s) => s.demResolutionM!))].sort((a, b) => a - b);
  const parts = [`Pendiente = inclinación del plano ajustado por mínimos cuadrados a las alturas del terreno en un círculo de ${requestedBaselineM} m de diámetro (la base).`];
  if (official) parts.push(`${summaries.length > 1 ? `En ${official} de ${summaries.length} puntos sale` : 'Sale'} del producto oficial de PGDA (LDRM, Barker et al. 2023, 50 m/px, hasta 80°S).`);
  if (res.length) parts.push(`${official ? 'En el resto, ' : ''}DEM LOLA usado: ${res.join(', ')} m/px.`);
  if (under.length) {
    const used = under.map((s) => s.slopeBaselineM!);
    const lo = Math.min(...used), hi = Math.max(...used);
    parts.push(`AVISO: ${summaries.length > 1 ? `en ${under.length} de ${summaries.length} puntos ` : ''}el DEM no resuelve ${requestedBaselineM} m y se ha usado la base mínima posible (3 píxeles: ${lo === hi ? lo : `${lo}–${hi}`} m); la pendiente en ${requestedBaselineM} m puede ser mayor (subestimada). Sin certificar: con maxSlopeDeg no cuenta como apta (meetsMaxSlope null).`);
  }
  if (missing) parts.push(`${summaries.length > 1 ? `${missing} de ${summaries.length} puntos quedan` : 'El punto queda'} fuera del DEM LOLA en caché (polo sur, hasta unos 60°S) o el servidor no tiene el DEM: sin pendiente${summaries.length > 1 ? ' (no cumplen maxSlopeDeg)' : ''}.`);
  parts.push(ARTEMIS_SLOPE_REQUIREMENT);
  return parts.join(' ');
}

/** Slope of one site with its explanation (site endpoints and the landing-date sweep). */
export function siteSlope(lat: number, lon: number, req: SlopeOptions & { maxSlopeDeg?: number }): SlopeSummary & { note: string } {
  const s = slopeSummary(lat, lon, req);
  return { ...s, note: slopeNote([s], s.requestedBaselineM) };
}
