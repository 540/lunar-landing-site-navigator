// Port: where the Sun and Earth visibility windows of a site come from (see docs/adr/0001-arquitectura-hexagonal.md).
// The domain (planner/src) only knows these windows; each adapter in ../adapters/ provides them from a source:
// the simulated engine today, the data API v1 (/v1/windows) or a precomputed JSON later.
//
// An adapter is any object with this shape:
//
//   loadWindows(site, fromMs, toMs, heights?, { band }?) → Promise<Windows>  band: also the horizon robustness band, if the source has it
//   loadSky(site, fromMs, toMs, heights?)     → Promise<Sky>  optional: only to draw the sky (Plan and Advanced)
//   loadRelief(site)                → Promise<Relief | null>  optional: the terrain around the site, only to draw the 3D sky
//   loadLightMap(request)           → Promise<LightMap>  optional: share of a period with the Sun around a point (Advanced map)
//   loadSlope(site)                 → Promise<Slope>     optional: terrain slope at the site (Advanced)
//   loadEnergy(request)             → Promise<Energy>    optional: energy the solar panel gets over a mission (#254)
//   loadBestLandings(cond)          → Promise<Ranking>   optional: best landing of each site, computed by the server with
//                                                       planner/src/ranking.js (the same shape as its bestLandings())
//
// LightMap: { radiusKm, spacingKm, points: [{ lat, lon, x, y, sun, earth, nightHours, terrain }] }, sun and earth in 0–1,
//   x and y in km east and north of the centre (at the pole, towards 90°E and towards the Earth).
//   request: { lat, lon (centre; the south pole if absent), radiusKm, spacingKm, fromMs, days, panelHeightM?, antennaHeightM? }
// Energy: { energy (0–1), panel, factor, horizonModel }, the mean of the visible fraction of the solar disc × the factor of
//   the panel orientation (engine/panel.js). request: { lat, lon, fromMs, days (≥ 1), panel, panelHeightM?, antennaHeightM? }
// Slope: { slopeDeg, baselineM, certified, meets (true | false | null), source }, meets = below 10° over 100 m (Artemis crewed landing).
// The simulated engine has none of them: without them the views say the data needs the API.
//
// Sky (what the shared charts draw; it decides nothing, the verdicts come from the windows):
//   {
//     series: [{ sun: { az, el, horizon, margin }, earth: { … } }, …],   one per hour, from fromMs
//     horizon: { mask: Float32Array(360), heightM },                       terrain horizon by azimuth; heightM null if unknown
//   }
//
// Relief (what the 3D sky draws, common/sky3d-geometry.js; null if the source has no terrain heights for the site):
//   {
//     azimuthStepDeg, distancesKm: [...],         rings around the site, the nearest first
//     tan: Float32Array(rings × azimuths),        tangent of the apparent elevation of the terrain seen from the observer,
//                                                 tan[j · nAz + k] at distancesKm[j] along azimuth k · azimuthStepDeg (NaN = no data)
//     source: 'lola' | 'simulated',
//   }
//
// site: a catalogue site from ../engine/catalog.js ({ id, name, lat, lon, … }).
//
// heights: { panelHeightM, antennaHeightM }, metres over the ground (issue #66). The Sun is seen from the solar panel and
//   the Earth from the antenna, each over its own terrain horizon. Absent: DEFAULT_HEIGHT_M for both. loadBestLandings
//   and loadLightMap take the same two fields in their request. Only the data API uses them, and only where it has
//   terrain; the simulated engine ignores them and the views say so (heightsEffect() of the mission service).
//
// Windows (the shape planner/src/rules.js works with):
//   {
//     site: { id, name, latDeg, lonDeg, horizonModel },   horizonModel 'sphere' marks data without terrain
//     startMs, endMs,                                      period covered by the data
//     sun:   [[startMs, endMs], …],                         Sun visible over the terrain (sorted, no overlaps)
//     earth: [[startMs, endMs], …],                         Earth visible over the terrain
//     sunAndEarth: [[startMs, endMs], …],                   both at once
//     horizonBand: { deg, raised: { sun, earth, sunAndEarth }, lowered: { … } },   optional: the same windows with the
//                                                           horizon raised and lowered `deg` degrees (robustness band)
//   }

/** Checks that an object can be used as a visibility adapter; throws if not. */
export function assertVisibilityPort(adapter) {
  if (typeof adapter?.loadWindows !== 'function') throw new Error('The visibility adapter must provide loadWindows(site, fromMs, toMs)');
  return adapter;
}

/** Height of the panel and of the antenna when the mission does not set them: the default observer of the data API. */
export const DEFAULT_HEIGHT_M = 2;

/**
 * Ranges the data API accepts (C0 of #252): outside them it answers 400 (data/src/v1.ts). `routes` is shown to the user
 * inside the C0 source in either language, so it holds only paths and parameters (no words). One place for the web: Plan
 * blocks the search outside them (web/js/engine/coherence.js) instead of trimming the values in silence.
 */
export const API_LIMITS = {
  days: { min: 0.5, max: 30, routes: '/v1/best-landings, /v1/light-map' },
  batteryHours: { min: 0, max: 720, routes: '/v1/best-landings' },
  minEarthPct: { min: 0, max: 100, routes: '/v1/best-landings' },
  maxEarthGapHours: { min: 0, max: 720, routes: '/v1/best-landings' },
  panelHeightM: { min: 0, max: 100, routes: 'terrain=1: /v1/windows, /v1/best-landings, /v1/light-map' },
  antennaHeightM: { min: 0, max: 100, routes: 'terrain=1: /v1/windows, /v1/best-landings, /v1/light-map' },
};
export const MAX_HEIGHT_M = API_LIMITS.panelHeightM.max; // limit of the data API

/** A height typed by the user → metres within the limits of the API; the default if it is empty or not a number.
 * Plan never gets here with a height out of range (it blocks the search, #252); the clamp only guards other callers. */
export function parseHeight(value) {
  const n = typeof value === 'number' ? value : String(value ?? '').trim() === '' ? NaN : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_HEIGHT_M, n)) : DEFAULT_HEIGHT_M;
}

/** The two heights of anything that carries them (a mission, a search, a range), with the defaults filled in. */
export const heightsOf = (x) => ({ panelHeightM: parseHeight(x?.panelHeightM), antennaHeightM: parseHeight(x?.antennaHeightM) });

/** Cache key of the heights: data computed with other heights is other data. */
export const heightsKey = (x) => { const h = heightsOf(x); return `${h.panelHeightM}|${h.antennaHeightM}`; };

/** Catalogue site → the site shape of the domain. */
export const toDomainSite = (s, horizonModel = 'simulated-terrain') => ({ id: s.id, name: s.name, latDeg: s.lat, lonDeg: s.lon, horizonModel });
