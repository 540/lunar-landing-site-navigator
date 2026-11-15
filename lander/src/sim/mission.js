// The descent as a whole: phases, what the crew does on its own under autopilot, warnings and the end of the flight.
// Pure: `stepMission` takes the systems the controls allow and returns the new mission plus the events of the step.
import { LANDER, START, createState, step } from './physics.js';
import { GUIDANCE, guide } from './autopilot.js';
import { assessLanding } from './outcome.js';

export const IGNITION_S = 6;
export const ARM_S = 2.5;
export const GEAR_DEPLOY_S = 4;
export const GEAR_AUTO_ALT_M = 700;
export const ABORT_S = 7;
export const CALLOUT_HEIGHTS = [1500, 1000, 500, 300, 150, 60, 30, 10];
export const MANUAL_PITCH_RATE = 9; // deg/s of target attitude while the stick is held

const FLAT = { heightAt: () => 0, slopeDegAt: () => 0 };

export function createMission(start = START, lander = LANDER) {
  return {
    state: createState(start, lander), phase: 'approach', gear: 0, manualPitchDeg: start.pitchDeg, ended: false, outcome: null,
    warnings: { lowFuel: false, sinkRate: false, gearUp: false, noEngine: false, noRcs: false },
    crew: { armed: false, gear: false }, callouts: 0, abortT: -1, height: start.alt, maxThrottle: 0,
  };
}

export const radarHeight = (state, terrain = FLAT) => state.alt - terrain.heightAt(state.x, 0);

/** Sink rate the vehicle can still stop from this height with a comfortable margin. */
export const safeSinkRate = height => 6 + 1.6 * Math.sqrt(Math.max(0, height));

export function stepMission(mission, sys, input, dt, terrain = FLAT, lander = LANDER) {
  if (mission.ended) return { mission, events: [] };
  const m = { ...mission, warnings: { ...mission.warnings }, crew: { ...mission.crew } };
  const events = [];
  const s0 = m.state;
  const height = radarHeight(s0, terrain);

  // The pilot runs the checklist while the autopilot flies: arms the engine before ignition, lowers the gear on final.
  if (sys.autopilot && !m.crew.armed && s0.t >= ARM_S) {
    m.crew.armed = true;
    if (!sys.engineArmed) events.push({ type: 'crew', id: 'engineArm', on: true });
  }
  if (sys.autopilot && !m.crew.gear && height < GEAR_AUTO_ALT_M) {
    m.crew.gear = true;
    if (!sys.gear) events.push({ type: 'crew', id: 'gear', on: true });
  }

  let command, engine = sys.engine, rcs = sys.rcs;
  if (sys.abort) {
    if (m.abortT < 0) { m.abortT = 0; m.phase = 'abort'; events.push({ type: 'phase', phase: 'abort' }); }
    m.abortT += dt;
    command = { throttle: 1, pitchDeg: 0 };
    engine = true; rcs = true;
  } else if (sys.autopilot) {
    command = s0.t < IGNITION_S ? { throttle: 0, pitchDeg: s0.pitchDeg } : guide(s0, height, lander, GUIDANCE);
    m.manualPitchDeg = s0.pitchDeg;
  } else {
    m.manualPitchDeg = Math.min(lander.maxPitchDeg, Math.max(-lander.maxPitchDeg, m.manualPitchDeg + (input.pitch ?? 0) * MANUAL_PITCH_RATE * dt));
    command = { throttle: sys.throttle, pitchDeg: m.manualPitchDeg };
  }

  const s = step(s0, command, dt, { engine, rcs }, lander);
  m.state = s;
  m.maxThrottle = Math.max(m.maxThrottle, s.throttle);
  m.gear = Math.min(1, Math.max(0, m.gear + (sys.gear ? dt : -dt) / GEAR_DEPLOY_S));

  const ground = terrain.heightAt(s.x, 0);
  m.height = s.alt - ground;

  if (m.phase === 'approach' && s.throttle > 0.02) { m.phase = 'braking'; events.push({ type: 'phase', phase: 'braking' }); }
  if (m.phase === 'braking' && m.height < GUIDANCE.finalAltM && Math.abs(s.vx) < 12) { m.phase = 'final'; events.push({ type: 'phase', phase: 'final' }); }

  while (m.callouts < CALLOUT_HEIGHTS.length && m.height <= CALLOUT_HEIGHTS[m.callouts]) {
    events.push({ type: 'callout', height: CALLOUT_HEIGHTS[m.callouts], vz: s.vz });
    m.callouts++;
  }

  const warn = (code, on) => { if (on && !m.warnings[code]) events.push({ type: 'warning', code }); m.warnings[code] = on; };
  if (m.phase !== 'abort') {
    warn('lowFuel', s.fuelKg < 0.12 * lander.fuelKg);
    warn('sinkRate', -s.vz > safeSinkRate(m.height) && s.t > IGNITION_S + 2);
    warn('gearUp', m.height < 200 && m.gear < 1 && !sys.gear);
    warn('noEngine', !sys.engine && s.t > IGNITION_S);
    warn('noRcs', !sys.rcs);
  }

  if (m.phase === 'abort') {
    if (m.abortT >= ABORT_S) { m.ended = true; m.outcome = { result: 'abort' }; events.push({ type: 'end', outcome: m.outcome }); }
  } else if (m.height <= lander.footHeightM) {
    m.state = { ...s, alt: ground, throttle: 0, thrustN: 0 };
    m.height = 0;
    m.phase = 'contact';
    m.ended = true;
    m.outcome = assessLanding({ vz: s.vz, vx: s.vx, pitchDeg: s.pitchDeg, slopeDeg: terrain.slopeDegAt(s.x, 0), gearDown: m.gear >= 1, fuelKg: s.fuelKg, distanceM: s.x });
    events.push({ type: 'phase', phase: 'contact' }, { type: 'end', outcome: m.outcome });
  } else if (s.alt > 9000 || Math.abs(s.x) > 30000) {
    m.ended = true; m.outcome = { result: 'lost' }; events.push({ type: 'end', outcome: m.outcome });
  }
  return { mission: m, events };
}
