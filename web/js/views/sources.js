// "Fuentes de datos" view: where every data item comes from, who brings it and its state today, and how we know the
// calculation is right: the measured errors against JPL Horizons and the PGDA products. Nothing here points to the
// repository: the tab is read by people who do not have it (#494).
import { SOURCES, CONTROL_CASES, SITES, citationParts } from '../engine/catalog.js';
import { $, esc } from '../common/util.js';
import * as UI from '../common/ui.js';
import { t, fmtNum } from '../common/i18n.js';

const STATUS_LABEL = Object.fromEntries(['used', 'validation', 'asset', 'reference'].map(k => [k, t(`sources.status.${k}`)]));
const STATUS_TONE = { used: 'ok', validation: 'ok', asset: 'neutral', reference: 'neutral' };

// Every figure of the validation section comes from this file: no number of a measurement is written in this view.
const SUMMARY_URL = new URL('../../assets/validation-summary.json', import.meta.url);
let summary = null;      // the parsed file, once loaded
let summaryFailed = false;
let loading = null;

const number = (x, decimals = 0) => fmtNum(x, decimals, decimals);
const degrees = (x, decimals) => `${number(x, decimals)}°`;
const duration = seconds => (seconds < 90 ? `${number(seconds)} s` : `${number(seconds / 60, 1)} min`);
const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;
const figure = (value, note = null) => `<span class="validation__figure">${esc(value)}${note ? `<small>${esc(note)}</small>` : ''}</span>`;
const COLUMNS = ['what', 'against', 'points', 'typical', 'max'].map(k => t(`sources.col.${k}`));

/** Rows of the comparison against JPL Horizons: direction, and rises and sets by latitude band. */
function horizonsRows({ direction, events }) {
  const rows = [[
    t('sources.horizons.direction', { sites: number(direction.sites), from: esc(direction.from), to: esc(direction.to) }),
    link(direction.sourceUrl, 'JPL Horizons (DE441)'),
    figure(number(direction.points)),
    figure(degrees(direction.rmsDeg, 4), t('sources.rms')),
    figure(degrees(direction.maxDeg, 4), t('sources.failsAbove', { max: degrees(direction.budgetDeg.max, 3) })),
  ]];
  for (const g of events.groups.filter(g => g.events > 0)) {
    const where = g.sites.length === 1
      ? t('sources.horizons.oneSite', { lat: degrees(g.maxAbsLat, 2) })
      : t('sources.horizons.sites', { n: number(g.sites.length), min: degrees(g.minAbsLat, 2), max: degrees(g.maxAbsLat, 2) });
    rows.push([
      t(g.body === 'sun' ? 'sources.horizons.eventsSun' : 'sources.horizons.eventsEarth', { where, from: esc(events.from), to: esc(events.to) }),
      link(events.sourceUrl, 'JPL Horizons (DE441)'),
      figure(number(g.events), t('sources.horizons.eventsNote', { missing: number(g.missing), extra: number(g.extra) })),
      figure(duration(g.medianSeconds), t('sources.median')),
      figure(duration(g.maxSeconds), t('sources.horizons.worst', { site: g.worstSite, deg: degrees(g.maxEquivalentDeg, 4) })),
    ]);
  }
  return rows;
}

/** Rows of the comparison against the PGDA products (slope, mean illumination and permanent shadow). */
function pgdaRows({ slope, illumination, permanentShadow }) {
  const slopeRow = (what, s) => [
    what, link(slope.sourceUrl, `PGDA: ${slope.product}`), figure(number(s.points)),
    figure(degrees(s.rms, 2), t('sources.rmsBias', { bias: degrees(s.bias, 2) })), figure(degrees(s.maxAbs, 2)),
  ];
  const sun = illumination.sunFraction;
  const shadowPoints = permanentShadow.outside.points + permanentShadow.inside.points;
  const shadowAgree = permanentShadow.outside.agree + permanentShadow.inside.agree;
  return [
    slopeRow(t('sources.pgda.slope100'), slope.window100m),
    slopeRow(t('sources.pgda.slope400'), slope.window400m),
    slopeRow(t('sources.pgda.slope800'), slope.cap800m),
    [
      t('sources.pgda.sun'),
      link(illumination.sourceUrl, `PGDA: ${illumination.product}`),
      figure(number(sun.points)),
      figure(`${number(sun.rms, 2)} pp`, t('sources.rmsBias', { bias: `${number(sun.bias, 2)} pp` })),
      figure(`${number(sun.maxAbs, 2)} pp`),
    ],
    [
      t('sources.pgda.shadow'),
      link(permanentShadow.sourceUrl, `PGDA: ${permanentShadow.product}`),
      figure(number(shadowPoints), t('sources.pgda.shadowPoints', { outside: number(permanentShadow.outside.points), inside: number(permanentShadow.inside.points) })),
      figure(t('sources.pgda.agree', { n: number(shadowAgree), total: number(shadowPoints) }), t('sources.pgda.agreeNote')),
      figure('—'),
    ],
  ];
}

function validationTables() {
  if (summaryFailed) return UI.empty(t('sources.summaryFailed'));
  if (!summary) return UI.empty(t('sources.summaryLoading'));
  const { horizons, pgda } = summary;
  return `<h4>${esc(t('sources.horizons.title'))}</h4>` +
    UI.table(COLUMNS, horizonsRows(horizons)) +
    `<p class="hint">${t('sources.horizons.note', { date: esc(horizons.direction.fetchedAt) })}</p>` +
    `<h4>${esc(t('sources.pgda.title'))}</h4>` +
    UI.table(COLUMNS, pgdaRows(pgda)) +
    `<p class="hint">${t('sources.pgda.note', { comparison: esc(pgda.slope.comparison) })}</p>`;
}

/** «Casos de control» (#102): what must come out at each one. No figure is measured here. */
function controlSection() {
  const columns = ['case', 'why', 'expected'].map(k => t(`sources.control.col.${k}`));
  const rows = CONTROL_CASES.map(c => {
    const site = SITES.find(s => s.id === c.siteId);
    const source = c.source ? `<small>${link(c.source, t('sources.control.source'))}</small>` : '';
    return [
      `<b>${esc(t(`sources.control.${c.id}.case`, { site: site?.name ?? '' }))}</b>${source}`,
      esc(t(`sources.control.${c.id}.why`)),
      esc(t(`sources.control.${c.id}.expected`)),
    ];
  });
  return `<div class="validation__control"><h4>${esc(t('sources.control.title'))}</h4><p>${esc(t('sources.control.intro'))}</p>` +
    `${UI.table(columns, rows)}</div>`;
}

function validationSection() {
  return UI.box(
    `<h3>${esc(t('sources.validation.title'))}</h3>` +
    `<p>${esc(t('sources.validation.intro'))}</p>` +
    `<p class="validation__warning">${t('sources.validation.warning')}</p>` +
    `<div id="validation-tables" class="validation">${validationTables()}</div>` +
    controlSection() +
    `<h4>${esc(t('sources.limits.title'))}</h4>` +
    '<ul class="validation__limits">' +
    ['coords', 'dem', 'res', 'lowObserver', 'sphere', 'step', 'slope', 'eclipses', 'orientation', 'years', 'visibility', 'dsn'].map(k => `<li>${esc(t(`sources.limits.${k}`))}</li>`).join('') +
    '</ul>',
    { className: 'validation', id: 'validation' });
}

/** Loads the summary once; when it arrives, fills the tables if the view is still on screen. */
function loadSummary() {
  loading ??= fetch(SUMMARY_URL)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(json => { summary = json; }, () => { summaryFailed = true; })
    .then(() => { const el = $('validation-tables'); if (el) el.innerHTML = validationTables(); });
}

/** The licence cell: its name (MIT, Apache 2.0, public domain) or, when it was not confirmed, only the link to the terms. */
const licenseCell = ({ kind, url }, name) => {
  const text = t(`sources.license.${kind}`);
  // The accessible name says which resource it is about and that it opens in a new tab (WCAG 2.4.4).
  return `<a href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(`${text}: ${name} (${t('sources.license.newTab')})`)}">${esc(text)}</a>`;
};

/** The citation cell: each full reference with its title in italics and its DOI or NTRS identifier as a link; a plain text if there is no structure. */
const citeCell = i => {
  if (!i.references) return i.cite ? esc(i.cite) : '—';
  return i.references.map(ref => {
    const { authors, year, title, venue, id } = citationParts(ref);
    return `<span class="cite">${esc(authors)} (${year}). <em>${esc(title)}</em>. ${venue ? `${esc(venue)}. ` : ''}<a href="${esc(id.href)}" target="_blank" rel="noopener" aria-label="${esc(`${id.text}: ${title} (${t('sources.license.newTab')})`)}">${esc(id.text)}</a></span>`;
  }).join('<br>');
};

/** One row of a group: resource (with its version), organisation, purpose, citation, licence and status. */
export const sourceRow = i => [
  link(i.url, i.name) + (i.version ? ` <small>${esc(t('sources.version', { version: i.version }))}</small>` : ''),
  esc(i.org), esc(i.purpose), citeCell(i), licenseCell(i.license, i.name),
  UI.badge(STATUS_LABEL[i.status], { tone: STATUS_TONE[i.status] }),
];

export function renderSources() {
  const columns = ['resource', 'org', 'purpose', 'cite', 'license', 'status'].map(k => t(`sources.col.${k}`));
  $('view-sources').innerHTML =
    UI.box(`<h2>${esc(t('sources.title'))}</h2><p class="hint">${esc(t('sources.intro'))}</p>`, { tag: 'div' }) +
    validationSection() +
    SOURCES.map(g => UI.box(`<h3>${esc(g.group)}</h3>` + (g.note ? `<p class="hint">${esc(g.note)}</p>` : '') + UI.table(columns, g.items.map(sourceRow)))).join('');
  loadSummary();
}
