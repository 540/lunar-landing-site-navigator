// Explanation mode (?debug=1): a purple "?" on every element with data-explain and a side card.
// The guided tour of each view (tour.js) is its other half and opens these cards from «Saber más».
import { EXPLANATIONS, GLOSSARY, sourceToday } from './explanations.js';
import { $, esc, linkify } from './util.js';
import { state, services, currentHour } from './state.js';
import { t } from './i18n.js';

export function decorate() {
  document.querySelectorAll('[data-explain]').forEach(el => {
    if (el.querySelector(':scope > .explain-btn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'explain-btn'; b.textContent = '?';
    b.setAttribute('aria-label', t('explanations.explain', { name: EXPLANATIONS[el.dataset.explain]?.title || el.dataset.explain }));
    el.appendChild(b);
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('.explain-btn'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const el = b.parentElement;
  openCard(el.dataset.explain, el);
}, true);

// Shows the card of a key and marks the element it talks about.
export function openCard(key, el) {
  document.querySelectorAll('.highlighted').forEach(x => x.classList.remove('highlighted'));
  el?.classList.add('highlighted');
  state.card = { key, site: el?.closest('[data-site]')?.dataset.site || null };
  renderCard();
}

function liveContext(siteId) {
  const id = siteId || state.selected[0];
  const k = state.cache[id]; if (!k) return null;
  // The hourly sky comes from the mission service (only once it has loaded); the verdict and metrics, from the cache.
  const sky = services.mission?.sky(k.site, k.t0, k.result.days ?? k.result.series.length / 24);
  const series = sky?.series ?? k.result.series;
  return { ...k, horizon: sky?.horizon ?? k.site.horizon, horizonModel: services.mission?.horizonModel(id) ?? null, now: series[Math.min(currentHour(), series.length - 1)] };
}

export function renderCard() {
  if (!state.explain) return;
  const f = state.card, x = f && EXPLANATIONS[f.key];
  const glossary = `<div class="glossary"><span class="eyebrow">${t('explanations.glossary')}</span>${GLOSSARY.map(([term, d]) => `<p><b>${term}.</b> ${esc(d)}</p>`).join('')}</div>`;
  if (!x) {
    $('explain-card').innerHTML = `<span class="eyebrow">${t('explanations.mode')}</span><h2>${t('explanations.emptyTitle')}</h2>
      <p>${t('explanations.emptyText')}</p>
      <p class="hint">${t('explanations.emptyTour')}</p>
      <p class="hint">${t('explanations.emptyExitHtml')}</p>${glossary}`;
    return;
  }
  const ctx = x.live ? liveContext(f.site) : null;
  const siteText = ctx && f.site ? ` · ${esc(ctx.site.name)}` : '';
  $('explain-card').innerHTML = `<span class="eyebrow">${t('explanations.mode')}${siteText}</span><h2>${esc(x.title)}</h2>
    <dl>
      <dt>${t('explanations.what')}</dt><dd>${linkify(x.what)}</dd>
      <dt>${t('explanations.tells')}</dt><dd>${linkify(x.tells)}</dd>
      <dt>${t('explanations.demo')}</dt><dd>${linkify(sourceToday(x, services.mission?.source ?? state.dataSource))}</dd>
      <dt>${t('explanations.real')}</dt><dd>${linkify(x.real)}</dd>
      <dt>${t('explanations.calc')}</dt><dd>${linkify(x.calc)}</dd>
      <dt>${t('explanations.owner')}</dt><dd>${esc(x.owner)}</dd>
      ${ctx ? `<dt>${t('explanations.live')}</dt><dd class="live">${esc(liveText(x, ctx))}</dd>` : ''}
    </dl>${glossary}`;
}

// The hourly sky may still be loading: then the card says so instead of failing.
function liveText(x, ctx) {
  try { return x.live(ctx); } catch { return t('explanations.liveLoading'); }
}

export function hasLiveCard() {
  return !!(state.card && EXPLANATIONS[state.card.key]?.live);
}
