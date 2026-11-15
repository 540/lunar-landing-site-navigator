// Shared charts: the 360° sky (Plan and Advanced) and the height-over-terrain line (Advanced).
import * as M from '../engine/model.js';
import { theme } from './theme.js';
import { t as tr, fmtDeg } from './i18n.js';
import { overRelief } from './sky-visibility.js';
import { BODY_MARKER_RADIUS_PX, markersOverlap } from '../../../shared/render/sky-bodies.js';

export function prepCanvas(cv, height) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth || 300;
  cv.width = w * dpr; cv.height = height * dpr; cv.style.height = height + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: height };
}

export function drawSky(cv, s, r, idx, height = 150) {
  const { ctx, w, h } = prepCanvas(cv, height); const t = theme();
  const pad = { l: 30, r: 8, t: 8, b: 20 };
  let yMax = 6; const yMin = -3;
  for (const c of r.series) yMax = Math.max(yMax, c.sun.el + 1, c.earth.el + 1);
  for (let a = 0; a < 360; a++) yMax = Math.max(yMax, s.horizon.mask[a] + 1);
  yMax = Math.min(90, Math.ceil(yMax));
  const X = az => pad.l + (az / 360) * (w - pad.l - pad.r);
  const Y = el => pad.t + (1 - (Math.max(yMin, Math.min(yMax, el)) - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);
  ctx.font = '10px ' + t.fontData; ctx.fillStyle = t.muted; ctx.strokeStyle = t.border; ctx.lineWidth = 1;
  const step = yMax > 30 ? 20 : yMax > 12 ? 5 : 2;
  for (let e = Math.ceil(yMin / step) * step; e <= yMax; e += step) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(e)); ctx.lineTo(w - pad.r, Y(e)); ctx.stroke(); ctx.fillText(fmtDeg(e, 0), 2, Y(e) + 3);
  }
  [['N', 0], ['E', 90], ['S', 180], [tr('common.wind.O'), 270], ['N', 360]].forEach(([label, a]) => ctx.fillText(label, X(a) - 3, h - 5));
  const track = (k, col) => { ctx.fillStyle = col; ctx.globalAlpha = 0.4; r.series.forEach((c, i) => { if (i % 2 === 0) ctx.fillRect(X(c[k].az) - 0.8, Y(c[k].el) - 0.8, 1.6, 1.6); }); ctx.globalAlpha = 1; };
  track('sun', t.sun); track('earth', t.earth);
  ctx.fillStyle = t.terrain; ctx.beginPath(); ctx.moveTo(X(0), Y(yMin));
  for (let a = 0; a <= 360; a++) ctx.lineTo(X(a), Y(M.horizonAt(s.horizon.mask, a)));
  ctx.lineTo(X(360), Y(yMin)); ctx.closePath(); ctx.fill();
  const c = r.series[Math.min(idx, r.series.length - 1)];
  // Filled when in sight, hollow (2 px ring of its colour) when the relief hides it, as the compass does (#337).
  const disc = (b, col, rad, ring = false) => {
    ctx.beginPath();
    if (ring) {
      ctx.arc(X(b.az), Y(b.el), rad - 1, 0, 2 * Math.PI); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    } else if (overRelief(b)) {
      ctx.arc(X(b.az), Y(b.el), rad, 0, 2 * Math.PI);
      ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = t.surface; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      ctx.arc(X(b.az), Y(b.el), rad - 1, 0, 2 * Math.PI);
      ctx.fillStyle = t.surface; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    }
  };
  // Markers of the same size, not to scale: a true-size disc would lie about whether the body clears the relief (#342).
  // Where they overlap, the Earth on top is only a ring so the Sun still shows (#342).
  const together = markersOverlap({ x: X(c.sun.az), y: Y(c.sun.el) }, { x: X(c.earth.az), y: Y(c.earth.el) });
  disc(c.sun, t.sun, BODY_MARKER_RADIUS_PX); disc(c.earth, t.earth, BODY_MARKER_RADIUS_PX, together);
}

export function drawLine(cv, r, idx, days, height = 120) {
  const { ctx, w, h } = prepCanvas(cv, height); const t = theme();
  const pad = { l: 30, r: 8, t: 8, b: 20 };
  let yMin = -2, yMax = 4;
  for (const c of r.series) { yMin = Math.min(yMin, c.sun.margin, c.earth.margin); yMax = Math.max(yMax, c.sun.margin, c.earth.margin); }
  yMin = Math.max(-15, Math.floor(yMin)); yMax = Math.min(70, Math.ceil(yMax));
  const n = r.series.length - 1;
  const X = i => pad.l + (i / n) * (w - pad.l - pad.r);
  const Y = v => pad.t + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);
  ctx.font = '10px ' + t.fontData; ctx.fillStyle = t.muted; ctx.strokeStyle = t.border; ctx.lineWidth = 1;
  const dayStep = days > 14 ? 5 : 2;
  for (let d = 0; d <= days; d += dayStep) { const x = X(d * 24 / r.step); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.fillText('d' + d, x - 6, h - 5); }
  ctx.fillText(fmtDeg(yMax, 0), 2, Y(yMax) + 8); ctx.fillText(fmtDeg(yMin, 0), 2, Y(yMin));
  ctx.strokeStyle = t.muted; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(w - pad.r, Y(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillText(tr('common.chart.horizon'), w - pad.r - 52, Y(0) - 3);
  const plot = (k, col) => {
    ctx.fillStyle = col; ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    r.series.forEach((c, i) => ctx.lineTo(X(i), Y(Math.max(0, c[k].margin)))); ctx.lineTo(X(n), Y(0)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath(); r.series.forEach((c, i) => i ? ctx.lineTo(X(i), Y(c[k].margin)) : ctx.moveTo(X(i), Y(c[k].margin))); ctx.stroke();
  };
  plot('earth', t.earth); plot('sun', t.sun);
  ctx.strokeStyle = t.text; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(idx), pad.t); ctx.lineTo(X(idx), h - pad.b); ctx.stroke();
}
