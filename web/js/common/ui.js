// Design system components as functions that return HTML (a string).
// They are the generated version of the components in styles/components.css;
// design-system.html shows all of them. Text is escaped here: pass plain text
// except in parameters documented as "html".
import { esc } from './util.js';
import { VERDICT_TONE } from './theme.js';

// Optional attributes: { 'data-explain': 'pct-sun', title: '…' } → ' data-explain="pct-sun" title="…"'.
const attrs = (a = {}) => Object.entries(a).filter(([, v]) => v != null && v !== false)
  .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');

/** Badge. tone: 'ok' | 'warn' | 'bad' | 'neutral'. variant: 'pill' | 'outline' | null. className: extra classes. */
export function badge(text, { tone = 'neutral', variant = null, large = false, className = '', ...rest } = {}) {
  const cls = ['badge', variant && `badge--${variant}`, large && 'badge--large', className].filter(Boolean).join(' ');
  return `<span class="${cls}" data-tone="${tone}"${attrs(rest)}>${esc(text)}</span>`;
}

/** Engine verdict ({ code, title }) as a rounded badge: Viable / Justo / No viable. */
export const verdict = (v, options = {}) => badge(v.title, { tone: VERDICT_TONE[v.code], variant: 'pill', ...options });

/** Button. variant: 'primary' | null. html: already escaped content (optional). */
export function button(text, { variant = null, block = false, html = null, ...rest } = {}) {
  const cls = ['btn', variant && `btn--${variant}`, block && 'btn--block'].filter(Boolean).join(' ');
  return `<button type="button" class="${cls}"${attrs(rest)}>${html ?? esc(text)}</button>`;
}

/** Metric: label + value. tone: 'sun' | 'earth' | null. */
export const metric = ({ label, value, tone = null, explain = null }) =>
  `<div class="metric"${attrs({ 'data-tone': tone, 'data-explain': explain })}><span>${esc(label)}</span><b>${esc(value)}</b></div>`;

/**
 * Text of a robustness band next to a figure: «[55–66 %]». range: { min, max } | null (no band: empty text);
 * format: value → text (it gives both ends; « %» is said once).
 */
export function bandText(range, format) {
  if (!range) return '';
  const lo = format(range.min), hi = format(range.max), unit = / %$/.exec(hi)?.[0];
  return `[${unit && lo.endsWith(unit) ? lo.slice(0, -unit.length) : lo}–${hi}]`;
}

/**
 * Robustness band of a figure, with its explanation card. text: bandText(…); empty = hidden. The text goes in a
 * <span> so it can be replaced without losing the «?» of the explanation mode (see setBand).
 */
export const band = (text, id = null) =>
  `<small class="figure-band"${attrs({ id, 'data-explain': 'horizon-band', hidden: !text })}><span>${esc(text)}</span></small>`;

/**
 * Deep polar note (#437): south of 85°S the API warns `deep_polar_uncertainty` and the figures of the site are less
 * reliable. html: the short text and a link to «Cómo sabemos que es correcto» (texts in common.deepPolar.*). It only
 * informs: no verdict or score depends on it. Hidden unless `on`.
 */
export const deepPolarNote = (text, link, { id = null, on = false } = {}) =>
  `<p class="deep-polar-note"${attrs({ id, hidden: !on })}>${esc(text)} <a href="#sources">${esc(link)}</a></p>`;

/** Changes the text of a band already on the page (empty = hidden). */
export function setBand(el, text) {
  el.hidden = !text;
  el.firstElementChild.textContent = text;
}

/**
 * Key figure: label, large value and note. meets: true (green) | false (red) | null (neutral).
 * band: text of its robustness band («[55–66 %]», see bandText), shown under the value.
 */
export const figure = ({ label, value, note = null, meets = null, explain = null, band: bandOf = null }) =>
  `<div class="figure"${attrs({ 'data-explain': explain })}><span>${esc(label)}</span>` +
  `<b${meets == null ? '' : ` class="${meets ? 'text-ok' : 'text-bad'}"`}>${esc(value)}</b>` +
  (bandOf ? band(bandOf) : '') +
  (note ? `<small>${esc(note)}</small>` : '') + '</div>';

/** Row of key figures. */
export const figures = list => `<div class="figures" style="--cols: ${list.length}">${list.map(figure).join('')}</div>`;

/** Legend: [{ text, color }] where color is a CSS value (e.g. 'var(--color-sun)'). */
export const legend = items =>
  `<div class="legend">${items.map(i => `<span><i style="--c: ${i.color}"></i>${esc(i.text)}</span>`).join('')}</div>`;

/** Radio option shaped as a card. */
export const option = ({ id, title, detail, checked }) =>
  `<button type="button" class="option" role="radio" aria-checked="${!!checked}" data-id="${esc(id)}"><b>${esc(title)}</b><span>${esc(detail)}</span></button>`;

/** Selectable list item: checkbox + name + extra (html). */
export const selectable = ({ id, name, pressed, extra = '', title = null }) =>
  `<button type="button" class="selectable" data-id="${esc(id)}" aria-pressed="${!!pressed}"${attrs({ title })}>` +
  `<span class="selectable__check" aria-hidden="true"></span><span class="selectable__name">${esc(name)}</span>${extra}</button>`;

/** Table. columns: ['Recurso', …]; rows: [[cellHtml, …]] (cells are html). */
export const table = (columns, rows) =>
  `<div class="table-scroll"><table class="data-table"><thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
  `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

/** Row of coloured dots: [{ color, title }]. */
export const dots = list =>
  `<div class="dots">${list.map(d => `<i style="--c: ${d.color}"${attrs({ title: d.title })}></i>`).join('')}</div>`;

/** Box. html: content. className: extra classes. */
export const box = (html, { className = '', tag = 'section', ...rest } = {}) =>
  `<${tag} class="box ${className}"${attrs(rest)}>${html}</${tag}>`;

/** Empty state. */
export const empty = text => `<div class="empty">${esc(text)}</div>`;
