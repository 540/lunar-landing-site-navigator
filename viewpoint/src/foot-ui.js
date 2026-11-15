// On foot in the exploration (E3, #181): the button to go down and back up, the compass (E3.4), the position in the
// readout, the help line and the touch controls (E3.5). The camera and the walking live in scene.js and foot-view.js.
import { UI, LANG } from './texts.js';
import { compassReading, octant } from './core/compass.js';
import { joystickInput } from './core/walk.js';
import { deg } from '../../shared/format/number.js';

const T = UI.foot; // loaded with the scene, once useLang() has chosen the language
// Numbers in the language of the screen (shared/format/).
const heading = v => deg(LANG, v, 0);
const coord = v => deg(LANG, v, 4, 4);
const JOY_RADIUS_PX = 40;

/**
 * @param {object} view the scene (createScene with explore: true), with view.foot
 * @param {{fromScene:Function, toScene:Function}} frame SceneFrame of the region
 * @param {() => ({sun:{az:number,el:number}, earth:{az:number,el:number}}|null)} sky the Sun and the Earth now
 * @returns {{refresh:() => void}} refresh: call it when the time changes
 */
export function setupFoot(view, frame, sky) {
  const $ = id => document.getElementById(id);
  const button = $('foot-btn'), compass = $('compass'), help = $('foot-help'), pos = $('pos-readout');
  const joy = $('joy'), knob = $('joy-knob'), jump = $('jump-btn');
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const foot = view.foot;

  help.textContent = coarse ? T.helpTouch : T.help;
  $('compass-north').textContent = T.north;
  joy.setAttribute('aria-label', T.joystick);
  joy.setAttribute('role', 'presentation');
  jump.setAttribute('aria-label', T.jump);
  jump.title = T.jump;

  const paintButton = () => { button.textContent = foot.active ? T.up : T.down; };
  // Third person (V)
  const viewBtn = $('view-btn');
  const paintView = on => { viewBtn.setAttribute('aria-pressed', String(on)); viewBtn.setAttribute('aria-label', on ? T.thirdOff : T.thirdOn); viewBtn.title = on ? T.thirdOff : T.thirdOn; };
  paintView(false);
  viewBtn.addEventListener('click', ev => { foot.setThirdPerson(!foot.thirdPerson); if (ev.detail > 0) viewBtn.blur(); });
  foot.onView(paintView);
  foot.onModeChange(mode => { viewBtn.hidden = mode !== 'foot'; });
  paintButton();
  button.hidden = false;
  button.addEventListener('click', ev => {
    if (foot.active) { foot.exit(); return; }
    foot.enter();
    // With the mouse, the keys go to the scene (Space would press the button again); with the keyboard, focus stays.
    if (ev.detail > 0) button.blur();
  });

  let reading = null;
  function read() {
    const s = foot.state(), now = sky();
    if (!s || !now) return null;
    return { s, r: compassReading({ frame, x: s.x, z: s.z, yaw: s.yaw, sun: now.sun, earth: now.earth }) };
  }

  let queued = false;
  function paint() {
    queued = false;
    reading = read();
    if (!reading) return;
    const { s, r } = reading;
    const mark = (el, dial, up) => { el.style.setProperty('--a', `${dial}deg`); if (up !== undefined) el.dataset.up = String(up); };
    mark($('compass-north'), r.north);
    mark($('compass-sun'), r.sun.dial, r.sun.up);
    mark($('compass-earth'), r.earth.dial, r.earth.up);
    $('compass-heading').textContent = T.heading(T.short[octant(r.heading)], heading(r.heading));
    compass.setAttribute('aria-label', `${T.compass}: ${status(r)}`);
    const { lat, lon } = frame.fromScene(s.x, s.z);
    pos.textContent = T.position(coord(lat), coord(lon));
  }
  const schedule = () => { if (!queued && foot.active) { queued = true; requestAnimationFrame(paint); } };

  const status = r => T.status(T.directions[octant(r.heading)], heading(r.heading),
    { side: T.sides[r.sun.side], up: r.sun.up }, r.earth && { side: T.sides[r.earth.side], up: r.earth.up });
  // The screen reader hears where you look and where the Sun and the Earth are once you stop, not on every frame.
  // (Not while the watch is up: it has its own announcement.)
  foot.onStop(() => { if (foot.watchUp) return; const x = read(); if (x) $('foot-status').textContent = status(x.r); });

  view.onCameraChange(schedule);
  foot.onModeChange(mode => {
    const onFoot = mode === 'foot';
    document.body.classList.toggle('is-foot', onFoot);
    paintButton();
    compass.hidden = help.hidden = pos.hidden = !onFoot;
    joy.hidden = jump.hidden = !(onFoot && coarse);
    if (!onFoot) resetJoystick();
    if (onFoot) { refresh(); $('foot-status').textContent = reading ? status(reading.r) : ''; }
  });

  // Joystick: one finger on it walks (the same input as WASD); the scene is not touched.
  let joyPointer = null;
  const moveJoystick = ev => {
    const r = joy.getBoundingClientRect();
    const dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
    const k = Math.min(1, JOY_RADIUS_PX / Math.max(1e-9, Math.hypot(dx, dy)));
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    foot.setJoystick(joystickInput(dx, dy, JOY_RADIUS_PX));
  };
  function resetJoystick() { joyPointer = null; knob.style.transform = ''; foot.setJoystick(null); }
  joy.addEventListener('pointerdown', ev => { joyPointer = ev.pointerId; try { joy.setPointerCapture(ev.pointerId); } catch { /* ignore */ } moveJoystick(ev); ev.preventDefault(); });
  joy.addEventListener('pointermove', ev => { if (ev.pointerId === joyPointer) moveJoystick(ev); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) joy.addEventListener(type, ev => { if (ev.pointerId === joyPointer) resetJoystick(); });
  jump.addEventListener('click', () => foot.jump());

  function refresh() {
    // The Earth of the scene is placed by main.js (view.setExploreEarth), from the drone and on foot.
    if (foot.active) { paint(); view.render(); }
  }
  return { refresh };
}
