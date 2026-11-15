// Coherence of the spacecraft's requirements (#252): which combinations cannot happen (block) and which are unlikely
// (warn, with their source). Pure: no DOM. It only looks at the input, never at a verdict.
//
//   checkCoherence(ship) → [{ id, title, level: 'block' | 'warn', field, fields, message, source, skippable, key }]
//
// ship: { days, batteryHours, minEarthPct, maxEarthGapHours, transitDays, panelHeightM, antennaHeightM, craftClass },
// numbers, or undefined for an empty field (an empty field is not an issue here: Plan asks for it on its own).
// field: the requirement the message goes under; fields: every requirement the rule crosses (a change in any of them
// brings a skipped block back, through its key). Blocks of C0 (limits of the data API) and C1 (values that mean nothing)
// cannot be skipped; the rest of the blocks can, with «Continuar de todos modos» (applySkips).
// Every text is in the dictionary (i18n/plan.js, plan.coherence.…), like the names of catalog.js: Spanish under node.
//
// The battery (#253): with ship.autonomy === 'battery' the hours without the Sun come out of the battery (batteryHours
// is then the result of engine/battery.js) and rules B1–B6 look at it: batteryWh, batteryDod (0–1), batteryLoadW,
// batteryWhPerKg, batteryKg and dryMassKg, each a number or undefined. B2 and B3 blocks (values the formula cannot use)
// cannot be skipped; B1, B4 and B5 can. In that mode B6 (with the mass it implies) says what C8 says, so C8 is left out.
//
// The solar panel (#254): ship.panel (engine/panel.js) and ship.siteLatDeg, the latitude of the site of the search (the
// one nearest the equator of the zone). C13 only warns: the orientation changes the energy, never the verdict.
import { fmtNum } from '../../../shared/format/number.js';
import { API_LIMITS } from '../ports/visibility.js';
import { t } from '../common/i18n.js';
import { describeBattery } from './battery.js';
import { panelUselessAt, POLAR_PANEL_LAT_DEG, maxSunElevationDeg, horizontalMaxPct } from './panel.js';

const C = (key, ...args) => t(`plan.coherence.${key}`, ...args);

/** Classes of spacecraft of the own spacecraft: they only set the believable ranges, never the calculation. */
export const CRAFT_CLASSES = ['small-lander', 'medium-lander', 'crewed', 'rover'].map(id => ({ id, name: C(`class.${id}`) }));

const threshold = (key, value, extra = {}) => ({ value, ...extra, source: C(`src.${key}`) });
/** Every threshold of the rules, with the source it comes from (decision of 2026-11-14 in #252). */
export const THRESHOLDS = {
  minTransitDays: threshold('minTransitDays', 3),
  slowTransitDays: threshold('slowTransitDays', 150),
  smallLanderHeightM: threshold('smallLanderHeightM', 2.5),
  mediumLanderHeightM: threshold('mediumLanderHeightM', 5),
  mastHeightM: threshold('mastHeightM', 20),
  maxHeightM: threshold('maxHeightM', 55),
  lowHeightM: threshold('lowHeightM', 1),
  lunarNightHours: threshold('lunarNightHours', 354),
  longAutonomyHours: threshold('longAutonomyHours', 72),
  minEarthPct: threshold('minEarthPct', 25),
  tightEarthGapHours: threshold('tightEarthGapHours', 24, { longMissionDays: 7 }),
  crewedDays: threshold('crewedDays', 7),
  solarLanderDays: threshold('solarLanderDays', 14),
  // The battery (#253).
  packWhPerKg: threshold('packWhPerKg', 80, { max: 220, block: 300 }),
  depthOfDischarge: threshold('depthOfDischarge', 0.5, { max: 0.9 }),
  survivalLoadW: threshold('survivalLoadW', 5, { max: 300 }),
  batteryMassFraction: threshold('batteryMassFraction', 0.15, { block: 0.5 }),
  batteryMismatch: threshold('batteryMismatch', 0.05),
  nightBattery: threshold('nightBattery', 354),
  // The solar panel (#254).
  polarPanelLatDeg: threshold('polarPanelLatDeg', POLAR_PANEL_LAT_DEG),
};

const LOGIC = C('logic');
const RULES = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
/** The name of a rule, for the list of skipped rules. */
export const ruleTitle = id => (RULES.includes(id) ? C(`rule.${id}`) : id);

const UNITS = { days: 'd', batteryHours: 'h', minEarthPct: '%', maxEarthGapHours: 'h', transitDays: 'd', panelHeightM: 'm', antennaHeightM: 'm',
  // The battery (#253): only with ship.autonomy === 'battery'. The depth of discharge is a fraction, without a unit.
  batteryWh: 'Wh', batteryDod: '', batteryLoadW: 'W', batteryWhPerKg: 'Wh/kg', batteryKg: 'kg', dryMassKg: 'kg' };
/** The requirements that go to the API (C0, C1); the battery ones have their own rules. */
const REQUIREMENT_FIELDS = ['days', 'batteryHours', 'minEarthPct', 'maxEarthGapHours', 'transitDays', 'panelHeightM', 'antennaHeightM'];
/** The fields of the battery, in the order of the form. */
export const BATTERY_FIELDS = ['batteryWh', 'batteryLoadW', 'batteryDod', 'batteryWhPerKg', 'batteryKg', 'dryMassKg'];
/** How each requirement is called on screen, with its unit: [label, unit, inside a sentence]. */
export const FIELD_LABELS = Object.fromEntries(Object.entries(UNITS).map(([f, unit]) => [f, [C(`field.${f}.label`), unit, C(`field.${f}.named`)]]));
/** «el tránsito (2 d)»: a requirement and its value, inside a sentence. */
const named = (ship, f, v = ship[f]) => `${FIELD_LABELS[f][2]} (${withUnit(v, f)})`;
/** «20 000 Wh», «0,9»: a value with the unit of its field. */
const withUnit = (v, f, digits = 2) => (FIELD_LABELS[f][1] ? `${fmtNum(v, digits)} ${FIELD_LABELS[f][1]}` : fmtNum(v, digits));
/** «20 000 Wh × 0,9 / 46 W = 391,3 h»: how the battery gives its hours, for the messages and the form. */
export const batteryCalc = ({ capacityWh, depthOfDischarge, survivalLoadW, hours }) =>
  `${fmtNum(capacityWh, 1)} Wh × ${fmtNum(depthOfDischarge, 2)} / ${fmtNum(survivalLoadW, 2)} W = ${fmtNum(hours, 1)} h`;
const cap = s => s[0].toUpperCase() + s.slice(1);
const given = v => typeof v === 'number' && Number.isFinite(v);
const HEIGHTS = ['panelHeightM', 'antennaHeightM'];

/** C1: what the engine cannot compute at all. */
function meaningless(f, v) {
  if (['days', 'transitDays', ...HEIGHTS].includes(f)) return v <= 0 ? C('why.positive') : null;
  if (f === 'minEarthPct') return v < 0 || v > 100 ? C('why.pct') : null;
  return v < 0 ? C('why.negative') : null;
}

/** The issues of a spacecraft, the blocks first. */
export function checkCoherence(ship) {
  const out = [], bad = new Set();
  const issue = (id, level, fields, message, source, skippable = level === 'block') => out.push({
    id, title: ruleTitle(id), level, field: fields[0], fields, message, source, skippable,
    key: `${id}|${fields.map(f => `${f}=${ship[f]}`).join('|')}`,
  });
  // C1 and C0, field by field: a field that fails them is left out of every other rule.
  const battery = ship.autonomy === 'battery';
  // With the battery, the hours are its result: a C0 or C1 on them also crosses the three values they come from.
  const HOURS_FROM = battery ? ['batteryHours', 'batteryWh', 'batteryDod', 'batteryLoadW', 'batteryKg', 'batteryWhPerKg'] : ['batteryHours'];
  const fieldsOf = f => (f === 'batteryHours' ? HOURS_FROM : [f]);
  const pack = battery ? describeBattery({ capacityWh: ship.batteryWh, depthOfDischarge: ship.batteryDod, survivalLoadW: ship.batteryLoadW,
    whPerKg: ship.batteryWhPerKg, batteryKg: ship.batteryKg }) : null;
  const calc = () => batteryCalc({ capacityWh: pack.capacityWh, depthOfDischarge: ship.batteryDod, survivalLoadW: ship.batteryLoadW, hours: ship.batteryHours });
  for (const f of REQUIREMENT_FIELDS) {
    const v = ship[f];
    if (!given(v)) continue;
    const why = meaningless(f, v);
    if (why) { bad.add(f); issue('C1', 'block', fieldsOf(f), C('msg.C1', { field: FIELD_LABELS[f][0], why }), LOGIC, false); continue; }
    const lim = API_LIMITS[f];
    if (lim && (v < lim.min || v > lim.max)) {
      bad.add(f);
      const msg = battery && f === 'batteryHours' && pack.capacityWh != null
        ? C('msg.C0battery', { calc: calc(), max: fmtNum(lim.max, 2) })
        : C('msg.C0', { field: FIELD_LABELS[f][0], value: fmtNum(v, 2), unit: FIELD_LABELS[f][1], min: fmtNum(lim.min, 2), max: fmtNum(lim.max, 2) });
      issue('C0', 'block', fieldsOf(f), msg, C('apiLimit', { routes: lim.routes }), false);
    }
  }
  if (battery) batteryRules(ship, pack, issue, bad);
  const has = (...fs) => fs.every(f => given(ship[f]) && !bad.has(f));
  const T = THRESHOLDS, cls = ship.craftClass ?? null;
  const missionHours = has('days') ? ship.days * 24 : null;

  // C4: the gap allowed is more than all the time without the Earth the % lets happen.
  if (has('days', 'minEarthPct', 'maxEarthGapHours')) {
    const allowed = (1 - ship.minEarthPct / 100) * missionHours;
    if (ship.maxEarthGapHours > allowed) issue('C4', 'block', ['maxEarthGapHours', 'minEarthPct', 'days'],
      C('msg.C4', { gap: cap(named(ship, 'maxEarthGapHours')), pct: named(ship, 'minEarthPct'), days: fmtNum(ship.days, 2), allowed: fmtNum(allowed, 1) }), LOGIC);
  }
  // C5: the transit.
  if (has('transitDays')) {
    if (ship.transitDays < T.minTransitDays.value) issue('C5', 'block', ['transitDays'],
      C('msg.C5fast', { transit: cap(named(ship, 'transitDays')), min: fmtNum(T.minTransitDays.value) }), T.minTransitDays.source);
    else if (ship.transitDays > T.slowTransitDays.value) issue('C5', 'warn', ['transitDays'],
      C('msg.C5slow', { transit: cap(named(ship, 'transitDays')), max: fmtNum(T.slowTransitDays.value) }), T.slowTransitDays.source);
  }
  // C6 and C7: each height, by the class of spacecraft.
  for (const f of HEIGHTS) {
    if (!has(f)) continue;
    const h = ship[f];
    if (h > T.maxHeightM.value) issue('C6', 'block', [f], C('msg.C6max', { height: cap(named(ship, f)), max: fmtNum(T.maxHeightM.value) }), T.maxHeightM.source);
    else if (h > T.mastHeightM.value && cls !== 'crewed') issue('C6', 'warn', [f], C('msg.C6mast', { height: cap(named(ship, f)), max: fmtNum(T.mastHeightM.value) }), T.mastHeightM.source);
    else if (cls === 'small-lander' && h > T.smallLanderHeightM.value) issue('C6', 'warn', [f], C('msg.C6small', { height: cap(named(ship, f)), max: fmtNum(T.smallLanderHeightM.value) }), T.smallLanderHeightM.source);
    else if (cls === 'medium-lander' && h > T.mediumLanderHeightM.value) issue('C6', 'warn', [f], C('msg.C6medium', { height: cap(named(ship, f)), max: fmtNum(T.mediumLanderHeightM.value) }), T.mediumLanderHeightM.source);
    if (h < T.lowHeightM.value) issue('C7', 'warn', [f], C('msg.C7', { height: named(ship, f), min: fmtNum(T.lowHeightM.value) }), T.lowHeightM.source);
  }
  // C2 and C3: limits longer than the mission stop telling sites apart.
  if (has('days', 'batteryHours') && ship.batteryHours > missionHours) issue('C2', 'warn', ['batteryHours', 'days'],
    C('msg.C2', { battery: cap(named(ship, 'batteryHours')), mission: fmtNum(missionHours, 1) }), LOGIC);
  if (has('days', 'maxEarthGapHours') && ship.maxEarthGapHours > missionHours) issue('C3', 'warn', ['maxEarthGapHours', 'days'],
    C('msg.C3', { gap: cap(named(ship, 'maxEarthGapHours')), mission: fmtNum(missionHours, 1) }), LOGIC);
  // C8 and C9: the battery.
  if (has('batteryHours')) {
    if (ship.batteryHours >= T.lunarNightHours.value) { if (!battery) issue('C8', 'warn', ['batteryHours'],
      C('msg.C8', { hours: fmtNum(ship.batteryHours) }), T.lunarNightHours.source); }
    else if (ship.batteryHours > T.longAutonomyHours.value) issue('C9', 'warn', ['batteryHours'],
      C('msg.C9', { hours: fmtNum(ship.batteryHours), max: fmtNum(T.longAutonomyHours.value) }), T.longAutonomyHours.source);
  }
  // C10 and C11: the Earth.
  if (has('minEarthPct') && ship.minEarthPct < T.minEarthPct.value) issue('C10', 'warn', ['minEarthPct'],
    C('msg.C10', { pct: cap(named(ship, 'minEarthPct')), min: fmtNum(T.minEarthPct.value) }), T.minEarthPct.source);
  if (has('days', 'maxEarthGapHours') && ship.maxEarthGapHours < T.tightEarthGapHours.value && ship.days > T.tightEarthGapHours.longMissionDays)
    issue('C11', 'warn', ['maxEarthGapHours', 'days'],
      C('msg.C11', { gap: cap(named(ship, 'maxEarthGapHours')), days: fmtNum(T.tightEarthGapHours.longMissionDays) }), T.tightEarthGapHours.source);
  // C12: how long each class lasts.
  if (has('days') && cls === 'crewed' && ship.days > T.crewedDays.value) issue('C12', 'warn', ['days'],
    C('msg.C12crewed', { days: fmtNum(ship.days, 2), max: fmtNum(T.crewedDays.value) }), T.crewedDays.source);
  if (has('days') && (cls === 'small-lander' || cls === 'medium-lander') && ship.days > T.solarLanderDays.value
    && !(has('batteryHours') && ship.batteryHours >= T.lunarNightHours.value)) issue('C12', 'warn', ['days', 'batteryHours'],
    C('msg.C12solar', { days: fmtNum(ship.days, 2), night: fmtNum(T.lunarNightHours.value) }), T.solarLanderDays.source);
  // C13: a horizontal panel where the Sun grazes the horizon (#254). Only a warning, with the figure of that latitude.
  if (panelUselessAt(ship.panel, ship.siteLatDeg)) issue('C13', 'warn', ['panel'],
    C('msg.C13', { lat: fmtNum(Math.abs(ship.siteLatDeg), 1), min: fmtNum(T.polarPanelLatDeg.value),
      sun: fmtNum(maxSunElevationDeg(ship.siteLatDeg), 1), pct: fmtNum(horizontalMaxPct(ship.siteLatDeg), 1) }), T.polarPanelLatDeg.source);
  return [...out.filter(i => i.level === 'block'), ...out.filter(i => i.level !== 'block')];
}

/** B1–B6 (#253): the battery the hours come from. `pack` is describeBattery of its values; `bad` gets the fields that fail. */
function batteryRules(ship, pack, issue, bad) {
  const T = THRESHOLDS, cls = ship.craftClass ?? null;
  const has = (...fs) => fs.every(f => given(ship[f]) && !bad.has(f));
  // Values that mean nothing (C1): a capacity, a mass or a specific energy of 0 or less.
  for (const f of ['batteryWh', 'batteryWhPerKg', 'batteryKg', 'dryMassKg']) {
    if (given(ship[f]) && ship[f] <= 0) { bad.add(f); issue('C1', 'block', [f], C('msg.C1', { field: FIELD_LABELS[f][0], why: C('why.positive') }), LOGIC, false); }
  }
  // B2: the depth of discharge. ≤ 0 or > 1, the formula gives nothing: it cannot be skipped.
  if (given(ship.batteryDod)) {
    const d = ship.batteryDod, dod = cap(named(ship, 'batteryDod'));
    if (d <= 0 || d > 1) { bad.add('batteryDod'); issue('B2', 'block', ['batteryDod'], C('msg.B2block', { dod }), LOGIC, false); }
    else if (d > T.depthOfDischarge.max) issue('B2', 'warn', ['batteryDod'], C('msg.B2high', { dod, max: fmtNum(T.depthOfDischarge.max) }), T.depthOfDischarge.source);
    else if (d < T.depthOfDischarge.value) issue('B2', 'warn', ['batteryDod'], C('msg.B2low', { dod, min: fmtNum(T.depthOfDischarge.value) }), T.depthOfDischarge.source);
  }
  // B3: the survival load. ≤ 0 W, the hours would be infinite: it cannot be skipped.
  if (given(ship.batteryLoadW)) {
    const w = ship.batteryLoadW, load = cap(named(ship, 'batteryLoadW'));
    if (w <= 0) { bad.add('batteryLoadW'); issue('B3', 'block', ['batteryLoadW'], C('msg.B3block', { load }), LOGIC, false); }
    else if (w < T.survivalLoadW.value) issue('B3', 'warn', ['batteryLoadW'], C('msg.B3low', { load, min: fmtNum(T.survivalLoadW.value) }), T.survivalLoadW.source);
    else if (w > T.survivalLoadW.max && cls !== 'crewed') issue('B3', 'warn', ['batteryLoadW'], C('msg.B3high', { load, max: fmtNum(T.survivalLoadW.max) }), T.survivalLoadW.source);
  }
  const MASS = ['batteryWh', 'batteryKg', 'batteryWhPerKg'];
  // B5: the three given at once must agree.
  if (has(...MASS)) {
    const fromMass = ship.batteryKg * ship.batteryWhPerKg;
    if (Math.abs(fromMass - ship.batteryWh) / ship.batteryWh > T.batteryMismatch.value) issue('B5', 'block', MASS,
      C('msg.B5', { wh: cap(named(ship, 'batteryWh')), kg: named(ship, 'batteryKg'), spec: named(ship, 'batteryWhPerKg'), fromMass: fmtNum(fromMass, 0), pct: fmtNum(T.batteryMismatch.value * 100) }), T.batteryMismatch.source);
  }
  // B1: the specific energy of the pack, given or deduced from the capacity and the mass (the default one is believable).
  const specGiven = has('batteryWhPerKg'), specDeduced = pack.deduced === 'whPerKg' && has('batteryWh', 'batteryKg');
  if (specGiven || specDeduced) {
    const s = pack.whPerKg, spec = specGiven ? cap(named(ship, 'batteryWhPerKg')) : C('deducedSpec', { spec: withUnit(s, 'batteryWhPerKg', 0) });
    const fields = specGiven ? ['batteryWhPerKg'] : ['batteryWhPerKg', 'batteryWh', 'batteryKg'];
    if (s > T.packWhPerKg.block) issue('B1', 'block', fields, C('msg.B1block', { spec, max: fmtNum(T.packWhPerKg.block) }), T.packWhPerKg.source);
    else if (s < T.packWhPerKg.value || s > T.packWhPerKg.max) issue('B1', 'warn', fields,
      C('msg.B1warn', { spec, min: fmtNum(T.packWhPerKg.value), max: fmtNum(T.packWhPerKg.max) }), T.packWhPerKg.source);
  }
  // B4: the mass of the battery (given or deduced) against the dry mass of the spacecraft.
  if (has('dryMassKg') && pack.batteryKg != null && !bad.has('batteryKg') && !bad.has('batteryWh') && !bad.has('batteryWhPerKg')) {
    const f = pack.batteryKg / ship.dryMassKg;
    const args = { kg: withUnit(pack.batteryKg, 'batteryKg', 1), dry: named(ship, 'dryMassKg'), pct: fmtNum(f * 100, 0) };
    const fields = ['batteryKg', 'dryMassKg', 'batteryWh', 'batteryWhPerKg'];
    if (f > T.batteryMassFraction.block) issue('B4', 'block', fields, C('msg.B4block', { ...args, max: fmtNum(T.batteryMassFraction.block * 100) }), T.batteryMassFraction.source);
    else if (f > T.batteryMassFraction.value) issue('B4', 'warn', fields, C('msg.B4warn', { ...args, max: fmtNum(T.batteryMassFraction.value * 100) }), T.batteryMassFraction.source);
  }
  // B6: a whole lunar night on the battery alone, with the mass it implies.
  if (has('batteryHours', 'batteryLoadW') && ship.batteryHours >= T.nightBattery.value && pack.batteryKg != null) {
    issue('B6', 'warn', ['batteryHours', 'batteryWh', 'batteryLoadW', 'batteryDod', 'batteryKg', 'batteryWhPerKg'],
      C('msg.B6', { hours: fmtNum(ship.batteryHours, 1), kg: fmtNum(pack.batteryKg, 0), perW: fmtNum(pack.batteryKg / ship.batteryLoadW, 1) }), T.nightBattery.source);
  }
}

/** The issues with the blocks the user skipped (keys in `skipped`) turned into warnings marked `skipped`. */
export const applySkips = (issues, skipped) =>
  issues.map(i => (i.level === 'block' && i.skippable && skipped.has(i.key) ? { ...i, level: 'warn', skipped: true } : i));

/** The blocks still in force: while there is one, there is no search. */
export const blockers = issues => issues.filter(i => i.level === 'block');

/** The keys of the skippable blocks whose rule is in `ids` (a plan link brings the ids of its skipped rules). */
export const skipsFor = (issues, ids) => new Set(issues.filter(i => i.level === 'block' && i.skippable && ids.includes(i.id)).map(i => i.key));

/** The rules skipped in a list of issues (after applySkips), once each: [{ id, title }]. */
export function skippedRules(issues) {
  const seen = new Map();
  for (const i of issues) if (i.skipped && !seen.has(i.id)) seen.set(i.id, { id: i.id, title: i.title });
  return [...seen.values()];
}

/** «Calculado con N regla(s) de coherencia saltada(s): …», for the result, the CSV and anything else that shows a plan. */
export const skippedNote = rules => (!rules?.length ? '' : C('note', rules.length, rules.map(r => `${r.id} (${r.title ?? ruleTitle(r.id)})`).join(', ')));
