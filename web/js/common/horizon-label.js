// What the horizon on screen is made of (#330). With the data API but without the LOLA DEM on the server, the windows
// are computed over a smooth Moon (horizonModel 'sphere'): the texts must say so, not «LOLA». The API also gives
// 'sphere' for a point outside the DEM's coverage (Apolo 15, with the DEM loaded), and the web cannot tell the two
// cases apart, so the label names the point, not the server. No DOM: the texts come from the dictionary (i18n.js).
import { t } from './i18n.js';

/**
 * The horizon of a site in words: 'de relieve inventado' (simulated engine), 'de Luna lisa (sin relieve LOLA en este punto)' (data API over
 * a smooth sphere) or 'LOLA' (data API with terrain, or a model not known yet).
 * @param {string|null} source 'api' | 'fake' | null
 * @param {string|null} horizonModel 'mask' | 'sphere' | 'simulated-terrain' | null
 */
export function horizonLabel(source, horizonModel) {
  if (source !== 'api') return t('common.horizon.sim');
  return horizonModel === 'sphere' ? t('common.horizon.flat') : t('common.horizon.lola');
}

/**
 * The horizon of a point off the catalogue (a map point, a point around a site): its own model once its windows are
 * loaded (`pointModel`). Until then '' (nothing to say yet), unless the site it belongs to is over the smooth sphere
 * (`siteModel` 'sphere': no DEM on the server, so no point has terrain). A site's catalogue mask ('mask') says nothing
 * of the points around it: without the DEM they have no mask of their own and are computed over the sphere.
 */
export function pointHorizonLabel(source, pointModel, siteModel) {
  const model = pointModel ?? (siteModel === 'sphere' ? 'sphere' : null);
  return source !== 'api' || model != null ? horizonLabel(source, model) : '';
}

/** pointHorizonLabel() ready to follow a word in a sentence («horizonte» + this): ' ' + label, or '' when unknown. */
export function ownHorizon(source, pointModel, siteModel) {
  const label = pointHorizonLabel(source, pointModel, siteModel);
  return label && ` ${label}`;
}

/**
 * The header badge: which data the views use and, with the API, whether the loaded windows carry the terrain.
 * `effect` is the mission service's heightsEffect(): 'applied' (some site with LOLA terrain), 'no-terrain' (smooth
 * sphere), 'simulated' or null before the first load. Returns { text, tone, title } and, without terrain, `note`: the
 * consequence, which must reach everyone (not only the `title`, out of reach of the keyboard, touch and many readers).
 */
export function dataBadge(apiOk, effect, baseUrl) {
  if (!apiOk) return { text: t('common.badge.fake'), tone: 'warn', title: t('common.badge.fakeTitle') };
  const title = t('common.badge.base', { url: baseUrl }), note = t('common.badge.noTerrainNote');
  if (effect === 'no-terrain') return { text: t('common.badge.noTerrain'), tone: 'warn', note, title: `${title}. ${note}` };
  if (effect === 'applied') return { text: t('common.badge.lola'), tone: 'ok', title: `${title}${t('common.badge.lolaTitle')}` };
  return { text: t('common.badge.api'), tone: 'ok', title: `${title}${t('common.badge.apiTitleTail')}` };
}

/**
 * What the header badge must show now, given the text it shows (`shownText`, '' or undefined before the first paint):
 * null while it is not known whether the API answers (`apiOk` null), else dataBadge() plus `changed`. The badge is a
 * live region (role="status"): it is repainted, and so announced, only when `changed`.
 */
export function badgeUpdate(shownText, apiOk, effect, baseUrl) {
  if (apiOk == null) return null;
  const b = dataBadge(apiOk, effect, baseUrl);
  return { ...b, changed: b.text !== shownText };
}
