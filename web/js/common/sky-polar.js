// The sky compass of Plan: the 360° sky seen from above, north up and east to the right, as on a map. The rim is the
// bottom of the scale (under the horizon) and the elevation grows towards the centre, stretched like the 2D chart:
// at the pole the Sun and the Earth stay a few degrees from the horizon, and a true zenith projection would press
// them against the rim. Same data as the 2D chart: { horizon: { mask } } and the hourly series of the mission.
import { theme } from './theme.js';
import { fmtDeg } from './sun-elevation.js';
import { t as tr } from './i18n.js';
import { marginOverRelief, overRelief } from './sky-visibility.js';
import { BODY_MARKER_RADIUS_PX, markersOverlap } from '../../../shared/render/sky-bodies.js';

const DEG = Math.PI / 180;
const maskAt = (mask, az) => mask[((Math.round(az) % 360) + 360) % 360];

/**
 * Elevation scale of the dial: `bottom` on the rim, `top` at the centre, both whole degrees, and the step of its rings.
 * It holds the whole relief and both tracks, with a little room, and never less than −2° … 6°.
 */
export function polarScale(mask, series) {
  let lo = -2, hi = 6;
  for (let a = 0; a < 360; a++) { lo = Math.min(lo, mask[a] - 1); hi = Math.max(hi, mask[a] + 1); }
  for (const c of series) hi = Math.max(hi, c.sun.el + 1, c.earth.el + 1);
  const top = Math.min(90, Math.ceil(hi)), bottom = Math.max(-10, Math.floor(lo));
  const span = top - bottom, step = span > 40 ? 20 : span > 16 ? 5 : 2;
  return { bottom, top, step };
}

/** Distance from the centre, 0 (the top of the scale) to `radius` (its bottom); elevations outside are clamped. */
export const radiusOf = (el, scale, radius) => ((scale.top - Math.max(scale.bottom, Math.min(scale.top, el))) / (scale.top - scale.bottom)) * radius;

/** Point of an azimuth and an elevation on the dial: north up, east right (compass bearings, clockwise). */
export function pointOf(az, el, scale, cx, cy, radius) {
  const r = radiusOf(el, scale, radius);
  return [cx + r * Math.sin(az * DEG), cy - r * Math.cos(az * DEG)];
}

/** Bearing as a compass reads it: three digits («045°»), and the nearest of the eight winds. */
const WINDS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
// The winds stay Spanish codes (rolegame reads them); windLabel() is the one to show.
export const windLabel = w => tr(`common.wind.${w}`);
export const bearing = az => { const a = ((Math.round(az) % 360) + 360) % 360; return { text: `${String(a).padStart(3, '0')}°`, wind: WINDS[Math.round(a / 45) % 8] }; };

/** What the dial says in words, for screen readers: where each body is and whether the relief hides it. */
export function polarSummary(c) {
  const one = (name, b) => tr('common.polar.body', { name, wind: windLabel(bearing(b.az).wind), bearing: bearing(b.az).text, el: fmtDeg(b.el), where: overRelief(b) ? tr('common.polar.above', { deg: fmtDeg(marginOverRelief(b)) }) : tr('common.polar.below', { deg: fmtDeg(-marginOverRelief(b)) }) });
  return tr('common.polar.summary', { sun: one(tr('common.sun'), c.sun), earth: one(tr('common.earth'), c.earth) });
}

/** The relief line of a body's card: seen with its whole disc over the relief, and the margin of its lower edge. */
export function reliefReading(b) {
  const seen = overRelief(b);
  return { seen, label: tr(seen ? 'common.polar.aboveTerrain' : 'common.polar.belowTerrain'), value: `${seen ? '+' : '−'}${fmtDeg(Math.abs(marginOverRelief(b)))}` };
}

/** Draws the compass on `cv` (height px high) at hour `idx` of `series`. */
export function drawSkyPolar(cv, { horizon }, { series }, idx, height = 240) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth || 300, h = height;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t = theme(), mask = horizon.mask, scale = polarScale(mask, series);
  const c = series[Math.min(idx, series.length - 1)];
  cv.setAttribute('aria-label', polarSummary(c));

  // The dial takes the height; the readout goes beside it when there is room, else the dial is centred alone.
  const bezel = 22, radius = Math.max(40, Math.min(h, w) / 2 - bezel);
  const panel = w - (2 * (radius + bezel)) >= 150;
  const cx = panel ? radius + bezel + 6 : w / 2, cy = h / 2;
  const P = (az, el) => pointOf(az, el, scale, cx, cy, radius);
  const R = el => radiusOf(el, scale, radius);

  // Sky: darker at the rim (the horizon) than at the centre.
  const sky = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  sky.addColorStop(0, t.surfaceRaised); sky.addColorStop(1, t.bg);
  ctx.fillStyle = sky; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.fill();

  // Elevation rings; the horizon (0°) a little stronger. Their labels go later, over the tracks.
  const rings = [];
  for (let e = Math.ceil(scale.bottom / scale.step) * scale.step; e < scale.top; e += scale.step) {
    const r = R(e); if (r < 6 || r > radius - 1) continue;
    rings.push([e, r]);
    ctx.save();
    ctx.strokeStyle = e === 0 ? t.muted : t.border; ctx.lineWidth = 1; ctx.globalAlpha = e === 0 ? 0.8 : 0.7;
    ctx.setLineDash(e === 0 ? [6, 3] : [2, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
  }
  // Cross hairs through the centre, as on a bearing plate.
  ctx.save(); ctx.strokeStyle = t.border; ctx.globalAlpha = 0.6; ctx.beginPath();
  ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke(); ctx.restore();

  // Relief: from the rim in to the skyline, the elevation of the horizon at each azimuth.
  ctx.beginPath();
  for (let a = 0; a <= 360; a++) { const [x, y] = P(a, maskAt(mask, a)); a ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.closePath();
  ctx.moveTo(cx + radius, cy); ctx.arc(cx, cy, radius, 0, 2 * Math.PI, true);
  const inner = Math.max(0, R(Math.max(...mask)) - 2);
  const ground = ctx.createRadialGradient(cx, cy, inner, cx, cy, radius);
  ground.addColorStop(0, t.terrain); ground.addColorStop(1, t.bg);
  ctx.fillStyle = ground; ctx.globalAlpha = 0.95; ctx.fill('evenodd'); ctx.globalAlpha = 1;
  ctx.beginPath();
  for (let a = 0; a <= 360; a++) { const [x, y] = P(a, maskAt(mask, a)); a ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.strokeStyle = t.text; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2; ctx.stroke(); ctx.globalAlpha = 1;

  // Tracks of the mission: what has gone by is drawn firm, what is to come faint; under the relief, dashed.
  const track = (k, color) => {
    ctx.save(); ctx.strokeStyle = color; ctx.lineCap = 'round';
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1][k], b = series[i][k], seen = overRelief(a) && overRelief(b), past = i <= idx;
      ctx.globalAlpha = (seen ? 1 : 0.4) * (past ? 1 : 0.3);
      ctx.lineWidth = (seen ? 2.6 : 1.2) * (past ? 1 : 0.7);
      ctx.setLineDash(seen ? [] : [2, 3]);
      ctx.beginPath(); ctx.moveTo(...P(a.az, a.el)); ctx.lineTo(...P(b.az, b.el)); ctx.stroke();
    }
    ctx.restore();
  };
  track('earth', t.earth); track('sun', t.sun);

  // Bezel: a tick every 5°, longer every 30°, the bearings every 30° and the four cardinal points.
  ctx.save(); ctx.strokeStyle = t.muted; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2 * Math.PI); ctx.stroke();
  for (let a = 0; a < 360; a += 5) {
    const long = a % 30 === 0, s = Math.sin(a * DEG), co = -Math.cos(a * DEG), r0 = radius + 1, r1 = radius + (long ? 7 : 3.5);
    ctx.globalAlpha = long ? 0.9 : 0.5;
    ctx.beginPath(); ctx.moveTo(cx + r0 * s, cy + r0 * co); ctx.lineTo(cx + r1 * s, cy + r1 * co); ctx.stroke();
  }
  ctx.restore();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let a = 0; a < 360; a += 30) {
    const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: windLabel('O') }[a], r = radius + 14;
    const x = cx + r * Math.sin(a * DEG), y = cy - r * Math.cos(a * DEG);
    if (cardinal) { ctx.font = `600 12px ${t.fontDisplay}`; ctx.fillStyle = a === 0 ? t.text : t.muted; ctx.fillText(cardinal, x, y); }
    else if (radius > 70) { ctx.font = `9px ${t.fontData}`; ctx.fillStyle = t.muted; ctx.globalAlpha = 0.8; ctx.fillText(String(a).padStart(3, '0'), x, y); ctx.globalAlpha = 1; }
  }

  // Bearing of each body: a needle from the centre and a marker on the bezel pointing in.
  const needle = (b, color) => {
    const s = Math.sin(b.az * DEG), co = -Math.cos(b.az * DEG), [x, y] = P(b.az, b.el);
    ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = overRelief(b) ? 0.55 : 0.25; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.restore();
    const tip = radius + 1, base = radius + 8, half = 4.5;
    ctx.beginPath();
    ctx.moveTo(cx + tip * s, cy + tip * co);
    ctx.lineTo(cx + base * s - half * co, cy + base * co + half * s);
    ctx.lineTo(cx + base * s + half * co, cy + base * co - half * s);
    ctx.closePath(); ctx.fillStyle = color; ctx.globalAlpha = overRelief(b) ? 1 : 0.5; ctx.fill(); ctx.globalAlpha = 1;
  };
  needle(c.earth, t.earth); needle(c.sun, t.sun);

  // The bodies now: lit with a halo when in sight, hollow when the relief hides them.
  const disc = (b, color, rad, ring = false) => {
    const [x, y] = P(b.az, b.el);
    ctx.save();
    if (ring) {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, rad - 1, 0, 2 * Math.PI); ctx.stroke();
    } else if (overRelief(b)) {
      ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 2 * Math.PI); ctx.fill();
      ctx.shadowBlur = 0; ctx.strokeStyle = t.surface; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      ctx.fillStyle = t.bg; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.arc(x, y, rad - 1, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  };
  // Same size, not to scale; the Earth goes on top, and as a ring where they overlap so the Sun still shows (#342).
  const [sx, sy] = P(c.sun.az, c.sun.el), [ex, ey] = P(c.earth.az, c.earth.el);
  disc(c.sun, t.sun, BODY_MARKER_RADIUS_PX);
  disc(c.earth, t.earth, BODY_MARKER_RADIUS_PX, markersOverlap({ x: sx, y: sy }, { x: ex, y: ey }));

  // Ring labels down the south axis, on a chip so a track under them does not hide them; at least 13 px apart.
  ctx.font = `9px ${t.fontData}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let last = -Infinity;
  for (const [e, r] of [[scale.top, 0], ...rings.slice().reverse()]) {
    if (r - last < 13 && e !== 0) continue;
    const text = fmtDeg(e, 0), tw = ctx.measureText(text).width, x = cx + 4, y = cy + r;
    ctx.fillStyle = t.bg; ctx.globalAlpha = 0.75; ctx.fillRect(x - 2, y - 6, tw + 4, 12); ctx.globalAlpha = 1;
    ctx.fillStyle = e === 0 ? t.text : t.muted; ctx.fillText(text, x, y);
    last = r;
  }

  if (panel) drawReadout(ctx, t, c, cx + radius + bezel + 18, w - 8, h);
}

// Beside the dial, a readout per body: bearing, elevation, the relief in that direction and the margin over it.
function drawReadout(ctx, t, c, x0, x1, h) {
  const rows = [[tr('common.polar.sunCaps'), c.sun, t.sun], [tr('common.polar.earthCaps'), c.earth, t.earth]];
  const block = 78, y0 = Math.max(8, h / 2 - block);
  ctx.textBaseline = 'alphabetic';
  rows.forEach(([name, b, color], i) => {
    const y = y0 + i * (block + 10);
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x0 + 4, y + 6, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.font = `600 10px ${t.fontData}`; ctx.textAlign = 'left'; ctx.fillStyle = t.muted; ctx.fillText(name, x0 + 14, y + 10);
    const g = bearing(b.az);
    ctx.font = `500 22px ${t.fontData}`; ctx.fillStyle = t.text; ctx.fillText(g.text, x0, y + 36);
    const wBearing = ctx.measureText(g.text).width;
    ctx.font = `600 12px ${t.fontDisplay}`; ctx.fillStyle = t.muted; ctx.fillText(windLabel(g.wind), x0 + wBearing + 6, y + 36);
    const line = (label, value, yy, color2) => {
      ctx.font = `11px ${t.fontBody}`; ctx.fillStyle = t.muted; ctx.textAlign = 'left'; ctx.fillText(label, x0, yy);
      ctx.font = `500 11px ${t.fontData}`; ctx.fillStyle = color2 ?? t.text; ctx.textAlign = 'right'; ctx.fillText(value, Math.min(x1, x0 + 170), yy);
      ctx.textAlign = 'left';
    };
    line(tr('common.polar.elevation'), fmtDeg(b.el), y + 54);
    const r = reliefReading(b);
    line(r.label, r.value, y + 70, r.seen ? t.ok : t.bad);
  });
  // How to read the tracks, if it fits under the readout.
  const y = y0 + 2 * block + 30;
  if (y + 6 > h) return;
  const keys = [[tr('common.polar.done'), 1, 2.6, []], [tr('common.polar.ahead'), 0.3, 1.8, []], [tr('common.polar.hidden'), 0.4, 1.2, [2, 3]]];
  ctx.font = `10px ${t.fontBody}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let x = x0;
  for (const [label, alpha, width, dash] of keys) {
    ctx.save(); ctx.strokeStyle = t.text; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y); ctx.stroke(); ctx.restore();
    ctx.fillStyle = t.muted; ctx.fillText(label, x + 21, y);
    x += 21 + ctx.measureText(label).width + 12;
  }
}
