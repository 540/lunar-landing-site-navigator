// Descent physics in the vertical plane of the approach: x is the downrange position (m, the target is at 0 and the
// lander flies towards +x), alt the altitude over the datum of the site (m) and pitch the tilt of the thrust axis
// from the vertical (deg, positive leans the engine against the flight direction, so it brakes).

export const G_MOON = 1.62;
export const G0 = 9.80665;

// Roughly an Apollo LM descent stage near the end of its braking burn: 45 kN engine, Isp 311 s.
export const LANDER = Object.freeze({
  dryMassKg: 6900,
  fuelKg: 1000,
  maxThrustN: 45000,
  ispS: 311,
  minThrottle: 0.1,
  throttleLagS: 0.35,
  pitchRateDegS: 7,
  maxPitchDeg: 60,
  footHeightM: 0,
});

export const START = Object.freeze({ x: -4600, alt: 2100, vx: 92, vz: -22, pitchDeg: 0 });

export function createState(start = START, lander = LANDER) {
  return { t: 0, x: start.x, alt: start.alt, vx: start.vx, vz: start.vz, pitchDeg: start.pitchDeg, fuelKg: lander.fuelKg, throttle: 0, thrustN: 0, pitchRateDegS: 0 };
}

export const massOf = (state, lander = LANDER) => lander.dryMassKg + state.fuelKg;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Throttle the engine really takes: off below 5 %, never under its minimum stable setting. */
export function effectiveThrottle(command, lander = LANDER) {
  return command < 0.05 ? 0 : clamp(command, lander.minThrottle, 1);
}

/**
 * One integration step (semi-implicit Euler). `command` is { throttle 0..1, pitchDeg target };
 * `systems` says whether the engine can fire and whether the RCS can turn the vehicle.
 */
export function step(state, command, dt, systems = { engine: true, rcs: true }, lander = LANDER) {
  const s = { ...state };
  const wanted = systems.engine && s.fuelKg > 0 ? effectiveThrottle(command.throttle ?? 0, lander) : 0;
  s.throttle += (wanted - s.throttle) * Math.min(1, dt / lander.throttleLagS);
  if (wanted === 0 && s.throttle < 0.01) s.throttle = 0;

  let rate = 0;
  if (systems.rcs) {
    const target = clamp(command.pitchDeg ?? s.pitchDeg, -lander.maxPitchDeg, lander.maxPitchDeg);
    const maxStep = lander.pitchRateDegS * dt;
    const delta = clamp(target - s.pitchDeg, -maxStep, maxStep);
    s.pitchDeg += delta;
    rate = dt > 0 ? delta / dt : 0;
  }
  s.pitchRateDegS = rate;

  let thrust = s.throttle * lander.maxThrustN;
  const burn = (thrust / (lander.ispS * G0)) * dt;
  if (burn >= s.fuelKg) { thrust *= s.fuelKg / (burn || 1); s.fuelKg = 0; } else s.fuelKg -= burn;
  s.thrustN = thrust;

  const mass = lander.dryMassKg + s.fuelKg;
  const p = (s.pitchDeg * Math.PI) / 180;
  const ax = (-thrust * Math.sin(p)) / mass;
  const az = (thrust * Math.cos(p)) / mass - G_MOON;
  s.vx += ax * dt;
  s.vz += az * dt;
  s.x += s.vx * dt;
  s.alt += s.vz * dt;
  s.t += dt;
  return s;
}
