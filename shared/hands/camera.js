// Camera of the hand control (pointer.js): the camera of the device, the hand tracking (MediaPipe Hand Landmarker, from
// Google) and the preview, where the room behind the user is replaced by space (MediaPipe Image Segmenter). Everything
// runs in the browser: the video is never sent anywhere. The gesture rules are in gesture.js.
import { createHandsTracker } from './gesture.js';

// Loaded only when the user turns the hand control on (a few MB between the library and the models).
const LIB = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODELS = 'https://storage.googleapis.com/mediapipe-models';
const HAND_MODEL = `${MODELS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;
const PERSON_MODEL = `${MODELS}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`;

// One of each per page: they are kept between uses. A failed load (no connection) can be tried again.
let vision = null, landmarker = null, segmenter = null;
function loadVision() {
  vision ??= (async () => {
    const lib = await import(`${LIB}/vision_bundle.mjs`);
    return { lib, files: await lib.FilesetResolver.forVisionTasks(`${LIB}/wasm`) };
  })();
  vision.catch(() => { vision = null; });
  return vision;
}
const onGpuOrCpu = async create => { try { return await create('GPU'); } catch { return await create('CPU'); } };
function loadLandmarker() {
  landmarker ??= loadVision().then(({ lib, files }) => onGpuOrCpu(delegate =>
    lib.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2 })));
  landmarker.catch(() => { landmarker = null; });
  return landmarker;
}
function loadSegmenter() {
  segmenter ??= loadVision().then(({ lib, files }) => onGpuOrCpu(delegate =>
    lib.ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: PERSON_MODEL, delegate }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true })));
  segmenter.catch(() => { segmenter = null; });
  return segmenter;
}

/** Error with a `code` the screen turns into a text: 'unsupported', 'denied', 'no-camera', 'camera', 'load' or 'aborted'. */
function fail(code, cause) {
  return Object.assign(new Error(`hand control: ${code}`, { cause }), { code });
}

function cameraCode(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'denied';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'no-camera';
  return 'camera';
}

/** Space, drawn: a dark sky with two faint clouds of colour and stars, always the same ones. */
function drawSpace(canvas) {
  const { width: w, height: h } = canvas, ctx = canvas.getContext('2d');
  let seed = 540;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  ctx.fillStyle = '#03050b';
  ctx.fillRect(0, 0, w, h);
  for (const [x, y, r, colour] of [[0.22, 0.3, 0.6, 'rgba(110,80,200,.38)'], [0.8, 0.72, 0.55, 'rgba(40,120,170,.3)'], [0.6, 0.15, 0.35, 'rgba(190,90,140,.16)']]) {
    const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * w);
    g.addColorStop(0, colour); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < 150; i++) {
    const big = random() > 0.93;
    ctx.fillStyle = `rgba(${225 + random() * 30 | 0},${225 + random() * 30 | 0},255,${0.35 + random() * 0.65})`;
    ctx.beginPath();
    ctx.arc(random() * w, random() * h, big ? 1.3 : 0.4 + random() * 0.5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/**
 * Painter of the preview on `canvas`: the user, cut out of the camera image, over space. `paint(video, mask)` takes the
 * confidence (0..1) that each pixel is a person, as a Float32Array of `mask.width` × `mask.height`; without a mask, the
 * camera image as it is.
 */
function createPreview(canvas) {
  const W = 384, H = 288;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const space = Object.assign(document.createElement('canvas'), { width: W, height: H });
  drawSpace(space);
  const person = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const pctx = person.getContext('2d', { willReadFrequently: true });
  // The preview is 4:3 and covers: the middle of the camera image, as object-fit: cover does.
  const crop = video => {
    const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(vw / W, vh / H);
    return [(vw - W * s) / 2, (vh - H * s) / 2, W * s, H * s];
  };
  ctx.drawImage(space, 0, 0);
  return {
    paint(video, mask) {
      const [sx, sy, sw, sh] = crop(video);
      if (!mask) { ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H); return; }
      pctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
      const image = pctx.getImageData(0, 0, W, H), px = image.data;
      const { data, width: mw, height: mh } = mask, vw = video.videoWidth, vh = video.videoHeight;
      for (let y = 0; y < H; y++) {
        const my = Math.min(mh - 1, ((sy + (y + 0.5) / H * sh) / vh * mh) | 0) * mw;
        for (let x = 0; x < W; x++) {
          const c = data[my + Math.min(mw - 1, ((sx + (x + 0.5) / W * sw) / vw * mw) | 0)];
          // Soft edge between 0.35 and 0.65 of confidence
          px[(y * W + x) * 4 + 3] = c <= 0.35 ? 0 : c >= 0.65 ? 255 : (c - 0.35) / 0.3 * 255;
        }
      }
      pctx.putImageData(image, 0, 0);
      ctx.drawImage(space, 0, 0);
      ctx.drawImage(person, 0, 0);
    },
  };
}

/**
 * Opens the camera and follows up to two hands until `stop()` or until `signal` aborts.
 * @param {object} o
 * @param {HTMLVideoElement} o.video plays the camera (it need not be visible)
 * @param {HTMLCanvasElement} [o.canvas] where the preview is drawn, with space behind the user
 * @param {AbortSignal} [o.signal] aborting it closes the camera, also while it is still starting
 * @param {(dx:number, dy:number) => void} o.onMove movement of the hand while it grabs (see gesture.js)
 * @param {(scale:number) => void} o.onZoom zoom factor of the two hands apart or together
 * @param {() => void} o.onClick the thumb folded while pointing
 * @param {() => void} [o.onSalute] a hand saluted, as the astronaut of the Mirador does
 * @param {(hands:object[][], aspect:number) => void} [o.onLandmarks] the raw hands of every camera frame (for a diagnosis)
 * @param {(state:object) => void} o.onState what createHandsTracker returns for every camera frame, called before
 *   onMove, onZoom, onClick and onSalute
 * @returns {Promise<{stop: () => void}>}
 */
export async function startHandControl({ video, canvas, signal, onMove, onZoom, onClick, onSalute = () => {}, onLandmarks = null, onState }) {
  if (!navigator.mediaDevices?.getUserMedia) throw fail('unsupported');
  let stream = null, raf = 0, stopped = false;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  };
  signal?.addEventListener('abort', stop, { once: true });
  const model = loadLandmarker();
  model.catch(() => {}); // awaited below; this keeps a camera error from leaving it unhandled
  // The background is an extra: without it (it failed or it has not loaded yet) the preview is the camera image.
  let person = null;
  if (canvas) loadSegmenter().then(s => { person = s; }, err => console.warn('Control con las manos: sin fondo espacial.', err));
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (err) { throw fail(cameraCode(err), err); }
    if (signal?.aborted) throw fail('aborted');
    video.srcObject = stream;
    await video.play().catch(() => {}); // interrupted only if it is stopped meanwhile
    let hands;
    try { hands = await model; } catch (err) { throw fail('load', err); }
    if (signal?.aborted) throw fail('aborted');

    const tracker = createHandsTracker();
    const preview = canvas ? createPreview(canvas) : null;
    let lastTime = -1;
    const tick = () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      if (video.readyState < 2 || video.currentTime === lastTime) return; // no new camera frame
      lastTime = video.currentTime;
      const now = performance.now();
      const found = hands.detectForVideo(video, now);
      const aspect = video.videoWidth / video.videoHeight || 1;
      onLandmarks?.(found.landmarks ?? [], aspect);
      const state = tracker.update(found.landmarks, aspect);
      onState(state);
      if (state.dx || state.dy) onMove(state.dx, state.dy);
      if (state.scale !== 1) onZoom(state.scale);
      if (state.click) onClick();
      if (state.salute) onSalute();
      if (!preview) return;
      if (!person) { preview.paint(video, null); return; }
      // The result is only valid inside the callback: the masks are freed when it returns.
      person.segmentForVideo(video, now, result => {
        const m = result.confidenceMasks?.at(-1);
        preview.paint(video, m ? { data: m.getAsFloat32Array(), width: m.width, height: m.height } : null);
      });
    };
    raf = requestAnimationFrame(tick);
    return { stop };
  } catch (err) {
    stop();
    throw err;
  }
}
