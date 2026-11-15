// Visibility adapter over the data API v1 (/v1/windows, see data/openapi.yaml), through planner/src/api.js.
// The panel and antenna heights of the mission go to the API as panelHeightM and antennaHeightM (API 1.6, issue #66).
// It asks for terrain (terrain=1): if the server has no LOLA mask for the point, the API answers with the spherical
// horizon and the site keeps horizonModel 'sphere', so planner adds its "no terrain" warning.
// The energy of the solar panel (#254) comes from /v1/rank with its `panel` orientation (loadEnergy).
// It also asks for the horizon robustness band (horizonBandDeg, API 1.18): the same windows with the horizon raised
// and lowered, from which the mission service gives the range of the key figures. With { dsn: true } it also asks for
// the DSN mode (dsn=1, API 1.24, #103): `earthDsn`, the Earth visible while some DSN station has the Moon above 10°.
import { loadWindows, health, DEFAULT_API } from '../../../planner/src/api.js';
import { intersect } from '../../../planner/src/intervals.js';
import { toDomainSite, heightsOf } from '../ports/visibility.js';
import { SAFE_SLOPE_DEG } from '../../../planner/src/ranking.js';
import { t } from '../common/i18n.js';

const DAY_MS = 864e5;
const MOON_RADIUS_M = 1737400;
const RELIEF_SINCE = [1, 19]; // /v1/horizon?relief=1
const MAX_REQUEST_MS = 366 * DAY_MS; // limit of /v1/windows: longer ranges are requested in pieces
export const HORIZON_BAND_DEG = 0.3; // how far the horizon is moved up and down for the robustness band

/** Joins lists of sorted intervals, merging the ones that touch where two requests meet. */
function join(lists) {
  const out = [];
  for (const [start, end] of lists.flat()) {
    const last = out.at(-1);
    if (last && last[1] === start) last[1] = end; else out.push([start, end]);
  }
  return out;
}

async function getJson(baseUrl, path, query) {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  // `code` is the machine-readable error of the API (data/openapi.yaml): the 3D viewer shows its own text by it (E10.2).
  if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? t('common.api.status', { status: res.status, path })), { code: body?.error?.code ?? `http_${res.status}` });
  return body;
}

export function apiVisibility({ baseUrl = DEFAULT_API, terrain = true, observerHeightM, horizonBandDeg = HORIZON_BAND_DEG } = {}) {
  let version = null; // promise of the API version, asked once
  const hasRelief = async () => {
    version ??= health(baseUrl).then(h => String(h.apiVersion ?? '0.0').split('.').map(Number), () => [0, 0]);
    const [major, minor] = await version;
    return major > RELIEF_SINCE[0] || (major === RELIEF_SINCE[0] && minor >= RELIEF_SINCE[1]);
  };
  // Panel (Sun) and antenna (Earth) heights of a request, only if the caller gives them: without them the API uses
  // observerHeightM for both, as before issue #66.
  const heightParams = h => (h ? heightsOf(h) : {});
  return {
    baseUrl,
    /** Resolves if the API answers /v1/health within `timeoutMs`; rejects otherwise. */
    async check(timeoutMs = 2500) {
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(t('common.api.down', { url: baseUrl }))), timeoutMs); });
      try { return await Promise.race([health(baseUrl), timeout]); } finally { clearTimeout(timer); }
    },
    /**
     * Hour-by-hour sky over the terrain horizon: /v1/track and /v1/horizon (API 1.2 or later). Each body has `margin`, the
     * margin of the disc centre over the horizon, and `fullMargin`, the margin of its lower edge (the `full` criterion of
     * the windows, #192): it needs `angularRadiusDeg` (API 1.22); with an older API it is `margin`.
     */
    async loadSky(site, fromMs, toMs, heights) {
      const where = { lat: site.lat, lon: site.lon };
      // /v1/track gives each body its own horizon (the panel's for the Sun, the antenna's for the Earth). The silhouette
      // drawn under them is one: the horizon from the panel, the one that decides the energy.
      const [track, h] = await Promise.all([
        getJson(baseUrl, '/v1/track', { ...where, start: new Date(fromMs).toISOString(), end: new Date(toMs).toISOString(), step: '1h', ...(terrain ? { terrain: 1, observerHeightM, ...heightParams(heights) } : {}) }),
        getJson(baseUrl, '/v1/horizon', { ...where, observerHeightM: heights ? heightsOf(heights).panelHeightM : observerHeightM }),
      ]);
      const at = (b, i) => {
        const margin = b.elevationDeg[i] - b.horizonElevationDeg[i], radius = b.angularRadiusDeg?.[i] ?? 0;
        return { az: b.azimuthDeg[i], el: b.elevationDeg[i], horizon: b.horizonElevationDeg[i], margin, radius, fullMargin: margin - radius };
      };
      const n = h.elevationDeg.length, mask = new Float32Array(360);
      for (let a = 0; a < 360; a++) mask[a] = terrain ? h.elevationDeg[Math.round(a / h.azimuthStepDeg) % n] : 0;
      return { series: track.times.map((_, i) => ({ sun: at(track.sun, i), earth: at(track.earth, i) })), horizon: { mask, heightM: terrain ? h.groundHeightM : null } };
    },
    /**
     * Terrain around the site, only to draw the 3D sky: /v1/horizon?relief=1 (API 1.19), the LOLA heights on rings
     * along the great circles of the horizon mask, turned into apparent elevations with the formula of the mask.
     * null if the API is older, terrain is off or the server has no DEM at the point (then only the mask is drawn).
     */
    async loadRelief(site) {
      if (!terrain || !(await hasRelief())) return null;
      const h = await getJson(baseUrl, '/v1/horizon', { lat: site.lat, lon: site.lon, observerHeightM, relief: 1 });
      const r = h.relief;
      if (!r) return null;
      const nAz = Math.round(360 / r.azimuthStepDeg), r0 = MOON_RADIUS_M + r.groundHeightM + h.terrain.observerHeightM;
      const tan = new Float32Array(r.distancesM.length * nAz).fill(NaN);
      r.distancesM.forEach((d, j) => {
        const de = d / MOON_RADIUS_M, cd = Math.cos(de), sd = Math.sin(de);
        r.heightsM[j].forEach((z, k) => { if (z !== null) tan[j * nAz + k] = ((MOON_RADIUS_M + z) * cd - r0) / ((MOON_RADIUS_M + z) * sd); });
      });
      return { azimuthStepDeg: r.azimuthStepDeg, distancesKm: r.distancesM.map(d => d / 1000), tan, source: 'lola' };
    },
    /** Share of [fromMs, fromMs + days] with the Sun and the Earth around a point, over the LOLA terrain: /v1/light-map (API 1.13). */
    async loadLightMap({ lat, lon, radiusKm, spacingKm, fromMs, days, panelHeightM, antennaHeightM }) {
      const heights = panelHeightM !== undefined || antennaHeightM !== undefined ? { panelHeightM, antennaHeightM } : null;
      const r = await getJson(baseUrl, '/v1/light-map', {
        ...(lat != null ? { lat, lon } : {}), radiusKm, spacingKm, start: new Date(fromMs).toISOString(), days, mode: 'full', observerHeightM, ...heightParams(heights),
      });
      const p = r.points;
      return {
        radiusKm: r.radiusKm, spacingKm: r.spacingKm, note: r.terrain.note,
        points: p.latDeg.map((la, i) => ({ lat: la, lon: p.lonDeg[i], x: p.xKm[i], y: p.yKm[i], sun: p.sunTimeFraction[i], earth: p.earthTimeFraction[i], nightHours: p.longestNightHours[i], terrain: p.withTerrain[i] })),
      };
    },
    /** Terrain slope at the site over 100 m (the Artemis crewed landing asks for less than 10°): /v1/sun-earth with slope (API 1.7). */
    async loadSlope(site) {
      const r = await getJson(baseUrl, '/v1/sun-earth', { lat: site.lat, lon: site.lon, slope: 1, maxSlopeDeg: 10 });
      const s = r.slope;
      return { slopeDeg: s.slopeDeg, baselineM: s.slopeBaselineM, certified: !s.underestimated, meets: s.meetsMaxSlope ?? null, source: s.source };
    },
    /**
     * Energy the solar panel gets over a mission (#254): `meanSunDiskFraction` of /v1/rank (API 1.4) for one point, from
     * the landing, with the panel orientation (`tracking`, `vertical-rotating`, `horizontal`) and the heights of the
     * mission. The mean, over the samples, of the visible fraction of the solar disc × the factor of the panel (0–1).
     * The API asks for whole days or more: 1 day at least (Plan does not ask for less).
     */
    async loadEnergy({ lat, lon, fromMs, days, panel = 'tracking', panelHeightM, antennaHeightM }) {
      const heights = panelHeightM !== undefined || antennaHeightM !== undefined ? { panelHeightM, antennaHeightM } : null;
      const r = await getJson(baseUrl, '/v1/rank', {
        sites: `${lat}:${lon}`, start: new Date(fromMs).toISOString(), days, panel,
        ...(terrain ? { terrain: 1, observerHeightM, ...heightParams(heights) } : {}),
      });
      const res = r.results[0];
      return { energy: res.metrics.meanSunDiskFraction, panel, factor: r.panel?.factor ?? '1', horizonModel: res.horizonModel ?? 'sphere' };
    },
    /**
     * The best landing of each site in a window, ordered, computed by the server with planner/src/ranking.js:
     * /v1/best-landings (API 1.15). Same shape as bestLandings() of that module, with each option's siteId being the
     * web site it answers (the API is asked by coordinates).
     */
    async loadBestLandings({ sites, from, to, days, batteryHours, minEarthPct, maxEarthGapHours, priority, panelHeightM, antennaHeightM }) {
      const heights = panelHeightM !== undefined || antennaHeightM !== undefined ? { panelHeightM, antennaHeightM } : null;
      const r = await getJson(baseUrl, '/v1/best-landings', {
        sites: [...new Set(sites.map(s => `${s.lat}:${s.lon}`))].join(','), start: new Date(from).toISOString(), end: new Date(to).toISOString(),
        days, batteryHours, minEarthPct, ...(Number.isFinite(maxEarthGapHours) ? { maxEarthGapHours } : {}), priority, mode: 'full',
        ...(terrain ? { terrain: 1, observerHeightM, ...heightParams(heights) } : {}),
      });
      const same = (a, b) => Math.abs(a - b) < 1e-6;
      const ms = iso => (iso === null ? null : Date.parse(iso));
      const toOption = (o, site) => {
        const m = o.metrics;
        return {
          siteId: site.id, landing: ms(o.landing), verdict: o.verdict, reason: o.reason, trace: o.trace, reasons: o.reasons,
          score: o.score / 50, parts: o.scoreParts,
          metrics: m ? {
            noData: false, sunAtLanding: m.sunAtLanding, earthAtLanding: m.earthAtLanding,
            longestShadowHours: m.longestShadowHours, longestEarthOutageHours: m.longestEarthOutageHours,
            sunFraction: m.sunTimeFraction, earthFraction: m.earthTimeFraction, sunAndEarthFraction: m.sunAndEarthTimeFraction,
            sunlightAfterLandingHours: m.sunlightAfterLandingHours, earthAfterLandingHours: m.earthAfterLandingHours,
          } : { noData: true },
          robustness: { maxDelayDays: o.robustness.maxDelayDays, nextWindow: ms(o.robustness.nextWindow) },
          viableInWindow: o.viableInWindow,
          landings: o.landings.map(k => ({ t: ms(k.landing), verdict: k.verdict, reason: k.reason, streak: k.streak })),
        };
      };
      // The server answers each place once: two sites on the same coordinates (a point typed on a catalogue site, #101)
      // get the same option, one after the other.
      return {
        stepHours: r.stepHours, tested: r.tested,
        options: r.options.flatMap(o => {
          const here = sites.filter(s => same(s.lat, o.latDeg) && same(((s.lon + 540) % 360) - 180, o.lonDeg));
          if (!here.length) throw new Error(t('common.api.unknownSite', { lat: o.latDeg, lon: o.lonDeg }));
          return here.map(site => toOption(o, site));
        }),
      };
    },
    // The horizon band costs one more pass per request (much more cold, with the DEM): it is asked only with { band: true },
    // which only the windows of Plan and Advanced need (they show the range). The same for the DSN mode ({ dsn: true }).
    async loadWindows(site, fromMs, toMs, heights, { band: withBand = false, dsn = false } = {}) {
      const pieces = [];
      for (let start = fromMs; start < toMs; start += MAX_REQUEST_MS) {
        // Catalogue ids of web/ and of the API differ: ask by coordinates.
        pieces.push(await loadWindows({
          baseUrl, site: { lat: site.lat, lon: site.lon },
          start: new Date(start).toISOString(), end: new Date(Math.min(start + MAX_REQUEST_MS, toMs)).toISOString(),
          terrain, observerHeightM, maxSlopeDeg: SAFE_SLOPE_DEG, // the slope for R9 (it depends only on the place)
          ...(withBand ? { horizonBandDeg } : {}), ...(dsn ? { dsn: true } : {}), ...heightParams(heights),
        }));
      }
      const joined = of => { const sun = join(pieces.map(p => of(p).sun)), earth = join(pieces.map(p => of(p).earth)); return { sun, earth, sunAndEarth: intersect(sun, earth) }; };
      const band = pieces.every(p => p.horizonBand)
        ? { horizonBand: { deg: pieces[0].horizonBand.deg, raised: joined(p => p.horizonBand.raised), lowered: joined(p => p.horizonBand.lowered) } } : {};
      const earthDsn = pieces.every(p => p.earthDsn) ? { earthDsn: join(pieces.map(p => p.earthDsn)) } : {};
      return { ...pieces[0], site: toDomainSite(site, pieces[0].site.horizonModel), startMs: fromMs, endMs: toMs, ...joined(p => p), ...band, ...earthDsn };
    },
  };
}
