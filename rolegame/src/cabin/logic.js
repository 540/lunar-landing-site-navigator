// Cabin of the rover (J12.1, #297): the decisions of the first-person view, without three.js or the DOM.
// Units are those of the Mirador's scene (viewpoint/src/core/relief.js): km, x east, y up, z south, centred on the
// site. The game grid of a LOLA scenario is drawn in that same frame (pipeline/game-scenario.mjs, lolaWorld), so a
// cell maps straight onto the Mirador's relief of the same site.
import { REGION_IDS } from '../../../viewpoint/src/core/regions.js';
import { isRealRelief } from '../scenario-source.js';

/** Where the cabin reads the relief from, relative to rolegame/: the Mirador's regions. */
export const REGION_ROOT = '../viewpoint/data/';
/** Eye of the driver over the ground, km (2.2 m). */
export const EYE_KM = 0.0022;
/** Length of the descent from the map to the cabin, ms. */
export const DESCENT_MS = 2600;
/** Height of the descent's first frame over the rover, km: the 12 km of the game fill a 50° view, as the map does. */
export const DESCENT_START_KM = 13;
/** Limits of the driver's head: yaw ±110°, pitch −35° … +40° (degrees). */
export const LOOK = { yaw: 110, pitchMin: -35, pitchMax: 40 };

/**
 * The cabin is offered with the full map (WebGL) and a scenario on real LOLA relief whose site has a Mirador region.
 * The procedural scenario has no cabin: its 250 m grid does not hold a view from 2 m.
 */
export function cabinRegion({ scenario, mapMode, regions = REGION_IDS }) {
  if (mapMode !== 'full' || !scenario || !isRealRelief(scenario)) return null;
  return regions.includes(scenario.siteId) ? scenario.siteId : null;
}

/** Scene position (km) of a game cell, fractional while the rover moves: cell centres at (x + 0.5) × cellM. */
export function cellToScene(scenario, x, y) {
  const { n, cellM } = scenario.grid;
  const half = (n * cellM) / 2000;
  return { x: -half + ((x + 0.5) * cellM) / 1000, z: -half + ((y + 0.5) * cellM) / 1000 };
}

/** Heading (radians, 0 = north, clockwise, as roverHeading of map-hud.js) as a yaw of the scene camera. */
export const headingToYaw = (heading) => -heading;

export const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const lerp = (a, b, k) => a + (b - a) * k;
/** Shortest turn from angle a to b (radians), interpolated. */
export function lerpAngle(a, b, k) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/**
 * Camera of the descent at progress k (0 … 1): it leaves the map (straight down over the rover, north up), turns
 * towards the horizon while it falls and lands at the driver's eye looking ahead. The pitch turns before the fall ends,
 * so the horizon is in view for the last second. `ground` is the height of the ground under the rover (km).
 * Returns { x, y, z, yaw, pitch } (radians; pitch −π/2 looks straight down).
 */
export function descentPose(k, { x, z, ground, yaw }) {
  const e = easeInOutCubic(Math.min(1, Math.max(0, k)));
  const fall = 1 - Math.pow(1 - e, 2.2);
  const turn = easeInOutCubic(Math.min(1, Math.max(0, (k - 0.15) / 0.65)));
  return {
    x, z,
    y: ground + lerp(DESCENT_START_KM, EYE_KM, fall),
    yaw: lerpAngle(0, yaw, turn),
    pitch: lerp(-Math.PI / 2, 0, turn),
  };
}

/**
 * The driver's head with inertia: `look` = { yaw, pitch, vYaw, vPitch } (degrees and degrees per second). A drag sets
 * the speed; with no input it slows down (half-life ~0.12 s) and stays within LOOK. Returns a new look.
 */
export function stepLook(look, dtS, { push = null } = {}) {
  let { yaw, pitch, vYaw, vPitch } = look;
  if (push) { vYaw = push.vYaw ?? vYaw; vPitch = push.vPitch ?? vPitch; }
  yaw = Math.min(LOOK.yaw, Math.max(-LOOK.yaw, yaw + vYaw * dtS));
  pitch = Math.min(LOOK.pitchMax, Math.max(LOOK.pitchMin, pitch + vPitch * dtS));
  const damp = Math.pow(0.5, dtS / 0.12);
  return { yaw, pitch, vYaw: Math.abs(vYaw * damp) < 0.5 ? 0 : vYaw * damp, vPitch: Math.abs(vPitch * damp) < 0.5 ? 0 : vPitch * damp };
}

/**
 * The rover turning on itself with the arrow keys (J12.1; driving is J12.2): `turn` = { angle, v } (degrees, °/s).
 * Holding a key accelerates up to 45 °/s; letting go brakes. Returns the new turn and how fast it is spinning.
 */
export function stepTurn(turn, dtS, dir = 0) {
  const MAX = 45, ACC = 120, BRAKE = 160;
  let v = turn.v;
  if (dir) v = Math.max(-MAX, Math.min(MAX, v + dir * ACC * dtS));
  else v = Math.sign(v) * Math.max(0, Math.abs(v) - BRAKE * dtS);
  return { angle: turn.angle + v * dtS, v };
}

/**
 * The cabin breathing at rest: a few centimetres up and down and a fraction of a degree of sway, so the view feels
 * mounted on a vehicle. None with reduced motion. `tS` in seconds; returns { dy (km), roll, pitch (radians) }.
 */
export function breathing(tS, reduced) {
  if (reduced) return { dy: 0, roll: 0, pitch: 0 };
  const a = (2 * Math.PI * tS) / 4.2;
  return { dy: 0.00002 * Math.sin(a), roll: 0.0018 * Math.sin(a * 0.5 + 1), pitch: 0.0012 * Math.sin(a + 0.6) };
}

/** Which effects each quality level draws (they must keep ≥ 30 fps in «medio»; the costly ones only in «alto»). */
export function cabinEffects(level) {
  return {
    flare: level !== 'bajo', // sprites of the Sun's flare along the view
    shadowMap: level === 'alto' ? 4096 : level === 'medio' ? 3072 : 2048,
    dust: level === 'alto' ? 600 : level === 'medio' ? 300 : 120,
    pixelRatio: level === 'alto' ? 2 : level === 'medio' ? 1.5 : 1,
  };
}

// ---- Driving by hand (J12.2) ----

/**
 * The rover's pace, in metres per second (and degrees per second for the turns). The game charges its clock and its
 * battery per cell crossed (move() of the engine), never per real second, so this is only how fast the ground goes by:
 * a quick rover, not a racing car. `cruise` (43 km/h) with the throttle alone; `turbo` (130 km/h, the long gear, Shift
 * or the touch pad pushed to its edge) to cross the 250 m cells in about 7 s; reverse is slow. It can turn on itself,
 * slower than when it rolls. Accelerations in m/s². The autopilot (J12.4) drives a route at `autopilot`, faster on a
 * long route so that it never takes more than `autopilotMaxMs`.
 */
export const DRIVE = {
  cruise: 12, turbo: 36, reverse: 4, accel: 5, turboAccel: 9, brake: 14, coast: 3, gearDown: 8,
  turn: 50, turnInPlace: 30, rolling: 0.5,
  autopilot: 36, autopilotMaxMs: 20000,
};
/** Size of a game cell (m) when the scenario does not say (all of them use 250 m). */
export const CELL_M = 250;
/** Speed (m/s) as km/h, rounded, for the cabin's readout. */
export const kmh = (speedMs) => Math.round(Math.abs(speedMs) * 3.6);

/**
 * One step of the car. `car` = { x, y (cells, fractional: whole numbers are cell centres), heading (radians, 0 =
 * north, clockwise), speed (m/s, negative backwards) }; `input` = { throttle, steer } in −1 … 1 (keys give ±1, the
 * touch pad anything in between) and `turbo` (the long gear); `cellM`, the size of a cell in metres. Pure: returns a
 * new car. Letting go of the long gear slows the car down to cruise, it does not brake it at once.
 */
export function stepCar(car, { throttle = 0, steer = 0, turbo = false }, dtS, cellM = CELL_M) {
  let { x, y, heading, speed } = car;
  if (throttle > 0) {
    const top = (turbo ? DRIVE.turbo : DRIVE.cruise) * throttle;
    if (speed < 0) speed = Math.min(0, speed + DRIVE.brake * dtS);
    else if (speed > top) speed = Math.max(top, speed - DRIVE.gearDown * dtS);
    else speed = Math.min(top, speed + (turbo && speed >= DRIVE.cruise * 0.5 ? DRIVE.turboAccel : DRIVE.accel) * dtS);
  } else if (throttle < 0) speed = speed > 0 ? Math.max(0, speed - DRIVE.brake * dtS) : Math.max(-DRIVE.reverse * -throttle, speed - DRIVE.accel * dtS);
  else speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - DRIVE.coast * dtS);
  const rolling = Math.abs(speed) > DRIVE.rolling;
  const rate = (rolling ? DRIVE.turn : DRIVE.turnInPlace) * (Math.PI / 180) * steer * (speed < -DRIVE.rolling ? -1 : 1);
  heading += rate * dtS;
  x += (Math.sin(heading) * speed * dtS) / cellM;
  y -= (Math.cos(heading) * speed * dtS) / cellM;
  return { x, y, heading, speed, turnRate: rate };
}

/**
 * How long the autopilot takes to drive a route of `cells` steps of `cellM` metres seen from the cabin (ms): at
 * DRIVE.autopilot, faster on a long route so it never passes DRIVE.autopilotMaxMs. With reduced motion, 0 (the rover is
 * placed at the end, as on the map).
 */
export function cabinRouteMs(cells, cellM = CELL_M, { reduced = false } = {}) {
  if (reduced || cells <= 0) return 0;
  return Math.min((cells * cellM * 1000) / DRIVE.autopilot, DRIVE.autopilotMaxMs);
}

/**
 * The car following the route the autopilot drives (J12.4): it goes to `to` = { x, y } (cells, fractional) and turns
 * smoothly towards where it is going, at most DRIVE.turn·2 degrees per second, so a bend of the route is a curve and
 * not a jump of the view. Its speed (m/s) is the distance over `dtS`. Pure.
 */
export function followRoute(car, to, dtS, cellM = CELL_M) {
  const dx = to.x - car.x, dy = to.y - car.y, d = Math.hypot(dx, dy);
  if (d < 1e-6 || !(dtS > 0)) return { ...car, x: to.x, y: to.y, speed: 0, turnRate: 0 };
  const want = Math.atan2(dx, -dy);
  const diff = Math.atan2(Math.sin(want - car.heading), Math.cos(want - car.heading));
  const max = 2 * DRIVE.turn * (Math.PI / 180) * dtS;
  const turn = Math.max(-max, Math.min(max, diff));
  return { x: to.x, y: to.y, heading: car.heading + turn, speed: (d * cellM) / dtS, turnRate: turn / dtS };
}

/** The game cell the car is on (cell centres are whole numbers). */
export const cellOf = (car) => ({ x: Math.round(car.x), y: Math.round(car.y) });

/** Stopped against a slope: back inside the cell it was on, at rest. */
export function bounceBack(car, cell) {
  const keep = 0.45;
  return { ...car, x: cell.x + Math.max(-keep, Math.min(keep, car.x - cell.x)), y: cell.y + Math.max(-keep, Math.min(keep, car.y - cell.y)), speed: 0 };
}

/**
 * Suspension with the Moon's gravity: the cabin follows the ground through a soft spring, so a bump throws it up and
 * it comes down slowly (1.62 m/s²). `s` = { y, v } (km, km/s) relative to the ground; returns the new one.
 * With reduced motion the cabin sits on the ground.
 */
export function stepSuspension(s, groundKm, dtS, reduced = false) {
  if (reduced) return { y: groundKm, v: 0 };
  const k = 38, c = 7, g = 0.00162;
  let { y, v } = s;
  if (!Number.isFinite(y)) return { y: groundKm, v: 0 };
  const a = -k * (y - groundKm) - c * v - (y > groundKm ? g : 0);
  v += a * dtS;
  y += v * dtS;
  if (y < groundKm - 0.0002) { y = groundKm - 0.0002; v = Math.max(0, v); }
  return { y, v };
}

// ---- Compass of the cabin (J12.3) ----

/** Half the width of the compass strip, in degrees each side of where the rover faces. */
export const COMPASS_HALF_DEG = 90;

/**
 * Where a bearing falls on the compass strip: `az` and `headingDeg` in degrees from north, clockwise. Returns
 * { x: −1 … 1 across the strip, off: −1 | 0 | 1 } (off: beyond the left or right edge, then x sticks to that edge).
 */
export function compassMark(az, headingDeg) {
  const d = ((((az - headingDeg) % 360) + 540) % 360) - 180;
  if (Math.abs(d) <= COMPASS_HALF_DEG) return { x: d / COMPASS_HALF_DEG, off: 0 };
  return { x: Math.sign(d), off: Math.sign(d) };
}

/** Bearing (degrees from north, clockwise) from one game cell to another (north is −y on the grid). */
export const cellBearing = (from, to) => ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360;
