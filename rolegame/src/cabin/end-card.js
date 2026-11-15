// The end card of the cabin (#398): how the cabin tells the player that the game is over. The end panel lives beside
// the map, outside the stack that goes full screen, so in full screen nobody saw it: after the lift-off the view went
// back to the horizon and the game simply stopped. Pure decisions here (when the card shows and what it says); the
// DOM is in panel.js.
import { LAUNCH_MS } from './launch.js';

/** When the card shows, ms after the end: after the whole lift-off (the stage already a dot among the stars), after a
 *  look at the still frame with reduced motion, or almost at once when the game is lost. */
export const END_CARD_MS = { play: LAUNCH_MS + 800, still: 2200, lost: 900 };

/**
 * Delay before the card for a game state `over` and the cabin's launch plan ('play' | 'still' | null, launchPlan),
 * or null when the game is not over. A win with no plan (the lift-off already shown) is a still frame.
 */
export function endCardDelay({ over, plan }) {
  if (!over) return null;
  if (over !== 'win') return END_CARD_MS.lost;
  return plan === 'play' ? END_CARD_MS.play : END_CARD_MS.still;
}

/**
 * What the cabin does when the end comes: on a win, after the lift-off it leaves full screen and goes straight to the
 * result (the map with the end panel), because coming back to the rover with a card over it felt like an anticlimax;
 * on a loss there is no animation, so the card tells what happened over the cabin. 'result' | 'card'.
 */
export const endStep = (over) => (over === 'win' ? 'result' : 'card');

/**
 * What the card says for a finished game (`over` and the figures of end.js's endSummary): { kind, kicker, title, why,
 * actions }. `actions` lists the buttons in order,
 * the first one the main one (it gets the focus): 'result' (the end panel with the illumination map), 'replay' (the
 * lift-off again, only on a win), 'again' (a new game) and 'close' (keep looking at the cabin).
 */
export function endCard(over, summary, texts) {
  const win = over === 'win';
  const end = texts.end[over];
  return {
    kind: win ? 'win' : 'lost',
    kicker: win ? texts.cabinEndWin : texts.cabinEndLost,
    title: end.title,
    why: end.why(summary),
    actions: win ? ['result', 'replay', 'again', 'close'] : ['result', 'again', 'close'],
  };
}

/** Label of each action of the card. */
export function endCardLabel(action, texts) {
  return { result: texts.cabinEndResult, replay: texts.liftoffReplay, again: texts.playAgain, close: texts.cabinEndClose }[action];
}
