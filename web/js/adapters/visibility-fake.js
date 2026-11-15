// Visibility adapter over the SIMULATED engine (../engine/model.js): invented terrain and approximate ephemeris.
// It samples the sky of the site every SAMPLE_MINUTES and turns it into Sun and Earth windows, so the domain
// does not know the data is fake. Window edges are accurate to ±SAMPLE_MINUTES / 2.
// It ignores the panel and antenna heights of the port (its terrain is invented): the views say so.
import * as M from '../engine/model.js';
import { intersect } from '../../../planner/src/intervals.js';
import { toDomainSite } from '../ports/visibility.js';
import { ringDistancesKm } from '../common/sky3d-geometry.js';
import { SAFE_SLOPE_DEG } from '../../../planner/src/ranking.js';

export const SAMPLE_MINUTES = 30;

/**
 * Slope for R9 from the invented terrain, in the shape of /v1/windows with slope=1: plane over 100 m around the site
 * (central differences 50 m away). Off the map (Apollo 15) there is no terrain: no slope, so R9 stays uncertified.
 */
export function fakeSlope(site) {
  if (site.offMap) return { slopeDeg: null, slopeBaselineM: 100, requestedBaselineM: 100, demResolutionM: null, underestimated: false, meetsMaxSlope: null };
  const { x, y } = M.toMap(site.lat, site.lon), d = 0.05;
  const gx = (M.elevation(x + d, y) - M.elevation(x - d, y)) / (2 * d), gy = (M.elevation(x, y + d) - M.elevation(x, y - d)) / (2 * d);
  const slopeDeg = Math.round(Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI * 100) / 100;
  return { slopeDeg, slopeBaselineM: 100, requestedBaselineM: 100, demResolutionM: null, underestimated: false, meetsMaxSlope: slopeDeg <= SAFE_SLOPE_DEG };
}

const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

/** Sun and Earth windows of a site in [fromMs, toMs], sampled every `stepMs`. Synchronous; exported for scripts. */
export function sampleWindows(site, fromMs, toMs, stepMs = SAMPLE_MINUTES * 60e3) {
  if (!site.horizon) site.horizon = M.computeHorizon(site);
  const sun = [], earth = [];
  let sunFrom = null, earthFrom = null;
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const c = M.sky(site, t);
    if (c.sun.margin > 0) { if (sunFrom === null) sunFrom = t; } else if (sunFrom !== null) { sun.push([sunFrom, t]); sunFrom = null; }
    if (c.earth.margin > 0) { if (earthFrom === null) earthFrom = t; } else if (earthFrom !== null) { earth.push([earthFrom, t]); earthFrom = null; }
  }
  if (sunFrom !== null) sun.push([sunFrom, toMs]);
  if (earthFrom !== null) earth.push([earthFrom, toMs]);
  return { site: toDomainSite(site), startMs: fromMs, endMs: toMs, sun, earth, sunAndEarth: intersect(sun, earth), slope: fakeSlope(site) };
}

export const fakeVisibility = {
  /**
   * Hour-by-hour sky of the simulated engine. `fullMargin` (the margin the windows decide with, #192) is `margin`:
   * sampleWindows counts a body as visible with margin > 0.
   */
  async loadSky(site, fromMs, toMs) {
    if (!site.horizon) site.horizon = M.computeHorizon(site);
    const r = M.evaluate(site, fromMs, (toMs - fromMs) / 864e5, 1);
    const withFull = b => ({ ...b, fullMargin: b.margin });
    const series = r.series.map(c => ({ ...c, sun: withFull(c.sun), earth: withFull(c.earth) }));
    return { series, horizon: { mask: site.horizon.mask, heightM: null } };
  },
  /** Invented terrain around the site, with the same projection and curvature as the simulated horizon (M.horizonInDirection). */
  async loadRelief(site) {
    if (site.offMap) return null; // no invented terrain there: only its horizon
    const { x, y } = M.toMap(site.lat, site.lon), eye = M.elevation(x, y) + M.OBSERVER_HEIGHT_KM;
    const rad = Math.PI / 180, lon = site.lon * rad;
    const north = { x: Math.sin(lon), y: Math.cos(lon) }, east = { x: Math.cos(lon), y: -Math.sin(lon) };
    const distancesKm = ringDistancesKm(), tan = new Float32Array(distancesKm.length * 360);
    distancesKm.forEach((d, j) => {
      for (let az = 0; az < 360; az++) {
        const dx = Math.cos(az * rad) * north.x + Math.sin(az * rad) * east.x, dy = Math.cos(az * rad) * north.y + Math.sin(az * rad) * east.y;
        tan[j * 360 + az] = (M.elevation(x + dx * d, y + dy * d) - eye - (d * d) / (2 * M.MOON_RADIUS_KM)) / d;
      }
    });
    return { azimuthStepDeg: 1, distancesKm, tan, source: 'simulated' };
  },
  async loadWindows(site, fromMs, toMs) {
    await nextTick(); // let the "Calculando…" state paint before the work
    return sampleWindows(site, fromMs, toMs);
  },
};
