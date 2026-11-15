// "Comparar escenarios", the second mode of the "Avanzado" view (it is part of that view: only advanced.js imports it).
// From 2 to 4 scenarios side by side, each with its own site (one of the catalogue or a point picked on the map) and
// its own landing date, with the same figures: verdict, Sun, Earth, longest night and longest gap without the Earth.
// Data: every scenario is judged by the mission service (application/mission-service.js, scenario()) with the rules of
// planner/src/rules.js, and the service also says which scenario is the best of each row (compareScenarios()).
// This module only paints and keeps which scenarios are on screen.
import { SITES, siteGroups } from '../engine/catalog.js';
import { $, esc, isoLocal } from '../common/util.js';
import * as UI from '../common/ui.js';
import { services, state } from '../common/state.js';
import { t, lang, fmtNum, fmtPct, fmtHours, fmtCoords } from '../common/i18n.js';
import { hasEarthGap } from '../common/earth-gap.js';

export const MIN_SCENARIOS = 2, MAX_SCENARIOS = 4;
const DAY_MS = 864e5;
const LETTERS = ['A', 'B', 'C', 'D'];
// Reasons come in Spanish from the domain (planner/src/ranking.js, rules.js), without a code: in English the wrappers
// of ranking.js are rewritten here and each rule sentence by replan.domainReason. An unknown text stays as it is.
const RANKING_EN = [
  [/^Mayor sombra (.+): tu batería aguanta (\S+) h$/, 'Longest shadow $1: your battery lasts $2 h'],
  [/^Sol durante toda la misión$/, 'Sun during the whole mission'],
  [/^Tierra visible el (\S+) % del tiempo \(pides (\S+) %\)$/, 'Earth visible $1% of the time (you ask for $2%)'],
  [/^Sigue siendo viable aunque te retrases hasta (\S+) días?$/, 'Still viable with up to $1 days of delay'],
  [/^Poco margen: con medio día de retraso ya no vale$/, 'Little margin: half a day of delay and it is no longer viable'],
  [/^Sin datos de visibilidad para toda la misión$/, 'No visibility data for the whole mission'],
];
const rule = s => t('replan.domainReason', s);
const upper = s => s.charAt(0).toUpperCase() + s.slice(1);
export function reasonText(s) {
  if (lang !== 'en' || !s) return s;
  const all = /^Cumple todas las reglas\. La que más aprieta: (.+)$/.exec(s);
  if (all) return `Meets every rule. The tightest: ${rule(upper(all[1]))}`;
  const close = /^Por poco: (.+)$/.exec(s);
  if (close) return `Only just: ${rule(close[1])}`;
  for (const [re, en] of RANKING_EN) if (re.test(s)) return s.replace(re, en).replace(/(\d),(\d)/g, '$1.$2');
  return s.split(/; (?!con el DEM)/).map(rule).join('; ');
}
const num = (v, digits = 1) => fmtNum(v, digits);
const pct = v => fmtPct(v);
const hours = fmtHours;
const coords = s => fmtCoords(s);

// ---------------- State ----------------
const view = {
  list: [],        // scenarios on screen: [{ siteId, t }]
  active: 0,       // the scenario a click on the map moves
  custom: [],      // points picked on the map: sites { id, name, short, lat, lon, custom: true }
  results: new Map(), // scenario key → { e } (what the service answered) | { error }
  mission: null,   // mission of the comparison: { days, batteryHours, minEarthPct, maxEarthGapHours }
  onChange: () => {}, // the map of the view repaints here
};

const allSites = () => [...SITES, ...view.custom];
const siteOf = s => allSites().find(x => x.id === s.siteId);
const keyOf = s => { const m = view.mission, site = siteOf(s); return `${s.siteId}|${site.lat}|${site.lon}|${s.t}|${m.days}|${m.batteryHours}|${m.minEarthPct}|${m.maxEarthGapHours}`; };
const resultOf = s => view.results.get(keyOf(s)) ?? null;

/** The scenarios start as the given landings (the top of the search, each on its date). Only the first time. */
export function seedScenarios(landings) {
  landings.forEach(x => { if (x.site.custom) registerPoint(x.site); });
  if (view.list.length) return;
  view.list = landings.slice(0, MAX_SCENARIOS).map(x => ({ siteId: x.site.id, t: x.t }));
  while (view.list.length && view.list.length < MIN_SCENARIOS) view.list.push({ siteId: view.list[0].siteId, t: view.list.at(-1).t + 7 * DAY_MS });
}

export const scenarioCount = () => view.list.length;

/** Adds a scenario and makes it the active one. If it is already there, it only becomes the active one. false if there is no room. */
export function addScenario(site, t) {
  if (site.custom) registerPoint(site);
  const at = view.list.findIndex(s => s.siteId === site.id && s.t === t);
  if (at >= 0) { view.active = at; return true; }
  if (view.list.length >= MAX_SCENARIOS) return false;
  view.list.push({ siteId: site.id, t });
  view.active = view.list.length - 1;
  return true;
}

/** Makes a point that comes from outside the comparison (a point off a site, opened in the detail) one of its own points. */
export function registerPoint(site) {
  if (!view.custom.some(s => s.id === site.id)) view.custom.push(site);
}

/** What the map draws: one marker per scenario, and the sites no scenario uses. */
export function scenarioMarkers() {
  const used = new Set(view.list.map(s => s.siteId));
  return {
    markers: view.list.map((s, i) => ({ index: i, label: LETTERS[i], site: siteOf(s), t: s.t, code: resultOf(s)?.e?.verdict.code ?? null, active: i === view.active })),
    others: allSites().filter(s => !used.has(s.id)),
  };
}
export const activeSite = () => (view.list.length ? siteOf(view.list[view.active]) : null);
export const activeLabel = () => LETTERS[view.active];

/** A click on the map: on a scenario marker it becomes the active one; on a site or an empty point, the active scenario moves there. */
export function pickOnMap({ index = null, site = null, lat, lon }) {
  if (index !== null) { setActive(index); return; }
  if (!site) {
    const n = view.custom.length + 1;
    site = { id: `scenario-point-${n}`, name: t('advanced.sc.pointName', { n, coords: coords({ lat, lon }) }), short: t('advanced.sc.pointShort', { n }), lat, lon, custom: true,
      note: t('advanced.sc.pointNote') };
    view.custom.push(site);
  }
  view.list[view.active].siteId = site.id;
  paint();
}

function setActive(i) {
  if (i === view.active) return;
  view.active = i;
  markActive();
  view.onChange();
}

// ---------------- Paint ----------------
const ROWS = {
  verdict: { label: t('advanced.sc.verdict'), note: () => t('advanced.sc.verdictNote') },
  sun: { label: t('advanced.sc.sun'), note: () => t('advanced.sc.sunNote'), text: pct },
  earth: { label: t('advanced.sc.earth'), note: m => t('advanced.sc.earthNote', { pct: pct(m.minEarthPct) }), text: pct },
  night: { label: t('advanced.sc.night'), note: m => t('advanced.sc.nightNote', { h: num(m.batteryHours) }), text: hours },
  earthGap: { label: t('advanced.sc.gap'), note: m => t('advanced.sc.gapNote', { h: hasEarthGap(m.maxEarthGapHours) ? num(m.maxEarthGapHours) : null }), text: hours },
};

function paintHead() {
  const options = id => {
    const opt = s => `<option value="${esc(s.id)}"${s.id === id ? ' selected' : ''}>${esc(s.name)}</option>`;
    return siteGroups().map(g => `<optgroup label="${esc(g.label)}">${g.sites.map(opt).join('')}</optgroup>`).join('') + (view.custom.length ? `<optgroup label="${t('advanced.sc.ownPoints')}">${view.custom.map(opt).join('')}</optgroup>` : '');
  };
  const removable = view.list.length > MIN_SCENARIOS;
  $('scenario-head').innerHTML = `<tr><th scope="col" class="scenario-corner"><span class="eyebrow">${t('advanced.sc.corner')}</span></th>${view.list.map((s, i) => `
    <th scope="col" class="scenario-col" data-col="${i}">
      <div class="scenario-top"><span class="rank rank--sm" aria-hidden="true">${LETTERS[i]}</span><span class="scenario-name">${esc(siteOf(s).name)}</span>
        ${removable ? `<button type="button" class="scenario-remove" data-remove="${i}" aria-label="${t('advanced.sc.removeLabel', { l: LETTERS[i] })}" title="${t('advanced.sc.remove')}">✕</button>` : ''}</div>
      <select data-site-of="${i}" aria-label="${t('advanced.sc.siteLabel', { l: LETTERS[i] })}" title="${esc(siteOf(s).custom ? siteOf(s).name : `${siteOf(s).name} · ${coords(siteOf(s))}`)}">${options(s.siteId)}</select>
      <input type="datetime-local" data-date-of="${i}" value="${isoLocal(s.t)}" aria-label="${t('advanced.sc.dateLabel', { l: LETTERS[i] })}">
    </th>`).join('')}</tr>`;
  $('scenario-add').disabled = view.list.length >= MAX_SCENARIOS;
  $('scenario-add').title = view.list.length >= MAX_SCENARIOS ? t('advanced.sc.max', { max: MAX_SCENARIOS }) : '';
}

function paintBody() {
  const m = view.mission, states = view.list.map(resultOf);
  const rows = services.mission.compareScenarios(states.map(x => x?.e ?? null));
  const cell = (row, i) => {
    const st = states[i], cls = `scenario-cell${row.best[i] ? ' is-best' : ''}`;
    if (!st) return `<td class="${cls} is-loading" data-col="${i}">…</td>`;
    if (st.error) return `<td class="${cls}" data-col="${i}">${row.id === 'verdict' ? `<span class="text-bad">${t('advanced.sc.noData')}</span><small>${esc(st.error.message)}</small>` : '—'}</td>`;
    const best = row.best[i] ? `<span class="best-mark" title="${t('advanced.sc.bestTitle')}">${t('advanced.sc.best')}</span>` : '';
    if (row.id === 'verdict') return `<td class="${cls}" data-col="${i}"><span class="scenario-value">${UI.verdict(st.e.verdict)}${best}</span><small>${esc(reasonText(st.e.verdict.reason))}</small></td>`;
    if (row.values[i] === null) return `<td class="${cls}" data-col="${i}">—</td>`;
    return `<td class="${cls}" data-col="${i}"><span class="scenario-value"><b class="num">${ROWS[row.id].text(row.values[i])}</b>${best}</span></td>`;
  };
  $('scenario-body').innerHTML = rows.map(row => `<tr data-row="${row.id}">
    <th scope="row"><b>${ROWS[row.id].label}</b><small>${esc(ROWS[row.id].note(m))}</small></th>${view.list.map((_, i) => cell(row, i)).join('')}</tr>`).join('');
  // Which horizon each scenario was judged with: without terrain the verdict is optimistic near the pole.
  const model = i => states[i]?.e?.horizonModel, flat = view.list.map((_, i) => i).filter(i => model(i) === 'sphere');
  const source = t(services.mission.source === 'api' ? 'advanced.sc.sourceApi' : 'advanced.sc.sourceSim');
  $('scenarios-note').innerHTML = t('advanced.sc.note', { source })
    + (flat.length ? ` <span class="text-warn">${t('advanced.sc.flat', flat.length, flat.map(i => LETTERS[i]).join(', '))}</span>` : '')
    + ` ${t('advanced.sc.mapHint', { l: LETTERS[view.active] })}`;
  markActive();
}

function markActive() {
  document.querySelectorAll('#scenario-table [data-col]').forEach(el => el.classList.toggle('is-active', +el.dataset.col === view.active));
}

// Asks the service for the scenarios it has not judged yet; each one repaints the figures when it arrives.
function load() {
  if (view.results.size > 60) view.results.clear();
  for (const s of view.list) {
    const key = keyOf(s);
    if (view.results.has(key) || pending.has(key)) continue;
    pending.add(key);
    const settle = value => {
      pending.delete(key);
      view.results.set(key, value);
      if (view.list.some(x => keyOf(x) === key)) { paintBody(); view.onChange(); }
    };
    services.mission.scenario(siteOf(s), s.t, view.mission).then(e => settle({ e }), error => settle({ error }));
  }
}
const pending = new Set();

function paint() {
  view.active = Math.min(view.active, view.list.length - 1);
  paintHead();
  paintBody();
  load();
  view.onChange();
}

/** Paints the comparison for the mission of the search (`conditions`). `onChange` is called when the map must repaint. */
export function renderScenarios(conditions, onChange) {
  view.mission = { days: conditions.days, batteryHours: conditions.batteryHours, minEarthPct: conditions.minEarthPct, maxEarthGapHours: conditions.maxEarthGapHours };
  view.onChange = onChange;
  if (state.customSite) registerPoint(state.customSite); // the point typed in Plan (#101) can be a scenario too
  $('scenarios-hint').textContent = t('advanced.sc.hint', { min: MIN_SCENARIOS, max: MAX_SCENARIOS, days: num(conditions.days) });
  paint();
}

// ---------------- Interaction ----------------
$('scenario-add').addEventListener('click', () => {
  const from = view.list[view.active];
  if (!from) return; // nothing to start from until the search seeds the scenarios
  if (addScenario(siteOf(from), from.t + 7 * DAY_MS)) paint();
});
$('scenario-table').addEventListener('click', e => {
  const remove = e.target.closest('[data-remove]');
  if (remove && view.list.length > MIN_SCENARIOS) {
    const i = +remove.dataset.remove;
    view.list.splice(i, 1);
    if (view.active > i || view.active >= view.list.length) view.active = Math.max(0, view.active - 1);
    return paint();
  }
  const col = e.target.closest('[data-col]');
  if (col) setActive(+col.dataset.col);
});
$('scenario-table').addEventListener('focusin', e => { const col = e.target.closest('[data-col]'); if (col) setActive(+col.dataset.col); });
$('scenario-table').addEventListener('change', e => {
  const site = e.target.closest('[data-site-of]'), date = e.target.closest('[data-date-of]');
  if (site) view.list[+site.dataset.siteOf].siteId = site.value;
  else if (date) {
    const t = Date.parse(`${date.value}Z`), s = view.list[+date.dataset.dateOf];
    if (!Number.isFinite(t)) { date.value = isoLocal(s.t); return; }
    s.t = t;
  } else return;
  // The controls keep the focus: only the figures are painted again.
  paintBody(); load(); view.onChange();
});
