// The rules of one landing as a checklist, shared by Plan (a day of the calendar, the verdict of the result) and
// Advanced (the verdict of the detail), so both say the same in the same way.
import { esc } from './util.js';
import { t, lang } from './i18n.js';

// The rules of one landing ✔ / ✘ (≈ when it passes by little, ? when it cannot be certified): the calendar's day and
// the verdict of the result show the same list. landing: { code, reason, trace }.
export function ruleChecks(landing) {
  const tight = landing.code === 'marginal' ? String(landing.reason ?? '').replace(/^Por poco: /, '') : null;
  return (landing.trace ?? []).map(r => {
    // ok: null is «not certified» (the slope with a coarse DEM): it does not fail, but it caps the day at «justo».
    const mark = r.ok === null ? ['warn', '?'] : !r.ok ? ['bad', '✘'] : r.value === tight ? ['warn', '≈'] : ['ok', '✔'];
    return `<li class="day-check day-check--${mark[0]}" title="${esc(reasonText(r.value ?? ''))}"><b aria-hidden="true">${mark[1]}</b><span>${esc(ruleName(r.rule))}</span><span class="day-check__value">${ruleFigure(r)}</span></li>`;
  }).join('');
}
// The figure of a rule, short: its value and its limit («98 % · mín. 60 %»). A rule that is only yes or no (the Sun or
// the Earth at landing) has none: the mark says it. The whole sentence stays in the tooltip.
function ruleFigure(r) {
  const [text, why] = String(r.value ?? '').split('; ');
  const value = text.match(/-?\d+(?:[.,]\d+)?\s?(?:%|°|d(?:\s\d+\s?h)?|h)(?![a-záéíóú])/i)?.[0];
  const max = text.match(/\((?:máximo|la batería aguanta)\s([^)]+)\)/), min = text.match(/\(mínimo\s([^)]+)\)/);
  const limit = max ? `${t('common.rule.max')} ${num(max[1])}` : min ? `${t('common.rule.min')} ${num(min[1])}` : '';
  const out = value ? `${esc(num(value))}${limit ? ` <small>· ${esc(limit)}</small>` : ''}` : '';
  return r.ok === null && why ? `${out} <small>· ${t('common.rule.uncertified')}</small>` : out;
}
export const VERDICT_WORD = { viable: `<span class="text-ok">${t('common.word.viable')}</span>`, marginal: `<span class="text-warn">${t('common.word.marginal')}</span>`, 'not_viable': `<span class="text-bad">${t('common.word.not_viable')}</span>` };

// ---------------- English of the domain's sentences ----------------
// The verdicts, rules and reasons come in Spanish from planner/ (also through /v1/best-landings), and the views read
// some of them by their words. So they stay Spanish in the data and are only translated to be shown.

/** Lowercase first letter to go after a colon; in English the Sun and the Earth keep their capital. */
export const lowerFirst = s => (lang === 'en' && /^(Sun|Earth)\b/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** Figures written the English way: 1,5 → 1.5 and 60 % → 60%. */
const num = s => (lang === 'en' ? String(s).replace(/(\d),(\d)/g, '$1.$2').replace(/(\d) %/g, '$1%') : String(s));

/** Name of a rule of the trace («R4 · Sobrevivir a la sombra» → «Survive the shadow»), without its id. */
export function ruleName(rule) {
  const s = String(rule ?? ''), id = s.match(/^(R\d+) · /)?.[1];
  const name = s.replace(/^R\d+ · /, '');
  if (lang === 'es') return name;
  if (id) return t(`common.rule.${id}`);
  return name === 'Datos suficientes' ? t('common.rule.R0') : name;
}

// One sentence of planner/src/rules.js or ranking.js → its key and arguments. Order matters: the first match wins.
const SENTENCES = [
  [/^El Sol se ve al aterrizar$/, 'sunAtLanding'],
  [/^El Sol no se ve al aterrizar ni vuelve a salir en el periodo consultado$/, 'sunNever'],
  [/^El Sol no se ve al aterrizar; sale en (.+)$/, 'sunRises'],
  [/^La Tierra se ve al aterrizar$/, 'earthAtLanding'],
  [/^La Tierra no se ve al aterrizar ni vuelve a salir en el periodo consultado$/, 'earthNever'],
  [/^La Tierra no se ve al aterrizar; sale en (.+)$/, 'earthRises'],
  [/^Al menos (.+) de sol tras aterrizar$/, 'sunAfterOpen'],
  [/^(.+) de sol tras aterrizar$/, 'sunAfter'],
  [/^Sombra más larga: (.+)$/, 'shadow'],
  [/^(.+) de la misión con sol y Tierra$/, 'sunAndEarth'],
  [/^(.+) de la misión con sol$/, 'sunShare'],
  [/^Hueco más largo sin Tierra: (.+)$/, 'earthGap'],
  [/^Tierra visible el (.+) de la misión$/, 'earthShare'],
  [/^Pendiente de (.+) en (.+) m; con el DEM de (.+) m\/px no se puede certificar en (.+) m$/, 'slopeUncertified'],
  [/^Pendiente de (.+) en (.+) m$/, 'slope'],
  [/^Sin datos de pendiente: no se pidió a la API$/, 'slopeNotAsked'],
  [/^Sin datos de pendiente: el punto queda fuera del DEM o el servidor no lo tiene$/, 'slopeNoDem'],
  [/^El periodo consultado no cubre toda la misión$/, 'periodShort'],
  [/^Sin datos de visibilidad para toda la misión$/, 'noData'],
  [/^Mayor sombra (.+): tu batería aguanta (.+)$/, 'whyShadow'],
  [/^Sol durante toda la misión$/, 'whySunAll'],
  [/^Tierra visible el (.+) del tiempo \(pides (.+)\)$/, 'whyEarth'],
  [/^Sigue siendo viable aunque te retrases hasta (.+) días?$/, 'whyRobust'],
  [/^Poco margen: con medio día de retraso ya no vale$/, 'whyFragile'],
];
const LIMITS = { 'mínimo': 'min', 'máximo': 'max', 'la batería aguanta': 'battery' };

function sentence(es) {
  let body = es, limit = '';
  const m = es.match(/^(.*) \((mínimo|máximo|la batería aguanta) ([^)]+)\)$/);
  if (m) { body = m[1]; limit = ` (${t(`common.reason.limit.${LIMITS[m[2]]}`)} ${num(m[3])})`; }
  for (const [re, key] of SENTENCES) {
    const g = body.match(re);
    if (g) return t(`common.reason.${key}`, ...g.slice(1).map(num)) + limit;
  }
  return es;
}

/**
 * A verdict reason (or a rule value) of the domain in the language of the page. Several reasons come joined with
 * «; »; «Por poco: …» and «Cumple todas las reglas…» wrap one. Unknown sentences stay as they come.
 */
export function reasonText(es) {
  const s = String(es ?? '');
  if (lang === 'es' || !s) return s;
  const close = s.match(/^Por poco: (.+)$/);
  if (close) return t('common.reason.close', reasonText(close[1]));
  const ok = s.match(/^Cumple todas las reglas\. La que más aprieta: (.+)$/);
  if (ok) {
    const inner = reasonText(ok[1].charAt(0).toUpperCase() + ok[1].slice(1));
    return t('common.reason.allPass', lowerFirst(inner));
  }
  // «; » joins reasons, but a few sentences carry one inside: glue those back before translating.
  const parts = [];
  for (const p of s.split('; ')) {
    if (parts.length && /^(sale en |con el DEM de )/.test(p)) parts[parts.length - 1] += `; ${p}`;
    else parts.push(p);
  }
  return parts.map(sentence).join('; ');
}
