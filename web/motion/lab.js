// Motion lab: eight motion proposals running on the real (fake-data) engine of the app.
// Each create* function is written to be lifted into its view; see the table at the end of index.html.
import * as M from '../js/engine/model.js';
import * as S from '../js/engine/search.js';
import { SITES, PROFILES } from '../js/engine/catalog.js';
import { $, css, esc, verdictColor } from '../js/common/util.js';
// Durations and dates from shared/format through common/i18n.js (#343): «2 d 3 h», «15 ene 2027 · 00:00 UTC».
import { fmtHours, fmtDateTime as fmtDate } from '../js/common/i18n.js';
import { VERDICT_TONE } from '../js/common/theme.js';
import { ease, tween, animatedValue, countTo, replay, flip, viewTransition, createPlayer, mix } from './motion.js';

SITES.forEach(s => { s.horizon = M.computeHorizon(s); });
const POLAR = SITES.filter(s => !s.offMap);
const siteById = id => SITES.find(s => s.id === id);
const WINDOW = { from: Date.parse('2027-03-25T00:00:00Z'), to: Date.parse('2027-05-10T12:00:00Z') };
const PLAN_T0 = Date.parse('2027-03-29T12:00:00Z'); // best landing for the default profile
const DAY = 864e5, HOUR = 36e5, TAU = 2 * Math.PI;

// Canvas colours, read from the design system tokens (styles/tokens.css).
const TOKEN = { ink: 'text', muted: 'text-muted', line: 'border', panel: 'surface', 'panel-2': 'surface-raised', sky: 'sunken', regolith: 'terrain', sun: 'sun', earth: 'earth', ok: 'ok', warn: 'warn', bad: 'bad' };
const C = Object.fromEntries(Object.entries(TOKEN).map(([k, t]) => [k, css('--color-' + t)]));
// Verdict badge: same look as UI.verdict in the views.
const setVerdict = (el, code, extra = '') => { el.className = 'badge badge--pill' + extra; el.dataset.tone = VERDICT_TONE[code]; };
const FONT = { data: css('--font-data'), display: css('--font-display'), body: css('--font-body') };

const searches = {};
function searchFor(profileId) {
  const p = PROFILES.find(x => x.id === profileId);
  return searches[profileId] ??= S.search({ sites: POLAR, ...WINDOW, days: p.days, batteryHours: p.batteryHours, minEarthPct: p.minEarthPct, profile: p.id });
}

// Sizes a canvas to its CSS width (only when it changes) and returns a context in CSS pixels.
function fitCanvas(cv, height) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth || 300;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(height * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(height * dpr); cv.style.height = height + 'px'; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, height);
  return { ctx, w, h: height };
}
// Runs `fn` the first time the element scrolls into view.
function onVisible(el, fn) {
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold: 0.2 });
  io.observe(el);
}
const pct = n => Math.round(n) + ' %';
const hours = n => fmtHours(Math.round(n));
const replays = {};

// =====================================================================
// 1. Lunar clock: the search sweeps the month, the mission arc glides
// =====================================================================
function createClock(cv, { onDrag }) {
  const SIZE = 460, CEN = SIZE / 2, HOURS = 720, ARC_R = CEN - 112;
  const angle = h => -Math.PI / 2 + (h / HOURS) * TAU;
  const s = { sun: new Uint8Array(HOURS), earth: new Uint8Array(HOURS), start: 0, days: 10, landing: 0, verdict: null, sweep: 1, tested: 0, colorFrom: C.ok, colorTo: C.ok };
  const arcStart = animatedValue(0, { ms: 420, easing: ease.spring }, draw);
  const arcLength = animatedValue(0, { ms: 520 }, draw);
  const colorMix = animatedValue(1, { ms: 320, easing: ease.standard }, draw);
  const ripple = animatedValue(1, { ms: 750 }, draw);
  const centre = animatedValue(1, { ms: 320 }, draw);
  let cancelSweep = null;

  function ring(ctx, radius, width, arr, color, limit) {
    ctx.lineWidth = width; ctx.lineCap = 'butt';
    ctx.strokeStyle = C['panel-2']; ctx.beginPath(); ctx.arc(CEN, CEN, radius, 0, TAU); ctx.stroke();
    ctx.strokeStyle = color;
    let i = 0;
    while (i < limit) {
      if (!arr[i]) { i++; continue; }
      let j = i; while (j < limit && arr[j]) j++;
      ctx.beginPath(); ctx.arc(CEN, CEN, radius, angle(i), angle(Math.min(j, limit))); ctx.stroke(); i = j;
    }
  }

  function draw() {
    const dpr = devicePixelRatio || 1;
    if (cv.width !== SIZE * dpr) cv.width = cv.height = SIZE * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, SIZE, SIZE);
    const limit = s.sweep * HOURS;
    ring(ctx, CEN - 46, 26, s.sun, C.sun, limit);
    ring(ctx, CEN - 78, 16, s.earth, C.earth, limit);

    // Day ticks and dates
    ctx.strokeStyle = C.muted; ctx.fillStyle = C.muted; ctx.lineWidth = 1; ctx.font = '10px ' + FONT.data; ctx.textAlign = 'center';
    for (let day = 0; day < 30; day++) {
      const a = angle(day * 24), r1 = CEN - 30, r2 = CEN - (day % 5 === 0 ? 22 : 26);
      ctx.beginPath(); ctx.moveTo(CEN + Math.cos(a) * r1, CEN + Math.sin(a) * r1); ctx.lineTo(CEN + Math.cos(a) * r2, CEN + Math.sin(a) * r2); ctx.stroke();
      if (day % 5 === 0) {
        const d = new Date(s.start + day * DAY), label = `${d.getUTCDate()} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getUTCMonth()]}`;
        ctx.fillText(label, CEN + Math.cos(a) * (CEN - 10), CEN + Math.sin(a) * (CEN - 10) + 4);
      }
    }

    // Sweep hand with a short glow behind it
    if (s.sweep < 1) {
      const a = angle(limit), tail = 0.7;
      const g = ctx.createConicGradient(a - tail, CEN, CEN);
      g.addColorStop(0, mix(C.ink, C.ink, 0, 0)); g.addColorStop(tail / TAU, mix(C.ink, C.ink, 0, 0.25));
      g.addColorStop(tail / TAU + 0.001, mix(C.ink, C.ink, 0, 0)); g.addColorStop(1, mix(C.ink, C.ink, 0, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CEN, CEN, CEN - 32, 0, TAU); ctx.arc(CEN, CEN, CEN - 88, 0, TAU, true); ctx.fill('evenodd');
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(CEN + Math.cos(a) * (CEN - 96), CEN + Math.sin(a) * (CEN - 96)); ctx.lineTo(CEN + Math.cos(a) * (CEN - 28), CEN + Math.sin(a) * (CEN - 28)); ctx.stroke();
    }

    // Mission arc, its ripple and its handle
    const color = mix(s.colorFrom, s.colorTo, colorMix.v);
    const a0 = angle(arcStart.v), a1 = angle(arcStart.v + arcLength.v);
    if (arcLength.v > 0.5) {
      ctx.lineCap = 'round'; ctx.strokeStyle = color;
      if (ripple.v < 1) { ctx.globalAlpha = (1 - ripple.v) * 0.45; ctx.lineWidth = 14 + 30 * ripple.v; ctx.beginPath(); ctx.arc(CEN, CEN, ARC_R, a0, a1); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(CEN, CEN, ARC_R, a0, a1); ctx.stroke();
      ctx.beginPath(); ctx.arc(CEN + Math.cos(a0) * ARC_R, CEN + Math.sin(a0) * ARC_R, 10, 0, TAU);
      ctx.fillStyle = C.panel; ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
    }

    // Centre: the count while searching, the answer afterwards
    if (s.sweep < 1) {
      ctx.fillStyle = C.muted; ctx.font = '600 11px ' + FONT.data; ctx.fillText('PROBANDO ATERRIZAJES', CEN, CEN - 26);
      ctx.fillStyle = C.ink; ctx.font = '500 34px ' + FONT.data; ctx.fillText(String(Math.round(s.tested * s.sweep)), CEN, CEN + 12);
      ctx.fillStyle = C.muted; ctx.font = '12px ' + FONT.data; ctx.fillText('en 5 sitios', CEN, CEN + 36);
    } else if (s.verdict) {
      ctx.globalAlpha = centre.v;
      ctx.fillStyle = C.muted; ctx.font = '600 11px ' + FONT.data; ctx.fillText('ATERRIZAJE', CEN, CEN - 34);
      ctx.fillStyle = C.ink; ctx.font = '500 16px ' + FONT.data; ctx.fillText(fmtDate(s.landing), CEN, CEN - 12);
      ctx.fillStyle = color; ctx.font = '700 30px ' + FONT.display; ctx.fillText(s.verdict.title, CEN, CEN + 24);
      ctx.fillStyle = C.muted; ctx.font = '12px ' + FONT.data; ctx.fillText(`${String(s.days).replace('.', ',')} días de misión`, CEN, CEN + 46);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'start';
  }

  // Pointer drag: the day under the pointer becomes the delay.
  let dragging = false;
  const dayAt = e => {
    const r = cv.getBoundingClientRect();
    let a = Math.atan2((e.clientY - r.top) * SIZE / r.height - CEN, (e.clientX - r.left) * SIZE / r.width - CEN) + Math.PI / 2;
    if (a < 0) a += TAU;
    return Math.round((a / TAU) * 30) % 30;
  };
  cv.addEventListener('pointerdown', e => { dragging = true; cv.setPointerCapture(e.pointerId); onDrag(dayAt(e)); });
  cv.addEventListener('pointermove', e => { if (dragging) onDrag(dayAt(e)); });
  cv.addEventListener('pointerup', () => { dragging = false; });
  cv.addEventListener('pointercancel', () => { dragging = false; });

  return {
    draw,
    // The search: the hand sweeps the month, then the arc unfolds. Resolves when the sweep ends.
    reveal({ site, landing, days, verdict, tested }) {
      cancelSweep?.();
      for (let h = 0; h < HOURS; h++) { const k = M.sky(site, landing + h * HOUR); s.sun[h] = k.sun.margin > 0; s.earth[h] = k.earth.margin > 0; }
      Object.assign(s, { start: landing, landing, days, verdict, tested, sweep: 0, colorFrom: verdictColor(verdict.code), colorTo: verdictColor(verdict.code) });
      colorMix.set(1); arcStart.set(0); arcLength.set(0); centre.set(0); ripple.set(1);
      return new Promise(resolve => {
        cancelSweep = tween({ ms: 760, easing: ease.standard, step: v => { s.sweep = v; draw(); }, done: () => {
          s.sweep = 1; arcLength.to(days * 24); centre.to(1); ripple.set(0); ripple.to(1); resolve();
        } });
      });
    },
    // The delay changed: the arc glides; if the verdict changed, the colour fades and a ripple goes out.
    move(delayDays, verdict, landing, isDrag) {
      s.landing = landing;
      if (verdict.code !== s.verdict.code) {
        s.colorFrom = mix(s.colorFrom, s.colorTo, colorMix.v); s.colorTo = verdictColor(verdict.code);
        colorMix.set(0); colorMix.to(1); ripple.set(0); ripple.to(1);
      }
      s.verdict = verdict;
      arcStart.to(delayDays * 24, isDrag ? { ms: 140, easing: ease.out } : {});
      draw();
    },
  };
}

const d1 = { profile: PROFILES[0], option: null, delay: 0, run: 0 };
const clock = createClock($('d1-clock'), { onDrag: day => setDelay(day, true) });

function renderD1Profiles() {
  $('d1-profiles').innerHTML = PROFILES.map(p => `<button type="button" class="option" role="radio" aria-checked="${p.id === d1.profile.id}" data-id="${p.id}"><b>${esc(p.name)}</b><span>${String(p.days).replace('.', ',')} días · aguanta ${p.batteryHours} h sin Sol · Tierra ≥ ${p.minEarthPct} %</span></button>`).join('');
}
function evaluateD1() {
  const p = d1.profile, t0 = d1.option.landing + d1.delay * DAY, result = M.evaluate(d1.option.site, t0, p.days, 1);
  return { t0, result, verdict: M.verdict(result, p) };
}
function paintD1(e, { flash = false, ms = 350, fromZero = false } = {}) {
  const p = d1.profile, r = e.result, pill = $('d1-verdict');
  $('d1-date').textContent = 'Aterrizaje ' + fmtDate(e.t0);
  if (pill.dataset.code !== e.verdict.code) {
    setVerdict(pill, e.verdict.code, ' badge--large'); pill.textContent = e.verdict.title; pill.dataset.code = e.verdict.code;
    if (flash) replay(pill, 'motion-flash');
  }
  $('d1-reason').textContent = e.verdict.reason;
  const figure = (id, value, format, ok) => {
    const el = $(id); if (fromZero) el._value = 0;
    countTo(el, value, { format, ms }); el.className = ok ? 'text-ok' : 'text-bad';
  };
  figure('d1-sun', r.pctSun, pct, r.maxDarkHours <= p.batteryHours);
  figure('d1-dark', r.maxDarkHours, hours, r.maxDarkHours <= p.batteryHours);
  figure('d1-earth', r.pctEarth, pct, r.pctEarth >= p.minEarthPct);
  $('d1-dark-req').textContent = `aguanta ${p.batteryHours} h`; $('d1-earth-req').textContent = `pides ${p.minEarthPct} %`;
}
async function runSearch() {
  const res = searchFor(d1.profile.id), run = ++d1.run, body = $('d1-body');
  d1.option = res.best; d1.delay = 0; $('d1-delay').value = 0; $('d1-delay-value').textContent = '+0 días';
  const e = evaluateD1();
  body.classList.add('is-pending');
  countTo($('d1-tested'), res.tested, { from: 0, ms: 760 });
  await clock.reveal({ site: res.best.site, landing: res.best.landing, days: d1.profile.days, verdict: e.verdict, tested: res.tested });
  if (run !== d1.run) return;
  $('d1-site').textContent = res.best.site.name;
  $('d1-verdict').dataset.code = '';
  paintD1(e, { ms: 700, fromZero: true });
  body.classList.remove('is-pending');
  [...body.children].forEach((el, i) => { el.style.setProperty('--i', i); replay(el, 'motion-enter'); });
  $('d1-verdict').style.setProperty('--i', 4); replay($('d1-verdict'), 'motion-stamp');
}
function setDelay(days, isDrag = false) {
  if (!d1.option || days === d1.delay) return;
  d1.delay = days; $('d1-delay').value = days; $('d1-delay-value').textContent = `+${days} días`;
  const e = evaluateD1();
  clock.move(days, e.verdict, e.t0, isDrag);
  paintD1(e, { flash: true });
}
$('d1-profiles').addEventListener('click', e => {
  const b = e.target.closest('.option'); if (!b) return;
  d1.profile = PROFILES.find(p => p.id === b.dataset.id); renderD1Profiles();
});
$('d1-run').addEventListener('click', runSearch);
$('d1-delay').addEventListener('input', () => setDelay(+$('d1-delay').value));
replays.search = runSearch;

// =====================================================================
// 2. Living sky: continuous playback, bodies set behind the terrain
// =====================================================================
function createSky(cv, band, { onState, onHour }) {
  const HEIGHT = 260, BAND_H = 34, TRAIL_H = 36, pad = { l: 30, r: 8, t: 10, b: 20 };
  const s = { site: null, result: null, t0: 0, days: 10, hour: 0, yMax: 6, visible: null, label: null };
  const lit = animatedValue(1, { ms: 450, easing: ease.standard }, draw);
  const labelAlpha = animatedValue(0, { ms: 1900, easing: ease.in }, draw);
  const yMin = -3;

  const horizonSmooth = az => { const m = s.site.horizon.mask, i = Math.floor(az) % 360, f = az - Math.floor(az); return m[i] + (m[(i + 1) % 360] - m[i]) * f; };
  // Sky at a fractional hour: linear between the hourly samples, azimuth by the short way round.
  function sample(h) {
    const n = s.result.series.length - 1, i = Math.max(0, Math.min(Math.floor(h), n - 1)), f = Math.max(0, Math.min(1, h - i)), a = s.result.series[i], b = s.result.series[i + 1];
    const body = k => {
      const d = ((b[k].az - a[k].az + 540) % 360) - 180, az = (a[k].az + d * f + 360) % 360, el = a[k].el + (b[k].el - a[k].el) * f, horizon = horizonSmooth(az);
      return { az, el, horizon, margin: el - horizon };
    };
    return { sun: body('sun'), earth: body('earth') };
  }

  function draw() {
    if (!s.result) return;
    const { ctx, w, h } = fitCanvas(cv, HEIGHT);
    const X = az => pad.l + (az / 360) * (w - pad.l - pad.r);
    const Y = el => pad.t + (1 - (Math.max(yMin, Math.min(s.yMax, el)) - yMin) / (s.yMax - yMin)) * (h - pad.t - pad.b);
    const now = sample(s.hour);

    // Grid
    ctx.font = '10px ' + FONT.data; ctx.fillStyle = C.muted; ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    const step = s.yMax > 30 ? 20 : s.yMax > 12 ? 5 : 2;
    for (let e = Math.ceil(yMin / step) * step; e <= s.yMax; e += step) { ctx.beginPath(); ctx.moveTo(pad.l, Y(e)); ctx.lineTo(w - pad.r, Y(e)); ctx.stroke(); ctx.fillText(e + '°', 2, Y(e) + 3); }
    [['N', 0], ['E', 90], ['S', 180], ['O', 270], ['N', 360]].forEach(([t, a]) => ctx.fillText(t, X(a) - 3, h - 5));

    // Whole-mission path (faint) and the trail of the last hours (fading)
    for (const [k, col] of [['sun', C.sun], ['earth', C.earth]]) {
      ctx.fillStyle = col; ctx.globalAlpha = 0.28;
      s.result.series.forEach((c, i) => { if (i % 2 === 0) ctx.fillRect(X(c[k].az) - 0.8, Y(c[k].el) - 0.8, 1.6, 1.6); });
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = 'round';
      let prev = null;
      for (let t = Math.max(0, s.hour - TRAIL_H); t <= s.hour; t += 0.5) {
        const p = sample(t)[k], x = X(p.az), y = Y(p.el);
        if (prev && Math.abs(x - prev.x) < w / 3) { ctx.globalAlpha = 0.85 * Math.pow(1 - (s.hour - t) / TRAIL_H, 1.6); ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, y); ctx.stroke(); }
        prev = { x, y };
      }
      ctx.globalAlpha = 1;
    }

    // Bodies, drawn before the terrain so they really go behind it
    const disc = (b, col, radius, glow) => {
      const x = X(b.az), y = Y(b.el), g = ctx.createRadialGradient(x, y, 0, x, y, glow);
      g.addColorStop(0, mix(col, col, 0, 0.5)); g.addColorStop(1, mix(col, col, 0, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, glow, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
    };
    disc(now.sun, C.sun, 7, 34); disc(now.earth, C.earth, 5.5, 18);

    // Terrain: lit while the Sun is up, dark when it hides (the lunar sky itself is always black)
    const terrain = () => { ctx.beginPath(); ctx.moveTo(X(0), Y(yMin)); for (let a = 0; a <= 360; a++) ctx.lineTo(X(a), Y(s.site.horizon.mask[a % 360])); ctx.lineTo(X(360), Y(yMin)); ctx.closePath(); };
    ctx.fillStyle = mix(mix(C.regolith, C.sky, 0.6), mix(C.regolith, C.ink, 0.1), lit.v); terrain(); ctx.fill();
    // Grazing light on the ridge line under the Sun
    if (lit.v > 0.01) {
      const x = X(now.sun.az), g = ctx.createLinearGradient(x - 110, 0, x + 110, 0);
      g.addColorStop(0, mix(C.sun, C.sun, 0, 0)); g.addColorStop(0.5, mix(C.sun, C.sun, 0, 0.75 * lit.v)); g.addColorStop(1, mix(C.sun, C.sun, 0, 0));
      ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let a = 0; a <= 360; a++) { const px = X(a), py = Y(s.site.horizon.mask[a % 360]); a ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
    }

    // A hidden body keeps a dashed outline over the terrain
    for (const [b, col, radius] of [[now.sun, C.sun, 7], [now.earth, C.earth, 5.5]]) {
      if (b.margin > 0) continue;
      ctx.setLineDash([3, 3]); ctx.strokeStyle = mix(col, col, 0, 0.8); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(b.az), Y(b.el), radius, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }

    // Event label: «Se pone el Sol · +1 d 1 h»
    if (s.label && labelAlpha.v > 0.01) {
      ctx.font = '600 11px ' + FONT.data; ctx.globalAlpha = Math.min(1, labelAlpha.v * 1.6);
      const tw = ctx.measureText(s.label.text).width, lx = Math.max(pad.l + 4, Math.min(w - pad.r - tw - 12, X(s.label.az) - tw / 2)), ly = Math.max(pad.t + 16, Y(s.label.el) - 22);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.beginPath(); ctx.roundRect(lx - 6, ly - 13, tw + 12, 19, 4); ctx.fill();
      ctx.fillStyle = s.label.color; ctx.fillText(s.label.text, lx, ly);
      ctx.globalAlpha = 1;
    }
    drawBand();
  }

  // Time band: when there is Sun and when there is Earth, with the playhead on top.
  function drawBand() {
    const { ctx, w } = fitCanvas(band, BAND_H), n = s.result.series.length - 1, inner = w - pad.l - pad.r;
    const row = (k, col, y) => {
      ctx.fillStyle = C['panel-2']; ctx.beginPath(); ctx.roundRect(pad.l, y, inner, 10, 3); ctx.fill();
      ctx.fillStyle = col;
      let i = 0;
      while (i <= n) {
        if (s.result.series[i][k].margin <= 0) { i++; continue; }
        let j = i; while (j <= n && s.result.series[j][k].margin > 0) j++;
        ctx.beginPath(); ctx.roundRect(pad.l + (i / n) * inner, y, Math.max(2, ((Math.min(j, n) - i) / n) * inner), 10, 3); ctx.fill(); i = j;
      }
    };
    row('sun', C.sun, 4); row('earth', C.earth, 20);
    const x = pad.l + (s.hour / (s.days * 24)) * inner;
    ctx.fillStyle = C.ink; ctx.fillRect(x - 1, 0, 2, BAND_H); ctx.beginPath(); ctx.arc(x, 2, 4, 0, TAU); ctx.fill();
    band.setAttribute('aria-valuemax', s.days * 24); band.setAttribute('aria-valuenow', Math.round(s.hour));
  }

  function setHour(h, announce) {
    const wrapped = h < s.hour; s.hour = h;
    const now = sample(h), visible = { sun: now.sun.margin > 0, earth: now.earth.margin > 0 }, prev = s.visible;
    s.visible = visible;
    if (!prev || prev.sun !== visible.sun) { if (prev && !wrapped) lit.to(visible.sun ? 1 : 0); else lit.set(visible.sun ? 1 : 0); }
    for (const k of ['sun', 'earth']) {
      if (!prev || prev[k] === visible[k]) continue;
      if (announce && !wrapped) {
        const text = k === 'sun' ? (visible.sun ? 'Sale el Sol' : 'Se pone el Sol') : (visible.earth ? 'Vuelve la Tierra' : 'Se pierde la Tierra');
        s.label = { text: `${text} · +${hours(h)}`, az: now[k].az, el: now[k].el, color: k === 'sun' ? C.sun : C.earth };
        labelAlpha.set(1); labelAlpha.to(0);
      }
    }
    onState(visible, prev, now);
    onHour(h, s.t0 + h * HOUR);
    draw();
  }

  return {
    draw, setHour,
    get maxHour() { return s.days * 24; },
    load(site, t0, days) {
      const result = M.evaluate(site, t0, days, 1);
      let yMax = 6;
      for (const c of result.series) yMax = Math.max(yMax, c.sun.el + 1, c.earth.el + 1);
      for (let a = 0; a < 360; a++) yMax = Math.max(yMax, site.horizon.mask[a] + 1);
      Object.assign(s, { site, result, t0, days, yMax: Math.min(90, Math.ceil(yMax)), visible: null, label: null, hour: 0 });
      setHour(0, false);
    },
    hourAt(clientX) { const r = band.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left - pad.l) / (r.width - pad.l - pad.r))) * s.days * 24; },
  };
}

const SKY_CASES = [
  { label: 'Malapert: el Sol se pone', site: 'malapert', t0: PLAN_T0 },
  { label: 'Ladera: amanece al 4.º día', site: 'ridge-slope', t0: PLAN_T0 },
  { label: 'Cresta con +8 días de retraso', site: 'connecting-ridge', t0: PLAN_T0 + 8 * DAY },
];
const statePill = (el, on, yes, no, flash) => {
  const code = on ? 'viable' : 'not_viable';
  if (el.dataset.code === code) return;
  setVerdict(el, code); el.dataset.code = code; el.textContent = on ? yes : no;
  if (flash) replay(el, 'motion-flash');
};
const sky = createSky($('d2-sky'), $('d2-band'), {
  onState: (v, prev) => { statePill($('d2-sun-state'), v.sun, 'Sol: luz', 'Sol: sombra', !!prev); statePill($('d2-earth-state'), v.earth, 'Tierra: comunicación', 'Tierra: sin enlace', !!prev); },
  onHour: (h, ms) => { $('d2-time').textContent = `+${hours(Math.floor(h))} · ${fmtDate(ms)}`; },
});
const skyPlayer = createPlayer({ max: () => sky.maxHour, hoursPerSecond: 16, onTick: h => sky.setHour(h, true), onToggle: on => { $('d2-play').textContent = on ? '❚❚' : '▶'; } });
function loadSkyCase(i) {
  const c = SKY_CASES[i];
  [...$('d2-cases').children].forEach((b, j) => b.setAttribute('aria-pressed', j === i));
  skyPlayer.stop(); sky.load(siteById(c.site), c.t0, 10); skyPlayer.seek(0);
}
$('d2-cases').innerHTML = SKY_CASES.map((c, i) => `<button type="button" data-i="${i}">${esc(c.label)}</button>`).join('');
$('d2-cases').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { loadSkyCase(+b.dataset.i); skyPlayer.toggle(); } });
$('d2-play').addEventListener('click', () => skyPlayer.toggle());
(() => {
  const band = $('d2-band'); let scrubbing = false;
  const scrub = e => { skyPlayer.stop(); skyPlayer.seek(sky.hourAt(e.clientX)); };
  band.addEventListener('pointerdown', e => { scrubbing = true; band.setPointerCapture(e.pointerId); scrub(e); });
  band.addEventListener('pointermove', e => { if (scrubbing) scrub(e); });
  band.addEventListener('pointerup', () => { scrubbing = false; });
  band.addEventListener('keydown', e => {
    const jump = { ArrowLeft: -1, ArrowRight: 1, PageDown: -24, PageUp: 24 }[e.key];
    if (jump) { e.preventDefault(); skyPlayer.stop(); skyPlayer.seek(skyPlayer.hour + jump); }
  });
})();

// =====================================================================
// 3. Map: shadows cross-fade, Sun and Earth circle the rim, pings
// =====================================================================
function createMap(cv, { onPoint }) {
  const SIZE = 360, CEN = SIZE / 2, R = 160, RADIUS_KM = 190, SCALE = R / RADIUS_KM, RIM = R + 10;
  const N = 84, KEY_HOURS = 3; // shadow keyframes: an N×N grid every 3 mission hours, blended in between
  const toPx = (x, y) => ({ px: CEN + x * SCALE, py: CEN - y * SCALE });
  const toKm = (px, py) => ({ x: (px - CEN) / SCALE, y: (CEN - py) / SCALE });
  const s = { t0: PLAN_T0, hour: 0, req: PROFILES[0], points: [], pings: [], running: false };
  const frames = new Map(), queue = []; let job = null;
  const layer = Object.assign(document.createElement('canvas'), { width: N, height: N }), layerCtx = layer.getContext('2d'), layerImg = layerCtx.createImageData(N, N);
  for (let p = 0; p < N * N; p++) { layerImg.data[p * 4] = 5; layerImg.data[p * 4 + 1] = 8; layerImg.data[p * 4 + 2] = 20; }

  const terrain = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  (() => {
    const ctx = terrain.getContext('2d'), img = ctx.createImageData(SIZE, SIZE);
    for (let py = 0; py < SIZE; py++) for (let px = 0; px < SIZE; px++) {
      const { x, y } = toKm(px, py);
      if (Math.hypot(x, y) > RADIUS_KM) continue;
      const h = M.elevation(x, y), shade = Math.max(0, Math.min(1, 0.55 - 1.6 * (M.elevation(x + 1, y) - h) + 1.6 * (M.elevation(x, y + 1) - h) + h * 0.04));
      const g = 38 + shade * 95, i = (py * SIZE + px) * 4;
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g + 4; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  })();

  const verdictAt = site => M.verdict(M.evaluate(site, s.t0, s.req.days, 2), s.req);
  const sites = POLAR.map(site => ({ site, verdict: verdictAt(site) }));

  // Shadow keyframes are computed a few rows per animation frame, so playback never stalls.
  const request = (k, urgent) => { if (k < 0 || frames.has(k) || job?.k === k || queue.includes(k)) return; urgent ? queue.unshift(k) : queue.push(k); };
  function work(budgetMs) {
    const end = performance.now() + budgetMs;
    while (performance.now() < end) {
      if (!job) { if (!queue.length) return; const k = queue.shift(); job = { k, row: 0, data: new Uint8Array(N * N), sub: M.subpoints(s.t0 + k * KEY_HOURS * HOUR).sun }; }
      for (let i = 0; i < N; i++) {
        const x = ((i + 0.5) / N * 2 - 1) * RADIUS_KM, y = (1 - (job.row + 0.5) / N * 2) * RADIUS_KM;
        if (Math.hypot(x, y) <= RADIUS_KM && M.visibleAtPoint(x, y, job.sub) <= 0) job.data[job.row * N + i] = 1;
      }
      if (++job.row === N) { frames.set(job.k, job.data); job = null; }
    }
  }
  function nearestFrame(k) { for (let i = k; i >= 0; i--) if (frames.has(i)) return frames.get(i); return null; }

  function draw(now) {
    const dpr = devicePixelRatio || 1;
    if (cv.width !== SIZE * dpr) cv.width = cv.height = SIZE * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save(); ctx.beginPath(); ctx.arc(CEN, CEN, R, 0, TAU); ctx.clip();
    ctx.drawImage(terrain, 0, 0);
    const k = s.hour / KEY_HOURS, k0 = Math.floor(k), f = k - k0, a = nearestFrame(k0), b = frames.get(k0 + 1) || a;
    if (a) {
      for (let p = 0; p < N * N; p++) layerImg.data[p * 4 + 3] = 175 * (a[p] * (1 - f) + b[p] * f);
      layerCtx.putImageData(layerImg, 0, 0); ctx.imageSmoothingEnabled = true; ctx.filter = 'blur(1.5px)'; ctx.drawImage(layer, CEN - R, CEN - R, 2 * R, 2 * R); ctx.filter = 'none';
    }
    ctx.restore();

    // Latitude rings and crater names
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; ctx.lineWidth = 1;
    for (let g = 2; g <= 6; g += 2) { ctx.beginPath(); ctx.arc(CEN, CEN, g * M.KM_PER_DEGREE * SCALE, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; ctx.font = 'italic 9px ' + FONT.body; ctx.textAlign = 'center';
    for (const c of M.FEATURES.craters) { const { px, py } = toPx(c.x, c.y); ctx.fillText(c.name, px, py + 3); }

    // Rim: where the Sun and the Earth are right now
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.arc(CEN, CEN, RIM, 0, TAU); ctx.stroke();
    const sub = M.subpoints(s.t0 + s.hour * HOUR);
    const onRim = (lon, col, radius, glow) => {
      const x = CEN + Math.sin(lon * Math.PI / 180) * RIM, y = CEN - Math.cos(lon * Math.PI / 180) * RIM;
      const g = ctx.createRadialGradient(x, y, 0, x, y, glow); g.addColorStop(0, mix(col, col, 0, 0.55)); g.addColorStop(1, mix(col, col, 0, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, glow, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
    };
    onRim(sub.earth.lon, C.earth, 4, 10); onRim(sub.sun.lon, C.sun, 5.5, 16);

    // Sites and custom points
    ctx.font = '600 10px ' + FONT.body; ctx.textAlign = 'start';
    for (const { site, verdict, label } of [...sites.slice(1), ...s.points, sites[0]]) { // the plan goes last, on top
      const m = M.toMap(site.lat, site.lon), { px, py } = toPx(m.x, m.y);
      ctx.beginPath(); ctx.arc(px, py, 5, 0, TAU); ctx.fillStyle = verdictColor(verdict.code); ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = '#fff'; ctx.stroke();
      const text = label || (site.id === 'connecting-ridge' ? 'Plan' : '');
      if (text) { const tw = ctx.measureText(text).width, tx = Math.min(SIZE - tw - 6, px + 9); ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(tx - 3, py - 8, tw + 6, 14); ctx.fillStyle = '#fff'; ctx.fillText(text, tx, py + 3); }
    }
    // Pings: one expanding ring where something just happened
    s.pings = s.pings.filter(p => now - p.start < 900);
    for (const p of s.pings) {
      const t = Math.max(0, (now - p.start) / 900), e = ease.out(t);
      if (now < p.start) continue;
      ctx.globalAlpha = (1 - t) * 0.9; ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.px, p.py, 6 + 24 * e, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  function loop(now) {
    work(6); draw(now);
    if (s.pings.length || queue.length || job) requestAnimationFrame(loop); else s.running = false;
  }
  const wake = () => { if (!s.running) { s.running = true; requestAnimationFrame(loop); } };
  function ping(site, color, delay = 0) {
    if (document.documentElement.dataset.motion === 'off') return;
    const m = M.toMap(site.lat, site.lon); s.pings.push({ ...toPx(m.x, m.y), color, start: performance.now() + delay }); wake();
  }

  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect(), { x, y } = toKm((e.clientX - r.left) * SIZE / r.width, (e.clientY - r.top) * SIZE / r.height);
    if (Math.hypot(x, y) > RADIUS_KM) return;
    const site = M.fromMap(x, y); site.horizon = M.computeHorizon(site);
    const point = { site, verdict: verdictAt(site), label: `Punto ${s.points.length + 1}` };
    s.points.push(point); if (s.points.length > 3) s.points.shift();
    ping(site, verdictColor(point.verdict.code)); onPoint(point);
  });

  return {
    get maxHour() { return s.req.days * 24; },
    setHour(h) {
      s.hour = h;
      const k = Math.floor(h / KEY_HOURS); request(k + 1, true); request(k, true);
      for (let i = 2; i <= 8; i++) if ((k + i) * KEY_HOURS <= s.req.days * 24 + KEY_HOURS) request(k + i);
      wake(); if (s.running && !s.pings.length && !queue.length && !job) draw(performance.now());
    },
    pingPlan() { const plan = sites[0]; ping(plan.site, verdictColor(plan.verdict.code)); ping(plan.site, verdictColor(plan.verdict.code), 350); },
  };
}
const map = createMap($('d3-map'), { onPoint: p => { $('d3-point').innerHTML = `${esc(p.label)} (${p.site.lat.toFixed(2)}°, ${p.site.lon.toFixed(1)}°): <span class="badge badge--pill motion-flash" data-tone="${VERDICT_TONE[p.verdict.code]}">${p.verdict.title}</span> ${esc(p.verdict.reason)}.`; } });
const mapPlayer = createPlayer({ max: () => map.maxHour, hoursPerSecond: 14, onToggle: on => { $('d3-play').textContent = on ? '❚❚' : '▶'; },
  onTick: h => { map.setHour(h); $('d3-time').textContent = `+${hours(Math.floor(h))} · ${fmtDate(PLAN_T0 + h * HOUR)}`; } });
$('d3-play').addEventListener('click', () => mapPlayer.toggle());
replays.map = () => { mapPlayer.stop(); mapPlayer.seek(0); map.pingPlan(); mapPlayer.toggle(); };

// =====================================================================
// 4. Top 3: cards travel to their new rank, figures count
// =====================================================================
const d4 = { cards: new Map() };
function topCard(option) {
  const el = document.createElement('article');
  el.className = 'box'; el.dataset.flip = option.site.id;
  el.innerHTML = `<div class="box__head lab-card-head"><div><span class="eyebrow"><span data-k="rank"></span> · puntuación <span data-k="score"></span></span><h3>${esc(option.site.name)}</h3><span class="landing" data-k="landing"></span></div><span class="badge badge--pill" data-k="pill"></span></div>
    <div class="lab-score"><i data-k="bar"></i></div>
    <div class="metrics">
      <div class="metric" data-tone="sun"><span>Misión con Sol</span><b data-k="sun"></b></div>
      <div class="metric" data-tone="earth"><span>Misión con Tierra</span><b data-k="earth"></b></div>
      <div class="metric" data-tone="earth"><span>Mayor tiempo sin Tierra</span><b data-k="no-earth"></b></div>
      <div class="metric"><span>Margen ante retrasos</span><b data-k="robust"></b></div>
    </div>`;
  return el;
}
function updateTopCard(el, o, rank, isNew) {
  const part = k => el.querySelector(`[data-k="${k}"]`), ms = isNew ? 0 : 500, pill = part('pill');
  part('rank').textContent = `${rank + 1}.º`;
  part('landing').textContent = 'Aterrizaje ' + fmtDate(o.landing);
  countTo(part('score'), o.score, { format: n => n.toFixed(2).replace('.', ','), ms });
  part('bar').style.width = Math.min(100, o.score / 2 * 100) + '%';
  countTo(part('sun'), o.result.pctSun, { format: pct, ms });
  countTo(part('earth'), o.result.pctEarth, { format: pct, ms });
  countTo(part('no-earth'), o.result.maxNoEarthHours, { format: hours, ms });
  countTo(part('robust'), o.robustness.maxDelayDays, { format: n => n.toFixed(1).replace('.', ',') + ' d', ms });
  if (pill.dataset.code !== o.verdict.code) { setVerdict(pill, o.verdict.code); pill.textContent = o.verdict.title; if (pill.dataset.code) replay(pill, 'motion-flash'); pill.dataset.code = o.verdict.code; }
}
function renderTop(profileId) {
  const top = searchFor(profileId).options.slice(0, 3), box = $('d4-cards');
  [...$('d4-profiles').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.id === profileId));
  flip(() => [...box.children], () => {
    const keep = new Set(top.map(o => o.site.id));
    for (const [id, el] of d4.cards) if (!keep.has(id)) { el.remove(); d4.cards.delete(id); }
    top.forEach((o, i) => {
      let el = d4.cards.get(o.site.id); const isNew = !el;
      if (isNew) { el = topCard(o); d4.cards.set(o.site.id, el); }
      updateTopCard(el, o, i, isNew); box.append(el);
    });
  });
}
$('d4-profiles').innerHTML = PROFILES.map(p => `<button type="button" data-id="${p.id}">${esc(p.name)}</button>`).join('');
$('d4-profiles').addEventListener('click', e => { const b = e.target.closest('button'); if (b) renderTop(b.dataset.id); });

// =====================================================================
// 5. Delay sweep: cascade in, sliding column, hover ghost
// =====================================================================
const d5 = { day: 0, sweep: null };
function computeSweep() {
  const req = PROFILES[0];
  return d5.sweep ??= Object.fromEntries(POLAR.map(s => [s.id, Array.from({ length: 61 }, (_, d) => M.verdict(M.evaluate(s, PLAN_T0 + d * DAY, req.days, 2), req))]));
}
function placeColumn(el, day) {
  const cells = $('d5-table').querySelectorAll(`.cell[data-d="${day}"]`), inner = $('d5-inner').getBoundingClientRect();
  if (!cells.length) return;
  const first = cells[0].getBoundingClientRect(), last = cells[cells.length - 1].getBoundingClientRect();
  el.style.height = (last.bottom - first.top + 6) + 'px';
  el.style.transform = `translate(${first.left - inner.left - 2}px, ${first.top - inner.top - 3}px)`;
}
function setSweepDay(day) {
  d5.day = day;
  const plan = POLAR[0], row = computeSweep()[plan.id], v = row[day], reopens = row.findIndex((x, d) => d > day && x.code === 'viable');
  placeColumn($('d5-column'), day);
  const out = $('d5-readout'), changed = out.dataset.code && out.dataset.code !== v.code;
  out.dataset.code = v.code;
  out.innerHTML = `<span class="num">+${day} días · ${fmtDate(PLAN_T0 + day * DAY)}</span><b>${esc(plan.short)}</b><span class="badge badge--pill${changed ? ' motion-flash' : ''}" data-tone="${VERDICT_TONE[v.code]}">${v.title}</span>
    <span class="reason">${v.code === 'viable' ? 'El plan sigue valiendo con este retraso.' : reopens > 0 ? `Vuelve a ser viable con +${reopens} días de retraso.` : 'No vuelve a ser viable en los próximos 60 días.'}</span>`;
}
function renderSweep() {
  const sweep = computeSweep();
  let html = '<thead><tr><th></th>';
  for (let d = 0; d < 61; d++) html += `<th scope="col">${d % 5 === 0 ? '+' + d : ''}</th>`;
  html += '</tr></thead><tbody>';
  POLAR.forEach((s, row) => {
    html += `<tr><th scope="row">${esc(s.name)}</th>`;
    sweep[s.id].forEach((v, d) => { html += `<td><button type="button" class="cell ${v.code} motion-cell" style="--col: ${d}; --row: ${row}" data-d="${d}" title="${esc(s.short)} · +${d} d · ${v.title}" aria-label="${esc(s.name)}, +${d} días: ${v.title}"></button></td>`; });
    html += '</tr>';
  });
  $('d5-table').innerHTML = html + '</tbody>';
  setSweepDay(d5.day);
}
$('d5-table').addEventListener('click', e => { const b = e.target.closest('.cell'); if (b) setSweepDay(+b.dataset.d); });
$('d5-table').addEventListener('pointerover', e => { const b = e.target.closest('.cell'); if (!b) return; $('d5-ghost').hidden = false; placeColumn($('d5-ghost'), +b.dataset.d); });
$('d5-table').addEventListener('pointerleave', () => { $('d5-ghost').hidden = true; });
replays.sweep = () => { d5.day = 0; renderSweep(); setTimeout(() => setSweepDay(9), 1100); };

// =====================================================================
// 6. Deviation: eight probes land on a ring around the site
// =====================================================================
const d6 = { probes: [] };
const ringRadius = metres => 38 + 58 * (metres / 1500);
function buildDeviation() {
  const site = POLAR[0];
  $('d6-ring').innerHTML = `
    <text class="lab-svg-label" x="120" y="16" text-anchor="middle">↑ hacia la Tierra</text>
    <circle class="lab-ring" id="d6-circle" cx="120" cy="120" r="60" pathLength="1"></circle>
    <text class="lab-svg-label" id="d6-label" x="120" y="232" text-anchor="middle"></text>
    ${Array.from({ length: 8 }, () => '<circle class="lab-probe" r="8"><title></title></circle>').join('')}
    <circle cx="120" cy="120" r="5" fill="${C.ink}"></circle>`;
  d6.probes = [...$('d6-ring').querySelectorAll('.lab-probe')];
}
function updateDeviation(land) {
  const metres = +$('d6-radius').value, req = PROFILES[0], site = POLAR[0], r = ringRadius(metres);
  const dev = S.deviation(site, PLAN_T0, req, metres / 1000);
  $('d6-radius-value').textContent = `${metres} m`; $('d6-label').textContent = `${site.short} · radio ${metres} m`;
  $('d6-circle').style.r = r + 'px';
  dev.points.forEach((p, k) => {
    const el = d6.probes[k], a = k * Math.PI / 4;
    el.style.cx = (120 + r * Math.cos(a)) + 'px'; el.style.cy = (120 - r * Math.sin(a)) + 'px'; el.style.fill = verdictColor(p.verdict.code);
    el.querySelector('title').textContent = `${p.lat.toFixed(3)}°, ${p.lon.toFixed(2)}°: ${p.verdict.title}`;
    if (land) { el.style.setProperty('--i', 3 + k * 1.8); replay(el, 'motion-stamp'); }
  });
  if (land) { replay($('d6-circle'), 'motion-stroke'); $('d6-count')._value = 0; }
  countTo($('d6-count'), dev.viable, { ms: land ? 900 : 250 });
  $('d6-reason').textContent = dev.viable === 8 ? 'El plan aguanta un desvío así.' : dev.viable >= 5 ? 'Riesgo moderado: algunos puntos cercanos quedan sin Sol o sin Tierra.' : 'Riesgo alto: un desvío así puede dejar la nave sin Sol o sin Tierra, como le pasó a Athena.';
  $('d6-row').innerHTML = dev.points.map(p => `<i style="--c: ${verdictColor(p.verdict.code)}"></i>`).join('');
}
$('d6-radius').addEventListener('input', () => updateDeviation(false));
replays.deviation = () => updateDeviation(true);

// =====================================================================
// 7. View change: the plan's name and verdict travel to their card
// =====================================================================
const d7 = { view: 'plan' };
function renderViewDemo() {
  const res = searchFor(PROFILES[0].id), best = res.best;
  const shared = (name) => `style="view-transition-name: ${name}"`;
  $('d7-stage').innerHTML = d7.view === 'plan'
    ? `<span class="eyebrow">Planificar · mejor opción</span>
       <div><h3 class="featured"><span ${shared('plan-site')}>${esc(best.site.name)}</span></h3>
       <p class="res-line"><span class="num">Aterrizaje ${fmtDate(best.landing)}</span> <span class="badge badge--pill badge--large" data-tone="${VERDICT_TONE[best.verdict.code]}" ${shared('plan-verdict')}>${best.verdict.title}</span></p>
       <p class="hint">${esc(best.verdict.reason)}</p></div>
       <button class="btn" type="button" data-go="advanced">Vista avanzada →</button>`
    : `<span class="eyebrow">Avanzado · top 3 de sitios</span>
       <div class="lab-cards">${res.options.slice(0, 3).map((o, i) => `<article class="box"><div class="box__head lab-card-head"><div><h3><span ${i ? '' : shared('plan-site')}>${esc(o.site.name)}</span></h3><span class="landing">Aterrizaje ${fmtDate(o.landing)}${i ? '' : ' · plan'}</span></div><span class="badge badge--pill" data-tone="${VERDICT_TONE[o.verdict.code]}" ${i ? '' : shared('plan-verdict')}>${o.verdict.title}</span></div>
         <div class="metrics"><div class="metric" data-tone="sun"><span>Misión con Sol</span><b>${pct(o.result.pctSun)}</b></div><div class="metric" data-tone="earth"><span>Misión con Tierra</span><b>${pct(o.result.pctEarth)}</b></div></div></article>`).join('')}</div>
       <button class="btn" type="button" data-go="plan">← Planificar</button>`;
}
$('d7-stage').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) viewTransition(() => { d7.view = b.dataset.go; renderViewDemo(); }); });

// =====================================================================
// 8. Micro-interactions and page wiring
// =====================================================================
$('d8-layers').addEventListener('click', e => { const b = e.target.closest('button'); if (b) [...$('d8-layers').children].forEach(x => x.setAttribute('aria-pressed', x === b)); });
$('d8-pill').addEventListener('click', () => {
  const order = [['viable', 'Viable'], ['marginal', 'Justo'], ['not_viable', 'No viable']], el = $('d8-pill');
  const [code, title] = order[(order.findIndex(o => el.dataset.code === o[0]) + 1) % 3];
  setVerdict(el, code, ' badge--large lab-pill-button'); el.dataset.code = code; el.textContent = title; replay(el, 'motion-flash');
});
$('motion-toggle').addEventListener('click', () => {
  const on = document.documentElement.dataset.motion === 'off';
  document.documentElement.dataset.motion = on ? 'on' : 'off';
  $('motion-toggle').setAttribute('aria-pressed', on); $('motion-toggle').textContent = `Movimiento: ${on ? 'activado' : 'desactivado'}`;
});
document.addEventListener('click', e => { const b = e.target.closest('[data-replay]'); if (b) replays[b.dataset.replay]?.(); });

renderD1Profiles();
loadSkyCase(0);
renderTop(PROFILES[0].id);
buildDeviation(); updateDeviation(false);
renderViewDemo();
document.fonts.ready.then(() => {
  runSearch(); sky.draw();
  onVisible($('demo-sky'), () => skyPlayer.toggle());
  onVisible($('demo-map'), () => { map.setHour(0); mapPlayer.seek(0); map.pingPlan(); });
  onVisible($('demo-sweep'), renderSweep);
  onVisible($('demo-deviation'), () => updateDeviation(true));
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { sky.draw(); placeColumn($('d5-column'), d5.day); }, 120); });
