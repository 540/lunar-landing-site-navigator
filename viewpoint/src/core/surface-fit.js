// Fitting something worn round a limb to its real surface (E3, #181): the strap and the case of the watch on the forearm
// of the suit, so that they never go into the cloth nor float off it. Pure: plain arrays, no three.js.
//
// The surface is measured, not assumed: around an axis (the forearm, from the elbow towards the wrist), over a stretch of
// it, the largest distance of the mesh from the axis in each direction (a sector of the turn). Whatever is placed at that
// radius plus a clearance is outside the cloth along all that stretch.

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };

/**
 * Two unit vectors across the axis, so an angle round it has a meaning: u is the one closest to `hint`.
 * @returns {{u:number[], v:number[]}} with u × v = axis
 */
export function crossBasis(axis, hint = [0, 1, 0]) {
  const a = norm(axis);
  let u = hint.map((h, i) => h - a[i] * dot(hint, a));
  if (Math.hypot(...u) < 1e-6) u = Math.abs(a[0]) < 0.9 ? [1 - a[0] * a[0], -a[0] * a[1], -a[0] * a[2]] : [-a[1] * a[0], 1 - a[1] * a[1], -a[1] * a[2]];
  u = norm(u);
  return { u, v: cross(a, u) };
}

/**
 * The radius of the surface round an axis, per sector.
 * @param {ArrayLike<number>} points x, y, z of the points of the surface (only those that belong to the limb)
 * @param {number[]} origin a point of the axis
 * @param {number[]} axis its direction
 * @param {number} t0 the stretch measured, from t0 to t1 along the axis from `origin`
 * @param {number} t1
 * @param {number} sectors how many sectors the turn is cut into
 * @returns {{origin:number[], axis:number[], u:number[], v:number[], t0:number, t1:number, radii:Float64Array}}
 *   radii: the largest radius in each sector (sector k covers angles [k, k+1)·2π/sectors from u towards v)
 */
export function radialProfile(points, origin, axis, t0, t1, sectors = 72) {
  const a = norm(axis), { u, v } = crossBasis(a);
  const radii = new Float64Array(sectors).fill(-1);
  for (let i = 0; i < points.length; i += 3) {
    const d = [points[i] - origin[0], points[i + 1] - origin[1], points[i + 2] - origin[2]];
    const t = dot(d, a);
    if (t < t0 || t > t1) continue;
    const r = [d[0] - a[0] * t, d[1] - a[1] * t, d[2] - a[2] * t];
    const x = dot(r, u), y = dot(r, v), radius = Math.hypot(x, y);
    const k = Math.floor(((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1 * sectors) % sectors;
    if (radius > radii[k]) radii[k] = radius;
  }
  // A sector with no point takes the larger of its nearest measured neighbours (never smaller: never inside the cloth).
  const measured = [...radii].some(r => r >= 0);
  if (!measured) throw new Error('No point of the surface in the stretch measured');
  const filled = Float64Array.from(radii, (r, k) => {
    if (r >= 0) return r;
    let best = -1;
    for (let s = 1; s < sectors && best < 0; s++) best = Math.max(radii[(k + s) % sectors], radii[(k - s + sectors) % sectors]);
    return best;
  });
  return { origin: [...origin], axis: a, u, v, t0, t1, radii: filled };
}

/** The sector of an angle (radians from u towards v). */
const sectorOf = (profile, angle) => {
  const n = profile.radii.length;
  return Math.floor((((angle / (2 * Math.PI)) % 1) + 1) % 1 * n) % n;
};

/**
 * How far from the axis something flat must sit, facing `angle`, so that none of it goes into the surface: the largest
 * radius under its footprint (its half width across the axis, at that radius), plus the clearance. A flat plate over a
 * curved surface also has to clear the surface beside its centre: radius r at an angle δ off its centre is r·cos δ high
 * under the plate.
 */
export function seatRadius(profile, angle, halfWidth, clearance = 0) {
  const n = profile.radii.length, step = 2 * Math.PI / n;
  let r = profile.radii[sectorOf(profile, angle)];
  // the footprint grows with the radius: iterate to a fixed point (two or three rounds)
  for (let round = 0; round < 4; round++) {
    const span = Math.atan2(halfWidth, r);
    let top = 0;
    for (let k = -Math.ceil(span / step) - 1; k <= Math.ceil(span / step) + 1; k++) {
      const off = k * step;
      if (Math.abs(off) > span + step) continue;
      const rk = profile.radii[sectorOf(profile, angle + off)];
      top = Math.max(top, rk * Math.cos(Math.min(Math.abs(off), Math.PI / 2)));
    }
    r = top;
  }
  return r + clearance;
}

/** A closed band round the axis that follows the profile at `offset` outside it: points per sector, at t. */
export function bandRing(profile, t, offset) {
  const { origin, axis, u, v, radii } = profile, n = radii.length, out = [];
  for (let k = 0; k < n; k++) {
    // the larger of this sector and its neighbours: the band passes over the edges between sectors, never through them
    const r = Math.max(radii[k], radii[(k + 1) % n], radii[(k - 1 + n) % n]) + offset;
    const angle = (k + 0.5) * 2 * Math.PI / n, c = Math.cos(angle), s = Math.sin(angle);
    out.push(origin.map((o, i) => o + axis[i] * t + (u[i] * c + v[i] * s) * r));
  }
  return out;
}
