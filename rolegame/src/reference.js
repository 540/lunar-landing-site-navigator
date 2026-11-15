// Reference route of the end (J7.3): how the solver (pipeline/game-solver.mjs, J9.1) won this level. The route
// is drawn as it comes in solver.json; its figures come from replaying the solver's actions with the very same
// engine, which also checks that the client and the solver agree. Pure: no DOM, no fetch.
import { newGame, move, wait, transmit } from './engine/index.js';

// { route, actions, timeMarginH } of a level, or null when the file lacks it, it is not winnable or it lacks
// the route or the actions.
export function referenceFor(solverJson, levelId) {
  const entry = solverJson?.[levelId];
  if (!entry || entry.winnable !== true) return null;
  if (!Array.isArray(entry.route) || entry.route.length === 0 || !Array.isArray(entry.actions)) return null;
  return { route: entry.route, actions: entry.actions, timeMarginH: entry.timeMarginH };
}

// Final state of playing the reference actions from a new game, without the event of the level (J6.4: event null).
export function replayReference(scenario, level, tables, reference) {
  let s = newGame(scenario, level, tables, { event: null });
  for (const a of reference.actions) {
    if (s.over) break;
    if (a.type === 'move') s = move(s, a.path);
    else if (a.type === 'wait') s = wait(s, a.hours);
    else if (a.type === 'transmit') s = transmit(s);
    else throw new RangeError(`unknown action ${a.type}`);
  }
  return s;
}

const clockOf = (t) => {
  const h = Math.floor(t);
  return { day: Math.floor(h / 24) + 1, hour: h % 24 };
};

// The two columns of the table: lowest battery (whole percent) and the arrival with the panel clock.
export function compareWithReference(state, replayed) {
  return {
    player: { minBattery: Math.floor(state.minBattery ?? state.battery), ...clockOf(state.t), arrived: state.over === 'win' },
    solver: { minBattery: Math.floor(replayed.minBattery), ...clockOf(replayed.t) },
  };
}
