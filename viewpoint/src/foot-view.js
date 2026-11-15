// On foot (E3, #181): the camera at the eyes of a person and its input (keys, mouse, touch). Built by scene.js, which owns
// the camera, so the mission viewer can use it too (#130). The rules (pose, walking, jumping) are pure, in core/.
import { prefersReducedMotion } from './core/motion.js';
import * as THREE from 'three';
import { EYE_HEIGHT_KM, FOOT_FOV_DEG, WORLD_MAX_H_DEG, clampFov, clampPitch, norm360, thirdPersonPose, footPose, turn, dragLook, lockedLook, fovForAspect, waistBend } from './core/foot-camera.js';
import { standAt, step, keysToInput, mergeInputs, isMoving, gaitBob, speedOf } from './core/walk.js';
import { makeSuitBody } from './suit-body.js';
import { dirAzEl } from './core/direction.js';
import { azEl, forwardOf, dirToScene, rigOrigin, roomStep, stickInput, padInput, createSnapTurn, handLandmarks, controllerCurls, watchScore, createEyeHeight, M_TO_KM } from './core/xr-input.js';
import { createWatchGesture } from './core/body-track.js';
import { fingerCurls } from './core/hand-track.js';
import { modalOpen } from './core/camera-input.js';
import { ignoresKey, footCommand } from './core/foot-keys.js';

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ']);
const LOOK_RATE_DEG_S = { yaw: 90, pitch: 60 }; // arrow keys, at the default field of view
const TAP_MAX_PX = 8;
const TAP_MAX_MS = 350;
const STOP_AFTER_MS = 500; // still for this long: "stopped" (the compass is announced)
const NO_INPUT = { forward: 0, right: 0, run: false };
/** How much the head lowers towards the wrist to read the watch. */
const WATCH_LOOK_DOWN_DEG = 22;

// «Reducir movimiento»: no bounce of the eyes with the gait.
const reducedMotion = () => prefersReducedMotion();

/**
 * @param {{scene:THREE.Scene, camera:THREE.PerspectiveCamera, canvas:HTMLCanvasElement, terrainMeshes:THREE.Mesh[],
 *   groundAt:(x:number,z:number)=>number, extentKm:number, render:()=>void}} ctx
 */
export function createFootView({ scene, camera, canvas, terrainMeshes, groundAt, extentKm, render, suitTexture = 4096, suitSmoothing = 3 }) {
  let active = false, person = null, gaze = null, fov = FOOT_FOV_DEG, frame = 0, last = null;
  let joystick = NO_INPUT, jumpAsked = false, goTo = null, onEscape = () => {};
  let lastMoveAt = 0, wasMoving = false;
  // What was drawn last: the mouse, the wheel and the zoom change the gaze between frames, so a frame compares with this.
  let drawn = null;
  let armsPrev = { yaw: 0, forward: 0 }; // last frame, for the inertia of the arms
  // Followed by the camera (gesture-ui.js): your arms, your hands, your head and your eyes, and the gesture of the watch.
  let tracking = null, trackDirty = false, gestureWatch = false;
  // Virtual reality (#396): the rig that carries the headset's space into the scene, and what the frames remember.
  let xr = null;
  // Where you look: your gaze, plus where your head and eyes turn it (the body keeps facing the gaze).
  // In the headset (#396) the headset is the head: the camera's head tracking does not add to it.
  const look = () => (xr ? { ...gaze } : { yaw: norm360(gaze.yaw + (tracking?.head?.yaw ?? 0)), pitch: clampPitch(gaze.pitch + (tracking?.head?.pitch ?? 0)) });
  const snapshot = () => { const l = look(); return { x: person.x, z: person.z, air: person.air, phase: person.phase, yaw: gaze.yaw, lookYaw: l.yaw, pitch: l.pitch, fov, walkTo: person.walkTo }; };
  const held = new Set();
  const changeListeners = [], stopListeners = [], watchListeners = [], flagKeyListeners = [];
  let watchUp = false; // the left arm raised to read the watch (R)
  const limits = { extentKm };

  // Where a walk to a point goes: a small ring on the ground (about 1 m across).
  // Third person (V): the camera behind you. A soft shadow under your boots keeps the astronaut on the ground (the shadow
  // map of the Sun is far too coarse for a person, and the Sun under a degree would stretch it hundreds of metres).
  let thirdPerson = false;
  const viewListeners = [];
  const contact = new THREE.Mesh(new THREE.CircleGeometry(0.0006, 40), new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }));
  contact.rotation.x = -Math.PI / 2;
  contact.visible = false;
  scene.add(contact);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.0003, 0.00045, 40), new THREE.MeshBasicMaterial({ color: 0xf3a83a, side: THREE.DoubleSide, transparent: true, opacity: 0.9, toneMapped: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  scene.add(marker);
  // Your own suit, seen when you look down.
  const suit = makeSuitBody({ maxTexture: suitTexture, smoothing: suitSmoothing, onReady: () => { if (active) apply(); } });
  scene.add(suit.object);

  function apply() {
    if (xr) { render(); changeListeners.forEach(f => f()); return; }
    const bob = reducedMotion() ? 0 : gaitBob(person);
    // Reading the watch you also lower your head towards the wrist, in step with the arm (the arm aims at where you
    // looked before, so the two do not chase each other). Only the head: the waist stays where your gaze put it, as the
    // body does (footPose, headDown).
    const r = suit.watchRaise, headDown = WATCH_LOOK_DOWN_DEG * r * r * (3 - 2 * r);
    const l = look();
    const { position, look: at } = footPose({ ...person, yaw: gaze.yaw, pitch: l.pitch, lookYaw: l.yaw, bob, headDown }, groundAt);
    suit.place({ x: person.x, z: person.z, ground: groundAt(person.x, person.z), yaw: gaze.yaw, lift: person.air + bob, phase: person.phase, speed: speedOf(person), air: person.air, bend: waistBend(l.pitch) });
    camera.up.set(0, 1, 0);
    if (thirdPerson) {
      const tp = thirdPersonPose({ x: person.x, z: person.z, yaw: l.yaw, pitch: l.pitch, air: person.air }, groundAt);
      camera.position.set(tp.position.x, tp.position.y, tp.position.z);
      camera.lookAt(tp.look.x, tp.look.y, tp.look.z);
      contact.position.set(person.x, groundAt(person.x, person.z) + 0.00002, person.z);
      // smaller and fainter as you jump
      contact.scale.setScalar(1 / (1 + person.air / 0.001));
      contact.material.opacity = 1 / (1 + person.air / 0.0005);
    } else {
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(at.x, at.y, at.z);
    }
    contact.visible = thirdPerson;
    // On a wide screen the world opens across up to WORLD_MAX_H_DEG, no more: wider, everything near the edges stretches.
    const vertical = fovForAspect(fov, camera.aspect, WORLD_MAX_H_DEG);
    if (camera.fov !== vertical) { camera.fov = vertical; camera.updateProjectionMatrix(); }
    marker.visible = !!person.walkTo;
    if (person.walkTo) marker.position.set(person.walkTo.x, groundAt(person.walkTo.x, person.walkTo.z) + 0.00005, person.walkTo.z);
    render();
    changeListeners.forEach(f => f());
  }

  function tick(now) {
    if (!active) return;
    const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    // Arrows look; their speed follows the zoom, so a narrow view does not turn too fast.
    const k = fov / FOOT_FOV_DEG;
    const dYaw = ((held.has('arrowright') ? 1 : 0) - (held.has('arrowleft') ? 1 : 0)) * LOOK_RATE_DEG_S.yaw * k * dt;
    const dPitch = ((held.has('arrowup') ? 1 : 0) - (held.has('arrowdown') ? 1 : 0)) * LOOK_RATE_DEG_S.pitch * k * dt;
    if (dYaw || dPitch) gaze = turn(gaze, dYaw, dPitch);
    // the head held turned far to a side keeps turning the body that way, so you can turn round with your head
    if (tracking?.head?.turn && dt > 0) gaze = turn(gaze, tracking.head.turn * dt, 0);
    const input = { ...mergeInputs(keysToInput(held), joystick), jump: jumpAsked, goTo };
    jumpAsked = false; goTo = null;
    if (dt > 0 || input.goTo || input.jump) person = step({ ...person, yaw: gaze.yaw }, input, dt, groundAt, limits);
    const now_ = snapshot();
    const changed = !drawn || Object.keys(now_).some(k => now_[k] !== drawn[k]);
    // The arms, with their inertia: how fast you turn and how you speed up or brake along where you look.
    const ahead = dirAzEl(gaze.yaw, 0), forward = person.vx * ahead.x + person.vz * ahead.z;
    const yawRate = dt > 0 ? (((gaze.yaw - armsPrev.yaw + 540) % 360) - 180) / dt : 0;
    const accel = dt > 0 ? (forward - armsPrev.forward) / dt : 0;
    armsPrev = { yaw: gaze.yaw, forward };
    // Breathing only while you look down at the suit: otherwise the arms settle and the scene stops redrawing.
    const lp = look().pitch;
    const armsMoving = suit.animate(dt, {
      phase: person.phase, speed: speedOf(person), air: person.air, accel, yawRate,
      breathe: !reducedMotion() && lp < -10, reducedMotion: reducedMotion(),
      watchUp, headPitch: lp + waistBend(lp), eye: camera.position,
      tracked: tracking?.arms ?? null, hands: tracking?.hands ?? null,
    }) || trackDirty;
    trackDirty = false;
    if (changed) { apply(); drawn = now_; lastMoveAt = now; wasMoving = true; }
    else {
      if (armsMoving) apply(); // the arms (and, with the watch, the head) still move
      if (wasMoving && now - lastMoveAt > STOP_AFTER_MS) { wasMoving = false; stopListeners.forEach(f => f()); }
    }
    frame = requestAnimationFrame(tick);
  }

  // One frame in the headset (#396), from scene.js's WebXR loop: the walk, the rig, the suit and the watch.
  // data: { head:{position, quaternion} (m, headset space), left/right: {grip, joints, trigger, squeeze, thumb, stick,
  // a} or null }. The window's animation frames stop in the headset, so this replaces tick().
  const BODY_TURN_RATE = 4; // 1/s: the body turns after the head, a moment later
  const xrHeadWorld = new THREE.Vector3(), xrTmp = new THREE.Vector3();
  function xrFrame(dt, data) {
    if (!active || !xr || !data?.head) return;
    const head = data.head.position;
    const eye = xr.eye.update(head.y);
    suit.setEyeHeight(eye * M_TO_KM);
    // a plain gamepad when there are no VR controllers (PS VR with a DualShock 4)
    const pad = padInput(data.pad);
    // the right stick turns the rig round your head in steps
    const turnBy = xr.snap.update(data.right?.stick?.x || pad?.right.x || 0);
    if (turnBy) xr.rigAz = norm360(xr.rigAz + turnBy);
    // walking in the room moves you too
    const room = roomStep(xr.prevHead, head, xr.rigAz);
    xr.prevHead = { ...head };
    if (person) person = { ...person, x: person.x + room.x, z: person.z + room.z };
    // where you look
    const look = azEl(dirToScene(forwardOf(data.head.quaternion), xr.rigAz));
    gaze = { yaw: look.az, pitch: clampPitch(look.el) };
    // the left stick walks along where you look; A jumps (on the press)
    const stick = data.left?.stick && (data.left.stick.x || data.left.stick.y) ? data.left.stick : pad?.left ?? { x: 0, y: 0 };
    const a = !!data.right?.a || !!pad?.jump, jump = a && !xr.aWas;
    xr.aWas = a;
    // △ raises and lowers the watch (on the press), for visors without tracked wrists
    const tri = !!pad?.watch;
    if (tri && !xr.triWas) xr.padWatch = !xr.padWatch;
    xr.triWas = tri;
    const input = { ...mergeInputs(stickInput(stick.x, stick.y), keysToInput(held)), jump: jump || jumpAsked, goTo: null };
    jumpAsked = false;
    if (dt > 0 || input.jump) person = step({ ...person, yaw: gaze.yaw }, input, dt, groundAt, limits);
    // the rig: its origin so your head is over where you are, on the ground under you, turned and scaled
    const o = rigOrigin(person, head, xr.rigAz), ground = groundAt(person.x, person.z);
    xr.rig.position.set(o.x, ground + person.air, o.z);
    xr.rig.rotation.set(0, -xr.rigAz * Math.PI / 180, 0);
    xr.rig.scale.setScalar(M_TO_KM);
    xr.rig.updateMatrixWorld(true);
    xrHeadWorld.set(head.x, head.y, head.z).applyMatrix4(xr.rig.matrixWorld);
    // the body under your head, turning after it
    const diff = ((look.az - xr.bodyYaw + 540) % 360) - 180;
    xr.bodyYaw = norm360(xr.bodyYaw + diff * Math.min(1, dt * BODY_TURN_RATE) + (Math.abs(diff) > 60 ? diff - Math.sign(diff) * 60 : 0));
    suit.place({ x: xrHeadWorld.x, z: xrHeadWorld.z, ground, yaw: xr.bodyYaw, lift: person.air, phase: person.phase, speed: speedOf(person), air: person.air, bend: 0 });
    // arms and fingers
    const world = p => (p ? xrTmp.set(p.x, p.y, p.z).applyMatrix4(xr.rig.matrixWorld).clone() : null);
    const hand = c => {
      if (!c) return null;
      const pts = c.joints ? handLandmarks(n => c.joints[n] ?? null) : null;
      const curl = pts ? fingerCurls(pts) : controllerCurls(c);
      return curl ? { curl, weight: 1 } : null;
    };
    const reach = { left: world(data.left?.grip), right: world(data.right?.grip) };
    const hands = { left: hand(data.left) ?? tracking?.hands?.left ?? null, right: hand(data.right) ?? tracking?.hands?.right ?? null };
    // without VR controllers, the arms follow the camera of the computer if your gestures are on (gesture-ui.js)
    const tracked = !reach.left && !reach.right ? tracking?.arms ?? null : null;
    // the watch: the left wrist held in front of the eyes, a little below
    const score = watchScore({ position: head, forward: forwardOf(data.head.quaternion) }, data.left?.grip ?? null);
    const up = xr.watch.update(score, dt) || xr.padWatch || (!data.left?.grip && !!tracking?.watch);
    if (up !== watchUp) setWatch(up);
    const ahead = dirAzEl(gaze.yaw, 0), forward = person.vx * ahead.x + person.vz * ahead.z;
    const accel = dt > 0 ? (forward - armsPrev.forward) / dt : 0;
    armsPrev = { yaw: gaze.yaw, forward };
    suit.animate(dt, {
      phase: person.phase, speed: speedOf(person), air: person.air, accel, yawRate: 0, breathe: false, reducedMotion: true,
      watchUp, raiseArm: !data.left?.grip && !tracked, headPitch: gaze.pitch, eye: xrHeadWorld, reach, hands, tracked,
    });
    marker.visible = false; contact.visible = false;
    changeListeners.forEach(f => f());
    const moving = speedOf(person) > 0 || person.air > 0 || turnBy !== 0;
    if (moving) { lastMoveAt = performance.now(); wasMoving = true; }
    else if (wasMoving && performance.now() - lastMoveAt > STOP_AFTER_MS) { wasMoving = false; stopListeners.forEach(f => f()); }
  }

  function setThirdPerson(on) {
    if (xr) return; // in the headset you are always in your own body
    if (thirdPerson === on) return;
    thirdPerson = on;
    suit.setThirdPerson(on);
    if (active) apply();
    viewListeners.forEach(f => f(on));
  }

  function setWatch(up) {
    if (watchUp === up) return;
    watchUp = up;
    watchListeners.forEach(f => f(up));
  }

  // Keys
  addEventListener('keydown', ev => {
    if (!active || ignoresKey(ev) || modalOpen(document)) return;
    const command = footCommand(ev);
    if (command === 'watch') { ev.preventDefault(); setWatch(!watchUp); return; }
    if (command === 'flag') { ev.preventDefault(); flagKeyListeners.forEach(f => f()); return; } // pick up or plant the flag (E3.6)
    if (command === 'view') { ev.preventDefault(); setThirdPerson(!thirdPerson); return; }
    if (ev.key === 'Escape') {
      // in a headset Esc only takes you out of it (xr-ui.js), not up to the drone
      if (xr || document.pointerLockElement === canvas) return;
      ev.preventDefault();
      onEscape();
      return;
    }
    const key = ev.key === 'Shift' ? 'shift' : ev.key.toLowerCase();
    if (!MOVE_KEYS.has(key)) return;
    ev.preventDefault(); // arrows and Space do not scroll the page
    if (key === ' ') { if (!ev.repeat) jumpAsked = true; return; }
    held.add(key);
  });
  addEventListener('keyup', ev => {
    held.delete(ev.key === 'Shift' ? 'shift' : ev.key.toLowerCase());
    if (!ev.shiftKey) held.delete('shift');
  });
  addEventListener('blur', () => held.clear());

  // Mouse and touch on the scene: drag to look, a short tap or click on the ground to go there, a pinch to zoom.
  const pointers = new Map();
  let drag = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function groundUnder(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(terrainMeshes, false)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }
  const pinchDistance = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('pointerdown', ev => {
    if (!active) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* not every pointer can be captured */ }
    if (pointers.size === 2) drag = { pinch: pinchDistance(), fov0: fov };
    else if (pointers.size === 1) drag = { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, t0: performance.now() };
  });
  canvas.addEventListener('pointermove', ev => {
    if (!active || !pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!drag || document.pointerLockElement === canvas) return;
    if (drag.pinch !== undefined) {
      if (pointers.size === 2 && drag.pinch > 0) fov = clampFov(drag.fov0 * drag.pinch / Math.max(1, pinchDistance()));
      return;
    }
    gaze = dragLook(gaze, ev.clientX - drag.x, ev.clientY - drag.y, fov, canvas.clientHeight || innerHeight);
    drag.x = ev.clientX; drag.y = ev.clientY;
  });
  const endPointer = ev => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    const d = drag;
    if (pointers.size === 0) drag = null;
    if (!active || ev.type !== 'pointerup' || !d || d.pinch !== undefined) return;
    const tap = Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < TAP_MAX_PX && performance.now() - d.t0 < TAP_MAX_MS;
    if (!tap) return;
    // With the mouse captured, the click goes where the centre of the screen points.
    const locked = document.pointerLockElement === canvas, r = canvas.getBoundingClientRect();
    const at = locked ? groundUnder(r.left + r.width / 2, r.top + r.height / 2) : groundUnder(ev.clientX, ev.clientY);
    if (at) goTo = at;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  // Double click: capture the mouse to look without dragging (Esc lets it go). If the browser refuses, dragging still works.
  canvas.addEventListener('dblclick', ev => {
    if (!active || ev.pointerType === 'touch') return;
    goTo = null;
    if (person) person = { ...person, walkTo: null };
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* refused: keep dragging */ }
  });
  document.addEventListener('mousemove', ev => {
    if (!active || document.pointerLockElement !== canvas) return;
    gaze = lockedLook(gaze, ev.movementX, ev.movementY, fov, canvas.clientHeight || innerHeight);
  });
  canvas.addEventListener('wheel', ev => {
    if (!active) return;
    ev.preventDefault();
    fov = clampFov(fov * Math.exp(ev.deltaY * 0.001));
  }, { passive: false });

  return {
    get active() { return active; },
    /** Goes down at `at` ({x, z, yaw, pitch}); `onExit`: what Esc does (go back up to the drone). */
    enter(at, { onExit = () => {} } = {}) {
      active = true;
      person = standAt(at.x, at.z, at.yaw);
      gaze = { yaw: at.yaw, pitch: at.pitch };
      fov = FOOT_FOV_DEG;
      onEscape = onExit;
      held.clear(); joystick = NO_INPUT; jumpAsked = false; goTo = null; last = null;
      suit.object.visible = true;
      suit.resetArms();
      armsPrev = { yaw: at.yaw, forward: 0 };
      suit.load();
      apply();
      drawn = snapshot();
      frame = requestAnimationFrame(tick);
    },
    exit() {
      setWatch(false);
      tracking = null; gestureWatch = false;
      contact.visible = false;
      active = false;
      cancelAnimationFrame(frame);
      held.clear(); pointers.clear(); drag = null; joystick = NO_INPUT;
      marker.visible = false;
      suit.object.visible = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    },
    /** Turns the gaze to a direction (the guided visit): azimuth `yaw` and elevation `pitch`, in degrees. */
    lookAt(yaw, pitch) {
      if (!active) return;
      gaze = { yaw: norm360(yaw), pitch: clampPitch(pitch) };
      apply();
    },
    /** + and − (and their buttons): the field of view, as a zoom. */
    zoom(factor) { fov = clampFov(fov * factor); },
    /** Input of the touch joystick ({forward, right, run}, core/walk.js joystickInput). */
    setJoystick(input) { joystick = input ?? NO_INPUT; },
    jump() { jumpAsked = true; },
    /** Where you are and where you look: {x, z, yaw, pitch, fov, moving}. */
    state: () => (active ? { x: person.x, z: person.z, yaw: look().yaw, pitch: look().pitch, fov, moving: isMoving(mergeInputs(keysToInput(held), joystick)) || !!person.walkTo || person.air > 0 || speedOf(person) > 0 } : null),
    onChange: f => changeListeners.push(f),
    /** Called once when you stop moving or looking (for the screen reader). */
    onStop: f => stopListeners.push(f),
    /** The watch on the left wrist: raise the arm to read it (R), or lower it. */
    setWatch,
    get watchUp() { return watchUp; },
    onWatch: f => watchListeners.push(f),
    /** The flag on your right arm (E3.6): carry it or let it go; `onFlagKey`: key F. */
    carryFlag: (mesh, on, scale) => { suit.carryFlag(mesh, on, scale); if (active) apply(); },
    onFlagKey: f => flagKeyListeners.push(f),
    /** Its screen: draw on `canvas`, then `changed()`. */
    watchFace: suit.watchFace,
    /**
     * What the camera follows (gesture-ui.js), or null to stop: {arms, hands, head:{yaw, pitch, turn}, watch}. arms and
     * hands as core/body-track.js and core/hand-track.js give them; head: the view offset of core/head-track.js; watch:
     * the gesture of looking at the watch, which raises and lowers it as R does (R still works in between).
     */
    /**
     * Virtual reality (#396). xrStart: the headset takes the view; `rig` is the group that carries its space (the camera
     * is its child). xrFrame: one frame of the headset. xrEnd: back to the view on foot as it was.
     */
    xrStart(rig) {
      if (!active) return;
      const before = { thirdPerson, pitch: gaze.pitch }; // what xrEnd gives back
      setThirdPerson(false);
      cancelAnimationFrame(frame);
      xr = { before, rig, rigAz: gaze.yaw, prevHead: null, aWas: false, triWas: false, padWatch: false, bodyYaw: gaze.yaw, eye: createEyeHeight(), snap: createSnapTurn(), watch: createWatchGesture({ onAfter: 0.25, offAfter: 0.5 }) };
      suit.setXRLayers(true);
    },
    xrFrame,
    xrEnd() {
      if (!xr) return;
      const { before } = xr;
      xr = null;
      suit.setXRLayers(false);
      suit.setEyeHeight(EYE_HEIGHT_KM);
      if (watchUp) setWatch(false);
      if (!active) return;
      gaze = { yaw: gaze.yaw, pitch: before?.pitch ?? 0 };
      if (before?.thirdPerson) setThirdPerson(true);
      last = null;
      apply();
      frame = requestAnimationFrame(tick);
    },
    get inXR() { return !!xr; },
    /** Your own suit: scene.js shows and hides it per pass in the headset. */
    get bodyObject() { return suit.object; },
    /** Third person (V): the camera behind the astronaut; or back to its eyes. */
    setThirdPerson,
    get thirdPerson() { return thirdPerson; },
    onView: f => viewListeners.push(f),
    /** The skeleton the camera moves, drawn over the suit. */
    showSkeleton: on => { suit.showSkeleton(on); if (active) apply(); },
    setTracking(t) {
      tracking = t;
      trackDirty = true;
      const w = !!t?.watch;
      if (w !== gestureWatch) { gestureWatch = w; setWatch(w); }
    },
  };
}

/** A soft round shadow, dark in the middle and gone at the edge. */
function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.6, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
