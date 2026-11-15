// "Avanzado" view. Left: the mission and the south pole. Right: the top 3 landing sites or, in its second mode,
// the comparison of scenarios (advanced-scenarios.js): 2 to 4 pairs of site and landing date, side by side.
//   - Podium: the three sites, each on its best date. Choosing one opens its detail.
//   - Window: every possible landing of the three sites on one date axis. Clicking a date tries it.
//   - Detail: verdict, key figures, the sky from the site and the mission hour by hour. The points of «Si aterrizas
//     desviado» (issue #106) and any spot of the map (issue #131) open in the same detail, each as a point of its own with
//     its own horizon.
// Data: the same search result as Plan (state.searchResult) and the mission service for everything else
// (application/mission-service.js): the same visibility data and rules as Plan and Replan. This view only paints.
import * as M from '../engine/model.js'; // only the polar map projection
import { PROFILES } from '../engine/catalog.js';
import { PRIORITIES, reasons as reasonsFor } from '../engine/search.js';
import { $, esc, verdictColor } from '../common/util.js';
import * as UI from '../common/ui.js';
import { theme, VERDICT_TONE } from '../common/theme.js';
import { ruleChecks, VERDICT_WORD } from '../common/rules.js';
import { state, actions, services, currentHour } from '../common/state.js';
import { adopt } from '../common/adopt.js';
import { decorate } from '../common/explain.js';
import { drawLine } from '../common/charts.js';
import { createSkyView } from '../common/sky-view.js';
import { viewerLink } from '../common/viewer-link.js';
import { drawBaseMap, reliefImage, MAP_RADIUS_KM } from '../common/map.js';
import { baseMapNote } from '../common/relief-note.js';
import { downloadCsv, fileSlug, fileStamp } from '../common/csv.js';
import { missionHoursCsv, siteComparisonCsv } from '../application/csv-export.js';
import { describeHeights } from '../application/mission-service.js';
import { hasEarthGap } from '../common/earth-gap.js';
import { renderScenarios, seedScenarios, addScenario, scenarioCount, scenarioMarkers, activeSite, activeLabel, pickOnMap, registerPoint, reasonText, MAX_SCENARIOS } from './advanced-scenarios.js';
import { missionSun, fmtDeg } from '../common/sun-elevation.js';
import { horizonLabel, ownHorizon } from '../common/horizon-label.js';
import { countTo, replay } from '../../motion/motion.js';
import { t, fmtNum, fmtPct, fmtHours, fmtDate, fmtDateTime, fmtDayMonth, fmtCoords, fmtKm, fmtM } from '../common/i18n.js';
import { BODY_MARKER_RADIUS_PX, markersOverlap } from '../../../shared/render/sky-bodies.js';

// ---------------- Formats ----------------
// Every date, number and duration comes from shared/format through common/i18n.js (#343).
const num = (v, digits = 1) => fmtNum(v, digits);
const fmtDays = d => t('advanced.days', num(d), d);
const hoursText = fmtHours;
const pct = v => fmtPct(v);
const signed = v => `${v >= 0 ? '+' : '−'}${num(Math.abs(v))}°`;
const coords = s => fmtCoords(s);
const VERDICT_TEXT = { viable: t('advanced.verdict.viable'), marginal: t('advanced.verdict.marginal'), not_viable: t('advanced.verdict.not_viable') };
const MAX_SCORE = 2; // 1 for being viable + 1 from the weighted sum (engine/search.js)
const points = o => Math.round((100 * o.score) / MAX_SCORE);

// ---------------- View state ----------------
const view = {
  mode: 'top',        // 'top': the top 3 and the detail of one site | 'scenarios': the comparison of scenarios
  light: true,        // map layer: share of the mission with the Sun (API) or only the relief
  result: null,       // search result on screen: a new one clears the dates picked by hand
  site: null,         // id of the site whose detail is open
  landing: {},        // site id → landing picked by hand (ms). Absent: the best one.
  zoom: false,        // map framed on the chosen site
  radius: 1,          // km around the site at which the "what if you land off the site" check looks
  point: null,        // point open in the detail instead of the site: { from (site id), site, label } and, for a point
                      // of «Si aterrizas desviado», { k, radius }; without k it was picked on the map
  hover: null,        // site id under the pointer (podium or map)
};
let detail = null;          // what the detail shows: { o (o.site is the site or the point off it), t, days, mission, point }
let mapHits = [];           // markers of the last map paint, for hover and click
let mapFrame = null;        // framing of the last map paint: { C, k, centre, radius }, to turn a click into coordinates
const comparing = () => view.mode === 'scenarios';

const shown = () => state.searchResult;
const topOptions = res => res.options.slice(0, 3);
const isReal = res => res?.source === 'api';
const requirements = c => ({ batteryHours: c.batteryHours, minEarthPct: c.minEarthPct, maxEarthGapHours: c.maxEarthGapHours });
const isPlan = (o, t) => state.plan?.site.id === o.site.id && state.plan.landing === t;

// The landing under study for a site: its best one, or the one picked by hand on the window strip.
function examined(o, res) {
  const cond = res.conditions, t = view.landing[o.site.id];
  const k = t == null ? null : o.landings.find(x => x.t === t);
  if (!k || t === o.landing) return { o, t: o.landing, best: true, result: o.result, verdict: o.verdict, reasons: o.reasons, robustDays: o.robustness.maxDelayDays, next: o.robustness.nextWindow };
  const { r: result, verdict } = res.judge(o.site, t);
  const robustDays = verdict.code === 'viable' ? res.marginDays(o.site, t) : 0;
  const after = o.landings.slice(o.landings.indexOf(k) + Math.max(1, k.streak)).find(x => x.code === 'viable');
  return { o, t, best: false, result, verdict, robustDays, next: after?.t ?? null, reasons: reasonsFor({ r: result, verdict, robustDays }, cond, requirements(cond)) };
}

// ---------------- Left column: mission ----------------
// One line: the mission is edited in Plan. Where the data comes from is said once, in the header badge.
// The mission as the chips at the top of Plan (Nave, Requisitos, Dónde, Cuándo): each one opens its step in Plan.
const MISSION_STEPS = [t('advanced.step.ship'), t('advanced.step.reqs'), t('advanced.step.where'), t('advanced.step.when')];
function renderMission() {
  const sim = state.searchResult, c = sim.conditions, p = PROFILES.find(x => x.id === c.profile);
  const ignored = describeHeights(services.mission.heightsEffect(), { short: true });
  const site = sim.fixedSite ? sim.best?.site : null; // the site chosen in Plan, or the best of the zone
  const summary = [
    p?.name || t('advanced.ownShip'),
    t('advanced.missionSummary', { days: num(c.days), battery: num(c.batteryHours), earth: num(c.minEarthPct), gap: hasEarthGap(c.maxEarthGapHours) ? num(c.maxEarthGapHours) : null, panel: num(c.panelHeightM), antenna: num(c.antennaHeightM) })
      + (ignored ? ` (${ignored})` : ''),
    site ? site.short : t('advanced.bestOfZone'),
    `${fmtDate(c.from)} → ${fmtDate(c.to)}`,
  ];
  $('mission-details').innerHTML = MISSION_STEPS.map((label, k) => `<li class="plan-step is-done"><button type="button" data-goto="${k + 1}" title="${esc(summary[k])}">
      <span class="plan-step__n" aria-hidden="true">✓</span>
      <span class="plan-step__label">${label}</span><span class="plan-step__edit" aria-hidden="true">${t('advanced.change')}</span>
      <small>${esc(summary[k])}</small></button></li>`).join('');
  $('priority-options').innerHTML = PRIORITIES.map(x => `<option value="${x.id}"${x.id === c.priority ? ' selected' : ''}>${esc(t(`advanced.priority.${x.id}`))}</option>`).join('');
}
$('mission-details').addEventListener('click', e => {
  const b = e.target.closest('[data-goto]'); if (!b) return;
  // To Plan, with that step open (its own chip does it there).
  addEventListener('hashchange', () => requestAnimationFrame(() => document.querySelector(`#plan-steps [data-goto="${b.dataset.goto}"]`)?.click()), { once: true });
  location.hash = '#plan';
});

// Chart heights come from the layout: on a desktop screen the view fits without scrolling (styles/advanced.css).
const chartHeight = (name, fallback) => parseFloat(getComputedStyle($('view-advanced')).getPropertyValue(name)) || fallback;

// ---------------- Right column ----------------
function renderPodium(res, top) {
  $('podium').innerHTML = top.map((o, i) => {
    const r = o.result, selected = o.site.id === view.site;
    return `<button type="button" class="podium-card" role="tab" aria-selected="${selected}" aria-controls="detail" data-site="${o.site.id}">
      <span class="podium-top"><span class="rank" aria-label="${t('advanced.rank', { n: i + 1 })}">${i + 1}</span>${UI.verdict(o.verdict)}</span>
      <b class="podium-name">${esc(o.site.name)}</b>
      <span class="podium-date num">${fmtDateTime(o.landing)}</span>
      <span class="podium-score"><b class="num" data-count="${points(o)}">${points(o)}</b><small>/ 100</small><span class="meter"><i style="width:${points(o)}%" data-fill="${points(o)}"></i></span></span>
      <span class="podium-facts">
        <span>${t('advanced.shadow')} <b class="num">${hoursText(r.maxDarkHours)}</b></span>
        <span>${t('advanced.earth')} <b class="num">${pct(r.pctEarth)}</b></span>
        <span>${t('advanced.slope')} <b class="num" data-slope="${o.site.id}">…</b></span>
      </span>
      ${isPlan(o, o.landing) ? `<span class="is-plan">${t('advanced.yourPlan')}</span>` : ''}
    </button>`;
  }).join('');
}

function renderWindow(res, top) {
  const c = res.conditions, n = top[0].landings.length, step = res.stepHours;
  $('window-title').title = t('advanced.windowTitle', { step });
  const ticks = [];
  const everyDays = n * step / 24 > 70 ? 14 : 7;
  for (let d = 0; d * 24 / step < n; d += everyDays) ticks.push(`<span style="left:${(100 * d * 24) / step / n}%">${fmtDayMonth(c.from + d * 864e5)}</span>`);
  $('strips').innerHTML = top.map((o, i) => {
    const e = examined(o, res), at = o.landings.findIndex(x => x.t === e.t);
    const cells = o.landings.map((k, j) => `<i class="${k.code}${k.t === o.landing ? ' best' : ''}${k.t === e.t ? ' current' : ''}" data-i="${j}"></i>`).join('');
    return `<div class="strip-row" data-site="${o.site.id}"${o.site.id === view.site ? ' aria-current="true"' : ''}>
      <button type="button" class="strip-label" data-select="${o.site.id}" title="${esc(o.site.name)}"><span class="rank rank--sm">${i + 1}</span><span>${esc(o.site.short)}</span></button>
      <div class="strip" role="slider" tabindex="0" data-site="${o.site.id}" aria-label="${esc(t('advanced.stripLabel', { name: o.site.name }))}"
        aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${at}" aria-valuetext="${fmtDateTime(e.t)}, ${VERDICT_TEXT[e.verdict.code]}">${cells}</div>
      <span class="strip-count num" title="${t('advanced.viableCount')}">${o.viableInWindow}<small> / ${n}</small></span>
    </div>`;
  }).join('') + `<div class="strip-row strip-axis" aria-hidden="true"><span></span><div class="strip-ticks">${ticks.join('')}</div><span></span></div>`;
}

function renderDetail(res, top) {
  const c = res.conditions, o = top.find(x => x.site.id === view.site), e = examined(o, res), i = top.indexOf(o), p = view.point;
  const mission = { days: c.days, ...requirements(c) };
  const d = detail = { o: p ? { site: p.site } : o, t: e.t, days: c.days, mission: null, point: null };
  if (!p) {
    // Range of each figure if the horizon is 0.3° higher or lower (only with the data API): «61 % [55–66 %]».
    paintDetail(res, o, e, i, null, { verdict: e.verdict, r: e.result, reasons: e.reasons, robustDays: e.robustDays, band: isReal(res) ? services.mission.band(o.site, e.t, mission) : null,
      deepPolar: isReal(res) && services.mission.deepPolar(o.site), earthDsn: isReal(res) ? services.mission.earthDsn(o.site, e.t, mission) : null });
  } else {
    // A point off the site: its own windows (its own horizon) and the same rules, from the service. It arrives later.
    paintDetail(res, o, e, i, p, null);
    services.mission.point(p.site, e.t, mission).then(
      x => {
        if (detail !== d) return;
        d.point = x;
        paintDetail(res, o, e, i, p, { ...x, reasons: reasonsFor({ r: x.r, verdict: x.verdict, robustDays: x.robustDays }, c, requirements(c)) });
        advSky.hint2d = t('common.horizon.named', ownHorizon(res?.source, x.horizonModel, siteModel(o)).trim()) + t('common.height.noScale');
        paintMission(); decorate(); drawCards();
      },
      err => { if (detail === d) { paintDetail(res, o, e, i, p, null, err); paintMission(); } },
    );
  }
  $('line-title').textContent = t('advanced.lineTitle', { days: num(c.days) });
  advSky.hint2d = (p ? t('common.horizon.named', ownHorizon(res?.source, services.mission.horizonModel(p.site.id), siteModel(o)).trim())
    : t('common.horizon.named', horizonLabel(res?.source, services.mission.horizonModel(o.site.id)))) + t('common.height.noScale');
  loadMission();
  loadAround(c, o, e);
}

// The horizon model of a catalogue site, for ownHorizon() (#330): a point off it is labelled with its own model.
const siteModel = o => services.mission.horizonModel(o.site.id);

// The detail of the site (`p` null) or of a point off it, with the same blocks. `data` is { verdict, r, reasons,
// robustDays, band, earthDsn } and, for a point, also horizonModel; null while the point is being judged (or if it failed: `err`).
function paintDetail(res, o, e, i, p, data, err) {
  const c = res.conditions, site = p ? p.site : o.site, r = data?.r, v = data?.verdict;
  // The third reason of a viable landing is its delay margin: bad when under half a day (planner/src/ranking.js).
  const good = k => v.code === 'viable' && !(k === 2 && !(data.robustDays >= 0.5));
  const back = p ? `<button type="button" class="btn" data-back>${esc(t('advanced.backTo', { name: o.site.short }))}</button>` : '';
  const horizon = !p ? t('advanced.approxCoords')
    : t('advanced.ownPointHorizon', { kind: ownHorizon(res?.source, data?.horizonModel ?? services.mission.horizonModel(p.site.id), siteModel(o)).trim() });
  // As the result of Plan: what it is on top, the site with its verdict, «Aterriza …» and, on the verdict, its rules.
  const eyebrow = p ? (p.k == null ? esc(t('advanced.eyebrowMap', { name: o.site.short })) : esc(t('advanced.eyebrowOff', { d: distance(p.radius), name: o.site.short })))
    : t(e.best ? 'advanced.eyebrowBest' : 'advanced.eyebrowTrying', { n: i + 1 });
  const checks = v ? ruleChecks(v) : '';
  const pop = !data ? ''
    : `<p class="day-info-head"><b>${esc(site.short ?? site.name)} · ${esc(fmtDateTime(e.t))}</b> · ${VERDICT_WORD[v.code]}</p>
      ${checks ? `<p class="day-checks-title">${t('advanced.rulesAtLanding')}</p><ul class="day-checks">${checks}</ul>`
        : `<ul class="reason-list">${data.reasons.map((m, k) => `<li class="${good(k) ? '' : 'bad'}">${esc(reasonText(m))}</li>`).join('')}</ul>`}`;
  $('detail').setAttribute('aria-label', p ? t('advanced.detailPoint', { name: site.name }) : t('advanced.detailSite'));
  $('detail-head').innerHTML = `
    <div class="detail-origin"><span class="eyebrow">${eyebrow}</span>${back}</div>
    <div class="res-title">
      ${p ? `<span class="rank rank--point" aria-hidden="true">${p.label}</span>` : ''}<h3 class="featured detail-name" title="${esc(`${coords(site)} · ${horizon}`)}">${esc(site.name)}</h3>
      ${v ? `<span class="badge badge--pill badge--large res-verdict" data-tone="${VERDICT_TONE[v.code]}" tabindex="0" aria-describedby="adv-verdict-pop" data-explain="verdict">${esc(v.title)}</span>`
        : `<span class="hint">${t(err ? 'advanced.noVerdict' : 'advanced.computing')}</span>`}
      <div class="day-pop verdict-pop" id="adv-verdict-pop" role="tooltip" hidden>${pop}</div>
    </div>
    <p class="res-line" data-explain="best"><span class="num">${t('advanced.lands')} <b>${fmtDateTime(e.t)}</b></span> <span class="hint coords">· ${coords(site)}<span id="detail-height"></span> · ${horizon}</span>
      ${e.best || p ? '' : `<button type="button" class="btn btn--small" data-reset="${o.site.id}">${t('advanced.backToBest', { date: fmtDayMonth(o.landing) })}</button>`}</p>
    ${err ? `<p class="text-bad" role="alert">${esc(t('advanced.pointError', { msg: err.message }))}</p>`
      : !data ? `<p class="hint">${isReal(res) ? t('advanced.pointComputingWith', { horizon: t('common.horizon.named', ownHorizon(res?.source, services.mission.horizonModel(p.site.id), siteModel(o)).trim()) }) : t('advanced.pointComputingSim')}</p>` : ''}`;
  // The figures as the readout of Plan: a swatch of its colour, the name, the value and what it is held to.
  const band = data?.band, wait = err ? '—' : '…';
  const row = ({ label, value, note, explain, color = '--color-text-muted', hollow = false, ok = null, bandText = '', count = null }) => `
    <div class="readout__row${ok === false ? ' is-failing' : ''}" data-explain="${explain}" tabindex="0" title="${esc([note, bandText && t('advanced.bandNote', { range: bandText })].filter(Boolean).join(' · '))}">
      <i class="readout__swatch${hollow ? ' is-hollow' : ''}" style="--c: var(${color})" aria-hidden="true"></i>
      <span class="readout__label">${esc(label)}</span>
      <b class="readout__value${ok === false ? ' text-bad' : ''}" data-base="readout__value"${count == null ? '' : ` data-count="${count}" data-format="pct"`}>${esc(value)}</b>
      <small class="readout__req">${esc(note)}</small>${UI.band(bandText)}
    </div>`;
  $('detail-figures').innerHTML = `<div class="readout adv-readout">${[
    { label: t('advanced.fig.sun'), value: r ? pct(r.pctSun) : wait, note: t('advanced.fig.sunNote', { days: num(c.days) }), explain: 'pct-sun', color: '--color-sun', count: r ? r.pctSun : null, ok: r ? r.maxDarkHours <= c.batteryHours : null, bandText: UI.bandText(band?.pctSun, pct) },
    { label: t('advanced.fig.shadow'), value: r ? hoursText(r.maxDarkHours) : wait, note: t('advanced.fig.shadowNote', { h: num(c.batteryHours) }), explain: 'no-sun', color: '--color-sun', hollow: true, ok: r ? r.maxDarkHours <= c.batteryHours : null, bandText: UI.bandText(band?.maxDarkHours, h => hoursText(Math.round(h))) },
    { label: t('advanced.fig.earth'), value: r ? pct(r.pctEarth) : wait, note: t('advanced.fig.earthNote', { pct: pct(c.minEarthPct) }), explain: 'pct-earth', color: '--color-earth', count: r ? r.pctEarth : null, ok: r ? r.pctEarth >= c.minEarthPct : null, bandText: UI.bandText(band?.pctEarth, pct) },
    // Earth with a DSN antenna available (#103, only with the API): it informs, it is not a requirement (no `ok`).
    { label: t('advanced.fig.earthDsn'), value: !data ? wait : data.earthDsn == null ? '—' : pct(data.earthDsn), note: t(data && data.earthDsn == null ? 'advanced.fig.earthDsnNeedsApi' : 'advanced.fig.earthDsnNote'), explain: 'earth-dsn', color: '--color-earth', hollow: true, count: data?.earthDsn ?? null },
    { label: t('advanced.fig.margin'), value: !data ? wait : data.robustDays ? fmtDays(data.robustDays) : t('advanced.fig.noMargin'), note: t('advanced.fig.marginNote'), explain: 'robustness' },
    { label: t('advanced.slope'), value: '…', note: t('advanced.fig.slopeNote'), explain: 'slope', color: '--color-terrain' },
    { label: t('advanced.fig.sunMission'), value: '…', note: t('advanced.fig.sunMissionNote'), explain: 'sun-mission', color: '--color-sun' },
  ].map(row).join('')}</div>` + UI.deepPolarNote(t('common.deepPolar.text'), t('common.deepPolar.link'), { id: 'adv-deep-polar', on: !!data?.deepPolar });
  $('detail-figures').querySelector('[data-explain="slope"] > b').dataset.slope = site.id;
  loadSlopes(p ? [{ site }] : topOptions(res));
  $('detail-foot').innerHTML = p
    ? `<div class="detail-actions res-actions">${back}
      <button type="button" class="btn btn--primary" data-compare-point title="${esc(t('advanced.addPointTitle', { max: MAX_SCENARIOS }))}">${esc(t('advanced.addPoint'))}</button></div>`
    : `<div class="detail-actions res-actions">${isPlan(o, e.t)
      ? `<span class="is-plan">${t('advanced.isPlan')}</span><a class="btn" href="#replan">${t('advanced.replan')}</a>`
      : `<button type="button" class="btn btn--primary" data-adopt="${o.site.id}">${t('advanced.usePlan')}</button>`}
      <button type="button" class="btn" data-compare="${o.site.id}" title="${esc(t('advanced.compareTitle', { max: MAX_SCENARIOS }))}">${t('advanced.compareDate')}</button></div>`;
}

// The verdict's rules, with the pointer on it or focused (as the verdict of Plan).
const verdictPop = (e, show) => { if (e.target.closest?.('.res-verdict')) { const pop = $('adv-verdict-pop'); if (pop && pop.childElementCount) pop.hidden = !show; } };
for (const [type, show] of [['pointerover', true], ['pointerout', false], ['focusin', true], ['focusout', false]]) $('detail-head').addEventListener(type, e => verdictPop(e, show));

// ---------------- What if the lander comes down off the site ----------------
const RADII = [0.5, 1, 2];
const COMPASS = t('advanced.compass').split(',');
const COMPASS_NAME = t('advanced.compassName').split(',');
const VERDICT_MARK = { viable: '✓', marginal: '!', not_viable: '' }; // the viable ones stand out by shape too, not only by colour

// A point of the ring as a site of its own (the same object every time: the scenarios and the service know it by id).
const offSites = new Map();
function offSite(o, q, radius, k) {
  const id = `${o.site.id}~${radius}km~${k}`;
  if (!offSites.has(id)) {
    offSites.set(id, { id, name: t('advanced.offName', { d: distance(radius), dir: COMPASS[k], name: o.site.name }), short: `${o.site.short} +${distance(radius)} ${COMPASS[k]}`, lat: q.lat, lon: q.lon, custom: true,
      note: t('advanced.offNote', { d: distance(radius), dir: COMPASS_NAME[k], name: o.site.name }) });
  }
  return offSites.get(id);
}
let ring = null;      // the ring on screen: { o, radius, points }, to open one of its points
let refocus = null;   // index of the ring point that takes the keyboard focus when the ring is painted again
const distance = km => (km < 1 ? fmtM(km * 1000) : fmtKm(km));

// A spot picked on the map as a site of its own. Rounded to ~10 m so the same spot is the same site (and the same cache).
const MAP_POINT_LABEL = '+';
const mapSites = new Map();
function mapSite({ lat, lon }) {
  lat = Math.round(lat * 1e4) / 1e4; lon = Math.round(lon * 1e4) / 1e4;
  const id = `map~${lat}~${lon}`;
  if (!mapSites.has(id)) {
    mapSites.set(id, { id, name: t('advanced.mapName', { coords: coords({ lat, lon }) }), short: t('advanced.mapShort', { coords: coords({ lat, lon }) }), lat, lon, custom: true,
      note: t('advanced.mapNote') });
  }
  return mapSites.get(id);
}

// The same landing judged on a ring of points around the site. It arrives later (one request per point with the API).
function loadAround(c, o, e) {
  const d = detail, radius = view.radius, mission = { days: c.days, ...requirements(c) };
  paintAround(o, e, radius, null);
  services.mission.around(o.site, e.t, mission, radius).then(
    res => { if (detail === d && view.radius === radius) paintAround(o, e, radius, res); },
    err => { if (detail === d && view.radius === radius) paintAround(o, e, radius, null, err); },
  );
}

function paintAround(o, e, radius, res, err) {
  const radii = `<div class="around-radii" role="group" aria-label="${t('advanced.radiiLabel')}">${RADII.map(r =>
    `<button type="button" data-radius="${r}" aria-pressed="${r === radius}">${distance(r)}</button>`).join('')}</div>`;
  // Each point is a button that opens it as a point of its own; the one that is open is marked.
  const open = view.point?.from === o.site.id && view.point.radius === radius ? view.point.k : null;
  const pin = (p, k) => {
    const a = p.bearingDeg * Math.PI / 180, where = COMPASS[k] ?? `${p.bearingDeg}°`;
    return `<button type="button" class="around-pin ${p.code}" data-point="${k}" aria-pressed="${k === open}" style="left:${50 + 38 * Math.sin(a)}%;top:${50 - 38 * Math.cos(a)}%"
      title="${esc(`${where} · ${VERDICT_TEXT[p.code]}: ${reasonText(p.reason)}`)}"
      aria-label="${esc(t('advanced.pinLabel', { dir: COMPASS_NAME[k] ?? where, d: distance(radius), verdict: VERDICT_TEXT[p.code], reason: reasonText(p.reason) }))}">${VERDICT_MARK[p.code]}</button>`;
  };
  const rose = res ? res.points.map(pin).join('') : '';
  ring = res ? { o, radius, points: res.points } : null;
  const centre = view.point
    ? `<button type="button" class="around-pin around-site ${e.verdict.code}" data-back style="left:50%;top:50%" title="${esc(t('advanced.backTo', { name: o.site.name }))}" aria-label="${esc(t('advanced.siteBack', { name: o.site.name, verdict: VERDICT_TEXT[e.verdict.code] }))}"></button>`
    : `<i class="around-site ${e.verdict.code}" style="left:50%;top:50%" title="${esc(o.site.name)}"></i>`;
  let title, text;
  if (err) { title = t('advanced.aroundError'); text = err.message; }
  else if (!res) { title = t('advanced.aroundTesting', { d: distance(radius) }); text = isReal(shown()) ? t('advanced.aroundWith', { horizon: t('common.horizon.named', ownHorizon(shown()?.source, null, siteModel(o)).trim()) }) : t('advanced.aroundSim'); }
  else {
    const n = res.points.length, bad = res.points.map((p, k) => (p.code === 'viable' ? null : COMPASS[k])).filter(Boolean);
    const here = e.verdict.code === 'viable';
    title = t('advanced.aroundTitle', res.viable, n, distance(radius));
    text = here
      ? res.viable === n ? t('advanced.aroundAll')
        : res.viable === 0 ? t('advanced.aroundOnlyHere')
        : t('advanced.aroundSome', { dirs: bad.join(', ') })
      : res.viable ? t('advanced.aroundNearby', res.viable)
        : t('advanced.aroundNone');
  }
  $('detail-around').innerHTML = `
    <div class="around-rose${res ? '' : ' is-loading'}" role="group" aria-label="${esc(res ? t('advanced.roseLabel', { title }) : title)}">
      <span class="around-n" aria-hidden="true">N</span>${rose}${centre}
    </div>
    <div class="around-text">
      <span class="eyebrow">${t('advanced.aroundEyebrow')}</span>
      <b title="${esc(text)}">${esc(title)}</b>
      ${err ? `<small>${esc(text)}</small>` : ''}
      ${radii}
    </div>`;
  if (res && refocus !== null) { $('detail-around').querySelector(`[data-point="${refocus}"]`)?.focus({ preventScroll: true }); refocus = null; }
}

// Hour-by-hour sky of the landing in the detail (only to draw). It may arrive later: the charts wait for it.
function loadMission() {
  const d = detail;
  d.mission = services.mission.sky(d.o.site, d.t, d.days, sky => {
    if (detail !== d) return;
    if (!sky) { $('adv-now').textContent = t('advanced.skyError'); return; }
    d.mission = sky; paintMission(); drawCards();
  });
  paintMission();
}

// What depends on the mission but not on the instant: the Sun and Earth bars and the terrain height.
function paintMission() {
  const m = detail.mission;
  $('csv-hours').disabled = !m;
  $('detail-charts').classList.toggle('is-loading', !m);
  if (!m) { $('spans').innerHTML = ''; return; }
  const n = m.series.length - 1;
  const bars = body => {
    let html = '', from = null;
    for (let i = 0; i <= n + 1; i++) {
      const on = i <= n && m.series[i][body].margin > 0;
      if (on && from === null) from = i;
      if (!on && from !== null) { const a = Math.max(0, from - 0.5), b = Math.min(n, i - 0.5); html += `<i style="left:${(100 * a) / n}%;width:${(100 * (b - a)) / n}%"></i>`; from = null; }
    }
    return html;
  };
  $('spans').innerHTML = `<div class="span-row" data-tone="sun"><span>${t('advanced.sun')}</span><div>${bars('sun')}</div></div>
    <div class="span-row" data-tone="earth"><span>${t('advanced.earth')}</span><div>${bars('earth')}</div></div>`;
  paintMissionSun(m.series);
  const h = m.horizon.heightM;
  $('detail-height').textContent = h == null ? '' : t('advanced.terrainAt', { h: fmtNum(Math.round(h)) });
}

// Solar elevation during the mission (#69, 4.4): mean and minimum over the hours with Sun, and how many of them have it
// so low over the terrain that the panel may be in shadow (sun-elevation.js). No colour: every sunrise and sunset goes
// through those hours, so a few of them are normal.
function paintMissionSun(series) {
  const box = $('detail-figures').querySelector('[data-explain="sun-mission"]');
  if (!box) return;
  const s = missionSun(series), b = box.querySelector('b'), note = box.querySelector('small');
  if (!s) { b.textContent = '—'; b.className = `${b.dataset.base ?? ''} text-bad`; note.textContent = t('advanced.noSunMission'); return; }
  b.textContent = fmtDeg(s.meanEl); b.className = b.dataset.base ?? '';
  note.textContent = t('advanced.sunMissionNote', { min: fmtDeg(s.minEl) })
    + (s.lowHours ? t('advanced.sunLow', { h: fmtHours(s.lowHours) }) : '');
}

// The sites outside the top 3, folded: one line each with why it is out.
function renderOthers(res) {
  const others = res.options.slice(3), box = $('other-sites');
  box.hidden = !others.length;
  if (!others.length) return;
  box.innerHTML = `<summary title="${t('advanced.othersTitle')}">${t('advanced.others')} <span class="hint">${others.length}</span></summary>
    <ul class="others-list">${others.map((o, i) => `<li>
      <span class="rank rank--sm">${i + 4}</span>
      <div><b>${esc(o.site.name)}</b>${UI.verdict(o.verdict)}<small>${fmtDateTime(o.landing)} · ${esc(reasonText(o.verdict.reason))}</small></div>
      <button type="button" class="btn btn--small" data-adopt="${o.site.id}">${t('advanced.usePlan')}</button></li>`).join('')}</ul>`;
}

// ---------------- Slope (only with the API) ----------------
const slopeText = sl => `${num(sl.slopeDeg)}°`;
function paintSlope(id, sl, err) {
  document.querySelectorAll(`[data-slope="${id}"]`).forEach(el => {
    el.textContent = err ? '—' : slopeText(sl);
    el.title = err ? err.message : sl.certified ? t('advanced.slopeMeasured', { b: sl.baselineM, src: sl.source }) : t('advanced.slopeUncertified', { b: sl.baselineM });
    el.className = `${el.dataset.base ?? 'num'}${err || !sl ? '' : sl.meets === true ? ' text-ok' : sl.meets === false ? ' text-bad' : ' text-warn'}`;
    const note = el.parentElement.querySelector('small');
    if (note && !err) note.textContent = sl.meets === true ? t('advanced.slopeOk') : sl.meets === false ? t('advanced.slopeBad') : t('advanced.slopeUnsure', { b: sl.baselineM });
    if (note && err) note.textContent = t('advanced.slopeNeedsApi');
  });
}
function loadSlopes(top) {
  for (const o of top) services.mission.slope(o.site).then(sl => paintSlope(o.site.id, sl), err => paintSlope(o.site.id, null, err));
}

// ---------------- South-pole map ----------------
// Real relief (LOLA), shared with Replan (common/map.js); until it loads, or if it fails, the invented one, and the note says so.
reliefImage(() => { if (state.view === 'advanced') drawMap(); });
const ZOOM_RADIUS_KM = 45;
// Light map of each framing: the whole pole every 10 km, or the chosen site every 2.5 km (~1000 points each).
const LIGHT = { pole: { radiusKm: MAP_RADIUS_KM, spacingKm: 10 }, zoom: { radiusKm: ZOOM_RADIUS_KM, spacingKm: 2.5 } };
const lightMaps = { key: '', data: null, error: null };

// The light map as an image: pixel (i, j) is the grid point (x, y) = ((i − half)·spacing, (half − j)·spacing), darker the
// longer it is without the Sun. Kept per map, so moving the mission time does not rebuild it.
const shadowImages = new WeakMap();
function shadowImage(map, colour) {
  if (shadowImages.has(map)) return shadowImages.get(map);
  const half = Math.floor(map.radiusKm / map.spacingKm + 1e-9), n = 2 * half + 1;
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const ctx = cv.getContext('2d'); ctx.fillStyle = colour;
  for (const p of map.points) {
    ctx.globalAlpha = 0.88 * (1 - p.sun);
    ctx.fillRect(Math.round(p.x / map.spacingKm) + half, half - Math.round(p.y / map.spacingKm), 1, 1);
  }
  const out = { image: cv, half };
  shadowImages.set(map, out);
  return out;
}

// The light map of what the map shows, for the mission of the detail. null while it loads (it repaints the map when ready).
function lightMapFor(chosen, zoomed) {
  if (!detail) return null;
  const spec = zoomed ? LIGHT.zoom : LIGHT.pole, centre = zoomed ? chosen.site : null;
  const key = `${zoomed ? `${centre.lat}|${centre.lon}` : 'pole'}|${detail.t}|${detail.days}`;
  if (lightMaps.key !== key) {
    Object.assign(lightMaps, { key, data: null, error: null });
    services.mission.lightMap(centre, spec.radiusKm, spec.spacingKm, detail.t, detail.days).then(
      data => { if (lightMaps.key === key) { lightMaps.data = data; if (state.view === 'advanced') drawMap(); } },
      error => { if (lightMaps.key === key) { lightMaps.error = error; if (state.view === 'advanced') drawMap(); } },
    );
  }
  return lightMaps;
}

function drawMap() {
  const res = shown(), cv = $('top-map'), size = cv.clientWidth || 300, dpr = devicePixelRatio || 1, C = size / 2, th = theme();
  cv.width = cv.height = size * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
  // Comparing scenarios, the map shows them (A to D) instead of the top 3, framed on the active one when zoomed.
  const compare = comparing() && res ? scenarioMarkers() : null;
  const top = res && !compare ? topOptions(res) : [], chosen = top.find(o => o.site.id === view.site && !o.site.offMap);
  const focus = compare ? activeSite() : chosen?.site;
  const zoomed = view.zoom && !!focus && !focus.offMap;
  const centre = zoomed ? M.toMap(focus.lat, focus.lon) : { x: 0, y: 0 }, radius = zoomed ? ZOOM_RADIUS_KM : MAP_RADIUS_KM, k = C / radius;
  mapFrame = { C, k, centre, radius };
  const px = p => ({ x: C + (p.x - centre.x) * k, y: C - (p.y - centre.y) * k });
  const sitePx = s => px(M.toMap(s.lat, s.lon));

  // Base (relief, hatching, rings and names) shared with Replan (common/map.js, #344); then only this map's marks.
  const light = view.light && res && !compare ? lightMapFor(chosen, zoomed) : null; // the light map is of one mission: each scenario has its own dates
  // Shadows: each point of the light map darkens the relief by the share of the mission it spends without the Sun.
  const beneath = !light?.data ? null : () => {
    // One pixel per point of the grid, scaled and smoothed onto the map: x/y of the grid are east/north of its centre.
    const { image, half } = shadowImage(light.data, th.mapBg), s = light.data.spacingKm * k;
    const origin = zoomed ? sitePx(chosen.site) : px({ x: 0, y: 0 }), lon = zoomed ? chosen.site.lon * Math.PI / 180 : 0;
    const east = { x: Math.cos(lon), y: -Math.sin(lon) }, north = { x: Math.sin(lon), y: Math.cos(lon) };
    const a = s * east.x, b = -s * east.y, c = -s * north.x, d = s * north.y;
    ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * (origin.x - half * (a + c)), dpr * (origin.y - half * (b + d)));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, -0.5, -0.5);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const { relief, uncovered } = drawBaseMap(ctx, { size, centre, radius, th, names: true, beneath });

  mapHits = [];
  // Rest of the candidates, in grey.
  const grey = compare ? compare.others.map(site => ({ site })) : res ? res.options.slice(3).map(o => ({ site: o.site, o })) : [];
  for (const g of grey) {
    if (g.site.offMap) continue;
    const p = sitePx(g.site); ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = th.mapTextSoft; ctx.fill(); ctx.strokeStyle = th.mapBg; ctx.lineWidth = 1.5; ctx.stroke();
    mapHits.push({ ...p, o: g.o, site: g.site, rank: null });
  }
  // Where the Sun and the Earth are, seen from the chosen site at the instant of the time bar.
  const at = detail?.mission ? Math.min(currentHour(), detail.mission.series.length - 1) : 0;
  const now = chosen && detail?.mission ? detail.mission.series[at] : null;
  const seen = now ? services.mission.visibleAt(detail.o.site, detail.t + at * 36e5) : null;
  if (now) {
    const s = detail.o.site, origin = sitePx(s), rad = Math.PI / 180, len = size * 0.24;
    const north = { x: Math.sin(s.lon * rad), y: Math.cos(s.lon * rad) }, east = { x: Math.cos(s.lon * rad), y: -Math.sin(s.lon * rad) };
    const endOf = body => {
      const a = now[body].az * rad, dx = Math.cos(a) * north.x + Math.sin(a) * east.x, dy = Math.cos(a) * north.y + Math.sin(a) * east.y;
      return { x: origin.x + dx * len, y: origin.y - dy * len };
    };
    // The Earth is drawn last, on top; where the two markers overlap it is a ring so the Sun still shows (#342).
    const together = markersOverlap(endOf('sun'), endOf('earth'));
    for (const [body, colour] of [['sun', th.mapSun], ['earth', th.mapEarth]]) {
      const end = endOf(body), visible = seen ? seen[body] : now[body].margin > 0;
      ctx.save(); ctx.globalAlpha = visible ? 1 : 0.5; ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 2;
      if (!visible) ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(end.x, end.y, BODY_MARKER_RADIUS_PX, 0, 2 * Math.PI); // same size, not to scale (#342)
      if (body === 'earth' && together) ctx.stroke();
      else if (visible) ctx.fill(); else { ctx.fillStyle = th.mapBg; ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
  }
  // Top 3, numbered. Sites that are very close (the ridge and its slope are 4 km apart) are pushed apart; a line marks the real spot.
  // Each marker: { site, label, code (verdict), active, hovered } plus what a click on it means (o and rank, or scenario).
  const markers = [];
  const marked = compare
    ? compare.markers.map(s => ({ site: s.site, label: s.label, code: s.code, active: s.active, hovered: false, scenario: s }))
    : top.map((o, i) => ({ site: o.site, label: i + 1, code: o.verdict.code, active: o.site.id === view.site && !view.point, hovered: o.site.id === view.hover, o, rank: i + 1 }));
  // The point off the site open in the detail: its own marker, pushed away from its site towards where it really is.
  if (!compare && view.point && chosen) {
    const a = M.toMap(chosen.site.lat, chosen.site.lon), b = M.toMap(view.point.site.lat, view.point.site.lon);
    marked.push({ site: view.point.site, label: view.point.label, code: detail?.point?.verdict.code ?? null, active: true, hovered: false, point: detail?.point ?? {}, angle: Math.atan2(a.y - b.y, b.x - a.x) });
  }
  marked.forEach(x => {
    if (x.site.offMap) return;
    const real = sitePx(x.site), m = { ...x, ...real, real };
    for (const other of markers) {
      const d = Math.hypot(m.x - other.x, m.y - other.y);
      if (d < 24) { const a = m.angle ?? (d > 0.5 ? Math.atan2(m.y - other.y, m.x - other.x) : Math.PI / 4); m.x = other.x + 24 * Math.cos(a); m.y = other.y + 24 * Math.sin(a); }
    }
    markers.push(m);
  });
  ctx.font = '700 11px ' + th.fontData; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const m of [...markers].reverse()) {
    const { active, hovered } = m;
    ctx.strokeStyle = th.mapMark; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(m.real.x, m.real.y); ctx.lineTo(m.x, m.y); ctx.stroke();
    if (active || hovered) { ctx.beginPath(); ctx.arc(m.x, m.y, 15, 0, 2 * Math.PI); ctx.strokeStyle = active ? th.mapMark : th.mapTextSoft; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(m.x, m.y, 10.5, 0, 2 * Math.PI); ctx.fillStyle = m.code ? verdictColor(m.code) : th.mapTextSoft; ctx.fill(); ctx.strokeStyle = th.mapBg; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = th.mapBg; ctx.fillText(m.label, m.x, m.y + 0.5);
    mapHits.push({ x: m.x, y: m.y, o: m.o, site: m.site, rank: m.rank ?? null, scenario: m.scenario ?? null, point: m.point ?? null });
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  $('light-legend').hidden = !light?.data;
  const lightNote = !light ? '' : light.error ? `${light.error.message} ` : !light.data ? `${t('advanced.lightComputing')} `
    : '';
  const compareNote = compare ? `${t('advanced.mapCompareNote', { l: activeLabel() })} ` : '';
  const pointNote = !compare && view.point && chosen
    ? view.point.k == null ? `${t('advanced.mapPointNote', { l: MAP_POINT_LABEL })} ` : `${t('advanced.offPointNote', { dir: COMPASS[view.point.k], d: distance(view.point.radius), name: chosen.site.short })} `
    : '';
  const scaleNote = now ? `${t('common.sky.notToScale')}. ` : ''; // the Sun and Earth markers, same size (#342)
  const reliefText = baseMapNote(relief.state, res?.source ?? services.mission.source, { uncovered });
  $('map-note').textContent = `${compareNote}${pointNote}${lightNote}${scaleNote}${reliefText.charAt(0).toUpperCase()}${reliefText.slice(1)}.`.trim();
  $('map-note').hidden = !$('map-note').textContent;
  $('top-map').title = t('advanced.mapTitle', { frame: zoomed ? t('advanced.mapAcross', { km: ZOOM_RADIUS_KM * 2 }) : t('advanced.mapTop') });
}

// ---------------- Paint ----------------
export function renderAdvanced() {
  if (!state.searchResult) { $('podium').innerHTML = `<p class="hint">${t('advanced.noSearch')}</p>`; return; }
  renderMission();
  const res = shown();
  if (res !== view.result) { view.result = res; view.landing = {}; view.point = null; pendingEnter = true; } // a new search: back to the best dates and to the sites
  $('adv-loading').hidden = !!res;
  $('adv-main').classList.toggle('is-waiting', !res);
  if (!res) { detail = null; drawMap(); return; }
  const top = topOptions(res);
  if (!top.some(o => o.site.id === view.site)) view.site = top[0].site.id;
  if (view.point && view.point.from !== view.site) view.point = null;
  // The comparison starts with the top 3, each on the date under study; from then on the scenarios are the user's.
  seedScenarios(top.map(o => ({ site: o.site, t: examined(o, res).t })));
  $('view-advanced').classList.toggle('is-comparing', comparing());
  document.querySelectorAll('#view-advanced .adv-modes [data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === view.mode)); // not the 2D / 3D toggle, which has data-mode too
  if (comparing()) { detail = null; renderScenarios(res.conditions, drawMap); return; }
  const viable = res.options.filter(o => o.verdict.code === 'viable').length;
  $('ranking-info').innerHTML = viable >= 3
    ? t('advanced.rankingInfo', { v: viable, n: res.options.length })
    : `<span class="text-warn" title="${t('advanced.rankingHint')}">${t('advanced.rankingInfo', { v: viable, n: res.options.length })}</span>`;
  // A strip keeps the keyboard focus when it is painted again.
  const focused = document.activeElement?.closest?.('#strips .strip')?.dataset.site;
  renderPodium(res, top);
  renderWindow(res, top);
  renderDetail(res, top);
  renderOthers(res);
  if (focused) document.querySelector(`#strips .strip[data-site="${focused}"]`)?.focus();
  drawCards();
  if (pendingEnter) { pendingEnter = false; playEntrance(); }
}

// ---------------- Entrance (as the result of Plan: motion/motion.css) ----------------
// On coming into the view, or with a new search: the blocks enter one after another, the verdict is stamped, the
// figures count from zero, the scores fill and the landing strips cascade. Not on the repaints of a choice.
let pendingEnter = true;
addEventListener('hashchange', () => { if (location.hash === '#advanced') pendingEnter = true; });
const COUNT_FORMAT = { pct };
function playEntrance() {
  const root = $('view-advanced');
  let i = 0;
  const enter = (el, cls = 'motion-enter') => { if (!el) return; el.style.setProperty('--i', i++); replay(el, cls); };
  ['.mission-box', '.adv-modes', '.top-title'].forEach(q => enter(root.querySelector(q)));
  root.querySelectorAll('.podium-card').forEach(el => enter(el));
  enter(root.querySelector('.top-map-box'));
  enter($('window-box'));
  enter($('detail'));
  ['.detail-origin', '.detail-name', '.res-line'].forEach(q => enter($('detail-head').querySelector(q)));
  enter($('detail-head').querySelector('.res-verdict'), 'motion-stamp');
  root.querySelectorAll('.adv-readout .readout__row').forEach(el => enter(el));
  [$('detail-around'), $('detail-foot'), root.querySelector('.detail-viz')].forEach(el => enter(el));
  root.querySelectorAll('#strips .strip').forEach((strip, row) => {
    const n = strip.children.length;
    [...strip.children].forEach((cell, col) => { cell.style.setProperty('--col', Math.round(col * 40 / n)); cell.style.setProperty('--row', row); cell.classList.add('motion-cell'); });
  });
  root.querySelectorAll('[data-count]').forEach(el => countTo(el, +el.dataset.count, { from: 0, ms: 700, format: COUNT_FORMAT[el.dataset.format] }));
  root.querySelectorAll('.meter i[data-fill]').forEach(el => { el.style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = `${el.dataset.fill}%`; })); });
}

// Repaint after a choice inside the view (site, date): the explanation buttons are added again.
function repaint() { renderAdvanced(); decorate(); }

// The sky of the chosen site, in 2D (the default) or in 3D with the relief: the same data either way.
const advSky = createSkyView({
  canvas: $('adv-sky'), host: $('adv-sky3d'), toggle: $('adv-sky-mode'), notice: $('adv-sky-notice'), hint: $('sky-note'),
  height: () => chartHeight('--adv-sky-h', 190), height3d: () => chartHeight('--adv-sky3d-h', 300), relief: (site, onReady) => services.mission.relief(site, onReady), redraw: () => drawCards(),
  // The ⤢ of the sky (#130): the 3D viewer of viewpoint/ at this site, at the hour of the cursor and on foot.
  viewer: (s, hour) => (detail ? viewerLink(s, { t0: detail.t, days: detail.days, ...requirements(shown().conditions) }, location.search, { at: detail.t + hour * 36e5, foot: true }) : null),
});

// What changes when the mission time moves: the charts, the status at that instant and the map.
export function drawCards() {
  if (state.view !== 'advanced') return;
  const res = shown(), hour = currentHour();
  // As the player of Plan: the time since landing and the date at that instant.
  $('hour-value').textContent = detail ? `+${fmtHours(hour)} · ${fmtDateTime(detail.t + hour * 36e5)}` : hour === 0 ? t('advanced.landing') : `+${fmtHours(hour)}`;
  drawMap();
  if (comparing()) return;
  const m = detail?.mission;
  if (!res || !m) { if (detail) $('adv-now').textContent = t('advanced.loadingSky'); return; }
  const i = Math.min(hour, m.series.length - 1), k = m.series[i], r = { series: m.series, step: 1 };
  advSky.draw(detail.o.site, m, i);
  drawLine($('adv-line'), r, i, res.conditions.days, chartHeight('--adv-line-h', 120));
  // Visible or blocked from the same windows as the verdict; the degrees (centre of the disc), from the drawn sky.
  const seen = services.mission.visibleAt(detail.o.site, detail.t + i * 36e5) ?? { sun: k.sun.margin > 0, earth: k.earth.margin > 0 };
  // As the line under the sky of Plan («El Sol se pone en …»), plus what only Advanced shows: how high over the relief.
  const u = services.mission.untilChange(detail.o.site, detail.t + i * 36e5);
  const dur = x => { const d = fmtHours(Math.round(x.ms / 36e5)); return x.atLeast ? t('advanced.atLeast', { d }) : d; };
  const line = (x, b, ok, body) => !x
    ? `<span class="${ok ? 'text-ok' : 'text-bad'}">${t(`advanced.${body}${ok ? 'Visible' : 'Blocked'}`)}</span> <span class="margin">${signed(b.margin)}</span>`
    : x.visible ? `<span class="text-ok">${t(`advanced.${body}Sets`, { d: dur(x) })}</span> <span class="margin">(${signed(b.margin)})</span>`
    : `<span class="text-bad">${t(`advanced.${body}${x.atLeast ? 'NoRise' : 'Rises'}`, { d: dur(x) })}</span>`;
  $('adv-now').innerHTML = `${line(u?.sun, k.sun, seen.sun, 'sun')} &nbsp;·&nbsp; ${line(u?.earth, k.earth, seen.earth, 'earth')}`;
  $('adv-now').title = t('advanced.degreesTitle');
}

// ---------------- CSV (issue #66) ----------------
// The mission hour by hour of the landing in the detail: what the chart draws, plus visible or not by the verdict's windows.
$('csv-hours').addEventListener('click', () => {
  const d = detail, m = d?.mission;
  if (!m) return;
  const ms = services.mission, site = d.o.site;
  downloadCsv(`${t('advanced.csvHours')}_${fileSlug(site.short)}_${fileStamp(d.t)}.csv`, missionHoursCsv({
    site, landing: d.t, series: m.series, visible: ms.visibleHours(site, d.t, m.series.length),
    heights: ms.heights, horizonModel: ms.horizonModel(site.id),
  }));
});
// The comparison of sites: every site of the search, in order, each on its best date. The slope only if the API gives it.
$('csv-sites').addEventListener('click', async () => {
  const res = shown();
  if (!res) return;
  const ms = services.mission, c = res.conditions;
  const slopes = new Map(await Promise.all(res.options.map(o => ms.slope(o.site).then(sl => [o.site.id, sl.slopeDeg], () => [o.site.id, null]))));
  downloadCsv(`${t('advanced.csvSites')}_${fileStamp(c.from)}_${fileStamp(c.to)}.csv`, siteComparisonCsv({
    options: res.options, conditions: c, points, slopeDeg: id => slopes.get(id) ?? null, horizonModel: ms.horizonModel,
  }));
});

// ---------------- Interaction ----------------
function select(id) { if (view.site !== id || view.point) { view.site = id; view.point = null; repaint(); } }
// A point of the ring opens in the detail as a point of its own; closing it goes back to its site.
function openPoint(k) {
  if (!ring?.points[k]) return;
  view.point = { from: ring.o.site.id, k, radius: ring.radius, site: offSite(ring.o, ring.points[k], ring.radius, k), label: COMPASS[k] };
  refocus = k;
  repaint();
}
function closePoint() {
  if (!view.point) return;
  refocus = view.point.k ?? null;
  view.point = null;
  repaint();
}
// Any spot of the map opens the same way, on the landing of the site under study.
function openMapPoint(at) {
  view.point = { from: view.site, site: mapSite(at), label: MAP_POINT_LABEL };
  repaint();
}
function tryLanding(id, t) {
  const o = shown().options.find(x => x.site.id === id);
  if (t === o.landing) delete view.landing[id]; else view.landing[id] = t;
  view.site = id;
  repaint();
}

$('priority-options').addEventListener('change', e => {
  state.form.priority = e.target.value;
  actions.runSearch();
});

$('view-advanced').addEventListener('click', e => {
  if (e.target.closest('.explain-btn')) return;
  const res = shown();
  const light = e.target.closest('[data-light]');
  if (light) {
    view.light = light.dataset.light === '1';
    document.querySelectorAll('#view-advanced [data-light]').forEach(b => b.setAttribute('aria-pressed', b === light));
    return drawMap();
  }
  const mode = e.target.closest('[data-mode]');
  if (mode) { if (mode.dataset.mode !== view.mode) { view.mode = mode.dataset.mode; repaint(); } return; }
  const radius = e.target.closest('[data-radius]');
  if (radius) { if (+radius.dataset.radius !== view.radius) { view.radius = +radius.dataset.radius; repaint(); } return; }
  const zoom = e.target.closest('[data-zoom]');
  if (zoom) {
    view.zoom = zoom.dataset.zoom === '1';
    document.querySelectorAll('#view-advanced [data-zoom]').forEach(b => b.setAttribute('aria-pressed', b === zoom));
    return drawMap();
  }
  if (!res) return;
  const pin = e.target.closest('[data-point]');
  if (pin) return openPoint(+pin.dataset.point);
  if (e.target.closest('[data-back]')) return closePoint();
  const own = e.target.closest('[data-compare-point]');
  if (own && view.point && detail) {
    registerPoint(view.point.site);
    if (!addScenario(view.point.site, detail.t)) { own.disabled = true; own.textContent = t('advanced.full', { n: scenarioCount() }); return; }
    view.mode = 'scenarios';
    repaint();
    return $('adv-main').scrollIntoView({ block: 'start' });
  }
  const chosen = e.target.closest('.podium-card, [data-select]');
  if (chosen) return select(chosen.dataset.site || chosen.dataset.select);
  const reset = e.target.closest('[data-reset]');
  if (reset) { delete view.landing[reset.dataset.reset]; return repaint(); }
  const cell = e.target.closest('.strip i');
  if (cell) { const id = cell.parentElement.dataset.site, o = res.options.find(x => x.site.id === id); return tryLanding(id, o.landings[+cell.dataset.i].t); }
  const compare = e.target.closest('[data-compare]');
  if (compare) {
    const o = res.options.find(x => x.site.id === compare.dataset.compare), x = examined(o, res);
    if (!addScenario(o.site, x.t)) { compare.disabled = true; compare.textContent = t('advanced.full', { n: scenarioCount() }); return; }
    view.mode = 'scenarios';
    repaint();
    return $('adv-main').scrollIntoView({ block: 'start' });
  }
  const b = e.target.closest('[data-adopt]');
  if (b) {
    const o = res.options.find(x => x.site.id === b.dataset.adopt), x = examined(o, res);
    const option = x.best ? o : { ...o, landing: x.t, result: x.result, verdict: x.verdict, reasons: x.reasons, robustness: { maxDelayDays: x.robustDays, nextWindow: x.next } };
    adopt(option, [o.site.id, ...res.options.map(y => y.site.id).filter(id => id !== o.site.id)].slice(0, 3));
  }
});

// Window strips: arrow keys move the landing; hovering explains each date.
$('strips').addEventListener('keydown', e => {
  const strip = e.target.closest('.strip'); if (!strip) return;
  const o = shown().options.find(x => x.site.id === strip.dataset.site), at = +strip.getAttribute('aria-valuenow');
  const to = { ArrowLeft: at - 1, ArrowRight: at + 1, ArrowDown: at - 1, ArrowUp: at + 1, PageDown: at - 14, PageUp: at + 14, Home: o.landings.findIndex(x => x.t === o.landing) }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  tryLanding(o.site.id, o.landings[Math.max(0, Math.min(o.landings.length - 1, to))].t);
});
function tip(el, box, x, y, html) {
  el.innerHTML = html; el.hidden = false;
  const w = el.offsetWidth, max = box.clientWidth;
  el.style.left = `${Math.max(4, Math.min(max - w - 4, x - w / 2))}px`; el.style.top = `${y}px`;
}
$('strips').addEventListener('pointermove', e => {
  const cell = e.target.closest('.strip i'), box = $('window-box');
  if (!cell) { $('strip-tip').hidden = true; return; }
  const o = shown().options.find(x => x.site.id === cell.parentElement.dataset.site), k = o.landings[+cell.dataset.i];
  const a = cell.getBoundingClientRect(), b = box.getBoundingClientRect();
  tip($('strip-tip'), box, a.left + a.width / 2 - b.left, a.bottom - b.top + 8,
    `<b class="num">${fmtDateTime(k.t)}</b>${UI.verdict({ code: k.code, title: VERDICT_TEXT[k.code] })}${k.t === o.landing ? `<span class="tip-best">${t('advanced.bestDate')}</span>` : ''}<small>${esc(reasonText(k.reason))}</small>`);
});
$('strips').addEventListener('pointerleave', () => { $('strip-tip').hidden = true; });

// Podium ↔ map: hovering a card marks its site on the map.
function hover(id) { if (view.hover !== id) { view.hover = id; drawMap(); } }
$('podium').addEventListener('pointerover', e => hover(e.target.closest('.podium-card')?.dataset.site ?? null));
$('podium').addEventListener('pointerleave', () => hover(null));

// Map: hovering names a site; clicking one of the top 3 opens it, and clicking anywhere else opens that spot.
function hitAt(e) {
  const r = $('top-map').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  return [...mapHits].reverse().find(h => Math.hypot(h.x - x, h.y - y) < 14) || null;
}
// Coordinates under the pointer, or null outside the disc of the map.
function spotAt(e) {
  const r = $('top-map').getBoundingClientRect(), f = mapFrame;
  if (!f) return null;
  const dx = e.clientX - r.left - f.C, dy = e.clientY - r.top - f.C;
  if (Math.hypot(dx, dy) > f.C) return null;
  return { ...M.fromMap(f.centre.x + dx / f.k, f.centre.y - dy / f.k), x: dx + f.C, y: dy + f.C };
}
$('top-map').addEventListener('pointermove', e => {
  const h = hitAt(e), cv = $('top-map');
  if (comparing()) {
    cv.style.cursor = 'pointer';
    if (!h) { $('map-tip').hidden = true; return; }
    const s = h.scenario;
    return tip($('map-tip'), cv.parentElement, h.x, h.y + 18, s
      ? `<b>${s.label} · ${esc(h.site.name)}</b>${s.code ? UI.verdict({ code: s.code, title: VERDICT_TEXT[s.code] }) : ''}<small>${t('advanced.tipLanding', { d: fmtDateTime(s.t) })}</small>`
      : `<b>${esc(h.site.name)}</b><small>${t('advanced.tipMoveHere', { l: activeLabel() })}</small>`);
  }
  hover(h?.rank ? h.o.site.id : null);
  const spot = h || !shown() ? null : spotAt(e);
  cv.style.cursor = (h && !h.point) || spot ? 'pointer' : '';
  if (spot) return tip($('map-tip'), cv.parentElement, spot.x, spot.y + 18, `<b class="num">${coords(spot)}</b><small>${t('advanced.tipSeePoint')}</small>`);
  if (!h) { $('map-tip').hidden = true; return; }
  if (h.point) return tip($('map-tip'), cv.parentElement, h.x, h.y + 18, `<b>${esc(h.site.name)}</b>${h.point.verdict ? UI.verdict(h.point.verdict) : ''}<small>${t('advanced.tipOwnPoint')}</small>`);
  tip($('map-tip'), cv.parentElement, h.x, h.y + 18, `<b>${h.rank ? `${h.rank} · ` : ''}${esc(h.o.site.name)}</b>${UI.verdict(h.o.verdict)}<small>${t('advanced.tipBest', { d: fmtDateTime(h.o.landing) })}${h.rank ? '' : t('advanced.tipSeePointTail')}</small>`);
});
$('top-map').addEventListener('pointerleave', () => { $('map-tip').hidden = true; hover(null); });
$('top-map').addEventListener('click', e => {
  const h = hitAt(e);
  if (!comparing()) {
    if (h?.rank) return select(h.o.site.id);
    if (h?.point || !shown()) return;
    // A grey site outside the top 3 opens on its exact coordinates; an empty spot, on those under the pointer.
    const at = h ? h.site : spotAt(e);
    if (at) openMapPoint(at);
    return;
  }
  if (h) return pickOnMap(h.scenario ? { index: h.scenario.index } : { site: h.site });
  // An empty spot: a point of the user's own, at the coordinates under the pointer.
  const spot = spotAt(e);
  if (spot) pickOnMap(spot);
});

// Hour-by-hour chart: click or drag to move the mission time.
function scrub(e) {
  const cv = $('adv-line'), r = cv.getBoundingClientRect(), max = +$('hour').max;
  const f = (e.clientX - r.left - 30) / (r.width - 38); // plot area of drawLine: 30 px on the left, 8 px on the right
  $('hour').value = Math.round(Math.max(0, Math.min(1, f)) * max);
  actions.onHourChange();
}
$('adv-line').addEventListener('pointerdown', e => { e.target.setPointerCapture(e.pointerId); scrub(e); });
$('adv-line').addEventListener('pointermove', e => { if (e.buttons & 1) scrub(e); });
