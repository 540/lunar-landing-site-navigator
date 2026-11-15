// Link to the mission viewer of viewpoint/ (V1.1, #72) for a site of the catalogue or a point of the user's own (#101).
import { viewerUrl } from '../../../viewpoint/src/core/mission-link.js';
import { CUSTOM_SITE_ID, isOwnPoint } from './custom-site.js';

/**
 * @param {object} site the site of the view (a point of one's own has `own`)
 * @param {object} plan t0, days, the requirements and the search (linkSearch)
 * @param {string} search location.search, for ?data=, ?api= and the quality
 * @param {{at?: number, foot?: boolean}} [open] instant to open at and whether on foot (the ⤢ of the sky, #130)
 */
export function viewerLink(site, plan, search, open) {
  const own = isOwnPoint(site);
  return viewerUrl({ siteId: own ? CUSTOM_SITE_ID : site.id, ...(own ? { lat: site.lat, lon: site.lon } : {}), ...plan }, search, open);
}
