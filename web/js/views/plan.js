// "Planificar" view: mission conditions → best option, with its landing timeline and its sky.
// Verdicts, figures, calendar and timeline come from the mission service (application/mission-service.js): the same
// visibility data and rules as Advanced and Replan. The view only reads the form and paints.
import { SITES, PROFILES, CUSTOM_PROFILE, profileById, profileFor, profileSwitchNotice, matchesProfile, requirementsOnChoose, transitNote, siteGroups, APPROXIMATE_LABEL, controlHint } from '../engine/catalog.js';
import { $, css, esc, isoLocal, verdictColor } from '../common/util.js';
import { state, actions, services, config, currentHour, optionFor, missionRange, siteById } from '../common/state.js';
import { CUSTOM_SITE_ID, customSite, parseCoords, fmtCoords, isOwnPoint } from '../common/custom-site.js';
import { adopt } from '../common/adopt.js';
import { createSkyView } from '../common/sky-view.js';
import { decorate } from '../common/explain.js';
import * as UI from '../common/ui.js';
import { ruleChecks, VERDICT_WORD } from '../common/rules.js';
import { VERDICT_TONE } from '../common/theme.js';
import { ease, tween, animatedValue, countTo, replay, mix } from '../../motion/motion.js';
import { heightsKey, DEFAULT_HEIGHT_M } from '../ports/visibility.js';
import { CRAFT_CLASSES, checkCoherence, applySkips, blockers, skipsFor, skippedRules, skippedNote, batteryCalc } from '../engine/coherence.js';
import { BATTERY_DEFAULTS, describeBattery } from '../engine/battery.js';
import { PANELS, DEFAULT_PANEL, panelOf, panelName, panelFormula, panelUselessAt } from '../engine/panel.js';
import { describeHeights } from '../application/mission-service.js';
import { regionFor, regionNear, linkSearch } from '../../../viewpoint/src/core/mission-link.js';
import { viewerLink } from '../common/viewer-link.js';
import { fmtDeg, LOW_SUN_MARGIN_DEG } from '../common/sun-elevation.js';
import { isFilled, fieldText as valueText, fieldProblem } from '../common/mission-text.js';
import { timelineSpan, fractionOf, missionWindow, landingAt, landingForKey, dayVerdict, dayLanding, verdictRuns, sunHeights, areaPath, visibleRuns, reasonStart, firstReason } from '../common/timeline.js';
import { t as tr, fmtNum, fmtHours, fmtDate, fmtDateTime, fmtDayMonth, isoDay } from '../common/i18n.js';
import { startLoading } from '../common/loading.js';
import { reasonText, lowerFirst } from '../common/rules.js';

// Texts of the point of the user's own (#101), together so they are easy to find and translate.
const OWN_TEXT = {
  option: tr('plan.own.option'), optionNote: tr('plan.own.optionNote'),
  missing: tr('plan.own.missing'),
  stepError: tr('plan.own.stepError'),
  origin: horizon => tr('plan.own.origin', { horizon }),
  noReplan: tr('plan.own.noReplan'), replan: tr('plan.own.replan'),
  horizon: {
    mask: tr('plan.own.horizonMask'),
    sphere: polar => tr('plan.own.horizonSphere', polar),
    simulated: tr('plan.own.horizonSimulated'),
  },
};
// Without terrain the horizon is flat: near the pole, where the Sun grazes it, that is far too optimistic.
const POLAR_LAT = 70;

// ---------------- Form: conditions → best option ----------------
const polarSites = () => SITES.filter(s => !s.offMap);
// «Punto propio» chosen in «¿Dónde?»: its site is state.customSite, null while the coordinates are wrong.
const ownChosen = () => state.form.site === CUSTOM_SITE_ID;
/** The site the search is fixed to (one of the catalogue or the point typed), null with «El mejor de la zona». */
const fixedSite = () => (ownChosen() ? state.customSite : state.form.site ? siteById(state.form.site) : null);

// The first time nothing is chosen: no spacecraft, no requirements, no dates and no result. «Buscar» waits for them.
export function initPlanForm(linked = null) {
  state.form.zone = new Set(polarSites().map(s => s.id));
  state.form.site = null; // null: the search picks the best site of the zone
  state.form.profile = null; $('plan-profile-live').textContent = '';
  for (const id of ['plan-from', 'plan-to', ...REQUIREMENTS]) $(id).value = '';
  $('plan-class').innerHTML = `<option value="">${esc(tr('plan.coherence.noClass'))}</option>` + CRAFT_CLASSES.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('plan-panel').innerHTML = PANELS.map(id => `<option value="${id}">${esc(panelName(id))}</option>`).join('');
  $('plan-panel').value = DEFAULT_PANEL; // a tracker: the energy as it was computed before #254
  coherence.skipped = new Set();
  paintTransitSource(null);
  fillBattery(null);
  if (linked) fillFromLink(linked);
  renderCoherence(); paintPanelNote();
  wizard.step = 1;
  wizard.step = reachable(); // a link that brings the mission starts at the first step still to do
  renderProfiles(); renderSiteOptions(); renderCalendar(); renderSteps();
}
const REQUIREMENTS = ['plan-days', 'plan-battery', 'plan-earth', 'plan-earth-gap', 'plan-transit'];

// ---------------- Steps (until the first search): spacecraft, requirements, where, when — one at a time ----------------
// After the first search the whole form stays on the left, as it was; the steps only guide the first time.
const STEPS = [{ n: 1, label: tr('plan.step.lander') }, { n: 2, label: tr('plan.step.requirements') }, { n: 3, label: tr('plan.step.where') }, { n: 4, label: tr('plan.step.when') }];
const wizard = { step: 1, open: 0 }; // open: the step unfolded from the summary bar (0: none), once there is a result
const REQUIRED = ['plan-days', 'plan-battery', 'plan-earth']; // the earth-gap limit (R6) and the transit are optional
/** What is wrong with each requirement ({ id: text }): a required one missing, or one outside the limits of its field. */
// With the battery (#253) the hours are its result: missing only while the battery does not give them, and their limits
// are said by the coherence rules (C0, with the calculation in sight).
const requirementProblems = () => Object.fromEntries(REQUIREMENTS.map(id => [id, id === 'plan-battery' && batteryMode()
  ? (batteryHours() == null ? tr('plan.battery.incomplete') : null)
  : problemText(id, fieldProblem($(id).value, { min: $(id).min, max: $(id).max, required: REQUIRED.includes(id) }))]).filter(([, p]) => p));
function problemText(id, problem) {
  if (!problem) return null;
  const label = tr(`plan.req.label.${id.slice('plan-'.length)}`), min = fmtNum(problem.min), max = fmtNum(problem.max);
  return tr(`plan.req.${problem.kind}`, { label, min, max });
}
// A value out of range is not searched with (it used to be clamped in silence, so the plan was not the one on screen).
const requirementsFilled = () => !Object.keys(requirementProblems()).length;
// Under the requirements, what is wrong. Before the first search an empty field is only «not yet» («Siguiente» says
// it); with a result on screen, the plan stays the last valid one and says so.
// A value out of the API's limits or meaningless is already said under its field by the coherence rules (C0, C1 of
// #252): it is not said twice. A field is invalid if either says so; with a result, a block also keeps the last plan.
function paintRequirementProblems() {
  const result = !!state.searchResult, problems = requirementProblems(), blocks = blockers(issues());
  const fieldBlocked = id => blocks.some(i => COHERENCE_FIELDS[i.field] === id);
  const saidBelow = id => blocks.some(i => !i.skippable && COHERENCE_FIELDS[i.field] === id);
  const shown = REQUIREMENTS.filter(id => problems[id] && (result || isFilled($(id).value)) && !saidBelow(id));
  REQUIREMENTS.forEach(id => $(id).setAttribute('aria-invalid', String(shown.includes(id) || fieldBlocked(id))));
  const keepsLast = result && (shown.length || blocks.length) ? tr('plan.req.keepsLast') : '';
  $('plan-req-error').textContent = shown.length ? `${shown.map(id => problems[id]).join('. ')}.${keepsLast}` : keepsLast.trim();
}
function stepDone(n) {
  if (n === 1) return !!state.form.profile || requirementsFilled();
  if (n === 2) return requirementsFilled() && !blocked();
  if (n === 3) return !ownChosen() || !!state.customSite; // a site, «El mejor de la zona» (by default) or valid coordinates
  return !!$('plan-from').value && !!$('plan-to').value;
}
/** Furthest step you can go to: the first one not done yet. */
const reachable = () => STEPS.find(x => !stepDone(x.n))?.n ?? 4;
function stepSummary(n) {
  const result = !!state.searchResult;
  if (n === 1) return profileById(state.form.profile).name;
  if (n === 2) {
    // With a result, the requirements of the plan on screen: the fields may hold a value not searched yet, or a wrong one.
    const c = result ? state.searchResult.conditions : null;
    if (c) return tr('plan.summary.requirements', { days: fmtNum(c.days), battery: fmtNum(c.batteryHours), earth: fmtNum(c.minEarthPct) })
      + (Number.isFinite(c.maxEarthGapHours) ? tr('plan.summary.gap', { h: fmtNum(c.maxEarthGapHours) }) : '');
    const gap = filled('plan-earth-gap') ? tr('plan.summary.gap', { h: fieldText('plan-earth-gap') }) : '';
    return tr('plan.summary.requirements', { days: fieldText('plan-days'), battery: fieldText('plan-battery'), earth: fieldText('plan-earth') }) + (result ? gap : '');
  }
  if (n === 3) {
    if (state.form.site) { const f = fixedSite(); return !f ? OWN_TEXT.option : isOwnPoint(f) ? `${f.short} · ${fmtCoords(f)}` : f.short; }
    const chosen = result && siteById(state.selected[0]);
    return chosen ? `${tr('plan.bestOfZone')} → ${chosen.short}` : tr('plan.bestOfZone');
  }
  const range = `${fmtDate(dayMs($('plan-from').value))} → ${fmtDate(dayMs($('plan-to').value))}`;
  const t0 = result ? state.cache[state.selected[0]]?.t0 : null;
  return t0 != null ? tr('plan.summary.lands', { range, day: shortDay(t0), hour: hh(t0) }) : range;
}
const shortDay = fmtDayMonth;

// After the first search the form folds into the four step chips, as a summary bar over the result. Each chip opens
// its step alone, floating under the bar; a change recalculates the plan behind it (refreshPlan).
function renderSummaryBar() {
  $('view-plan').dataset.step = '';
  $('plan-step-nav').hidden = true;
  document.querySelectorAll('#plan-form [data-step]').forEach(el => {
    el.classList.remove('is-step-hidden');
    el.classList.toggle('is-open', +el.dataset.step === wizard.open);
  });
  $('plan-steps').innerHTML = STEPS.map(x => {
    const open = x.n === wizard.open;
    return `<li class="plan-step is-done${open ? ' is-current' : ''}"><button type="button" data-goto="${x.n}" aria-expanded="${open}" aria-controls="plan-step-${x.n}">
      <span class="plan-step__n" aria-hidden="true">✓</span>
      <span class="plan-step__label">${x.label}</span><span class="plan-step__edit" aria-hidden="true">${open ? tr('plan.close') : tr('plan.change')}</span>
      <small>${esc(stepSummary(x.n))}</small></button></li>`;
  }).join('');
  const panel = document.querySelector(`#plan-form [data-step="${wizard.open}"]`);
  if (panel) {
    // Under its chip, without going past the right edge of the bar.
    const bar = $('plan-form').getBoundingClientRect(), chip = $('plan-steps').children[wizard.open - 1].getBoundingClientRect();
    panel.style.left = `${Math.max(0, Math.min(chip.left - bar.left, bar.width - panel.offsetWidth))}px`;
  }
}
function toggleStep(n) {
  wizard.open = wizard.open === n ? 0 : n;
  if (wizard.open === 4) renderCalendar();
  renderSteps(); decorate();
  if (wizard.open) document.querySelector(`#plan-form [data-step="${wizard.open}"]`)?.querySelector('button, input')?.focus({ preventScroll: true });
}
function closeStep() { if (wizard.open) { wizard.open = 0; picker.hover = null; renderSteps(); paintPreview(); } }
// «Cambiar fechas» next to the landing: the same «Cuándo» step as its chip, which on a phone may be scrolled out of view.
$('res-change-dates').addEventListener('click', () => {
  if (wizard.open !== 4) toggleStep(4);
  $('plan-form').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
// Esc or a click outside the bar folds the open step back into its chip. pointerdown, not click: the calendar repaints
// on click and its old cell would no longer be inside the form.
document.addEventListener('keydown', e => { if (e.key === 'Escape' && wizard.open) { const n = wizard.open; closeStep(); $('plan-steps').children[n - 1]?.querySelector('button')?.focus(); } });
document.addEventListener('pointerdown', e => { if (wizard.open && !e.target.closest('#plan-form, .explain-card, .tour')) closeStep(); });

function renderSteps() {
  const intro = !state.searchResult;
  paintRequirementProblems();
  $('plan-steps').hidden = false;
  if (!intro) return renderSummaryBar();
  $('plan-step-nav').hidden = false;
  $('view-plan').dataset.step = wizard.step;
  document.querySelectorAll('#plan-form [data-step]').forEach(el => { el.classList.toggle('is-step-hidden', +el.dataset.step !== wizard.step); el.classList.remove('is-open'); });
  const far = reachable();
  $('plan-steps').innerHTML = STEPS.map(x => {
    const status = x.n === wizard.step ? 'current' : x.n < wizard.step && stepDone(x.n) ? 'done' : 'todo';
    return `<li class="plan-step is-${status}"><button type="button" data-goto="${x.n}"${x.n > far && x.n !== wizard.step ? ' disabled' : ''}${status === 'current' ? ' aria-current="step"' : ''}>
      <span class="plan-step__n" aria-hidden="true">${status === 'done' ? '✓' : x.n}</span>
      <span class="plan-step__label">${x.label}</span>${status === 'done' ? `<small>${esc(stepSummary(x.n))}</small>` : ''}</button></li>`;
  }).join('');
  $('plan-step-back').hidden = wizard.step === 1;
  $('plan-step-next').hidden = wizard.step === 4;
  // «Siguiente» is never disabled: pressed too early, it says in red what is missing (showStepError).
  if (stepDone(wizard.step)) clearStepError();
}
function goToStep(n) {
  clearStepError();
  wizard.step = Math.max(1, Math.min(n, reachable(), 4));
  renderSteps();
  if (wizard.step === 4) renderCalendar();
  decorate();
  document.querySelector(`#plan-form [data-step="${wizard.step}"]`)?.querySelector('button, input')?.focus({ preventScroll: true });
}
const STEP_ERRORS = { 1: tr('plan.error.lander'), 2: tr('plan.error.requirements'), 3: OWN_TEXT.stepError, 4: tr('plan.error.dates') };
function showStepError() {
  if (wizard.step === 3) readOwnPoint(true);
  $('plan-step-error').textContent = wizard.step === 2 && requirementsFilled() && blocked() ? COHERENCE_TEXT.stepError : STEP_ERRORS[wizard.step] ?? '';
  document.querySelector(`#plan-form fieldset[data-step="${wizard.step}"]`)?.classList.add('is-invalid');
}
function clearStepError() {
  $('plan-step-error').textContent = '';
  document.querySelectorAll('#plan-form fieldset.is-invalid').forEach(f => f.classList.remove('is-invalid'));
}
$('plan-step-next').addEventListener('click', () => (stepDone(wizard.step) ? goToStep(wizard.step + 1) : showStepError()));
$('plan-step-back').addEventListener('click', () => goToStep(wizard.step - 1));
$('plan-steps').addEventListener('click', e => {
  const b = e.target.closest('[data-goto]'); if (!b || b.disabled) return;
  if (state.searchResult) toggleStep(+b.dataset.goto); else goToStep(+b.dataset.goto);
});
const filled = id => isFilled($(id).value);
/** A field's number as the summary shows it; «—» while it is empty, so a cleared field does not read as 0. */
const fieldText = id => valueText($(id).value);
/** What is still missing before a search: null when the form is complete. The earth-gap limit (R6) is optional. */
function missing() {
  if (!requirementsFilled()) return 'lander';
  if (blocked()) return 'blocked';
  if (ownChosen() && !state.customSite) return 'own';
  if (!$('plan-from').value || !$('plan-to').value) return 'dates';
  return null;
}
// There is no search button: the second day of the window searches (the calendar), and once there is a result any
// change of spacecraft, requirements or site searches again on its own.
let refreshTimer = 0;
function refreshPlan() {
  renderSteps();
  if (!state.searchResult || missing()) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(runSearch, 300); // typing a number fires one search, not one per key
}
// A plan that comes back in the URL (from the 3D viewer, V1.1 #72): its spacecraft, its search (the window and «El mejor
// de la zona», when the link brings them; if not, its site and a window around its landing). adoptLinked() then makes
// that landing the plan once the search is done.
function fillFromLink(p) {
  if (p.siteId === CUSTOM_SITE_ID) {
    $('plan-own-lat').value = p.lat; $('plan-own-lon').value = p.lon;
    state.customSite = customSite(p.lat, p.lon);
  }
  state.form.site = p.pickBest ? null : p.siteId;
  // A profile that is not an example one (or none, in older links), or one whose requirements were changed by hand, is
  // the user's own spacecraft (#251).
  state.form.profile = profileFor(p.profile, p);
  $('plan-days').value = p.days; $('plan-battery').value = p.batteryHours; $('plan-earth').value = p.minEarthPct;
  $('plan-earth-gap').value = p.maxEarthGapHours ?? '';
  const profile = profileById(state.form.profile);
  // Without a transit, the one of the spacecraft the link names, even if a requirement was changed by hand.
  $('plan-transit').value = p.transitDays ?? PROFILES.find(x => x.id === p.profile)?.transitDays ?? '';
  paintTransitSource(profile);
  // The class the plan was computed with (the user's own spacecraft has none of its own); older links, the profile's.
  $('plan-class').value = p.craftClass ?? profile.craftClass ?? '';
  // How its solar panel is mounted (#254); older links, the spacecraft they name, or a tracker.
  $('plan-panel').value = panelOf(p.panel) ?? PROFILES.find(x => x.id === p.profile)?.panel ?? DEFAULT_PANEL;
  // The battery the hours came from (#253): with it, the hours are worked out again from it.
  fillBattery(state.form.profile === CUSTOM_PROFILE.id ? p.battery : null);
  restoreSkips(p.skippedRules);
  // The window of the search, if the landing is in it (a delayed plan from Replan may fall outside): if not, one around it.
  const day = isoDay(p.t0), inWindow = p.from && p.from <= day && day <= p.to;
  $('plan-from').value = inWindow ? p.from : isoDay(p.t0 - 7 * 864e5); $('plan-to').value = inWindow ? p.to : isoDay(p.t0 + 14 * 864e5);
}
export function adoptLinked(p) {
  const s = p.siteId === CUSTOM_SITE_ID ? state.customSite : siteById(p.siteId), res = state.searchResult;
  if (!s || !res) return;
  // The same search gives the same answer: if the plan was its best option, the search has already adopted it.
  if (res.best.site.id === s.id && res.best.landing === p.t0) return;
  const o = res.options.find(x => x.site.id === s.id && x.landing === p.t0);
  adopt(o ?? { site: s, landing: p.t0, reasons: [], robustness: null }, undefined, false);
}
// A mission of the history (#246): the form takes its parameters, the search runs again and its landing is the plan.
// The same path as a plan in the URL, plus what a link does not carry: the heights and the site the search was fixed to.
export async function openMission(m) {
  clearTimeout(refreshTimer);
  state.form.profile = null; // fillFromLink sets it: the mission's profile, or the user's own spacecraft
  $('plan-profile-live').textContent = '';
  fillFromLink({ ...m, pickBest: !m.searchSiteId });
  state.form.site = SITES.some(s => s.id === m.searchSiteId) ? m.searchSiteId : null;
  state.customSite = null; // the history keeps no points of the user's own
  $('plan-panel-height').value = m.panelHeightM ?? DEFAULT_HEIGHT_M; $('plan-antenna-height').value = m.antennaHeightM ?? DEFAULT_HEIGHT_M;
  restoreSkips(m.skippedRules); // again, with the heights of the mission
  renderCoherence();
  wizard.open = 0; wizard.step = 4; picker.month = null; picker.hover = null;
  clearStepError(); renderProfiles(); renderSiteOptions(); renderCalendar();
  if (location.hash !== '#plan') location.hash = '#plan';
  const before = state.searchResult;
  await runSearch();
  if (state.searchResult !== before) adoptLinked(m); // the search failed (no data): nothing to adopt
}
// The plan on screen goes to the history: its search and the landing chosen. Points added on the map are not kept
// (they do not exist in another visit).
function rememberMission(s, t0, verdict) {
  const res = state.searchResult, c = res?.conditions;
  if (!c || s.custom || !services.history) return;
  services.history.record({
    siteId: s.id, t0, days: c.days, batteryHours: c.batteryHours, minEarthPct: c.minEarthPct, maxEarthGapHours: c.maxEarthGapHours,
    transitDays: c.transitDays, ...linkSearch(res), searchSiteId: res.fixedSite ? res.best.site.id : null,
    panelHeightM: c.panelHeightM, antennaHeightM: c.antennaHeightM, verdict: verdict.code,
  });
}
function chooseProfile(id) {
  const p = profileById(id), again = state.form.profile === p.id; state.form.profile = p.id;
  $('plan-profile-live').textContent = ''; // so the next switch to «Nave propia» is a change, and is announced again
  // The user's own spacecraft (#251): its requirements are left empty to type them in (after a search, or when its card
  // was already the chosen one, the ones on screen stay); the heights keep their value.
  const values = requirementsOnChoose(p, requirementValues(), { keep: !!state.searchResult || again });
  REQUIREMENTS.forEach(r => { $(r).value = values[REQUIREMENT_OF[r]] ?? ''; });
  if (!p.custom) { $('plan-class').value = p.craftClass ?? ''; fillBattery(null); } // an example spacecraft gives its hours
  if (!p.custom) $('plan-panel').value = p.panel ?? DEFAULT_PANEL; // and its solar panel (#254)
  paintTransitSource(p);
  renderCoherence();
}
// Each requirement field and the key it has in a profile.
const REQUIREMENT_OF = { 'plan-days': 'days', 'plan-battery': 'batteryHours', 'plan-earth': 'minEarthPct', 'plan-earth-gap': 'maxEarthGapHours', 'plan-transit': 'transitDays' };
const requirementValues = () => Object.fromEntries(REQUIREMENTS.map(r => [REQUIREMENT_OF[r], $(r).value]));
// Where the transit of the spacecraft comes from (#67): it only moves the launch date.
function paintTransitSource(p) {
  $('plan-transit-source').textContent = (p && !p.custom ? tr('plan.transitFrom', { days: fmtNum(p.transitDays), source: p.transitSource }) : '') + tr('plan.transitOnly');
}
function renderProfiles() {
  $('plan-profiles').innerHTML = PROFILES.map(p => UI.option({ id: p.id, title: p.name, checked: p.id === state.form.profile,
    detail: tr('plan.profileDetail', { days: fmtNum(p.days), batteryHours: fmtNum(p.batteryHours), minEarthPct: fmtNum(p.minEarthPct), maxEarthGapHours: fmtNum(p.maxEarthGapHours), transitDays: fmtNum(p.transitDays) }) })).join('')
    + UI.option({ id: CUSTOM_PROFILE.id, title: CUSTOM_PROFILE.name, checked: state.form.profile === CUSTOM_PROFILE.id, detail: tr('plan.customProfileDetail') });
}
// A requirement changed by hand that is no longer the chosen example spacecraft's makes it the user's own (#251).
function followRequirements() {
  const p = PROFILES.find(x => x.id === state.form.profile);
  if (!p) return;
  if (matchesProfile(p, requirementValues())) return;
  state.form.profile = CUSTOM_PROFILE.id; // it keeps the class of the example spacecraft it came from ($('plan-class'))
  // Said once, on the switch: from now on the profile is already the user's own and this returns above.
  $('plan-profile-live').textContent = profileSwitchNotice(p.id, state.form.profile);
  paintTransitSource(null); renderProfiles(); decorate();
}
function planConditions() {
  const from = Date.parse($('plan-from').value + 'T00:00:00Z'), to = Date.parse($('plan-to').value + 'T12:00:00Z');
  return {
    profile: state.form.profile, priority: state.form.priority,
    sites: [...SITES.filter(s => state.form.zone.has(s.id)), ...(fixedSite() && !state.form.zone.has(fixedSite().id) ? [fixedSite()] : [])],
    from, to: Math.max(from, to),
    // What is typed, untrimmed (#252): out of range, the coherence rules block the search (C0, C1) instead.
    ...requirementsOf(shipValues()),
    // The battery the hours come from (#253): it does not go to the API, only the hours do; the link and the history keep it.
    ...(batteryMode() ? { battery: batteryInput() } : {}),
    // The coherence rules the user skipped to compute it: the result, the CSV and the link say so.
    skippedRules: skippedRules(issues()),
  };
}

// ---------------- Coherence of the requirements (#252) ----------------
// Each field shows its blocks and warnings (engine/coherence.js). A block stops the search until it is fixed or, if the
// rule allows it, skipped with «Continuar de todos modos»; changing a value it crosses brings it back (its key changes).
const COHERENCE_TEXT = {
  stepError: tr('plan.coherence.stepError'), skip: tr('plan.coherence.skip'), skipped: tr('plan.coherence.skipped'),
  block: tr('plan.coherence.block'), warn: tr('plan.coherence.warn'), source: tr('plan.coherence.source'),
  skipLabel: i => tr('plan.coherence.skipLabel', { id: i.id, title: i.title }),
};
const coherence = { skipped: new Set() };
const COHERENCE_FIELDS = { days: 'plan-days', batteryHours: 'plan-battery', minEarthPct: 'plan-earth', maxEarthGapHours: 'plan-earth-gap',
  transitDays: 'plan-transit', panelHeightM: 'plan-panel-height', antennaHeightM: 'plan-antenna-height',
  panel: 'plan-panel', // the orientation of the solar panel (#254)
  // The battery (#253).
  batteryWh: 'plan-battery-wh', batteryLoadW: 'plan-battery-load', batteryDod: 'plan-battery-dod', batteryWhPerKg: 'plan-battery-spec',
  batteryKg: 'plan-battery-kg', dryMassKg: 'plan-dry-mass' };
const numberOf = id => (filled(id) ? +$(id).value : undefined);
/** The spacecraft as typed: numbers, undefined for an empty field (an empty height is the default one). */
function shipValues() {
  const height = id => numberOf(id) ?? DEFAULT_HEIGHT_M;
  return {
    days: numberOf('plan-days'), batteryHours: numberOf('plan-battery'), minEarthPct: numberOf('plan-earth'),
    // Empty: no limit, R6 off (0 would mean «not a single hour without the Earth»).
    maxEarthGapHours: numberOf('plan-earth-gap'),
    transitDays: numberOf('plan-transit'), // empty: the domain's default (#67)
    // Where the Sun (panel) and the Earth (antenna) are seen from, in metres over the ground.
    panelHeightM: height('plan-panel-height'), antennaHeightM: height('plan-antenna-height'),
    craftClass: $('plan-class').value || null,
    // How the solar panel is mounted (#254) and, for its rule (C13), the latitude of the search's site.
    panel: panelOf($('plan-panel').value) ?? DEFAULT_PANEL, siteLatDeg: searchLatDeg(),
    // With the battery (#253), what it is made of; the hours above are already its result (syncBatteryHours).
    ...(batteryMode() ? { autonomy: 'battery', batteryWh: numberOf('plan-battery-wh'), batteryLoadW: numberOf('plan-battery-load'),
      batteryDod: numberOf('plan-battery-dod'), batteryWhPerKg: numberOf('plan-battery-spec'), batteryKg: numberOf('plan-battery-kg'),
      dryMassKg: numberOf('plan-dry-mass') } : {}),
  };
}
/** The requirements of a spacecraft, without its battery (that goes apart, as `battery`). */
const requirementsOf = ({ autonomy, batteryWh, batteryLoadW, batteryDod, batteryWhPerKg, batteryKg, dryMassKg, siteLatDeg, ...req }) => req;
/** The latitude the panel is judged at (#254): the fixed site's or, for the best of the zone, the one nearest the equator. */
function searchLatDeg() {
  const fixed = fixedSite();
  if (fixed) return fixed.lat;
  const lats = SITES.filter(s => state.form.zone.has(s.id)).map(s => s.lat);
  return lats.length ? lats.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)) : undefined;
}

// ---------------- The battery of the own spacecraft (#253) ----------------
// «Con la batería»: the hours without the Sun are worked out from it (engine/battery.js) and their field is read-only,
// with the calculation under it. Only the hours go to the API; the battery travels in the link and the history.
const BATTERY_INPUTS = { capacityWh: 'plan-battery-wh', survivalLoadW: 'plan-battery-load', depthOfDischarge: 'plan-battery-dod',
  whPerKg: 'plan-battery-spec', batteryKg: 'plan-battery-kg', dryMassKg: 'plan-dry-mass' };
const batteryMode = () => state.form.profile === CUSTOM_PROFILE.id && $('plan-autonomy').value === 'battery';
/** The battery as typed: only the values given (a link carries no empty ones). */
const batteryInput = () => Object.fromEntries(Object.entries(BATTERY_INPUTS).map(([k, id]) => [k, numberOf(id)]).filter(([, v]) => Number.isFinite(v)));
const batteryHours = () => describeBattery(batteryInput()).hours;
/** A battery to show (from a link or the history), or none: the hours are typed, and the battery fields keep the defaults. */
function fillBattery(b) {
  const values = b ?? { survivalLoadW: BATTERY_DEFAULTS.survivalLoadW, depthOfDischarge: BATTERY_DEFAULTS.depthOfDischarge };
  for (const [k, id] of Object.entries(BATTERY_INPUTS)) $(id).value = values[k] ?? '';
  $('plan-battery-spec').placeholder = String(BATTERY_DEFAULTS.whPerKg);
  $('plan-autonomy').value = b ? 'battery' : 'hours';
  syncBatteryHours();
}
/** With the battery, its hours go into «Aguanta sin Sol», which is then read-only and says how they come out. */
function syncBatteryHours() {
  const on = batteryMode();
  $('plan-autonomy-field').hidden = state.form.profile !== CUSTOM_PROFILE.id;
  $('plan-battery-group').hidden = !on;
  $('plan-battery').readOnly = on;
  if (!on) { $('plan-battery-calc').textContent = ''; $('plan-battery-mass').textContent = ''; return; }
  const input = batteryInput(), b = describeBattery(input);
  $('plan-battery').value = b.hours ?? '';
  $('plan-battery-calc').textContent = b.hours == null ? ''
    : tr('plan.battery.calc', { calc: batteryCalc({ capacityWh: b.capacityWh, depthOfDischarge: input.depthOfDischarge, survivalLoadW: input.survivalLoadW, hours: b.hours }) });
  const n = (v, d = 1) => fmtNum(v, d);
  const deduced = b.deduced === 'whPerKg' ? tr('plan.battery.deduced.whPerKg', { spec: n(b.whPerKg, 0), wh: n(b.capacityWh), kg: n(b.batteryKg) })
    : b.deduced === 'capacityWh' ? tr('plan.battery.deduced.capacityWh', { wh: n(b.capacityWh), kg: n(b.batteryKg), spec: n(b.whPerKg, 0) }) : '';
  const how = b.deduced === 'batteryKg' ? tr(b.defaulted ? 'plan.battery.how.default' : 'plan.battery.how.batteryKg', { wh: n(b.capacityWh), spec: n(b.whPerKg, 0) })
    : tr('plan.battery.how.given');
  const mass = Number.isFinite(b.batteryKg) && b.batteryKg > 0 ? tr('plan.battery.mass', { kg: n(b.batteryKg), how }) : '';
  $('plan-battery-mass').textContent = [deduced, mass].filter(Boolean).join(' ');
}
function onBatteryChange() { renderCoherence(); renderCalendar(); refreshPlan(); }
$('plan-autonomy').addEventListener('change', onBatteryChange);
Object.values(BATTERY_INPUTS).forEach(id => $(id).addEventListener('input', onBatteryChange));
/** The issues of the spacecraft on screen, with the skipped blocks as warnings. */
const issues = () => applySkips(checkCoherence(shipValues()), coherence.skipped);
const blocked = () => blockers(issues()).length > 0;
/** The rules a plan link or the history brings as skipped, on the values just filled in. */
function restoreSkips(ids) { coherence.skipped = skipsFor(checkCoherence(shipValues()), ids ?? []); }

function renderCoherence() {
  syncBatteryHours(); // the hours of the battery first (#253): the rules look at them
  const all = checkCoherence(shipValues());
  // A skipped block whose values changed is no longer there: forget it, so going back to them blocks again.
  coherence.skipped = new Set([...coherence.skipped].filter(k => all.some(i => i.key === k)));
  const list = applySkips(all, coherence.skipped);
  $('plan-class-field').hidden = state.form.profile !== CUSTOM_PROFILE.id;
  // Said in words too, not only by its colour (WCAG 1.4.1): whether it blocks, warns or was skipped.
  const label = i => (i.skipped ? COHERENCE_TEXT.skipped : i.level === 'block' ? COHERENCE_TEXT.block : COHERENCE_TEXT.warn);
  for (const [field, id] of Object.entries(COHERENCE_FIELDS)) {
    const own = list.filter(i => i.field === field);
    const html = own.map(i => `<p class="coherence-msg" data-level="${i.level}"><b>${label(i)}</b> ${esc(i.message)}
      <small>${i.id} · ${COHERENCE_TEXT.source}: ${esc(i.source)}</small>${i.level === 'block' && i.skippable
        ? `<button type="button" class="btn" data-skip="${esc(i.key)}" aria-label="${esc(COHERENCE_TEXT.skipLabel(i))}">${COHERENCE_TEXT.skip}</button>` : ''}</p>`).join('');
    const box = $(`${id}-checks`);
    if (box.innerHTML !== html) box.innerHTML = html; // unchanged: not announced again
    $(id).classList.toggle('has-block', own.some(i => i.level === 'block'));
    // A rule that crosses two requirements is said under one of them; the other one points to it too.
    const others = list.filter(i => i.field !== field && i.fields.includes(field)).map(i => `${COHERENCE_FIELDS[i.field]}-checks`);
    const base = { 'plan-panel-height': ['plan-heights-note'], 'plan-antenna-height': ['plan-heights-note'], 'plan-transit': ['plan-transit-source'],
      'plan-panel': ['plan-panel-note'] }[id] ?? [];
    $(id).setAttribute('aria-describedby', [...base, `${id}-checks`, ...new Set(others)].join(' '));
    $(id).setAttribute('aria-invalid', String(own.some(i => i.level === 'block')));
  }
}
$('plan-step-2').addEventListener('click', e => {
  const b = e.target.closest('[data-skip]'); if (!b) return;
  const issue = checkCoherence(shipValues()).find(i => i.key === b.dataset.skip);
  coherence.skipped.add(b.dataset.skip);
  renderCoherence(); clearStepError(); renderCalendar(); refreshPlan();
  if (issue) $(COHERENCE_FIELDS[issue.field]).focus(); // the button is gone: back to its field
});
// Like the other requirements: the plan on screen, its link and its history entry follow the class (refreshPlan repaints the steps).
$('plan-class').addEventListener('change', () => { renderCoherence(); renderCalendar(); refreshPlan(); });

// Under the two heights: whether the data source uses them and, if they differ from the ones on screen, how to apply them.
function paintHeightsNote() {
  const applied = state.searchResult?.conditions, form = planConditions();
  const pending = applied && heightsKey(form) !== heightsKey(applied);
  $('plan-heights-note').textContent = [describeHeights(services.mission.heightsEffect()), pending ? tr('plan.heightsPending') : ''].filter(Boolean).join(' ');
}
['plan-panel-height', 'plan-antenna-height'].forEach(id => $(id).addEventListener('input', () => { paintHeightsNote(); renderCoherence(); renderSteps(); }));
// Under the orientation of the panel (#254): it only changes the energy, and only the data API computes it (like the heights).
// Before any load the service does not know its source yet: app.js says which engine answers as soon as it knows.
let dataSource = null;
export function setDataSource(src) { dataSource = src; paintPanelNote(); }
function paintPanelNote() {
  const src = services.mission?.source ?? dataSource;
  const text = tr(src === 'fake' ? 'plan.panel.noteSimulated' : 'plan.panel.noteApi');
  if ($('plan-panel-note').textContent !== text) $('plan-panel-note').textContent = text; // a live region: only a change is announced
}
// The orientation only changes the energy, its warning, the link and the history (never the search's answer): the plan on
// screen keeps its landing and is repainted with the new panel, without searching again.
$('plan-panel').addEventListener('change', () => {
  renderCoherence();
  const res = state.searchResult;
  if (!res) return renderSteps();
  res.conditions = { ...res.conditions, panel: panelOf($('plan-panel').value) ?? DEFAULT_PANEL };
  renderPlan();
});
// Data source of the result, for the eyebrow.
export const sourceLabel = src => (src === 'api' ? tr('plan.source.api') : tr('plan.source.fake')); // the terrain depends on the server having the LOLA DEM

let searchSeq = 0;
export async function runSearch() {
  if (missing()) return;
  const cond = planConditions();
  if (!cond.sites.length || !(cond.from > 0)) return;
  const ms = services.mission, seq = ++searchSeq;
  const firstSearch = !state.searchResult;
  let formBefore = null;
  const wait = startLoading($('view-plan'));
  try {
    const range = missionRange(cond);
    await ms.prepare(range);
    if (!ms.isReady(range)) await ms.prepare(range); // another load (the calendar, other heights) landed in between
  } catch (err) {
    const message = tr('common.loadError', { message: err.message });
    $('res-reason').textContent = message;
    wait.fail(message, runSearch);
    return;
  }
  if (seq !== searchSeq) return; // a newer search is on its way
  const res = await ms.search(cond);
  if (seq !== searchSeq) return;
  wait.done();
  // Where the form is right before the layout changes (page coordinates), to move it from there.
  if (firstSearch) { const r = $('plan-form').getBoundingClientRect(); formBefore = { left: r.left, top: r.top + window.scrollY, width: r.width }; }
  // A chosen site goes first even if another one scores better: the search answers "when" for it.
  const fixed = res.options.find(o => o.site.id === fixedSite()?.id);
  if (fixed) { res.options = [fixed, ...res.options.filter(o => o !== fixed)]; res.best = fixed; res.fixedSite = true; }
  state.searchResult = res;
  pendingReveal = true; // the next paint of this view plays the search sweep
  const ops = state.searchResult.options;
  adopt(ops[0], ops.slice(0, 3).map(o => o.site.id), false, { auto: true });
  if (firstSearch) pendingMove = formBefore; // renderPlan moves it once the layout has changed
}

let pendingMove = null; // where the form was before the first search, until the view paints its new layout
// The first search: the form, alone in the middle until now, glides to the left column and the answer comes in on the
// right (FLIP: it is laid out in its final place and animated from where it was).
function moveFormAside(before) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The answer starts at the top: the button was at the bottom of the form, so bring the page back up.
  const scrolled = window.scrollY;
  window.scrollTo({ top: 0, behavior: 'instant' });
  const form = $('plan-form'), after = form.getBoundingClientRect();
  if (!before || !after.width || reduced) return;
  // In the middle the form had two columns and now one: it is not the same shape, so it slides from where it was
  // (its centre) without stretching, fading in as it lands.
  const dx = (before.left + before.width / 2) - (after.left + after.width / 2), dy = before.top - scrolled - after.top; // before.top is in page coordinates
  // The glass of the cards (backdrop-filter) is re-blurred on every frame of a moving card: off while they move.
  const view = $('view-plan'); view.classList.add('is-moving');
  form.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }],
    { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  document.querySelector('.plan-results').animate([{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }],
    { duration: 380, delay: 80, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' }).finished.finally(() => view.classList.remove('is-moving'));
}
$('plan-form').addEventListener('submit', e => {
  e.preventDefault();
  // Enter in an earlier step moves on, it does not search.
  if (!state.searchResult && wizard.step < 4) { if (stepDone(wizard.step)) goToStep(wizard.step + 1); else showStepError(); return; }
  runSearch();
});
// «¿Y si se retrasa el lanzamiento?»: try this plan in Replan with that delay. Going there makes it your plan, so
// Replan does not call it a sample.
document.querySelector('.plan-replan').addEventListener('click', e => {
  const b = e.target.closest('[data-replan-delay]'); if (!b) return;
  e.preventDefault();
  // The plan on screen (maybe moved on the timeline) is the one Replan tries, so both give the same margin.
  const s = siteById(state.selected[0]), t0 = state.cache[s.id]?.t0;
  if (isOwnPoint(s)) return; // the domain of Replan only knows the catalogue: here the chips only say what holds
  if (t0 != null && (state.plan?.site.id !== s.id || state.plan?.landing !== t0)) adopt({ site: s, landing: t0, reasons: [], robustness: null }, undefined, false);
  state.replanDelay = +b.dataset.replanDelay; state.planAdoptedByUser = true;
  location.hash = '#replan';
});
$('plan-profiles').addEventListener('click', e => { const b = e.target.closest('.option'); if (!b || e.target.closest('.explain-btn')) return; chooseProfile(b.dataset.id); renderProfiles(); renderCalendar(); decorate(); refreshPlan();
  if (!state.searchResult && wizard.step === 1) goToStep(2); // its requirements come filled in: check them next
});

// ---------------- Where: a fixed site, or the best of the zone ----------------
function renderSiteOptions() {
  const opt = (id, name, note) => `<button type="button" class="site-option" role="radio" aria-checked="${state.form.site === id}" data-site="${id ?? ''}"><b>${esc(name)}</b>${note ? `<span>${esc(note)}</span>` : ''}</button>`;
  const group = g => `<div class="site-group" role="group" aria-label="${esc(g.label)}"><span class="site-group-label" aria-hidden="true">${esc(g.label)}</span>${g.sites.map(s => opt(s.id, s.short, s.approximate ? APPROXIMATE_LABEL : controlHint(s) || null)).join('')}</div>`;
  $('plan-sites').innerHTML = opt(null, tr('plan.bestOfZone'), tr('plan.bestOfZoneNote')) + siteGroups().map(group).join('')
    + opt(CUSTOM_SITE_ID, OWN_TEXT.option, OWN_TEXT.optionNote);
  $('plan-own').hidden = !ownChosen();
  renderSteps();
}
$('plan-sites').addEventListener('click', e => {
  const b = e.target.closest('.site-option'); if (!b || e.target.closest('.explain-btn')) return;
  state.form.site = b.dataset.site || null;
  // Only the point chosen is loaded with the catalogue: the coordinates stay in their fields for when it is chosen again.
  if (ownChosen()) readOwnPoint(false); else state.customSite = null;
  renderSiteOptions(); renderCoherence(); renderCalendar(); decorate(); refreshPlan();
  if (ownChosen() && !state.customSite) $('plan-own-lat').focus();
});
// The point typed: valid coordinates are the site of the search; each wrong field says why under it, once it has text
// (or, with `all`, also the empty ones: «Siguiente» pressed too early).
function readOwnPoint(all) {
  const p = parseCoords($('plan-own-lat').value, $('plan-own-lon').value);
  state.customSite = p.errors ? null : customSite(p.lat, p.lon);
  for (const field of ['lat', 'lon']) {
    const input = $(`plan-own-${field}`), error = (all || input.value.trim() !== '') ? p.errors?.[field] ?? '' : '';
    $(`plan-own-${field}-error`).textContent = error;
    input.setAttribute('aria-invalid', String(!!error));
  }
}
for (const id of ['plan-own-lat', 'plan-own-lon']) $(id).addEventListener('input', () => { readOwnPoint(false); renderCoherence(); renderCalendar(); refreshPlan(); });

// ---------------- When: calendar of one site, each day coloured by how many landings fit ----------------
const MONTH_NAMES = tr('plan.months.long').split(',');
const WEEKDAYS = tr('plan.weekdays').split(',');
const dayMs = iso => Date.parse(iso + 'T00:00:00Z');
const hh = ms => String(new Date(ms).getUTCHours()).padStart(2, '0') + ':00';
const monthStart = ms => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const picker = { edge: 'from', month: null, cache: new Map(), hover: null };

// Years the ephemerides are checked for: the year dropdown jumps straight to any of them.
const PICKER_YEARS = [2026, 2027, 2028, 2029, 2030];

// Month and year as dropdowns, to jump far ahead without clicking month by month; the arrows still step one month.
function pickerHead(y, mo) {
  const years = PICKER_YEARS.includes(y) ? PICKER_YEARS : [...PICKER_YEARS, y].sort((a, b) => a - b);
  return `<div class="day-picker-head">
      <button type="button" class="day-picker-nav" data-month="-1" aria-label="${tr('plan.cal.prev')}">‹</button>
      <span class="day-picker-jump">
        <select class="day-picker-select" data-jump="month" aria-label="${tr('plan.cal.month')}">${MONTH_NAMES.map((m, i) => `<option value="${i}"${i === mo ? ' selected' : ''}>${m}</option>`).join('')}</select>
        <select class="day-picker-select" data-jump="year" aria-label="${tr('plan.cal.year')}">${years.map(v => `<option value="${v}"${v === y ? ' selected' : ''}>${v}</option>`).join('')}</select>
      </span>
      <button type="button" class="day-picker-nav" data-month="1" aria-label="${tr('plan.cal.next')}">›</button>
    </div>`;
}

// With a fixed site the calendar shows that one; with «El mejor de la zona», each day shows its best site of the zone.
const calendarSite = () => fixedSite() ?? polarSites()[0];
const zoneMode = cond => !state.form.site && cond.sites.length > 0;
const usableHours = own => own.viable + own.marginal;

// The site a day is painted with: in zone mode the best of the zone that day (highest score, then most usable hours).
function daySite(d, cond) {
  if (!zoneMode(cond)) { const site = calendarSite(); return { site, own: d.bySite[site.id] }; }
  return cond.sites.map(site => ({ site, own: d.bySite[site.id] }))
    .sort((a, b) => b.own.score - a.own.score || usableHours(b.own) - usableHours(a.own))[0];
}

// Verdicts of every day of the month on screen. null while the service loads that month (it repaints when ready).
function monthDays(cond) {
  if (['lander', 'blocked', 'own'].includes(missing())) return 'plain'; // no mission, a block (#252) or no site yet: the days are only dates
  return daysOfMonth(cond, picker.month, () => state.view === 'plan' && renderCalendar());
}
// Verdicts of every day of a month, cached: the calendar and the timeline's «Aterrizar» row read the same ones.
function daysOfMonth(cond, first, onReady) {
  const n = new Date(Date.UTC(new Date(first).getUTCFullYear(), new Date(first).getUTCMonth() + 1, 0)).getUTCDate();
  // The calendar previews the requirements as you type, but with the heights of the mission on screen: other heights
  // are other visibility data, loaded when you search.
  const heights = config().heights;
  const ms = services.mission, range = { fromMs: first - 864e5, toMs: first + (n + cond.days + 1) * 864e5, ...heights };
  if (!ms.isReady(range)) { ms.prepare(range).then(onReady, () => {}); return null; }
  const key = [first, cond.days, cond.batteryHours, cond.minEarthPct, cond.maxEarthGapHours, cond.sites.map(s => s.id), ms.source, heightsKey(heights)].join('|');
  if (!picker.cache.has(key)) {
    if (picker.cache.size > 24) picker.cache.clear();
    picker.cache.set(key, ms.landingDays(cond.sites, { days: cond.days, batteryHours: cond.batteryHours, minEarthPct: cond.minEarthPct, maxEarthGapHours: cond.maxEarthGapHours }, first, n));
  }
  return picker.cache.get(key);
}


// Day under the pointer, as a checklist: verdict and hours on one line, then each rule of the mission ✔ / ✘ (≈ when it
// passes by little, ? when it cannot be certified), from the slot that shows the day best (a valid hour if there is one).
function dayInfo(d, cond) {
  const { site, own } = daySite(d, cond), zone = zoneMode(cond), date = new Date(d.t);
  const code = own.viable ? 'viable' : own.marginal ? 'marginal' : 'not_viable';
  const slot = own.slots.find(x => x.code === code) ?? own.slots[0];
  const hours = code === 'not_viable' ? tr('plan.day.noHour') : tr('plan.day.atHours', { hours: own.slots.filter(x => x.code === code).map(x => hh(x.t)).join(', ') });
  const checks = ruleChecks(slot);
  const alts = cond.sites.filter(s => s.id !== site.id && d.bySite[s.id].viable).map(s => s.short);
  return `<p class="day-info-head"><b>${WEEKDAYS[date.getUTCDay()]} ${fmtDate(d.t)}</b> · ${esc(site.short)}${zone ? ` <span class="hint">${tr('plan.day.bestOfZone')}</span>` : ''}</p>
    <p class="day-info-verdict">${VERDICT_WORD[code]} ${hours}</p>
    ${checks ? `<p class="day-checks-title">${tr('plan.day.rulesAt', { hour: hh(slot.t) })}</p><ul class="day-checks">${checks}</ul>` : ''}
    ${alts.length ? `<p class="day-info-alts">${tr(zone ? 'plan.day.alsoIn' : 'plan.day.thatDayIn', { sites: esc(alts.join(', ')) })}</p>` : ''}`;
}

function renderDateButtons() {
  for (const edge of ['from', 'to']) {
    const b = $(`plan-${edge}-btn`), v = $(`plan-${edge}`).value;
    b.textContent = v ? fmtDate(dayMs(v)) : tr('plan.cal.pickDay');
    b.classList.toggle('is-empty', !v);
    b.classList.toggle('is-editing', picker.edge === edge);
    b.setAttribute('aria-pressed', String(picker.edge === edge));
  }
}

// Every paint replaces the calendar (a click on a day or an arrow, a month whose data arrives): the focus goes back to
// the same control of the new one.
export function renderCalendar() {
  const a = document.activeElement, key = a?.closest('#plan-calendar') ? ['i', 'month', 'jump'].find(k => a.dataset[k] !== undefined) : undefined;
  paintCalendar();
  if (key) $('plan-calendar').querySelector(`[data-${key}="${a.dataset[key]}"]`)?.focus({ preventScroll: true });
}
function paintCalendar() {
  // Without dates yet, the month of today, kept inside the years the ephemerides are checked for (2026–2030).
  if (picker.month === null) picker.month = monthStart($('plan-from').value ? dayMs($('plan-from').value) : Math.min(Math.max(Date.now(), Date.UTC(2026, 0, 1)), Date.UTC(2030, 11, 1)));
  const cond = planConditions(), zone = zoneMode(cond), days = monthDays(cond);
  if (days === 'plain') return renderPlainCalendar();
  const first = new Date(picker.month), y = first.getUTCFullYear(), mo = first.getUTCMonth(), lead = (first.getUTCDay() + 6) % 7;
  const from = dayMs($('plan-from').value), to = dayMs($('plan-to').value);
  let cells = '<span></span>'.repeat(lead);
  // While the month loads, the same calendar with its days greyed out: the card keeps its size instead of jumping.
  if (!days) for (let i = 0; i < monthLength(y, mo); i++) cells += `<button type="button" class="day day--loading" style="--i: ${lead + i}" disabled aria-label="${tr('plan.cal.dayLoading', { n: i + 1 })}"></button>`;
  else days.forEach((d, i) => {
    const { site, own } = daySite(d, cond), edge = d.t === from || d.t === to;
    const alt = !zone && !own.viable && cond.sites.some(s => s.id !== site.id && d.bySite[s.id].viable);
    cells += `<button type="button" class="day${d.t >= from && d.t <= to ? ' in-range' : ''}${edge ? ' is-edge' : ''}" data-i="${i}" aria-pressed="${edge}"
      style="--day-color: color-mix(in oklch, var(--color-ok) ${Math.round(own.score * 100)}%, var(--color-bad))" aria-describedby="plan-day-pop">
      <b>${i + 1}</b><small>${usableHours(own)}/${own.slots.length} h</small>${alt ? `<i class="alt-dot" title="${tr('plan.cal.altDot')}"></i>` : ''}</button>`;
  });
  const title = zone
    ? tr('plan.cal.zoneTitle')
    : tr('plan.cal.siteTitle', { site: esc(calendarSite().short) });
  $('plan-calendar').innerHTML = `
    ${pickPrompt(!days ? tr('plan.cal.loadingMonth') : '')}
    <p class="day-picker-site">${title}</p>
    ${pickerHead(y, mo)}
    <div class="day-picker-week" aria-hidden="true">${tr('plan.weekInitials').split(',').map(d => `<span>${d}</span>`).join('')}</div>
    <div class="day-picker-grid">${padWeeks(cells, lead, y, mo)}</div>
    <div class="day-pop" id="plan-day-pop" role="tooltip" hidden></div>
    <div class="day-picker-scale"><span>${tr('plan.cal.noHour')}</span><i></i><span>${tr('plan.cal.anyHour')}</span></div>`;
  renderDateButtons();
}

// What to do with the calendar, on top of it: two clicks, the first and the last day you can land.
function pickPrompt(note = '') {
  const first = picker.edge === 'from';
  return `<p class="day-picker-prompt" id="plan-day-info" aria-live="polite"><span class="day-picker-prompt__n">${first ? 1 : 2}/2</span>
    <span>${tr(first ? 'plan.cal.promptFirst' : 'plan.cal.promptLast')}${note ? ` <span class="hint">${note}</span>` : ''}</span></p>`;
}
const monthLength = (y, mo) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
// Always six weeks, so a month of four or five weeks does not shrink the calendar.
const padWeeks = (cells, lead, y, mo) => cells + '<span></span>'.repeat(42 - lead - monthLength(y, mo));

// Before choosing a spacecraft the calendar only picks dates: the colours come with the mission.
function renderPlainCalendar() {
  const first = new Date(picker.month), y = first.getUTCFullYear(), mo = first.getUTCMonth(), lead = (first.getUTCDay() + 6) % 7;
  const n = monthLength(y, mo);
  const from = $('plan-from').value ? dayMs($('plan-from').value) : NaN, to = $('plan-to').value ? dayMs($('plan-to').value) : NaN;
  let cells = '<span></span>'.repeat(lead);
  for (let i = 0; i < n; i++) {
    const t = picker.month + i * 864e5, edge = t === from || t === to;
    cells += `<button type="button" class="day day--plain${t >= from && t <= to ? ' in-range' : ''}${edge ? ' is-edge' : ''}" data-i="${i}" aria-pressed="${edge}"><b>${i + 1}</b></button>`;
  }
  $('plan-calendar').innerHTML = `
    ${pickPrompt()}
    ${pickerHead(y, mo)}
    <div class="day-picker-week" aria-hidden="true">${tr('plan.weekInitials').split(',').map(d => `<span>${d}</span>`).join('')}</div>
    <div class="day-picker-grid">${padWeeks(cells, lead, y, mo)}</div>
    <div class="day-picker-info">${tr('plan.cal.plainInfo')}</div>`;
  renderDateButtons();
}

// The day's checklist floats next to its cell (below it, or above when the screen ends), so no scrolling is needed.
function showDay(i, cell) {
  const cond = planConditions(), days = monthDays(cond), d = Array.isArray(days) ? days[i] : null, pop = $('plan-day-pop');
  if (!d || !pop) return;
  pop.innerHTML = dayInfo(d, cond);
  pop.hidden = false;
  const box = $('plan-calendar').getBoundingClientRect(), c = cell.getBoundingClientRect(), gap = 6;
  const below = c.bottom + gap + pop.offsetHeight <= window.innerHeight || c.top - gap - pop.offsetHeight < 0;
  pop.style.top = `${(below ? c.bottom + gap : c.top - gap - pop.offsetHeight) - box.top}px`;
  pop.style.left = `${Math.max(gap, Math.min(box.width - pop.offsetWidth - gap, c.left + c.width / 2 - pop.offsetWidth / 2 - box.left))}px`;
  // On the timeline, the mission that would start that day (only if the timeline shows this site).
  const { site, own } = daySite(d, cond), slot = own.slots.find(x => x.code === 'viable') ?? own.slots.find(x => x.code === 'marginal') ?? own.slots[0];
  picker.hover = site.id === state.selected[0] ? { t: slot.t, days: cond.days, code: slot.code } : null;
  paintPreview();
}
function hideDay() { picker.hover = null; const pop = $('plan-day-pop'); if (pop) pop.hidden = true; paintPreview(); }

document.querySelectorAll('.date-btn').forEach(b => b.addEventListener('click', () => {
  picker.edge = b.dataset.edge;
  if ($(`plan-${picker.edge}`).value) picker.month = monthStart(dayMs($(`plan-${picker.edge}`).value));
  renderCalendar();
}));
$('plan-calendar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || e.target.closest('.explain-btn')) return;
  if (b.dataset.month) {
    const d = new Date(picker.month);
    picker.month = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Number(b.dataset.month), 1);
    return renderCalendar();
  }
  const t = picker.month + Number(b.dataset.i) * 864e5;
  if (picker.edge === 'from' || !$('plan-from').value || t < dayMs($('plan-from').value)) {
    $('plan-from').value = isoDay(t);
    if (!$('plan-to').value || dayMs($('plan-to').value) < t) $('plan-to').value = isoDay(t);
    picker.edge = 'to';
  } else {
    $('plan-to').value = isoDay(t);
    picker.edge = 'from';
    // From the summary bar the calendar folds into its chip, which takes the focus (as with Esc) once the result is
    // painted; the first search lays out the result and its chips the same way.
    if (document.activeElement?.closest('#plan-calendar')) focusAfterPaint = { from: b, pick: () => $('plan-steps').children[3]?.querySelector('button') };
    renderCalendar();
    closeStep(); // from the summary bar: the window is chosen, fold it and let the result show
    return runSearch(); // the window is complete: the result and the timeline follow it without pressing the button
  }
  renderCalendar(); renderSteps();
});
$('plan-calendar').addEventListener('change', e => {
  const sel = e.target.closest('.day-picker-select');
  if (!sel) return;
  const d = new Date(picker.month), v = Number(sel.value);
  picker.month = sel.dataset.jump === 'year' ? Date.UTC(v, d.getUTCMonth(), 1) : Date.UTC(d.getUTCFullYear(), v, 1);
  renderCalendar();
});
$('plan-calendar').addEventListener('pointerover', e => { const b = e.target.closest('.day'); if (b && !b.classList.contains('day--plain')) showDay(+b.dataset.i, b); });
$('plan-calendar').addEventListener('focusin', e => { const b = e.target.closest('.day'); if (b && !b.classList.contains('day--plain')) showDay(+b.dataset.i, b); });
$('plan-calendar').addEventListener('focusout', hideDay);
$('plan-calendar').addEventListener('pointerleave', hideDay);
REQUIREMENTS.forEach(id => $(id).addEventListener('input', () => { followRequirements(); renderCoherence(); renderCalendar(); refreshPlan(); }));

// ---------------- Result ----------------
let pendingReveal = false, cancelSweep = null;
let focusAfterPaint = null; // { from, pick }: where the focus goes when a repaint removes the control `from`
const pct = n => tr('plan.pct', { n: Math.round(n) });
const hoursText = n => fmtHours(Math.round(n));

/** Under the date: a plan computed with skipped coherence rules says which (#252); without them, nothing. */
export function paintSkipped(conditions) {
  const skipped = conditions?.skippedRules ?? [];
  $('res-skipped').hidden = !skipped.length; $('res-skipped').textContent = skippedNote(skipped);
}

export function renderPlan() {
  // Until the first search the form is alone in the middle: there is no answer to show yet.
  const intro = !state.searchResult;
  $('view-plan').classList.toggle('is-intro', intro);
  renderSteps();
  if (intro) { renderCalendar(); return; }
  if (pendingMove) { const from = pendingMove; pendingMove = null; requestAnimationFrame(() => moveFormAside(from)); }
  const c = config(), s = siteById(state.selected[0]);
  const { verdict, t0 } = state.cache[s.id];
  const res = state.searchResult, isBest = res && res.best.site.id === s.id && t0 === res.best.landing;
  $('res-eyebrow').innerHTML = !isBest ? tr('plan.res.chosen')
    : res.fixedSite ? tr('plan.res.bestDate', { tested: `<span id="res-tested">${res.tested}</span>`, source: sourceLabel(res.source) })
    : tr('plan.res.bestOption', { tested: `<span id="res-tested">${res.tested}</span>`, sites: res.conditions.sites.length, source: sourceLabel(res.source) });
  renderCalendar();
  $('res-site').textContent = s.name;
  // The launch date the team handles, from the domain and with the transit marked as an assumption.
  const { launchMs, transitDays } = services.mission.launch(t0, { days: c.days, ...c.req });
  // The landing is the answer; the launch follows from it and the transit is an assumption, so it goes second.
  $('res-date').innerHTML = tr('plan.res.date', { date: esc(fmtDateTime(t0)), launch: fmtDate(launchMs), transit: esc(transitNote(transitDays)) });
  // The verdict flashes once when it changes (not on the first paint or during the search).
  const pill = $('res-verdict'), changed = pill.dataset.code && pill.dataset.code !== verdict.code;
  pill.dataset.tone = VERDICT_TONE[verdict.code]; pill.textContent = verdict.title; pill.dataset.code = verdict.code;
  if (changed && !pendingReveal) replay(pill, 'motion-flash');
  renderOrigin(s);
  paintSkipped(res.conditions);
  $('res-reason').textContent = ''; // only for errors: the reason and the rules are in the verdict's checklist
  renderVerdictPop(s, t0, verdict);
  rememberMission(s, t0, verdict);
  render3dLink(s, t0, c);
  renderEmptyWindow(s);
  renderAlternatives(s, t0);
  renderDelayMargin(s, t0, c);
  paintHeightsNote();
  renderFigures(false);
  renderEnergy(s, t0, c);
  drawPlanSky();
  if (pendingReveal) { pendingReveal = false; revealSearch(res); }
  restoreFocus();
}

// Only once the result is on screen (the view is hidden while new data loads, and its title during the search sweep)
// and the control has lost the focus.
function restoreFocus() {
  if (!focusAfterPaint || $('timeline').closest('.plan-result-card').classList.contains('is-searching')) return;
  const a = document.activeElement, lost = !a || a === document.body || !a.isConnected || !!a.closest('[hidden]');
  if (lost) (focusAfterPaint.pick() ?? $('res-site')).focus({ preventScroll: true });
  if (lost || a !== focusAfterPaint.from) focusAfterPaint = null; // the focus moved on by itself: nothing to restore
}

// A point typed by the user says so, and which horizon it was judged with: with the API, its LOLA relief if the server
// has it there, or a smooth Moon; without the API, the simulated relief.
function renderOrigin(s) {
  const el = $('res-origin'), own = isOwnPoint(s);
  el.hidden = !own;
  if (!own) return;
  const model = services.mission.horizonModel(s.id);
  el.textContent = OWN_TEXT.origin(model === 'mask' ? OWN_TEXT.horizon.mask : model === 'sphere' ? OWN_TEXT.horizon.sphere(Math.abs(s.lat) >= POLAR_LAT) : OWN_TEXT.horizon.simulated);
  el.dataset.tone = model === 'sphere' ? 'warn' : '';
}

// The verdict, with the pointer on it (or focused): the same checklist as a day of the calendar, for this landing.
function renderVerdictPop(s, t0, verdict) {
  const checks = ruleChecks(verdict);
  $('res-verdict-pop').innerHTML = `<p class="day-info-head"><b>${esc(s.short)} · ${esc(fmtDateTime(t0))}</b> · ${VERDICT_WORD[verdict.code]}</p>
    <p>${esc(reasonText(verdict.reason ?? ''))}</p>
    ${checks ? `<p class="day-checks-title">${tr('plan.res.rulesAtLanding')}</p><ul class="day-checks">${checks}</ul>` : ''}`;
}
const verdictPop = show => { $('res-verdict-pop').hidden = !show; };
for (const [type, show] of [['pointerenter', true], ['pointerleave', false], ['focus', true], ['blur', false]]) $('res-verdict').addEventListener(type, () => verdictPop(show));

const viewerPlan = (t0, c) => ({ t0, days: c.days, ...c.req, ...linkSearch(state.searchResult) });
// «Ver en 3D» (V1.1, #72): the viewer of viewpoint/ with this plan in the URL, so the link can be shared. A site without a
// relief region in the scene says so instead of opening an empty scene.
function render3dLink(s, t0, c) {
  const own = isOwnPoint(s), a = $('res-3d'), ok = !!(own ? regionNear(s, SITES) : regionFor(s.id));
  a.textContent = ok ? tr('plan.res.view3d') : tr('plan.res.no3d');
  a.setAttribute('aria-disabled', String(!ok));
  if (ok) a.href = viewerLink(s, viewerPlan(t0, c), location.search);
  else a.removeAttribute('href');
}

// How much delay the plan takes (#67): the domain's margin, the same figure Replan gives «Sin retraso». The delay
// chips say which ones break the plan.
function renderDelayMargin(s, t0, c) {
  const m = services.mission.delayMargin(s, t0, { days: c.days, ...c.req }), box = $('plan-replan-margin');
  const own = isOwnPoint(s), go = document.querySelector('.plan-replan__go');
  go.textContent = own ? OWN_TEXT.noReplan : OWN_TEXT.replan;
  if (own) { go.removeAttribute('href'); go.setAttribute('aria-disabled', 'true'); } else { go.href = '#replan'; go.removeAttribute('aria-disabled'); }
  const holds = d => m && m.viable && (m.open || d <= m.days + 1e-9);
  box.textContent = !m ? tr('plan.delay.loading')
    : !m.viable ? tr('plan.delay.never')
    : m.open ? tr('plan.delay.atLeast', { dh: fmtHours(Math.round(m.days * 24)) })
    : m.days ? tr('plan.delay.upTo', { dh: fmtHours(Math.round(m.days * 24)) })
    : tr('plan.delay.none');
  box.dataset.tone = !m ? '' : !m.viable || !m.days ? 'bad' : 'ok';
  document.querySelectorAll('.plan-replan [data-replan-delay]').forEach(b => {
    const d = +b.dataset.replanDelay; if (!d) return;
    const word = !m ? '' : holds(d) ? tr('plan.delay.holds') : tr('plan.delay.breaks');
    // ✓ / ✕ on the chip (one row under the readout), the words for the tooltip and screen readers.
    b.innerHTML = `+${d} d${word ? ` <small aria-hidden="true">${holds(d) ? '✓' : '✕'}</small>` : ''}`;
    b.title = word ? tr('plan.delay.chipTitle', { d, word }) : '';
    b.setAttribute('aria-label', word ? tr('plan.delay.chipLabelWord', { d, word }) : tr('plan.delay.chipLabel', { d }));
    b.dataset.breaks = m ? String(!holds(d)) : '';
  });
}

// Nothing fits in the window: say so, and offer to stretch it to the next landing that works.
function renderEmptyWindow(s) {
  const o = optionFor(s.id), cond = state.searchResult?.conditions;
  if (!o || !cond || o.viableInWindow) { $('res-next').hidden = true; return; }
  const next = services.mission.nextViable(s, cond.to + 12 * 36e5, cond, 60)?.t;
  $('res-next').hidden = false;
  $('res-next').innerHTML = tr('plan.empty.none', { site: esc(s.short), from: fmtDate(cond.from), to: fmtDate(cond.to) })
    + (next ? tr('plan.empty.next', { date: fmtDateTime(next) }) + ` <button type="button" class="btn" data-extend="${next}">${tr('plan.empty.extend')}</button>`
            : tr('plan.empty.never'));
}
$('res-next').addEventListener('click', e => {
  const b = e.target.closest('[data-extend]'); if (!b) return;
  $('plan-to').value = isoDay(+b.dataset.extend);
  focusAfterPaint = { from: b, pick: () => null }; // it goes away with the empty window: the plan's title takes it
  runSearch();
});

// The figures read the timeline: each row has the colour of its row there and, on hover or focus, the timeline lights
// that row and dims the rest. They keep their elements so the numbers can count to the new value.
const READOUT = [
  { ring: 'sun', color: '--color-sun', label: tr('plan.fig.sun'), id: 'fig-sun', explain: 'pct-sun' },
  { ring: 'shadow', color: '--color-sun', label: tr('plan.fig.shadow'), id: 'fig-dark', explain: 'no-sun', hollow: true },
  { ring: 'earth', color: '--color-earth', label: tr('plan.fig.earth'), id: 'fig-earth', explain: 'pct-earth' },
];
function renderFigures(fromZero) {
  const c = config(), k = state.cache[state.selected[0]], r = k.result;
  if (!$('fig-sun')) $('res-figures').innerHTML = READOUT.map(x => `
    <div class="readout__row" data-ring="${x.ring}" data-explain="${x.explain}" tabindex="0">
      <i class="readout__swatch${x.hollow ? ' is-hollow' : ''}" style="--c: var(${x.color})" aria-hidden="true"></i>
      <span class="readout__label">${x.label}</span>
      <b class="readout__value" id="${x.id}"></b>
      <small class="readout__req" id="${x.id}-req"></small>${UI.band('', `${x.id}-band`)}
    </div>`).join('') + `
    <div class="readout__row readout__row--mission" data-ring="mission" tabindex="0">
      <i class="readout__swatch is-arc" id="fig-mission-swatch" aria-hidden="true"></i>
      <span class="readout__label">${tr('plan.fig.mission')}</span>
      <b class="readout__value readout__value--text" id="fig-mission"></b>
      <small class="readout__req">${tr('plan.fig.missionHint')}</small>
    </div>` + UI.deepPolarNote(tr('common.deepPolar.text'), tr('common.deepPolar.link'), { id: 'fig-deep-polar' });
  // Range of each figure if the horizon is 0.3° higher or lower (only with the data API): «61 % [55–66 %]».
  const band = k.source === 'api' ? services.mission.band(k.site, k.t0, { days: c.days, ...c.req }) : null;
  UI.setBand($('fig-sun-band'), UI.bandText(band?.pctSun, pct));
  UI.setBand($('fig-dark-band'), UI.bandText(band?.maxDarkHours, hoursText));
  UI.setBand($('fig-earth-band'), UI.bandText(band?.pctEarth, pct));
  // South of 85°S the API warns that the figures are less reliable (#437): said beside them, nothing else changes.
  $('fig-deep-polar').hidden = !(k.source === 'api' && services.mission.deepPolar(k.site));
  const figure = (id, value, format, ok) => {
    const el = $(id); if (fromZero) el._value = 0;
    countTo(el, value, { format, ms: fromZero ? 700 : 350 });
    el.classList.toggle('text-bad', !ok);
    el.closest('.readout__row').classList.toggle('is-failing', !ok);
  };
  const darkOk = r.maxDarkHours <= c.req.batteryHours, earthOk = r.pctEarth >= c.req.minEarthPct;
  figure('fig-sun', r.pctSun, pct, darkOk);
  figure('fig-dark', r.maxDarkHours, hoursText, darkOk);
  figure('fig-earth', r.pctEarth, pct, earthOk);
  $('fig-sun-req').textContent = tr('plan.fig.sunReq', { days: fmtNum(c.days) });
  $('fig-dark-req').textContent = tr('plan.fig.darkReq', { h: fmtNum(c.req.batteryHours) });
  $('fig-earth-req').textContent = tr('plan.fig.earthReq', { pct: fmtNum(c.req.minEarthPct) }) + (filled('plan-earth-gap') ? tr('plan.fig.earthGapReq', { h: fmtNum(c.req.maxEarthGapHours) }) : '');
  $('fig-mission').textContent = tr('plan.fig.missionValue', { days: fmtNum(c.days), verdict: k.verdict.title });
  $('fig-mission-swatch').style.setProperty('--c', VERDICT_VAR[k.verdict.code]);
}

// The energy the solar panel gets (#254): /v1/rank with the orientation of the search, beside a tracker's when it is
// another one. It only informs: no verdict depends on it. A horizontal panel near the pole says so (C13).
let energySeq = 0, energyPainted = null, energyHtml = ''; // the energy on screen: what it was asked for, and its text
const energyPct = e => tr('plan.pct', { n: fmtNum(100 * e, 100 * e < 10 ? 1 : 0) });
function renderEnergy(s, t0, c) {
  const el = $('res-energy'), ms = services.mission, seq = ++energySeq;
  const panel = panelOf(state.searchResult?.conditions?.panel) ?? DEFAULT_PANEL;
  const warning = panelUselessAt(panel, s.lat) ? checkCoherence({ panel, siteLatDeg: s.lat }).find(i => i.id === 'C13')?.message : '';
  // #res-energy is a live region and renderPlan runs on every state change: the text is only written when it changes,
  // and the loading text only when the energy asked for is not the one on screen, so nothing is announced twice.
  const key = JSON.stringify([ms.source, s.id, s.lat, t0, c.days, panel, document.documentElement.lang]);
  const paint = (parts, tone = '', done = true) => {
    if (seq !== energySeq) return; // a later landing or search painted it already
    const html = `<b>${esc(tr('plan.energy.title'))}:</b> ${esc([...parts, warning, tr('plan.energy.onlyInfo')].filter(Boolean).join(' '))}`;
    if (energyHtml !== html || el.innerHTML === '') el.innerHTML = energyHtml = html;
    el.dataset.tone = tone || (warning ? 'warn' : '');
    energyPainted = done ? key : null;
  };
  paintPanelNote();
  if (ms.source !== 'api') return paint([tr('plan.energy.simulated')]);
  if (!(c.days >= 1)) return paint([tr('plan.energy.shortMission')]);
  if (energyPainted !== key) paint([tr('plan.energy.loading')], '', false);
  Promise.all([ms.energy(s, t0, c.days, panel), panel === DEFAULT_PANEL ? null : ms.energy(s, t0, c.days, DEFAULT_PANEL)]).then(
    ([e, tracking]) => paint([tr('plan.energy.value', { pct: energyPct(e.energy), panel: panelName(panel), formula: panelFormula(panel) }),
      tracking ? tr('plan.energy.tracking', { pct: energyPct(tracking.energy) }) : '',
      // «Horas con Sol» counts the whole disc (mode=full, as the verdict); the energy counts any part of it (#254).
      tr('plan.energy.partial')]),
    err => paint([tr('plan.energy.failed', { error: err.message })], 'warn', false));
}

// Hovering or focusing a figure lights its row on the timeline, or its ring on the clock.
for (const type of ['pointerover', 'focusin']) $('res-figures').addEventListener(type, e => {
  const row = e.target.closest('[data-ring]'); setFocus(row ? row.dataset.ring : null);
});
for (const type of ['pointerleave', 'focusout']) $('res-figures').addEventListener(type, () => setFocus(null));
function setFocus(ring) {
  setFocusRow(ring === 'shadow' ? 'sun' : ring);
  if (clock.focus !== ring) { clock.focus = ring; paintClock(); }
}

// The next best options of the search (res.options is already ranked), one click to make one the plan on screen.
function renderAlternatives(s, t0) {
  const res = state.searchResult, box = $('res-alts');
  // Only the ones that work: a list of «No viable» is not an alternative (the calendar already says where nothing fits).
  const others = (res?.options ?? []).filter(o => !(o.site.id === s.id && o.landing === t0) && o.verdict.code !== 'not_viable').slice(0, 3);
  box.hidden = !others.length;
  $('res-alts-title').textContent = res?.fixedSite ? tr('plan.alts.otherSites') : tr('plan.alts.title');
  $('res-alts-list').innerHTML = others.map(o => `<li><button type="button" class="alt" data-alt="${o.site.id}" data-t="${o.landing}">
      <b>${esc(o.site.short)}</b><span class="num">${shortDay(o.landing)} ${hh(o.landing)}</span>
      <span class="badge badge--pill" data-tone="${VERDICT_TONE[o.verdict.code]}">${esc(o.verdict.title)}</span></button></li>`).join('');
}
$('res-alts-list').addEventListener('click', e => {
  const b = e.target.closest('[data-alt]'); if (!b) return;
  const o = state.searchResult?.options.find(x => x.site.id === b.dataset.alt && x.landing === +b.dataset.t);
  if (!o) return;
  focusAfterPaint = { from: b, pick: () => $('res-alts-list').querySelector('.alt') }; // the list is painted again
  adopt(o, undefined, false);
});

// The search resolves: the answer waits while the tested landings count up and «¿Cuándo aterrizar?» unfolds (the
// timeline from its first day, or a hand sweeping the clock); then it enters.
function revealSearch(res) {
  cancelSweep?.();
  const circle = whenMode === 'circle', tl = $('timeline'), card = tl.closest('.plan-result-card');
  card.classList.add('is-searching');
  if (circle) { clock.tested = res.tested; clock.sweep = 0; arcLength.set(0); }
  // Short: it is a flourish while the answer lands, not a wait (it was 760 ms and felt slow).
  if ($('res-tested')) countTo($('res-tested'), res.tested, { from: 0, ms: 420 });
  cancelSweep = tween({ ms: 420, easing: ease.standard, step: v => {
    if (circle) { clock.sweep = v; paintClock(); } else tl.style.clipPath = `inset(-4px ${((1 - v) * 100).toFixed(2)}% -4px 0)`;
  }, done: () => {
    if (circle) { clock.sweep = 1; arcLength.to(clock.length); ripple.set(0); ripple.to(1); } else tl.style.clipPath = '';
    card.classList.remove('is-searching');
    restoreFocus();
    [$('res-site'), $('res-date').parentElement, $('res-reason'), $('res-figures')].forEach((el, i) => { el.style.setProperty('--i', i); replay(el, 'motion-enter'); });
    $('res-verdict').style.setProperty('--i', 3); replay($('res-verdict'), 'motion-stamp');
    renderFigures(true);
  } });
}

// The sky of the site, in 2D (the default) or in 3D with the relief: the same data either way, and the same height
// for both (the 3D buttons float over its picture). The height follows the window, so the result fits without scroll.
function planSkyHeight() {
  const short = matchMedia('(min-width: 1181px) and (max-height: 880px)').matches;
  return Math.round(short ? Math.max(140, Math.min(300, innerHeight - 545)) : 230);
}
let skyResize = 0;
addEventListener('resize', () => { clearTimeout(skyResize); skyResize = setTimeout(() => state.view === 'plan' && state.searchResult && drawPlanSky(), 150); });
// The sky of the site, in 2D (the default) or in 3D with the relief: the same data either way.
const planSky = createSkyView({
  canvas: $('plan-panorama'), host: $('plan-sky3d'), toggle: $('plan-sky-mode'), notice: $('plan-sky-notice'), hint: $('plan-sky-hint'),
  height: planSkyHeight, hint2d: tr('plan.sky.hint2d'), hintPolar: tr('plan.sky.hintPolar'), relief: (site, onReady) => services.mission.relief(site, onReady), redraw: () => state.view === 'plan' && drawPlanSky(),
  // The ⤢ of the sky (#130): the same viewer as «Ver en 3D», at the hour of the cursor and on foot.
  viewer: (s, hour) => (state.cache[s.id] ? viewerLink(s, viewerPlan(state.cache[s.id].t0, config()), location.search, { at: state.cache[s.id].t0 + hour * 36e5, foot: true }) : null),
});

export function drawPlanSky() {
  const s = siteById(state.selected[0]);
  if (!state.cache[s.id]) return; // still loading
  const { t0 } = state.cache[s.id], c = config(), hour = currentHour();
  $('plan-hour').max = c.days * 24;
  $('plan-hour-value').textContent = `+${fmtHours(hour)} · ${fmtDateTime(c.t0 + hour * 36e5)}`;
  if (state.view === 'plan') drawWhen();
  renderUntil(s, t0 + hour * 36e5);
  // The sky is only drawn: it arrives later than the verdict (with the API, from /v1/track) and repaints itself.
  // A failed load is remembered: asking again on every repaint would fail again, forever «loading».
  const key = `${s.id}|${t0}|${c.days}|${services.mission.source}`;
  const failed = skyFailure?.key === key;
  const sky = failed ? null : services.mission.sky(s, t0, c.days, (got, err) => {
    if (err) skyFailure = { key, message: err.message };
    if (state.view === 'plan') drawPlanSky();
  });
  $('plan-sky-error').hidden = !failed;
  $('plan-sky-chart').hidden = failed;
  if (failed) { $('plan-sky-error-text').textContent = tr('plan.sky.error', { message: skyFailure.message.replace(/\.$/, '') }); return; }
  // The degrees of the Sun and the Earth over the relief are in Advanced; here the line above says light and contact.
  if (!sky) { $('plan-until').insertAdjacentHTML('beforeend', ` <span class="hint">· ${tr('plan.sky.loading')}</span>`); return; }
  planSky.draw(s, sky, hour);
}
let skyFailure = null;
$('plan-sky-retry').addEventListener('click', () => { skyFailure = null; drawPlanSky(); });
// How long the Sun and the Earth stay (or stay away) at the instant of the slider (#69, 4.1 and 4.2): the same
// windows as «luz» / «sombra», so the two never disagree.
function renderUntil(s, t) {
  const u = services.mission.untilChange(s, t), el = $('plan-until');
  if (!u) { el.textContent = ''; return; }
  const dur = x => `${x.atLeast ? tr('plan.until.atLeast') : ''}${fmtHours(Math.round(x.ms / 36e5))}`;
  const line = (x, name, bare) => x.visible
    ? `<span class="text-ok">${tr('plan.until.sets', { name, dur: dur(x) })}</span>`
    : `<span class="text-bad">${tr(x.atLeast ? 'plan.until.notRising' : 'plan.until.rises', { bare, dur: dur(x) })}</span>`;
  el.innerHTML = `${line(u.sun, tr('plan.until.sun'), tr('common.sun'))} &nbsp;·&nbsp; ${line(u.earth, tr('plan.until.earth'), tr('common.earth'))}`;
}
$('plan-hour').addEventListener('input', () => { $('hour').value = $('plan-hour').value; actions.onHourChange(); });
$('plan-play').addEventListener('click', () => $('play').click());

// ---------------- «¿Cuándo aterrizar?»: a line or a circle ----------------
// The same landings two ways: the timeline (a line, the default) or the lunar clock (a circle). The choice is a
// convenience of each viewer, kept in the browser.
const WHEN_KEY = 'llsn.whenMode';
let whenMode = (() => { try { return localStorage.getItem(WHEN_KEY) === 'circle' ? 'circle' : 'line'; } catch { return 'line'; } })();
function applyWhenMode() {
  const circle = whenMode === 'circle';
  $('res-when-line').hidden = circle; $('res-when-circle').hidden = !circle;
  $('res-body').classList.toggle('is-circle', circle);
  document.querySelectorAll('[data-when]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.when === whenMode)));
}
function drawWhen() { if (whenMode === 'circle') drawClock(); else drawTimeline(); }
// A landing previewed from the calendar: the dashed mission on whichever is shown.
function paintPreview() { if (whenMode === 'circle') paintClock(); else paintGhost(); }
document.querySelectorAll('[data-when]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.when === whenMode) return;
  whenMode = b.dataset.when;
  try { localStorage.setItem(WHEN_KEY, whenMode); } catch { /* private window: the choice lasts this visit */ }
  applyWhenMode();
  tlBuilt = null; // the axis was measured while hidden
  if (state.view === 'plan' && state.searchResult) drawWhen();
  document.querySelector(`[data-when="${whenMode}"]:not([hidden] *)`)?.focus();
}));
applyWhenMode();

// ---------------- Lunar clock (the «Círculo» of «¿Cuándo aterrizar?») ----------------
// A circular timeline with a fixed axis. The clock shows CLOCK.hours (the searched window plus one mission, between one
// lunar month and two) from `start`, the seam, which always sits at the top. You move the mission arc around the dial;
// push it against the axis and, instead of going round, the dates turn under it: the oldest days give way to new ones
// and the weeks go by (loaded as needed, up to a year after the window). Positions are in hours from the epoch (the
// first day searched).
const CLOCK = { size: 460, hours: 720 };
let clockData = null;
function clockWindow() {
  const c = config(), cond = state.searchResult?.conditions;
  const epoch = cond ? cond.from : c.base;
  const days = cond ? Math.ceil((cond.to - cond.from) / DAY + cond.days) : 30;
  CLOCK.hours = Math.max(30, Math.min(60, days)) * 24;
  if (clock.epoch !== epoch) { clock.epoch = epoch; clock.anchor = epoch; clock.fresh = true; clock.loadedTo = 0; } // a new search starts over
  // As far as the mission service has loaded: two months after the window, and more as the mission is pushed (extend).
  const maxEnd = Math.min(epoch + 360 * DAY, Math.max(cond ? cond.to + (60 + cond.days) * DAY : epoch + 60 * DAY, clock.loadedTo));
  return { c, epoch, start: clock.anchor, maxEnd };
}
const relH = t => (t - clockWindow().epoch) / 36e5;
/** Near the end of what is loaded, loads two more months (one request for every site), and the timeline goes on. */
function extend() {
  const { epoch, maxEnd } = clockWindow(), ms = services.mission;
  if (clock.extending || maxEnd >= epoch + 360 * DAY) return;
  const to = Math.min(epoch + 360 * DAY, maxEnd + 60 * DAY), range = { fromMs: epoch - DAY, toMs: to + DAY, ...config().heights };
  clock.extending = true; paintClock();
  ms.prepare(range).then(() => { if (ms.isReady(range) && clock.epoch === epoch) clock.loadedTo = to; }, () => {})
    .finally(() => { clock.extending = false; paintClock(); });
}
/** Moves the seam, a whole day at a time, so the mission landing at t fits in the clock with its whole mission. */
function follow(t) {
  const { c, epoch, start, maxEnd } = clockWindow(), span = CLOCK.hours * 36e5;
  const day = x => (x - epoch) / DAY;
  let a = start;
  if (t < a) a = epoch + Math.floor(day(t)) * DAY;
  else if (t + c.days * DAY > a + span) a = epoch + Math.ceil(day(t + c.days * DAY - span)) * DAY;
  clock.anchor = Math.max(epoch, Math.min(maxEnd - span, a));
  // The seam is the axis of the clock and never leaves the top: when it moves, the dates step under it at once (an
  // animation here made the axis swing away and back).
  const h = relH(clock.anchor);
  if (clock.seamH !== h) { clock.seamH = h; dialRot.set(h); }
}
function computeClock(s) {
  const { start } = clockWindow();
  const key = s.id + start + '|' + CLOCK.hours + '|' + services.mission.source;
  if (clockData?.key === key) return clockData;
  const { sun, earth } = services.mission.visibleHours(s, start, CLOCK.hours);
  clockData = { key, start, sun, earth };
  return clockData;
}
// dialRot: the hour at the top, i.e. the seam.
const hourAngle = h => -Math.PI / 2 + ((h - dialRot.v) / CLOCK.hours) * 2 * Math.PI; // h: hours from the epoch
const SEAM_GAP = 0.035; // radians left empty on each side of the seam, so the start and the end read apart

// Animated state of the clock: the arc glides to its new day, its colour fades when the verdict
// changes (with one ripple), and `sweep` goes 0 → 1 while a search resolves.
// focus: the ring lit from the figures (sun, shadow, earth, mission).
const VERDICT_TITLE = { viable: tr('common.verdict.viable'), marginal: tr('common.verdict.marginal'), not_viable: tr('common.verdict.not_viable') };
const clock = { seamH: null, epoch: null, anchor: null, fresh: true, loadedTo: 0, extending: false, preview: null, sweep: 1, tested: 0, start: null, length: 0, code: null, colorFrom: '', colorTo: '', dragging: false, focus: null };
const arcStart = animatedValue(0, { ms: 420, easing: ease.spring }, paintClock);
const arcLength = animatedValue(0, { ms: 520 }, paintClock);
const colorMix = animatedValue(1, { ms: 320, easing: ease.standard }, paintClock);
const ripple = animatedValue(1, { ms: 750 }, paintClock);
const dialRot = animatedValue(0, { ms: 420, easing: ease.standard }, paintClock);

// Syncs the animated values with the current state, then paints.
function drawClock() {
  const { c } = clockWindow(), s = siteById(state.selected[0]);
  const { verdict } = state.cache[s.id];
  if (!clock.dragging) follow(c.t0); // a landing set from elsewhere (keyboard, calendar, an alternative) comes into view
  const start = relH(c.t0), length = c.days * 24, color = verdictColor(verdict.code), prev = { ...clock };
  Object.assign(clock, { start, length, code: verdict.code });
  if (prev.code === null || clock.fresh) {
    clock.fresh = false;
    clock.colorFrom = clock.colorTo = color; arcStart.set(start); arcLength.set(length); clock.seamH = relH(clock.anchor); dialRot.set(clock.seamH);
  } else {
    if (verdict.code !== prev.code) {
      clock.colorFrom = mix(prev.colorFrom, prev.colorTo, colorMix.v); clock.colorTo = color;
      colorMix.set(0); colorMix.to(1); ripple.set(0); ripple.to(1);
    }
    if (start !== prev.start && !clock.dragging && !clock.held) arcStart.to(start);
    if (length !== prev.length && clock.sweep === 1) arcLength.to(length);
  }
  paintClock();
  describeClock(s, verdict);
}

// The clock in words (#68): its real span in the label, the landing as the slider value, a summary of the Sun and
// Earth hours of the mission below it, and each change of landing announced to screen readers.
let clockAnnounced = null;
function describeClock(s, verdict) {
  const { c, start, epoch, maxEnd } = clockWindow(), cv = $('clock'), hours = c.days * 24;
  cv.setAttribute('aria-label', tr('plan.clock.label', { days: CLOCK.hours / 24, from: fmtDate(start), to: fmtDate(start + (CLOCK.hours - 24) * 36e5) }));
  cv.setAttribute('aria-valuemin', '0'); cv.setAttribute('aria-valuemax', String(Math.round((maxEnd - epoch) / 36e5 - hours)));
  cv.setAttribute('aria-valuenow', String(Math.round(relH(c.t0))));
  cv.setAttribute('aria-valuetext', tr('plan.clock.value', { date: fmtDateTime(c.t0), verdict: verdict.title, days: fmtNum(c.days) }));
  const { sun, earth } = services.mission.visibleHours(s, c.t0, Math.round(hours));
  const count = arr => arr.reduce((n, x) => n + x, 0), share = n => Math.round((n / Math.max(1, sun.length)) * 100);
  const sunH = count(sun), earthH = count(earth);
  $('clock-summary').textContent = tr('plan.clock.summary', { days: fmtNum(c.days), sun: fmtHours(sunH), sunPct: share(sunH), earth: fmtHours(earthH), earthPct: share(earthH) });
  const key = `${c.t0}|${verdict.code}|${c.days}`;
  if (clockAnnounced !== null && clockAnnounced !== key) $('clock-live').textContent = tr('plan.clock.live', { date: fmtDateTime(c.t0), verdict: verdict.title, days: fmtNum(c.days) });
  clockAnnounced = key;
}

function paintClock() {
  if (clock.code === null) return;
  const s = siteById(state.selected[0]);
  const { c } = clockWindow();
  const d = computeClock(s);
  const { verdict } = state.cache[s.id];
  const cv = $('clock'), dpr = devicePixelRatio || 1, T = CLOCK.size, C = T / 2, TAU = 2 * Math.PI;
  if (cv.width !== T * dpr) cv.width = cv.height = T * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, T, T);
  // The rings are drawn a little smaller than the canvas, so the dates around them fit at any turn of the dial.
  const K = 0.88, ringOut = (C - 33) * K;
  ctx.translate(C, C); ctx.scale(K, K); ctx.translate(-C, -C);
  const limit = clock.sweep * CLOCK.hours, ink = css('--color-text'), aH = relH(d.start); // aH: the seam, in epoch hours
  // With a figure under the pointer, its ring stays and the others step back.
  const dim = name => clock.focus && clock.sweep === 1 && !(clock.focus === name || (clock.focus === 'shadow' && name === 'sun'));
  const ring = (radius, width, arr, color, name) => {
    ctx.globalAlpha = dim(name) ? 0.18 : 1;
    ctx.lineWidth = width; ctx.lineCap = 'butt';
    ctx.strokeStyle = css('--color-surface-raised'); ctx.beginPath(); ctx.arc(C, C, radius, 0, TAU); ctx.stroke();
    ctx.strokeStyle = color;
    let i = 0;
    while (i < limit) {
      if (!arr[i]) { i++; continue; }
      let j = i; while (j < limit && arr[j]) j++;
      ctx.beginPath(); ctx.arc(C, C, radius, hourAngle(aH + i), hourAngle(aH + Math.min(j, limit))); ctx.stroke(); i = j;
    }
    ctx.globalAlpha = 1;
  };
  ring(C - 46, 26, d.sun, css('--color-sun'), 'sun');
  ring(C - 78, 16, d.earth, css('--color-earth'), 'earth');
  const option = optionFor(s.id), stepH = state.searchResult?.stepHours ?? 12;
  ctx.lineWidth = 8; ctx.lineCap = 'butt'; ctx.globalAlpha = dim('days') ? 0.18 : 1;
  for (const l of option?.landings ?? []) {
    const h = (l.t - d.start) / 36e5;
    if (h < 0 || h >= limit) continue;
    ctx.strokeStyle = verdictColor(l.code);
    ctx.beginPath(); ctx.arc(C, C, C - 96, hourAngle(aH + h), hourAngle(aH + Math.min(h + stepH, limit)) - 0.004); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // The seam: the clock is a strip of days rolled into a circle, so where it starts and where it ends are cut apart
  // (a gap through the rings) and named on each side, instead of the last day running into the first.
  const seam = hourAngle(aH);
  if (clock.sweep === 1) {
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.moveTo(C, C); ctx.arc(C, C, C - 30, seam - SEAM_GAP, seam + SEAM_GAP); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // day ticks
  ctx.strokeStyle = css('--color-text-muted'); ctx.fillStyle = css('--color-text-muted'); ctx.lineWidth = 1; ctx.font = '10px ' + css('--font-data');
  const nDays = CLOCK.hours / 24, every = nDays > 40 ? 10 : 5;
  const dayName = day => fmtDayMonth(d.start + day * 864e5);
  // Dates outside the rings, in canvas pixels (not scaled with them): the dial turns, so a label can land on any side,
  // and it is pushed out by half its width on the sides and half its height above and below.
  const label = (t, a) => {
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = ctx.measureText(t).width, rr = ringOut + 8 + Math.abs(Math.cos(a)) * w / 2 + Math.abs(Math.sin(a)) * 6;
    ctx.fillText(t, C + Math.cos(a) * rr - w / 2, C + Math.sin(a) * rr + 4);
    ctx.restore();
  };
  for (let day = 1; day < nDays; day++) {
    const a = hourAngle(aH + day * 24), r1 = C - 30, r2 = C - (day % every === 0 ? 22 : 26);
    ctx.beginPath(); ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1); ctx.lineTo(C + Math.cos(a) * r2, C + Math.sin(a) * r2); ctx.stroke();
    // the labels next to the seam give way to its own two
    if (day % every === 0 && day >= 3 && day <= nDays - 3) label(dayName(day), a);
  }
  // The seam's two dates, in ink: «▸ 11 nov» where the clock starts and «10 dic ◂» where it ends.
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(C + Math.cos(seam) * (C - 102), C + Math.sin(seam) * (C - 102)); ctx.lineTo(C + Math.cos(seam) * (C - 20), C + Math.sin(seam) * (C - 20)); ctx.stroke();
  ctx.fillStyle = ink; ctx.font = '600 10px ' + css('--font-data');
  const off = 0.2;
  label(`▸ ${dayName(0)}`, seam + off); label(`${dayName(nDays - 1)} ◂`, seam - off);
  ctx.fillStyle = css('--color-text-muted'); ctx.font = '10px ' + css('--font-data');
  ctx.textAlign = 'center';
  if (clock.sweep < 1) {
    // search sweep: the hand, a short glow behind it and the count in the centre
    const a = hourAngle(aH + limit), tail = 0.7, g = ctx.createConicGradient(a - tail, C, C);
    g.addColorStop(0, mix(ink, ink, 0, 0)); g.addColorStop(tail / TAU, mix(ink, ink, 0, 0.25));
    g.addColorStop(tail / TAU + 0.001, mix(ink, ink, 0, 0)); g.addColorStop(1, mix(ink, ink, 0, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, C - 32, 0, TAU); ctx.arc(C, C, C - 88, 0, TAU, true); ctx.fill('evenodd');
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(C + Math.cos(a) * (C - 96), C + Math.sin(a) * (C - 96)); ctx.lineTo(C + Math.cos(a) * (C - 28), C + Math.sin(a) * (C - 28)); ctx.stroke();
    ctx.fillStyle = css('--color-text-muted'); ctx.font = '600 11px ' + css('--font-data'); ctx.fillText(tr('plan.clock.testing'), C, C - 26);
    ctx.fillStyle = ink; ctx.font = '500 34px ' + css('--font-data'); ctx.fillText(String(Math.round(clock.tested * clock.sweep)), C, C + 12);
    ctx.fillStyle = css('--color-text-muted'); ctx.font = '12px ' + css('--font-data'); ctx.fillText(tr('plan.clock.inSites', { n: state.searchResult?.conditions.sites.length ?? '' }), C, C + 36);
    ctx.textAlign = 'start';
    return;
  }
  // mission arc, with its ripple when the verdict has just changed
  // While dragging, the landing under the pointer (clock.preview) and its verdict, without recalculating everything.
  const pv = clock.preview, col = pv ? verdictColor(pv.code) : mix(clock.colorFrom, clock.colorTo, colorMix.v);
  const a0 = hourAngle(arcStart.v), a1 = hourAngle(arcStart.v + arcLength.v), R = C - 112;
  ctx.lineCap = 'round'; ctx.strokeStyle = col;
  if (ripple.v < 1) { ctx.globalAlpha = (1 - ripple.v) * 0.45; ctx.lineWidth = 14 + 30 * ripple.v; ctx.beginPath(); ctx.arc(C, C, R, a0, a1); ctx.stroke(); ctx.globalAlpha = 1; }
  ctx.globalAlpha = dim('mission') ? 0.25 : 1;
  ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(C, C, R, a0, a1); ctx.stroke();
  ctx.beginPath(); ctx.arc(C + Math.cos(a0) * R, C + Math.sin(a0) * R, 10, 0, TAU); ctx.fillStyle = css('--color-surface'); ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
  ctx.globalAlpha = 1;
  // The longest shadow of the mission, bracketed on the Sun ring when its figure is lit.
  const r = state.cache[s.id]?.result;
  if (clock.focus === 'shadow' && r?.longestShadowStart != null && r.maxDarkHours > 0) {
    const h0 = relH(r.longestShadowStart), Rs = C - 46;
    ctx.save(); ctx.strokeStyle = r.maxDarkHours <= c.req.batteryHours ? ink : css('--color-bad'); ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(C, C, Rs + 17, hourAngle(h0), hourAngle(h0 + r.maxDarkHours)); ctx.stroke();
    ctx.beginPath(); ctx.arc(C, C, Rs - 17, hourAngle(h0), hourAngle(h0 + r.maxDarkHours)); ctx.stroke();
    ctx.restore();
  }
  // the mission that would start on the day hovered in the calendar
  const hover = picker.hover, hoverStart = hover && relH(hover.t);
  if (hover && (!state.searchResult || wizard.open === 4) && hoverStart >= aH && hoverStart < aH + CLOCK.hours) { // only while the calendar is on screen
    const R = C - 134;
    ctx.save(); ctx.globalAlpha = 0.85; ctx.setLineDash([5, 4]); ctx.lineCap = 'butt'; ctx.lineWidth = 8; ctx.strokeStyle = verdictColor(hover.code);
    ctx.beginPath(); ctx.arc(C, C, R, hourAngle(hoverStart), hourAngle(Math.min(aH + CLOCK.hours, hoverStart + hover.days * 24))); ctx.stroke();
    ctx.restore();
  }
  // current instant
  const aa = hourAngle(arcStart.v + currentHour());
  ctx.strokeStyle = ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(C + Math.cos(aa) * (C - 96), C + Math.sin(aa) * (C - 96)); ctx.lineTo(C + Math.cos(aa) * (C - 30), C + Math.sin(aa) * (C - 30)); ctx.stroke();
  // centre
  ctx.fillStyle = css('--color-text-muted'); ctx.font = '600 11px ' + css('--font-data'); ctx.fillText(tr('plan.clock.landing'), C, C - 34);
  ctx.fillStyle = ink; ctx.font = '500 16px ' + css('--font-data'); ctx.fillText(fmtDateTime(pv ? pv.t : c.t0), C, C - 12);
  ctx.fillStyle = col; ctx.font = '700 30px ' + css('--font-display'); ctx.fillText(pv ? VERDICT_TITLE[pv.code] ?? '…' : verdict.title, C, C + 24);
  ctx.fillStyle = css('--color-text-muted'); ctx.font = '12px ' + css('--font-data'); ctx.fillText(tr('plan.clock.days', { days: fmtNum(c.days) }), C, C + 46);
  if (clock.extending) ctx.fillText(tr('plan.clock.loadingWeeks'), C, C + 64);
  ctx.textAlign = 'start';
}
(() => {
  // Dragging the mission. Moving it is only painting: the arc follows the pointer (frame by frame), the seam runs
  // ahead of it when it gets there, and the centre says the landing and its verdict, read from the landings the search
  // already judged (or judged for that one site). The full plan (every site, the sky, the figures, the calendar) is
  // recalculated once: when you let go, or when you stop for a moment. A tap puts the landing on the day under it.
  let drag = null, frame = 0, idle = 0;
  const stepMs = () => (state.searchResult?.stepHours ?? 12) * 36e5;
  const setLanding = t => { if (t !== config().t0) { $('date').value = isoLocal(t); $('delay').value = 0; actions.render(); } };
  const angleOf = e => {
    const r = $('clock').getBoundingClientRect();
    return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2);
  };
  // From the first day searched to as far as the data is loaded, in whole steps.
  const clamp = t => {
    const step = stepMs(), { c, epoch, maxEnd } = clockWindow();
    return Math.max(epoch, Math.min(maxEnd - c.days * DAY, epoch + Math.round((t - epoch) / step) * step));
  };
  const verdictAt = t => {
    const s = siteById(state.selected[0]);
    const l = optionFor(s.id)?.landings.find(x => x.t === t);
    if (l) return l.code;
    try { const c = config(); return services.mission.judge?.(s, t, { days: c.days, ...c.req })?.verdict.code ?? null; } catch { return null; }
  };
  const preview = t => {
    if (clock.preview?.t === t) return;
    clock.preview = { t, code: verdictAt(t) };
    follow(t);
    if (t + config().days * DAY > clockWindow().maxEnd - 10 * DAY) extend();
    arcStart.set(relH(t));
    $('clock').setAttribute('aria-valuetext', tr('plan.clock.preview', { date: fmtDateTime(t) }));
    clearTimeout(idle); idle = setTimeout(commit, 350); // stopped for a moment: show the whole plan for that day
  };
  function commit() {
    clearTimeout(idle);
    const t = clock.preview?.t; clock.preview = null;
    clock.held = true; // the arc is already there: no glide when the plan comes back
    if (t != null && t !== config().t0) setLanding(t); else paintClock();
    clock.held = false;
  }
  $('clock').addEventListener('keydown', e => {
    const step = stepMs(), { c } = clockWindow(), cond = state.searchResult?.conditions;
    const to = { ArrowRight: c.t0 + step, ArrowUp: c.t0 + step, ArrowLeft: c.t0 - step, ArrowDown: c.t0 - step, PageUp: c.t0 - 7 * DAY, PageDown: c.t0 + 7 * DAY,
      Home: cond?.from ?? c.t0, End: cond?.to ?? c.t0 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    setLanding(clamp(to));
  });
  $('clock').addEventListener('pointerdown', e => {
    drag = { a: angleOf(e), turned: 0, t0: config().t0, x: e.clientX, y: e.clientY, moved: false };
    clock.dragging = true; $('clock').setPointerCapture(e.pointerId);
  });
  $('clock').addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    drag.moved = true;
    // Clockwise is later, and a full turn is CLOCK.hours: keep going round and the weeks keep coming.
    const a = angleOf(e); let d = a - drag.a; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    drag.turned += d; drag.a = a;
    const t = clamp(drag.t0 + (drag.turned / (2 * Math.PI)) * CLOCK.hours * 36e5);
    cancelAnimationFrame(frame); frame = requestAnimationFrame(() => preview(t));
  });
  const end = e => {
    if (!drag) return;
    cancelAnimationFrame(frame);
    if (!drag.moved && e?.type === 'pointerup') {
      // the day under the pointer, on the dial as it stands (between the seam and one turn after it)
      const { epoch } = clockWindow(), aH = relH(clock.anchor);
      const h = dialRot.v + (((angleOf(e) + Math.PI / 2) / (2 * Math.PI) + 1) % 1) * CLOCK.hours;
      const inView = aH + (((h - aH) % CLOCK.hours) + CLOCK.hours) % CLOCK.hours;
      clock.preview = { t: clamp(epoch + inView * 36e5) };
    }
    drag = null; clock.dragging = false;
    commit();
  };
  $('clock').addEventListener('pointerup', end);
  $('clock').addEventListener('pointercancel', end);
})();

// ---------------- Landing timeline (#132) ----------------
// One date axis from the first day of the searched window to its last day plus one mission. «Aterrizar» is the date
// picker's verdict of each day (the same cache); Sol, Tierra and Misión are the site and the landing on screen.
const HOUR = 36e5, DAY = 864e5, SKY_MAX_HOURS = 2900; // /v1/track gives at most 3000 points
const VERDICT_VAR = { viable: 'var(--color-ok)', marginal: 'var(--color-warn)', not_viable: 'var(--color-bad)' };
const DAY_WORD = { viable: tr('common.word.viable'), marginal: tr('common.word.marginal'), not_viable: tr('common.word.not_viable') };
const pctOf = f => `${(f * 100).toFixed(3)}%`;
const mostCommon = list => [...list.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0]?.[0];

function timelineState() {
  const s = siteById(state.selected[0]), res = state.searchResult;
  if (!res || !s || !state.cache[s.id]) return null;
  const c = config(), cond = res.conditions;
  return { s, c, cond, span: timelineSpan({ from: cond.from, to: cond.to, days: c.days, t0: c.t0 }) };
}

// The days of the span with their verdict on the site, from the calendar's cache. null while a month loads.
function timelineDays({ s, cond, span }) {
  const end = span.start + span.landingDays * DAY, out = [];
  for (let m = monthStart(span.start); m < end; m = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1)) {
    const days = daysOfMonth(cond, m, () => state.view === 'plan' && drawTimeline());
    if (!days) return null;
    out.push(...days.filter(d => d.t >= span.start && d.t < end));
  }
  return out.map(d => ({ t: d.t, own: d.bySite[s.id] }));
}

let tlBuilt = null, tlSkyFailed = null, dragging = false;
function drawTimeline() {
  const k = timelineState(); if (!k) return;
  const { s, c, span } = k, days = timelineDays(k);
  const sky = span.totalHours <= SKY_MAX_HOURS && tlSkyFailed !== `${s.id}|${span.start}|${span.totalHours}`
    ? services.mission.sky(s, span.start, span.totalHours / 24, (got, err) => {
      if (err) tlSkyFailed = `${s.id}|${span.start}|${span.totalHours}`;
      if (state.view === 'plan') drawTimeline();
    }) : null;
  const key = [s.id, span.start, span.totalHours, JSON.stringify(c.req), heightsKey(c.heights), services.mission.source, !!days, !!sky].join('|');
  if (tlBuilt !== key) { tlBuilt = key; buildTimeline(k, days, sky); }
  if (!dragging) placeTimeline(k, days);
}

// What only changes with the site, the span or the data: the day cells, the Sun area, the Earth bars and the axis.
function buildTimeline({ s, span }, days, sky) {
  const total = span.totalHours, totalDays = total / 24;
  const focused = document.activeElement?.closest?.('#tl-landing') ? document.activeElement.dataset.i : null;
  $('tl-range').textContent = tr('plan.tl.range', { site: s.short, from: fmtDate(span.start), to: fmtDate(span.start + total * HOUR - 1) });
  const landing = $('tl-landing');
  landing.style.setProperty('--tail', pctOf(span.landingDays / totalDays));
  landing.innerHTML = days ? days.map((d, i) => {
    const code = dayVerdict(d.own), label = dayLabel(d);
    return `<button type="button" class="${code ?? ''}" data-i="${i}" tabindex="-1" style="--x: ${pctOf(i / totalDays)}; --w: ${pctOf(1 / totalDays)}; --day: ${VERDICT_VAR[code] ?? 'var(--color-border)'}" aria-label="${esc(label)}" title="${esc(label)}"></button>`;
  }).join('') : '';
  $('tl-landing-summary').textContent = days ? tr('plan.tl.days') + verdictRuns(days.map(d => dayVerdict(d.own))).map(r =>
    `${r.from === r.to ? tr('plan.tl.on', { day: shortDay(days[r.from].t) }) : tr('plan.tl.fromTo', { from: shortDay(days[r.from].t), to: shortDay(days[r.to].t) })}, ${DAY_WORD[r.code] ?? tr('plan.tl.noData')}`).join('; ') + '.' : tr('plan.tl.loading');
  if (focused !== null) landing.querySelector(`[data-i="${focused}"]`)?.focus({ preventScroll: true });

  const { sun, earth } = services.mission.visibleHours(s, span.start, total);
  const heights = sunHeights(sun, sky?.series ?? null), top = Math.max(2, Math.ceil(Math.max(0, ...heights)));
  const H = 40, low = H - (LOW_SUN_MARGIN_DEG / top) * H;
  $('tl-sun').setAttribute('viewBox', `0 0 ${total} ${H}`);
  $('tl-sun').innerHTML = `<path d="${areaPath(heights, H, top)}"/>` + (sky ? `<line x1="0" x2="${total}" y1="${low}" y2="${low}" vector-effect="non-scaling-stroke"/>` : '');
  $('tl-sun-scale').textContent = sky ? `0–${top}°` : span.totalHours > SKY_MAX_HOURS ? tr('plan.tl.noHeight') : tr('plan.tl.loadingShort');
  $('tl-sun-scale').title = sky ? tr('plan.tl.sunScale', { top, low: fmtDeg(LOW_SUN_MARGIN_DEG) }) : span.totalHours > SKY_MAX_HOURS ? tr('plan.tl.tooLong') : '';
  $('tl-earth').setAttribute('viewBox', `0 0 ${total} 10`);
  $('tl-earth').innerHTML = visibleRuns(earth).map(([a, b]) => `<rect x="${a}" y="0" width="${b - a}" height="10"/>`).join('');

  const width = $('tl-axis').clientWidth || 600, every = [1, 2, 5, 7, 10, 15, 30].find(n => totalDays / n <= Math.max(2, Math.floor(width / 52))) ?? 30;
  let ticks = '';
  for (let d = 0; (1 - d / totalDays) * width >= 44; d += every) ticks += `<span style="--x: ${pctOf(d / totalDays)}">${shortDay(span.start + d * DAY)}</span>`;
  $('tl-axis').innerHTML = ticks;
}

function dayLabel(d) {
  const date = `${WEEKDAYS[new Date(d.t).getUTCDay()]} ${shortDay(d.t)}`, code = dayVerdict(d.own);
  if (code === 'viable') return tr('plan.tl.dayViable', { date, hours: d.own.slots.filter(x => x.code === 'viable').map(x => hh(x.t)).join(', ') });
  if (code === 'marginal') return tr('plan.tl.dayMarginal', { date, reason: reasonText(mostCommon(d.own.slots.filter(x => x.code === 'marginal').map(x => x.reason))) });
  if (code === 'not_viable') return tr('plan.tl.dayNotViable', { date, reason: reasonText(mostCommon(d.own.slots.map(x => x.reason))) });
  return tr('plan.tl.dayNoData', { date });
}

// The mission bar and its span over the rows, at a landing (also while dragging, before the plan follows).
function placeMission(span, t, days, code) {
  $('tl-now').style.setProperty('--x', pctOf(fractionOf(t + currentHour() * HOUR, span)));
  const { x, w } = missionWindow(t, days, span);
  for (const id of ['tl-mission', 'tl-span']) {
    $(id).style.setProperty('--x', pctOf(x)); $(id).style.setProperty('--w', pctOf(w));
    $(id).style.setProperty('--verdict', VERDICT_VAR[code] ?? 'var(--color-text-muted)');
  }
}

// What moves with the landing and the instant: the mission bar, the cursor of the sky's slider and the words.
function placeTimeline({ s, c, span }, days) {
  const { verdict, result } = state.cache[s.id];
  placeMission(span, c.t0, c.days, verdict.code);
  const day = Math.floor((c.t0 - span.start) / DAY);
  $('tl-landing').querySelectorAll('button').forEach(b => {
    const on = +b.dataset.i === day;
    b.tabIndex = on ? 0 : -1;
    if (on) b.setAttribute('aria-current', 'date'); else b.removeAttribute('aria-current');
  });
  if (days && !$('tl-landing').querySelector('[tabindex="0"]')) $('tl-landing').querySelector('button')?.setAttribute('tabindex', '0');
  const m = $('tl-mission');
  m.setAttribute('aria-valuemin', '0'); m.setAttribute('aria-valuemax', String(Math.round((span.lastLanding - span.start) / HOUR)));
  m.setAttribute('aria-valuenow', String(Math.round((c.t0 - span.start) / HOUR)));
  m.setAttribute('aria-valuetext', tr('plan.tl.value', { weekday: WEEKDAYS[new Date(c.t0).getUTCDay()], date: fmtDateTime(c.t0), verdict: verdict.title, days: fmtNum(c.days) }));
  describeLanding(s, c, verdict, result);
  paintGhost();
}

// The landing in one sentence: verdict and its reason, and how long the Sun and the Earth last from the landing.
let announced = null;
function describeLanding(s, c, verdict, r) {
  const tone = { viable: 'text-ok', marginal: 'text-warn', not_viable: 'text-bad' }[verdict.code];
  const when = reasonStart(verdict.reason ?? '', r), first = firstReason(verdict.reason ?? '');
  const firstText = reasonText(first.text);
  const reason = lowerFirst(firstText) + (first.more ? tr('plan.tl.more', first.more) : '');
  const u = services.mission.untilChange(s, c.t0);
  const dur = x => `${x.atLeast ? tr('plan.until.atLeast') : ''}${fmtHours(Math.round(x.ms / HOUR))}`;
  const body = (x, name, bare) => x.visible ? tr('plan.tl.sets', { name, dur: dur(x) }) : tr(x.atLeast ? 'plan.tl.noneNotRising' : 'plan.tl.noneRises', { bare, dur: dur(x) });
  const until = u ? tr('plan.tl.until', { sun: body(u.sun, tr('plan.tl.theSun'), tr('common.sun')), earth: body(u.earth, tr('plan.tl.theEarth'), tr('common.earth')) }) : '';
  $('tl-summary').innerHTML = `<b class="${tone}">${esc(verdict.title)}</b>${reason ? `: ${esc(reason)}` : ''}${when ? tr('plan.tl.since', { day: esc(shortDay(when)), hour: hh(when) }) : ''}.${esc(until)}`;
  const key = `${c.t0}|${verdict.code}|${c.days}`;
  if (announced !== null && announced !== key) $('tl-live').textContent = tr('plan.tl.live', { date: fmtDateTime(c.t0), verdict: verdict.title, reason: reasonText(verdict.reason ?? '') });
  announced = key;
}

// A landing previewed without moving the mission: a day hovered in the calendar or on the «Aterrizar» row.
let rowHover = null;
function paintGhost() {
  const k = timelineState(), g = $('tl-ghost'), hover = rowHover ?? picker.hover;
  if (!k || !hover || hover.t === k.c.t0) { g.hidden = true; return; }
  const f = fractionOf(hover.t, k.span);
  if (f < 0 || f >= 1) { g.hidden = true; return; }
  g.hidden = false;
  const { x, w } = missionWindow(hover.t, hover.days, k.span);
  g.style.setProperty('--x', pctOf(x)); g.style.setProperty('--w', pctOf(w));
  g.style.setProperty('--verdict', VERDICT_VAR[hover.code] ?? 'var(--color-text-muted)');
}

// A figure of the readout hovered or focused: its row of the timeline stays lit and the rest dim.
function setFocusRow(row) { const tl = $('timeline'); if (row) tl.dataset.focus = row; else delete tl.dataset.focus; }

(() => {
  const setLanding = t => { if (t !== config().t0) { $('date').value = isoLocal(t); $('delay').value = 0; actions.render(); } };
  const dayOfButton = b => { const k = timelineState(), days = k && timelineDays(k); return days?.[+b.dataset.i] ? { k, d: days[+b.dataset.i] } : null; };

  // «Aterrizar»: a day lands at its first hour that works (as the calendar's preview). The arrows walk the days.
  $('tl-landing').addEventListener('click', e => {
    const b = e.target.closest('button'), x = b && dayOfButton(b); if (!x?.d.own) return;
    rowHover = null; setLanding(dayLanding(x.d.own));
  });
  $('tl-landing').addEventListener('keydown', e => {
    const list = [...$('tl-landing').querySelectorAll('button')], i = list.indexOf(document.activeElement);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (i < 0 || to === undefined) return;
    e.preventDefault();
    const b = list[Math.max(0, Math.min(list.length - 1, to))];
    list.forEach(x => { x.tabIndex = x === b ? 0 : -1; });
    b.focus();
  });
  const preview = e => {
    const b = e.target.closest?.('#tl-landing button'), x = b && dayOfButton(b);
    rowHover = x?.d.own ? { t: dayLanding(x.d.own), days: x.k.c.days, code: dayVerdict(x.d.own) } : null;
    paintGhost();
  };
  $('tl-landing').addEventListener('pointerover', preview);
  $('tl-landing').addEventListener('focusin', preview);
  $('tl-landing').addEventListener('pointerleave', () => { rowHover = null; paintGhost(); });
  $('tl-landing').addEventListener('focusout', () => { rowHover = null; paintGhost(); });

  // «Misión»: dragged from where it was grabbed, or pressed anywhere on its row to land there. While it moves only the
  // bar and its verdict follow (judging one landing is cheap); the whole plan, with its sky, when it is dropped or
  // stops for a moment.
  let grab = null, dragT = null, idle = 0;
  const track = $('tl-mission-track');
  const fractionAt = e => { const r = track.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };
  const verdictAt = (s, t) => {
    const l = optionFor(s.id)?.landings.find(x => x.t === t);
    if (l) return l.code;
    try { const c = config(); return services.mission.judge?.(s, t, { days: c.days, ...c.req })?.verdict.code ?? null; } catch { return null; }
  };
  const commit = () => { clearTimeout(idle); if (dragT !== null) setLanding(dragT); };
  const follow = e => {
    const k = timelineState(); if (!k) return;
    const t = landingAt(fractionAt(e) - grab, k.span);
    if (t === dragT) return;
    dragT = t;
    placeMission(k.span, t, k.c.days, verdictAt(k.s, t));
    $('tl-mission').setAttribute('aria-valuetext', tr('plan.tl.preview', { date: fmtDateTime(t) }));
    clearTimeout(idle); idle = setTimeout(commit, 350);
  };
  const drop = () => {
    if (grab === null) return;
    grab = null; dragging = false;
    $('timeline').classList.remove('is-dragging');
    commit();
    const k = timelineState(); if (k) placeTimeline(k, timelineDays(k));
  };
  track.addEventListener('pointerdown', e => {
    const k = timelineState(); if (!k) return;
    const onBar = e.target.closest('#tl-mission');
    grab = onBar ? fractionAt(e) - fractionOf(k.c.t0, k.span) : 0;
    dragging = true;
    $('timeline').classList.add('is-dragging', 'is-pointer'); // the focus ring is for the keyboard: .focus() below would light it
    track.setPointerCapture(e.pointerId);
    if (onBar) $('tl-mission').focus({ preventScroll: true });
    dragT = null; follow(e);
  });
  track.addEventListener('pointermove', e => { if (grab !== null) follow(e); });
  track.addEventListener('pointerup', drop);
  track.addEventListener('pointercancel', drop);
  $('tl-mission').addEventListener('focus', () => { if (!dragging) $('timeline').classList.remove('is-pointer'); });
  $('tl-mission').addEventListener('keydown', e => {
    $('timeline').classList.remove('is-pointer');
    const k = timelineState(); if (!k) return;
    const t = landingForKey(k.c.t0, e.key, e.shiftKey, k.span);
    if (t === null) return;
    e.preventDefault();
    setLanding(t);
  });
  let resize = 0;
  addEventListener('resize', () => { cancelAnimationFrame(resize); resize = requestAnimationFrame(() => { tlBuilt = null; if (state.view === 'plan') drawTimeline(); }); });
})();
