// "Replanificar" view: the driving adapter of the replan slice (docs/adr/0001-arquitectura-hexagonal.md).
// It reads the form, asks the replan service (which answers with planner/src/replan.js) and paints:
//   - at a glance: the delay chips, the answer (does the plan hold, why not, the best move and «Adoptar») and one
//     table with your plan and the exits, same three figures per row;
//   - «▶ Simular la misión»: your plan and the best exit hour by hour, with the battery;
//   - folded under «Ver detalles»: the form, the region sketch and when each site can land (one row per site).
// No business rule lives here: verdicts, ordering, margin and suggestions come from the domain.
import { SITES, transitNote } from '../engine/catalog.js';
import { $, esc, isoLocal } from '../common/util.js';
import { simDay } from '../common/mission-text.js';
import { state, actions, config, transitOf } from '../common/state.js';
import { earthGapOf, hasEarthGap } from '../common/earth-gap.js';
import { adopt } from '../common/adopt.js';
import { decorate } from '../common/explain.js';
import { badge, button } from '../common/ui.js';
import { replay } from '../../motion/motion.js';
import { describeHorizon, rangeFor, toDomainProfile, verdictSource } from '../application/replan-service.js';
import { t, fmtNum, fmtPct, fmtHours, fmtDate, fmtDateTime, fmtDayMonth } from '../common/i18n.js';
import { SCAN_STEP_HOURS, launchDate } from '../../../planner/src/rules.js';
import { missionTimeline, distanceKm } from '../../../planner/src/replan.js';
import * as M from '../engine/model.js';
import { drawBaseMap, reliefImage } from '../common/map.js';
import { baseMapNote } from '../common/relief-note.js';
import { theme } from '../common/theme.js';
import { regionFor, viewerUrl, linkSearch } from '../../../viewpoint/src/core/mission-link.js';

const DAY_MS = 864e5;
const SCAN_STEP_DAYS = SCAN_STEP_HOURS / 24; // the domain moves landings (and measures margins) in these steps
const DEFAULT_DEADLINE_DAYS = 60;
const MAX_CALENDAR_DAYS = 120;
const TONE = { viable: 'ok', marginal: 'warn', 'not-viable': 'bad', 'no-data': 'neutral' };
const TITLE = Object.fromEntries(['viable', 'marginal', 'not-viable', 'no-data'].map(k => [k, t(`replan.verdict.${k}`)]));
const EXIT = {
  a: { letter: 'A', title: t('replan.exit.a') },
  b: { letter: 'B', title: t('replan.exit.b') },
  c: { letter: 'C', title: t('replan.exit.c') },
};

let service = null;

// Test mode (?test=1): measures the PRD hypothesis (choose an exit after a simulated delay in ≤ 5 min). It loads a
// fixed scenario, times until "Adoptar" and logs the result to the console. Nothing leaves the browser.
// Scenario: original plan at de Gerlache on 2027-03-30 00:00 UTC, small robotic lander, 3 days of delay. With the
// simulated engine it breaks the plan and gives A, B and C different and viable (and Plan also sees the original
// plan as viable, so both verdicts agree; see docs/adr/0001).
const TEST = new URLSearchParams(location.search).get('test') === '1';
const TEST_SCENARIO = { siteId: 'gerlache', landing: Date.parse('2027-03-30T00:00:00Z'), delayDays: 3, mission: { days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48 } };
const THRESHOLD_S = 300;
const trial = { started: null, loaded: false, interactions: { calendar: 0, delay: 0, spacecraft: 0, radius: 0, suggestions: 0 }, done: false };
// Form state of the view. The delay and the deadline are relative to the original plan.
const form = { delayDays: 0, deadlineDays: DEFAULT_DEADLINE_DAYS, radiusKm: 60, mission: null };
let last = null;       // last answer painted: { options, sweep, … }, used by the click handlers
let shown = null;      // what was on screen, so only what changed moves
let shownSim = null;   // what the simulation last played, so it does not restart on unrelated repaints

/** Composition root hook: app.js gives the view its service. */
export function initReplan(deps) { service = deps.service; }

// ---------------- Formatting ----------------
// Dates, numbers and durations from shared/format through common/i18n.js (#343): «15 ene 2027 · 00:00 UTC».
const fmtWhen = fmtDateTime;
const num = (n, d = 1) => fmtNum(n, d);
const fmtDelay = d => (Math.abs(d) < 1 / 48 ? t('replan.noDelay') : `+${d < 1 ? fmtHours(d * 24) : num(d) + ' d'}`);
const fmtDelayExact = d => (Math.abs(d) < 1 / 48 ? t('replan.noDelay') : `+${fmtHours(d * 24)}`); // "+5 d 6 h": margins move in 6 h steps
const pct = f => fmtPct(f * 100);
const verdictBadge = v => badge(TITLE[v], { tone: TONE[v], variant: 'pill' });
const shortName = site => SITES.find(s => s.id === site.id)?.short ?? site.name;
// Reasons the domain writes (planner/src/rules.js, in Spanish), in the language in use.
const reasonText = s => t('replan.domainReason', s);
const exitLabel = kind => `${EXIT[kind].letter} · ${EXIT[kind].title.toLowerCase()}`;

// Why the plan fails, in plain words and with its consequence for the lander. The rule is the domain's limiting
// rule, the same one «¿Por qué?» explains, so the two always give the same cause.
// Without terrain (real windows over a smooth Moon) nothing is behind a ridge: it is below the horizon.
const hasTerrain = siteId => (service.horizonModels()[siteId] ?? 'simulated-terrain') !== 'sphere';
function explainFailure(o, mission = form.mission) {
  const r = o.evaluation.limiting, m = o.evaluation.metrics, day = fmtDate(o.landingMs);
  const terrain = hasTerrain(o.site.id);
  if (!r || !m || m.noData) return r?.reason ? `${reasonText(r.reason)}.` : t('replan.fail.noData');
  if (r.id === 'R4') return t('replan.fail.R4', { day, terrain, shadow: fmtHours(m.longestShadowHours), battery: fmtHours(mission.batteryHours) });
  if (r.id === 'R6') return t('replan.fail.R6', { day, terrain, outage: fmtHours(m.longestEarthOutageHours), from: fmtClockShort(m.longestEarthOutageStart), max: fmtHours(mission.maxEarthGapHours) });
  if (r.id === 'R8') return t('replan.fail.R8', { day, pct: pct(m.earthFraction), min: fmtNum(mission.minEarthPct) });
  if (r.id === 'R1') return t('replan.fail.R1', { day, terrain, rise: m.hoursToSunrise != null ? fmtHours(m.hoursToSunrise) : null });
  if (r.id === 'R2') return t('replan.fail.R2', { day, terrain, rise: m.hoursToEarthrise != null ? fmtHours(m.hoursToEarthrise) : null });
  return `${reasonText(r.reason)}.`;
}

// What the recommended exit asks you to do, and why it works there.
function bestMove(rec) {
  return t(`replan.move.${rec.kind}`, { site: rec.site.name, day: fmtDate(rec.landingMs), delay: fmtDelay(rec.totalDelayDays), km: Math.round(rec.distanceKm) });
}
function whyBest(rec, mission = form.mission) {
  const m = rec.evaluation.metrics; if (!m || m.noData) return '';
  return t('replan.why', { there: rec.kind !== 'a', shadow: m.longestShadowHours < 0.5 ? null : fmtHours(m.longestShadowHours), battery: fmtHours(mission.batteryHours),
    pct: pct(m.earthFraction), gap: m.longestEarthOutageHours < 0.5 ? null : fmtHours(m.longestEarthOutageHours) });
}

// ---------------- Plan and form ----------------
function originalPlan() {
  if (state.originalPlan) return state.originalPlan;
  const c = config();
  return { site: SITES.find(s => s.id === state.selected[0]), landing: c.base };
}
const currentPlan = () => state.plan || originalPlan();

function missionFromSidebar() {
  const c = config();
  return { days: c.days, batteryHours: c.req.batteryHours, minEarthPct: c.req.minEarthPct, maxEarthGapHours: c.req.maxEarthGapHours, transitDays: c.req.transitDays };
}

function fillForm() {
  const o = originalPlan(), m = form.mission;
  $('rp-delay').value = form.delayDays;
  $('rp-not-before').value = isoLocal(o.landing + form.delayDays * DAY_MS);
  $('rp-not-after').value = isoLocal(o.landing + form.deadlineDays * DAY_MS).slice(0, 10);
  $('rp-delay-help').textContent = t('replan.delayHelp', { launch: launchDay(o.landing), landing: fmtWhen(o.landing) });
  $('rp-battery').value = m.batteryHours; $('rp-days').value = m.days; $('rp-earth').value = m.minEarthPct; $('rp-earth-gap').value = m.maxEarthGapHours ?? '';
  $('rp-transit').value = toDomainProfile(m).transitDays;
  paintCraftSummary();
  $('rp-radius').value = form.radiusKm; $('rp-radius-value').textContent = `${form.radiusKm} km`;
  document.querySelectorAll('#rp-chips [data-delay]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.delay === form.delayDays)));
}

// The spacecraft folded as one line: what the verdict depends on, without opening the fields.
function paintCraftSummary() {
  const m = form.mission;
  $('rp-craft-summary').textContent = t('replan.craftSummary', { battery: num(m.batteryHours, 0), days: num(m.days), earth: num(m.minEarthPct, 0), gap: hasEarthGap(m.maxEarthGapHours) ? num(m.maxEarthGapHours, 0) : null, transit: num(toDomainProfile(m).transitDays) });
}

// Launch day of a landing (#67): the domain's launchDate with the transit of the spacecraft.
const launchDay = landingMs => fmtDate(launchDate(new Date(landingMs).toISOString(), toDomainProfile(form.mission)));

// The delay is asked in launch days (#67, 1.5): where it takes the landing, and the 1:1 assumption while the transit
// is fixed (a later launch could also take another trajectory: not modelled).
function paintDelayLanding(o) {
  const d = form.delayDays, landing = o.landing + d * DAY_MS, transit = num(toDomainProfile(form.mission).transitDays);
  $('rp-delay-landing').textContent = t('replan.delayLanding', { delay: d > 1 / 48 ? fmtDelay(d) : null, launch: launchDay(landing), landing: fmtWhen(landing), transit });
}

function readForm() {
  const o = originalPlan();
  form.mission = {
    batteryHours: Math.max(0, +$('rp-battery').value || 0),
    days: Math.max(1, Math.min(30, +$('rp-days').value || 1)),
    minEarthPct: Math.max(0, Math.min(100, +$('rp-earth').value || 0)),
    maxEarthGapHours: earthGapOf($('rp-earth-gap').value),
    transitDays: transitOf($('rp-transit').value),
  };
  form.radiusKm = +$('rp-radius').value || 60;
  $('rp-radius-value').textContent = `${form.radiusKm} km`;
  paintCraftSummary();
  return o;
}

// A new approved plan (from Plan or Advanced) resets the form; a plan adopted here keeps it.
actions.onAdopt = (_option, { fromReplan }) => {
  if (fromReplan) return;
  form.delayDays = 0; form.deadlineDays = DEFAULT_DEADLINE_DAYS; form.mission = missionFromSidebar();
  shown = null;
  fillForm();
};

function input() {
  const o = originalPlan(), p = currentPlan();
  return {
    mission: form.mission,
    original: { siteId: o.site.id, landingMs: o.landing },
    plan: { siteId: p.site.id, landingMs: p.landing },
    notBeforeMs: o.landing + form.delayDays * DAY_MS,
    notAfterMs: o.landing + Math.max(form.deadlineDays, form.delayDays) * DAY_MS,
    radiusKm: form.radiusKm,
    priority: state.searchResult?.conditions?.priority ?? null,
  };
}

// ---------------- Render ----------------
const MOBILE_QUERY = '(max-width: 700px)'; // same breakpoint as base.css and replan.css
// scroll-margin-top on .rp-head keeps the headline clear of the sticky bar
export function scrollToHeadline() {
  document.querySelector('.rp-head').scrollIntoView({ block: 'start' });
  // scrollIntoView does not move focus: put it on the headline so keyboard and screen-reader users follow the jump
  $('rp-status').focus({ preventScroll: true });
}

export function renderReplan() {
  if (TEST && !trial.loaded) loadTestScenario();
  $('rp-sample').hidden = state.planAdoptedByUser;
  if (!form.mission) { form.mission = missionFromSidebar(); fillForm(); }
  if (state.replanDelay != null) { // coming from Plan's «¿Y si se retrasa…?» with a delay to try
    form.delayDays = state.replanDelay; state.replanDelay = null;
    if (form.deadlineDays < form.delayDays) form.deadlineDays = form.delayDays;
    fillForm();
  }
  // A point typed in Plan (#101) is not a site of the catalogue, the only ones the domain of Replan knows.
  const unknown = [originalPlan(), currentPlan()].some(x => !service.sites.some(s => s.id === x.site?.id));
  if (unknown) {
    $('rp-status').textContent = t('replan.ownPoint');
    $('rp-status-reason').textContent = t('replan.ownPointReason');
    return;
  }
  const inp = input();
  // The panel and antenna heights are the ones of the mission (Plan): the same visibility data as Plan and Advanced.
  const range = rangeFor({ originalLandingMs: inp.original.landingMs, notAfterMs: inp.notAfterMs, days: form.mission.days, heights: config().heights });
  if (!service.isReady(range)) {
    $('rp-status').textContent = t('replan.loading');
    $('rp-status-reason').textContent = t('replan.loadingOnce');
    $('view-replan').classList.add('is-loading');
    service.prepare(range).then(() => { if (state.view === 'replan') renderReplan(); }, err => {
      $('rp-status').textContent = t('replan.loadFailed');
      $('rp-status-reason').textContent = t('replan.loadRetry', { message: err.message });
    });
    return;
  }
  $('view-replan').classList.remove('is-loading');
  $('rp-horizon').textContent = describeHorizon(service.horizonModels());
  paint(inp);
}

function loadTestScenario() {
  const site = SITES.find(x => x.id === TEST_SCENARIO.siteId);
  state.originalPlan = { site, landing: TEST_SCENARIO.landing };
  state.planAdoptedByUser = true;
  state.plan = { site, landing: TEST_SCENARIO.landing, reasons: [], robustness: null };
  state.replanHistory = [];
  form.delayDays = TEST_SCENARIO.delayDays; form.deadlineDays = DEFAULT_DEADLINE_DAYS; form.mission = { ...TEST_SCENARIO.mission };
  trial.loaded = true;
  fillForm();
  const banner = document.createElement('div');
  banner.className = 'rp-test'; banner.id = 'rp-test'; banner.setAttribute('role', 'status');
  document.querySelector('.rp-head').before(banner);
}
function tickTest() {
  if (!TEST || !trial.started) return;
  const s = Math.round((performance.now() - trial.started) / 1000), mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
  $('rp-test').innerHTML = trial.done
    ? t('replan.test.done', { time: `${mm}:${ss}` })
    : t('replan.test.running', { days: TEST_SCENARIO.delayDays, time: `${mm}:${ss}` });
}
setInterval(tickTest, 1000);
function count(kind) { if (TEST && !trial.done) trial.interactions[kind]++; }

function paint(inp = input()) {
  const options = service.options(inp);
  const o = originalPlan(), p = currentPlan();
  // Your site, the sites of the region, and then the rest of the polar catalogue (nearest first), so you see when
  // they hold even if they are beyond the radius: only the region counts for the exits.
  const regionIds = options.region.map(s => s.id).filter(id => id !== o.site.id && id !== p.site.id);
  const beyond = SITES.filter(s => !s.offMap && s.id !== o.site.id && s.id !== p.site.id && !regionIds.includes(s.id) && service.windows(s.id))
    .map(s => ({ id: s.id, km: distanceKm(toDomain(o.site), toDomain(s)) })).sort((x, y) => x.km - y.km);
  const rows = [o.site.id, ...(p.site.id !== o.site.id ? [p.site.id] : []), ...regionIds, ...beyond.map(x => x.id)];
  const outside = Object.fromEntries(beyond.map(x => [x.id, x.km]));
  // At least two months, so the days past the deadline show up (striped) and you see when a site reopens.
  const days = Math.min(MAX_CALENDAR_DAYS, Math.max(DEFAULT_DEADLINE_DAYS, Math.ceil((inp.notAfterMs - o.landing) / DAY_MS)));
  const sweep = service.sweep(rows, form.mission, o.landing, days, { wholeDays: true });
  last = { inp, options, rows, sweep, days, outside };

  const now = {
    needed: options.needed,
    calendar: [rows.join(), days, form.mission.days, form.mission.batteryHours, form.mission.minEarthPct, form.mission.maxEarthGapHours, o.landing].join('|'),
    exits: ['a', 'b', 'c'].map(k => options[k] ? `${options[k].site.id}@${options[k].landingMs}:${options[k].verdict}` : '-').join(),
    recommended: options.recommended ? `${options.recommended.kind}:${options.recommended.site.id}@${options.recommended.landingMs}` : '-',
  };
  paintHead(options, o, now);
  const simKey = [now.recommended, options.current.landingMs, options.current.site.id, form.mission.days, form.mission.batteryHours, simOpen].join('|');
  if (simKey !== shownSim) { shownSim = simKey; paintSim(options); }
  paintCalendar(options, o);
  paintRegion(options, o);
  paintRegionMap(options, o);
  paintOutcomes(options);
  shown = now;
  if (TEST && !trial.started) { trial.started = performance.now(); tickTest(); }
  decorate();
}

// The answer, in two lines and a button: does the plan hold, why not (with figures), and what to do instead.
function paintHead(options, o, now) {
  const cur = options.current, rec = options.recommended;
  const status = $('rp-status');
  // Flash when the answer changes (plan holds ↔ breaks, or another exit is recommended), whatever changed it.
  if (shown && (shown.needed !== now.needed || shown.recommended !== now.recommended)) replay(status, 'motion-flash');
  $('rp-answer').dataset.tone = options.needed ? 'bad' : 'ok';
  let recHtml = '';
  if (!options.needed) {
    // How much more delay the plan takes: the domain's margin, counted from the original landing.
    const holds = cur.totalDelayDays + cur.margin.days, breaks = holds + SCAN_STEP_DAYS;
    const who = t(state.replanHistory.length ? 'replan.yourPlanNow' : 'replan.yourPlan');
    status.textContent = cur.margin.open ? t('replan.holdsAtLeast', { who, delay: fmtDelayExact(holds) })
      : cur.margin.days || cur.totalDelayDays ? t('replan.holdsUpTo', { who, delay: fmtDelayExact(holds) })
        : t('replan.holdsNoMargin', { who });
    $('rp-status-reason').textContent = cur.margin.open ? t('replan.noChange') : t('replan.breaksAt', { delay: fmtDelayExact(breaks) });
  } else {
    status.textContent = cur.totalDelayDays > 1 / 48 ? t('replan.brokenWithDelay', { delay: fmtDelay(cur.totalDelayDays), site: shortName(cur.site) }) : t('replan.brokenAlways', { site: shortName(cur.site) });
    $('rp-status-reason').textContent = explainFailure(cur);
    if (rec) {
      recHtml = `<div class="rp-answer__text"><p class="rp-answer__best"><span aria-hidden="true">✓</span> ${t('replan.best')} ${esc(bestMove(rec))}</p><p class="rp-answer__why">${esc(whyBest(rec))}</p></div>`
        + button(t('replan.adopt'), { variant: 'primary', 'data-adopt': rec.kind, 'aria-label': t('replan.adoptLabel', { what: `${rec.site.name}, ${fmtWhen(rec.landingMs)}` }) });
    } else {
      const sugg = options.suggestions.map(s => s.kind === 'extend-deadline'
        ? button(t('replan.extendDeadline', { day: fmtDate(s.untilMs) }), { 'data-suggest': 'deadline', 'data-until': s.untilMs })
        : button(t('replan.extendRadius', { km: s.radiusKm }), { 'data-suggest': 'radius', 'data-radius': s.radiusKm })).join('');
      recHtml = `<p class="rp-answer__best is-none">${esc(t('replan.noExit', { day: fmtDate(last.inp.notAfterMs), km: form.radiusKm }))}</p>${sugg}`;
    }
  }
  recHtml += button(t(simOpen ? 'replan.simHide' : 'replan.simShow'), { 'data-sim': '', 'aria-expanded': String(simOpen), 'aria-controls': 'rp-sim' });
  $('rp-head-actions').innerHTML = recHtml;
  const steps = [o, ...state.replanHistory.map(h => h.to)];
  // Launch and landing (#67): the launch from the domain, with the transit marked as an assumption.
  const profile = toDomainProfile(form.mission);
  const when = ms => t('replan.trailWhen', { launch: fmtDate(launchDate(new Date(ms).toISOString(), profile)), landing: fmtWhen(ms) });
  $('rp-trail').textContent = t('replan.trail', { site: o.site.name, when: when(o.landing), current: steps.length > 1 ? `${steps.at(-1).site.name}, ${when(steps.at(-1).landing)}` : null })
    + ` (${transitNote(profile.transitDays)})`;
  paintDelayLanding(o);
}

// When each site can land: one row per site, one small cell per day from the original landing, coloured by its
// verdict that day. Three marks on top: where the plan was (Original), the first day the delay allows (Ahora) and
// the recommended exit (★). Clicking a day delays the plan to it.
function paintCalendar(options, o) {
  const { sweep, rows, days, inp, outside } = last;
  const main = currentPlan().site.id, rec = options.recommended;
  const day0 = Math.floor(o.landing / DAY_MS) * DAY_MS, dayOf = ms => Math.floor((ms - day0) / DAY_MS);
  const nowDay = dayOf(inp.notBeforeMs), deadlineDay = dayOf(inp.notAfterMs), recDay = rec ? dayOf(rec.landingMs) : null;
  const col = d => `grid-column: ${d + 2}`;
  const short = id => SITES.find(s => s.id === id)?.short ?? id;
  const ticks = [];
  for (let d = 0; d <= days; d++) {
    const date = new Date(day0 + d * DAY_MS);
    if (d % 7 === 0) ticks.push(`<span class="rp-tl__tick" style="${col(d)}">${esc(fmtDayMonth(date.getTime()))}</span>`);
  }
  // Marks that fall on the same day share one label ("Ahora · ★ Mejor"), so none hides another.
  const byDay = new Map();
  const add = (d, k, l) => { const m = byDay.get(d); if (m) { m.labels.push(l); if (k === 'rec') m.k = k; else if (m.k === 'original') m.k = k; } else byDay.set(d, { k, labels: [l] }); };
  add(0, 'original', t('replan.mark.original')); add(nowDay, 'now', t('replan.mark.now')); if (rec) add(recDay, 'rec', t('replan.mark.best'));
  const marks = [...byDay].map(([d, m]) => `<span class="rp-tl__mark" data-mark="${m.k}" style="${col(d)}">${m.labels.join(' · ')}</span>`).join('');
  const row = (id, i) => {
    const far = id in outside;
    const label = id === main ? `${t('replan.yourSite')}<small>${esc(short(id))}</small>` : far ? `${esc(short(id))}<small>${t('replan.outsideRadius', { km: Math.round(outside[id]) })}</small>` : esc(short(id));
    const cells = sweep[id].map((x, d) => {
      const cls = ['rp-tl__day', d < nowDay && 'is-lost', d > deadlineDay && 'is-out', d === nowDay && 'is-now', d === 0 && 'is-original', id === rec?.site.id && d === recDay && 'is-rec'].filter(Boolean).join(' ');
      const why = x.verdict === 'viable' ? '' : ` (${reasonText(x.reason)})`;
      return `<button type="button" class="${cls}" data-tone="${TONE[x.verdict]}" data-d="${d}" style="${col(d)}; grid-row: ${i + 3}" data-info="${esc(`${fmtDate(day0 + d * DAY_MS)} · ${short(id)}: ${TITLE[x.verdict]}${why}`)}" aria-label="${esc(`${fmtDate(day0 + d * DAY_MS)}, ${short(id)}: ${TITLE[x.verdict]}${why}`)}"></button>`;
    }).join('');
    return `<span class="rp-tl__site${far ? ' is-far' : ''}" style="grid-row: ${i + 3}">${label}</span>${cells.replaceAll('class="rp-tl__day', far ? 'class="rp-tl__day is-far' : 'class="rp-tl__day')}`;
  };
  const grid = $('rp-calendar');
  grid.style.setProperty('--days', days + 1);
  grid.innerHTML = `<span class="rp-tl__axis" aria-hidden="true">${ticks.join('')}</span><span class="rp-tl__marks" aria-hidden="true">${marks}</span>${rows.map(row).join('')}`;
  $('rp-cal-hint').textContent = t('replan.calHint');
  $('rp-tl-info').textContent = TL_INFO_HINT;
  // Only what is on screen: lost days exist with a delay, days past the deadline only if it is under the timeline's end.
  $('rp-cal-legend').innerHTML = `<span><i data-tone="ok"></i>${VERDICT_WORD.viable}</span><span><i data-tone="warn"></i>${VERDICT_WORD.marginal}</span><span><i data-tone="bad"></i>${VERDICT_WORD['not-viable']}</span>`
    + (nowDay > 0 ? `<span><i class="is-lost"></i>${t('replan.legend.lost')}</span>` : '')
    + (deadlineDay < days ? `<span><i class="is-out"></i>${t('replan.legend.out')}</span>` : '');
}

// The region as a plain list: the sites around the original, nearest first, with their verdict on the delayed
// date. Those beyond the radius are listed apart, so moving the radius shows who comes in.
const VERDICT_WORD = Object.fromEntries(['viable', 'marginal', 'not-viable', 'no-data'].map(k => [k, t(`replan.word.${k}`)]));
function paintRegion(options, o) {
  const landing = options.current.landingMs, inRegion = new Set(options.region.map(s => s.id));
  const recId = options.needed ? options.recommended?.site.id : null;
  const verdictOf = id => { try { return service.evaluate(id, landing, form.mission).verdict; } catch { return 'no-data'; } };
  const sites = SITES.filter(s => !s.offMap && s.id !== o.site.id)
    .map(s => ({ s, d: distanceKm(toDomain(o.site), toDomain(s)), inside: inRegion.has(s.id) }))
    .sort((x, y) => x.d - y.d);
  const item = ({ s, d }) => {
    const v = verdictOf(s.id);
    return `<li><span class="rp-region__name">${esc(s.name)}${s.id === recId ? ` <span class="rp-star">${t('replan.bestExit')}</span>` : ''}</span><span class="num">${Math.round(d)} km</span>${badge(VERDICT_WORD[v], { tone: TONE[v], variant: 'pill' })}</li>`;
  };
  const inside = sites.filter(x => x.inside), outside = sites.filter(x => !x.inside);
  $('rp-region-list').innerHTML = `<p class="hint">${esc(t('replan.regionIntro', { km: form.radiusKm, site: o.site.name, day: fmtDate(landing) }))}</p>
    ${inside.length ? `<ul class="rp-region__sites">${inside.map(item).join('')}</ul>` : `<p>${t('replan.regionNone')}</p>`}
    ${outside.length ? `<p class="hint">${t('replan.regionOutside')}</p><ul class="rp-region__sites is-far">${outside.map(item).join('')}</ul>` : ''}`;
}
const toDomain = s => ({ latDeg: s.lat, lonDeg: s.lon });

// The region on the south-pole map (#35): real LOLA relief (the image Advanced uses), the search radius around the
// original site, every polar site coloured by its verdict on the delayed date, and where the original and the exits
// A, B and C land. It only draws what the domain decided; the list below says the same in words.
// The base (relief, hatching, rings) is shared with Advanced (common/map.js, #331, #344); the legend says which relief
// is on screen and which way is up.
reliefImage(() => { if (state.view === 'replan' && last) paintRegionMap(last.options, originalPlan()); });
function paintRegionMap(options, o) {
  const cv = $('rp-region-map'), size = cv.clientWidth || 280, dpr = devicePixelRatio || 1, C = size / 2, th = theme();
  cv.width = cv.height = size * dpr; cv.style.height = `${size}px`;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
  const radius = Math.max(40, form.radiusKm * 1.2), k = C / radius; // the whole search circle always fits
  const centre = M.toMap(o.site.lat, o.site.lon);
  // Base shared with Advanced (common/map.js, #344): relief, hatching beyond it and latitude rings. No feature names:
  // at 280 px, with the site labels, they would be too much text.
  const { px, relief, uncovered } = drawBaseMap(ctx, { size, centre, radius, th, names: false });
  const sitePx = s => px(M.toMap(s.lat, s.lon));
  ctx.save(); ctx.beginPath(); ctx.arc(C, C, C, 0, 2 * Math.PI); ctx.clip();
  // The search radius.
  ctx.setLineDash([6, 4]); ctx.strokeStyle = th.mapMark; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(C, C, form.radiusKm * k, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = th.mapMark; ctx.font = '10px ' + th.fontData; ctx.textAlign = 'center';
  ctx.fillText(`${form.radiusKm} km`, C, Math.max(12, C - form.radiusKm * k - 4));
  ctx.restore();

  // Sites, coloured by their verdict on the delayed date.
  const landing = options.current.landingMs, colour = { viable: th.mapOk, marginal: th.mapWarn, 'not-viable': th.mapBad, 'no-data': th.mapMuted };
  const verdictOf = id => { try { return service.evaluate(id, landing, form.mission).verdict; } catch { return 'no-data'; } };
  // Letters of each site: O for the original, and A, B, C where each exit lands (★ the recommended one).
  const marks = new Map(), mark = (id, l) => marks.set(id, [...(marks.get(id) ?? []), l]);
  mark(o.site.id, t('replan.mark.original'));
  if (options.needed) for (const kind of ['a', 'b', 'c']) {
    const x = options[kind]; if (!x || (kind === 'c' && !x.improvesOnA)) continue;
    mark(x.site.id, `${options.recommended?.kind === kind ? '★ ' : ''}${EXIT[kind].letter}`);
  }
  ctx.textAlign = 'start'; ctx.font = '600 11px ' + th.fontBody;
  const said = [], placed = [], dots = [];
  const sites = SITES.filter(x => !x.offMap).map(x => ({ s: x, p: sitePx(x) })).filter(({ p }) => Math.hypot(p.x - C, p.y - C) <= C - 4);
  // Dots first, so labels can avoid all of them.
  for (const { s, p } of sites) {
    const v = verdictOf(s.id), big = marks.has(s.id);
    ctx.beginPath(); ctx.arc(p.x, p.y, big ? 7 : 5, 0, 2 * Math.PI);
    ctx.fillStyle = colour[v]; ctx.fill(); ctx.lineWidth = big ? 2.5 : 1.5; ctx.strokeStyle = th.mapMark; ctx.stroke();
    dots.push({ x: p.x - 8, y: p.y - 8, w: 16, h: 16 });
    const labels = marks.get(s.id);
    said.push(`${s.short}: ${VERDICT_WORD[v].toLowerCase()}${labels ? ` (${labels.join(', ').replace('★ ', `${t('replan.recommended')} `)})` : ''}`);
  }
  // Labels: the first free spot around the dot (right, left, below, above, then further away), inside the canvas.
  // When it ends up away from its dot, a thin line joins them.
  const hits = (r, list) => list.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h);
  for (const { s, p } of sites) {
    const labels = marks.get(s.id), text = `${s.short}${labels ? ` · ${labels.join(' · ')}` : ''}`, w = ctx.measureText(text).width + 6, h = 15;
    const spots = [[10, -h / 2], [-10 - w, -h / 2], [-w / 2, 10], [-w / 2, -10 - h]];
    for (let d = 1; d <= 6; d++) spots.push([-w / 2, 10 + d * 17], [-w / 2, -10 - h - d * 17]);
    const fit = ([dx, dy]) => ({ x: Math.max(2, Math.min(size - w - 2, p.x + dx)), y: Math.max(2, Math.min(size - h - 2, p.y + dy)), w, h });
    const r = spots.map(fit).find(b => !hits(b, placed) && !hits(b, dots)) ?? fit(spots[0]);
    placed.push(r);
    const cx = Math.max(r.x, Math.min(r.x + w, p.x)), cy = Math.max(r.y, Math.min(r.y + h, p.y));
    if (Math.hypot(cx - p.x, cy - p.y) > 12) { ctx.strokeStyle = th.mapText; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(cx, cy); ctx.stroke(); }
    ctx.fillStyle = th.mapLabelBg; ctx.fillRect(r.x, r.y, w, h);
    ctx.fillStyle = th.mapMark; ctx.fillText(text, r.x + 3, r.y + 11);
  }
  // The relief note goes in the label too: the legend is aria-hidden, and its warning is for everyone (#331).
  const note = baseMapNote(relief.state, verdictSource(service.horizonModels()), { uncovered });
  cv.setAttribute('aria-label', `${t('replan.mapLabel', { site: o.site.name, km: form.radiusKm, day: fmtDate(landing), list: said.join('; ') })} ${note.charAt(0).toUpperCase()}${note.slice(1)}.`);
  $('rp-region-legend').innerHTML = `<span><i style="--c: var(--color-map-ok)"></i>${VERDICT_WORD.viable}</span><span><i style="--c: var(--color-map-warn)"></i>${VERDICT_WORD.marginal}</span><span><i style="--c: var(--color-map-bad)"></i>${VERDICT_WORD['not-viable']}</span><span>${esc(t('replan.mapOn', { day: fmtDate(landing) }))} · ${esc(note)}</span>`;
}

// ---------------- Simulation ----------------
// «▶ Simular la misión»: your plan and the recommended exit hour by hour, with the battery draining in the dark.
// It is built from the same Sun and Earth windows as the verdict (missionTimeline in planner/src/replan.js), so it
// shows the rule at work rather than a separate model.
let simOpen = false, simFrame = null;
const fmtClockShort = fmtDate;
const fmtClock = fmtDateTime;

function simRow(label, o) {
  const w = service.windows(o.site.id), mission = form.mission;
  const tl = missionTimeline(w, o.landingMs, mission.days * DAY_MS, mission.batteryHours);
  const n = tl.steps.length - 1;
  // Runs of the same state as rects: sun, dark (draining) and empty battery; Earth as a thin line below.
  const runs = (key) => { const out = []; tl.steps.forEach((s, i) => { const k = key(s); if (out.length && out.at(-1).k === k) out.at(-1).to = i + 1; else out.push({ k, from: i, to: i + 1 }); }); return out; };
  const band = runs(s => (s.sun ? 'sun' : s.battery === 0 ? 'empty' : 'dark')).map(r => `<rect class="is-${r.k}" x="${r.from}" y="0" width="${r.to - r.from}" height="14"></rect>`).join('');
  const earth = runs(s => s.earth).filter(r => r.k).map(r => `<rect class="is-earth" x="${r.from}" y="17" width="${r.to - r.from}" height="3"></rect>`).join('');
  const ticks = Array.from({ length: mission.days + 1 }, (_, d) => `<span style="left: ${(d * 24 / n) * 100}%">${d ? t('replan.sim.day', { d }) : t('replan.sim.lands')}</span>`).filter((_, d) => d === 0 || d % Math.ceil(mission.days / 5) === 0).join('');
  // The ending says what the verdict says: the limiting rule when it fails, the battery when it holds.
  const ev = o.evaluation, m = ev.metrics, rule = ev.limiting?.id, ok = o.verdict === 'viable';
  const end = ok
    ? (tl.minBattery >= 0.999 ? t('replan.sim.sunAlways') : t('replan.sim.batteryHolds', { min: Math.round(tl.minBattery * 100) }))
    : rule === 'R1' ? t('replan.sim.R1', { terrain: hasTerrain(o.site.id), rise: m?.hoursToSunrise != null ? fmtHours(m.hoursToSunrise) : null })
      : rule === 'R2' ? t('replan.sim.R2', { rise: m?.hoursToEarthrise != null ? fmtHours(m.hoursToEarthrise) : null })
        : rule === 'R6' ? t('replan.sim.R6', { when: fmtClock(Date.parse(m.longestEarthOutageStart)), outage: fmtHours(m.longestEarthOutageHours), max: fmtHours(mission.maxEarthGapHours) })
        : rule === 'R8' ? t('replan.sim.R8', { pct: pct(m.earthFraction), min: fmtNum(mission.minEarthPct) })
          : tl.emptyAtMs ? t('replan.sim.empty', { when: fmtClock(tl.emptyAtMs), battery: fmtHours(mission.batteryHours) }) : t('replan.sim.fails', { reason: ev.limiting?.reason ? reasonText(ev.limiting.reason) : t('replan.sim.notViable') });
  return { tl, n, html: `<div class="rp-sim__row" data-ok="${ok}">
    <div class="rp-sim__label"><b>${esc(label)}</b> <span>${esc(t('replan.sim.landsOn', { site: o.site.name, when: fmtClock(o.landingMs) }))}</span></div>
    <div class="rp-sim__track"><svg viewBox="0 0 ${n + 1} 20" preserveAspectRatio="none" aria-hidden="true">${band}${earth}<rect class="rp-sim__cursor" x="0" y="0" width="${Math.max(1, (n + 1) / 200)}" height="20"></rect></svg><div class="rp-sim__ticks" aria-hidden="true">${ticks}</div></div>
    <div class="rp-sim__battery"><span class="rp-sim__gauge" aria-hidden="true"><i></i></span><span class="rp-sim__state"></span></div>
    <p class="rp-sim__end">${esc(end)}</p></div>` };
}

// Why the other site keeps the Sun (or the Earth) when yours loses it: the terrain towards it, at that moment.
// Only with the simulated engine, the one that has a terrain to look at.
function simWhy(cur, rec) {
  const r = cur.evaluation.limiting?.id, m = cur.evaluation.metrics;
  const simulated = Object.values(service.horizonModels()).every(h => h === 'simulated-terrain');
  if (!rec || !simulated || !m || m.noData || (r !== 'R4' && r !== 'R6' && r !== 'R8')) return '';
  const body = r === 'R4' ? 'sun' : 'earth', name = t(body === 'sun' ? 'replan.sim.sun' : 'replan.sim.earth');
  if (rec.kind === 'a') return t('replan.sim.whyWait', { body: name, day: fmtDate(rec.landingMs) });
  // Look at the middle of the long shadow (or outage), where the difference between the two sites is clearest.
  const startMs = Date.parse(body === 'sun' ? m.longestShadowStart : m.longestEarthOutageStart);
  if (!Number.isFinite(startMs)) return '';
  const mid = startMs + ((body === 'sun' ? m.longestShadowHours : m.longestEarthOutageHours) / 2) * 36e5;
  const here = M.sky(catalogSite(cur.site), mid)[body], there = M.sky(catalogSite(rec.site), mid)[body];
  const recGap = body === 'sun' ? rec.evaluation.metrics.longestShadowHours : rec.evaluation.metrics.longestEarthOutageHours;
  const by = x => `${num(Math.abs(x), 1)}°`;
  return t('replan.sim.whyThere', { body: name, when: fmtClock(mid), here: shortName(cur.site), by: by(here.margin), az: Math.round(here.az) })
    + (there.margin > 0
      ? t('replan.sim.thereVisible', { site: shortName(rec.site), km: Math.round(rec.distanceKm), by: by(there.margin) })
      : t('replan.sim.thereShorter', { site: shortName(rec.site), gap: fmtHours(recGap) }));
}

function paintSim(options) {
  $('rp-sim').hidden = !simOpen;
  cancelAnimationFrame(simFrame);
  if (!simOpen) return;
  const cur = options.current, rec = options.needed ? options.recommended : null;
  const rows = [simRow(t(options.needed ? 'replan.sim.planDelayed' : 'replan.yourPlan'), cur), ...(rec ? [simRow(t('replan.sim.bestExit'), rec)] : [])];
  $('rp-sim-rows').innerHTML = rows.map(r => r.html).join('');
  $('rp-sim-why').textContent = simWhy(cur, rec);
  paint3d(options);
  const els = [...$('rp-sim-rows').querySelectorAll('.rp-sim__row')];
  const show = (i) => { // i: hour index from landing
    const any = rows[0].tl.steps[Math.min(i, rows[0].n)];
    $('rp-sim-clock').textContent = t('replan.sim.clock', { day: simDay(i, form.mission.days), days: fmtNum(form.mission.days), when: fmtClock(any.t) });
    rows.forEach((r, k) => {
      const s = r.tl.steps[Math.min(i, r.n)], el = els[k];
      el.querySelector('.rp-sim__cursor').setAttribute('x', Math.min(i, r.n));
      el.querySelector('.rp-sim__gauge i').style.width = `${Math.round(s.battery * 100)}%`;
      el.querySelector('.rp-sim__gauge').dataset.level = s.battery === 0 ? 'empty' : s.battery < 0.34 ? 'low' : 'ok';
      el.querySelector('.rp-sim__state').textContent = s.sun ? t('replan.sim.withSun', { pct: Math.round(s.battery * 100) }) : s.battery === 0 ? t('replan.sim.noBattery') : t('replan.sim.dark', { pct: Math.round(s.battery * 100) });
    });
    els.forEach(el => el.classList.toggle('is-done', i >= rows[0].n));
  };
  const n = Math.max(...rows.map(r => r.n));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { show(n); return; }
  const start = performance.now(), ms = 7000;
  // The first frame can come slightly before `start`: clamp to the first hour.
  const tick = now => { const i = Math.max(0, Math.min(n, Math.round(((now - start) / ms) * n))); show(i); if (i < n) simFrame = requestAnimationFrame(tick); };
  els.forEach(el => el.classList.remove('is-done'));
  simFrame = requestAnimationFrame(tick);
}

// «Ver en 3D» (#36): the viewer of viewpoint/ (V1, #79) with the original plan, the plan with the delay or the best exit,
// so the relief that hides the Sun or the Earth can be seen on each. It opens in another tab, so Replan keeps its state.
let choice3d = 'delayed';
function paint3d(options) {
  const o = originalPlan(), cur = options.current, rec = options.needed ? options.recommended : null;
  const plans = {
    original: { label: t('replan.3d.original', { day: fmtDate(o.landing) }), siteId: o.site.id, t0: o.landing },
    delayed: { label: t('replan.3d.delayed', { day: fmtDate(cur.landingMs) }), siteId: cur.site.id, t0: cur.landingMs },
    ...(rec ? { best: { label: t('replan.3d.best', { day: fmtDate(rec.landingMs) }), siteId: rec.site.id, t0: rec.landingMs } } : {}),
  };
  if (!plans[choice3d]) choice3d = 'delayed';
  $('rp-3d-choice').innerHTML = Object.entries(plans).map(([k, p]) => `<button type="button" data-3d="${k}" aria-pressed="${k === choice3d}">${esc(p.label)}</button>`).join('');
  const p = plans[choice3d], link = $('rp-3d-link'), ok = !!regionFor(p.siteId), name = SITES.find(x => x.id === p.siteId)?.short ?? p.siteId;
  link.setAttribute('aria-disabled', String(!ok));
  if (ok) {
    link.href = viewerUrl({ siteId: p.siteId, t0: p.t0, ...form.mission, ...linkSearch(state.searchResult) }, location.search);
    link.setAttribute('aria-label', t('replan.3d.label', { site: name, when: fmtWhen(p.t0) }));
  } else link.removeAttribute('href');
  $('rp-3d-note').textContent = ok
    ? t('replan.3d.note', { site: name, when: fmtWhen(p.t0) })
    : t('replan.3d.missing', { site: name });
}
$('rp-3d-choice').addEventListener('click', e => {
  const b = e.target.closest('[data-3d]'); if (!b || !last) return;
  choice3d = b.dataset['3d']; paint3d(last.options);
});

// Catalogue site with its (simulated) horizon, for simWhy.
const catalogSite = site => { const s = SITES.find(x => x.id === site.id); if (s && !s.horizon) s.horizon = M.computeHorizon(s); return s; };

// ---------------- Options ----------------
// One table: your plan with the delay, then the recommended exit, then the rest. Same three figures in every row;
// a figure that breaks a limit carries «✕» and the limit, not only colour.
const ROW_TITLE = { a: t('replan.row.a'), b: t('replan.row.b'), c: t('replan.row.c') };
function figureCells(o) {
  const m = o.evaluation.metrics, req = form.mission;
  if (!m || m.noData) return `<td colspan="4" class="hint">${t('replan.table.noData')}</td>`;
  const cell = (text, fails, limit) => `<td class="num${fails ? ' is-bad' : ''}">${fails ? `<span aria-hidden="true">✕ </span>${text}<small>${limit}</small>` : text}</td>`;
  return cell(pct(m.sunFraction), false)
    + cell(fmtHours(m.longestShadowHours), m.longestShadowHours > req.batteryHours, t('replan.table.battery', { h: fmtHours(req.batteryHours) }))
    + cell(pct(m.earthFraction), m.earthFraction * 100 < req.minEarthPct, t('replan.table.min', { pct: fmtNum(req.minEarthPct) }))
    + cell(fmtHours(m.longestEarthOutageHours), hasEarthGap(req.maxEarthGapHours) && m.longestEarthOutageHours > req.maxEarthGapHours, t('replan.table.max', { h: fmtHours(req.maxEarthGapHours) }));
}
// Why C does not beat A, in the terms of the domain's improvesOnA: a worse verdict, or the same one no earlier.
const SEVERITY = { viable: 0, marginal: 1, 'not-viable': 2, 'no-data': 3 };
function noGainReason(c, a) {
  if (!a) return '';
  if (SEVERITY[c.verdict] > SEVERITY[a.verdict]) return t('replan.noGain.worse', { c: TITLE[c.verdict].toLowerCase(), a: TITLE[a.verdict].toLowerCase() });
  if (c.landingMs === a.landingMs) return t('replan.noGain.same');
  return t('replan.noGain.later', { c: fmtDate(c.landingMs), a: fmtDate(a.landingMs) });
}
function paintOutcomes(options) {
  const cur = options.current, rec = options.recommended?.kind;
  const when = o => `<td class="num">${esc(fmtDelay(o.totalDelayDays))}<small>${esc(fmtDate(o.landingMs))}</small></td>`;
  const rows = [`<tr class="is-current"><th scope="row">${t('replan.yourPlan')}<small>${esc(cur.site.name)}</small></th>${when(cur)}${figureCells(cur)}<td>${verdictBadge(cur.verdict)}</td></tr>`];
  if (options.needed) {
    const kinds = ['a', 'b', 'c'].sort((x, y) => (y === rec) - (x === rec));
    for (const k of kinds) {
      const x = options[k];
      const title = `${k === rec ? `<span class="rp-star" aria-label="${t('replan.recommendedStar')}">★</span> ` : ''}${ROW_TITLE[k]}`;
      if (!x) {
        rows.push(`<tr class="is-empty"><th scope="row">${title}</th><td colspan="6" class="hint">${k === 'a' ? t('replan.empty.a') : t('replan.empty.bc', { km: form.radiusKm })}</td></tr>`);
        continue;
      }
      // C that does not beat A (the domain's improvesOnA): shown, but said so, and never the recommended one.
      const noGain = k === 'c' && !x.improvesOnA;
      const note = noGain ? `<small class="rp-no-gain">${esc(t('replan.noGain.note', { why: noGainReason(x, options.a) }))}</small>` : '';
      const cls = [k === rec && 'is-rec', noGain && 'is-no-gain'].filter(Boolean).join(' ');
      rows.push(`<tr${cls ? ` class="${cls}"` : ''}><th scope="row">${title}<small>${esc(x.site.name)}</small>${note}</th>${when(x)}${figureCells(x)}
        <td>${button(t('replan.adopt'), { variant: k === rec ? 'primary' : null, 'data-adopt': k, 'aria-label': t('replan.adoptLabel', { what: `${ROW_TITLE[k]}, ${x.site.name}, ${fmtWhen(x.landingMs)}${noGain ? t('replan.noGain.label') : ''}` }) })}</td></tr>`);
    }
  }
  $('rp-outcomes').innerHTML = `<div class="table-scroll"><table class="rp-table">
    <thead><tr><th scope="col">${t('replan.col.option')}</th><th scope="col">${t('replan.col.when')}</th><th scope="col">${t('replan.col.sun')}</th><th scope="col">${t('replan.col.shadow')}</th><th scope="col">${t('replan.col.earth')}</th><th scope="col">${t('replan.col.outage')}</th><td></td></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>`;
}

// ---------------- Events ----------------
function setDelay(days) {
  form.delayDays = Math.max(0, Math.min(MAX_CALENDAR_DAYS, days));
  if (form.deadlineDays < form.delayDays) form.deadlineDays = form.delayDays;
  fillForm(); renderReplan();
}
$('rp-chips').addEventListener('click', e => { const b = e.target.closest('[data-delay]'); if (b) { count('delay'); setDelay(+b.dataset.delay); if (matchMedia(MOBILE_QUERY).matches) scrollToHeadline(); } });
$('rp-delay').addEventListener('input', () => { count('delay'); setDelay(+$('rp-delay').value || 0); });
$('rp-not-before').addEventListener('change', () => {
  const t = Date.parse($('rp-not-before').value + ':00Z');
  if (t > 0) { count('delay'); setDelay((t - originalPlan().landing) / DAY_MS); }
});
// The deadline is a date: the latest landing is that day at the time of the original landing (so the default,
// 60 days after the original, round-trips through the field unchanged).
$('rp-not-after').addEventListener('change', () => {
  const day = Date.parse($('rp-not-after').value + 'T00:00:00Z'), o = originalPlan();
  const t = day + (((o.landing % DAY_MS) + DAY_MS) % DAY_MS);
  if (t > 0) { form.deadlineDays = Math.max(form.delayDays, Math.min(MAX_CALENDAR_DAYS, (t - originalPlan().landing) / DAY_MS)); fillForm(); renderReplan(); }
});
['rp-battery', 'rp-days', 'rp-earth', 'rp-earth-gap', 'rp-transit'].forEach(id => $(id).addEventListener('input', () => { count('spacecraft'); readForm(); renderReplan(); }));
$('rp-radius').addEventListener('input', () => { count('radius'); readForm(); renderReplan(); });
// The day under the pointer (or the keyboard focus) is explained in a fixed line below the timeline: a tooltip
// would be cut by the scrolling box.
const TL_INFO_HINT = t('replan.tlInfoHint');
const showDayInfo = e => { const b = e.target.closest('.rp-tl__day'); $('rp-tl-info').textContent = b ? b.dataset.info : TL_INFO_HINT; };
$('rp-calendar').addEventListener('mouseover', showDayInfo);
$('rp-calendar').addEventListener('focusin', showDayInfo);
$('rp-calendar').addEventListener('mouseleave', () => { $('rp-tl-info').textContent = TL_INFO_HINT; });
// Clicking a day sets «no antes de» to the start of that UTC day (never before the original landing).
$('rp-calendar').addEventListener('click', e => {
  const b = e.target.closest('.rp-tl__day[data-d]'); if (!b) return;
  const o = originalPlan(), start = Math.floor(o.landing / DAY_MS) * DAY_MS + +b.dataset.d * DAY_MS;
  count('calendar'); setDelay(Math.max(0, (start - o.landing) / DAY_MS));
});

// «Ampliar la fecha límite» / «Ampliar el radio» when there is no way out.
function onSuggestion(e) {
  const s = e.target.closest('[data-suggest]'); if (!s) return;
  count('suggestions');
  if (s.dataset.suggest === 'deadline') form.deadlineDays = Math.ceil((+s.dataset.until - originalPlan().landing) / DAY_MS);
  else form.radiusKm = +s.dataset.radius;
  fillForm(); renderReplan();
}
$('rp-outcomes').addEventListener('click', e => {
  const btn = e.target.closest('[data-adopt]'); if (btn) adoptExit(btn.dataset.adopt);
});
$('rp-head-actions').addEventListener('click', e => {
  if (e.target.closest('[data-sim]')) { simOpen = !simOpen; if (last) paint(last.inp); $('rp-head-actions').querySelector('[data-sim]')?.focus(); return; }
  const btn = e.target.closest('[data-adopt]'); if (btn) adoptExit(btn.dataset.adopt); else onSuggestion(e);
});
$('rp-sim-replay').addEventListener('click', () => { if (last) paintSim(last.options); });
$('rp-details').addEventListener('toggle', () => { if (last) paint(last.inp); });

// Adopting an exit (from its card or from the headline) makes it the current plan; the original stays.
function adoptExit(kind) {
  const o = last?.options[kind]; if (!o) return;
  const site = SITES.find(x => x.id === o.site.id);
  if (TEST && trial.started && !trial.done) logTrial(kind, o);
  // The spacecraft changes made here become the mission of the plan, so Plan shows the same requirements.
  $('battery').value = form.mission.batteryHours; $('days').value = form.mission.days; $('min-earth').value = form.mission.minEarthPct; $('max-earth-gap').value = form.mission.maxEarthGapHours ?? '';
  $('transit').value = form.mission.transitDays ?? '';
  // The adopted exit becomes the plan you see in Planificar: go there, from the top.
  adopt({ site, landing: o.landingMs, reasons: [reasonText(o.evaluation.limiting?.reason ?? '')], robustness: null }, undefined, true, { fromReplan: true });
  window.scrollTo(0, 0);
}

// One line per trial in the console, ready to copy into the test sheet.
function logTrial(kind, o) {
  trial.done = true;
  const seconds = Math.round((performance.now() - trial.started) / 1000);
  const result = {
    escenario: `${TEST_SCENARIO.siteId} · ${new Date(TEST_SCENARIO.landing).toISOString().slice(0, 16)} UTC · +${TEST_SCENARIO.delayDays} d`,
    segundos: seconds,
    dentroDelUmbral: seconds <= THRESHOLD_S,
    salida: EXIT[kind].letter,
    sitio: o.site.name,
    aterrizaje: new Date(o.landingMs).toISOString().slice(0, 16) + ' UTC',
    retrasoTotalDias: Math.round(o.totalDelayDays * 10) / 10,
    veredicto: TITLE[o.verdict],
    eraLaRecomendada: last.options.recommended?.kind === kind,
    interacciones: { ...trial.interactions },
  };
  console.info('[Replanificar · modo prueba]', JSON.stringify(result));
  console.table({ ...result, interacciones: JSON.stringify(result.interacciones) });
  tickTest();
}
