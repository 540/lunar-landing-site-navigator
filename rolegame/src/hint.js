// Pad hint (J1.3): pure helpers for the pulse and guide line drawn at the start of a game.
import { distanceKm } from './cell-report.js';
export const HINT_MS = 5000; // WCAG 2.2.2: automatic motion stops within 5 s;
export const PULSE_MS = 1400;

// Straight-line distance in km from the start to the pad, from the scenario and its cell size.
export function padDistanceKm(scenario, cellM) {
  return distanceKm(scenario.start, scenario.pad, cellM);
}

// The hint is on for HINT_MS after it starts.
export function hintActive(elapsedMs) {
  return elapsedMs >= 0 && elapsedMs < HINT_MS;
}

// Phase 0..1 of the pulse; reduced motion freezes it (the fixed guide line is drawn, no pulse).
export function pulsePhase(elapsedMs, reduced) {
  return reduced ? 0 : (elapsedMs % PULSE_MS) / PULSE_MS;
}

// Start/stop/tick state of the hint, with the clock and timers injected so it can be tested with fake time.
// Reduced motion: the fixed hint is drawn once and a timer only waits for it to end.
export function createHint({ now, isReduced, raf, cancelRaf, setTimer, clearTimer, onFrame, onStart }) {
  let t0 = null;
  let rafId = 0;
  let timerId = 0;
  // Separate ids: rAF and setTimeout ids are numbered apart, so each is cancelled with its own function.
  const clearTimers = () => { cancelRaf(rafId); clearTimer(timerId); };
  function stop() {
    if (t0 === null) return;
    t0 = null;
    clearTimers();
    onFrame();
  }
  function tick() {
    if (t0 === null) return;
    const elapsed = now() - t0;
    if (!hintActive(elapsed)) return stop();
    onFrame();
    if (isReduced()) timerId = setTimer(tick, HINT_MS - elapsed);
    else rafId = raf(tick);
  }
  function start() {
    clearTimers();
    t0 = now();
    onStart();
    tick();
  }
  return { start, stop, active: () => t0 !== null, elapsed: () => now() - t0 };
}
