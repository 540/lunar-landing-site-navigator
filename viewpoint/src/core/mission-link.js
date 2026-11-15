// Link between Plan (web/) and the 3D viewer (viewpoint/), both ways (V1.1, #72). Pure: no DOM, no fetch.
// The viewer opens with ?site=<id>&t0=<ISO>&days=<n>, plus the optional thresholds of the mission, so the link can be
// shared and «Volver» rebuilds the same plan in Plan. ?data= and ?api= go along, so both screens read the same data, and so
// do ?q=, ?pr= and ?shadow= (shared/render/quality.js), so both screens render at the same quality level (#145).
// The search goes along too (?from=, ?to= and ?pick=best), so «Volver» brings back the window and the choice of site
// the user made, not only the landing. A point of the user's own (#101) goes as ?site=custom&lat=…&lon=….
// The ⤢ of the sky (#130) also says the instant to open at (?at=<ISO>, within the mission) and to start on foot (?view=foot).
import { CUSTOM_SITE_ID, parseCoords } from '../../../web/js/common/custom-site.js';
import { canonicalSiteId } from '../../../web/js/engine/site-ids.js';
import { CRAFT_CLASSES } from '../../../web/js/engine/coherence.js';
import { panelOf } from '../../../web/js/engine/panel.js';
import { isoDay } from '../../../shared/format/time.js';

/**
 * Catalogue site (web/js/engine/catalog.js) → folder of its relief region in viewpoint/data/. Every polar site has real LOLA
 * relief (`node pipeline/relief.mjs --source lola --site <id>`); with simulated data the viewer warns that the verdict is
 * simulated (V2.4, #82, option b). The real landing of IM-2 is 0.5 km from its target: it shares the target's region.
 */
export const REGIONS = {
  'shackleton-rim': 'shackleton-rim',
  'ridge-slope': 'ridge-slope',
  malapert: 'malapert',
  gerlache: 'gerlache',
  'im2-objetivo': 'im2-objetivo',
  'im2-alunizaje': 'im2-objetivo',
};
export const regionFor = siteId => REGIONS[siteId] ?? null;

// The regions are 40 km squares centred on their site: a point this close to a site falls inside its region.
const REGION_REACH_KM = 18, MOON_RADIUS_KM = 1737.4, RAD = Math.PI / 180;
const distanceKm = (a, b) => {
  const h = Math.sin((b.lat - a.lat) * RAD / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin((b.lon - a.lon) * RAD / 2) ** 2;
  return 2 * MOON_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};
/** Region of any point: the one of the nearest catalogue site with a region, if the point is inside it; null if none. */
export function regionNear(point, sites) {
  let best = null;
  for (const s of sites) {
    const d = REGIONS[s.id] ? distanceKm(point, s) : Infinity;
    if (d <= REGION_REACH_KM && (!best || d < best.d)) best = { id: REGIONS[s.id], d };
  }
  return best?.id ?? null;
}

// Thresholds of the example profile «Lander robótico pequeño», when the link does not bring them.
// Without ?gap= the limit on hours without the Earth (R6) is off, as in Plan when that field is empty.
const DEFAULTS = { batteryHours: 12, minEarthPct: 60 };
const PASS_THROUGH = ['data', 'api', 'q', 'pr', 'shadow'];
export const MAX_DAYS = 30; // the limit of the Plan form
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Every parameter of a mission link (Plan removes them from its URL once it has read them). */
export const MISSION_KEYS = ['site', 'lat', 'lon', 't0', 'days', 'battery', 'earth', 'gap', 'transit', 'profile', 'from', 'to', 'pick', 'skip', 'class',
  'bwh', 'bload', 'bdod', 'bspec', 'bkg', 'dry', 'panel', 'at', 'view'];
// Ids of the coherence rules of web/js/engine/coherence.js (#252): C1, C4… and those of the battery (#253): B1…
export const RULE_ID = /^[CB]\d{1,2}$/;
// The battery the hours without the Sun come from (#253), field by field: ?bwh=20000&bload=46&bdod=0.9 (and, if
// given, the specific energy, the mass of the battery and the dry mass). Without ?bwh=, ?bkg= or ?bspec=, no battery.
const BATTERY_KEYS = { capacityWh: 'bwh', survivalLoadW: 'bload', depthOfDischarge: 'bdod', whPerKg: 'bspec', batteryKg: 'bkg', dryMassKg: 'dry' };
/** Only finite numbers of the battery; null if nothing of it is left. */
export function batteryOf(b) {
  if (!b || typeof b !== 'object') return null;
  const out = Object.fromEntries(Object.keys(BATTERY_KEYS).map(k => [k, b[k]]).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
  return Object.keys(out).length ? out : null;
}
// The class of the spacecraft (#252): only one of CRAFT_CLASSES, so a link cannot bring a class Plan does not know.
const craftClassOf = v => (CRAFT_CLASSES.some(c => c.id === v) ? v : null);

const query = (plan, from) => {
  const q = new URLSearchParams();
  q.set('site', plan.siteId);
  if (plan.siteId === CUSTOM_SITE_ID) { q.set('lat', String(plan.lat)); q.set('lon', String(plan.lon)); }
  q.set('t0', new Date(plan.t0).toISOString());
  q.set('days', String(plan.days));
  q.set('battery', String(plan.batteryHours));
  q.set('earth', String(plan.minEarthPct));
  if (Number.isFinite(plan.maxEarthGapHours)) q.set('gap', String(plan.maxEarthGapHours)); // none: R6 off
  if (Number.isFinite(plan.transitDays)) q.set('transit', String(plan.transitDays)); // none: the profile's (#67)
  if (plan.profile) q.set('profile', plan.profile);
  // The search window (UTC days) and whether the site was the search's pick: none, Plan makes a window around t0.
  if (ISO_DAY.test(plan.from ?? '') && ISO_DAY.test(plan.to ?? '')) { q.set('from', plan.from); q.set('to', plan.to); }
  if (plan.pickBest) q.set('pick', 'best');
  // The coherence rules the user skipped to compute this plan (#252): none, nothing in the link.
  if (plan.skippedRules?.length) q.set('skip', plan.skippedRules.filter(id => RULE_ID.test(id)).join(','));
  if (craftClassOf(plan.craftClass)) q.set('class', plan.craftClass);
  // How the solar panel is mounted (#254): only one the engine knows; none, the spacecraft's (or a tracker).
  if (panelOf(plan.panel)) q.set('panel', plan.panel);
  const battery = batteryOf(plan.battery);
  if (battery) for (const [k, key] of Object.entries(BATTERY_KEYS)) if (k in battery) q.set(key, String(battery[k]));
  return passThrough(q, from).toString();
};

const passThrough = (q, from) => {
  const src = new URLSearchParams(from ?? '');
  for (const k of PASS_THROUGH) if (src.get(k)) q.set(k, src.get(k));
  return q;
};

/** ?skip=C4,C5 → { skippedRules: ['C4', 'C5'] }; nothing without rules. */
function skippedOf(v) {
  const ids = [...new Set(String(v ?? '').split(',').map(x => x.trim()).filter(x => RULE_ID.test(x)))];
  return ids.length ? { skippedRules: ids } : {};
}

/** ?bwh=…&bload=…&bdod=… → { battery: { capacityWh, survivalLoadW, depthOfDischarge, … } }; nothing without it. */
function batteryParams(q) {
  const raw = Object.fromEntries(Object.entries(BATTERY_KEYS).map(([k, key]) => [k, q.get(key) === null || q.get(key) === '' ? NaN : Number(q.get(key))]));
  const b = batteryOf(raw);
  return b && (b.capacityWh != null || b.batteryKg != null || b.whPerKg != null) ? { battery: b } : {};
}


/**
 * The search behind a plan, for its link: the spacecraft, the window (UTC days) and whether the search picked the site
 * («El mejor de la zona») or the user fixed it, and the coherence rules skipped for it and the class of the spacecraft (#252). `result` is the search of
 * Plan (web/js/application/mission-service.js).
 */
export function linkSearch(result) {
  const c = result?.conditions;
  const skipped = c?.skippedRules?.length ? { skippedRules: c.skippedRules.map(r => r.id) } : {};
  if (craftClassOf(c?.craftClass)) skipped.craftClass = c.craftClass; // and the class of the spacecraft, which sets its rules
  if (batteryOf(c?.battery)) skipped.battery = batteryOf(c.battery); // and the battery its hours come from (#253)
  if (panelOf(c?.panel)) skipped.panel = c.panel; // and how its solar panel is mounted (#254)
  if (!c || !(c.from > 0) || !(c.to > 0)) return { profile: c?.profile ?? null, ...skipped };
  return { profile: c.profile ?? null, from: isoDay(c.from), to: isoDay(c.to), pickBest: !result.fixedSite, ...skipped };
}

/**
 * Viewer URL of a plan, relative to web/. `from` is the current location.search (to pass ?data=, ?api= and the quality
 * parameters on). `open`: { at: instant in ms, foot: true } to open at that instant and on foot (#130).
 */
export function viewerUrl(plan, from, open = {}) {
  const q = new URLSearchParams(query(plan, from));
  if (Number.isFinite(open.at)) q.set('at', new Date(open.at).toISOString());
  if (open.foot) q.set('view', 'foot');
  return `../viewpoint/?${q}`;
}

/** Plan URL of the same plan, relative to viewpoint/. A link that cannot be read ({ error }) goes back to an empty Plan. */
export function planUrl(plan, from) {
  if (plan.error) {
    const q = passThrough(new URLSearchParams(), from).toString();
    return `../web/${q ? `?${q}` : ''}#plan`;
  }
  return `../web/?${query(plan, from)}#plan`;
}

const num = (v, fallback) => (v === null || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));

/**
 * The plan of a URL. null when it has no ?site= (it is not a mission link); { error } when it is one and cannot be read.
 * @param {URLSearchParams|string} search
 */
export function parseMission(search) {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const siteId = canonicalSiteId(q.get('site'));
  if (!siteId) return null;
  const where = siteId === CUSTOM_SITE_ID ? parseCoords(q.get('lat'), q.get('lon')) : null;
  if (where?.errors) return { error: 'bad-coords' };
  const t0 = Date.parse(q.get('t0') ?? '');
  if (!Number.isFinite(t0)) return { error: 'bad-t0' };
  const days = num(q.get('days'), NaN);
  if (!(days > 0 && days <= MAX_DAYS)) return { error: 'bad-days' };
  return {
    siteId, ...(where ? { lat: where.lat, lon: where.lon } : {}), t0, days,
    batteryHours: Math.max(0, num(q.get('battery'), DEFAULTS.batteryHours)),
    minEarthPct: Math.max(0, Math.min(100, num(q.get('earth'), DEFAULTS.minEarthPct))),
    maxEarthGapHours: q.get('gap') === null || q.get('gap') === '' ? undefined : Math.max(0, num(q.get('gap'), 0)),
    // Without ?transit= the plan takes the transit of its spacecraft (#67).
    ...(q.get('transit') ? { transitDays: Math.max(0, num(q.get('transit'), 0)) } : {}),
    profile: q.get('profile') || null,
    ...(ISO_DAY.test(q.get('from') ?? '') && ISO_DAY.test(q.get('to') ?? '') && q.get('from') <= q.get('to') ? { from: q.get('from'), to: q.get('to') } : {}),
    ...(q.get('pick') === 'best' ? { pickBest: true } : {}),
    ...skippedOf(q.get('skip')),
    ...(craftClassOf(q.get('class')) ? { craftClass: q.get('class') } : {}),
    ...batteryParams(q),
    ...(panelOf(q.get('panel')) ? { panel: q.get('panel') } : {}),
    ...atOf(q.get('at'), t0, days),
    ...(q.get('view') === 'foot' ? { foot: true } : {}),
  };
}

/** ?at=<ISO> → { atMs }, only inside the mission (from t0 to t0 + days); nothing otherwise. */
function atOf(v, t0, days) {
  const at = Date.parse(v ?? '');
  return Number.isFinite(at) && at >= t0 && at <= t0 + days * 864e5 ? { atMs: at } : {};
}
