// Pure decision of what a tap does: asks the engine for a route and says whether its result must be applied.
import { move, pathTo } from './engine/index.js';

export const NO_PATH = 'no-path';

// The state with its event hidden while it has not happened yet (J6.4); the same state otherwise.
export const withoutPendingEvent = (state) => (state.event && !state.event.done ? { ...state, event: null } : state);

// Returns the new state, NO_PATH when the target cannot be reached, or null when the tap changes
// nothing (game over, or no step and no end).
export function applyTap(state, target) {
  if (state.over) return null;
  const path = pathTo(state, target);
  if (path === null) return NO_PATH;
  const next = move(state, path);
  // A move can end the game before entering its first cell (battery or deadline during the half step).
  if (!next.over && next.route.length === state.route.length) return null;
  return next;
}

// What the screen must show after a tap: the warning for the panel (empty when none applies) and
// the text for the aria-live region (null when the tap announces nothing by itself).
export function tapFeedback(result, level, texts) {
  if (result === NO_PATH) {
    const warning = texts.noPath(level.maxSlope);
    return { warning, announcement: warning };
  }
  return { warning: '', announcement: null };
}

// ---- Plan before driving (J1.2) ----

export const MAX_MOVE_MS = 1800;
export const MOVE_MS_PER_CELL = 90;

// Animation length for a route of `cells` steps: never longer than MAX_MOVE_MS, however long the route,
// and 0 with reduced motion (J10.2): the rover appears at its destination.
export const moveDurationMs = (cells, { reduced = false } = {}) =>
  (reduced ? 0 : Math.min(Math.max(cells, 0) * MOVE_MS_PER_CELL, MAX_MOVE_MS));

// Progress 0..1 of an animation. The first requestAnimationFrame timestamp can be earlier than the
// performance.now() taken when it started, so it is clamped at 0 too (a negative value broke the move).
export const animationProgress = (now, t0, total) => Math.min(Math.max((now - t0) / total, 0), 1);

// Colour of the preview: 'depleted' (red) when the battery or the deadline ends the game on the way, 'low' (yellow) when the
// rover arrives below the minimum to lift off, null otherwise.
export function previewSeverity(preview, level) {
  if (preview.over === 'battery' || preview.over === 'time' || preview.batteryEnd <= 0) return 'depleted';
  if (preview.batteryEnd < level.minBat) return 'low';
  return null;
}

// Red or yellow warning of a preview (empty when none applies). Running out of time wins over the battery.
export function previewAlert(preview, level, texts) {
  if (preview.over === 'time') return texts.previewTime;
  if (preview.severity === 'depleted') return texts.previewDepleted;
  if (preview.severity === 'low') return texts.previewLow(level.minBat);
  return '';
}

// Text for the aria-live region when a plan appears. A battery-depleted preview already says so, so it
// does not repeat the alert; time-over and low previews append it.
export function previewAnnouncement(preview, level, texts) {
  const depleted = preview.severity === 'depleted' && preview.over !== 'time';
  const base = depleted
    ? texts.livePreviewDepleted(preview.km, preview.hours)
    : texts.livePreview(preview.km, preview.hours, preview.batteryEnd);
  const alert = previewAlert(preview, level, texts);
  return alert && !depleted ? `${base}. ${alert}` : base;
}

// What Enter (or Space) does with the cursor on a cell: drive when it is the planned cell, plan otherwise.
export function enterAction(plan, cursor) {
  return plan && plan.target.x === cursor.x && plan.target.y === cursor.y ? 'drive' : 'plan';
}

// Runs the route on a copy of the state (move is pure) and describes the difference. Returns NO_PATH,
// null when the tap changes nothing, or a plan { target, path, next, preview }. The state is not touched.
export function planRoute(state, target, cellM) {
  // The preview never gives away the pending event (J6.4): it simulates as if there were none
  // (prototype, sim.evAt = 1e9). «Conducir» runs the real move, event included.
  const next = applyTap(withoutPendingEvent(state), target);
  if (next === null || next === NO_PATH) return next;
  const path = pathTo(state, target);
  // The engine stops where the battery or the deadline runs out, so km counts only the stretch really driven.
  const driven = next.route.slice(state.route.length - 1);
  let km = 0;
  for (let i = 1; i < driven.length; i++) {
    km += Math.hypot(driven[i].x - driven[i - 1].x, driven[i].y - driven[i - 1].y) * cellM / 1000;
  }
  const preview = {
    km,
    hours: next.t - state.t,
    batteryNow: state.battery,
    batteryEnd: next.battery,
    arrival: { x: next.x, y: next.y },
    over: next.over,
  };
  preview.severity = previewSeverity(preview, state.level);
  return { target: { x: target.x, y: target.y }, path, next, preview };
}

// What a player action does, given the state and the current plan (or null):
//   tap    -> plans (replaces any previous plan); the state does not change
//   drive  -> applies the plan: returns its resulting state and clears the plan
//   cancel -> drops the plan; the state stays as it was
// Returns { plan, drive, feedback } where drive is the state to animate to (or null) and feedback is
// the tapFeedback of a tap.
export function decideAction(state, plan, action, level, texts, cellM) {
  if (action.type === 'tap') {
    const result = planRoute(state, action.target, cellM);
    const feedback = tapFeedback(result, level, texts);
    if (result === NO_PATH) return { plan: null, drive: null, feedback };
    // A tap that leaves no plan (the rover's own cell) drops the previous one: say so.
    if (result === null && plan) feedback.announcement = texts.liveCancelled;
    return { plan: result, drive: null, feedback };
  }
  if (action.type === 'drive' && plan) {
    return { plan: null, drive: move(state, plan.path), feedback: { warning: '', announcement: null } };
  }
  return { plan: null, drive: null, feedback: { warning: '', announcement: null } };
}
