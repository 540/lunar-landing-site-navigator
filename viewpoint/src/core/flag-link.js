// «Comparar en el planificador» (E10.1, #492): the Plan URL for the flag of the exploration, with the period in view.
// Pure: no DOM. It builds the plan and lets mission-link.js write the query (planUrl), so the parameter names are the ones
// Plan reads (MISSION_KEYS); the coordinates are the ones parseCoords reads (east longitude positive, as in the API).
import { CUSTOM_SITE_ID } from '../../../web/js/common/custom-site.js';
import { withLang } from '../../../shared/i18n/lang.js';
import { planUrl, MAX_DAYS } from './mission-link.js';

const DECIMALS = 4; // the reading of the flag shows four decimals
const round = v => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS;

/**
 * @param {{lat:number, lon:number, moved:boolean, regionId:string, start:Date|number, days:number, search?:string, lang?:string}} flag
 *   `moved`: the flag is not at the site of the region any more (then the link carries the point); `start`/`days`: the period in
 *   view (Plan takes at most MAX_DAYS of surface days); `search`: location.search, to keep ?data= and ?api=; `lang`: 'es' | 'en'
 * @returns {string} URL relative to viewpoint/ (../web/?…#plan)
 */
export function flagPlanUrl({ lat, lon, moved, regionId, start, days, search = '', lang }) {
  const plan = {
    siteId: moved ? CUSTOM_SITE_ID : regionId,
    ...(moved ? { lat: round(lat), lon: round(lon) } : {}),
    t0: new Date(start).getTime(),
    days: Math.min(days, MAX_DAYS),
    batteryHours: 12, minEarthPct: 60, // as in Plan's example profile, when a link brings no thresholds
  };
  return withLang(planUrl(plan, search), lang);
}
