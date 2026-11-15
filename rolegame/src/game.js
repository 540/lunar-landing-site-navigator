// Game screen (J0.4): loads the scenario tables, draws the map and wires taps to the engine.
// The client never computes relief, masks or Sun: it reads tables and calls the engine.
import { texts } from './texts.js';
import { cellReport, keyAction, missionStatus, SHORTCUTS, cellAnnounceDue } from './cell-report.js';
import { createTables, newGame, sentTooClose, move, stepCost, slope } from './engine/index.js';
import { decideAction, moveDurationMs, animationProgress, previewAlert, previewAnnouncement, enterAction } from './tap.js';
import { createHint, padDistanceKm, pulsePhase } from './hint.js';
import { WAIT_ACTIONS, waitDisabled, waitDurationMs, waitAnnouncement, hasEarth } from './wait.js';
import { darkHours } from './battery.js';
import { announceHint } from './energy-hint.js';
import { liftoffStatus, liftoffMessage, zoneWords } from './liftoff.js';
import { transmitLabel, transmitDisabled, transmitBlock, transmitReason, seesEarthNow, runTransmit, transmitAnnouncement } from './transmit.js';
import { earthLayerOn, earthCells } from './earth-layer.js';
import { earthOutlook, earthForecastCells, nextEarthHour, fewThreshold, outlookDay, FORECAST_HOURS } from './earth-outlook.js';
import { cellMask, ringSeries, seriesRow, bearingPoint } from './ring.js';
import { missionHintText } from './mission-hint.js';
import { bearing } from '../../web/js/common/sky-polar.js';
import { drawStrip } from './horizon-strip.js';
import { buttonKey, BUTTON_ICONS, ICON_PATHS } from './panel-actions.js';
import { createBackdrop } from './map-backdrop.js';
import { TRIALS, trialById, nextPhase, introSteps, stepIndex, answerTrial, introHour, SHADOW_ANIM, shadowChange,
  batteryCurves, earthWindow, missionDay, EARTH_TRIAL_HOUR } from './intro.js';
import { stepsBar, landingPanel, trialPanel, batteryMini } from './intro-panel.js';
import { withFacts } from './facts-texts.js';
import { windWord } from './mission-hint.js';
import { endAnnouncement, endSummary } from './end.js';
import { endPanel, illuminationBlock, referenceBlock } from './end-panel.js';
import { referenceFor, replayReference, compareWithReference } from './reference.js';
import { illumination, illuminationSummary, illuminationPixels } from './illumination.js';
import { MAP_COLORS, legendItems, sentRadiusPx, scaleBar, compassPoint, drawLabel, drawPad, drawBearing, drawScale, renderLegend } from './map-legend.js';
import { sampleAt } from '../../viewpoint/src/core/series.js';
import { LEVEL_IDS, levelSearch, panelStatus } from './level.js';
import { newlyDone } from './checks.js';
import { levelHint, earthToggleShown } from './aids.js';
import { logLines, logText, newEvents } from './event-log.js';
import { goalSteps, GOAL_ICONS } from './goal.js';
import { scenarioId, scenarioPath, levelsFor } from './scenario-source.js';
import { gameColors, withAlpha } from './palette.js';
import { hudModel, roverHeading, drawRover, drawHeadingCone, createMapHud, readoutParts, spotLabels, icon as mapIcon } from './map-hud.js';

// Length of the lift-off on the map (J12.8), ms.
const MAP_LIFT_MS = 2600;
// Planned route that fails (J1.2): --bad if the battery runs out, --warn if it arrives below the minimum (#341).
const severityColor = (severity) => ({ depleted: gameColors().bad, low: gameColors().warn })[severity];
// Earth under the horizon on the map; in sight it is --earth of game.css.
const EARTH_DIM = '#36597f';
const RING_HEIGHT = 80;
// Colours of the panoramic ring (J13.4), as in the mock-up: --sun and --earth of game.css for the bodies.
const STRIP_COLORS = {
  skyTop: '#050608', skyBottom: '#0b0d10', zero: 'rgba(255,255,255,.14)', ground: '#2c3036', skyline: '#4a4f57', label: '#8c9198',
};
const stripColors = () => {
  const { sun, earth } = gameColors();
  return { ...STRIP_COLORS, sunTrack: withAlpha(sun, 0.4), sun, earth };
};
const SVG_NS = 'http://www.w3.org/2000/svg';
// Stroked 24 × 24 icon of panel-actions.js, hidden from screen readers (the button has its text).
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'i');
  for (const d of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
// Key badge of a button («T», «⇧E», «Intro»), hidden from screen readers (aria-keyshortcuts says it).
function kbd(text) {
  const k = document.createElement('kbd'); k.textContent = text; k.setAttribute('aria-hidden', 'true');
  return k;
}
// Button content: icon (optional), label and key badge (optional).
function fillButton(b, label, { iconName = null, key = null } = {}) {
  b.replaceChildren();
  if (iconName) b.append(icon(iconName));
  const span = document.createElement('span'); span.textContent = label; b.append(span);
  if (key) b.append(kbd(key));
}
// Reference route of the end (J7.3): dashed, apart from the player's white route and the amber map.
const REFERENCE_COLOR = '#c58cff';

// Dictionary of the language in use (J10.1). Every visible text and announcement reads it when it is shown,
// so switching language repaints with the new one without touching the game.
let TEXTS = texts('es');

const fetchJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); });
const fetchBuffer = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); });
const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(url));
  img.src = url;
});

// `onPlay` runs the first time the mission starts (after the introduction): the tutorial and the goal go there.
// `levelId` and `seed` come from the address (J6.1, J6.4); `levelButtons` are the header buttons of the level.
// `onTime(t)` hears the game clock on every drawing (the 3D Moon, J8.1); with `isMapHidden()` true (the «Luna 3D» tab
// on a phone, J8.2) the map is not painted.
// `quality` is the map quality picked in «Ajustes» (J13.3) and `stepsHost` the element under the header that holds the
// steps bar; without it, the bar goes at the top of the panel as before.
export async function startGame(canvas, panel, { lang = 'es', isReduced = null, onPlay, mapMode = null, onMapMode = null,
  levelId = 'beg', seed = null, levelButtons = [], onTime = null, isMapHidden = null, quality = null, stepsHost = null } = {}) {
  TEXTS = texts(lang);
  panel.textContent = TEXTS.loading;
  let scenario, level, levels, tables, mapImg, masks, series;
  // Folder of the scenario that loads (J9.2): the map backdrop (J4) reads its textures from it too.
  let DATA;
  try {
    let sunBuf, cellsBuf, earthBuf, masksBuf;
    // Scenario of rolegame/data/scenarios.json, or ?scenario=<id> to compare candidates (J9.2).
    DATA = scenarioPath(scenarioId(await fetchJson('data/scenarios.json'), location.search));
    [scenario, levels, sunBuf, cellsBuf, earthBuf, masksBuf, series, mapImg] = await Promise.all([
      fetchJson(`${DATA}scenario.json`),
      fetchJson('data/levels.json'),
      fetchBuffer(`${DATA}sun.bin`),
      fetchBuffer(`${DATA}cells.bin`),
      fetchBuffer(`${DATA}earth.bin`),
      fetchBuffer(`${DATA}masks.bin`),
      fetchJson(`${DATA}series.json`),
      loadImage(`${DATA}map.png`),
    ]);
    // #313: a scenario may change some level fields (Mons Mouton shortens the deadline).
    levels = levelsFor(levels, scenario);
    level = levels[LEVEL_IDS.includes(levelId) ? levelId : 'beg'];
    tables = createTables(sunBuf, scenario, cellsBuf, earthBuf);
    // Int16 little-endian, like every browser host.
    masks = new Int16Array(masksBuf);
    if (masks.length !== scenario.files.masks.length) throw new Error('masks.bin');
  } catch {
    panel.textContent = TEXTS.loadError;
    return;
  }

  const n = tables.n;
  const ctx = canvas.getContext('2d');
  // Relief under everything (J4.1): WebGL on #map-gl when it can, map.png and the shade veil otherwise.
  const backdrop = await createBackdrop({
    canvas, glCanvas: document.getElementById('map-gl'), scenario, tables, series,
    images: { map: mapImg }, load: loadImage, data: DATA, savedMode: mapMode, savedQuality: quality, redraw: () => draw(),
    // J10.4: the game goes on in light mode with the same state; a lost context is said in the panel and aloud.
    onLost: () => {
      if (!lightByHand) { message = TEXTS.mapLost; renderPanel(); announce(TEXTS.mapLost); }
      draw();
      onMapMode?.('light');
    },
  });
  let lightByHand = false;
  const startMs = Date.parse(scenario.startUtc);
  // «Tierra visible» layer (J3.2): an n × n overlay repainted only when the whole hour changes.
  const earthOverlay = document.createElement('canvas');
  earthOverlay.width = n; earthOverlay.height = n;
  const earthCtx = earthOverlay.getContext('2d');
  // The «Tierra visible» button (J6.5) switches the layer in the levels that allow it; off at each new mission.
  let earthToggled = false;
  const showEarthLayer = () => earthLayerOn(level, earthToggled);
  // Seed of the event (J6.4): fixed by ?seed= for the demo game, drawn here (never in the engine) otherwise.
  const newSeed = () => seed ?? 1 + Math.floor(Math.random() * 999999);
  const freshGame = () => newGame(scenario, level, tables, { seed: newSeed() });
  // Checks that have just been met (J6.3): they pop once, on the rebuild right after the action.
  let popChecks = [];
  // Introduction (J5): 'landing', a trial id or 'play'. Before the mission the map cannot be planned on.
  let phase = 'landing';
  const answers = {};
  let introTok = 0;
  let played = false;
  // The earth trial shows the layer once answered; the mission, as the level says.
  const earthOnMap = () => (phase === 'play' ? showEarthLayer() : phase === 'earth' && answers.earth !== undefined);
  let earthHour = null;
  let earthList = [];
  // #382: cells that will see the Earth in the next hours (striped) and whether the few current ones get a ring.
  let forecastList = [];

  let state = freshGame();
  let busy = false;
  // Route planned by the last tap, waiting for «Conducir» or «Cancelar» (null when none).
  let plan = null;
  let message = '';
  // Hint shown in the panel (J2.4 and J3.5): a missionHint key or null (general help).
  let hintKey = levelHint(state, level);
  let cursor = { x: scenario.pad.x, y: scenario.pad.y };
  // What is drawn: rover position (fractional while it moves), route and clock.
  let view = { x: state.x, y: state.y, t: state.t, route: state.route, battery: state.battery };

  const cell = () => canvas.width / n;

  // Pad hint (J1.3): pulse on the pad and a guide line to the rover, for a few seconds at the start.
  // Reduced motion (J10.2): the caller decides (system preference or the header switch); without it, the system.
  const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = isReduced ?? (() => systemReduced.matches);
  const padKm = padDistanceKm(scenario, scenario.grid.cellM);
  const padHint = createHint({
    now: () => performance.now(),
    isReduced: reduced,
    raf: (f) => requestAnimationFrame(f),
    cancelRaf: (id) => cancelAnimationFrame(id),
    setTimer: (f, ms) => setTimeout(f, ms),
    clearTimer: (id) => clearTimeout(id),
    onFrame: () => draw(),
    onStart: () => announce(TEXTS.liveStart(padKm, scenario.pad.x - scenario.start.x, scenario.start.y - scenario.pad.y)),
  });

  function drawHint(c) {
    const elapsed = padHint.elapsed();
    const reducedNow = reduced();
    const k = pulsePhase(elapsed, reducedNow);
    const px = (scenario.pad.x + 0.5) * c, py = (scenario.pad.y + 0.5) * c;
    const rx = (view.x + 0.5) * c, ry = (view.y + 0.5) * c;
    const u = c / 6;
    ctx.save();
    if (!reducedNow) {
      for (const o of [0, 0.5]) {
        const q = (k + o) % 1;
        ctx.strokeStyle = withAlpha(gameColors().sun, (1 - q) * 0.9); ctx.lineWidth = 2.5 * u;
        ctx.beginPath(); ctx.arc(px, py, (12 + q * 38) * u, 0, Math.PI * 2); ctx.stroke();
      }
    }
    const dx = px - rx, dy = py - ry, len = Math.hypot(dx, dy);
    if (len > 40 * u) {
      const ux = dx / len, uy = dy / len;
      const sx = rx + ux * 26 * u, sy = ry + uy * 26 * u, ex = px - ux * 20 * u, ey = py - uy * 20 * u;
      ctx.strokeStyle = withAlpha(gameColors().sun, 0.9); ctx.lineWidth = 2.5 * u; ctx.setLineDash([8 * u, 7 * u]);
      ctx.lineDashOffset = -k * 30 * u;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = gameColors().sun;
      ctx.beginPath(); ctx.moveTo(ex + ux * 10 * u, ey + uy * 10 * u);
      ctx.lineTo(ex - uy * 7 * u, ey + ux * 7 * u); ctx.lineTo(ex + uy * 7 * u, ey - ux * 7 * u);
      ctx.closePath(); ctx.fill();
      ctx.font = `600 ${Math.round(c * 0.9)}px "JetBrains Mono", monospace`; ctx.textAlign = 'center';
      ctx.fillStyle = gameColors().sun; ctx.fillText(TEXTS.hintDistance(padKm), (rx + px) / 2, (ry + py) / 2 - 10 * u);
    }
    ctx.restore();
  }

  // Screen-reader feedback: updated on cursor moves and when a move ends, never per animation frame.
  const live = document.createElement('div');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  panel.after(live);
  // Clears the region first: screen readers only speak a polite region when its content changes.
  const announce = (text) => {
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = text; });
  };
  const movedText = () => {
    const h = Math.floor(state.t);
    return TEXTS.liveMoved(Math.floor(state.battery), Math.floor(h / 24) + 1, h % 24);
  };

  function paintEarth(hour) {
    const h = Math.floor(hour);
    if (h === earthHour) return;
    earthHour = h;
    earthList = earthCells(tables, h);
    forecastList = earthForecastCells(tables, h);
    const img = earthCtx.createImageData(n, n);
    for (const i of earthList) {
      img.data[i * 4] = 79; img.data[i * 4 + 1] = 157; img.data[i * 4 + 2] = 240; img.data[i * 4 + 3] = 95;
    }
    earthCtx.putImageData(img, 0, 0);
  }

  // Cells that see the Earth now: translucent blue and a dot in the middle, so it does not rely on colour alone.
  function drawEarthLayer(c) {
    paintEarth(view.t);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(earthOverlay, 0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = 'rgba(120,180,255,.85)';
    ctx.beginPath();
    for (const i of earthList) {
      const x = ((i % n) + 0.5) * c, y = (Math.floor(i / n) + 0.5) * c;
      ctx.moveTo(x + c * 0.14, y);
      ctx.arc(x, y, c * 0.14, 0, Math.PI * 2);
    }
    ctx.fill();
    drawEarthForecast(c);
    if (earthList.length > 0 && earthList.length < fewThreshold(tables)) drawEarthSpots(c);
  }

  // #382: cells that will see the Earth within FORECAST_HOURS, as light diagonal stripes (they read in greyscale).
  function drawEarthForecast(c) {
    if (!forecastList.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,180,255,.7)'; ctx.lineWidth = Math.max(1, c * 0.09);
    ctx.beginPath();
    for (const i of forecastList) {
      const x = (i % n) * c, y = Math.floor(i / n) * c;
      ctx.moveTo(x, y + c * 0.5); ctx.lineTo(x + c * 0.5, y);
      ctx.moveTo(x, y + c); ctx.lineTo(x + c, y);
      ctx.moveTo(x + c * 0.5, y + c); ctx.lineTo(x + c, y + c * 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  // #382: with only a few cells seeing the Earth, each gets a double ring and a label so it is not missed.
  function drawEarthSpots(c) {
    const u = canvas.width / 640;
    ctx.save();
    const labelled = spotLabels(earthList, n);
    for (const i of earthList) {
      const x = ((i % n) + 0.5) * c, y = (Math.floor(i / n) + 0.5) * c, r = Math.max(c * 1.6, 14 * u);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(6,7,8,.8)'; ctx.lineWidth = 5 * u; ctx.stroke();
      ctx.strokeStyle = MAP_COLORS.earth; ctx.lineWidth = 2.5 * u; ctx.stroke();
      if (!labelled.has(i)) continue;
      const ly = y - r - 6 * u < 14 * u ? y + r + 16 * u : y - r - 6 * u;
      ctx.font = `600 ${Math.round(12 * u)}px "JetBrains Mono", monospace`;
      const half = ctx.measureText(TEXTS.earthSpot).width / 2 + 7 * u;
      drawLabel(ctx, TEXTS.earthSpot, Math.min(canvas.width - half, Math.max(half, x)), ly, MAP_COLORS.earth, u);
    }
    ctx.restore();
  }

  // Zones already surveyed (J3.6): a dashed circle of level.txMinKm around each cell a package went from.
  function drawSentZones(c) {
    const from = state.sentFrom ?? [];
    if (!from.length || !(level.txMinKm > 0)) return;
    const r = sentRadiusPx(level.txMinKm, scenario.grid.cellM, c), u = canvas.width / 640;
    ctx.save();
    for (const p of from) {
      const x = (p.x + 0.5) * c, y = (p.y + 0.5) * c;
      // A dark halo under the dashed line, so it reads over sunlit ground and over the blue layer.
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6,7,8,.18)'; ctx.fill();
      ctx.setLineDash([]); ctx.strokeStyle = 'rgba(6,7,8,.75)'; ctx.lineWidth = 4.5 * u; ctx.stroke();
      ctx.setLineDash([7 * u, 5 * u]); ctx.strokeStyle = MAP_COLORS.sent; ctx.lineWidth = 2.5 * u; ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, y, 4 * u, 0, Math.PI * 2);
      ctx.fillStyle = MAP_COLORS.sent; ctx.fill(); ctx.strokeStyle = '#060708'; ctx.lineWidth = 1.5 * u; ctx.stroke();
    }
    ctx.restore();
  }

  // Bearing of the Earth on the map border (J3.4): blue arrow, dim under the horizon, with its elevation.
  function drawEarthArrow() {
    const row = seriesRow(tables.hours, view.t);
    const az = series.earth.az[row], el = series.earth.el[row];
    const w = canvas.width, u = w / 640;
    const p = bearingPoint(az, w, 14 * u);
    const color = el > 0 ? gameColors().earth : EARTH_DIM;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    ctx.fillStyle = color; ctx.strokeStyle = '#060708'; ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.moveTo(0, -9 * u); ctx.lineTo(7.5 * u, 5 * u); ctx.lineTo(-7.5 * u, 5 * u); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    const inner = bearingPoint(az, w, 44 * u);
    const text = TEXTS.earthArrow(el);
    ctx.font = `600 ${Math.round(12 * u)}px "JetBrains Mono", monospace`;
    const tw = ctx.measureText(text).width;
    const x = Math.max(tw / 2 + 6 * u, Math.min(w - tw / 2 - 6 * u, inner.x)), y = inner.y;
    ctx.fillStyle = 'rgba(6,7,8,.75)'; ctx.fillRect(x - tw / 2 - 4 * u, y - 10 * u, tw + 8 * u, 15 * u);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, x, y + 1 * u);
  }

  // Illumination map of the end (J7.2): computed once when the game ends, from sun.bin.
  const illumOverlay = document.createElement('canvas');
  illumOverlay.width = n; illumOverlay.height = n;
  let illumFor = null;
  let illumSum = null;
  const endMap = () => phase === 'play' && Boolean(state.over) && !busy;
  // Reference route (J7.3): solver.json is asked for apart and without blocking; without it there is no block.
  let solver = null;
  fetchJson(`${DATA}solver.json`).then((json) => { solver = json; if (endMap()) { renderPanel(); draw(); } }).catch(() => {});
  let refFor = null;
  let refData = null;
  function endReference() {
    if (refFor !== state) {
      refFor = state;
      const reference = referenceFor(solver, LEVEL_IDS.find((id) => levels[id] === level));
      refData = reference
        ? { route: reference.route, comparison: compareWithReference(state, replayReference(scenario, level, tables, reference)) }
        : null;
    }
    return refData;
  }
  function drawReference(c) {
    const ref = endReference();
    if (!ref) return;
    ctx.save();
    ctx.strokeStyle = REFERENCE_COLOR; ctx.lineWidth = 2.5; ctx.setLineDash([7, 5]); ctx.lineJoin = 'round';
    ctx.beginPath();
    ref.route.forEach((p, i) => {
      const x = (p.x + 0.5) * c, y = (p.y + 0.5) * c;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }
  function endIllumination() {
    if (illumFor !== state) {
      illumFor = state;
      const illum = illumination(tables, state.t);
      illumSum = illuminationSummary(illum, state);
      illumOverlay.getContext('2d').putImageData(new ImageData(illuminationPixels(illum), n, n), 0, 0);
    }
    return illumSum;
  }
  // map.png (darkened) covers the WebGL relief; the amber layer goes on top in 'screen' mode (prototype illumLayer).
  function drawIllumination() {
    endIllumination();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mapImg, 0, 0, canvas.width, canvas.height);
    // Darkened first, like the prototype's lit terrain at the pole, so the amber reads on top.
    ctx.fillStyle = 'rgba(6,7,8,.68)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(illumOverlay, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  // The end adds the illumination summary to the title and the explanation (said once).
  const endText = () => `${endAnnouncement(state, TEXTS)} ${TEXTS.illumSummary(endIllumination().bestPct, endIllumination().herePct)}`;

  // Sun's bearing on the border and the scale bar (J4.4), at the clock of the drawing (also while animating).
  const scale = scaleBar(scenario.grid.cellM);
  const sunAt = (t) => sampleAt(series, new Date(startMs + Math.min(Math.max(t, 0), series.count - 1) * 3600e3)).sun;
  function drawMapMarks(c) {
    const u = canvas.width / 640, sun = sunAt(view.t);
    drawBearing(ctx, sun.az, MAP_COLORS.sun, TEXTS.sunArrow(sun.el), canvas.width, u);
    // Raised over the «Tierra visible» and «Leyenda» buttons of the map corner (J13.2).
    drawScale(ctx, TEXTS.scaleKm(scale.km), scale.cells, c, canvas.width, u, 84);
  }

  // Legend under the map (J4.4): rebuilt when a move, a wait or a language switch ends, not on every frame.
  const legendList = document.getElementById('legend');
  function updateLegend() {
    if (!legendList) return;
    const sun = sunAt(state.t);
    renderLegend(legendList, legendItems({ earthLayer: showEarthLayer(), sent: state.sentFrom?.length ?? 0 }), TEXTS, TEXTS.legendSun(TEXTS.winds[compassPoint(sun.az).toUpperCase()], sun.el));
  }

  // Heading of the car while the cabin is shown (J12; null on the map), set by setCabinHeading.
  let cabinHeading = null, headingFrame = 0;
  // How long a route takes seen from the cabin, (cells, reduced) → ms: given by the cabin (J12.4, #403); null without it.
  let cabinPace = null;
  function draw() {
    onTime?.(view.t, view);
    if (isMapHidden?.()) return;
    const c = cell();
    const ended = endMap();
    if (ended) drawIllumination();
    else backdrop.paint(ctx, view.t);
    if (!ended && earthOnMap()) drawEarthLayer(c);
    if (!ended && phase === 'play') drawSentZones(c);
    if (ended && solver) drawReference(c);
    // Route walked: white over the illumination map of the end.
    ctx.strokeStyle = ended ? '#ffffff' : gameColors().sun; ctx.lineWidth = ended ? 2.5 : 2; ctx.setLineDash(ended ? [] : [5, 4]);
    ctx.beginPath();
    view.route.forEach((p, i) => {
      const px = (p.x + 0.5) * c, py = (p.y + 0.5) * c;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.lineTo((view.x + 0.5) * c, (view.y + 0.5) * c);
    ctx.stroke();
    // Planned route still ahead of the rover (only while it moves).
    if (view.plan && view.plan.length > 0) {
      ctx.strokeStyle = '#ebe8e2'; ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo((view.x + 0.5) * c, (view.y + 0.5) * c);
      view.plan.forEach((p) => ctx.lineTo((p.x + 0.5) * c, (p.y + 0.5) * c));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Planned route (J1.2): dashed, red if the battery runs out, yellow if it arrives below the minimum.
    if (plan && !busy) {
      ctx.strokeStyle = severityColor(plan.preview.severity) || '#ebe8e2';
      ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo((state.x + 0.5) * c, (state.y + 0.5) * c);
      plan.path.forEach((p) => ctx.lineTo((p.x + 0.5) * c, (p.y + 0.5) * c));
      ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = severityColor(plan.preview.severity) || '#ebe8e2';
      ctx.strokeRect((plan.target.x + 0.1) * c, (plan.target.y + 0.1) * c, c * 0.8, c * 0.8);
    }
    // Ascent pad (J4.4): light circle and rhombus, with its name on a dark box.
    const px = (scenario.pad.x + 0.5) * c, py = (scenario.pad.y + 0.5) * c, mu = canvas.width / 640;
    drawPad(ctx, px, py, mu, { lift: padLift() });
    drawLabel(ctx, TEXTS.padLabel, px, py - 17 * mu, MAP_COLORS.pad, mu);
    // Rover (J13.2): orange with a halo and its heading, as in the mock-up. Driving from the cabin (J12), the heading is
    // the car's, live, with a cone of view and a 1 km dashed line ahead, so the minimap says where the rover goes.
    if (cabinHeading !== null && phase === 'play' && !ended) {
      drawHeadingCone(ctx, (view.x + 0.5) * c, (view.y + 0.5) * c, cabinHeading, c, 1000 / scenario.grid.cellM);
    }
    drawRover(ctx, (view.x + 0.5) * c, (view.y + 0.5) * c, cabinHeading ?? roverHeading(view.route, scenario.pad), mu, { halo: !reduced() });
    if (!ended) drawEarthArrow();
    drawMapMarks(c);
    if (padHint.active()) drawHint(c);
    // Keyboard cursor, only while the canvas has focus from the keyboard (not after a click or tap).
    if (canvas.matches(':focus-visible')) {
      ctx.strokeStyle = gameColors().sun; ctx.lineWidth = 3;
      ctx.strokeRect(cursor.x * c, cursor.y * c, c, c);
    }
  }

  // State over the map (J13.2): refreshed with the panel, also on every frame of an animation.
  function renderHud() {
    const visible = phase === 'play';
    mapHud.render(hudModel({ state, view, level, tables, startMs, showEarth: earthOnMap(), outlook: phase === 'play' ? earthOutlook(tables, view.t) : null }), {
      texts: TEXTS, popChecks, reduced: reduced(), visible, showStat: !state.over, showGoal: !state.over,
    });
    if (visible) showReadout();
    const goalBtn = document.getElementById('goal-btn');
    if (goalBtn && SHORTCUTS.goal) shortcutHint(goalBtn, SHORTCUTS.goal);
  }
  // #382: whole hours until a cell sees the Earth, within the forecast of the layer (null beyond it).
  function earthInHours(i, hour) {
    const next = nextEarthHour(tables, i, hour, Math.floor(hour) + FORECAST_HOURS + 1);
    return next === null ? null : Math.max(1, next - Math.floor(hour));
  }
  // Cell of the reading line: the hovered or keyboard cell, or the rover's.
  let readoutCell = null;
  function showReadout() {
    const cellAt = readoutCell ?? { x: Math.round(view.x), y: Math.round(view.y) };
    const report = cellReport({
      tables, scenario, cell: cellAt, hour: view.t,
      seesEarth: earthOnMap() ? tables.seesEarth : null,
      nearSent: (cell) => sentTooClose(state, cell),
      earthIn: earthInHours,
    });
    const parts = readoutParts(report, cellAt.x === Math.round(view.x) && cellAt.y === Math.round(view.y), TEXTS);
    mapHud.setReadout(parts.head, parts.rest);
  }

  function renderPanel() {
    renderHud();
    if (phase !== 'play') { renderIntro(); syncLevelButtons(); syncEarthToggle(); return; }
    showSteps(state.over ? 'end' : 'play');
    if (!busy) updateLegend();
    // End (J7.1): the game panel (rows, actions, hint, preview) gives way to the end panel.
    canvas.setAttribute('aria-label', endMap() ? TEXTS.mapLabelEnd : TEXTS.mapLabel);
    if (state.over && !busy) {
      const extra = [illuminationBlock({ summary: endIllumination(), texts: factsTexts() })];
      const ref = solver ? endReference() : null;
      if (ref) extra.push(referenceBlock({ comparison: ref.comparison, texts: TEXTS }));
      const more = endExtra?.();
      if (more) extra.push(more);
      panel.append(endPanel({ state, scenario, texts: TEXTS, onPlayAgain: restart, extra }));
      return;
    }
    // Mission goal (J13.4): «Parte 2 · Atascados» and the figures in bold, as in the mock-up.
    const kicker = document.createElement('p');
    kicker.className = 'kicker'; kicker.textContent = TEXTS.missionKicker;
    const goal = document.createElement('p');
    goal.className = 'goal';
    goal.tabIndex = -1;
    for (const part of TEXTS.goalRich(level.need, level.minBat, Math.ceil(level.deadline / 24))) {
      if (typeof part === 'string') goal.append(part);
      else { const b = document.createElement('b'); b.textContent = part.b; goal.append(b); }
    }
    panel.append(kicker, goal);
    // Battery, clock, packages, checks and «Objetivo» are on the map now (J13.2); the panel keeps the rest.
    const rows = [
      [TEXTS.hudMinBattery, minMark()],
      [TEXTS.hudPanels, panelsValue()],
      [TEXTS.hudDarkHours, TEXTS.darkHoursValue(darkHours(view.battery, level))],
      [TEXTS.hudDeadline, TEXTS.deadline(Math.ceil(level.deadline / 24))],
    ];
    const dl = document.createElement('dl');
    dl.className = 'hud';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.append(v);
      dl.append(dt, dd);
    }
    panel.append(dl);
    if (showEarthLayer()) {
      const legend = document.createElement('p');
      legend.className = 'legend-earth'; legend.textContent = TEXTS.earthLegend;
      panel.append(legend);
    }
    // The planned route goes right after the goal, before the buttons, as in the mock-up (J13.4).
    if (plan && !busy) panel.append(previewBox());
    panel.append(actionsBox());
    // At ASCENSO without clearance (#398): what is missing, what to do, and «Despegar» off with that reason.
    const lift = busy ? null : liftoffNow();
    if (lift?.message) panel.append(liftoffBox(lift.message));
    // Mission hint (J2.4 and J3.5) in place of the usual help, recalculated when the state changes.
    const hint = document.createElement('p');
    hint.className = !hintKey ? 'hint' : hintKey === 'shadow-low' ? 'hint hint--energy' : 'hint hint--earth';
    const hintSpan = document.createElement('span');
    hintSpan.textContent = hintText(hintKey) ?? TEXTS.hudHint;
    if (hintKey) hint.append(icon('warn'));
    hint.append(hintSpan);
    panel.append(hint);
    if (state.log.length) panel.append(logBox());
    panel.append(ringBox);
    drawRing();
    syncLevelButtons();
    syncEarthToggle();
    if (message) {
      const warn = document.createElement('p');
      warn.className = 'warn'; warn.textContent = message;
      panel.append(warn);
    }
  }

  // «Paneles» row (J6.1): what the panels do now in the rover's cell, with the engine's thresholds.
  function panelsValue() {
    const status = panelStatus({ tables, level, x: Math.round(view.x), y: Math.round(view.y), t: view.t });
    const span = document.createElement('span');
    span.className = `panels panels--${status}`;
    span.textContent = TEXTS.panelStatus[status];
    return span;
  }

  // Log of the game (J6.4): the 4 latest entries, newest first; events in yellow.
  function logBox() {
    const box = document.createElement('section');
    box.className = 'log';
    const h = document.createElement('h2'); h.textContent = TEXTS.logTitle;
    const ul = document.createElement('ul');
    for (const line of logLines(state, TEXTS)) {
      const li = document.createElement('li');
      if (line.event) li.className = 'ev';
      li.textContent = line.text;
      ul.append(li);
    }
    box.append(h, ul);
    return box;
  }

  // Horizon ring (J3.4, panoramic since J13.4): one box kept across panel rebuilds, redrawn only when the cell or
  // the whole hour changes.
  const ringBox = document.createElement('section');
  ringBox.className = 'ringbox';
  const ringHead = document.createElement('h2');
  ringHead.className = 'ringbox__head';
  const ringTitle = document.createElement('span'); ringTitle.textContent = TEXTS.ringTitle;
  const ringNote = document.createElement('span'); ringNote.className = 'ringbox__note';
  ringHead.append(ringTitle, ringNote);
  const ringCanvas = document.createElement('canvas');
  ringCanvas.className = 'ring';
  ringCanvas.setAttribute('role', 'img');
  ringBox.append(ringHead, ringCanvas);
  let ringKey = null;
  let ringCell = null;
  let ringRows = null;
  function drawRing() {
    const cellIdx = Math.round(view.y) * n + Math.round(view.x);
    const row = seriesRow(tables.hours, view.t);
    const key = `${cellIdx}|${row}|${ringCanvas.clientWidth}`;
    if (key === ringKey || !ringCanvas.isConnected) return;
    ringKey = key;
    if (cellIdx !== ringCell) {
      ringCell = cellIdx;
      const mask = cellMask(masks, cellIdx);
      ringRows = { mask, series: ringSeries(series, mask, tables.hours) };
    }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(200, ringCanvas.clientWidth), h = RING_HEIGHT;
    ringCanvas.width = w * dpr; ringCanvas.height = h * dpr; ringCanvas.style.height = `${h}px`;
    const g = ringCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = drawStrip(g, { mask: ringRows.mask, rows: ringRows.series, idx: row, w, h, colors: stripColors(), winds: TEXTS.stripWinds });
    ringNote.textContent = TEXTS.ringRange(scale.lo, scale.hi);
    // The dial writes its summary in Spanish: the label follows the language in use.
    ringCanvas.setAttribute('aria-label', TEXTS.ringSummary(ringRows.series[row]));
  }
  window.addEventListener('resize', () => { ringKey = null; drawRing(); });

  // «Mínimo para despegar» row: the figure with a tick like the bar's mark, so the two read together.
  function minMark() {
    const span = document.createElement('span');
    span.className = 'min-mark';
    span.textContent = TEXTS.percent(level.minBat);
    return span;
  }

  // Text of a hint key; the ring hint takes the Earth's bearing from the series, never a fixed word.
  const hintText = (key) => missionHintText(key, {
    earthLayer: showEarthLayer(),
    outlook: earthOutlook(tables, state.t),
    minKm: level.txMinKm ?? 1,
    wind: bearing(series.earth.az[seriesRow(tables.hours, state.t)]).wind,
  }, TEXTS);

  // Recomputes the hint after a move, a wait, a transmission or a new game; returns the text to announce
  // when it has just appeared or changed ('' otherwise), so the screen reader hears it once.
  function updateHint() {
    const next = levelHint(state, level, { earthLayer: showEarthLayer() });
    const say = announceHint(hintKey, next) ? hintText(next) : '';
    hintKey = next;
    return say;
  }
  const withHint = (text) => {
    const extra = updateHint();
    return extra ? `${text} ${extra}` : text;
  };

  // A button that also has a map shortcut says so (title) and declares it (aria-keyshortcuts).
  function shortcutHint(button, key) {
    button.title = TEXTS.shortcutTitle(key);
    button.setAttribute('aria-keyshortcuts', key);
  }

  // «Transmitir» (J3.1) next to the wait buttons.
  function actionsBox() {
    const box = document.createElement('div');
    box.className = 'actions';
    const tx = document.createElement('button');
    tx.type = 'button'; tx.className = 'transmit'; tx.id = 'transmit';
    fillButton(tx, transmitLabel(level, TEXTS, state), { iconName: BUTTON_ICONS.transmit, key: buttonKey('transmit') });
    tx.disabled = transmitDisabled(state, { planned: Boolean(plan), busy });
    tx.addEventListener('click', () => doTransmit());
    shortcutHint(tx, SHORTCUTS.transmit);
    box.append(tx);
    // J3.6: with the Earth in sight but a package already sent nearby, say why it is off.
    if (!busy && transmitBlock(state) === 'near-sent') {
      const why = document.createElement('p');
      why.className = 'transmit-why'; why.id = 'transmit-why';
      why.textContent = TEXTS.transmitNearSent(level.txMinKm ?? 1);
      tx.setAttribute('aria-describedby', why.id);
      box.append(why);
    }
    box.append(waitBox());
    return box;
  }

  // Wait buttons (J2.1), under the summary. The panel is rebuilt often, so the state decides what is disabled.
  function waitBox() {
    const box = document.createElement('div');
    box.className = 'wait';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', TEXTS.waitLabel);
    const disabled = waitDisabled(state, { planned: Boolean(plan), busy });
    for (const action of WAIT_ACTIONS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'act'; b.id = action.id;
      fillButton(b, TEXTS[action.label], { iconName: BUTTON_ICONS[action.id] ?? null, key: buttonKey(action.id) });
      b.disabled = disabled[action.id];
      if (SHORTCUTS[action.id]) shortcutHint(b, SHORTCUTS[action.id]);
      b.addEventListener('click', () => doWait(action));
      box.append(b);
    }
    return box;
  }

  function previewBox() {
    const { preview } = plan;
    const box = document.createElement('section');
    box.className = `preview${preview.severity ? ` preview--${preview.severity}` : ''}`;
    const h = document.createElement('h2'); h.textContent = TEXTS.previewTitle;
    const dl = document.createElement('dl');
    dl.className = 'hud';
    for (const [k, v] of [
      [TEXTS.previewRoute, TEXTS.previewRouteValue(preview.km, preview.hours)],
      [TEXTS.previewBattery, TEXTS.previewBatteryValue(preview.batteryNow, preview.batteryEnd)],
    ]) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      dl.append(dt, dd);
    }
    box.append(h, dl);
    const alert = previewAlert(preview, level, TEXTS);
    if (alert) {
      const p = document.createElement('p');
      p.className = 'preview__alert'; p.textContent = alert;
      box.append(p);
    }
    const note = document.createElement('p');
    note.className = 'hint'; note.textContent = TEXTS.previewNote;
    const actions = document.createElement('div');
    actions.className = 'preview__actions';
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'again'; fillButton(go, TEXTS.drive, { key: TEXTS.kbdEnter });
    go.addEventListener('click', drive);
    const no = document.createElement('button');
    no.type = 'button'; no.className = 'ghost'; fillButton(no, TEXTS.cancel, { key: TEXTS.kbdEsc });
    no.addEventListener('click', cancel);
    actions.append(go, no);
    box.append(note, actions);
    return box;
  }

  // ---- Introduction and trials (J5) ----

  // Label «+N h» of the shadows animation, updated per frame without rebuilding the panel.
  const hoursTag = document.createElement('span');
  hoursTag.className = 'intro__hours';
  hoursTag.setAttribute('aria-hidden', 'true');

  // Steps bar (J5): under the header since J13.3, where each step goes back to its trial (or to the mission)
  // without losing the game. Without a host it opens the panel, as before. The panel is emptied either way.
  // It scrolls sideways on phones: the current step is kept in sight.
  function showSteps(at) {
    const bar = stepsBar(at, TRIALS, TEXTS, stepsHost ? pickStep : null);
    if (stepsHost) { stepsHost.replaceChildren(bar); panel.replaceChildren(); } else panel.replaceChildren(bar);
    const cur = bar.querySelector('[aria-current]');
    if (cur && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = cur.offsetLeft - bar.offsetLeft - 8;
    for (const b of bar.querySelectorAll('button')) b.disabled = busy;
  }
  function pickStep(id) {
    if (busy) return;
    if (id === 'play') { if (phase !== 'play') startPlay(); return; }
    if (id !== phase) goTo(id);
  }

  // Texts of the introduction and the end with the scenario's figures (J9.4); expert takes the expert ones.
  function factsTexts() { return withFacts(TEXTS, { expert: levels.exp === level, facts: scenario.facts ?? null, level }); }

  function renderIntro() {
    const TEXTS = factsTexts();
    showSteps(phase);
    if (phase === 'landing') {
      panel.append(...landingPanel({
        km: padKm, trials: TRIALS, texts: TEXTS,
        onStart: () => goTo(nextPhase('landing', TRIALS)),
        onSkip: startPlay,
      }));
      return null;
    }
    const trial = trialById(phase, TRIALS);
    const out = trialPanel({
      trial, index: TRIALS.indexOf(trial), trials: TRIALS, choice: answers[phase], texts: TEXTS,
      extra: answers[phase] !== undefined ? revealData(trial).nodes : [],
      onAnswer: (k) => answer(trial, k),
      onNext: () => { const next = nextPhase(phase, TRIALS); if (next === 'play') startPlay(); else goTo(next); },
      onReplay: phase === 'shadows' ? replayShadows : null,
    });
    panel.append(...out.nodes);
    if (phase === 'shadows' && answers.shadows !== undefined) out.reveal.prepend(hoursTag);
    for (const c of panel.querySelectorAll('canvas.mini')) c.draw();
    return out;
  }

  const stepAnnouncement = () => {
    const steps = introSteps(TRIALS);
    const i = stepIndex(phase, TRIALS);
    const title = panel.querySelector('.intro__title')?.textContent ?? TEXTS.goal(level.need, level.minBat, Math.ceil(level.deadline / 24));
    return TEXTS.liveStep(title, TEXTS.steps[steps[i]], i + 1, steps.length);
  };

  function goTo(next) {
    introTok++;
    phase = next;
    // Back to a trial already answered (J13.3): the map shows its reveal again.
    showHour(next === 'earth' && answers.earth !== undefined ? EARTH_TRIAL_HOUR
      : next === 'shadows' && answers.shadows !== undefined ? SHADOW_ANIM.to : 0);
    if (next === 'shadows' && answers.shadows !== undefined) hoursTag.textContent = TEXTS.hoursLater(SHADOW_ANIM.to);
    renderPanel();
    panel.querySelector('.intro__title')?.focus();
    announce(stepAnnouncement());
  }

  // The map at a scenario hour, before the mission (the rover does not move).
  function showHour(t) {
    view = { ...view, t };
    draw();
  }

  // Sentences with data and the mini chart of a reveal, in the language in use; `said` is what the screen reader hears.
  function revealData(trial) {
    const nodes = [];
    const said = [];
    const sentence = (text) => {
      const p = document.createElement('p');
      p.className = 'reveal__data'; p.textContent = text;
      nodes.push(p); said.push(text);
    };
    if (trial.id === 'power') {
      const curves = batteryCurves(level);
      sentence(TEXTS.powerTenHours(curves.dark[0], curves.dark[10]));
      const mini = batteryMini(curves, TEXTS, { sun: gameColors().sun, dark: '#8c9198', muted: '#8c9198' });
      nodes.push(mini);
      said.push(mini.getAttribute('aria-label'));
    } else if (trial.id === 'earth') {
      const win = earthWindow(tables);
      if (win) sentence(TEXTS.earthWindowText(missionDay(win.first), missionDay(win.last)));
      const wind = bearing(series.earth.az[seriesRow(tables.hours, EARTH_TRIAL_HOUR)]).wind;
      sentence(TEXTS.earthBearingText(TEXTS.winds?.[wind] ?? windWord(wind)));
      said.push(TEXTS.earthCellsText(earthCells(tables, EARTH_TRIAL_HOUR).length, n * n));
    }
    return { nodes, said };
  }

  function answer(trial, k) {
    if (answers[trial.id] !== undefined) return;
    answers[trial.id] = k;
    const verdict = answerTrial(trial, k);
    const said = [verdict === 'ok' ? TEXTS.verdictOk : verdict === 'ko' ? TEXTS.verdictKo : '', TEXTS.trials[trial.key].reveal,
      ...revealData(trial).said];
    // Without animation the shadows change is known at once: one announcement for everything.
    const instant = trial.id === 'shadows' && reduced();
    if (instant) said.push(shadowText());
    renderPanel();
    if (trial.id === 'earth') showHour(EARTH_TRIAL_HOUR);
    panel.querySelector('.reveal')?.focus();
    announce(said.filter(Boolean).join(' '));
    if (trial.id === 'shadows') runShadows(instant);
  }

  // Shadows trial: 48 h of shadows in about 4.2 s; with reduced motion, straight to 48 h.
  const shadowText = () => {
    const { toSun, toShadow } = shadowChange(tables, SHADOW_ANIM.from, SHADOW_ANIM.to);
    return TEXTS.shadowChange(toSun, toShadow);
  };
  function runShadows(silent = false) {
    const tok = ++introTok;
    const done = () => {
      hoursTag.textContent = TEXTS.hoursLater(SHADOW_ANIM.to);
      if (!silent) announce(shadowText());
    };
    if (reduced()) { showHour(SHADOW_ANIM.to); done(); return; }
    const t0 = performance.now();
    const frame = (now) => {
      if (tok !== introTok) return;
      const t = introHour(now - t0);
      hoursTag.textContent = TEXTS.hoursLater(t);
      showHour(t);
      if (t < SHADOW_ANIM.to) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  }
  function replayShadows() {
    if (reduced()) {
      introTok++;
      const t = view.t >= SHADOW_ANIM.to ? SHADOW_ANIM.from : SHADOW_ANIM.to;
      hoursTag.textContent = TEXTS.hoursLater(t);
      showHour(t);
      return;
    }
    runShadows();
  }

  // Enters the mission from the introduction (the map goes back to hour 0).
  function startPlay() {
    introTok++;
    phase = 'play';
    view = { x: state.x, y: state.y, t: state.t, route: state.route, battery: state.battery };
    draw(); renderPanel();
    panel.querySelector('.goal')?.focus();
    announce(stepAnnouncement());
    if (!played) { played = true; onPlay?.(); }
  }

  // Lift-off on the map (J12.8, #398): the rocket rises from ASCENSO once the game is won. With reduced motion, a
  // still frame of it just off the pad.
  let winAt = null, liftFrame = 0;
  function padLift() {
    if (state.over !== 'win' || busy) { winAt = null; return 0; }
    if (reduced()) return 0.35;
    const now = performance.now();
    if (winAt === null) winAt = now;
    const k = Math.min(1, (now - winAt) / MAP_LIFT_MS);
    if (k < 1 && !liftFrame) liftFrame = requestAnimationFrame(() => { liftFrame = 0; draw(); });
    return k;
  }

  function restart() {
    state = freshGame();
    cursor = { x: state.x, y: state.y };
    view = { x: state.x, y: state.y, t: state.t, route: state.route, battery: state.battery };
    busy = false;
    plan = null;
    message = '';
    earthToggled = false;
    popChecks = [];
    hintKey = null;
    updateHint();
    renderPanel();
    canvas.focus();
    draw();
    // Each mission starts with its goal (J6.2); the pad hint starts when it is closed.
    openGoal();
  }

  // What the screen reader hears after an action (J6.3, J6.4): its own text, any event that happened,
  // the checks just met and the hint that has just appeared. It also marks which checks pop.
  function afterAction(before, after, text) {
    popChecks = newlyDone(before, after);
    const parts = [text];
    for (const e of newEvents(before, after)) parts.push(logText(e, level, TEXTS));
    if (!after.over) {
      if (popChecks.includes('packets')) parts.push(TEXTS.livePacketsDone(level.need));
      if (popChecks.includes('ready')) parts.push(TEXTS.liveReady);
    }
    return withHint(parts.join(' '));
  }

  // ---- Level (J6.1) ----

  function syncLevelButtons() {
    for (const b of levelButtons) {
      b.setAttribute('aria-pressed', String(levels[b.dataset.level] === level));
      b.disabled = busy;
    }
  }

  // A new level starts the mission again (in the introduction it only changes the figures of the trials).
  function setLevel(id) {
    if (busy || !LEVEL_IDS.includes(id) || levels[id] === level) return;
    level = levels[id];
    history.replaceState(null, '', levelSearch(location.search, id) + location.hash);
    if (phase === 'play') {
      announce(TEXTS.liveLevel(TEXTS.levelNames[id]));
      restart();
    } else {
      state = freshGame();
      view = { x: state.x, y: state.y, t: view.t, route: state.route, battery: state.battery };
      renderPanel(); draw();
      announce(TEXTS.liveLevel(TEXTS.levelNames[id]));
    }
  }
  for (const b of levelButtons) b.addEventListener('click', () => setLevel(b.dataset.level));

  // ---- «Tierra visible» button over the map (J6.5), only where the level allows switching the layer ----

  const earthBtn = document.createElement('button');
  earthBtn.type = 'button';
  earthBtn.className = 'earth-toggle';
  earthBtn.id = 'earth-toggle';
  earthBtn.addEventListener('click', toggleEarth);
  // The layer over the map (J13.2) puts the button in its bottom right corner, over «Leyenda».
  const mapHud = createMapHud(canvas.parentElement, { onGoal: (btn) => openGoal({ returnTo: btn }), legendList, earthButton: earthBtn });
  function syncEarthToggle() {
    earthBtn.hidden = !(phase === 'play' && earthToggleShown(level));
    earthBtn.replaceChildren(mapIcon('earth'), document.createTextNode(TEXTS.earthToggle));
    earthBtn.setAttribute('aria-pressed', String(earthToggled));
    shortcutHint(earthBtn, SHORTCUTS['earth-layer']);
  }
  function toggleEarth() {
    if (!earthToggleShown(level) || phase !== 'play') return false;
    earthToggled = !earthToggled;
    hintKey = levelHint(state, level, { earthLayer: showEarthLayer() });
    renderPanel(); draw();
    return true;
  }

  // ---- Mission goal (J6.2): a modal dialog with the three steps of the level ----

  const goalDialog = document.createElement('dialog');
  goalDialog.className = 'goal-dialog';
  goalDialog.setAttribute('aria-labelledby', 'goal-title');
  document.body.append(goalDialog);
  let goalReturn = null;
  let goalOnClose = null;
  goalDialog.addEventListener('close', () => {
    const after = goalOnClose;
    goalOnClose = null;
    (goalReturn?.isConnected ? goalReturn : canvas).focus();
    after?.();
  });
  // At the start of each mission (`returnTo` absent) closing it starts the pad hint, as in the prototype.
  function openGoal({ returnTo = null } = {}) {
    if (goalDialog.open) return;
    goalReturn = returnTo;
    goalOnClose = returnTo ? null : () => padHint.start();
    const kicker = document.createElement('p');
    kicker.className = 'goal-dialog__kicker';
    kicker.textContent = TEXTS.goalKicker(TEXTS.levelNames[LEVEL_IDS.find((id) => levels[id] === level)]);
    const h = document.createElement('h2');
    h.id = 'goal-title'; h.textContent = TEXTS.goalTitle;
    const ol = document.createElement('ol');
    ol.className = 'gsteps';
    goalSteps(level, TEXTS).forEach((step, k) => {
      const li = document.createElement('li');
      li.className = 'gstep';
      li.insertAdjacentHTML('afterbegin', GOAL_ICONS[step.icon]);
      const body = document.createElement('div');
      const num = document.createElement('span'); num.className = 'gn'; num.setAttribute('aria-hidden', 'true'); num.textContent = String(k + 1);
      const p = document.createElement('p'); p.textContent = step.title;
      const small = document.createElement('small'); small.textContent = step.detail;
      p.append(small);
      body.append(num, p);
      li.append(body);
      ol.append(li);
    });
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'again'; go.textContent = TEXTS.goalGo;
    go.addEventListener('click', () => goalDialog.close());
    const row = document.createElement('div');
    row.className = 'goal-dialog__actions';
    row.append(go);
    goalDialog.replaceChildren(kicker, h, ol, row);
    goalDialog.showModal();
    go.focus();
  }

  // Animates the rover along the cells the engine just added to the route. Resolves with null when the route ends, or
  // with the number of cells already walked when the cabin takes the controls mid-way (J12.4, stopDrive).
  let driveStop = false;
  function animate(from, to) {
    return new Promise((resolve) => {
      const path = [{ x: from.x, y: from.y }, ...to.route.slice(from.route.length)];
      // Seen from the cabin (its heading is set, or the route was asked there), at the pace the cabin gives
      // (setCabinPace), not the map's quick sweep, which from the driver's seat jumped 250 m at a time (#403).
      const inCabin = cabinPace && (cabinHeading !== null || fromCabinDrive);
      const total = inCabin ? cabinPace(path.length - 1, reduced()) : moveDurationMs(path.length - 1, { reduced: reduced() });
      if (total <= 0) return resolve(null);
      const t0 = performance.now();
      const frame = (now) => {
        const k = animationProgress(now, t0, total);
        const pos = k * (path.length - 1);
        const i = Math.min(Math.floor(pos), path.length - 2);
        const f = pos - i;
        // Taken over mid-way: the cells walked are those up to the nearest one, the cell the cabin's car is in.
        if (driveStop && k < 1) return resolve(Math.min(path.length - 1, Math.round(pos)));
        view = {
          x: path[i].x + (path[i + 1].x - path[i].x) * f,
          y: path[i].y + (path[i + 1].y - path[i].y) * f,
          t: from.t + (to.t - from.t) * k,
          battery: from.battery + (to.battery - from.battery) * k,
          // Cells already walked; the rest of the path is drawn as the planned overlay.
          route: [...from.route, ...path.slice(1, i + 1)],
          plan: path.slice(i + 1),
        };
        draw(); renderPanel();
        if (k < 1) requestAnimationFrame(frame); else resolve(null);
      };
      requestAnimationFrame(frame);
    });
  }

  // Animates the clock, the battery and the shadows while the rover waits in place.
  function animateWait(from, to) {
    return new Promise((resolve) => {
      const total = waitDurationMs(to.t - from.t, reduced());
      if (total <= 0) return resolve();
      const t0 = performance.now();
      const frame = (now) => {
        const k = animationProgress(now, t0, total);
        view = {
          x: from.x, y: from.y, route: from.route,
          t: from.t + (to.t - from.t) * k,
          battery: from.battery + (to.battery - from.battery) * k,
        };
        draw(); renderPanel();
        if (k < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  async function doWait(action, { fromMap = false } = {}) {
    if (waitDisabled(state, { planned: Boolean(plan), busy })[action.id]) return;
    const before = state;
    const after = action.run(state);
    message = '';
    busy = true;
    popChecks = [];
    padHint.stop();
    renderPanel();
    await animateWait(before, after);
    state = after;
    view = { x: state.x, y: state.y, t: state.t, route: state.route, battery: state.battery };
    busy = false;
    let waitText = waitAnnouncement(before, after, TEXTS, { untilEarth: action.id === 'wait-earth' });
    // #382: «Hasta ver la Tierra» without it in sight says when it will be visible from here, or the outlook.
    if (action.id === 'wait-earth' && !after.over && !hasEarth(after)) {
      const next = nextEarthHour(tables, after.y * n + after.x, after.t);
      waitText += ` ${next !== null ? TEXTS.nextEarthHere(outlookDay(next), next % 24) : missionHintText('earth-few', { earthLayer: showEarthLayer(), outlook: earthOutlook(tables, after.t) }, TEXTS)}`;
    }
    const waited = afterAction(before, after, waitText);
    draw(); renderPanel();
    announce(state.over ? endText() : waited);
    // The panel was rebuilt: keep the focus on the same button, or on the first one still enabled.
    if (state.over) panel.querySelector('.again')?.focus();
    else if (fromMap) canvas.focus();
    else (panel.querySelector(`#${action.id}:not(:disabled)`) || panel.querySelector('.wait button:not(:disabled)'))?.focus();
  }

  // Sends one package (J3.1): the clock, the battery and the shadows advance as when waiting.
  async function doTransmit({ fromMap = false } = {}) {
    if (transmitDisabled(state, { planned: Boolean(plan), busy })) return;
    const before = state;
    const after = runTransmit(state);
    message = '';
    busy = true;
    popChecks = [];
    padHint.stop();
    renderPanel();
    await animateWait(before, after);
    state = after;
    view = { x: state.x, y: state.y, t: state.t, route: state.route, battery: state.battery };
    busy = false;
    const sent = afterAction(before, after, transmitAnnouncement(before, after, TEXTS));
    draw(); renderPanel();
    announce(state.over ? endText() : sent);
    if (state.over) panel.querySelector('.again')?.focus();
    else if (fromMap) canvas.focus();
    else (panel.querySelector('#transmit:not(:disabled)') || panel.querySelector('.actions button:not(:disabled)') || canvas).focus();
  }

  async function onTap(ev) {
    if (busy || state.over || phase !== 'play') return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - rect.left) / rect.width) * n);
    const y = Math.floor(((ev.clientY - rect.top) / rect.height) * n);
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    // The pad is a tiny target on phones: a tap within one cell of it counts as a tap on it.
    const nearPad = Math.abs(x - scenario.pad.x) <= 1 && Math.abs(y - scenario.pad.y) <= 1;
    if (nearPad) tapCell(scenario.pad.x, scenario.pad.y); else tapCell(x, y);
  }

  // A tap plans: the state does not change until «Conducir».
  function tapCell(x, y) {
    if (busy || state.over || phase !== 'play') return;
    const out = decideAction(state, plan, { type: 'tap', target: { x, y } }, level, TEXTS, scenario.grid.cellM);
    plan = out.plan;
    cursor = { x, y };
    // The warning only reflects the last tap, so it is cleared even when the tap changes nothing.
    message = out.feedback.warning;
    renderPanel(); draw();
    if (out.feedback.announcement) announce(out.feedback.announcement);
    else if (plan) announce(previewAnnouncement(plan.preview, level, TEXTS));
  }

  async function drive() {
    if (busy || state.over || !plan || phase !== 'play') return;
    const out = decideAction(state, plan, { type: 'drive' }, level, TEXTS, scenario.grid.cellM);
    plan = null;
    message = '';
    busy = true;
    popChecks = [];
    padHint.stop();
    renderPanel();
    const before = state;
    driveStop = false;
    const walked = await animate(state, out.drive);
    driveStop = false;
    // Taken over from the cabin (J12.4): the engine replays only the cells already walked, so the state is the one of
    // that cell, as if the route had been planned up to there.
    state = walked === null ? out.drive : move(before, out.drive.route.slice(before.route.length, before.route.length + walked));
    view = { x: state.x, y: state.y, t: state.t, route: state.route, battery: state.battery };
    busy = false;
    const moved = state.over ? endText() : afterAction(before, state, walked === null ? movedText() : `${TEXTS.cabinTakeOver}. ${movedText()}`);
    draw(); renderPanel();
    announce(moved);
    if (state.over) panel.querySelector('.again')?.focus();
    else if (!fromCabinDrive) canvas.focus();
    fromCabinDrive = false;
  }
  let fromCabinDrive = false;

  function cancel() {
    if (busy || !plan) return;
    plan = decideAction(state, plan, { type: 'cancel' }, level, TEXTS, scenario.grid.cellM).plan;
    renderPanel(); draw();
    announce(TEXTS.liveCancelled);
    canvas.focus();
  }

  // Keyboard: arrows move a cursor cell, Enter or Space plans (and drives on the second press), Escape cancels.
  function onKey(ev) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (d) {
      ev.preventDefault();
      padHint.stop();
      cursor = { x: Math.min(n - 1, Math.max(0, cursor.x + d[0])), y: Math.min(n - 1, Math.max(0, cursor.y + d[1])) };
      draw();
      announceCursor();
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      // Enter on the planned cell drives; on any other cell it plans there.
      if (enterAction(plan, cursor) === 'drive') drive(); else tapCell(cursor.x, cursor.y);
    } else if (ev.key === 'Escape') {
      cancel();
    } else {
      const action = keyAction(ev);
      if (!action) return;
      ev.preventDefault();
      padHint.stop();
      runShortcut(action);
    }
  }

  // What the cursor cell is like (J10.3): Sun, Earth (only while the Earth layer is shown) and the pad.
  function announceCursor() {
    const report = cellReport({
      tables, scenario, cell: cursor, hour: phase === 'play' ? state.t : view.t,
      seesEarth: earthOnMap() ? tables.seesEarth : null,
      nearSent: phase === 'play' ? (cell) => sentTooClose(state, cell) : null,
      earthIn: phase === 'play' ? earthInHours : null,
    });
    announce(TEXTS.liveCursor(report, cursor.x === state.x && cursor.y === state.y));
    readoutCell = { ...cursor };
    showReadout();
  }

  // Keyboard shortcuts on the map (J10.3): the same actions as the buttons, disabled when they are.
  function runShortcut(action) {
    if (action === 'help') return announce(TEXTS.shortcutsHelp);
    if (action === 'cursor-rover' || action === 'cursor-pad') {
      cursor = action === 'cursor-rover' ? { x: state.x, y: state.y } : { x: scenario.pad.x, y: scenario.pad.y };
      draw();
      return announceCursor();
    }
    // Before the mission (J5) the map shows, but nothing can be done on it yet.
    if (phase !== 'play') return announce(TEXTS.shortcutUnavailable);
    if (action === 'status') return announce(TEXTS.liveStatus(missionStatus(state, { earthShown: earthOnMap() })));
    if (action === 'goal') return openGoal({ returnTo: canvas });
    if (action === 'earth-layer') {
      if (!toggleEarth()) return announce(TEXTS.shortcutUnavailable);
      return announce(`${TEXTS.earthToggle}: ${earthToggled ? TEXTS.on : TEXTS.off}`);
    }
    if (action === 'transmit') {
      if (transmitDisabled(state, { planned: Boolean(plan), busy })) return announce(TEXTS.shortcutUnavailable);
      return doTransmit({ fromMap: true });
    }
    const wait = WAIT_ACTIONS.find((a) => a.id === action);
    if (!wait || waitDisabled(state, { planned: Boolean(plan), busy })[wait.id]) return announce(TEXTS.shortcutUnavailable);
    return doWait(wait, { fromMap: true });
  }

  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('focus', draw);
  canvas.addEventListener('blur', draw);
  canvas.addEventListener('click', onTap);
  // Reading line under the map (J13.2): the cell under the mouse, or the rover's when it leaves.
  canvas.addEventListener('mousemove', (ev) => {
    if (phase !== 'play') return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((ev.clientX - rect.left) / rect.width) * n);
    const y = Math.floor(((ev.clientY - rect.top) / rect.height) * n);
    if (x < 0 || y < 0 || x >= n || y >= n || (readoutCell && readoutCell.x === x && readoutCell.y === y)) return;
    readoutCell = { x, y };
    showReadout();
  });
  canvas.addEventListener('mouseleave', () => { if (phase !== 'play') return; readoutCell = null; showReadout(); });
  draw(); renderPanel();
  // Language switch (J10.1): the texts change, the game (state, plan, cursor) does not.
  function setLang(next) {
    TEXTS = texts(next);
    ringTitle.textContent = TEXTS.ringTitle;
    ringKey = null;
    renderPanel(); draw();
  }

  // The caller starts the hint once the page is usable (not under the tutorial modal).
  // Light mode by hand (J10.4): WebGL is dropped in place, the game is not touched.
  const mapModeInUse = () => (backdrop.mode === 'gl' ? 'full' : 'light');
  function toLightMap() {
    lightByHand = true;
    backdrop.toLight();
    announce(TEXTS.mapLightOn);
  }
  // ---- Cabin (J12.2): driving by hand, one neighbouring cell at a time through the same engine as the routes ----

  // Moves the rover to a neighbouring cell with move(state, [cell]): battery, time, events and the end come from the
  // engine, as when a route is driven. Returns { ok, reason: 'busy' | 'edge' | 'slope', over, hours }.
  function cabinStep(to) {
    if (busy || state.over || phase !== 'play') return { ok: false, reason: 'busy' };
    const dx = to.x - state.x, dy = to.y - state.y;
    if (to.x < 0 || to.y < 0 || to.x >= n || to.y >= n || Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return { ok: false, reason: 'edge' };
    if (stepCost(tables, level, state.y * n + state.x, to.y * n + to.x) === null) return { ok: false, reason: 'slope' };
    const before = state;
    plan = null; message = '';
    padHint.stop();
    state = move(state, [to]);
    view = { x: state.x, y: state.y, t: state.t, route: state.route, battery: state.battery };
    const said = state.over ? endText() : afterAction(before, state, '');
    draw(); renderPanel();
    // Events, checks, hints and the end always; otherwise the new cell, as the keyboard cursor reads it (J12.6),
    // at most once a second so the screen reader is not flooded while driving.
    const now = performance.now();
    if (said.trim()) { announce(said.trim()); lastCellSaid = now; }
    else if (cellAnnounceDue(lastCellSaid, now)) {
      const report = cellReport({
        tables, scenario, cell: { x: state.x, y: state.y }, hour: state.t,
        seesEarth: earthOnMap() ? tables.seesEarth : null,
        nearSent: (cell) => sentTooClose(state, cell),
        earthIn: earthInHours,
      });
      announce(TEXTS.liveCursor(report, true));
      lastCellSaid = now;
    }
    return { ok: true, over: state.over, hours: state.t - before.t };
  }
  let lastCellSaid = -Infinity;
  // What the cabin's buttons can do now: the same rules as the panel's.
  const cabinActions = () => ({
    drive: Boolean(plan) && !busy && !state.over && phase === 'play',
    transmit: !transmitDisabled(state, { planned: Boolean(plan), busy }) && phase === 'play',
    ...Object.fromEntries(Object.entries(waitDisabled(state, { planned: Boolean(plan), busy })).map(([k, v]) => [k, !v && phase === 'play'])),
  });
  // The nearest cell from which the Earth is seen now (or, if none, the nearest that will see it within 24 h, #382):
  // the cabin's compass points to it. Only while the Earth layer is shown, as the map (J6.5). null when there is none.
  function nearestEarth() {
    if (!earthOnMap()) return null;
    const h = Math.floor(state.t);
    let best = null;
    const consider = (i, now) => {
      const x = i % n, y = (i - x) / n, d = Math.hypot(x - state.x, y - state.y);
      if (!best || d < best.d) best = { x, y, d, now };
    };
    for (let i = 0; i < n * n; i++) if (tables.seesEarth(i, h)) consider(i, true);
    if (!best) for (const i of earthForecastCells(tables, h)) consider(i, false);
    return best && { x: best.x, y: best.y, km: (best.d * scenario.grid.cellM) / 1000, now: best.now };
  }
  // The car's heading while the cabin is shown (null on the map): the minimap redraws once per frame at most.
  function setCabinHeading(h) {
    const next = h === null ? null : Math.round(h * 200) / 200;
    if (next === cabinHeading) return;
    cabinHeading = next;
    if (!headingFrame) headingFrame = requestAnimationFrame(() => { headingFrame = 0; draw(); });
  }
  // The vehicle at ASCENSO (#398): status and, at the pad without clearance, the message with the nearest blue zone.
  function liftoffNow() {
    const status = liftoffStatus(state);
    const zone = status.atPad && status.reason === 'packets' ? zoneWords(state, nearestEarth(), TEXTS.winds) : null;
    return { status, message: phase === 'play' ? liftoffMessage(status, TEXTS, zone) : null };
  }
  // var, not let: renderPanel can run before this line during start-up.
  var liftoffSaid = '';
  function liftoffBox(msg) {
    const box = document.createElement('div');
    box.className = 'liftoff';
    const title = document.createElement('p');
    title.className = 'liftoff__title'; title.id = 'liftoff-why'; title.textContent = msg.title;
    const todo = document.createElement('p');
    todo.className = 'liftoff__todo'; todo.textContent = msg.todo;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lb liftoff__btn'; b.disabled = true;
    b.textContent = TEXTS.liftoffButton;
    b.setAttribute('aria-describedby', 'liftoff-why');
    box.append(title, todo, b);
    // The screen reader hears it once when it appears or changes, not on every repaint.
    const said = `${msg.title} ${msg.todo}`;
    if (said !== liftoffSaid) { liftoffSaid = said; announce(said); }
    return box;
  }
  // Why «Transmitir» is off for the cabin (J12): the same rule as the button, the nearest blue zone and the 1 km.
  const cabinTransmit = () => ({
    reason: phase === 'play' ? transmitReason(state, { planned: Boolean(plan), busy }) : 'over',
    zone: nearestEarth(), minKm: level.txMinKm ?? 1,
  });
  // Slope in degrees between two neighbouring cells (null outside the grid), as the engine judges a step (J12 guide).
  const cellSlope = (a, b) => (b.x < 0 || b.y < 0 || b.x >= n || b.y >= n ? null : slope(tables, a.y * n + a.x, b.y * n + b.x));
  // The «Earth visible» layer for the cabin's ground (J12.5): cells that see the Earth at the whole hour of `t` and
  // those that will within 24 h, while the layer is shown (as on the map, J6.5); null otherwise. Cached by hour.
  let cabinEarthKey = null, cabinEarthVal = null;
  function cabinEarth(t = state.t) {
    if (!earthOnMap()) return null;
    const h = Math.floor(t);
    if (cabinEarthKey !== h) { cabinEarthKey = h; cabinEarthVal = { now: earthCells(tables, h), soon: earthForecastCells(tables, h) }; }
    return cabinEarthVal;
  }
  // Whether the Earth is seen from a cell (fractional while the rover moves: the nearest) at a game hour (J12.7).
  const earthSeenAt = (x, y, t) => tables.seesEarth(Math.round(y) * n + Math.round(x), t);
  // Figures of the end for the cabin's postcard (J12.7), as the end panel says them; null before the end.
  const cabinEnd = () => (state.over ? endSummary(state) : null);
  // Something more for the end panel, given by the cabin (its postcard button, J12.7).
  let endExtra = null;
  const cabinState = () => ({ x: state.x, y: state.y, t: state.t, over: state.over, busy, playing: phase === 'play', maxSlope: level.maxSlope });

  // Sun fraction of a cell (fractional while the rover moves: the nearest cell) at a game hour, for the cabin (J12.1).
  const sunFracAt = (x, y, t) => tables.sunFrac(Math.round(y) * tables.n + Math.round(x), t);
  return { startHint: padHint.start, openGoal, setLang, setLevel, mapModeInUse, toLightMap, redraw: () => draw(), startMs, series, scenario, sunFracAt,
    setCabinPace: (f) => { cabinPace = f; },
    cabinStep, cabinActions, cabinState, nearestEarth, cabinTransmit, cellSlope, setCabinHeading, liftoffNow,
    earthSeenHere: () => seesEarthNow(state),
    cabinEarth, earthSeenAt, cabinEnd, setEndExtra: (f) => { endExtra = f; renderPanel(); },
    // The cabin's end card (#398): «Ver el resultado» leaves the focus on the end panel; «Jugar otra vez» a new game.
    focusEnd: () => { const t = panel.querySelector('.end__title'); if (!t) return; t.scrollIntoView?.({ block: 'nearest' }); t.focus({ preventScroll: true }); },
    cabinRestart: () => restart(),
    // Autopilot from the cabin (J12.4): drive the planned route, cancel it, or take the controls mid-way.
    cabinDrive: () => { if (!plan || busy) return false; fromCabinDrive = true; drive(); return true; },
    cabinCancel: () => { if (!plan || busy) return false; cancel(); return true; },
    stopDrive: () => { if (busy && !driveStop) { driveStop = true; return true; } return false; },
    cabinPlan: () => (plan && !busy ? { km: plan.preview.km, hours: plan.preview.hours } : null),
    runShortcut: (action) => { padHint.stop(); runShortcut(action); }, keyAction,
    quality: backdrop.quality };
}
