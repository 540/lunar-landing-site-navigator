// The ascent vehicle (J12.8, #398): what ASCENSO is, as pure decisions without three.js or the DOM. The ascent vehicle
// waits on its pad; once the game is won, the crew boards, a countdown runs and it lifts off to lunar orbit, where it
// docks with the ship that brings the crew home. In vacuum there is no smoke: a flash at ignition, regolith thrown in
// parabolas, the pad lit from below, and the vehicle shrinking into the black sky.
// Units are those of the cabin's scene (km, y up).

/** Height of the vehicle (km): ~9 m, about the ascent stage of an Apollo LM with its descent stage under it. */
export const VEHICLE_HEIGHT_KM = 0.009;
/** Radius of the pad (km): a 30 m disc of compacted regolith. */
export const PAD_RADIUS_KM = 0.015;

/** Timeline of the lift-off, ms: crew boarding, countdown (3, 2, 1), ignition, climb out of sight. */
export const LAUNCH = { board: 1200, count: 3000, ignite: 700, climb: 5500 };
export const LAUNCH_MS = LAUNCH.board + LAUNCH.count + LAUNCH.ignite + LAUNCH.climb;
/** Height reached at the end of the climb (km): out of the frame, a dot against the stars. */
export const CLIMB_KM = 0.9;

/**
 * Phase of the lift-off `ms` after it starts: { phase, count, k, altitudeKm, flash, thrust, done }.
 *   phase       'board' | 'count' | 'ignite' | 'climb' | 'gone'
 *   count       3, 2, 1 during the countdown (null otherwise)
 *   k           progress 0…1 inside the phase
 *   altitudeKm  height of the vehicle over its pad
 *   flash       0…1, the glare of the ignition
 *   thrust      0…1, how hard the engine pushes (dust and the light on the pad)
 */
export function launchAt(ms) {
  const t = Math.max(0, ms);
  const { board, count, ignite, climb } = LAUNCH;
  if (t < board) return { phase: 'board', count: null, k: t / board, altitudeKm: 0, flash: 0, thrust: 0, done: false };
  if (t < board + count) {
    const u = t - board;
    return { phase: 'count', count: 3 - Math.floor(u / 1000), k: u / count, altitudeKm: 0, flash: 0, thrust: 0, done: false };
  }
  if (t < board + count + ignite) {
    const k = (t - board - count) / ignite;
    // The flash peaks at once and fades; the engine comes up to full thrust.
    return { phase: 'ignite', count: null, k, altitudeKm: 0.0004 * k * k, flash: Math.exp(-4 * k), thrust: Math.min(1, k * 1.6), done: false };
  }
  const k = Math.min(1, (t - board - count - ignite) / climb);
  // Constant acceleration: height grows with k², slow at first and then fast (the Moon's 1/6 g makes it brisk).
  return { phase: k < 1 ? 'climb' : 'gone', count: null, k, altitudeKm: 0.0004 + CLIMB_KM * k * k, flash: 0, thrust: k < 1 ? 1 - 0.6 * k : 0, done: k >= 1 };
}

/**
 * The beacon on the top of the vehicle, by mode (liftoffStatus → beaconMode, #398):
 *   'idle'     a short red blink every 1.2 s, so it reads from kilometres away
 *   'waiting'  the crew is there but the lift-off is not cleared: a quick amber double blink every second
 *   'ready'    cleared: steady green
 */
export function beaconOn(ms, mode = 'idle') {
  if (mode === 'ready') return true;
  if (mode === 'waiting') { const t = ms % 1000; return t < 110 || (t >= 220 && t < 330); }
  return ms % 1200 < 160;
}

/** Colour of the beacon (hex) by mode. */
export const BEACON_COLOR = { idle: 0xff2a1a, waiting: 0xffa020, ready: 0x46e08a };

/** How far the beacon is seen (km): beyond this, only the compass points to ASCENSO. */
export const BEACON_KM = 6;

/**
 * Grains thrown by the engine at ignition and while it climbs low: from the pad outwards, low and fast, falling in
 * parabolas (no air). `seed` keeps it deterministic. Returns [{ dx, dz, vx, vy, vz }] in km and km/s.
 */
export function plumeGrains(count, seed = 1) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const v = 0.03 + rnd() * 0.05; // 30–80 m/s along the ground
    out.push({ dx: Math.cos(a) * 0.002, dz: Math.sin(a) * 0.002, vx: Math.cos(a) * v, vy: 0.004 + rnd() * 0.012, vz: Math.sin(a) * v });
  }
  return out;
}

/** After the climb, the camera comes back to the horizon: 0 while it follows the stage, then up to 1 in 1.5 s
 *  (after a 2.5 s look at the Earth when it is over the horizon). At 1 the player has the view back (#398). */
export function launchSettle(ms, earthUp = false) {
  const from = LAUNCH_MS + (earthUp ? 2500 : 600);
  return Math.min(1, Math.max(0, (ms - from) / 1500));
}

/** The win is played as a lift-off only once per game, and never with reduced motion (then a still frame). */
export function shouldLaunch({ over, launched, reduced }) {
  return over === 'win' && !launched && !reduced;
}

/**
 * What the cabin shows on a win (#398): 'play' (the lift-off), 'still' (with reduced motion: a still frame with the
 * ascent stage already in the air) or null (no win, or already shown). Never «nothing»: before this, reduced motion
 * left the vehicle on the ground with only a toast, and «Ver el despegue» did the same.
 */
export function launchPlan({ over, launched, reduced }) {
  if (over !== 'win' || launched) return null;
  return reduced ? 'still' : 'play';
}

/** The still frame of the lift-off: the ascent stage over its pad, climbing, engine lit. Its height follows the
 *  distance from the rover so it is seen ~18° over the horizon (inside the head's 40° tilt): 15 m to 120 m. */
export const STILL_ALTITUDE_KM = 0.06;
export const STILL_ELEVATION_DEG = 18;
export function stillAltitudeKm(distKm) {
  if (!(distKm > 0)) return STILL_ALTITUDE_KM;
  return Math.min(0.12, Math.max(0.015, distKm * Math.tan((STILL_ELEVATION_DEG * Math.PI) / 180)));
}
export const stillPose = (altitudeKm = STILL_ALTITUDE_KM) => ({ phase: 'climb', count: null, k: 0.25, altitudeKm, flash: 0, thrust: 0.85, done: false });

/** Text of the countdown and of the lift-off, for the toast and the screen reader. */
export function launchText(at, texts) {
  if (at.phase === 'board') return texts.launchBoard;
  if (at.phase === 'count') return texts.launchCount(at.count);
  if (at.phase === 'ignite') return texts.launchIgnition;
  return texts.launchClimb;
}
