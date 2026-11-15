// Hand gesture rules of the hand control (pointer.js):
// - pointing at the screen with the index (the other fingers folded) shows the pointer, at the tip of the index;
// - while pointing, folding the thumb against the hand is a click on what is pointed at;
// - a pinch (the tips of the thumb and the index together) grabs the scene, and moving the hand drags it;
// - a pinch in each hand zooms: moving them apart is closer, and together, further;
// - a salute, as the astronaut of the Mirador does (the hand flat by the head, the fingers to the side), held for a moment.
// Pure: no DOM, no camera, no MediaPipe, so they can be tested. Landmarks are the 21 points of a MediaPipe hand, with x and y
// in 0..1 of the camera image (x grows to the right of the image, y down).

const WRIST = 0, THUMB_TIP = 4, INDEX_BASE = 5, INDEX_KNUCKLE = 6, INDEX_TIP = 8, MIDDLE_BASE = 9, MIDDLE_TIP = 12, LITTLE_TIP = 20;
/** Wrist and the base of the four fingers: their centre barely moves when the fingers close, unlike the fingertips. */
const PALM = [0, 5, 9, 13, 17];
/** Base and tip of the index, middle, ring and little fingers. */
const FINGERS = [[5, 8], [9, 12], [13, 16], [17, 20]];

const dist = (a, b, aspect) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
/** Size of the hand in the image: from the wrist to the base of the middle finger. The other measures are given in it, so they do not depend on how far the hand is from the camera. */
const handSize = (landmarks, aspect) => dist(landmarks[WRIST], landmarks[MIDDLE_BASE], aspect);

/** Distance between the tips of the thumb and the index, in hand sizes. Around 0.1 to 0.2 with the fingers together and over 0.6 with the hand open. */
export function pinchRatio(landmarks, aspect = 1) {
  const size = handSize(landmarks, aspect);
  return size > 0 ? dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP], aspect) / size : Infinity;
}

/** Centre of the palm, in image coordinates. */
export function palmCentre(landmarks) {
  let x = 0, y = 0;
  for (const i of PALM) { x += landmarks[i].x; y += landmarks[i].y; }
  return { x: x / PALM.length, y: y / PALM.length };
}

/**
 * How stretched each of the four fingers is (index to little finger): the distance from the wrist to the tip over the one
 * from the wrist to the base of the finger. Around 2 with the finger straight and around 1 or less folded over the palm.
 */
export function fingerReach(landmarks, aspect = 1) {
  const wrist = landmarks[WRIST];
  return FINGERS.map(([base, tip]) => {
    const d = dist(wrist, landmarks[base], aspect);
    return d > 0 ? dist(wrist, landmarks[tip], aspect) / d : Infinity;
  });
}

/** How far the tip of the thumb is from the side of the index (its base or its first knuckle), in hand sizes: under 0.4 with the thumb folded against the hand, around 0.8 or more with it out. */
export function thumbGap(landmarks, aspect = 1) {
  const size = handSize(landmarks, aspect), tip = landmarks[THUMB_TIP];
  return size > 0 ? Math.min(dist(tip, landmarks[INDEX_BASE], aspect), dist(tip, landmarks[INDEX_KNUCKLE], aspect)) / size : Infinity;
}

/**
 * The measures of a salute (isSalute), also shown by the diagnosis of the hand control (`?manos=diagnostico`):
 * - `reach`: how stretched each finger is (fingerReach, index to little finger);
 * - `spread`: from the tip of the index to that of the little finger, in hand sizes (fingers together, under 1);
 * - `tilt`: degrees of the hand from the vertical, from the wrist to the tip of the middle finger (0 fingers up, 90 to
 *   the side, 180 down);
 * - `height`: the palm, from the top of the image (0) to the bottom (1).
 */
export function saluteMeasures(landmarks, aspect = 1) {
  const size = handSize(landmarks, aspect);
  const dx = Math.abs(landmarks[MIDDLE_TIP].x - landmarks[WRIST].x) * aspect, dy = landmarks[MIDDLE_TIP].y - landmarks[WRIST].y;
  return {
    reach: fingerReach(landmarks, aspect),
    spread: size > 0 ? dist(landmarks[INDEX_TIP], landmarks[LITTLE_TIP], aspect) / size : Infinity,
    tilt: Math.atan2(dx, -dy) * 180 / Math.PI,
    height: palmCentre(landmarks).y,
  };
}

/**
 * A salute: the hand flat, by the head and on its side. Three of the four fingers stretched (reach over `straightAt`:
 * seen edge-on by the camera, a straight finger looks shorter than it is) and none folded (under `foldedAt`), the
 * fingers together (spread under `togetherAt`), the hand at least `tiltAt` degrees from the vertical and not pointing
 * down (up to `tiltUpTo`), and high in the picture (the palm above `highAt` of its height). An open hand shown to the
 * camera, fingers up, is not one.
 */
export const SALUTE = { straightAt: 1.3, foldedAt: 1.1, togetherAt: 1.0, tiltAt: 25, tiltUpTo: 120, highAt: 0.6 };
export function isSalute(landmarks, aspect = 1, { straightAt, foldedAt, togetherAt, tiltAt, tiltUpTo, highAt } = SALUTE) {
  const m = saluteMeasures(landmarks, aspect);
  return m.height <= highAt
    && m.reach.filter(r => r > straightAt).length >= 3 && m.reach.every(r => r > foldedAt)
    && m.spread <= togetherAt
    && m.tilt >= tiltAt && m.tilt <= tiltUpTo;
}

const NO_HAND = { present: false, grabbing: false, pointing: false, pressed: false, x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 0, click: false, salute: false };

/**
 * Follows one hand frame by frame. `update(landmarks, aspect)` takes the hand of the frame (null if there is none) and the
 * width/height of the image, and returns:
 * - `present`: there is a hand in the frame;
 * - `grabbing`: the hand is pinching. It starts under `grabAt` and ends over `releaseAt`, so it does not flicker in between;
 * - `pointing`: the index is stretched (reach over `straightAt`) and at least two of the other three fingers are folded
 *   (under `foldedAt`), and the hand is neither pinching nor saluting. Once pointing, it holds with looser limits (`holdStraightAt`, `holdFoldedAt`);
 * - `x`, `y`: the palm, smoothed, in 0..1 and mirrored (as the user sees themselves in a mirror);
 * - `px`, `py`: the tip of the index, the same way: where the hand points;
 * - `dx`, `dy`: how far the palm moved since the last frame while grabbing, in image heights and mirrored (to the user's
 *   right is positive). Zero in the frame the grab starts and in the first frame after the hand was lost, so nothing jumps;
 * - `pressed`: while pointing, the thumb is folded against the hand (gap under `pressAt`, until it is over `liftAt`);
 * - `click`: true in the frame the thumb folds, if it was seen out while pointing since the last click. A hand that
 *   starts pointing with the thumb already folded does not click.
 * - `salute`: true in the frame the hand has held a salute (isSalute) for `saluteFrames` frames, forgiving up to
 *   `saluteMisses` frames in a row without it (by the face the tracking flickers). Once: the next one needs the hand to
 *   leave the salute first.
 */
export function createHandTracker({ grabAt = 0.3, releaseAt = 0.45, straightAt = 1.5, foldedAt = 1.35, holdStraightAt = 1.35, holdFoldedAt = 1.55, pressAt = 0.42, liftAt = 0.6, smoothing = 0.5, saluteFrames = 5, saluteMisses = 4 } = {}) {
  let pos = null, tip = null, grabbing = false, pointing = false, pressed = false, armed = false, saluting = 0, misses = 0;
  const reset = () => { pos = null; tip = null; grabbing = false; pointing = false; pressed = false; armed = false; saluting = 0; misses = 0; };
  const smooth = (prev, raw) => prev ? { x: prev.x + (raw.x - prev.x) * smoothing, y: prev.y + (raw.y - prev.y) * smoothing } : raw;
  return {
    update(landmarks, aspect = 1) {
      if (!landmarks) { reset(); return { ...NO_HAND }; }
      const wasGrabbing = grabbing;
      const ratio = pinchRatio(landmarks, aspect);
      grabbing = grabbing ? ratio < releaseAt : ratio < grabAt;

      const reach = fingerReach(landmarks, aspect), [index, ...others] = reach;
      const straight = pointing ? holdStraightAt : straightAt, folded = pointing ? holdFoldedAt : foldedAt;
      // The salute wins over pointing: seen edge-on, the index of a flat hand looks longer than the other fingers, and
      // they can look folded enough to point (all the more with the looser limits to hold it).
      const salutePose = !grabbing && isSalute(landmarks, aspect);
      pointing = !grabbing && !salutePose && index > straight && others.filter(r => r < folded).length >= 2;

      let click = false;
      if (!pointing) { pressed = false; armed = false; }
      else {
        const gap = thumbGap(landmarks, aspect), wasPressed = pressed;
        pressed = pressed ? gap < liftAt : gap < pressAt;
        click = pressed && !wasPressed && armed;
        if (!pressed) armed = true; else if (click) armed = false;
      }

      if (salutePose) { saluting++; misses = 0; }
      else if (++misses > saluteMisses) saluting = 0;
      const salute = saluting === saluteFrames && misses === 0;

      const palm = palmCentre(landmarks), prev = pos;
      pos = smooth(prev, { x: 1 - palm.x, y: palm.y });
      tip = smooth(tip, { x: 1 - landmarks[INDEX_TIP].x, y: landmarks[INDEX_TIP].y });
      const moving = grabbing && wasGrabbing && prev;
      return {
        present: true, grabbing, pointing, pressed, x: pos.x, y: pos.y, px: tip.x, py: tip.y,
        dx: moving ? (pos.x - prev.x) * aspect : 0, dy: moving ? pos.y - prev.y : 0, click, salute,
      };
    },
    reset,
  };
}

/** Under this distance between the two hands (in image heights) the zoom is not measured: the ratio would be too noisy. */
const MIN_SPAN = 0.08;

/**
 * Follows up to two hands. `update(hands, aspect)` takes the hands of the frame (an array of landmark lists, empty or null
 * if there are none) and returns:
 * - `present`, `grabbing` (some hand is pinching) and `zooming` (both are);
 * - `hands`: `{x, y, grabbing}` of each one, as in createHandTracker, from the user's left to right;
 * - `pointer`: `{x, y}` where the hand points (the tip of its index) when there is only one and it is pointing; null otherwise;
 * - `pressed` and `click`: those of the only hand in the frame;
 * - `dx`, `dy`: movement of the only hand that is pinching. Zero while both pinch;
 * - `scale`: while both pinch, the distance between the hands over that of the last frame (over 1 when they move apart).
 *   1 otherwise, and in the frame the second pinch starts;
 * - `salute`: some hand has just saluted (as in createHandTracker).
 * When a hand appears or disappears everything starts again, so that frame never moves, zooms or clicks.
 */
export function createHandsTracker(options) {
  const slots = [createHandTracker(options), createHandTracker(options)];
  let count = 0, span = null;
  return {
    update(hands, aspect = 1) {
      // MediaPipe does not keep the order of the hands between frames: they are told apart by their side (mirrored).
      const list = (hands ?? []).slice(0, 2).sort((a, b) => palmCentre(b).x - palmCentre(a).x);
      if (list.length !== count) { slots.forEach(s => s.reset()); count = list.length; span = null; }
      const states = list.map((landmarks, i) => slots[i].update(landmarks, aspect));
      const grabbing = states.filter(s => s.grabbing);
      let dx = 0, dy = 0, scale = 1;
      if (grabbing.length === 2) {
        const d = Math.hypot((states[1].x - states[0].x) * aspect, states[1].y - states[0].y);
        if (span && d > MIN_SPAN) scale = d / span;
        span = d > MIN_SPAN ? d : null;
      } else {
        span = null;
        if (grabbing.length === 1) ({ dx, dy } = grabbing[0]);
      }
      const only = count === 1 ? states[0] : null;
      return {
        present: count > 0, grabbing: grabbing.length > 0, zooming: grabbing.length === 2,
        hands: states.map(h => ({ x: h.x, y: h.y, grabbing: h.grabbing })),
        pointer: only?.pointing ? { x: only.px, y: only.py } : null,
        pressed: !!only?.pressed, dx, dy, scale, click: !!only?.click, salute: states.some(s => s.salute),
      };
    },
  };
}

/**
 * Where on a screen of `width` × `height` px a pointer in 0..1 of the camera image points. `edge` of each side of the image
 * is left out, so the borders of the screen are reached without taking the hand out of the picture.
 */
export function pointerToScreen(pointer, width, height, edge = 0.18) {
  const f = v => Math.min(1, Math.max(0, (v - edge) / (1 - 2 * edge)));
  return { x: f(pointer.x) * width, y: f(pointer.y) * height };
}
