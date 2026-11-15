// Panoramic horizon ring (J13.4, #312): the 360° horizon of the rover's cell unrolled into a strip, south at both
// ends and north in the middle, with the relief, the Sun and the Earth, as in the mock-up of the epic map. Same data
// as the ring of J3.4 (ring.js: cellMask and ringSeries). The geometry is pure; drawStrip only paints on the canvas
// context it is given.

// Default elevation band of the strip (the mock-up's −4° … 11°); it widens if a body goes beyond it.
export const STRIP_LO = -4;
export const STRIP_HI = 11;
// Hours ahead drawn as the Sun's track, and the step between its points.
export const TRACK_H = 144;
export const TRACK_STEP_H = 6;

// Elevation band { lo, hi } in whole degrees: −4° … 11°, widened to hold every Sun and Earth position of the
// mission (with a degree of room). The relief above `hi` is clipped: it is a wall the bodies never clear.
export function stripScale(rows) {
  let lo = STRIP_LO;
  let hi = STRIP_HI;
  for (const r of rows) {
    lo = Math.min(lo, Math.floor(Math.min(r.sun.el, r.earth.el)) - 1);
    hi = Math.max(hi, Math.ceil(Math.max(r.sun.el, r.earth.el)) + 1);
  }
  return { lo, hi };
}

// x of an azimuth on a strip `w` wide: south (180°) at the left edge, west, north in the middle, east, south again.
export const stripX = (az, w) => (((((az - 180) % 360) + 360) % 360) / 360) * w;

// y of an elevation on a strip `h` high: `hi` near the top, `lo` 14 px above the bottom (room for the bearings).
export function stripY(el, scale, h) {
  const v = Math.max(scale.lo, Math.min(scale.hi, el));
  return h - 14 - ((v - scale.lo) / (scale.hi - scale.lo)) * (h - 20);
}

// Bearing letters along the bottom: S at both ends, W, N and E (the winds of the language in use).
export function stripLabels(w, winds) {
  return [
    { text: winds.S, x: 2, align: 'left' },
    { text: winds.O, x: stripX(270, w), align: 'center' },
    { text: winds.N, x: stripX(0, w), align: 'center' },
    { text: winds.E, x: stripX(90, w), align: 'center' },
    { text: winds.S, x: w - 2, align: 'right' },
  ];
}

// Points of the Sun's track for the next TRACK_H hours from row `idx`, split where it wraps round the south edge.
export function sunTrack(rows, idx, w, scale, h) {
  const segments = [];
  let seg = [];
  let prevX = null;
  for (let k = 0; k <= TRACK_H / TRACK_STEP_H; k++) {
    const r = rows[Math.min(idx + k * TRACK_STEP_H, rows.length - 1)];
    const x = stripX(r.sun.az, w);
    if (prevX !== null && Math.abs(x - prevX) > w / 2) { segments.push(seg); seg = []; }
    seg.push([x, stripY(r.sun.el, scale, h)]);
    prevX = x;
  }
  segments.push(seg);
  return segments.filter((s) => s.length > 1);
}

// Draws the strip on a 2D context `g` of `w` × `h` CSS pixels. `rows` comes from ringSeries, `mask` from cellMask.
export function drawStrip(g, { mask, rows, idx, w, h, colors, winds }) {
  const scale = stripScale(rows);
  const Y = (el) => stripY(el, scale, h);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, colors.skyTop); sky.addColorStop(1, colors.skyBottom);
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  // Horizon line (0°), dashed.
  g.strokeStyle = colors.zero; g.lineWidth = 1; g.setLineDash([2, 3]);
  g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); g.stroke(); g.setLineDash([]);
  // Relief: every 2° of azimuth from the south, filled down to the bottom, with its skyline.
  const skyline = [];
  for (let k = 0; k <= 180; k++) {
    const az = 180 + k * 2;
    skyline.push([k === 180 ? w : stripX(az, w), Y(mask[az % 360])]);
  }
  g.fillStyle = colors.ground; g.beginPath(); g.moveTo(0, h);
  for (const [x, y] of skyline) g.lineTo(x, y);
  g.lineTo(w, h); g.closePath(); g.fill();
  g.strokeStyle = colors.skyline; g.beginPath();
  skyline.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  // The Sun's track for the next days.
  g.strokeStyle = colors.sunTrack;
  for (const seg of sunTrack(rows, idx, w, scale, h)) {
    g.beginPath(); seg.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  }
  // The bodies now: filled when in sight, hollow when the relief hides them.
  const row = rows[Math.min(idx, rows.length - 1)];
  const body = (b, color) => {
    g.beginPath(); g.arc(stripX(b.az, w), Y(b.el), 4.5, 0, Math.PI * 2);
    if (b.margin > 0) { g.fillStyle = color; g.fill(); } else { g.fillStyle = colors.skyBottom; g.fill(); g.strokeStyle = color; g.lineWidth = 1.5; g.stroke(); g.lineWidth = 1; }
  };
  body(row.earth, colors.earth);
  body(row.sun, colors.sun);
  // Bearings and the 0° mark.
  g.fillStyle = colors.label; g.font = "10px 'JetBrains Mono', monospace"; g.textBaseline = 'alphabetic';
  for (const l of stripLabels(w, winds)) { g.textAlign = l.align; g.fillText(l.text, l.x, h - 2); }
  g.textAlign = 'left'; g.fillText('0°', 3, Y(0) - 3);
  return scale;
}
