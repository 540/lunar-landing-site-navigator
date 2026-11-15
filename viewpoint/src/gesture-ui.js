// Your gestures through the camera, on foot (E3, #181): the astronaut moves its arms, its fingers and its head with
// yours, and raising your left forearm in front of your chest as if to read a watch raises its watch. MediaPipe (Google,
// Apache 2.0) finds the points of your body, your hands and your face in the image, in your browser: the image never
// leaves your device. The rules that turn the points into movement are pure, in core/ (body-track, hand-track,
// head-track); this file runs the camera and the detectors, draws the points over a small mirror and feeds the scene.
import { UI } from './texts.js';
import { createBodyTracker, createWatchGesture, ARM_LINKS } from './core/body-track.js';
import { createHandTracker, whichHand, HAND_LINKS } from './core/hand-track.js';
import { createHeadTracker, headAngles, eyeGaze, EYE_RINGS } from './core/head-track.js';

const T = UI.gestures; // loaded with the scene, once useLang() has chosen the language
// MediaPipe Tasks for the web: the module and its WebAssembly from jsDelivr, the models from Google's storage. Loaded only
// when you turn the camera on.
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODELS = {
  pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};
/** If the three detectors together take longer than this per frame (ms), they take turns, one a frame. */
const SLOW_MS = 45;
const COLOURS = { arm: '#f3a83a', hand: '#eceef0', eye: '#5aa2f2', iris: '#9fd0ff' };

let detectors = null; // once loaded, kept for the next time the camera is turned on

async function loadDetectors() {
  const vision = await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
  const make = async (Task, model, extra) => {
    // the GPU when there is one; otherwise the CPU, slower but it works
    for (const delegate of ['GPU', 'CPU']) {
      try { return await Task.createFromOptions(files, { baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', ...extra }); } catch (err) { if (delegate === 'CPU') throw err; }
    }
    return null;
  };
  const [pose, hand, face] = await Promise.all([
    make(vision.PoseLandmarker, MODELS.pose, { numPoses: 1 }),
    make(vision.HandLandmarker, MODELS.hand, { numHands: 2 }),
    make(vision.FaceLandmarker, MODELS.face, { numFaces: 1, outputFaceBlendshapes: true }),
  ]);
  return { pose, hand, face };
}

/**
 * @param {object} view the scene (createScene with explore: true), with view.foot
 */
export function setupGestures(view) {
  const $ = id => document.getElementById(id);
  const foot = view.foot, button = $('gesture-btn'), panel = $('gesture-panel'), canvas = $('gesture-canvas'), status = $('gesture-status');
  const recal = $('gesture-recal'), ctx = canvas.getContext('2d');
  $('gesture-privacy').textContent = T.privacy;
  $('gesture-title').textContent = T.title;
  recal.textContent = T.recalibrate;
  // The astronaut's skeleton over the suit, from the shoulders, as the points over your image: you see what moves what.
  const skeletonBox = $('gesture-skeleton');
  $('gesture-skeleton-label').textContent = T.skeleton;
  skeletonBox.addEventListener('change', () => foot.showSkeleton(running && skeletonBox.checked));
  const paintButton = on => {
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? T.off : T.on);
    button.title = on ? T.off : T.on;
  };
  paintButton(false);

  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  let stream = null, running = false, frame = 0, last = 0, turn = 0, slow = false;
  let body = createBodyTracker(), hands = createHandTracker(), head = createHeadTracker(), watch = createWatchGesture();
  let results = { pose: null, hand: null, face: null };

  const say = text => { status.textContent = text; };

  async function start() {
    panel.hidden = false;
    paintButton(true);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { say(T.insecure); return; }
    say(T.asking);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (err) {
      console.warn('Cámara', err);
      say(T.noCamera);
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    say(T.loading);
    try {
      detectors ??= await loadDetectors();
    } catch (err) {
      console.error('No se ha podido cargar el seguimiento', err);
      say(T.error);
      stopStream();
      return;
    }
    if (!stream) return; // turned off while loading
    body = createBodyTracker(); hands = createHandTracker(); head = createHeadTracker(); watch = createWatchGesture();
    running = true; last = 0;
    foot.showSkeleton(skeletonBox.checked);
    frame = requestAnimationFrame(tick);
  }

  function stopStream() {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame); clearTimeout(frame);
    stopStream();
    foot.setTracking(null);
    foot.showSkeleton(false);
    panel.hidden = true;
    paintButton(false);
  }

  function detect(now) {
    const t0 = performance.now();
    const run = (name, d) => { try { results[name] = d.detectForVideo(video, now); } catch (err) { console.warn(name, err); } };
    // all three each frame; if that is too slow for this device, one each frame in turn
    if (!slow) { run('pose', detectors.pose); run('hand', detectors.hand); run('face', detectors.face); }
    else { const k = turn++ % 3; run(['pose', 'hand', 'face'][k], detectors[['pose', 'hand', 'face'][k]]); }
    slow = performance.now() - t0 > SLOW_MS;
  }

  // The window's animation frames may stop while a headset shows the scene (#396): there, a timer at 30 Hz.
  const schedule = () => { frame = foot.inXR ? setTimeout(() => tick(performance.now()), 33) : requestAnimationFrame(tick); };
  function tick(now) {
    if (!running) return;
    schedule();
    if (video.readyState < 2) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
    last = now;
    detect(now);
    const aspect = (video.videoWidth || 4) / (video.videoHeight || 3);
    const facePoints = results.face?.faceLandmarks?.[0] ?? null;
    const headNow = head.update(headAngles(facePoints, aspect), eyeGaze(results.face?.faceBlendshapes?.[0]?.categories ?? null, facePoints), dt);
    const poseWorld = results.pose?.worldLandmarks?.[0] ?? null;
    const b = body.update(poseWorld, dt, headNow.head);
    const imageHands = results.hand?.landmarks ?? [];
    const sides = whichHand(imageHands, results.pose?.landmarks?.[0] ?? null, (results.hand?.handednesses ?? results.hand?.handedness ?? []).map(h => h?.[0]?.categoryName));
    const h = hands.update(sides.map((side, k) => ({ side, world: results.hand?.worldLandmarks?.[k] })), dt);
    const watchUp = watch.update(b.watch, dt);
    foot.setTracking({ arms: b.arms, hands: h, head: headNow.calibrating ? null : headNow, watch: watchUp });
    draw(facePoints, imageHands);
    say(statusText({ calibrating: headNow.calibrating && !!facePoints, body: !!b.arms, hands: !!(h.left || h.right), face: !!facePoints, watch: watchUp }));
  }

  // The mirror: your image as in a mirror (flipped), darkened, with the points that are followed over it.
  function draw(face, imageHands) {
    const w = canvas.width, h = canvas.height;
    ctx.save();
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.fillStyle = 'rgba(7,9,11,.45)';
    ctx.fillRect(0, 0, w, h);
    const px = p => [p.x * w, p.y * h];
    const links = (pts, list, colour, width) => {
      ctx.strokeStyle = colour; ctx.lineWidth = width;
      ctx.beginPath();
      for (const [a, b] of list) { if (!pts[a] || !pts[b]) continue; ctx.moveTo(...px(pts[a])); ctx.lineTo(...px(pts[b])); }
      ctx.stroke();
    };
    const dots = (pts, list, colour, r) => { ctx.fillStyle = colour; for (const i of list) { if (!pts[i]) continue; ctx.beginPath(); ctx.arc(...px(pts[i]), r, 0, 2 * Math.PI); ctx.fill(); } };
    const pose = results.pose?.landmarks?.[0];
    if (pose) { links(pose, ARM_LINKS, COLOURS.arm, 3); dots(pose, [11, 12, 13, 14, 15, 16], COLOURS.arm, 4); }
    for (const hand of imageHands) { links(hand, HAND_LINKS, COLOURS.hand, 1.5); dots(hand, hand.map((_, i) => i), COLOURS.hand, 2); }
    if (face) {
      for (const ring of [EYE_RINGS.left, EYE_RINGS.right]) { links(face, ring.map((p, k) => [p, ring[(k + 1) % ring.length]]), COLOURS.eye, 1.5); }
      dots(face, [...EYE_RINGS.leftIris, ...EYE_RINGS.rightIris], COLOURS.iris, 1.6);
      dots(face, [1], COLOURS.eye, 3); // the tip of the nose: where the head points
    }
    ctx.restore();
  }

  function statusText(s) {
    if (s.calibrating) return T.calibrating;
    if (!s.body && !s.face && !s.hands) return T.lost;
    const parts = [s.body && T.parts.arms, s.hands && T.parts.hands, s.face && T.parts.head].filter(Boolean);
    return `${T.following(parts.join(' · '))}${s.watch ? ` · ${T.watching}` : ''}`;
  }

  button.addEventListener('click', ev => {
    if (button.getAttribute('aria-pressed') === 'true') stop(); else start();
    if (ev.detail > 0) button.blur(); // with the mouse the keys go back to the scene
  });
  recal.addEventListener('click', () => head.recalibrate());
  foot.onModeChange(mode => {
    button.hidden = mode !== 'foot';
    if (mode !== 'foot' && button.getAttribute('aria-pressed') === 'true') stop();
  });
}
