// The cabin on screen (J12.1–J12.4, #297–#300): the «Mapa / Cabina» switch over the map, the dynamic load of three.js
// and of the Mirador's relief, the descent at the end of the introduction, driving by hand (W A S D or the arrows, a
// touch pad on phones), the action bar, full screen and the map shrunk to a minimap in a corner. In light mode, on the
// procedural scenario or without WebGL there is no switch and nothing 3D is downloaded.
import { skyAt } from '../moon-sky.js';
import { gameColors } from '../palette.js';
import { roverHeading } from '../map-hud.js';
import { compassPoint } from '../map-legend.js';
import { cabinRegion, cellToScene, stepCar, cellOf, bounceBack, compassMark, cellBearing, followRoute, kmh, cabinRouteMs, REGION_ROOT } from './logic.js';
import { scenarioPath, scenarioName } from '../scenario-source.js';
import { cellCorrections } from './light.js';
import { guidePath, headingLabel } from './guide.js';

/**
 * Words for why «Transmitir» is off in the cabin (J12), from transmitReason and the nearest blue zone; '' when it
 * is on, or when the reason needs no words there (a route planned or the rover moving: the bar says it).
 */
export function transmitWhy({ reason, zone, minKm }, T, windOf) {
  if (reason === 'no-earth') return T.cabinTxNoEarth(zone ? { km: zone.km, wind: windOf(zone.bearing), now: zone.now } : null);
  if (reason === 'near-sent') return T.cabinTxNearSent(minKm);
  if (reason === 'all-sent') return T.cabinTxAllSent;
  return '';
}
import { launchAt, launchText, launchPlan, LAUNCH } from './launch.js';
import { endCard, endCardDelay, endCardLabel, endStep } from './end-card.js';
import { beaconMode } from '../liftoff.js';
import { earthRises, riseSlowdown, postcardCaption, postcardFile } from './moments.js';
import { endSummary } from '../end.js';

/** Ms after the last change before the screen-reader summary of the view is updated. */
export const SUMMARY_DELAY_MS = 500;
/** Degrees per second of head turn for each pixel per millisecond of drag. */
const DRAG_GAIN = 260;
/** Keys that drive (throttle, steer); every other key goes to the game's shortcuts (J10.3), as on the map. */
export const DRIVE_KEYS = {
  w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0],
  a: [0, -1], arrowleft: [0, -1], d: [0, 1], arrowright: [0, 1],
};
/** Held with a driving key, the long gear (DRIVE.turbo in logic.js); on the touch pad, the knob pushed to its edge. */
export const TURBO_KEY = 'shift';
const PAD_TURBO = 0.9;
/** The buttons of the cabin's action bar, with the shortcut each one shows (the same as the panel's, J10.3). */
export const CABIN_ACTIONS = [
  { id: 'transmit', label: 'transmitShort', key: 'T' },
  { id: 'wait-2', label: 'wait2', key: '2' },
  { id: 'wait-sun', label: 'waitSun', key: null }, // S drives backwards in the cabin
  { id: 'wait-earth', label: 'waitEarth', key: 'E' },
];

/**
 * What a key does in the cabin, before the game's shortcuts (J12.4, J12.6): 'drive-key' (W A S D or the arrows),
 * 'autopilot' (Enter with a route planned), 'cancel-route' (Escape with a route planned, unless leaving the full
 * window), 'minimap' (M) or null.
 */
export function cabinKey(ev, { planned = false, fullWindow = false } = {}) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return null;
  const k = ev.key.toLowerCase();
  if (DRIVE_KEYS[k]) return 'drive-key';
  if (k === TURBO_KEY) return 'turbo';
  if (k === 'enter' && planned) return 'autopilot';
  if (k === 'escape' && planned && !fullWindow) return 'cancel-route';
  if (k === 'm') return 'minimap';
  return null;
}

/** The state the cabin draws from the game's view: rover position in the scene, heading and hour. */
export function cabinView(scenario, view) {
  const p = cellToScene(scenario, view.x, view.y);
  return { x: p.x, z: p.z, heading: roverHeading(view.route ?? [{ x: view.x, y: view.y }], scenario.pad), t: view.t };
}

/**
 * Mounts the cabin. Returns { setView(view), active(), descend(), toLight(), setTexts(T), offered }.
 *   stack       the .map-stack (the cabin canvas goes over the map, under the HUD; the map becomes the minimap)
 *   corner      the .map-corner of the HUD, where the switch goes
 *   scenario, series, startMs, mapMode, quality level, texts, isReduced
 *   game        the game handle: sunFracAt, cabinStep, cabinActions, cabinState, runShortcut, keyAction
 *   load        () → [import('./scene.js'), loadRegion]; a parameter so tests can count it
 */
export function mountCabin({ stack, corner, scenario, series, startMs, mapMode, level = 'medio', texts, isReduced = () => false,
  game = {}, load = defaultLoad, quality = null, isStable = () => true, guideOn = () => true, lang = () => 'es' }) {
  const region = cabinRegion({ scenario, mapMode });
  const none = { setView() {}, active: () => false, descend() {}, toLight() {}, setTexts() {}, offered: false };
  if (!region) return none;
  const sunFracAt = game.sunFracAt ?? (() => 1);
  let T = texts;
  let mode = 'map';
  let cabin = null, loading = null, failed = false, view = null, summaryTimer = 0, toastTimer = 0;
  // The car: continuous position in cells (whole numbers are cell centres), heading and speed.
  let car = null;
  // The «Earth rises» moment (J12.7): whether the rover's cell saw the Earth at the last update, and when it rose.
  let earthBefore = null, lastT = -1, riseAt = null;
  const input = { keys: new Set(), pad: { throttle: 0, steer: 0 }, turbo: false };
  // The autopilot from the cabin (J12.4): the car follows the route the game animates. `follow` = { t0, at, dx, dy,
  // last }: when it started, the time of the last update, the car's offset (cells) from the route's first point, which
  // fades out in FOLLOW_BLEND_S so the car does not jump to the cell centre, and the last view followed. null while no
  // route is being driven.
  let follow = null;
  const FOLLOW_BLEND_S = 1.2;
  const cellM = scenario.grid?.cellM ?? 250;
  // Routes driven while the cabin is shown go at the rover's pace (DRIVE.autopilot), not the map's.
  game.setCabinPace?.((cells, reduced) => cabinRouteMs(cells, cellM, { reduced }));

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const canvas = el('canvas', 'cabin');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.hidden = true;
  // A subtle frame over the view (vignette and the edge of the windscreen); it never takes a click.
  const frameEl = el('div', 'cabin__frame');
  frameEl.hidden = true;
  const note = el('p', 'cabin__note');
  note.hidden = true;
  // Where the ground comes from (#393): the relief is LOLA; the grain, stones and small craters are illustrative.
  const source = el('p', 'cabin__source');
  source.textContent = T.cabinSource;
  source.hidden = true;
  const toast = el('p', 'cabin__toast');
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  // Action bar (J12.3): transmit and wait, with their keys; and the touch pad (J12.2) on phones.
  const bar = el('div', 'cabin-actions');
  bar.setAttribute('role', 'group');
  bar.hidden = true;
  const barButtons = CABIN_ACTIONS.map((a) => {
    const b = el('button', 'lb cabin-actions__btn');
    b.type = 'button'; b.dataset.action = a.id;
    b.addEventListener('click', () => { game.runShortcut?.(a.id); canvas.focus({ preventScroll: true }); });
    bar.append(b);
    return { ...a, b };
  });
  // Postcard (J12.7): offered at the end of the game, in the cabin's bar.
  const postBtn = el('button', 'lb cabin-actions__btn cabin-actions__btn--post');
  postBtn.type = 'button'; postBtn.hidden = true;
  postBtn.addEventListener('click', () => savePostcard());
  bar.append(postBtn);
  const pad = el('div', 'cabin-pad');
  pad.hidden = true;
  pad.setAttribute('aria-hidden', 'true');
  const knob = el('span', 'cabin-pad__knob');
  pad.append(knob);
  // Compass strip (J12.3) at the top of the view: N E S O, the Sun, the Earth and an arrow to the nearest blue zone.
  const compass = el('div', 'cabin-compass');
  compass.setAttribute('aria-hidden', 'true');
  compass.hidden = true;
  // A tap on the compass turns the head to look at the rover's own shadow (J12.7); B does the same from the keyboard.
  compass.addEventListener('click', () => lookAtShadow());
  const marks = {};
  for (const [key, cls] of [['N', 'card'], ['NE', 'tick'], ['E', 'card'], ['SE', 'tick'], ['S', 'card'], ['SO', 'tick'], ['O', 'card'], ['NO', 'tick'], ['sun', 'sun'], ['earth', 'earth'], ['zone', 'zone'], ['pad', 'pad']]) {
    marks[key] = el('span', `cabin-compass__m cabin-compass__m--${cls}`);
    compass.append(marks[key]);
  }
  // Autopilot (J12.4): «Conducir la ruta» and «Cancelar» show up in the bar once a route is planned on the minimap,
  // also in full screen; driving keys take the controls back mid-way.
  const driveBtn = el('button', 'lb cabin-actions__btn cabin-actions__drive');
  driveBtn.type = 'button'; driveBtn.hidden = true;
  driveBtn.addEventListener('click', () => { game.cabinDrive?.(); canvas.focus({ preventScroll: true }); });
  const cancelBtn = el('button', 'lb cabin-actions__btn');
  cancelBtn.type = 'button'; cancelBtn.hidden = true;
  cancelBtn.addEventListener('click', () => { game.cabinCancel?.(); canvas.focus({ preventScroll: true }); });
  bar.prepend(driveBtn, cancelBtn);
  // At the vehicle (#398): «Despegar», off with the reason while mission control does not clear it; once won,
  // «Ver el despegue» plays the lift-off again.
  const liftBtn = el('button', 'lb cabin-actions__btn cabin-actions__btn--lift');
  liftBtn.type = 'button'; liftBtn.hidden = true;
  liftBtn.setAttribute('aria-describedby', 'cabin-liftoff-title');
  liftBtn.addEventListener('click', () => { replayLaunch(); canvas.focus({ preventScroll: true }); });
  bar.append(liftBtn);
  // The big message at the vehicle when the lift-off is not cleared: what is missing and what to do.
  const liftBox = el('div', 'cabin-liftoff');
  liftBox.setAttribute('role', 'status');
  liftBox.hidden = true;
  const liftTitle = el('p', 'cabin-liftoff__title');
  liftTitle.id = 'cabin-liftoff-title';
  const liftTodo = el('p', 'cabin-liftoff__todo');
  liftBox.append(liftTitle, liftTodo);
  // The end card (#398): inside the stack, so it is seen in full screen too, where the end panel beside the map is not.
  // A dialog that does not block the cabin: the focus goes to its main button, which reads its title and explanation.
  const endBox = el('section', 'cabin-end');
  endBox.setAttribute('role', 'dialog');
  endBox.setAttribute('aria-modal', 'false');
  endBox.setAttribute('aria-labelledby', 'cabin-end-title');
  endBox.setAttribute('aria-describedby', 'cabin-end-why');
  endBox.hidden = true;
  const endKicker = el('p', 'cabin-end__kicker');
  const endTitle = el('h2', 'cabin-end__title');
  endTitle.id = 'cabin-end-title';
  const endWhy = el('p', 'cabin-end__why');
  endWhy.id = 'cabin-end-why';
  const endActions = el('div', 'cabin-end__actions');
  endBox.append(endKicker, endTitle, endWhy, endActions);
  endBox.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !document.fullscreenElement) { ev.preventDefault(); ev.stopPropagation(); endAction('close'); }
  });
  // Why «Transmitir» is off, next to it (J12): a live line, also in full screen.
  const why = el('p', 'cabin-actions__why');
  why.setAttribute('role', 'status');
  why.hidden = true;
  bar.append(why);
  // Heading of the rover in words and degrees, in the middle of the compass («NE · 045°»).
  const headingEl = el('span', 'cabin-compass__heading');
  compass.append(headingEl);
  stack.append(canvas, frameEl, source, note, toast, liftBox, endBox, bar, pad, compass);

  const group = el('div', 'viewmode');
  group.setAttribute('role', 'group');
  const btnMap = el('button', 'lb viewmode__btn');
  const btnCabin = el('button', 'lb viewmode__btn');
  const btnFull = el('button', 'lb viewmode__full');
  for (const [b, m] of [[btnMap, 'map'], [btnCabin, 'cabin']]) {
    b.type = 'button'; b.dataset.view = m;
    b.addEventListener('click', () => show(m));
    group.append(b);
  }
  btnFull.type = 'button';
  btnFull.addEventListener('click', () => toggleFull());
  group.append(btnFull);
  corner.prepend(group);

  function paintTexts() {
    group.setAttribute('aria-label', T.viewModeLabel);
    btnMap.textContent = T.viewMap;
    btnCabin.textContent = T.viewCabin;
    btnFull.textContent = isFull() ? T.fullscreenExit : T.fullscreen;
    btnFull.title = `${isFull() ? T.fullscreenExit : T.fullscreen} (F)`;
    btnMap.setAttribute('aria-pressed', String(mode === 'map'));
    btnCabin.setAttribute('aria-pressed', String(mode === 'cabin'));
    bar.setAttribute('aria-label', T.cabinActionsLabel);
    source.textContent = T.cabinSource;
    for (const a of barButtons) a.b.textContent = a.key ? `${T[a.label]} · ${a.key}` : T[a.label];
    postBtn.textContent = T.postcard;
    compass.title = T.cabinShadowLook;
    if (failed) note.textContent = T.cabinUnavailable;
    if (!endBox.hidden) fillEnd();
    summary();
  }

  let whySaid = '';
  function paintActions() {
    const can = game.cabinActions?.() ?? {};
    for (const a of barButtons) a.b.disabled = !can[a.id];
    // The reason next to the button: the same rule as the button itself (transmitReason ↔ transmitDisabled).
    const tx = game.cabinTransmit?.();
    const text = tx && car ? transmitWhy({ ...tx, zone: tx.zone && { ...tx.zone, bearing: cellBearing({ x: car.x, y: car.y }, tx.zone) } }, T,
      (az) => T.winds[compassPoint(az).toUpperCase()]) : '';
    why.hidden = !text;
    if (text !== whySaid) { why.textContent = text; whySaid = text; }
    const route = can.drive ? game.cabinPlan?.() : null;
    driveBtn.hidden = !route; cancelBtn.hidden = !route;
    if (route) { driveBtn.textContent = T.cabinDrive(route.km); cancelBtn.textContent = T.cabinCancel; }
    postBtn.hidden = !game.cabinState?.()?.over;
  }

  function summary() {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      if (!view) return;
      const s = skyAt(series, startMs, view.t);
      const lit = sunFracAt(view.x, view.y, view.t) > 0.5;
      const w = (az) => T.winds[compassPoint(az).toUpperCase()];
      canvas.setAttribute('aria-label', T.cabinSummary(w(s.sun.az), s.sun.el, lit, w(s.earth.az), s.earth.el));
    }, SUMMARY_DELAY_MS);
  }

  function showToast(text, kind = 'warn', ms = 1800) {
    toast.textContent = text; toast.hidden = false;
    toast.classList.toggle('cabin__toast--earth', kind === 'earth');
    toast.classList.toggle('cabin__toast--info', kind === 'info');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
  }

  // The sky and the rover from the game. While the car is being driven the game only moves it cell by cell (cabinStep),
  // so its view is the car's cell; any other change (a route from the minimap, a new game) takes the car with it.
  // The ascent vehicle (J12.8): on its pad from the first frame; on a win, the lift-off with its countdown.
  let padPlaced = false, launched = false, launchTimers = [];
  function watchLaunch() {
    if (!padPlaced) { cabin.setPad?.(cellToScene(scenario, scenario.pad.x, scenario.pad.y)); padPlaced = true; }
    const st = game.cabinState?.();
    if (!st) return;
    if (!st.over) {
      if (endFor) { endFor = null; hideEnd(); }
      if (launched) { launched = false; launchTimers.forEach(clearTimeout); launchTimers = []; cabin.resetLaunch?.(); }
      return;
    }
    if (mode !== 'cabin') return;
    const plan = launchPlan({ over: st.over, launched, reduced: isReduced() });
    // The end card, once per game: after the lift-off (or its still frame), or almost at once on a loss.
    if (!endFor) { endFor = st.over; clearTimeout(endTimer); endTimer = setTimeout(endStep(st.over) === 'result' ? toResult : showEnd, endCardDelay({ over: st.over, plan })); }
    if (!plan) return;
    launched = true;
    // With reduced motion, a still frame with the stage already in the air: never the vehicle left on the ground.
    if (plan === 'still') { cabin.launchStill?.(); showToast(T.launchStill, 'info', 3200); return; }
    cabin.launch?.();
    const { board, count, ignite } = LAUNCH;
    for (const ms of [0, board, board + 1000, board + 2000, board + count, board + count + ignite]) {
      launchTimers.push(setTimeout(() => showToast(launchText(launchAt(ms + 1), T), 'info', ms === board + count + ignite ? 3200 : 1800), ms));
    }
  }

  // «Ver el despegue»: the lift-off again (or its still frame with reduced motion).
  function replayLaunch() {
    const st = game.cabinState?.();
    if (st?.over !== 'win' || mode !== 'cabin') return;
    launched = false; launchTimers.forEach(clearTimeout); launchTimers = [];
    hideEnd(); endFor = null;
    cabin.resetLaunch?.();
    watchLaunch();
  }

  // ---- The end card (#398) ----
  let endFor = null, endTimer = 0;
  function fillEnd() {
    const st = game.cabinState?.();
    const summaryNow = game.cabinEnd?.();
    if (!st?.over || !summaryNow) return false;
    const card = endCard(st.over, summaryNow, T);
    endBox.className = `cabin-end cabin-end--${card.kind}`;
    endBox.setAttribute('aria-label', T.cabinEndLabel);
    endKicker.textContent = card.kicker;
    endTitle.textContent = card.title;
    endWhy.textContent = card.why;
    const had = document.activeElement?.dataset?.endAction;
    endActions.replaceChildren(...card.actions.map((action, i) => {
      const b = el('button', i === 0 ? 'again cabin-end__btn' : 'ghost cabin-end__btn');
      b.textContent = endCardLabel(action, T); b.type = 'button'; b.dataset.endAction = action;
      b.addEventListener('click', () => endAction(action));
      return b;
    }));
    if (had) endActions.querySelector(`[data-end-action="${had}"]`)?.focus({ preventScroll: true });
    return true;
  }
  function showEnd() {
    if (mode !== 'cabin' || !fillEnd()) return;
    toast.hidden = true; liftBox.hidden = true;
    endBox.hidden = false;
    stack.classList.add('cabin-ended');
    endActions.querySelector('button')?.focus({ preventScroll: true });
  }
  // A win: after the lift-off, out of full screen to the result, as «Ver el resultado» does.
  function toResult() { if (mode === 'cabin') endAction('result'); }
  function hideEnd() {
    clearTimeout(endTimer);
    const inside = endBox.contains(document.activeElement);
    endBox.hidden = true;
    stack.classList.remove('cabin-ended');
    if (inside && mode === 'cabin') canvas.focus({ preventScroll: true });
  }
  async function endAction(action) {
    if (action === 'replay') { replayLaunch(); canvas.focus({ preventScroll: true }); return; }
    hideEnd();
    // The result: out of full screen to the map, where the end paints the illumination of the mission, and the
    // focus on the end panel's title.
    if (action === 'result') {
      // Leaving full screen takes the focus away when it ends: the end panel gets it after that.
      const left = document.fullscreenElement === stack
        ? new Promise((resolve) => { document.addEventListener('fullscreenchange', resolve, { once: true }); setTimeout(resolve, 800); })
        : null;
      await show('map');
      await left;
      game.focusEnd?.();
      return;
    }
    // A new game stays in the cabin (and in full screen): the goal dialog opens over it.
    if (action === 'again') { game.cabinRestart?.(); return; }
    canvas.focus({ preventScroll: true });
  }
  // The vehicle greets the crew (#398): beacon and hatch by the clearance, the message and «Despegar».
  let wasNear = false;
  function paintLiftoff() {
    const lift = game.liftoffNow?.();
    if (!lift) return;
    cabin.setVehicleMode?.(beaconMode(lift.status));
    // Arriving at the vehicle: the head turns to it, once each time the rover comes next to the pad.
    // Not on a win: then the lift-off (or its still frame) frames the vehicle, and this turn would undo it.
    if (lift.status.near && !wasNear && mode === 'cabin' && !lift.status.ready) cabin.lookAtVehicle?.();
    wasNear = lift.status.near;
    const msg = lift.message;
    liftBox.hidden = !msg || mode !== 'cabin';
    // At the vehicle the big message already says what to do: the line under «Transmitir» would repeat it.
    if (msg) why.hidden = true;
    if (msg) {
      if (liftTitle.textContent !== msg.title) liftTitle.textContent = msg.title;
      if (liftTodo.textContent !== msg.todo) liftTodo.textContent = msg.todo;
    }
    const won = lift.status.ready;
    liftBtn.hidden = !(msg || won);
    liftBtn.disabled = !won;
    liftBtn.textContent = won ? T.liftoffReplay : T.liftoffButton;
  }

  function update() {
    if (!cabin || !view) return;
    watchLaunch();
    // A route being driven (the view moves while the game is busy): the car follows it, it does not jump cell to cell.
    const st = game.cabinState?.();
    const moved = follow ? view.x !== follow.last.x || view.y !== follow.last.y : car && (view.x !== Math.round(view.x) || view.y !== Math.round(view.y));
    if (car && st?.busy && moved) {
      const now = performance.now();
      if (!follow) follow = { t0: now, at: now, dx: car.x - view.x, dy: car.y - view.y, last: { x: view.x, y: view.y } };
      const fade = Math.max(0, 1 - (now - follow.t0) / 1000 / FOLLOW_BLEND_S);
      car = followRoute(car, { x: view.x + follow.dx * fade, y: view.y + follow.dy * fade }, (now - follow.at) / 1000, cellM);
      follow.at = now; follow.last = { x: view.x, y: view.y };
    } else {
      if (follow && !st?.busy) { follow = null; if (car) car = { ...car, speed: 0, turnRate: 0 }; }
      if (!follow && (!car || cellOf(car).x !== Math.round(view.x) || cellOf(car).y !== Math.round(view.y))) {
        car = { x: view.x, y: view.y, heading: cabinView(scenario, view).heading, speed: 0, turnRate: 0 };
      }
    }
    placeCar();
    const sky = skyAt(series, startMs, view.t);
    cabin.setSky(sky, startMs + view.t * 3600e3, {
      sunLit: sunFracAt(view.x, view.y, view.t) > 0.5,
      // The sky agrees with the engine: over the horizon but not seen from this cell, the Earth is drawn hidden.
      earthSeen: game.earthSeenHere?.() ?? true,
    });
    fixLight(sky);
    zone = game.nearestEarth?.() ?? null;
    // The blue zones on the ground (J12.5): the same layer as the map, by whole hour (null when the layer is off).
    const layer = game.cabinEarth?.(view.t) ?? null;
    cabin.setEarthGround(layer?.now ?? null, layer?.soon ?? []);
    // The Earth rising over the relief from the rover's cell (J12.7): only while playing forward in the cabin.
    const seen = game.earthSeenAt ? game.earthSeenAt(view.x, view.y, view.t) : null;
    if (view.t < lastT) earthBefore = null;
    if (mode === 'cabin' && earthRises(earthBefore, seen)) earthRise();
    earthBefore = seen; lastT = view.t;
    paintCompass();
    paintActions();
    paintLiftoff();
  }
  // The ground's light agrees with the rules at every cell centre (light.js): the atlas's pixels, read once on the CPU,
  // and the engine's sun fraction give a correction per cell, recomputed when the clock moves a tenth of an hour.
  const mapLight = cabinMapLight(scenario, quality);
  let atlas = null, fixKey = null;
  if (mapLight && typeof Image !== 'undefined') {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      const rgba = g.getImageData(0, 0, img.width, img.height).data, bytes = new Uint8Array(img.width * img.height);
      for (let k = 0; k < bytes.length; k++) bytes[k] = rgba[k * 4];
      atlas = bytes; fixKey = null; update();
    };
    img.src = mapLight.url;
  }
  function fixLight(sky) {
    if (!atlas || !view) return;
    const key = Math.round(view.t * 10);
    if (key === fixKey) return;
    fixKey = key;
    const n = scenario.grid.n;
    cabin.setMapFix(cellCorrections((i) => sunFracAt(i % n, Math.floor(i / n), view.t), n, atlas, mapLight.meta, sky.sun.az, sky.sun.el, mapLight.penumbra));
  }

  function earthRise() {
    riseAt = performance.now();
    cabin.earthRise();
    const s = skyAt(series, startMs, view.t);
    showToast(T.cabinEarthRise(T.winds[compassPoint(s.earth.az).toUpperCase()]), 'earth', 3200);
    marks.earth.classList.remove('is-flash'); void marks.earth.offsetWidth; marks.earth.classList.add('is-flash');
  }

  function lookAtShadow() {
    if (!cabin || mode !== 'cabin') return;
    const seen = cabin.lookAtShadow();
    if (seen === 'none') showToast(T.cabinNoShadow, 'info');
    else if (seen === 'behind') showToast(T.cabinShadowBehind, 'info', 2600);
  }

  // The postcard (J12.7): a still from the cabin with the Sun and the Earth in view and the figures of the end.
  async function savePostcard() {
    const st = game.cabinState?.();
    const end = game.cabinEnd?.();
    if (!st?.over || !end) return;
    const c = await ensure();
    if (!c) return;
    if (mode !== 'cabin') { c.resize(); update(); }
    const shot = c.snapshot(1600, 900);
    const g = shot.getContext('2d');
    const band = g.createLinearGradient(0, 900 - 190, 0, 900);
    band.addColorStop(0, 'rgba(6,7,8,0)'); band.addColorStop(1, 'rgba(6,7,8,.88)');
    g.fillStyle = band; g.fillRect(0, 900 - 190, 1600, 190);
    g.fillStyle = gameColors().sun; g.font = '600 26px "Space Grotesk", system-ui, sans-serif';
    g.fillText(T.postcardTitle.toUpperCase(), 56, 900 - 98);
    g.fillStyle = '#ebe8e2'; g.font = '500 34px "JetBrains Mono", ui-monospace, monospace';
    g.fillText(postcardCaption(end, scenarioName(scenario, lang()), T), 56, 900 - 52);
    shot.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = postcardFile(end);
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      showToast(T.postcardSaved, 'info');
    }, 'image/png');
  }
  const placeCar = () => {
    const p = cellToScene(scenario, car.x, car.y);
    cabin.setRover({ x: p.x, z: p.z, heading: car.heading, speed: car.speed, turnRate: car.turnRate });
    paintCompass();
    paintGuide();
    game.setCabinHeading?.(car.heading);
  };
  // The guide line ahead (J12): rebuilt when the car moves or turns, hidden when switched off in «Ajustes».
  let guideKey = '';
  function paintGuide() {
    if (!cabin?.setGuide) return;
    const on = guideOn() && game.cellSlope && (game.cabinState?.().playing ?? false);
    const key = on ? `${car.x.toFixed(3)}|${car.y.toFixed(3)}|${car.heading.toFixed(3)}` : 'off';
    if (key === guideKey) return;
    guideKey = key;
    if (!on) { cabin.setGuide(null); return; }
    const pts = guidePath({ x: car.x, y: car.y, heading: car.heading }, {
      cellM: scenario.grid.cellM, n: scenario.grid.n, maxSlope: game.cabinState().maxSlope, cellSlope: game.cellSlope,
    });
    cabin.setGuide(pts.map((q) => ({ ...cellToScene(scenario, q.x, q.y), tone: q.tone })));
  }

  // The compass follows where the rover faces; the Sun and the Earth come from the series, the zone from the game.
  let zone = null;
  function paintCompass() {
    if (!view || !car) return;
    const headingDeg = (car.heading * 180) / Math.PI;
    const put = (m, az, text) => {
      const k = compassMark(az, headingDeg);
      m.style.left = `${50 + k.x * 48}%`;
      m.classList.toggle('is-off', k.off !== 0);
      m.textContent = k.off ? (k.off < 0 ? `‹ ${text}` : `${text} ›`) : text;
    };
    const winds = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    winds.forEach((w, i) => {
      const k = compassMark(i * 45, headingDeg);
      marks[w].hidden = k.off !== 0;
      marks[w].style.left = `${50 + k.x * 48}%`;
      marks[w].textContent = i % 2 ? '·' : (T.windsShort?.[w] ?? w);
    });
    const s = skyAt(series, startMs, view.t);
    put(marks.sun, s.sun.az, '☀');
    put(marks.earth, s.earth.az, '●');
    marks.earth.classList.toggle('is-down', s.earth.el <= 0);
    marks.earth.classList.toggle('is-hidden', s.earth.el > 0 && !(game.earthSeenHere?.() ?? true));
    marks.earth.title = marks.earth.classList.contains('is-hidden') ? T.cabinEarthHidden : '';
    if (marks.earth.classList.contains('is-hidden')) marks.earth.textContent = `${marks.earth.textContent} ${T.cabinEarthHidden}`;
    put(marks.pad, cellBearing({ x: car.x, y: car.y }, scenario.pad), T.padLabel);
    const speed = kmh(car.speed);
    headingEl.textContent = speed ? `${headingLabel(car.heading, T.windsAbbr)} · ${T.cabinSpeed(speed, controls().turbo && car.speed > 0)}` : headingLabel(car.heading, T.windsAbbr);
    marks.zone.hidden = !zone;
    if (zone) put(marks.zone, cellBearing({ x: car.x, y: car.y }, zone), zone.km < 0.15 ? T.cabinZoneHere : T.cabinZone(zone.km, zone.now));
  }

  // ---- Driving (J12.2) ----
  function controls() {
    let throttle = input.pad.throttle, steer = input.pad.steer;
    for (const k of input.keys) { const [t, s] = DRIVE_KEYS[k]; throttle += t; steer += s; }
    return { throttle: Math.max(-1, Math.min(1, throttle)), steer: Math.max(-1, Math.min(1, steer)), turbo: input.turbo || input.pad.throttle > PAD_TURBO };
  }
  const driving = () => input.keys.size > 0 || input.pad.throttle !== 0 || input.pad.steer !== 0;

  function onFrame(dtRaw) {
    if (!car || mode !== 'cabin' || cabin?.descending()) return;
    // The car slows for a moment while the Earth rises (J12.7), so the player sees it happen.
    const dt = dtRaw * riseSlowdown(riseAt === null ? null : performance.now() - riseAt, isReduced());
    const st = game.cabinState?.();
    const c = controls();
    if (st?.busy && follow) return; // the autopilot drives it (update)
    if (!st?.playing || st.over || st.busy) {
      if (Math.abs(car.speed) > 0 || car.turnRate) { car = { ...car, speed: 0, turnRate: 0 }; placeCar(); }
      return;
    }
    if (!driving() && Math.abs(car.speed) < 1e-4 && !car.turnRate) return;
    const from = cellOf(car);
    let next = stepCar(car, c, dt, cellM);
    const to = cellOf(next);
    if (to.x !== from.x || to.y !== from.y) {
      const out = game.cabinStep?.(to) ?? { ok: false, reason: 'busy' };
      if (!out.ok) {
        next = bounceBack(next, from);
        if (out.reason === 'slope') { cabin.shake(); showToast(T.cabinSlope(st.maxSlope)); }
        else if (out.reason === 'edge') showToast(T.cabinEdge);
      } else if (out.over) next = { ...next, speed: 0 };
    }
    car = next;
    placeCar();
  }

  function ensure() {
    if (cabin || failed) return Promise.resolve(cabin);
    if (!loading) {
      note.hidden = false; note.textContent = T.cabinLoading;
      loading = load(region).then(([m, data]) => {
        cabin = m.createCabin(canvas, data, { level, isReduced, isStable, mapLight, earthGrid: { n: scenario.grid.n, halfKm: (scenario.grid.n * scenario.grid.cellM) / 2000 } });
        cabin.setOnFrame(onFrame);
        update();
        note.hidden = true;
        return cabin;
      }).catch((err) => {
        console.warn(`Cabina no disponible: ${err?.message ?? err}`);
        failed = true; note.hidden = false; note.textContent = T.cabinUnavailable;
        return null;
      });
    }
    return loading;
  }

  async function show(next, { descend = false } = {}) {
    if (next === mode && !descend) return;
    mode = next;
    paintTexts();
    if (mode === 'map') {
      cabin?.stop();
      game.setCabinHeading?.(null);
      input.keys.clear();
      canvas.hidden = true; frameEl.hidden = true; source.hidden = true; note.hidden = true; bar.hidden = true; pad.hidden = true; compass.hidden = true;
      stack.classList.remove('cabin-on');
      hideEnd();
      if (isFull()) toggleFull();
      return;
    }
    // The map stays on screen while the relief loads and the shaders compile; the cabin shows up ready, so the
    // descent starts from its first frame instead of jumping.
    canvas.hidden = false; canvas.style.opacity = '0';
    const c = await ensure();
    if (!c || mode !== 'cabin') { if (!c) canvas.hidden = true; return; }
    c.resize();
    if (descend) c.descend();
    c.prepare();
    frameEl.hidden = false; source.hidden = false; bar.hidden = false; compass.hidden = false;
    pad.hidden = !matchMedia('(pointer: coarse)').matches;
    // The map shrinks to a minimap in a corner (CSS: .cabin-on), still a live map: tapping it plans a route.
    stack.classList.add('cabin-on');
    if (!c.descending()) canvas.style.opacity = '';
    update();
    c.start();
    canvas.focus({ preventScroll: true });
  }

  // ---- Full screen: the Fullscreen API on the map stack, or the whole window when it is not available ----
  const isFull = () => document.fullscreenElement === stack || stack.classList.contains('map-stack--full');
  function toggleFull() {
    if (isFull()) {
      if (document.fullscreenElement === stack) document.exitFullscreen?.();
      stack.classList.remove('map-stack--full');
    } else {
      if (mode !== 'cabin') show('cabin');
      const req = stack.requestFullscreen?.();
      if (req?.catch) req.catch(() => stack.classList.add('map-stack--full'));
      else if (!req) stack.classList.add('map-stack--full');
    }
    setTimeout(() => { cabin?.resize(); paintTexts(); }, 60);
  }
  document.addEventListener('fullscreenchange', () => { cabin?.resize(); paintTexts(); });

  // Drag to look around, with inertia (the scene keeps the speed and lets it fade).
  let drag = null;
  canvas.addEventListener('pointerdown', (ev) => { drag = { x: ev.clientX, y: ev.clientY, t: performance.now() }; canvas.setPointerCapture(ev.pointerId); });
  canvas.addEventListener('pointermove', (ev) => {
    if (!drag || !cabin) return;
    const now = performance.now(), dt = Math.max(8, now - drag.t);
    cabin.pushLook(((drag.x - ev.clientX) / dt) * DRAG_GAIN, ((drag.y - ev.clientY) / dt) * DRAG_GAIN);
    drag = { x: ev.clientX, y: ev.clientY, t: now };
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Keys: W A S D or the arrows drive, Inicio looks ahead, F full screen, Escape leaves the full window; the rest are
  // the game's shortcuts (T transmit, 2 and 6 wait, E until the Earth, L layer, O goal, R status…).
  canvas.addEventListener('keydown', (ev) => {
    const k = ev.key.toLowerCase();
    const action = cabinKey(ev, { planned: Boolean(game.cabinPlan?.()), fullWindow: stack.classList.contains('map-stack--full') });
    if (action === 'drive-key') {
      ev.preventDefault();
      // On autopilot, any driving key takes the controls back in the cell reached (J12.4).
      if (game.stopDrive?.()) showToast(T.cabinTakeOver);
      input.keys.add(k);
      return;
    }
    if (action === 'turbo') { input.turbo = true; return; }
    if (action === 'autopilot') { ev.preventDefault(); game.cabinDrive?.(); return; }
    if (action === 'cancel-route') { ev.preventDefault(); game.cabinCancel?.(); canvas.focus({ preventScroll: true }); return; }
    if (action === 'minimap') { ev.preventDefault(); goMinimap(); return; }
    if (k === 'home') { ev.preventDefault(); cabin?.centreHead(); return; }
    if (k === 'b' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); lookAtShadow(); return; }
    if (k === 'f') { ev.preventDefault(); toggleFull(); return; }
    if (k === 'escape' && stack.classList.contains('map-stack--full')) { ev.preventDefault(); toggleFull(); return; }
    const shortcut = game.keyAction?.(ev);
    if (shortcut && shortcut !== 'wait-sun') { ev.preventDefault(); game.runShortcut?.(shortcut); }
  });

  // M: the keyboard goes to the minimap (the game's map, with its cursor and its Enter to plan); Escape there, with no
  // route planned, comes back to the cabin (J12.6).
  const minimap = () => stack.querySelector('#map');
  function goMinimap() {
    const m = minimap();
    if (!m) return;
    m.focus({ preventScroll: true });
    note.hidden = false; note.textContent = T.cabinMinimap;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (!failed && mode === 'cabin') note.hidden = true; }, 4000);
  }
  stack.addEventListener('keydown', (ev) => {
    if (mode !== 'cabin' || ev.target !== minimap() || ev.key !== 'Escape' || game.cabinPlan?.()) return;
    ev.preventDefault();
    note.hidden = true;
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('keyup', (ev) => {
    const k = ev.key.toLowerCase();
    if (k === TURBO_KEY) input.turbo = false;
    input.keys.delete(k);
  });
  canvas.addEventListener('blur', () => { input.keys.clear(); input.turbo = false; });

  // Touch pad: drag the knob up to drive, down to brake or reverse, sideways to steer.
  let padId = null;
  const padMove = (ev) => {
    const r = pad.getBoundingClientRect(), R = r.width / 2;
    const dx = Math.max(-1, Math.min(1, (ev.clientX - r.left - R) / R)), dy = Math.max(-1, Math.min(1, (ev.clientY - r.top - R) / R));
    input.pad = { throttle: Math.abs(dy) < 0.15 ? 0 : -dy, steer: Math.abs(dx) < 0.15 ? 0 : dx };
    knob.style.transform = `translate(${dx * 50}%, ${dy * 50}%)`;
  };
  pad.addEventListener('pointerdown', (ev) => { padId = ev.pointerId; pad.setPointerCapture(ev.pointerId); padMove(ev); });
  pad.addEventListener('pointermove', (ev) => { if (ev.pointerId === padId) padMove(ev); });
  const padEnd = () => { padId = null; input.pad = { throttle: 0, steer: 0 }; knob.style.transform = ''; };
  pad.addEventListener('pointerup', padEnd);
  pad.addEventListener('pointercancel', padEnd);
  window.addEventListener('resize', () => cabin?.resize());

  paintTexts();
  return {
    offered: true,
    setView(next) { view = next; update(); summary(); },
    active: () => mode === 'cabin',
    /** Gives the keyboard to the cabin (after the tutorial or the goal close over it). */
    focus() { if (mode === 'cabin' && !canvas.hidden) canvas.focus({ preventScroll: true }); },
    focusTarget: canvas,
    /**
     * End of the introduction: the camera leaves the map and comes down to the driver's seat. Resolves when it has
     * landed (or at once if the cabin cannot load), so the goal opens over the cabin, not over the descent.
     */
    async descend() {
      await show('cabin', { descend: true });
      await new Promise((resolve) => {
        const wait = () => (cabin?.descending() ? setTimeout(wait, 100) : resolve());
        wait();
      });
    },
    toLight() {
      cabin?.dispose(); cabin = null; mode = 'map';
      stack.classList.remove('cabin-on', 'map-stack--full', 'cabin-ended');
      for (const e of [canvas, frameEl, source, note, toast, endBox, bar, pad, compass, group]) e.remove();
    },
    setTexts(next) { T = next; paintTexts(); },
    /** «Ajustes»: the guide line on the ground on or off. */
    setGuideOn() { guideKey = ''; if (car) paintGuide(); },
    /** The postcard button for the end panel (J12.7), or null before the end. */
    postcardButton() {
      if (!game.cabinState?.()?.over) return null;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ghost end__postcard'; b.textContent = T.postcard;
      b.addEventListener('click', () => savePostcard());
      return b;
    },
  };
}

function defaultLoad(region) {
  return Promise.all([
    import('./scene.js'),
    import('../../../viewpoint/src/region.js').then((r) => r.loadRegion(region, null, REGION_ROOT)),
  ]);
}

/**
 * The map's horizon per pixel for the cabin's ground (fix of J12.1): the atlas of the quality level in use (J4.3), its
 * layout and the grid's half width (km), so the cabin lights the ground with the same Sun as the map and the rules.
 * null when the scenario has no atlas.
 */
export function cabinMapLight(scenario, quality = null) {
  const meta = scenario?.files?.[quality?.horizon === 'low' ? 'horizonLow' : 'horizon'];
  if (!meta) return null;
  return { url: `${scenarioPath(scenario.id)}${meta.file}`, meta, penumbra: quality?.penumbra !== false, halfKm: (scenario.grid.n * scenario.grid.cellM) / 2000, n: scenario.grid.n };
}
