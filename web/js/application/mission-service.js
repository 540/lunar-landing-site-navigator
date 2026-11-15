// Application service of "Planificar" and "Avanzado" (docs/adr/0001-arquitectura-hexagonal.md).
// Same scheme as replan-service.js: it loads the Sun and Earth visibility windows once through the visibility port
// (the same adapter Replan uses: data API with LOLA terrain, or the simulated engine) and then answers synchronously
// with the domain rules of planner/src/rules.js. So the three views give the same verdict for the same landing.
//
// What it answers, all from the windows:
//   judge(site, t, mission)       verdict and metrics of one landing, in the shapes the web views already paint
//   band(site, t, mission)        range of the key figures of that landing if the horizon is 0.3° higher or lower
//   earthDsn(site, t, mission)    % of the mission with the Earth visible AND a DSN antenna with the Moon above 10°
//                                 (only with the API, #103); it only informs, no rule uses it
//   search(cond)                  the best landing of each site in a window: /v1/best-landings with the API, the same
//                                 planner/src/ranking.js in the browser without it (async)
//   landingDays(…)                the landing calendar of Plan
//   visibleHours(site, from, n)   Sun / Earth visible hour by hour (the landing timeline)
//   visibleAt(site, t)            Sun / Earth visible at an instant
//   untilChange(site, t)          how long until the Sun / Earth sets (or rises), from the same windows
//   nextViable(site, from, …)     first viable landing after a date
//   delayMargin(site, t, mission) how much delay a landing takes before it breaks (the same margin as Replan)
//   launch(t, mission)            the launch date of a landing, with the transit the profile assumes
//   scenario(site, t, mission)    one scenario of the comparison: any site or point on its own landing date (async)
//   compareScenarios(list)        the figures of several scenarios row by row, with the best of each row
//   around(site, t, mission, km)  the same landing on a ring of points around the site (async)
//   point(site, t, mission)       any point opened as a site of its own, with its own windows: verdict, figures, band
//                                 and margin; from then on visibleAt, visibleHours and horizonModel answer for it (async)
//   timeline(site, t, mission)    the mission step by step with its battery (missionTimeline, the same as Replan)
//   energy(site, t, days, panel)  the energy the solar panel gets with its orientation (#254), only with the API (async)
// And, only to draw (it decides nothing): sky(site, t0, days), the hour-by-hour Sun and Earth over the horizon, and
// relief(site), the terrain around the site for the 3D sky.
//
// Panel and antenna heights (issue #66): a range may carry { panelHeightM, antennaHeightM }. The windows are loaded for
// those heights and a range with other heights is not ready: it loads again. The sky, the light map and the points
// around a site are asked with the heights of the loaded windows, so everything on screen is the same spacecraft.
import { evaluate as evaluateLanding, VERDICT, launchDate } from '../../../planner/src/rules.js';
import { clip, containing, nextAfter, totalMs } from '../../../planner/src/intervals.js';
import { bestLandings, describe, missionProfile } from '../../../planner/src/ranking.js';
import { assertVisibilityPort, heightsOf, heightsKey } from '../ports/visibility.js';
import { marginDays as domainMarginDays, MARGIN_CAP_DAYS, missionTimeline } from '../../../planner/src/replan.js';
import { t } from '../common/i18n.js';

const DAY_MS = 864e5, HOUR_MS = 36e5;
const PAD_DAYS = 15;        // extra days loaded on each side, so small changes to the dates do not reload
const MAX_LOAD_DAYS = 366;  // limit of /v1/windows
const CODE = { [VERDICT.VIABLE]: 'viable', [VERDICT.MARGINAL]: 'marginal', [VERDICT.NOT_VIABLE]: 'not_viable', [VERDICT.NO_DATA]: 'not_viable' };
const TITLE = { viable: t('common.verdict.viable'), marginal: t('common.verdict.marginal'), not_viable: t('common.verdict.not_viable') };

/** Web mission { days, batteryHours, minEarthPct, maxEarthGapHours, transitDays } → cache key of its domain profile. */
const missionKey = m => `${m.days}|${m.batteryHours}|${m.minEarthPct}|${m.maxEarthGapHours}|${m.transitDays}`;

/** Planner metrics of a mission → the result fields the web views use (engine/model.js shapes). */
function toResult(m, t, days) {
  if (!m || m.noData) return { t0: t, days, noData: true, series: [], maxDarkHours: 0, maxNoEarthHours: 0, longestShadowStart: null, longestEarthOutageStart: null, pctSun: 0, pctEarth: 0, sunAtLanding: false, earthAtLanding: false, hoursSun: 0, hoursEarth: 0, sunPersists: false, earthPersists: false };
  const total = days * 24;
  return {
    t0: t, days, series: [],
    maxDarkHours: m.longestShadowHours, maxNoEarthHours: m.longestEarthOutageHours,
    // Start (ms) of the longest shadow and of the longest Earth outage, null when there is none (the 3D viewer jumps there).
    longestShadowStart: m.longestShadowStart ? Date.parse(m.longestShadowStart) : null,
    longestEarthOutageStart: m.longestEarthOutageStart ? Date.parse(m.longestEarthOutageStart) : null,
    pctSun: 100 * m.sunFraction, pctEarth: 100 * m.earthFraction,
    sunAtLanding: m.sunAtLanding, earthAtLanding: m.earthAtLanding,
    hoursSun: Math.min(total, m.sunlightAfterLandingHours), sunPersists: m.sunlightAfterLandingHours >= total,
    hoursEarth: Math.min(total, m.earthAfterLandingHours), earthPersists: m.earthAfterLandingHours >= total,
  };
}
const toVerdict = ({ verdict, reason, trace }) => { const code = CODE[verdict]; return { code, title: TITLE[code], reason, trace }; };

/** Planner evaluation → { r, verdict } with the fields the web views use. */
function toWeb(e, t, days) {
  return { r: toResult(e.metrics, t, days), verdict: toVerdict(describe(e)) };
}

/** Option of planner/src/ranking.js (or of /v1/best-landings, through the adapter) → the option the views paint. */
function toOption(o, site, days) {
  return {
    site,
    landing: o.landing,
    result: toResult(o.metrics, o.landing, days),
    verdict: toVerdict(o),
    score: o.score,
    parts: { e: o.parts.energy, c: o.parts.comms, a: o.parts.early, r: o.parts.delays },
    robustness: o.robustness,
    reasons: o.reasons,
    viableInWindow: o.viableInWindow,
    landings: o.landings.map(k => ({ t: k.t, code: CODE[k.verdict], reason: k.reason, streak: k.streak })),
  };
}

/**
 * What the interface says about the panel and antenna heights, by heightsEffect() of the service: whether they change
 * the figures or the data source ignores them. `short` is the one-clause version for a summary line.
 */
export function describeHeights(effect, { short = false } = {}) {
  if (effect === 'simulated') return t(short ? 'common.heights.simulatedShort' : 'common.heights.simulated');
  if (effect === 'no-terrain') return t(short ? 'common.heights.noTerrainShort' : 'common.heights.noTerrain');
  if (effect === 'applied') return short ? '' : t('common.heights.applied');
  return '';
}

/**
 * The rows of the scenario comparison, in order. `better` says which way each figure is better, so the views do not
 * decide it: the verdict by its severity, the Sun and the Earth by more time, the night and the Earth gap by less.
 */
const VERDICT_RANK = { viable: 2, marginal: 1, not_viable: 0 };
export const SCENARIO_ROWS = [
  { id: 'verdict', better: 'higher', value: e => VERDICT_RANK[e.verdict.code] },
  { id: 'sun', better: 'higher', value: e => e.r.pctSun },
  { id: 'earth', better: 'higher', value: e => e.r.pctEarth },
  { id: 'night', better: 'lower', value: e => e.r.maxDarkHours },
  { id: 'earthGap', better: 'lower', value: e => e.r.maxNoEarthHours },
];
// Two figures closer than this are the same on screen (whole percentages, tenths of an hour): they tie.
const TIE = 0.05;

/**
 * Several scenarios side by side. `list` holds, per scenario, what scenario() resolves with ({ r, verdict }) or null
 * if it is not known yet (loading, failed). Returns one row per figure: { id, better, values, best } where values[i]
 * is the figure of scenario i (null without data) and best[i] says if it is the best of the row. Ties share the mark;
 * a row where every scenario with data ties, or with fewer than two, marks none: there is nothing to choose.
 */
export function compareScenarios(list) {
  return SCENARIO_ROWS.map(({ id, better, value }) => {
    const values = list.map(e => (e && !e.r.noData ? value(e) : null));
    const known = values.filter(v => v !== null);
    const top = better === 'higher' ? Math.max(...known) : Math.min(...known);
    const isBest = v => v !== null && Math.abs(v - top) <= TIE;
    const decides = known.length >= 2 && !known.every(isBest);
    return { id, better, values, best: values.map(v => decides && isBest(v)) };
  });
}

const MOON_RADIUS_KM = 1737.4, RAD = Math.PI / 180;

/**
 * `count` points on a circle of `radiusKm` around a site, starting north and going clockwise (east is 90°).
 * Destination point on the sphere: exact also next to the pole, where the sites are.
 */
export function ringAround(site, radiusKm, count = 8) {
  const d = radiusKm / MOON_RADIUS_KM, la = site.lat * RAD, lo = site.lon * RAD;
  return Array.from({ length: count }, (_, k) => {
    const bearingDeg = (360 * k) / count, b = bearingDeg * RAD;
    const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lon = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
    return { bearingDeg, lat: lat / RAD, lon: ((lon / RAD + 540) % 360) - 180 };
  });
}

/**
 * `sites`: the sites to load, or a function that gives them (Plan adds the point the user types, #101). A site that
 * joins after the windows are loaded is loaded alone, over the same period: the rest are not asked again.
 */
export function createMissionService({ visibility, sites }) {
  assertVisibilityPort(visibility);
  const siteList = typeof sites === 'function' ? sites : () => sites;
  let windowsBySite = {}, loaded = null, pending = null, source = null;
  const profiles = new Map(), skies = new Map(), reliefs = new Map(), arounds = new Map(), lightMaps = new Map(), slopes = new Map(), energies = new Map(), scenarios = new Map(), joining = new Map();
  // Windows of the points opened with point(), outside the catalogue: site id → { key, w }. The last one asked for an id wins.
  const points = new Map(), own = new Map();
  const windowsOf = id => windowsBySite[id] ?? own.get(id)?.w;
  /** Promise cache: the same request is asked once; a failed one is asked again next time. */
  const cached = (map, key, load) => {
    if (!map.has(key)) {
      if (map.size > 40) map.clear();
      const p = load();
      p.catch(() => map.delete(key));
      map.set(key, p);
    }
    return map.get(key);
  };
  const needsApi = what => Promise.reject(new Error(t('common.needsApi', { what })));
  const spans = r => !!loaded && loaded.fromMs <= r.fromMs && loaded.toMs >= r.toMs && loaded.heights === heightsKey(r);
  const covers = r => spans(r) && siteList().every(s => windowsBySite[s.id]);
  /** Heights of the loaded windows: what the sky, the light map and the points around a site are asked with. */
  const loadedHeights = () => { const [panelHeightM, antennaHeightM] = (loaded?.heights ?? heightsKey()).split('|').map(Number); return { panelHeightM, antennaHeightM }; };
  /** Loads the sites that joined after the last load, over the loaded period. */
  function join(newSites) {
    const at = loaded, heights = loadedHeights();
    return Promise.all(newSites.map(s => {
      const key = `${s.id}|${at.fromMs}|${at.toMs}|${at.heights}`; // only while it loads: a later reload may drop the site
      if (!joining.has(key)) {
        joining.set(key, visibility.loadWindows(s, at.fromMs, at.toMs, heights, { band: true, dsn: true })
          .then(w => { if (loaded === at) windowsBySite[s.id] = w; }).finally(() => joining.delete(key)));
      }
      return joining.get(key);
    }));
  }
  const profileOf = m => { const k = missionKey(m); if (!profiles.has(k)) profiles.set(k, missionProfile(m)); return profiles.get(k); };

  function judge(site, t, mission) {
    const w = windowsBySite[site.id];
    if (!w) return toWeb({ verdict: VERDICT.NO_DATA, metrics: { noData: true }, rules: [] }, t, mission.days);
    return toWeb(evaluateLanding(w, profileOf(mission), t), t, mission.days);
  }

  /** Whether the API warned that these windows are south of 85°S, where the figures are less reliable (#437). */
  const deepPolarOf = w => (w?.apiWarnings ?? []).some(x => x.code === 'deep_polar_uncertainty');

  /**
   * % of [t, t + days] with the Earth visible from the site and the Moon above 10° at some DSN station (windows.earthDsn,
   * /v1/windows?dsn=1, #103). null without it (simulated engine, older API) or if the windows do not cover the mission.
   */
  function earthDsnOf(w, t, days) {
    const end = t + days * DAY_MS;
    if (!w?.earthDsn || t < w.startMs || end > w.endMs || !(end > t)) return null;
    return 100 * totalMs(clip(w.earthDsn, t, end)) / (end - t);
  }

  function bandOf(w, t, mission) {
    const b = w?.horizonBand;
    if (!b) return null;
    const all = [w, { ...w, ...b.raised }, { ...w, ...b.lowered }].map(v => evaluateLanding(v, profileOf(mission), t).metrics);
    if (all.some(m => !m || m.noData)) return null;
    const range = of => ({ min: Math.min(...all.map(of)), max: Math.max(...all.map(of)) });
    return { deg: b.deg, pctSun: range(m => 100 * m.sunFraction), pctEarth: range(m => 100 * m.earthFraction), maxDarkHours: range(m => m.longestShadowHours) };
  }

  const service = {
    get sites() { return siteList(); },
    /** 'api' (data API with LOLA terrain) | 'fake' (simulated engine) | null before the first load. */
    get source() { return source; },
    /** Horizon model of the loaded windows of a site: 'mask' (LOLA), 'sphere' (no terrain) or 'simulated-terrain'. */
    horizonModel: id => windowsOf(id)?.site.horizonModel ?? null,
    isReady: covers,
    /** Panel and antenna heights the loaded windows were computed for: { panelHeightM, antennaHeightM }. */
    get heights() { return loadedHeights(); },
    /**
     * Whether the heights change the figures on screen: 'applied' (data API with terrain), 'no-terrain' (data API but no
     * site has the LOLA terrain: over a smooth sphere the API ignores them), 'simulated' (the simulated engine ignores
     * them) or null before the first load.
     */
    heightsEffect() {
      if (!loaded) return null;
      if (source !== 'api') return 'simulated';
      return Object.values(windowsBySite).some(w => w.site.horizonModel === 'mask') ? 'applied' : 'no-terrain';
    },

    /**
     * Loads (once) the windows of every site for the range, { fromMs, toMs, panelHeightM?, antennaHeightM? }.
     * Resolves when they are ready.
     */
    prepare(range) {
      if (covers(range)) return Promise.resolve();
      if (spans(range)) return join(siteList().filter(s => !windowsBySite[s.id])).then(() => {});
      const heights = heightsOf(range), key = heightsKey(range);
      let want = { fromMs: range.fromMs - PAD_DAYS * DAY_MS, toMs: range.toMs + PAD_DAYS * DAY_MS, heights: key };
      // Keep what was loaded if both fit in one request: Plan's calendar and the search ask for different months.
      if (loaded && loaded.heights === key) {
        const hull = { fromMs: Math.min(want.fromMs, loaded.fromMs), toMs: Math.max(want.toMs, loaded.toMs), heights: key };
        if (hull.toMs - hull.fromMs <= MAX_LOAD_DAYS * DAY_MS) want = hull;
      }
      want.toMs = Math.min(want.toMs, want.fromMs + MAX_LOAD_DAYS * DAY_MS);
      if (pending && pending.range.heights === key && pending.range.fromMs <= range.fromMs && pending.range.toMs >= range.toMs) return pending.promise;
      const promise = Promise.all(siteList().map(async s => [s.id, await visibility.loadWindows(s, want.fromMs, want.toMs, heights, { band: true, dsn: true })]))
        .then(async entries => { windowsBySite = Object.fromEntries(entries); loaded = want; source = (await visibility.source?.()) ?? null; })
        .finally(() => { if (pending?.promise === promise) pending = null; });
      pending = { range: want, promise };
      return promise;
    },

    judge,

    /**
     * Robustness band of the horizon for one landing: the key figures judged again over the windows with the horizon
     * raised and lowered (windows.horizonBand, only with the API) and the smallest and largest value of each over the
     * three horizons: { deg, pctSun: { min, max }, pctEarth, maxDarkHours }. null without the band or without data.
     */
    band: (site, t, mission) => bandOf(windowsBySite[site.id], t, mission),

    /**
     * Earth visible with a DSN antenna available (#103): % of the mission with the Earth visible from the site and the
     * Moon above 10° at Goldstone, Madrid or Canberra. null without the data API. It does not change the verdict.
     */
    earthDsn: (site, t, mission) => earthDsnOf(windowsOf(site.id), t, mission.days),

    /**
     * Whether the figures of a site come with the deep polar warning of the API (`deep_polar_uncertainty`, #437):
     * terrain applied south of 85°S. Only informs. Always false with the simulated engine (no API, no warning).
     */
    deepPolar: site => deepPolarOf(windowsBySite[site.id]),

    /**
     * The best landing of each site in [cond.from, cond.to] and the sites ordered (planner/src/ranking.js). With the API,
     * the server answers it (/v1/best-landings); without it, or if that route fails, the browser runs the same code over
     * the loaded windows. Adds source, ranked ('api' | 'browser'), judge(site, t) and marginDays(site, t).
     */
    async search(cond) {
      // The heights are not part of the mission rules: they are in the windows, loaded for them (prepare).
      const mission = { days: cond.days, batteryHours: cond.batteryHours, minEarthPct: cond.minEarthPct, maxEarthGapHours: cond.maxEarthGapHours };
      const margin = (s, t) => (windowsBySite[s.id] ? domainMarginDays(windowsBySite[s.id], profileOf(mission), t).days : 0);
      const local = () => bestLandings({ windowsBySite, sites: cond.sites, from: cond.from, to: cond.to, mission, priority: cond.priority });
      let res, ranked = 'browser';
      if (source === 'api' && visibility.loadBestLandings) {
        try { res = await visibility.loadBestLandings({ ...cond, ...loadedHeights() }); ranked = 'api'; }
        catch (err) { console.warn(`/v1/best-landings no responde (${err.message}): el orden se calcula en el navegador, con el mismo código.`); }
      }
      res ??= local();
      const byId = new Map(cond.sites.map(s => [s.id, s]));
      const options = res.options.map(o => toOption(o, byId.get(o.siteId), cond.days));
      return { conditions: cond, best: options[0], options, tested: res.tested, stepHours: res.stepHours, source, ranked, judge: (s, t) => judge(s, t, mission), marginDays: margin };
    },

    /** Landing calendar: for every UTC day and site, a landing tried every `stepHours` and its verdict. */
    landingDays(daySites, mission, firstDay, nDays, stepHours = 6) {
      const out = [];
      for (let d = 0; d < nDays; d++) {
        const t = firstDay + d * DAY_MS, bySite = {};
        for (const s of daySites) {
          const slots = [];
          for (let h = 0; h < 24; h += stepHours) {
            const { verdict } = judge(s, t + h * HOUR_MS, mission);
            slots.push({ t: t + h * HOUR_MS, code: verdict.code, reason: verdict.reason, trace: verdict.trace });
          }
          const viable = slots.filter(x => x.code === 'viable').length, marginal = slots.filter(x => x.code === 'marginal').length;
          bySite[s.id] = { slots, viable, marginal, score: (viable + marginal / 2) / slots.length };
        }
        out.push({ t, bySite });
      }
      return out;
    },

    /** Sun and Earth visible at an instant (the same windows the verdicts use). */
    visibleAt(site, t) {
      const w = windowsOf(site.id);
      return w ? { sun: !!containing(w.sun, t), earth: !!containing(w.earth, t) } : null;
    },

    /**
     * How long until each body changes at `t`, from the same windows as the verdict (so it never contradicts
     * «luz» / «sombra»): { sun, earth }, each { visible, ms, atLeast }. `ms` is the time to its set (visible) or to its
     * rise (hidden), null if it does not rise in the loaded data; `atLeast` when the window reaches the end of the data.
     */
    untilChange(site, t) {
      const w = windowsBySite[site.id];
      if (!w || !loaded) return null;
      const end = loaded.toMs - HOUR_MS;
      const one = list => {
        const now = containing(list, t);
        if (now) return { visible: true, ms: now[1] - t, atLeast: now[1] >= end };
        const next = nextAfter(list, t);
        return next ? { visible: false, ms: next[0] - t, atLeast: false } : { visible: false, ms: Math.max(0, end - t), atLeast: true };
      };
      return { sun: one(w.sun), earth: one(w.earth) };
    },

    /** Sun and Earth visible each hour of [startMs, startMs + hours): two Uint8Arrays (the landing timeline). */
    visibleHours(site, startMs, hours) {
      const sun = new Uint8Array(hours), earth = new Uint8Array(hours), w = windowsOf(site.id);
      if (w) for (let h = 0; h < hours; h++) { const t = startMs + h * HOUR_MS; sun[h] = !!containing(w.sun, t); earth[h] = !!containing(w.earth, t); }
      return { sun, earth };
    },

    /**
     * How much delay a landing takes before it breaks: the domain's marginDays (planner/src/replan.js), the figure
     * Replan gives «Sin retraso» for the same plan. { days, open, viable }: `open` when it reaches the cap
     * (MARGIN_CAP_DAYS) without breaking. null while the windows it needs are not loaded.
     */
    delayMargin(site, t, mission) {
      const w = windowsBySite[site.id];
      if (!w || !covers({ fromMs: t, toMs: t + (MARGIN_CAP_DAYS + mission.days + 1) * DAY_MS })) return null;
      const profile = profileOf(mission);
      if (evaluateLanding(w, profile, t).verdict !== VERDICT.VIABLE) return { days: 0, open: false, viable: false };
      return { ...domainMarginDays(w, profile, t), viable: true };
    },

    /**
     * The mission step by step with Sun, Earth and battery: the domain's missionTimeline (planner/src/replan.js), the
     * one «▶ Simular la misión» of Replan uses, so both give the same figures. null while the windows are not loaded.
     */
    timeline(site, t, mission, stepMs = HOUR_MS) {
      const w = windowsBySite[site.id];
      if (!w || !covers({ fromMs: t, toMs: t + mission.days * DAY_MS })) return null;
      return { ...missionTimeline(w, t, mission.days * DAY_MS, mission.batteryHours, stepMs), stepMs };
    },

    /** Launch of a landing: the domain's launchDate with the transit of the profile (an assumption, not data). */
    launch(t, mission) {
      const profile = profileOf(mission);
      return { launchMs: Date.parse(launchDate(new Date(t).toISOString(), profile)), transitDays: profile.transitDays };
    },

    /** First viable landing from `fromMs`, every `stepHours`, within `maxDays`. null if none. */
    nextViable(site, fromMs, mission, maxDays = 60, stepHours = 12) {
      for (let t = fromMs; t <= fromMs + maxDays * DAY_MS; t += stepHours * HOUR_MS) {
        const j = judge(site, t, mission);
        if (j.verdict.code === 'viable') return { t, ...j };
        if (j.r.noData) break;
      }
      return null;
    },

    /**
     * Light map, only with the API: share of [t0, t0 + days] with the Sun (and the Earth) at the points of a disc around
     * `centre` (the south pole if null), over the LOLA terrain. A promise; the same map is asked once.
     */
    lightMap(centre, radiusKm, spacingKm, t0, days) {
      if (!visibility.loadLightMap || source !== 'api') return needsApi(t('common.needsApi.lightMap'));
      const heights = loadedHeights();
      const key = `${centre ? `${centre.lat}|${centre.lon}` : 'pole'}|${radiusKm}|${spacingKm}|${t0}|${days}|${heightsKey(heights)}`;
      return cached(lightMaps, key, () => visibility.loadLightMap({ ...(centre ? { lat: centre.lat, lon: centre.lon } : {}), radiusKm, spacingKm, fromMs: t0, days, ...heights }));
    },

    /**
     * Energy the solar panel gets over a mission (#254), only with the API (a promise): { energy (0–1), panel, factor,
     * horizonModel }, from the landing `t0` for `days`, with the heights of the loaded windows. It only informs: no
     * verdict depends on it. Missions shorter than 1 day are not computed (the limit of /v1/rank).
     */
    energy(site, t0, days, panel) {
      if (!visibility.loadEnergy || source !== 'api') return needsApi(t('common.needsApi.energy'));
      const heights = loadedHeights();
      const key = `${site.lat}|${site.lon}|${t0}|${days}|${panel}|${heightsKey(heights)}`;
      return cached(energies, key, () => visibility.loadEnergy({ lat: site.lat, lon: site.lon, fromMs: t0, days, panel, ...heights }));
    },

    /** Terrain slope at a site, only with the API (a promise). It does not depend on the date. */
    slope(site) {
      if (!visibility.loadSlope || source !== 'api') return needsApi(t('common.needsApi.slope'));
      return cached(slopes, `${site.lat}|${site.lon}`, () => visibility.loadSlope(site));
    },

    /**
     * One scenario of the comparison: `site` (one of the catalogue or any point, { id, name, lat, lon }) landing at `t`,
     * its own date. Same rules as judge(). A catalogue site inside the loaded period answers from the loaded windows
     * (the very same figures as the rest of the view); any other point or date loads its own windows through the port
     * (with the API, its own LOLA horizon). Resolves with { r, verdict, horizonModel }.
     */
    scenario(site, t, mission) {
      const endMs = t + mission.days * DAY_MS, w = windowsBySite[site.id];
      if (w && siteList().includes(site) && w.startMs <= t && w.endMs >= endMs) return Promise.resolve({ ...judge(site, t, mission), horizonModel: w.site.horizonModel ?? null });
      const heights = loadedHeights();
      const key = `${site.id}|${site.lat}|${site.lon}|${t}|${missionKey(mission)}|${source}|${heightsKey(heights)}`;
      return cached(scenarios, key, async () => {
        const own = await visibility.loadWindows(site, t - DAY_MS, endMs + DAY_MS, heights);
        return { ...toWeb(evaluateLanding(own, profileOf(mission), t), t, mission.days), horizonModel: own.site.horizonModel ?? null };
      });
    },

    /** The figures of several scenarios row by row, with the best of each row: see compareScenarios() above. */
    compareScenarios,

    /**
     * What if the lander comes down a little off the site? The same landing judged at `count` points on a circle of
     * `radiusKm` around it, each with its own windows (with the API, its own LOLA horizon). The site coordinates are
     * approximate and, on a ridge, a few hundred metres change the result: this says how much the verdict can be trusted.
     * Resolves with { radiusKm, points: [{ bearingDeg, lat, lon, code, reason }], viable }.
     */
    around(site, t, mission, radiusKm = 1, count = 8) {
      const heights = loadedHeights();
      const key = `${site.id}|${site.lat}|${site.lon}|${t}|${missionKey(mission)}|${radiusKm}|${count}|${source}|${heightsKey(heights)}`;
      if (!arounds.has(key)) {
        if (arounds.size > 40) arounds.clear();
        const fromMs = t - DAY_MS, toMs = t + (mission.days + 1) * DAY_MS;
        const p = Promise.all(ringAround(site, radiusKm, count).map(async (q, k) => {
          const w = await visibility.loadWindows({ ...q, id: `${site.id}~${k}`, name: `${site.name} (${q.bearingDeg}°)`, horizon: undefined }, fromMs, toMs, heights);
          const { verdict } = toWeb(evaluateLanding(w, profileOf(mission), t), t, mission.days);
          return { ...q, code: verdict.code, reason: verdict.reason };
        })).then(points => ({ radiusKm, points, viable: points.filter(x => x.code === 'viable').length }));
        p.catch(() => arounds.delete(key));
        arounds.set(key, p);
      }
      return arounds.get(key);
    },

    /**
     * Any point opened as a site of its own (one of the points around a site, issue #106): `site` is { id, name, lat,
     * lon } and lands at `t`. It loads the point's own windows through the port (with the API, its own LOLA horizon and
     * the horizon band), long enough for the delay margin, and judges them with the same rules as judge(). Resolves with
     * { r, verdict, horizonModel, band, deepPolar, earthDsn, robustDays }: band as band() (null without it), deepPolar as deepPolar(), earthDsn as earthDsn(), robustDays as the margin of the
     * search (0 unless viable). From then on visibleAt(), visibleHours() and horizonModel() answer for this point too,
     * with the windows of the last landing asked for it.
     */
    point(site, t, mission) {
      const heights = loadedHeights();
      const key = `${site.id}|${site.lat}|${site.lon}|${t}|${mission.days}|${source}|${heightsKey(heights)}`;
      if (own.size > 40) own.clear();
      own.set(site.id, { key, w: null }); // until its windows arrive, nothing answers for it with another landing's
      return cached(points, key, () => visibility.loadWindows(site, t - DAY_MS, t + (mission.days + MARGIN_CAP_DAYS + 1) * DAY_MS, heights, { band: true, dsn: true })).then(w => {
        if (own.get(site.id)?.key === key) own.set(site.id, { key, w });
        const profile = profileOf(mission), e = evaluateLanding(w, profile, t);
        return {
          ...toWeb(e, t, mission.days), horizonModel: w.site.horizonModel ?? null, band: bandOf(w, t, mission), deepPolar: deepPolarOf(w), earthDsn: earthDsnOf(w, t, mission.days),
          robustDays: e.verdict === VERDICT.VIABLE ? domainMarginDays(w, profile, t).days : 0,
        };
      });
    },

    /**
     * Hour-by-hour sky of a mission, only to draw: { series: [{ sun: { az, el, horizon, margin }, earth }], horizon: { mask, heightM } }.
     * Returns it if it is ready; if not, starts loading it, returns null and calls `onReady` when it arrives.
     */
    sky(site, t0, days, onReady) {
      const heights = loadedHeights();
      const key = `${site.id}|${site.lat}|${site.lon}|${t0}|${days}|${source}|${heightsKey(heights)}`;
      const hit = skies.get(key);
      if (hit && !(hit instanceof Promise)) return hit;
      if (hit) { if (onReady) hit.then(() => onReady(skies.get(key) ?? null)); }
      else {
        if (skies.size > 40) skies.clear();
        const p = visibility.loadSky(site, t0, t0 + days * DAY_MS, heights)
          .then(sky => { skies.set(key, sky); onReady?.(sky); }, err => { skies.delete(key); console.warn(err.message); onReady?.(null, err); });
        skies.set(key, p);
      }
      return null;
    },

    /**
     * Terrain around a site, only to draw the 3D sky (Relief of ports/visibility.js). Returns it if it is ready (null:
     * the source has none for this site); if not, starts loading it, returns undefined and calls `onReady` when it arrives.
     */
    relief(site, onReady) {
      const key = `${site.id}|${site.lat}|${site.lon}|${source}`;
      const hit = reliefs.get(key);
      if (hit !== undefined && !(hit instanceof Promise)) return hit;
      if (hit) { if (onReady) hit.then(() => onReady()); return undefined; }
      if (reliefs.size > 20) reliefs.clear();
      const load = visibility.loadRelief ? visibility.loadRelief(site) : Promise.resolve(null);
      const p = load.then(r => r ?? null, err => { console.warn(err.message); return null; }).then(r => { reliefs.set(key, r); onReady?.(); });
      reliefs.set(key, p);
      return undefined;
    },
  };
  return service;
}
