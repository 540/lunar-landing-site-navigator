// Energy hint (J2.4): in shadow with a low battery, the panel tells the player to seek light or wait.
// Pure: no DOM here.
import { hasSun } from './wait.js';

// Below this percentage, a rover in shadow gets the hint (prototype rule, hint()).
export const LOW_BATTERY = 60;

// 'shadow-low' when the game is on, the rover's cell has no Sun now (sunFrac <= 0.5) and the
// battery is below LOW_BATTERY; null otherwise.
export function energyHint(state) {
  if (state.over) return null;
  return !hasSun(state) && state.battery < LOW_BATTERY ? 'shadow-low' : null;
}

// The screen reader hears the hint once each time it appears, not on every repaint.
export const announceHint = (previous, next) => next !== null && next !== previous;
