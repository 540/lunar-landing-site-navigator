// Mission history (#246): the parameters of each mission planned in Plan, kept in the browser to open it again.
// Pure: no DOM. The storage (localStorage) is handed in, so the logic runs in tests and survives a blocked storage.
// An entry is the mission of a link (viewpoint/src/core/mission-link.js) plus its heights and the site of the search:
//   { siteId, t0, days, batteryHours, minEarthPct, maxEarthGapHours?, transitDays?, profile, from?, to?,
//     searchSiteId, panelHeightM, antennaHeightM, savedAt, verdict, skippedRules?, craftClass?, battery?, panel? }
// searchSiteId is the site the search was fixed to, or null for «El mejor de la zona»; siteId and t0 are the landing
// on screen, which may be another option of that search. Only parameters are kept: results are computed again on opening.
import { canonicalSiteId } from '../engine/site-ids.js';
import { profileById, profileFor } from '../engine/catalog.js';
import { CRAFT_CLASSES } from '../engine/coherence.js';
import { RULE_ID, batteryOf } from '../../../viewpoint/src/core/mission-link.js';
import { panelOf } from '../engine/panel.js';

export const STORAGE_KEY = 'llsn.missions';
export const MAX_MISSIONS = 20;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const VERDICTS = ['viable', 'marginal', 'not_viable'];
const finite = v => typeof v === 'number' && Number.isFinite(v);
const optional = v => (finite(v) ? v : undefined);

/** A mission as it is stored: only known fields, with their types checked. null if it cannot be opened again. */
export function missionEntry(m) {
  if (!m || typeof m.siteId !== 'string' || !m.siteId || !finite(m.t0) || !(m.days > 0) || !finite(m.days)) return null;
  const window = ISO_DAY.test(m.from ?? '') && ISO_DAY.test(m.to ?? '') && m.from <= m.to;
  const skipped = Array.isArray(m.skippedRules) ? m.skippedRules.filter(id => RULE_ID.test(id)) : [];
  return {
    siteId: canonicalSiteId(m.siteId), t0: m.t0, days: m.days,
    batteryHours: finite(m.batteryHours) ? m.batteryHours : 0,
    minEarthPct: finite(m.minEarthPct) ? m.minEarthPct : 0,
    maxEarthGapHours: optional(m.maxEarthGapHours), // none: no limit on hours without the Earth (R6 off)
    transitDays: optional(m.transitDays),           // none: the transit of its spacecraft
    profile: typeof m.profile === 'string' && m.profile ? m.profile : null,
    ...(window ? { from: m.from, to: m.to } : {}),
    searchSiteId: typeof m.searchSiteId === 'string' && m.searchSiteId ? canonicalSiteId(m.searchSiteId) : null,
    panelHeightM: optional(m.panelHeightM), antennaHeightM: optional(m.antennaHeightM),
    savedAt: finite(m.savedAt) ? m.savedAt : 0,
    verdict: VERDICTS.includes(m.verdict) ? m.verdict : null,
    ...(skipped.length ? { skippedRules: skipped } : {}), // the coherence rules skipped for it (#252)
    ...(CRAFT_CLASSES.some(c => c.id === m.craftClass) ? { craftClass: m.craftClass } : {}), // and the class of its spacecraft
    ...(batteryOf(m.battery) ? { battery: batteryOf(m.battery) } : {}), // and the battery its hours come from (#253)
    ...(panelOf(m.panel) ? { panel: m.panel } : {}), // and how its solar panel is mounted (#254)
  };
}

/**
 * What makes two entries the same mission: the search (spacecraft, requirements, heights, where and window). The
 * landing is not part of it, so moving it, or taking another option of the search, updates the entry. The spacecraft is
 * the one Plan opens it with (#251): an entry saved before the own spacecraft had its card (no profile, or an example
 * one with requirements changed by hand) is the same mission as the one Plan saves on opening it again.
 */
export const missionKey = m => JSON.stringify([profileFor(m.profile, m), m.days, m.batteryHours, m.minEarthPct, m.maxEarthGapHours ?? null,
  m.transitDays ?? null, m.panelHeightM ?? null, m.antennaHeightM ?? null, m.searchSiteId, m.from ?? null, m.to ?? null]);

/**
 * The name of the spacecraft of an entry, with the same rule Plan opens it with (#251): an example profile whose
 * requirements were changed by hand, or no profile (entries saved before #251), is «Nave propia».
 */
export const missionProfileName = m => profileById(profileFor(m.profile, m)).name;

// The panel is not part of the search (the verdict does not depend on it, #254), but changing it updates the entry.
const sameLanding = (a, b) => a.siteId === b.siteId && a.t0 === b.t0 && a.verdict === b.verdict && (a.panel ?? null) === (b.panel ?? null);

/**
 * The list with a mission recorded: first, replacing the entry of the same search; the oldest ones drop past the
 * limit. The same list (same reference) when it is already the first one, so the caller can skip the write.
 */
export function recordMission(list, mission) {
  const entry = missionEntry(mission);
  if (!entry) return list;
  const key = missionKey(entry);
  if (list.length && missionKey(list[0]) === key && sameLanding(list[0], entry)) return list;
  return [entry, ...list.filter(x => missionKey(x) !== key)].slice(0, MAX_MISSIONS);
}

export const removeMission = (list, key) => list.filter(x => missionKey(x) !== key);

/** The stored list, newest first. Anything that is not a mission is dropped; a broken or blocked storage gives []. */
export function parseHistory(raw) {
  let data;
  try { data = JSON.parse(raw ?? '[]'); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  return data.map(missionEntry).filter(m => m && !seen.has(missionKey(m)) && seen.add(missionKey(m))).slice(0, MAX_MISSIONS);
}

/**
 * The history over a storage (localStorage, or null). It reads the storage before each change, so two tabs do not
 * overwrite each other; if the storage is missing or refuses to write (private window), the list lasts this visit.
 * onChange is called after each change.
 */
export function createMissionHistory(storage, { now = Date.now, onChange = () => {} } = {}) {
  let memory = [], persisted = true;
  const read = () => {
    if (!storage || !persisted) return memory;
    try { memory = parseHistory(storage.getItem(STORAGE_KEY)); } catch { persisted = false; }
    return memory;
  };
  const write = list => {
    if (list === memory) return;
    memory = list;
    if (storage) try { storage.setItem(STORAGE_KEY, JSON.stringify(list)); persisted = true; } catch { persisted = false; }
    onChange(list);
  };
  read();
  return {
    list: read,
    record: mission => write(recordMission(read(), { ...mission, savedAt: now() })),
    remove: key => write(removeMission(read(), key)),
    clear: () => { read(); write([]); },
    set onChange(fn) { onChange = fn; },
  };
}
