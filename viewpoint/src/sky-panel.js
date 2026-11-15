// «Luz y Tierra en la bandera» (E1, #121): the horizon ring (E1.1, E1.2), the states with their countdown (E1.4) and the
// bars of the period (E1.3), in the exploration. Everything it says comes from series-2027.json and mask.json (core/).
import { UI, LANG } from './texts.js';
import { pct } from '../../shared/format/number.js';
import { hours, dayMonth } from '../../shared/format/time.js';
import { sampleAt, formatDeg } from './core/series.js';
import { fractionAt, sunState, earthState, nextChange, periodMetrics } from './core/sky-state.js';
import { RING, ringPoint, profilePath, circlePath, trailPaths, wedgePath } from './core/horizon-ring.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLLAPSED_KEY = 'viewpoint-sky-panel-collapsed';
let T = UI.sky; // set again by setupSkyPanel, once useLang() has chosen the language
const $ = id => document.getElementById(id);
// SVG coordinates with two decimals at most: numbers for the drawing, never text.
const coord = n => Math.round(n * 100) / 100;

/** Hours as the visitor reads them: «menos de 1 h», «14 h», «3 d 4 h» (shared/format/time.js). */
const duration = h => (h < 0.5 ? T.underHour : hours(LANG, h));

function svg(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.append(node);
  return node;
}

/** Sets a text only when it changes (the panel is updated every frame while the timeline plays). */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

const storage = {
  get() { try { return localStorage.getItem(COLLAPSED_KEY); } catch { return null; } },
  set(value) { try { localStorage.setItem(COLLAPSED_KEY, value); } catch { /* private mode: it is only a convenience */ } },
};

/** Collapsible header: open by default on wide screens, closed on phones; the choice is remembered. */
function setupToggle() {
  const panel = $('sky-panel'), btn = $('sky-panel-toggle'), body = $('sky-panel-body');
  const stored = storage.get();
  const apply = collapsed => {
    btn.setAttribute('aria-expanded', String(!collapsed));
    body.hidden = collapsed;
    panel.dataset.collapsed = String(collapsed);
  };
  apply(stored === null ? window.matchMedia('(max-width: 640px)').matches : stored === '1');
  btn.addEventListener('click', () => {
    const collapsed = btn.getAttribute('aria-expanded') === 'true';
    apply(collapsed);
    storage.set(collapsed ? '1' : '0');
  });
}

/** Draws the static part of the ring (relief, guides, cardinal points) and returns the nodes that move. */
function buildRing(root, mask) {
  const c = RING.centre;
  const defs = svg('defs', {}, root);
  const sky = svg('radialGradient', { id: 'ring-sky', cx: '50%', cy: '50%', r: '50%' }, defs);
  svg('stop', { offset: '0%', style: 'stop-color: var(--ring-sky-top)' }, sky);
  svg('stop', { offset: '100%', style: 'stop-color: var(--ring-sky)' }, sky);
  const glow = svg('radialGradient', { id: 'ring-sun-glow' }, defs);
  svg('stop', { offset: '0%', style: 'stop-color: var(--sun); stop-opacity: .55' }, glow);
  svg('stop', { offset: '100%', style: 'stop-color: var(--sun); stop-opacity: 0' }, glow);

  svg('circle', { class: 'ring__ground', cx: c, cy: c, r: RING.maxR }, root);
  const sky0 = profilePath(mask);
  const skyShape = svg('path', { class: 'ring__sky', d: sky0, fill: 'url(#ring-sky)' }, root);
  const wedge = svg('path', { class: 'ring__wedge', d: '' }, root);
  for (const el of [5, 10]) svg('path', { class: 'ring__guide', d: circlePath(el) }, root);
  svg('path', { class: 'ring__guide ring__guide--zero', d: circlePath(0) }, root);
  const profile = svg('path', { class: 'ring__profile', d: sky0 }, root);
  // Elevation of the guides, up the north axis (the dashed 0° circle is the horizon line itself).
  for (const el of [5, 10]) {
    const p = ringPoint(0, el);
    setText(svg('text', { class: 'ring__tick', x: p.x + 2, y: p.y + 2.5 }, root), `${el}°`);
  }
  const labelR = RING.maxR - 8; // in the ground band, outside the profile
  for (const [az, key] of [[0, 'n'], [90, 'e'], [180, 's'], [270, 'w']]) {
    const a = az * Math.PI / 180;
    const t = svg('text', { class: 'ring__cardinal', x: c + labelR * Math.sin(a), y: c - labelR * Math.cos(a), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, root);
    setText(t, T.cardinal[key]);
  }
  const trails = {};
  for (const body of ['sun', 'earth']) {
    trails[body] = {
      hidden: svg('path', { class: `ring__trail ring__trail--${body} is-hidden` }, root),
      seen: svg('path', { class: `ring__trail ring__trail--${body}` }, root),
    };
  }
  // The flag, at the centre: where the visitor stands.
  const flag = svg('g', { class: 'ring__flag', transform: `translate(${c} ${c})` }, root);
  svg('line', { x1: 0, y1: 4, x2: 0, y2: -7 }, flag);
  svg('path', { d: 'M0 -7h7l-2 2.5 2 2.5h-7z' }, flag);
  const earth = svg('circle', { class: 'ring__body ring__body--earth', r: 5.5, cx: c, cy: c }, root);
  const sunGroup = svg('g', { class: 'ring__body ring__body--sun' }, root);
  svg('circle', { class: 'ring__glow', r: 14, fill: 'url(#ring-sun-glow)' }, sunGroup);
  svg('circle', { class: 'ring__disc', r: 6 }, sunGroup);
  return { wedge, trails, sun: sunGroup, earth, skyShape, profile };
}

function legend(root) {
  const item = (cls, text) => {
    const span = document.createElement('span');
    span.className = `ring__key ring__key--${cls}`;
    span.textContent = text;
    root.append(span);
  };
  item('ground', T.legend.ground);
  item('trail', T.legend.trail);
  item('view', T.legend.view);
}

/**
 * @param {{series: object|null, mask: object|null}} data series-2027.json and mask.json of the region (null if missing)
 * @returns the panel: `setPeriod(start, end)` on a new start date, `update(instant)` on every change of time,
 *   `setHeading(view)` when the camera moves, `states()` for the announcement and the labels of the scene, and
 *   `setSource({series, mask})` when the flag moves (E2.2): the series over the mask of the new point.
 */
export function setupSkyPanel({ series, mask }) {
  T = UI.sky;
  $('sky-panel-title').textContent = T.panel;
  setupToggle();
  $('sky-panel').hidden = false;
  if (!series) {
    $('sky-note').textContent = T.noSeries;
    $('sky-note').hidden = false;
    for (const id of ['horizon-ring', 'sky-states', 'period-bars']) $(id).hidden = true;
    $('sky-panel').dataset.empty = 'true';
    return { setPeriod() {}, update() {}, setHeading() {}, setSource() {}, states: () => null };
  }

  let ring = null;
  if (mask) {
    ring = buildRing($('ring-svg'), mask);
    legend($('ring-legend'));
  } else {
    $('horizon-ring').hidden = true;
    $('ring-note').textContent = T.noMask;
    $('ring-note').hidden = false;
  }
  $('period-title').textContent = T.period;
  $('bar-sun-label').textContent = T.light;
  $('bar-earth-label').textContent = T.earthInView;
  $('night-label').textContent = T.longestNight;
  $('outage-label').textContent = T.longestOutage;

  let periodStart = null;
  let periodEnd = null;
  let current = null;
  let lastInstant = null;

  function setPeriod(start, end) {
    periodStart = start;
    periodEnd = end;
    const days = (end - start) / 864e5;
    const m = periodMetrics(series, start, days);
    const bar = (key, value) => {
      $(`bar-${key}-value`).textContent = pct(LANG, value * 100);
      $(`bar-${key}-fill`).style.width = `${coord(value * 100)}%`;
    };
    bar('sun', m.sunTimeFraction);
    bar('earth', m.earthTimeFraction);
    $('night-value').textContent = m.longestNightHours ? duration(m.longestNightHours) : T.none;
    $('outage-value').textContent = m.longestEarthOutageHours ? duration(m.longestEarthOutageHours) : T.none;
    $('period-range').textContent = `${dayMonth(LANG, start)} – ${dayMonth(LANG, end)}`;
    if (ring) {
      for (const body of ['sun', 'earth']) {
        const { seen, hidden } = trailPaths(series, body, start, days);
        ring.trails[body].seen.setAttribute('d', seen);
        ring.trails[body].hidden.setAttribute('d', hidden);
      }
    }
  }

  function countdown(body, instant) {
    const next = nextChange(series, body, instant, periodEnd);
    if (next.type === 'set') return T.sets(duration(next.hours));
    if (next.type === 'rise') return T.rises(duration(next.hours));
    return next.seen ? T.noSet : T.noRise;
  }

  function update(instant) {
    lastInstant = instant;
    const pos = sampleAt(series, instant);
    const sun = { ...pos.sun, fraction: fractionAt(series, 'sun', instant) };
    const earth = { ...pos.earth, fraction: fractionAt(series, 'earth', instant) };
    sun.state = sunState(sun.fraction);
    earth.state = earthState(earth.fraction);
    sun.text = T.sun[sun.state];
    earth.text = T.earth[earth.state];
    sun.when = countdown('sun', instant);
    earth.when = countdown('earth', instant);
    current = { sun, earth };
    for (const body of ['sun', 'earth']) {
      const b = current[body];
      $(`${body}-state`).dataset.state = b.state;
      setText($(`${body}-state-text`), b.text);
      setText($(`${body}-countdown`), b.when);
      $(`sky-dot-${body}`).dataset.state = b.state;
    }
    if (ring) {
      const s = ringPoint(sun.az, sun.el), e = ringPoint(earth.az, earth.el);
      ring.sun.setAttribute('transform', `translate(${coord(s.x)} ${coord(s.y)})`);
      ring.sun.dataset.state = sun.state;
      ring.earth.setAttribute('cx', coord(e.x));
      ring.earth.setAttribute('cy', coord(e.y));
      ring.earth.dataset.state = earth.state;
    }
  }

  /** Describes the ring for screen readers: only on discrete actions, like the announcement of the timeline. */
  function describe() {
    if (!ring || !current) return;
    const { sun, earth } = current;
    $('ring-svg').setAttribute('aria-label', T.ring(sun.text, formatDeg(sun.az, LANG), formatDeg(sun.el, LANG), earth.text, formatDeg(earth.az, LANG), formatDeg(earth.el, LANG)));
  }

  function setHeading(view) {
    if (!ring || !view?.heading) return;
    const { az, halfDeg } = view.heading();
    ring.wedge.setAttribute('d', wedgePath(az, halfDeg));
  }

  /**
   * The flag has moved (E2.2): draws again the profile of the ring and, over the new series, the trails, the bars, the states
   * and the countdown. `mask` is the one of the point; without it the profile of the catalogue stays.
   */
  function setSource(next) {
    series = next.series;
    if (ring && next.mask) {
      const d = profilePath(next.mask);
      ring.skyShape.setAttribute('d', d);
      ring.profile.setAttribute('d', d);
    }
    if (periodStart) setPeriod(periodStart, periodEnd);
    if (lastInstant) update(lastInstant);
  }

  return { setPeriod, update, setHeading, describe, setSource, states: () => current };
}
