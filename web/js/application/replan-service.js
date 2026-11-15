// Application service of "Replanificar": loads the visibility windows once through the port (async) and then
// answers synchronously with the domain (planner/src/replan.js). The view never talks to the engine directly.
import { replanOptions, delaySweep, MARGIN_CAP_DAYS, SUGGESTION_EXTRA_DAYS } from '../../../planner/src/replan.js';
import { evaluate } from '../../../planner/src/rules.js';
import { assertVisibilityPort, toDomainSite, heightsOf, heightsKey } from '../ports/visibility.js';
import { missionProfile } from '../../../planner/src/ranking.js';
import { t } from '../common/i18n.js';

const DAY_MS = 864e5;
const PAD_DAYS = 10; // extra days loaded on each side, so small changes to the dates do not reload

/**
 * Mission of the UI → profile of the domain: Sun and Earth at landing (R1, R2), battery (R4), longest stretch
 * without the Earth (R6, when the mission sets maxEarthGapHours) and minimum share of Earth (R8). R3, R5 and R7 stay
 * off: the UI profiles have no thresholds for them.
 */
export const toDomainProfile = missionProfile; // the same profile Plan and Advanced use (planner/src/ranking.js)

/**
 * Period of data a replan needs: from the original landing to past the deadline (suggestions, margin, mission). With
 * `heights` ({ panelHeightM, antennaHeightM }, issue #66) the range carries them: the windows are loaded for those
 * heights, the same ones Plan and Advanced use, and a range with other heights loads again.
 */
export function rangeFor({ originalLandingMs, notAfterMs, days, heights }) {
  const fromMs = Math.floor(originalLandingMs / DAY_MS) * DAY_MS - DAY_MS;
  const toMs = Math.ceil((notAfterMs + (SUGGESTION_EXTRA_DAYS + MARGIN_CAP_DAYS + days + 1) * DAY_MS) / DAY_MS) * DAY_MS;
  return { fromMs, toMs, ...(heights ? heightsOf(heights) : {}) };
}

/** Whether the windows on screen were computed over the terrain, read off the horizon model the adapter gave each site. */
export function describeHorizon(horizonModels) {
  const models = Object.values(horizonModels);
  if (models.every(m => m === 'simulated-terrain')) return t('replan.horizon.simulated');
  const withTerrain = models.filter(m => m === 'mask').length;
  if (withTerrain === models.length) return t('replan.horizon.all');
  if (withTerrain === 0) return t('replan.horizon.none');
  return t('replan.horizon.some', { n: withTerrain, total: models.length });
}

/**
 * Where the verdicts on screen come from, for the relief note of the map (#331): null with no windows loaded yet (not
 * known), 'fake' when every site was computed by the simulated engine (?data=fake), and 'api' otherwise. Same rule as
 * describeHorizon, which also reads the simulated engine off 'simulated-terrain'.
 */
export function verdictSource(horizonModels) {
  const models = Object.values(horizonModels);
  if (!models.length) return null;
  return models.every(m => m === 'simulated-terrain') ? 'fake' : 'api';
}

export function createReplanService({ visibility, sites }) {
  assertVisibilityPort(visibility);
  const domainSites = sites.map(s => toDomainSite(s));
  let windowsBySite = {}, loaded = null, pending = null;
  const covers = r => loaded && loaded.fromMs <= r.fromMs && loaded.toMs >= r.toMs && loaded.heights === heightsKey(r);

  return {
    sites: domainSites,
    isReady: range => covers(range),
    /** Horizon model of each loaded site, by id: 'simulated-terrain', 'mask' (real terrain) or 'sphere' (none). */
    horizonModels: () => Object.fromEntries(Object.entries(windowsBySite).map(([id, w]) => [id, w.site.horizonModel])),

    /** Loads (once) the windows of every site for the range. Resolves when they are ready. */
    prepare(range) {
      if (covers(range)) return Promise.resolve();
      const heights = heightsOf(range), key = heightsKey(range);
      const want = { fromMs: range.fromMs - PAD_DAYS * DAY_MS, toMs: range.toMs + PAD_DAYS * DAY_MS, heights: key };
      if (pending && pending.range.heights === key && pending.range.fromMs <= range.fromMs && pending.range.toMs >= range.toMs) return pending.promise;
      const promise = Promise.all(sites.map(async s => [s.id, await visibility.loadWindows(s, want.fromMs, want.toMs, heights)]))
        .then(entries => { windowsBySite = Object.fromEntries(entries); loaded = want; })
        .finally(() => { if (pending?.promise === promise) pending = null; });
      pending = { range: want, promise };
      return promise;
    },

    /** Replan options (see planner/src/replan.js). `mission` is { days, batteryHours, minEarthPct }. */
    options({ mission, ...input }) {
      return replanOptions({ ...input, windowsBySite, sites: domainSites, profile: toDomainProfile(mission) });
    },

    /** The loaded Sun and Earth windows of a site (the data every verdict comes from), or null. */
    windows: siteId => windowsBySite[siteId] ?? null,

    /**
     * One landing judged by the same rules as the options: `{ verdict, evaluation }`. It is how the view gets the
     * original plan without the delay (and any site at the delayed date) to compare with the exits.
     */
    evaluate(siteId, landingMs, mission) {
      const w = windowsBySite[siteId];
      if (!w) throw new Error(`No hay ventanas cargadas para el sitio ${siteId}`);
      const evaluation = evaluate(w, toDomainProfile(mission), landingMs);
      return { verdict: evaluation.verdict, evaluation };
    },

    /** Verdict of each site for each day from `fromMs` (`{ wholeDays: true }`: best of each UTC day). */
    sweep(siteIds, mission, fromMs, days, opts) {
      return delaySweep(windowsBySite, siteIds, toDomainProfile(mission), fromMs, days, opts);
    },
  };
}
