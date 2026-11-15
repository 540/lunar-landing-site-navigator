// Labels and legend of the map (J4.4): colours, legend rows, scale bar, bearings on the border and the 2D drawing
// helpers of the prototype (label, pad, bearing arrow, scale). The pure part is tested; the drawing takes a 2D context.
import { bearingPoint } from './ring.js';
import { gameColors } from './palette.js';

export { bearingPoint };

// One table for the drawing and the legend; values of the variables of styles/game.css where they exist (the Sun's
// and the Earth's are read from them, #341).
export const MAP_COLORS = Object.freeze({
  lit: '#ebe8e2', // --fg: sunlit ground
  shadow: '#060708', // --bg: ground in shadow
  get rover() { return gameColors().sun; }, // --sun: orange since J13.2, as in the mock-up
  pad: '#ebe8e2', // --fg: circle and rhombus of the prototype (blue is the Earth's)
  get route() { return gameColors().sun; }, // --sun: route driven
  planned: '#ebe8e2', // --fg: route planned (red or yellow when it fails, J1.2)
  get earth() { return gameColors().earth; }, // --earth
  get sun() { return gameColors().sun; }, // --sun: bearing of the Sun
  earthDim: '#36597f', // the Earth under the horizon
  sent: '#7fb8ff', // circle of txMinKm around each package sent (J3.6)
  earthSoon: '#78b4ff', // stripes of the cells that will see the Earth in the next 24 h (#382)
  labelBg: 'rgba(6,7,8,.72)',
});

// Rows of the legend, in order: { id, color, shape }. The Earth's only with its layer on screen (J3.2).
const ROWS = [
  { id: 'lit', shape: 'swatch' },
  { id: 'shadow', shape: 'swatch' },
  { id: 'earth', shape: 'dot' },
  { id: 'earthSoon', shape: 'hatch' },
  { id: 'rover', shape: 'disc' },
  { id: 'pad', shape: 'pad' },
  { id: 'route', shape: 'line' },
  { id: 'planned', shape: 'dash' },
  { id: 'sent', shape: 'ring' },
];
// The row of the circles around the packages sent (J3.6) only once one has been sent.
export function legendItems({ earthLayer, sent = 0 }) {
  return ROWS
    .filter((r) => (earthLayer || (r.id !== 'earth' && r.id !== 'earthSoon')) && (sent > 0 || r.id !== 'sent'))
    .map((r) => ({ ...r, color: MAP_COLORS[r.id] }));
}

// Radius in canvas pixels of the circle of `km` around a cell: cells of cellM metres, `c` pixels per cell.
export const sentRadiusPx = (km, cellM, c) => ((km * 1000) / cellM) * c;

// Scale bar of `km` kilometres: how many cells of cellM metres it spans.
export const scaleBar = (cellM, km = 2) => ({ km, cells: (km * 1000) / cellM });

// Nearest of the eight winds of an azimuth (45° sectors centred on each).
const POINTS = ['n', 'ne', 'e', 'se', 's', 'so', 'o', 'no'];
export const compassPoint = (az) => POINTS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

// ---------- 2D drawing (u: scale of a 640-pixel map) ----------

// Text on a dark translucent box, so it reads on light and dark ground (prototype label, l. 443).
export function drawLabel(ctx, text, x, y, color, u) {
  ctx.save();
  ctx.font = `600 ${Math.round(12 * u)}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = MAP_COLORS.labelBg;
  ctx.fillRect(x - w / 2 - 5 * u, y - 12 * u, w + 10 * u, 16 * u);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Ascent pad: a light circle and a rhombus (prototype, l. 426-427).
export function drawPad(ctx, x, y, u, { lift = 0 } = {}) {
  ctx.save();
  ctx.strokeStyle = MAP_COLORS.pad; ctx.lineWidth = 2 * u;
  ctx.beginPath(); ctx.arc(x, y, 11 * u, 0, Math.PI * 2); ctx.stroke();
  // The ascent vehicle (J12.8, #398): a small rocket on the pad; on a win, it lifts off (lift 0…1) with a flash and
  // its flame, and leaves the circle empty.
  if (lift < 1) {
    const dy = -lift * lift * 70 * u;
    if (lift > 0) {
      ctx.fillStyle = `rgba(255,236,200,${0.55 * Math.max(0, 1 - lift * 3)})`;
      ctx.beginPath(); ctx.arc(x, y + 2 * u, (10 + 30 * lift) * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,190,110,0.9)';
      ctx.beginPath(); ctx.moveTo(x - 2.5 * u, y + 5 * u + dy); ctx.lineTo(x + 2.5 * u, y + 5 * u + dy); ctx.lineTo(x, y + (13 + 6 * lift) * u + dy); ctx.closePath(); ctx.fill();
    }
    drawRocket(ctx, x, y + dy, u);
  }
  ctx.restore();
}

// Silhouette of the ascent vehicle: body, nose and two legs, ~12 px high at u = 1.
export function drawRocket(ctx, x, y, u) {
  ctx.save();
  ctx.fillStyle = MAP_COLORS.pad; ctx.strokeStyle = 'rgba(6,7,8,.85)'; ctx.lineWidth = 1 * u;
  ctx.beginPath();
  ctx.moveTo(x, y - 8 * u);
  ctx.quadraticCurveTo(x + 3.2 * u, y - 4.5 * u, x + 3 * u, y + 2 * u);
  ctx.lineTo(x + 5.5 * u, y + 5.5 * u); ctx.lineTo(x + 2.4 * u, y + 4 * u);
  ctx.lineTo(x - 2.4 * u, y + 4 * u); ctx.lineTo(x - 5.5 * u, y + 5.5 * u);
  ctx.lineTo(x - 3 * u, y + 2 * u);
  ctx.quadraticCurveTo(x - 3.2 * u, y - 4.5 * u, x, y - 8 * u);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(6,7,8,.85)';
  ctx.beginPath(); ctx.arc(x, y - 2.5 * u, 1.1 * u, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Arrow on the border towards an azimuth, with its label a little inside (prototype bearing, l. 444).
export function drawBearing(ctx, az, color, text, size, u) {
  const p = bearingPoint(az, size, 14 * u);
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.angle);
  ctx.fillStyle = color; ctx.strokeStyle = '#060708'; ctx.lineWidth = 1.5 * u;
  ctx.beginPath(); ctx.moveTo(0, -9 * u); ctx.lineTo(7.5 * u, 5 * u); ctx.lineTo(-7.5 * u, 5 * u); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  const inner = bearingPoint(az, size, 44 * u);
  ctx.save();
  ctx.font = `600 ${Math.round(12 * u)}px "JetBrains Mono", monospace`;
  const tw = ctx.measureText(text).width;
  ctx.restore();
  drawLabel(ctx, text, Math.max(tw / 2 + 8 * u, Math.min(size - tw / 2 - 8 * u, inner.x)), inner.y + 4 * u, color, u);
}

// Scale bar at the bottom right: `cells` cells of side c, with its text over it.
export function drawScale(ctx, text, cells, c, size, u, bottom = 16) {
  const x1 = size - 14 * u, x0 = x1 - cells * c, y = size - bottom * u;
  ctx.save();
  ctx.fillStyle = MAP_COLORS.labelBg;
  ctx.fillRect(x0 - 6 * u, y - 20 * u, x1 - x0 + 12 * u, 28 * u);
  ctx.fillStyle = MAP_COLORS.lit;
  ctx.fillRect(x0, y, x1 - x0, 2 * u);
  ctx.fillRect(x0, y - 4 * u, 1.5 * u, 6 * u);
  ctx.fillRect(x1 - 1.5 * u, y - 4 * u, 1.5 * u, 6 * u);
  ctx.font = `500 ${Math.round(11 * u)}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(text, x1, y - 6 * u);
  ctx.restore();
}

// Legend under the map (HTML, so screen readers read it): the rows and the Sun's bearing in words.
export function renderLegend(list, items, texts, sunText) {
  list.replaceChildren();
  for (const it of items) {
    const li = document.createElement('li');
    const key = document.createElement('span');
    key.className = `legend__key legend__key--${it.shape}`;
    key.style.setProperty('--key', it.color);
    key.setAttribute('aria-hidden', 'true');
    li.append(key, document.createTextNode(texts.legend[it.id]));
    list.append(li);
  }
  const sun = document.createElement('li');
  sun.className = 'legend__sun';
  const key = document.createElement('span');
  key.className = 'legend__key legend__key--arrow';
  key.style.setProperty('--key', MAP_COLORS.sun);
  key.setAttribute('aria-hidden', 'true');
  sun.append(key, document.createTextNode(sunText));
  list.append(sun);
}
