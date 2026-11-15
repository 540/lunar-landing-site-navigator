// The watch on your left wrist (E3, #181), as the watch of survival games: press R (or its button) and you raise your arm
// to read it; press again and it goes down. Its screen says what the panel «Luz y Tierra en la bandera» of E1 (#121)
// says, from the same pure functions: the time, the Sun and the Earth with their state and countdown, the horizon ring
// from above with where you look, and the light and the Earth over the period. Lowered, it only shows the time, dimmed.
import { UI, LANG } from './texts.js';
import { loadMask } from './region.js';
import { watchReadout, shortDuration } from './core/watch.js';
import { RING, profilePath, ringPoint } from './core/horizon-ring.js';
import { compassReading } from './core/compass.js';
import { pct } from '../../shared/format/number.js';
import { date as formatDate, time } from '../../shared/format/time.js';

const T = UI.watch; // imported once useLang() has chosen the language (main.js loads this module with the scene)
const COLOURS = { bg: '#07090b', fg: '#eceef0', muted: '#8d969f', line: 'rgba(160,175,190,.28)', sun: '#f3a83a', earth: '#5aa2f2', ground: '#3a3f46', sky: '#10161d' };
// Numbers and dates in the language of the screen (shared/format/, #343).
const clock = when => time(LANG, when).replace(' UTC', '');

/** The text of a body's countdown. */
function countdown(change) {
  if (change.type === 'set') return T.sets(shortDuration(change.hours));
  if (change.type === 'rise') return T.rises(shortDuration(change.hours));
  return change.seen ? T.noSet : T.noRise;
}

/** Everything the screen says, as text (also what the screen reader hears). */
export function watchText(r) {
  return {
    sun: T.sun[r.sun.state], sunNext: countdown(r.sun.change),
    earth: T.earth[r.earth.state], earthNext: countdown(r.earth.change),
    light: pct(LANG, r.metrics.sunTimeFraction * 100), earthTime: pct(LANG, r.metrics.earthTimeFraction * 100),
  };
}

function draw(ctx, { date, readout, mask, sky, view, awake }) {
  const { width: w, height: h } = ctx.canvas;
  ctx.save();
  ctx.fillStyle = COLOURS.bg;
  ctx.fillRect(0, 0, w, h);
  const mono = size => `500 ${size}px "JetBrains Mono", ui-monospace, monospace`;
  const sans = (size, weight = 600) => `${weight} ${size}px "Space Grotesk", "Inter", system-ui, sans-serif`;
  // A line never runs into the ring: its font shrinks until it fits.
  const TEXT_MAX = w - 180 - 14 - 56 - 10;
  const fit = (text, x, y, font, size, maxW = TEXT_MAX) => {
    let s = size;
    ctx.font = font(s);
    while (s > 10 && ctx.measureText(text).width > maxW) ctx.font = font(--s);
    ctx.fillText(text, x, y);
  };
  if (!awake) {
    // Asleep: only the time, dimmed, as a watch does with the arm down.
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = COLOURS.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = mono(84); ctx.fillText(clock(date), w / 2, h / 2 - 10);
    ctx.font = mono(24); ctx.fillStyle = COLOURS.muted; ctx.fillText('UTC', w / 2, h / 2 + 52);
    ctx.restore();
    return;
  }
  // Time and date
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = COLOURS.fg; ctx.font = mono(54); ctx.fillText(clock(date), 22, 66);
  ctx.fillStyle = COLOURS.muted; ctx.font = mono(20); ctx.fillText(`UTC · ${formatDate(LANG, date)}`, 24, 94);
  // Sun and Earth: state and countdown
  const text = readout ? watchText(readout) : null;
  const row = (y, colour, on, title, next) => {
    ctx.beginPath(); ctx.arc(34, y - 9, 11, 0, Math.PI * 2);
    ctx.fillStyle = on ? colour : 'transparent'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = colour; ctx.stroke();
    ctx.fillStyle = COLOURS.fg; fit(title, 56, y, sans, 27);
    ctx.fillStyle = COLOURS.muted; fit(next, 56, y + 27, mono, 20);
  };
  if (text) {
    row(146, COLOURS.sun, readout.sun.state !== 'hidden', text.sun, text.sunNext);
    row(214, COLOURS.earth, readout.earth.state === 'visible', text.earth, text.earthNext);
    // Period bars
    const bar = (x, label, value, colour) => {
      ctx.fillStyle = COLOURS.muted; ctx.font = mono(17); ctx.fillText(label, x, 274);
      ctx.fillStyle = COLOURS.line; ctx.fillRect(x, 284, 130, 10);
      ctx.fillStyle = colour; ctx.fillRect(x, 284, 130 * Math.max(0, Math.min(1, value)), 10);
      ctx.fillStyle = COLOURS.fg; ctx.font = mono(17); ctx.textAlign = 'right'; ctx.fillText(label === T.light ? text.light : text.earthTime, x + 130, 274); ctx.textAlign = 'left';
    };
    bar(22, T.light, readout.metrics.sunTimeFraction, COLOURS.sun);
    bar(172, T.earthBar, readout.metrics.earthTimeFraction, COLOURS.earth);
  } else {
    ctx.fillStyle = COLOURS.muted; ctx.font = mono(20); ctx.fillText(T.noData, 22, 160);
  }
  // Horizon ring from above (north up), the one of E1: relief, the Sun, the Earth and where you look.
  if (mask && sky) {
    const size = 180, x0 = w - size - 14, y0 = (h - size) / 2, k = size / RING.size;
    ctx.save();
    ctx.translate(x0, y0); ctx.scale(k, k);
    ctx.beginPath(); ctx.arc(RING.centre, RING.centre, RING.maxR, 0, Math.PI * 2); ctx.fillStyle = COLOURS.ground; ctx.fill();
    ctx.fillStyle = COLOURS.sky; ctx.fill(new Path2D(profilePath(mask)));
    if (view) {
      // where you look: a wedge from the centre
      const a = (view.heading - 90) * Math.PI / 180, half = 22 * Math.PI / 180;
      ctx.beginPath(); ctx.moveTo(RING.centre, RING.centre);
      ctx.arc(RING.centre, RING.centre, RING.maxR, a - half, a + half); ctx.closePath();
      ctx.fillStyle = 'rgba(236,238,240,.16)'; ctx.fill();
    }
    const dot = (b, colour, on) => {
      const p = ringPoint(b.az, b.el);
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = on ? colour : COLOURS.bg; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = colour; ctx.stroke();
    };
    dot(sky.earth, COLOURS.earth, readout?.earth.state === 'visible');
    dot(sky.sun, COLOURS.sun, readout ? readout.sun.state !== 'hidden' : true);
    ctx.fillStyle = COLOURS.muted; ctx.font = mono(14); ctx.textAlign = 'center'; ctx.fillText('N', RING.centre, 14);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * @param {object} view the scene, with view.foot
 * @param {{regionId:string, series:object, frame:object, instant:()=>Date, start:()=>Date, days:number, sky:()=>object}} data
 * @returns {{refresh:()=>void}} refresh: call it when the time changes
 */
export function setupWatch(view, { regionId, series: initialSeries, frame, instant, start, days, sky }) {
  const foot = view.foot, face = foot.watchFace, button = document.getElementById('watch-btn'), status = document.getElementById('foot-status');
  const ctx = face.canvas.getContext('2d');
  let series = initialSeries; // swapped when the flag moves (E2.2)
  let mask = null, lastKey = '';
  loadMask(regionId).then(m => { mask = m; lastKey = ''; refresh(); });

  function refresh() {
    if (!foot.active) return;
    const date = instant(), awake = foot.watchUp, s = foot.state(), now = sky();
    let readout = null;
    try { readout = series?.sun?.visibleFraction ? watchReadout(series, date, start(), days) : null; } catch { readout = null; }
    const heading = s && now ? compassReading({ frame, x: s.x, z: s.z, yaw: s.yaw, sun: now.sun, earth: now.earth }).heading : 0;
    // Redraw only when what it shows changes: the minute, the states, where you look (by 3°) or awake/asleep.
    const key = [Math.floor(date.getTime() / 60e3), awake, readout?.sun.state, readout?.earth.state, Math.round(heading / 3), !!mask].join('|');
    if (key === lastKey) return;
    lastKey = key;
    draw(ctx, { date, readout, mask, sky: now, view: s && { heading }, awake });
    face.changed();
    view.render();
  }

  button.setAttribute('aria-label', T.raise); button.title = T.raise;
  const paint = up => {
    button.setAttribute('aria-pressed', String(up));
    const label = up ? T.lower : T.raise;
    button.setAttribute('aria-label', label); button.title = label;
  };
  button.addEventListener('click', ev => { foot.setWatch(!foot.watchUp); if (ev.detail > 0) button.blur(); });
  foot.onWatch(up => {
    paint(up);
    lastKey = '';
    refresh();
    // What the screen says, for the screen reader, when you raise it.
    if (up && series?.sun?.visibleFraction) {
      try { const t = watchText(watchReadout(series, instant(), start(), days)); status.textContent = T.announce(clock(instant()), t); } catch { /* out of the series */ }
    }
  });
  foot.onModeChange(mode => { button.hidden = mode !== 'foot'; if (mode === 'foot') { lastKey = ''; refresh(); } });
  view.onCameraChange(refresh);
  /** The series and the mask of the flag's new point (E2.2); without a mask the profile it has stays. */
  function setSeries(next, nextMask) { series = next; if (nextMask) mask = nextMask; lastKey = ''; refresh(); }
  return { refresh, setSeries };
}
