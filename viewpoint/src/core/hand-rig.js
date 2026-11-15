// Fingers for the gloves of your suit (E3, #181). NASA's Z-2 model has no skeleton at all, let alone in its hands: the
// fingers are found here on the mesh of the glove itself, so they can bend when the camera sees yours. Pure: no three.js.
//
// How: the distance over the surface of the glove from the wrist (Dijkstra on its edges). The tips of the fingers are where
// it peaks. Each point belongs to the finger it climbs to. A finger is a tube on its own from where it stops touching the
// others (the web between two fingers, its knuckle) to its tip, and it bends at the knuckle and halfway along.

/** Points within this of each other are one point (the mesh is split along seams), metres. */
const WELD = 1e-5;
/** A peak this far from the wrist, as a part of the farthest, is a fingertip (the thumb of the Z-2 reaches 0.39 of the
 * farthest); nearer ones are bumps of the glove. */
const TIP_MIN = 0.3;
/** Two peaks closer than this are one fingertip (m). */
const TIP_MERGE = 0.018;
/** Where the knuckle may be, as a part of the way from the wrist to the tip, whatever the mesh says. */
const KNUCKLE_RANGE = [0.3, 0.7];
/** Where the middle joint is, as a part of the way from the knuckle to the tip. */
const MIDDLE_AT = 0.45;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const centroid = pts => { const c = [0, 0, 0]; for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return c.map(v => v / (pts.length || 1)); };

/**
 * Welds the corners of triangles into points and links them by the edges of the triangles.
 * @param {ArrayLike<number>} positions x, y, z per corner, three corners per triangle (not indexed)
 * @param {(p:number[]) => boolean} keep which points take part
 * @returns {{points:number[][], neighbours:Set<number>[], cornerPoint:Int32Array}} cornerPoint: the point of each corner (−1 if left out)
 */
export function weldGraph(positions, keep) {
  const key = (x, y, z) => `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
  const index = new Map(), points = [], neighbours = [], n = positions.length / 3, cornerPoint = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const p = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    if (!keep(p)) continue;
    const k = key(...p);
    let id = index.get(k);
    if (id === undefined) { id = points.length; index.set(k, id); points.push(p); neighbours.push(new Set()); }
    cornerPoint[i] = id;
  }
  for (let t = 0; t < n; t += 3) {
    const a = cornerPoint[t], b = cornerPoint[t + 1], c = cornerPoint[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) if (u >= 0 && v >= 0 && u !== v) { neighbours[u].add(v); neighbours[v].add(u); }
  }
  return { points, neighbours, cornerPoint };
}

/** Distance over the surface from the seeds (Dijkstra; a plain binary heap). */
export function surfaceDistance(points, neighbours, seeds) {
  const d = new Float64Array(points.length).fill(Infinity), heap = [];
  const push = (v, k) => { heap.push([k, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const s of seeds) { d[s] = 0; push(s, 0); }
  while (heap.length) {
    const [k, v] = pop();
    if (k > d[v]) continue;
    for (const u of neighbours[v]) { const nd = k + dist(points[v], points[u]); if (nd < d[u]) { d[u] = nd; push(u, nd); } }
  }
  return d;
}

/**
 * The fingers of a glove.
 * @param {number[][]} points the points of the hand, beyond the wrist
 * @param {Set<number>[]} neighbours
 * @param {number[]} seeds the points on the wrist
 * @returns {{fingers:{tip:number[], knuckle:number[], middle:number[], start:number, reach:number}[], finger:Int8Array,
 *   along:Float64Array, distance:Float64Array}|null} fingers ordered from the thumb (the one that branches off nearest the
 *   wrist) across the hand; finger: the finger of each point (−1 on the palm); along: 0 at its knuckle, 1 at its tip;
 *   null if the glove does not show five fingers
 */
export function findFingers(points, neighbours, seeds) {
  const d = surfaceDistance(points, neighbours, seeds);
  let far = 0;
  for (const v of d) if (Number.isFinite(v)) far = Math.max(far, v);
  if (!(far > 0)) return null;
  // peaks: no neighbour within two rings is farther from the wrist
  const peaks = [];
  for (let v = 0; v < points.length; v++) {
    if (!(d[v] >= TIP_MIN * far)) continue;
    let top = true;
    for (const u of neighbours[v]) { if (d[u] > d[v]) { top = false; break; } for (const w of neighbours[u]) if (d[w] > d[v]) { top = false; break; } if (!top) break; }
    if (top) peaks.push(v);
  }
  peaks.sort((a, b) => d[b] - d[a]);
  const tips = [];
  for (const v of peaks) if (!tips.some(t => dist(points[t], points[v]) < TIP_MERGE)) tips.push(v);
  if (tips.length !== 5) return null;
  // each point climbs to its peak, and the peak to the nearest tip
  const tipOf = new Int32Array(points.length).fill(-1);
  const climb = v => {
    const path = [];
    while (tipOf[v] < 0) {
      path.push(v);
      let next = v;
      for (const u of neighbours[v]) if (d[u] > d[next]) next = u;
      if (next === v) { let best = 0; tips.forEach((t, k) => { if (dist(points[t], points[v]) < dist(points[tips[best]], points[v])) best = k; }); tipOf[v] = best; break; }
      v = next;
    }
    for (const p of path) tipOf[p] = tipOf[v];
  };
  for (let v = 0; v < points.length; v++) if (Number.isFinite(d[v])) climb(v);
  // the knuckle: the farthest point of a finger that still touches another finger (the web), within its range
  const web = tips.map(() => 0);
  for (let v = 0; v < points.length; v++) for (const u of neighbours[v]) if (tipOf[u] >= 0 && tipOf[v] >= 0 && tipOf[u] !== tipOf[v]) web[tipOf[v]] = Math.max(web[tipOf[v]], d[v]);
  const start = tips.map((t, k) => Math.min(Math.max(web[k], KNUCKLE_RANGE[0] * d[t]), KNUCKLE_RANGE[1] * d[t]));
  const band = (k, at, w = 0.006) => { const pts = []; for (let v = 0; v < points.length; v++) if (tipOf[v] === k && Math.abs(d[v] - at) <= w) pts.push(points[v]); return pts.length ? centroid(pts) : null; };
  let fingers = tips.map((t, k) => {
    const knuckle = band(k, start[k]) ?? points[t], middle = band(k, start[k] + MIDDLE_AT * (d[t] - start[k])) ?? points[t];
    return { k, tip: points[t], knuckle, middle, start: start[k], reach: d[t] };
  });
  // thumb first: the one that leaves the palm nearest the wrist; then the others in turn across the hand from it
  const thumb = fingers.reduce((a, b) => (b.start < a.start ? b : a));
  const rest = fingers.filter(f => f !== thumb);
  const ordered = [thumb];
  while (rest.length) {
    const lastF = ordered[ordered.length - 1];
    rest.sort((a, b) => dist(a.knuckle, lastF.knuckle) - dist(b.knuckle, lastF.knuckle));
    ordered.push(rest.shift());
  }
  fingers = ordered;
  const order = new Map(fingers.map((f, i) => [f.k, i]));
  const finger = new Int8Array(points.length).fill(-1), along = new Float64Array(points.length);
  for (let v = 0; v < points.length; v++) {
    if (tipOf[v] < 0) continue;
    const f = fingers[order.get(tipOf[v])];
    along[v] = (d[v] - f.start) / ((f.reach - f.start) || 1);
    finger[v] = order.get(tipOf[v]);
  }
  return { fingers: fingers.map(({ k, ...f }) => f), finger, along, distance: d };
}

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The two bones of a point of the hand and their weights: the palm with the hand; a finger from its knuckle with its first
 * bone and from halfway with its second, blended over a little at each joint so the glove creases instead of tearing.
 * @param {number} finger 0..4, or −1 on the palm
 * @param {number} along 0 at the knuckle, 1 at the tip
 * @param {{hand:number, fingers:[number, number][]}} bones indices of the bones
 * @returns {{index:[number, number], weight:[number, number]}}
 */
export function handWeights(finger, along, bones) {
  if (finger < 0) return { index: [bones.hand, bones.hand], weight: [1, 0] };
  const [first, second] = bones.fingers[finger];
  const out = smooth(-0.12, 0.08, along); // palm → first bone
  if (out < 1) return { index: [first, bones.hand], weight: [out, 1 - out] };
  const mid = smooth(MIDDLE_AT - 0.08, MIDDLE_AT + 0.08, along); // first → second bone
  return mid > 0 ? { index: [second, first], weight: [mid, 1 - mid] } : { index: [first, first], weight: [1, 0] };
}

/** The direction from one point to another, unit. */
export const toward = (a, b) => { const v = sub(b, a), l = Math.hypot(...v) || 1; return v.map(x => x / l); };
