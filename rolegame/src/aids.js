// Help by level (J6.5): which hints and Earth tools each difficulty gives. Pure: no DOM here.
// The hints themselves are those of J3 (missionHint); this only decides whether they show.
import { missionHint } from './mission-hint.js';

// null when the level gives no hints (expert); otherwise the mission hint. The text depends on the layer
// (missionHintText), so it is passed along for the caller.
export function levelHint(state, level, { earthLayer } = {}) {
  void earthLayer;
  return level.hints === false ? null : missionHint(state);
}

// The «Tierra visible» button only exists where the level lets the player switch the layer.
export const earthToggleShown = (level) => level.earth === 'toggle';
