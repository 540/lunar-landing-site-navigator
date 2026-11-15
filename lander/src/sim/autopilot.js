// Descent guidance: a speed profile in each axis (slower the closer and the lower), turned into a thrust vector.
import { G_MOON, LANDER, massOf } from './physics.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const GUIDANCE = Object.freeze({
  brakeDecel: 0.95,       // m/s² kept in reserve to stop over the target
  maxPitchDeg: 38,
  glideSlope: 0.3,        // metres of height kept per metre still to fly
  touchdownSpeed: 1.1,
  finalAltM: 150,
});

/** Speeds the guidance wants at this point of the descent. `height` is the radar height over the ground. */
export function targetSpeeds(state, height, g = GUIDANCE) {
  const toGo = -state.x;
  const far = Math.abs(toGo);
  const vx = Math.sign(toGo) * Math.min(Math.sqrt(2 * g.brakeDecel * far), 0.16 * far);
  let vz = -(g.touchdownSpeed + 0.62 * Math.sqrt(Math.max(0, height - 3)));
  const floor = g.glideSlope * Math.max(0, far - 40);
  if (height < floor) vz *= clamp(1 - (floor - height) / (0.35 * floor + 20), 0, 1);
  return { vx, vz };
}

export function guide(state, height, lander = LANDER, g = GUIDANCE) {
  const want = targetSpeeds(state, height, g);
  const mass = massOf(state, lander);
  const maxAccel = lander.maxThrustN / mass;
  const az = clamp((want.vz - state.vz) / 1.6 + G_MOON, 0.25, maxAccel);
  const ax = clamp((want.vx - state.vx) / 2.5, -1.8, 1.8);
  // Upright near the ground: the last metres are flown almost vertical.
  const limit = clamp(3 + height * 0.22, 3, g.maxPitchDeg);
  const pitchDeg = clamp((Math.atan2(-ax, az) * 180) / Math.PI, -limit, limit);
  // The vertical axis comes first: the throttle holds the sink rate at the attitude the vehicle has now.
  const cos = Math.max(0.5, Math.cos((state.pitchDeg * Math.PI) / 180));
  return { throttle: clamp(az / cos / maxAccel, lander.minThrottle, 1), pitchDeg };
}
