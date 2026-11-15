// State of the game over the map (J13.2, #310), as in the mock-up of the epics map: battery, clock, packages,
// checks and «Objetivo» on top; Sun and Earth at the bottom left; «Tierra visible» and «Leyenda» at the bottom
// right; the reading of a cell under the map; the rover in orange with its heading.
// The model and the texts are pure (tested); createMapHud builds and refreshes the HTML layer.
import { batteryLevel, batteryValueText } from './battery.js';
import { missionChecks } from './checks.js';
import { gameColors, withAlpha } from './palette.js';

// Hours left before this the clock turns red (prototype rule, renderHud).
export const LATE_HOURS = 48;

// What the layer shows for a drawing: `view` is what is drawn (fractional while moving), `state` the game.
// `earth` is null when the Earth must not be told (no layer on the map: expert, or intermediate with it off).
// `outlook` (#382): earthOutlook of the hour while almost no place sees the Earth (with the layer on), else null.
export function hudModel({ state, view, level, tables, startMs, showEarth, outlook = null }) {
  const hours = Math.floor(view.t);
  const cell = Math.round(view.y) * tables.n + Math.round(view.x);
  const left = Math.max(0, level.deadline - view.t);
  const checks = missionChecks(state);
  return {
    battery: { pct: Math.floor(view.battery), fill: Math.min(100, Math.max(0, view.battery)), tone: batteryLevel(view.battery, level), minBat: level.minBat, raw: view.battery },
    clock: { day: Math.floor(hours / 24) + 1, hour: hours % 24, utc: startMs + view.t * 3600e3, daysLeft: left / 24, late: left < LATE_HOURS },
    packets: { sent: state.sent, need: level.need },
    checks: { packets: checks.packets.done, ready: checks.ready },
    lit: tables.sunFrac(cell, view.t) > 0.5,
    earth: showEarth ? Boolean(tables.seesEarth(cell, view.t)) : null,
    outlook: showEarth && outlook?.few ? { now: outlook.now, riseDay: outlook.riseHour === null ? null : Math.floor(outlook.riseHour / 24) + 1 } : null,
  };
}

// Angle (radians, 0 = north/up, clockwise) of the rover's last step, or towards the pad before the first one.
export function roverHeading(route, pad) {
  const last = route[route.length - 1];
  const prev = route.length > 1 ? route[route.length - 2] : null;
  const to = prev ? last : pad;
  const from = prev ?? last;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dx, -dy);
}

// The rover as in the mock-up: an orange halo, an orange disc with a dark edge and a white core, and a short
// white line in the direction it faces. `u` is the map unit (canvas width / 640).
export function drawRover(ctx, x, y, heading, u, { halo = true } = {}) {
  ctx.save();
  if (halo) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 22 * u);
    g.addColorStop(0, withAlpha(gameColors().sun, 0.35));
    g.addColorStop(1, withAlpha(gameColors().sun, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 22 * u, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#ebe8e2'; ctx.lineWidth = 2 * u; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + Math.sin(heading) * 8 * u, y - Math.cos(heading) * 8 * u);
  ctx.lineTo(x + Math.sin(heading) * 20 * u, y - Math.cos(heading) * 20 * u);
  ctx.stroke();
  ctx.fillStyle = gameColors().sun; ctx.strokeStyle = '#060708'; ctx.lineWidth = 2 * u;
  ctx.beginPath(); ctx.arc(x, y, 6 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(x, y, 2 * u, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Icons of the mock-up (stroke, 24 × 24), decorative.
const ICONS = {
  battery: '<rect x="2.5" y="7" width="17" height="10" rx="2"/><path d="M21.5 10.5v3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  antenna: '<path d="M5 19l5-9M10 10l4 9M7.5 15h5"/><path d="M14.5 6.5a4 4 0 0 1 3 3M14 3.5a7 7 0 0 1 6.5 6.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  earth: '<circle cx="12" cy="12" r="8.5"/><path d="M4 9.5c3 .5 4.5 2 4 4.5s1.5 3 3 5M13 3.8c-.5 2 .5 3.5 2.5 4s3.5 2 3 4"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"/>',
  legend: '<path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10"/>',
};
export function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// Builds the layer inside `stack` (the box of the two map canvases) and the reading line after it.
// onGoal opens the mission goal; legendList is the <ul> of J4.4, shown and hidden by «Leyenda».
export function createMapHud(stack, { onGoal, legendList, earthButton }) {
  const top = el('div', 'map-hud');
  const stat = el('div', 'map-stat');
  const corner = el('div', 'map-corner');
  const legendBtn = el('button', 'lb lb--legend');
  legendBtn.type = 'button';
  legendBtn.id = 'legend-btn';
  if (legendList) {
    legendList.hidden = true;
    legendBtn.setAttribute('aria-controls', legendList.id);
    legendBtn.setAttribute('aria-expanded', 'false');
    legendBtn.addEventListener('click', () => {
      legendList.hidden = !legendList.hidden;
      legendBtn.setAttribute('aria-expanded', String(!legendList.hidden));
    });
  }
  if (earthButton) corner.append(earthButton);
  corner.append(legendBtn);
  stack.append(top, stat, corner);
  const readout = el('p', 'readout');
  readout.id = 'readout';
  stack.after(readout);
  let goalBtn = null;

  // On the map the pills sit outside it, above (battery, clock, packages…) and below (Sun and Earth), so they never
  // cover the cells at its edges; in the cabin and in full screen they go back over the view. The map shrinks by
  // their height (--hud-out) so the page still fits the screen.
  const col = stack.parentElement;
  const outside = () => !stack.classList.contains('cabin-on') && !stack.classList.contains('map-stack--full') && document.fullscreenElement !== stack;
  function place() {
    const out = outside();
    top.classList.toggle('map-hud--out', out);
    stat.classList.toggle('map-stat--out', out);
    if (out && top.parentElement !== col) { col.insertBefore(top, stack); stack.after(stat); }
    else if (!out && top.parentElement !== stack) stack.prepend(top, stat);
    measure();
  }
  function measure() {
    const h = outside() ? top.offsetHeight + stat.offsetHeight : 0;
    col?.style.setProperty('--hud-out', `${h}px`);
  }
  if (col) {
    new MutationObserver(place).observe(stack, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('fullscreenchange', place);
    if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(measure); ro.observe(top); ro.observe(stat); }
    place();
  }

  function render(model, { texts, popChecks = [], reduced = false, showStat = true, showGoal = true, visible = true }) {
    top.hidden = !visible;
    stat.hidden = !visible || !showStat;
    corner.hidden = !visible;
    readout.hidden = !visible;
    legendBtn.replaceChildren(icon('legend'), document.createTextNode(texts.legendButton));
    if (!visible) return;
    const pills = [];
    // Battery: bar coloured by level with the lift-off minimum, and the percentage.
    const b = model.battery;
    const bat = el('span', `pill pill--battery pill--${b.tone}`);
    const meter = el('span', 'batt');
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', texts.hudBattery);
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    meter.setAttribute('aria-valuenow', String(b.pct));
    meter.setAttribute('aria-valuetext', batteryValueText(b.raw, { minBat: b.minBat }, texts));
    const fill = el('b');
    fill.style.width = `${b.fill}%`;
    const mark = el('s');
    mark.style.left = `${b.minBat}%`;
    meter.append(fill, mark);
    const pct = el('span', 'pill__value', `${b.pct} %`);
    pct.setAttribute('aria-hidden', 'true');
    bat.title = texts.hudBatteryTitle;
    bat.append(icon('battery'), meter, pct);
    pills.push(bat);
    // Clock: day and hour, UTC date and the days left (red under LATE_HOURS).
    const c = model.clock;
    const clock = el('span', 'pill pill--clock');
    clock.append(icon('clock'), el('span', 'pill__value', texts.clock(c.day, c.hour)),
      el('span', 'pill__lab', texts.hudUtcShort(c.utc)), el('span', `pill__lab${c.late ? ' pill__lab--late' : ''}`, texts.hudDaysLeft(c.daysLeft)));
    clock.title = texts.hudClock;
    pills.push(clock);
    // Packages: one square each, filled when sent, and the figure.
    const p = model.packets;
    const pk = el('span', 'pill pill--packets');
    const squares = el('span', 'pk');
    squares.setAttribute('aria-hidden', 'true');
    for (let k = 0; k < p.need; k++) squares.append(el('span', k < p.sent ? 'on' : ''));
    const figure = el('span', 'pill__value', texts.packetsValue(p.sent, p.need));
    figure.setAttribute('aria-label', texts.packetsLabel(p.sent, p.need));
    pk.title = texts.hudPackets;
    pk.append(icon('antenna'), squares, figure);
    pills.push(pk);
    // Checks (J6.3): packages sent and ready to lift off, popping once when just met.
    const checks = el('span', 'pill pill--checks');
    for (const [id, done, text] of [['packets', model.checks.packets, texts.checkPackets(p.sent, p.need)], ['ready', model.checks.ready, texts.checkReady]]) {
      const ck = el('span', `ck${done ? ' on' : ''}${popChecks.includes(id) && !reduced ? ' pop' : ''}`);
      const tick = el('i', '', '✓');
      tick.setAttribute('aria-hidden', 'true');
      ck.append(tick, text);
      if (done) ck.setAttribute('aria-label', `${text}: ${texts.checkDone}`);
      checks.append(ck);
    }
    pills.push(checks);
    if (showGoal) {
      // Kept across repaints, so the focus stays on it after opening and closing the goal.
      if (!goalBtn) {
        goalBtn = el('button', 'pill pill--act');
        goalBtn.type = 'button';
        goalBtn.id = 'goal-btn';
        goalBtn.addEventListener('click', () => onGoal?.(goalBtn));
      }
      goalBtn.replaceChildren(icon('route'), document.createTextNode(texts.goalButton));
      pills.push(goalBtn);
    }
    top.replaceChildren(...pills);
    // Sun and Earth at the rover (the Earth only while its layer is on the map).
    const sun = el('span', `pill pill--sun${model.lit ? ' on' : ''}`);
    sun.append(icon('sun'), document.createTextNode(model.lit ? texts.statLit : texts.statDark));
    const stats = [sun];
    if (model.earth !== null) {
      const earth = el('span', `pill pill--earth${model.earth ? ' on' : ''}`);
      earth.append(icon('earth'), document.createTextNode(model.earth ? texts.statEarth : texts.statNoEarth));
      stats.push(earth);
    }
    // #382: almost no place sees the Earth now; how many and the day it rises.
    if (model.outlook) {
      const out = el('span', 'pill pill--outlook');
      out.append(icon('earth'), document.createTextNode(texts.outlookPill(model.outlook)));
      stats.push(out);
    }
    stat.replaceChildren(...stats);
  }

  // The reading line under the map: the column and row in bold, then the rest of the cursor report.
  function setReadout(head, rest) {
    readout.replaceChildren(el('b', '', head), document.createTextNode(rest ? ` ${rest}` : ''));
  }

  return { render, setReadout, readout };
}

// Which of the cells (indices on an n-wide grid) get a label: the first of each group, none closer than `minCells`
// to a labelled one, so two cells side by side do not stack the same label twice (#382).
export function spotLabels(cells, n, minCells = 3) {
  const kept = [];
  for (const i of cells) {
    const x = i % n, y = Math.floor(i / n);
    if (kept.every((k) => Math.hypot((k % n) - x, Math.floor(k / n) - y) >= minCells)) kept.push(i);
  }
  return new Set(kept);
}

// The reading line of a cell: the same words as the cursor announcement (J10.3), split as «col·row» + the rest.
export function readoutParts(report, rover, texts) {
  const text = texts.liveCursor({ ...report }, false);
  const rest = text.split(' · ').slice(1).join(' · ');
  return { head: `${report.col}·${report.row}`, rest: rover ? `${rest} · ${texts.readoutRover}` : rest };
}

// Where the rover points while driving from the cabin (J12): a translucent cone of view, a dashed line `cells` long
// ahead and an arrow at its end, sized in cells so it reads on the minimap too. `heading` in radians from north.
export function drawHeadingCone(ctx, x, y, heading, c, cells) {
  const sx = Math.sin(heading), sy = -Math.cos(heading);
  const half = (32 * Math.PI) / 180, r = cells * 0.75 * c;
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, withAlpha(gameColors().sun, 0.38));
  g.addColorStop(1, withAlpha(gameColors().sun, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.arc(x, y, r, heading - Math.PI / 2 - half, heading - Math.PI / 2 + half);
  ctx.closePath(); ctx.fill();
  const ex = x + sx * cells * c, ey = y + sy * cells * c;
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1.5, c * 0.22); ctx.setLineDash([c * 0.5, c * 0.35]);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.setLineDash([]);
  const a = c * 0.9, px = -sy, py = sx;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(ex + sx * a, ey + sy * a);
  ctx.lineTo(ex + px * a * 0.6, ey + py * a * 0.6);
  ctx.lineTo(ex - px * a * 0.6, ey - py * a * 0.6);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
