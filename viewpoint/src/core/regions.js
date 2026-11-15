// Regions of the tour that have data in viewpoint/data/<id>/. To add one: run the pipeline with `--site <id>` and add its id here.
export const REGION_IDS = ['shackleton-rim', 'im2-objetivo'];
export const DEFAULT_REGION_ID = 'shackleton-rim';

/** Region of `?region=<id>`. An unknown or missing id gives the default region; `onUnknown` receives the unknown id (not for a missing one). */
export function regionFromSearch(search, onUnknown = () => {}) {
  const id = new URLSearchParams(search).get('region');
  if (id === null) return DEFAULT_REGION_ID;
  if (REGION_IDS.includes(id)) return id;
  onUnknown(id);
  return DEFAULT_REGION_ID;
}

/** Day of the timeline slider in `?day=<n>`: a number inside the window, or null. */
export function dayFromSearch(search, windowDays) {
  const raw = new URLSearchParams(search).get('day');
  if (raw === null || raw.trim() === '') return null;
  const day = Number(raw);
  return Number.isFinite(day) && day >= 0 && day <= windowDays ? day : null;
}

/**
 * Query string that opens another region keeping the start date and the day of the timeline (E2.4, #155).
 * `timeline` is the state of the screen ({ start, offsetDays }, main.js). Other parameters of the current URL are left as
 * they are.
 */
export function regionSearch(search, regionId, { start, offsetDays }) {
  const params = new URLSearchParams(search);
  params.set('region', regionId);
  params.delete('lat'); // a region replaces the point of ?lat&lon (E10.2)
  params.delete('lon');
  params.set('start', start);
  params.set('day', String(Math.round(offsetDays * 1000) / 1000));
  return `?${params}`;
}

/** The warning of the selector appears only when the catalogue says the coordinates are not verified (`coordinatesVerified === false`). */
export const hasApproximateCoordinates = meta => meta?.coordinatesVerified === false;

/** Options of the selector: one per id, in the order given, named from `meta.name[lang]` (or `.es`); a meta that failed to load (null) falls back to the id. */
export function regionOptions(ids, metas, lang = 'es') {
  return ids.map((id, i) => ({ id, label: metas[i]?.name?.[lang] || metas[i]?.name?.es || id }));
}

/** The selector applies a choice only when it is a known region other than the one on screen. */
export const shouldApplyRegion = (current, selected) => selected !== current && REGION_IDS.includes(selected);

/** `aria-describedby` of the selector: the warning only while it is shown, since hidden targets still count as a description. */
export const approxDescribedBy = (meta, warningId) => (hasApproximateCoordinates(meta) ? warningId : null);
