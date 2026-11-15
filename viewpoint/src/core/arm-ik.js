// Two-bone inverse kinematics for your arm (E3, #181): where the elbow goes so the hand reaches a point, the way games
// raise an arm to a target (here, the wrist to the eyes to read the watch). Pure: plain {x, y, z} vectors, no three.js.

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length = a => Math.hypot(a.x, a.y, a.z);
const unit = a => { const l = length(a) || 1; return scale(a, 1 / l); };

/**
 * Elbow of a two-bone limb from `root` (the shoulder) towards `target` (the wrist), with the bone lengths l1 (upper arm)
 * and l2 (forearm). The elbow bends towards `pole` (a point: down and out for an arm). A target out of reach is moved
 * to the edge of the reach, along its direction; one too close, out to the shortest reach.
 * @returns {{elbow:{x,y,z}, end:{x,y,z}, reached:boolean}} end: where the wrist really is
 */
export function twoBoneIK(root, target, l1, l2, pole) {
  const toTarget = sub(target, root);
  const reach = l1 + l2, short = Math.abs(l1 - l2);
  const d = Math.min(Math.max(length(toTarget), short + 1e-6), reach - 1e-6);
  const dir = unit(toTarget);
  const end = add(root, scale(dir, d));
  // Law of cosines: how far along the line the elbow projects and how far off it.
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // Off the line towards the pole, perpendicular to the line.
  const toPole = sub(pole, root);
  let bend = sub(toPole, scale(dir, dot(toPole, dir)));
  if (length(bend) < 1e-9) bend = cross(dir, Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 });
  const elbow = add(add(root, scale(dir, a)), scale(unit(bend), h));
  return { elbow, end, reached: Math.abs(length(toTarget) - d) < 1e-5 };
}

/**
 * An arm as a hinge (E3, #181): how to turn the upper arm and bend the elbow so the upper arm points along `u` and the
 * forearm along `f`, from the rest directions `u0` and `f0` (all unit vectors in the same frame). Lining up each bone with
 * the shortest turn, as before, left the twist of the arm about itself to chance: the elbow then bent sideways and the
 * forearm twisted over the upper arm, as if the arm broke. Here the upper arm takes both its direction and the plane of the
 * elbow (u × f), and the elbow only bends in that plane. With the arm straight that plane is not defined: the one it had
 * (`prevPlane`) is kept, faded in as the arm straightens, so it does not jump.
 * @returns {{from:[object,object,object], to:[object,object,object], bend:number, axis:object, plane:object}} from → to:
 *   the orthonormal frames (arm, plane, their cross product) whose turn is the turn of the upper arm; bend: radians the
 *   elbow bends beyond its rest, about `axis` (the rest plane, in the frame of the upper arm); plane: to pass back next time
 */
export function hingePose(u0, f0, u, f, prevPlane = null) {
  const STRAIGHT = 0.15; // sin of the bend under which the plane fades to the one it had
  const n0 = unit(cross(u0, f0));
  const onPlane = p => unit(sub(p, scale(u, dot(p, u))));
  // the plane it had, or the rest one, square to the new arm
  let keep = onPlane(prevPlane ?? n0);
  if (length(keep) < 0.5 || !Number.isFinite(keep.x)) keep = unit(cross(u, Math.abs(u.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }));
  const raw = cross(u, f), s = length(raw);
  let plane = keep;
  if (s > 1e-6) {
    let n = scale(raw, 1 / s);
    const w = Math.min(1, s / STRAIGHT);
    plane = unit(add(scale(n, w), scale(keep, 1 - w)));
    if (length(plane) < 1e-6) plane = n;
  }
  const bend = Math.acos(Math.max(-1, Math.min(1, dot(u, f)))) - Math.acos(Math.max(-1, Math.min(1, dot(u0, f0))));
  return { from: [u0, n0, cross(u0, n0)], to: [u, plane, cross(u, plane)], bend, axis: n0, plane };
}
