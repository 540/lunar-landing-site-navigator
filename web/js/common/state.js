// Shared UI state and evaluation of every site with the mission in the sidebar.
// Shared by the three views: change it only in a PR that all three owners review.
import * as M from '../engine/model.js';
import { SITES, INITIAL_DATE } from '../engine/catalog.js';
import { $ } from './util.js';
import { heightsOf, API_LIMITS } from '../ports/visibility.js';
import { t, fmtDateTime } from './i18n.js';
import { earthGapOf } from './earth-gap.js';

SITES.forEach(s => { s.horizon = M.computeHorizon(s); });

export const state = {
  selected: ['shackleton-rim', 'ridge-slope', 'malapert'],
  view: 'plan',
  explain: new URLSearchParams(location.search).get('debug') === '1',
  card: null,           // explanation card: { key, site }
  cache: {},            // id → { site, result, verdict, t0, source }
  playing: null,
  customSite: null,     // the point typed in Plan's «¿Dónde?» (common/custom-site.js), or null
  sweepKey: '',
  searchResult: null,   // last search result (best + options)
  plan: null,           // option chosen as plan (the current one: Replan may change it)
  originalPlan: null,   // approved plan, fixed when adopting from Plan or Advanced: Replan counts the total delay from it
  planAdoptedByUser: false, // true once the user adopts a plan in Plan or Advanced (the automatic search does not count)
  replanHistory: [],    // plans adopted from Replan since the original: [{ from, to }]
  replanDelay: null,    // days of delay Plan asks Replan to try when it links there (read once by Replan)
  form: { profile: 'small-robotic', priority: 'energy', zone: null },
  exits: null,          // Replan: exits A and B
  dataSource: null,     // 'api' or 'fake' once app.js knows whether the data API answers; null until then
};

// Global actions: app.js fills them so modules do not import each other in a cycle.
export const actions = {
  render: () => {},
  onHourChange: () => {},
  runSearch: () => {},   // re-runs the Plan search (Advanced calls it when the priority changes)
  onAdopt: () => {},     // a plan was adopted: (option, { fromReplan }). Replan resets its form here
  openExplanation: () => {}, // (key, element) turns the explanation mode on with that card (the tour calls it)
};

// Application services, filled by app.js (the composition root, docs/adr/0001).
// mission: the service of Plan and Advanced (application/mission-service.js).
// history: the missions planned in this browser (common/mission-history.js, #246).
export const services = { mission: null, history: null };

/** The catalogue and, if there is one, the point typed in Plan: the sites the mission service loads. */
export const planSites = () => (state.customSite ? [...SITES, state.customSite] : SITES);
/** A site by id: of the catalogue, the point typed in Plan, or one of the search or the plan (a point that was replaced). */
export const siteById = id => planSites().find(s => s.id === id)
  ?? state.searchResult?.options.find(o => o.site.id === id)?.site ?? (state.plan?.site.id === id ? state.plan.site : undefined);

export const optionFor = id => state.searchResult?.options.find(o => o.site.id === id);

/** Transit in days from a field: undefined when empty, so the domain uses its default. */
export const transitOf = v => (String(v).trim() === '' || !Number.isFinite(+v) ? undefined : Math.max(0, +v));

export function config() {
  const base = Date.parse($('date').value + ':00Z') || Date.parse(INITIAL_DATE + ':00Z');
  const delay = +$('delay').value;
  return {
    base, delay, t0: base + delay * 864e5,
    days: Math.max(API_LIMITS.days.min, Math.min(API_LIMITS.days.max, +$('days').value || 10)), // the API's range (#252)
    req: { batteryHours: Math.max(0, +$('battery').value || 0), minEarthPct: Math.max(0, Math.min(100, +$('min-earth').value || 0)), maxEarthGapHours: earthGapOf($('max-earth-gap').value), transitDays: transitOf($('transit').value) },
    // Where the Sun and the Earth are seen from: they are not thresholds, they change the visibility data itself.
    heights: heightsOf({ panelHeightM: $('panel-height').value, antennaHeightM: $('antenna-height').value }),
  };
}

const DAY_MS = 864e5;

/**
 * Period of visibility data Plan and Advanced need: the plan date and its mission, and the searched window with
 * what the views look at around it (the robustness days, the landing timeline and the next window after it).
 * The range carries the panel and antenna heights the data must be computed for: the ones of the search given, or
 * the ones of the mission in the sidebar.
 */
export function missionRange(search) {
  const c = config(), cond = search ?? state.searchResult?.conditions;
  let from = c.t0, to = c.t0 + c.days * DAY_MS;
  if (cond) {
    from = Math.min(from, cond.from);
    to = Math.max(to, cond.to + (62 + cond.days) * DAY_MS, cond.from + (61 + cond.days) * DAY_MS);
  }
  return { fromMs: from - DAY_MS, toMs: to + DAY_MS, ...(search ? heightsOf(search) : c.heights) };
}

export function evaluateSites() {
  const c = config(), mission = { days: c.days, ...c.req }, ms = services.mission;
  // Verdicts and metrics come from the mission service (the same rules and data as Replan) once its windows are
  // loaded. Until then, and for sites it does not know (points added on the map), from the simulated engine.
  const ready = !!ms?.isReady(missionRange());
  for (const s of planSites()) {
    // Each option found is evaluated on its own date; the rest, on the plan date. The delay is added to all.
    const o = optionFor(s.id), t0 = (o && s.id !== state.plan?.site.id ? o.landing : c.base) + c.delay * DAY_MS;
    if (ready && ms.sites.includes(s)) {
      const { r, verdict } = ms.judge(s, t0, mission);
      state.cache[s.id] = { site: s, result: r, verdict, t0, source: ms.source };
    } else {
      s.horizon ??= M.computeHorizon(s);
      const result = M.evaluate(s, t0, c.days, 1);
      state.cache[s.id] = { site: s, result, verdict: M.verdict(result, c.req), t0, source: 'fake' };
    }
  }
  $('hour').max = c.days * 24;
  if (+$('hour').value > c.days * 24) $('hour').value = c.days * 24;
  $('delay-value').textContent = t('common.delayValue', { days: c.delay, date: fmtDateTime(c.t0) });
}

export const currentHour = () => +$('hour').value;
