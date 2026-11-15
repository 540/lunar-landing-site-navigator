// Landing simulator: wires the pure simulation (src/sim) to the cabin, the world outside, the sound and the page.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LANDER } from './sim/physics.js';
import { LIMITS } from './sim/outcome.js';
import { createTerrain } from './sim/terrain.js';
import { CONTROLS, controlById, createControls, powerFailure, press, raiseAlarm, setOn, setThrottle, systems, tick, visual } from './sim/controls.js';
import { CRASH_CARD_S, crashEffects } from './sim/crash.js';
import { createMission, stepMission } from './sim/mission.js';
import { resolve } from './sim/collision.js';
import { CABIN_FLOOR_M, createWorld, curvatureDrop } from './scene/world.js';
import { BOUNDS, CABIN, EYE_SEATED, EYE_STANDING, OBSTACLES, PLAYER_RADIUS, SEATS, SEAT_HEIGHT, STAND_SPOT } from './sim/layout.js';
import { createCabin } from './scene/cabin.js';
import { createPanels } from './scene/panels.js';
import { createDisplays } from './scene/displays.js';
import { createAstronaut, createCrewKit } from './scene/crew.js';
import { CAN_HEIGHT_M, createCan } from './scene/can.js';
import { createDebris } from './scene/debris.js';
import { createAudio } from './audio.js';
import { UI as TEXTS, LANG, useLang, formatNumber } from './texts.js';
import { pct } from '../../shared/format/number.js';
import { initLang, mountLangToggle, carryLang } from '../../shared/i18n/page.js';

const $ = id => document.getElementById(id);
const STEP = 1 / 60, REACH_M = 2.4, WALK_SPEED = 1.25;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

function fillTexts() {
  const t = TEXTS.intro;
  document.title = TEXTS.pageTitle;
  $('gl').setAttribute('aria-label', TEXTS.canvasLabel);
  $('loadingText').textContent = TEXTS.loading;
  $('back').textContent = TEXTS.back;
  $('introKicker').textContent = t.kicker; $('introTitle').textContent = t.heading; $('introText').textContent = t.text;
  $('introControlsTitle').textContent = t.controlsTitle; $('start').textContent = t.start; $('introNote').textContent = t.soundNote;
  $('introControls').replaceChildren(...(coarse ? t.touchControls : t.controls).flatMap(([key, what]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = key; dd.textContent = what; return [dt, dd];
  }));
  $('lblAlt').textContent = TEXTS.hud.alt; $('lblVv').textContent = TEXTS.hud.vv; $('lblVh').textContent = TEXTS.hud.vh; $('lblFuel').textContent = TEXTS.hud.fuel;
  $('retry').textContent = TEXTS.end.retry; $('endHome').textContent = TEXTS.end.home; $('endLimits').textContent = TEXTS.end.limits;
  $('tAuto').textContent = TEXTS.touch.auto;
  for (const [id, key] of [['tUp', 'up'], ['tDown', 'down'], ['tBack', 'tiltBack'], ['tFwd', 'tiltFwd']]) $(id).setAttribute('aria-label', TEXTS.touch[key]);
  $('lockhint').textContent = TEXTS.hud.lockHint;
}

const nextFrame = () => new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)));

async function boot() {
  useLang(initLang());
  carryLang(LANG);
  fillTexts();
  mountLangToggle($('intro').querySelector('.card__actions'), { lang: LANG, buttonClass: 'secondary lang-toggle__btn' });
  const canvas = $('gl');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch { $('loadingText').textContent = TEXTS.noWebgl; document.querySelector('.loading__ring').hidden = true; return; }
  renderer.autoClear = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  await Promise.race([Promise.all(['600 12px Inter', '500 12px "JetBrains Mono"', '700 12px "Space Grotesk"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]).catch(() => {});
  const stage = async i => { $('loadingText').textContent = TEXTS.loadingSteps[i]; await nextFrame(); };

  await stage(0);
  const terrain = createTerrain();
  const world = createWorld(terrain);

  await stage(1);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const cabinScene = new THREE.Scene();
  const cabin = createCabin(envMap);
  cabinScene.add(cabin.group);
  const panels = createPanels(cabinScene);
  const cameraTarget = new THREE.WebGLRenderTarget(384, 288);
  const nominal = (() => {
    const sys = { engine: true, engineArmed: true, autopilot: true, rcs: true, gear: true, abort: false, throttle: 0 };
    const path = [];
    for (let m = createMission(), i = 0; !m.ended && i < 60 * 400; i++) { m = stepMission(m, sys, {}, STEP, terrain).mission; if (i % 60 === 0) path.push([m.state.x, m.state.alt]); }
    return path;
  })();
  const displays = createDisplays(cabinScene, panels, { cameraTarget, terrain, nominal });

  await stage(2);
  const kit = createCrewKit(envMap);
  const seatRoot = seat => new THREE.Vector3(SEATS[seat].x, SEAT_HEIGHT, SEATS[seat].z + 0.05);
  const crew = {
    pilot: createAstronaut(kit, { role: 'PLT', accent: 0x3f7fd9, seed: 1 }),
    specialist1: createAstronaut(kit, { role: 'MS1', accent: 0x3fa66b, tablet: true, seed: 2 }),
    specialist2: createAstronaut(kit, { role: 'MS2', accent: 0xe0a030, seed: 3 }),
  };
  for (const [seat, a] of Object.entries(crew)) { a.root.position.copy(seatRoot(seat)); cabinScene.add(a.root); }
  crew.specialist1.setPose('tablet');
  const self = createAstronaut(kit, { role: 'CDR', accent: 0xd9485f, headless: true });
  self.root.position.copy(seatRoot('commander')); self.setPose('stick'); cabinScene.add(self.root);

  const can = createCan(envMap);
  can.position.set(-1.3, 0.622, -0.5); can.rotation.y = 0.5;
  cabinScene.add(can);
  const debris = createDebris(cabinScene);

  const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 30);
  camera.rotation.order = 'YXZ';
  const audio = createAudio();

  // ---- State ----
  let controls = createControls(), mission = createMission(), trail = [], shown = new Map();
  let running = false, started = false, acc = 0, time = 0, last = performance.now(), endTimer = 0, endShown = false;
  let crashT = -1, crashShake = 0, hintFor = null, radioTimer = 0, hintTimer = 0, rcsTimer = 0, trailTimer = 0, hudTimer = 0, jolt = 0, reachTimer = 0, cheerTimer = 0, canLine = 0;
  const player = { seated: true, x: SEATS.commander.x, z: SEATS.commander.z, yaw: 0, pitch: -0.12, eye: new THREE.Vector3(SEATS.commander.x, SEAT_HEIGHT + EYE_SEATED, SEATS.commander.z + 0.06), walk: 0 };
  const keys = new Set(), touch = { moveX: 0, moveZ: 0, throttle: 0, pitch: 0 };
  let locked = false, canLock = !coarse && 'requestPointerLock' in canvas, drag = null, pointer = null, debugView = null, hover = null;

  const props = [
    { id: 'can', centre: new THREE.Vector3().copy(can.position).add(new THREE.Vector3(0, CAN_HEIGHT_M / 2, 0)), radius: 0.07, label: TEXTS.props.can },
    { id: 'seat', centre: new THREE.Vector3(SEATS.commander.x, 0.95, SEATS.commander.z + 0.2), radius: 0.36, label: TEXTS.props.seat },
    { id: 'hatch', centre: new THREE.Vector3(0, 1.05, CABIN.back - 0.05), radius: 0.45, label: TEXTS.props.hatch },
    ...Object.keys(crew).map(seat => ({ id: seat, centre: seatRoot(seat).add(new THREE.Vector3(0, 0.74, 0.08)), radius: 0.2, label: TEXTS.props[seat] })),
  ];

  // ---- Messages ----
  const say = (el, text, seconds, setTimer) => { el.textContent = text; el.hidden = false; setTimer(seconds); };
  // `about` is the control a hint talks about, so a later clearHint event for it can take it down.
  const hint = (text, seconds = 3.2, about = null) => { hintFor = about; say($('hint'), text, seconds, s => { hintTimer = s; }); };
  const radio = text => { say($('radio'), text, 4, s => { radioTimer = s; }); audio.play('radio'); };

  // ---- Controls ----
  function syncVisuals() {
    for (const c of CONTROLS) {
      const v = visual(controls, c.id), key = `${v.on}|${v.cover}|${v.pos}|${v.value}`;
      if (shown.get(c.id) !== key) { shown.set(c.id, key); panels.refresh(c.id, v); }
    }
    const sys = systems(controls);
    cabin.setLights(sys.cabinLights);
    panels.setPanelLights(sys.panelLights ? 0.9 : 0.04);
    audio.setAlarm(sys.alarm && running);
  }

  function handle(events) {
    for (const e of events) {
      if (e.type === 'sound') audio.play(e.name);
      else if (e.type === 'hint') hint(TEXTS.hints[e.code], 3.2, e.id);
      else if (e.type === 'clearHint' && hintFor === e.id && hintTimer > 0) { hintTimer = 0; hintFor = null; $('hint').hidden = true; }
      else if (e.type === 'change' && e.id === 'autopilot') hint(systems(controls).autopilot ? TEXTS.hints.auto : coarse ? TEXTS.hints.manualTouch : TEXTS.hints.manual, 4.5);
    }
  }

  function doPress(id, dir = 1) {
    const r = press(controls, id, dir);
    controls = r.state; handle(r.events); syncVisuals();
  }

  function useProp(id) {
    if (id === 'can') { hint(TEXTS.can[canLine++ % TEXTS.can.length], 5); audio.play('can'); }
    else if (id === 'seat') toggleSeat();
    else if (id === 'hatch') { hint(TEXTS.hints.hatch, 4.5); audio.play('denied'); }
    else { const lines = TEXTS.crew[id]; radio(`${TEXTS.props[id]}: ${lines[Math.floor(time * 7) % lines.length]}`); }
  }

  function toggleSeat() {
    if (player.seated) { player.seated = false; player.x = STAND_SPOT.x; player.z = STAND_SPOT.z; audio.play('seat'); }
    else if (Math.hypot(player.x - SEATS.commander.x, player.z - SEATS.commander.z) < 1.5) { player.seated = true; audio.play('seat'); }
    else hint(TEXTS.hints.seatTaken);
    syncSeat();
  }
  function syncSeat() {
    $('tSit').textContent = player.seated ? TEXTS.touch.stand : TEXTS.touch.sit;
    $('stickpad').classList.toggle('off', player.seated);
  }

  // ---- Picking ----
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), toCentre = new THREE.Vector3();
  function pick(x, y) {
    ndc.set(x, y); raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    let best = panels.pick(ray, REACH_M);
    best = best && { kind: 'control', id: best.id, distance: best.distance };
    for (const p of props) {
      if (p.id === 'seat' && player.seated) continue;
      const t = toCentre.subVectors(p.centre, ray.origin).dot(ray.direction);
      if (t < 0.1 || t > REACH_M + 0.6 || (best && t > best.distance) || ray.distanceSqToPoint(p.centre) > p.radius * p.radius) continue;
      best = { kind: 'prop', id: p.id, distance: t, label: p.label };
    }
    return best;
  }
  const interact = (hit, dir = 1) => { if (!hit || !started) return; if (hit.kind === 'control') doPress(hit.id, dir); else useProp(hit.id); };

  function describe(hit) {
    if (hit.kind === 'prop') return `<b>${hit.label}</b>`;
    const def = controlById(hit.id), v = visual(controls, hit.id), h = TEXTS.controlHint;
    const stateText = def.kind === 'rotary' ? TEXTS.cockpit(def.positions[v.pos]) : def.kind === 'lever' ? `${Math.round(v.value * 100)} % · ${h.lever}`
      : def.kind === 'stick' ? h.stick : def.kind === 'guarded' ? `${v.on ? h.on : h.off} · ${!v.cover ? h.coverClosed : !v.on ? h.coverOpen : def.latch ? h.coverOpenLatched : h.coverOpenOn}` : v.on ? h.on : h.off;
    return `<b>${TEXTS.cockpit(def.label)}</b> · ${stateText}`;
  }

  // ---- Input ----
  const LOOK = 0.0023;
  const look = (dx, dy, k) => { player.yaw -= dx * k; player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * k)); };
  canvas.addEventListener('pointerdown', e => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, button: e.button }; if (!locked) canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (locked) { look(e.movementX, e.movementY, LOOK); return; }
    pointer = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    look(-dx, -dy, LOOK * 1.25);
  });
  const release = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const click = drag.moved < 8, dir = drag.button === 2 || e.shiftKey ? -1 : 1;
    drag = null;
    if (!click || e.type === 'pointercancel' || !started) return;
    if (locked) return interact(pick(0, 0), dir);
    const at = () => interact(pick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), dir);
    if (canLock && e.pointerType === 'mouse' && !endShown) Promise.resolve(canvas.requestPointerLock()).catch(() => { canLock = false; at(); });
    else at();
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (hover?.kind === 'control' && ['lever', 'rotary'].includes(controlById(hover.id).kind)) doPress(hover.id, e.deltaY < 0 ? 1 : -1); }, { passive: false });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
  document.addEventListener('pointerlockerror', () => { canLock = false; });
  addEventListener('keydown', e => {
    if (!started || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyE') toggleSeat();
    else if (e.code === 'KeyM') doPress('autopilot');
    else if (e.code === 'KeyG') { controls = setOn(controls, 'gear', !systems(controls).gear); audio.play('switch'); syncVisuals(); }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  if (coarse) {
    $('app').classList.add('touching');
    const pad = $('stickpad'), dot = $('stickdot');
    const move = e => {
      const r = pad.getBoundingClientRect(), dx = (e.clientX - r.left) / r.width * 2 - 1, dy = (e.clientY - r.top) / r.height * 2 - 1, m = Math.max(1, Math.hypot(dx, dy));
      touch.moveX = dx / m; touch.moveZ = dy / m; dot.style.transform = `translate(${touch.moveX * 30}px, ${touch.moveZ * 30}px)`;
    };
    const stop = () => { touch.moveX = touch.moveZ = 0; dot.style.transform = ''; };
    pad.addEventListener('pointerdown', e => { pad.setPointerCapture(e.pointerId); move(e); });
    pad.addEventListener('pointermove', e => { if (pad.hasPointerCapture(e.pointerId)) move(e); });
    pad.addEventListener('pointerup', stop); pad.addEventListener('pointercancel', stop);
    const hold = (id, key, value) => { const b = $(id); b.addEventListener('pointerdown', () => { touch[key] = value; }); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { touch[key] = 0; }); };
    hold('tUp', 'throttle', 1); hold('tDown', 'throttle', -1); hold('tBack', 'pitch', 1); hold('tFwd', 'pitch', -1);
    $('tSit').addEventListener('click', toggleSeat);
    $('tAuto').addEventListener('click', () => doPress('autopilot'));
    $('tSit').textContent = TEXTS.touch.stand; pad.classList.add('off');
  }

  // ---- Simulation ----
  function stepSim(dt) {
    let sys = systems(controls);
    const throttleInput = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0) + touch.throttle;
    if (!sys.autopilot && throttleInput) { controls = setThrottle(controls, sys.throttle + throttleInput * 0.4 * dt); sys = systems(controls); }
    const pitch = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0) + touch.pitch;
    const r = stepMission(mission, sys, { pitch }, dt, terrain);
    mission = r.mission;
    for (const e of r.events) {
      if (e.type === 'crew') {
        controls = setOn(controls, e.id, e.on); audio.play('switch'); syncVisuals();
        crew.pilot.setPose('reach'); reachTimer = 1.6; radio(e.id === 'gear' ? TEXTS.radio.gear : TEXTS.radio.armed);
      } else if (e.type === 'phase') {
        if (e.phase === 'braking') radio(TEXTS.radio.ignition); else if (e.phase === 'final') radio(TEXTS.radio.final); else if (e.phase === 'abort') radio(TEXTS.radio.abort);
      } else if (e.type === 'callout') radio(TEXTS.radio.height(e.height, e.vz));
      else if (e.type === 'warning') { controls = raiseAlarm(controls); syncVisuals(); }
      else if (e.type === 'end') finish(e.outcome);
    }
    // Under autopilot the throttle lever follows the engine, so taking over starts from where the autopilot left it.
    if (sys.autopilot && Math.abs(sys.throttle - mission.state.throttle) > 0.015) controls = setThrottle(controls, mission.state.throttle);
    const lever = visual(controls, 'throttle');
    if (shown.get('throttle') !== `${lever.on}|undefined|undefined|${lever.value}`) syncVisuals();
    if ((trailTimer -= dt) <= 0) { trailTimer = 0.5; trail.push([mission.state.x, mission.state.alt]); }
  }

  function finish(outcome) {
    const r = outcome.result;
    audio.setEngine(0);
    if (r === 'soft' || r === 'hard') { audio.play('contact'); radio(TEXTS.radio.contact); jolt = r === 'soft' ? 0.5 : 1; }
    else if (r === 'crash') {
      // The lights go out through the controls state, so syncVisuals() keeps them out (cabin.setLights alone was undone).
      audio.play('crash'); radio(TEXTS.radio.crash); crashT = 0; controls = powerFailure(controls);
      for (const a of Object.values(crew)) a.setPose('brace');
      if (!reducedMotion) debris.burst(v3.set(0, 1.0, -1.25), 90);
    }
    if (r === 'soft') { audio.play('success'); cheerTimer = 6; for (const a of Object.values(crew)) a.setPose('cheer'); }
    syncVisuals();
    endTimer = r === 'crash' ? CRASH_CARD_S : 2.6;
  }

  function showEnd() {
    const o = mission.outcome, t = TEXTS.end[o.result], card = $('end'), s = mission.state;
    endShown = true; audio.setAlarm(false);
    document.exitPointerLock?.();
    card.className = `card card--end ${o.result}`;
    $('endKicker').textContent = `${TEXTS.title} · ${TEXTS.phases[mission.phase] ?? ''}`;
    $('endTitle').textContent = t.title; $('endText').textContent = t.text;
    $('endReasons').replaceChildren(...(o.reasons ?? []).map(code => Object.assign(document.createElement('li'), { textContent: TEXTS.end.reasons[code] })));
    const rows = [];
    const row = (label, value, state) => rows.push(Object.assign(document.createElement('dt'), { textContent: label }), Object.assign(document.createElement('dd'), { textContent: value, className: state ?? '' }));
    const grade = (value, limit) => (value <= limit ? 'fine' : 'over');
    if ('vertical' in o) {
      row(TEXTS.end.rows.vertical, `${formatNumber(o.vertical, 1)} m/s`, grade(o.vertical, LIMITS.soft.vertical));
      row(TEXTS.end.rows.horizontal, `${formatNumber(o.horizontal, 1)} m/s`, grade(o.horizontal, LIMITS.soft.horizontal));
      row(TEXTS.end.rows.tilt, `${formatNumber(o.tiltDeg, 1)}°`, grade(o.tiltDeg, LIMITS.soft.tiltDeg));
      row(TEXTS.end.rows.distance, `${formatNumber(o.distanceM, 0)} m`);
    }
    row(TEXTS.end.rows.fuel, `${formatNumber(s.fuelKg, 0)} kg (${pct(LANG, (s.fuelKg / LANDER.fuelKg) * 100)})`);
    row(TEXTS.end.rows.time, `${formatNumber(s.t, 0)} s`);
    if (o.score) row(TEXTS.end.rows.score, `${o.score} / 100`);
    $('endStats').replaceChildren(...rows);
    $('endLimits').hidden = !('vertical' in o);
    card.hidden = false; $('reticle').hidden = true; $('lockhint').hidden = true; $('touch').hidden = true;
    $('retry').focus();
  }

  function restart() {
    controls = createControls(); mission = createMission(); trail = []; shown = new Map();
    acc = 0; endTimer = 0; endShown = false; jolt = 0; cheerTimer = 0;
    for (const a of Object.values(crew)) a.setPose('rest');
    crew.specialist1.setPose('tablet');
    // Back in the seat from anywhere in the cabin (toggleSeat only sits when the seat is within reach).
    player.seated = true; player.x = SEATS.commander.x; player.z = SEATS.commander.z;
    player.eye.set(SEATS.commander.x, SEAT_HEIGHT + EYE_SEATED, SEATS.commander.z + 0.06);
    syncSeat();
    player.yaw = 0; player.pitch = -0.12;
    hintTimer = radioTimer = 0; $('hint').hidden = true; $('hint').dataset.html = ''; $('radio').hidden = true;
    crashT = -1; crashShake = 0; $('flash').style.opacity = $('smoke').style.opacity = '0'; cabin.setCrash(); debris.clear();
    $('end').hidden = true; $('warn').hidden = true; $('reticle').hidden = coarse; $('touch').hidden = !coarse;
    syncVisuals(); running = true;
  }

  function start() {
    if (started) return;
    started = true; running = true;
    $('intro').hidden = true; $('strip').hidden = false; $('reticle').hidden = coarse; $('touch').hidden = !coarse;
    audio.start(); syncVisuals();
    if (canLock) Promise.resolve().then(() => canvas.requestPointerLock()).catch(() => { canLock = false; });
  }
  $('start').addEventListener('click', start);
  $('retry').addEventListener('click', restart);
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.suspend(); else if (started) audio.start(); });

  // ---- Frame ----
  const qBase = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)));
  const qLander = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), qInv = new THREE.Quaternion(), qDown = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const Z = new THREE.Vector3(0, 0, 1), origin = new THREE.Vector3(), v3 = new THREE.Vector3(), eyeTarget = new THREE.Vector3(), sunCabin = new THREE.Vector3(), local = new THREE.Vector3();
  const shakeScale = reducedMotion ? 0.12 : 1;

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
    for (const c of [camera, world.camera]) { c.aspect = w / h; c.fov = w < h ? 86 : 72; c.updateProjectionMatrix(); }
  }
  addEventListener('resize', resize); resize();

  function updatePlayer(dt) {
    if (!player.seated) {
      const fx = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + touch.moveX, fz = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0) + touch.moveZ;
      const len = Math.hypot(fx, fz);
      if (len > 0.05) {
        const k = WALK_SPEED * dt / Math.max(1, len), sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
        const next = resolve({ x: player.x + (fx * cos + fz * sin) * k, z: player.z + (fz * cos - fx * sin) * k }, PLAYER_RADIUS, BOUNDS, OBSTACLES);
        player.walk += Math.hypot(next.x - player.x, next.z - player.z);
        player.x = next.x; player.z = next.z;
      }
      eyeTarget.set(player.x, EYE_STANDING + (reducedMotion ? 0 : Math.sin(player.walk * 9) * 0.012), player.z);
    } else eyeTarget.set(SEATS.commander.x, SEAT_HEIGHT + EYE_SEATED, SEATS.commander.z + 0.06);
    player.eye.lerp(eyeTarget, 1 - Math.exp(-dt * 7));
    self.root.visible = player.seated && player.eye.distanceTo(eyeTarget) < 0.25;
  }

  let frames = 0;
  function frame(now) {
    requestAnimationFrame(frame); frames++;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
    if (running && !mission.ended) { acc += dt; while (acc >= STEP) { stepSim(STEP); acc -= STEP; if (mission.ended) break; } }
    const ticked = tick(controls, dt);
    if (ticked !== controls) { controls = ticked; syncVisuals(); }
    updatePlayer(dt);
    advance(dt);
    draw();
  }

  function advance(dt) {
    const s = mission.state, sys = systems(controls);
    if (endTimer > 0 && (endTimer -= dt) <= 0) showEnd();
    if (hintTimer > 0 && (hintTimer -= dt) <= 0) $('hint').hidden = true;
    if (radioTimer > 0 && (radioTimer -= dt) <= 0) $('radio').hidden = true;
    if (reachTimer > 0 && (reachTimer -= dt) <= 0) crew.pilot.setPose('rest');
    if (crashT >= 0) {
      crashT += dt;
      const fx = crashEffects(crashT, { reduced: reducedMotion });
      $('flash').style.opacity = fx.flash.toFixed(3); $('smoke').style.opacity = fx.smoke.toFixed(3);
      cabin.setCrash(fx); crashShake = fx.shake;
      if (fx.sparks && Math.random() < dt * 10) debris.burst(v3.set((Math.random() - 0.5) * 2, 0.95 + Math.random() * 0.9, -1.3 + Math.random() * 0.4), 14);
    }
    debris.update(dt);
    if (cheerTimer > 0 && (cheerTimer -= dt) <= 0) { for (const a of Object.values(crew)) a.setPose('rest'); crew.specialist1.setPose('tablet'); }

    // Hover: what a click would act on.
    const aim = endShown || !started ? null : locked ? pick(0, 0) : pointer && !drag ? pick((pointer.x / innerWidth) * 2 - 1, -(pointer.y / innerHeight) * 2 + 1) : null;
    if (aim?.id !== hover?.id || aim?.kind !== hover?.kind || aim) {
      hover = aim;
      $('reticle').classList.toggle('on', !!aim);
      if (aim && hintTimer <= 0) { const html = describe(aim); if ($('hint').dataset.html !== html) { $('hint').innerHTML = html; $('hint').dataset.html = html; } $('hint').hidden = false; }
      else if (!aim && hintTimer <= 0) { $('hint').hidden = true; $('hint').dataset.html = ''; }
    }
    canvas.style.cursor = locked ? 'none' : aim ? 'pointer' : 'grab';
    $('lockhint').hidden = !(started && canLock && !locked && !endShown);

    // Vehicle effects.
    audio.setEngine(running ? s.throttle : 0);
    const turning = Math.abs(s.pitchRateDegS) > 0.6 && running && !mission.ended;
    for (const p of cabin.plumes) { const on = turning && p.back === 0 && Math.sign(s.pitchRateDegS) === -p.up; p.sprite.material.opacity += ((on ? 0.75 : 0) - p.sprite.material.opacity) * Math.min(1, dt * 20); }
    if (turning && (rcsTimer -= dt) <= 0) { rcsTimer = 0.32; audio.play('rcs'); }
    panels.setGauge('thrust', s.throttle); panels.setGauge('fuel', s.fuelKg / LANDER.fuelKg);
    panels.setGauge('pressure', 0.57 + Math.sin(time * 0.3) * 0.004); panels.setGauge('oxygen', 0.96);
    panels.setGauge('volts', 0.56 + s.throttle * 0.03 + Math.sin(time * 1.7) * 0.004); panels.setGauge('temp', 0.21 + s.throttle * 0.05);
    panels.update(dt, sys.autopilot ? s.pitchRateDegS / 7 : (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0) + touch.pitch);

    const lively = reducedMotion ? 0.35 : 1;
    for (const [seat, a] of Object.entries(crew)) {
      let focus = null;
      if (!player.seated && player.eye.distanceTo(a.root.position) < 2 && cheerTimer <= 0) focus = local.copy(player.eye).sub(a.root.position);
      else if (seat === 'pilot' && reachTimer > 0) focus = local.set(-0.6, 0.15, -0.3);
      a.update(dt, time, focus, lively);
    }
    self.update(dt, time, null, lively);

    displays.update({ state: s, phase: mission.phase, height: mission.height, gear: mission.gear, warnings: mission.warnings, sys, values: controls.values, trail, blink: Math.floor(time * 3) % 2 === 0 });

    if ((hudTimer -= dt) <= 0) {
      hudTimer = 0.1;
      $('phase').textContent = TEXTS.phases[mission.phase];
      $('alt').textContent = formatNumber(Math.max(0, mission.height), 0);
      $('vv').textContent = formatNumber(s.vz, 1); $('vv').classList.toggle('alert', mission.warnings.sinkRate);
      $('vh').textContent = formatNumber(s.vx, 1);
      $('fuel').textContent = formatNumber((s.fuelKg / LANDER.fuelKg) * 100, 0); $('fuel').classList.toggle('alert', mission.warnings.lowFuel);
      $('mode').textContent = sys.autopilot ? TEXTS.hud.auto : TEXTS.hud.manual; $('mode').classList.toggle('manual', !sys.autopilot);
      const active = Object.keys(TEXTS.warnings).find(code => mission.warnings[code]);
      $('warn').hidden = !active || mission.ended || !started;
      if (active) $('warn').textContent = TEXTS.warnings[active];
    }
  }

  function draw() {
    const s = mission.state;
    qPitch.setFromAxisAngle(Z, (s.pitchDeg * Math.PI) / 180);
    qLander.multiplyQuaternions(qPitch, qBase);
    origin.set(s.x, s.alt - curvatureDrop(Math.abs(s.x)) + CABIN_FLOOR_M, 0);

    // Engine vibration and the jolt of the contact: the cabin shakes around the head more than the horizon does.
    const power = (running && !mission.ended ? s.throttle : 0) * shakeScale, n = (a, b) => Math.sin(time * a) * Math.sin(time * b + 1.3);
    jolt *= Math.exp(-(1 / 60) * 3.2);
    const bump = jolt * shakeScale * Math.sin(time * 38) * 0.02;
    const eye = debugView ? debugView.pos : player.eye, yaw = debugView ? debugView.yaw : player.yaw, pitch = debugView ? debugView.pitch : player.pitch;
    const hit = crashShake;
    camera.position.set(eye.x + n(91, 13) * 0.0022 * power + n(23, 7) * 0.05 * hit, eye.y + n(113, 17) * 0.003 * power + bump + n(29, 5) * 0.06 * hit, eye.z + n(77, 11) * 0.0016 * power + n(19, 3) * 0.04 * hit);
    camera.rotation.set(pitch + n(67, 9) * 0.0022 * power + bump * 0.6 + n(31, 4) * 0.07 * hit, yaw + n(59, 7) * 0.0016 * power + n(17, 6) * 0.05 * hit, n(83, 5) * 0.002 * power + n(37, 2) * 0.09 * hit);
    camera.updateMatrixWorld();

    world.camera.position.copy(v3.copy(eye).applyQuaternion(qLander)).add(origin);
    world.camera.quaternion.copy(qLander).multiply(camera.quaternion);
    world.scene.children.find(o => o.isGroup)?.position.copy(world.camera.position);
    world.update({ x: s.x, y: origin.y - CABIN_FLOOR_M, height: mission.height, throttle: s.throttle, lights: systems(controls).landingLights, time });

    sunCabin.copy(world.sun).applyQuaternion(qInv.copy(qLander).invert());
    cabin.sun.position.copy(cabin.sun.target.position).addScaledVector(sunCabin, 8);

    if (displays.cameraActive({ sys: systems(controls) }) && Math.round(time * 60) % 2 === 0) {
      world.downCamera.position.copy(v3.set(0, -1.2, 0).applyQuaternion(qLander)).add(origin);
      world.downCamera.quaternion.copy(qLander).multiply(qDown);
      renderer.setRenderTarget(cameraTarget); renderer.clear(); renderer.render(world.scene, world.downCamera); renderer.setRenderTarget(null);
    }
    renderer.clear();
    renderer.render(world.scene, world.camera);
    renderer.clearDepth();
    renderer.render(cabinScene, camera);
  }

  // Hook for the headless checks (Playwright): jump the clock, move the camera and read the state.
  window.__lander = {
    start, restart, press: doPress, use: useProp, toggleSeat,
    state: () => ({ crash: crashT, phase: mission.phase, ended: mission.ended, outcome: mission.outcome, height: mission.height, t: mission.state.t, x: mission.state.x, vz: mission.state.vz, pitchDeg: mission.state.pitchDeg, fuelKg: mission.state.fuelKg, systems: systems(controls), seated: player.seated, player: { x: player.x, z: player.z }, endShown, frames, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    advance(seconds) { for (let i = 0; i < seconds * 60 && !mission.ended; i++) stepSim(STEP); },
    view(x, y, z, yaw, pitch) { debugView = x === undefined ? null : { pos: new THREE.Vector3(x, y, z), yaw, pitch }; },
    look(yaw, pitch) { player.yaw = yaw; player.pitch = pitch; },
    aim(id) {
      const target = panels.controls.get(id)?.centre ?? props.find(p => p.id === id)?.centre;
      if (!target) return false;
      const d = v3.copy(target).sub(player.eye);
      player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      return true;
    },
    walk(x, z) { const p = resolve({ x, z }, PLAYER_RADIUS, BOUNDS, OBSTACLES); player.x = p.x; player.z = p.z; return p; },
  };

  syncVisuals();
  advance(0); draw();
  $('loading').classList.add('done');
  $('intro').hidden = false;
  $('start').focus();
  requestAnimationFrame(now => { last = now; frame(now); });
}

boot();
