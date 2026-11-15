// Entry point: wires the shared modules and the views, routing by URL hash, the mission time cursor,
// the explanation mode and the first-visit tour of each view.
import './common/lang-boot.js';
import { $ } from './common/util.js';
import { t } from './common/i18n.js';
import { startLoading } from './common/loading.js';
import { state, actions, services, evaluateSites, currentHour, missionRange, planSites } from './common/state.js';
import { CUSTOM_SITE_ID } from './common/custom-site.js';
import { initMissionForm } from './common/sidebar.js';
import { resetTerrain } from './common/map.js';
import { decorate, renderCard, hasLiveCard, openCard } from './common/explain.js';
import { startTour, startTourIfNew } from './common/tour.js';
import { initPlanForm, runSearch, renderPlan, drawPlanSky, adoptLinked, openMission, setDataSource } from './views/plan.js';
import { parseMission, MISSION_KEYS } from '../../viewpoint/src/core/mission-link.js';
import { renderAdvanced, drawCards } from './views/advanced.js';
import { renderReplan, initReplan, scrollToHeadline } from './views/replan.js';
import { createReplanService } from './application/replan-service.js';
import { createMissionService } from './application/mission-service.js';
import { autoVisibility } from './adapters/visibility-auto.js';
import { SITES } from './engine/catalog.js';
import { createMissionHistory } from './common/mission-history.js';
import { initHistoryPanel } from './common/history-panel.js';
import { renderSources } from './views/sources.js';
import { initThemeToggle } from './common/theme.js';
import { paintPlayButtons } from './common/player.js';
import { initSky } from './common/sky.js';
import { badgeUpdate } from './common/horizon-label.js';

const VIEWS = ['plan', 'advanced', 'replan', 'sources'];
const RENDER = { plan: renderPlan, advanced: renderAdvanced, replan: renderReplan, sources: renderSources };

// Advanced and Replan study a plan: without one (nothing searched yet) the address leads back to Plan.
const NEEDS_PLAN = ['advanced', 'replan'];
function viewFromHash() {
  const v = location.hash.slice(1);
  state.view = VIEWS.includes(v) ? v : 'plan';
  if (NEEDS_PLAN.includes(state.view) && !state.searchResult) {
    state.view = 'plan';
    history.replaceState(null, '', '#plan');
  }
}

function render() {
  // Advanced and Replan have no tab: they are reached from the result of Plan, so Plan stays marked while you are in them.
  const tab = state.view === 'replan' || state.view === 'advanced' ? 'plan' : state.view;
  document.querySelectorAll('.tabs a').forEach(a => { if (a.dataset.view === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  // Plan and Advanced wait for the visibility windows: they never paint a verdict the other views would not give.
  // Before the first search Plan is only the form, so it does not wait.
  const waiting = (state.view === 'plan' || state.view === 'advanced') && !!state.searchResult && !services.mission.isReady(missionRange());
  if (waiting) {
    VIEWS.forEach(v => { $('view-' + v).hidden = true; });
    const wait = startLoading($('main'));
    services.mission.prepare(missionRange()).then(() => { wait.done(); render(); }, err => wait.fail(t('common.loadError', { message: err.message }), render));
    return;
  }
  paintBadge();
  evaluateSites();
  VIEWS.forEach(v => { $('view-' + v).hidden = v !== state.view; });
  paintPlay();
  // Replan has its own controls, so no view shows the sidebar now; its fields still feed config().
  const noSidebar = true;
  $('sidebar').hidden = noSidebar;
  $('app').classList.toggle('no-sidebar', noSidebar);
  RENDER[state.view]();
  decorate();
  renderCard();
  if (tourPending) tourWhenPainted();
}

// The first-visit tutorial needs the view on screen. Plan and Advanced stay hidden while their data loads,
// so the tutorial waits for the render that shows them.
let tourPending = false;
function tourWhenPainted() {
  tourPending = $('view-' + state.view).hidden;
  if (!tourPending) startTourIfNew(state.view);
}

function onHourChange() {
  $('plan-hour').value = $('hour').value;
  if (state.view === 'advanced') drawCards(); // Advanced's cards repaint when it is shown (renderAdvanced)
  if (state.view === 'plan') drawPlanSky();
  if (hasLiveCard()) renderCard();
}

actions.render = render;
actions.onHourChange = onHourChange;
actions.runSearch = runSearch;

// ---------------- Explanation mode ----------------
function applyExplainMode() {
  document.body.classList.toggle('explain-mode', state.explain);
  $('btn-explain').setAttribute('aria-pressed', state.explain);
  const u = new URL(location.href);
  if (state.explain) u.searchParams.set('debug', '1'); else u.searchParams.delete('debug');
  history.replaceState(null, '', u);
  if (!state.explain) document.querySelectorAll('.highlighted').forEach(x => x.classList.remove('highlighted'));
  renderCard();
  requestAnimationFrame(() => { if (state.view === 'advanced') drawCards(); });
}
$('btn-explain').addEventListener('click', () => { state.explain = !state.explain; applyExplainMode(); });
$('btn-tour').addEventListener('click', () => startTour(state.view));
actions.openExplanation = (key, el) => { state.explain = true; applyExplainMode(); openCard(key, el); };

// ---------------- Mission time ----------------
$('hour').addEventListener('input', onHourChange);
// One playback for Plan and Advanced: both play buttons show it, whichever started or paused it.
function paintPlay() { paintPlayButtons([$('play'), $('plan-play')], state.playing); }
$('play').addEventListener('click', () => {
  if (state.playing) { clearInterval(state.playing); state.playing = null; paintPlay(); return; }
  state.playing = setInterval(() => {
    const h = currentHour() + 2, max = +$('hour').max;
    $('hour').value = h > max ? 0 : h; onHourChange();
  }, 90);
  paintPlay();
});

window.addEventListener('hashchange', () => { viewFromHash(); render(); if (state.view === 'replan') scrollToHeadline(); tourWhenPainted(); });
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => state.view === 'advanced' && drawCards(), 120); });
// Light / dark: the canvases read the tokens when they draw, so a repaint is enough (no reload).
const restartSky = initSky($('sky'));
initThemeToggle($('btn-theme'), () => { resetTerrain(); render(); restartSky(); });

// Composition root (docs/adr/0001): Plan, Advanced and Replan get their data through the same visibility port
// (adapters/visibility-auto.js), so the three views give the same verdict. The header badge says which source it is.
const params = new URLSearchParams(location.search);
const { visibility, api, useApi } = autoVisibility(params);
// Once windows are loaded it also says whether they carry the LOLA terrain (#330): the API may be up without the DEM.
let apiOk = null;
function paintBadge() {
  const badge = $('data-badge'), b = badgeUpdate(badge.dataset.text, apiOk, services.mission?.heightsEffect() ?? null, api.baseUrl);
  if (!b?.changed) return; // a live region (role="status"): only a real change is announced
  badge.dataset.text = b.text;
  badge.textContent = b.text;
  // The consequence of a smooth Moon is read with the badge (and announced when it switches), not only in its title.
  if (b.note) badge.append(Object.assign(document.createElement('span'), { className: 'sr-only', textContent: `. ${b.note}` }));
  badge.dataset.tone = b.tone;
  badge.title = b.title;
}
// The known source also feeds the explanation cards: Replan, or Plan before its first search, has no mission service
// source yet, and a card must not talk about sample data while the API answers (#338).
useApi.then(ok => { apiOk = ok; state.dataSource = ok ? 'api' : 'fake'; paintBadge(); setDataSource(state.dataSource); renderCard(); });
initReplan({ service: createReplanService({ visibility, sites: SITES }) });
services.mission = createMissionService({ visibility, sites: planSites }); // the catalogue and the point typed in Plan
// Mission history (#246): Plan records each plan in it and «Historial», in the top bar, opens one again.
// A blocked localStorage (private window) throws on access: then the history lasts this visit.
services.history = createMissionHistory((() => { try { return window.localStorage; } catch { return null; } })());
initHistoryPanel({ history: services.history, sites: SITES, onOpen: openMission });

// A plan in the URL (?site=…&t0=…, or ?site=custom&lat=…&lon=… for a point of the user's own; the «Volver» of the 3D
// viewer) is the plan Plan opens with. The URL is then cleaned.
const linked = parseMission(params);
const linkedPlan = linked && !linked.error && (linked.siteId === CUSTOM_SITE_ID || SITES.some(s => s.id === linked.siteId)) ? linked : null;
if (linked) {
  const u = new URL(location.href);
  MISSION_KEYS.forEach(k => u.searchParams.delete(k));
  history.replaceState(null, '', u);
}

initMissionForm();
initPlanForm(linkedPlan);
viewFromHash();
applyExplainMode();
// Nothing is searched on load: Plan starts empty and the first search is the user's. Unless a plan comes in the URL
// (the «Volver» of the 3D viewer): then its form is filled and searched, and that landing is the plan.
if (linkedPlan) runSearch().then(() => { adoptLinked(linkedPlan); tourWhenPainted(); });
else { render(); tourWhenPainted(); }

