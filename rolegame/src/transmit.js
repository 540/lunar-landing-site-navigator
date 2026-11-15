// Pure decisions of the «Transmitir» button and the packages in the panel (J3.1). No DOM here.
import { transmit, transmitHours, nearSent } from './engine/index.js';
import { waitDurationMs } from './wait.js';
import { endAnnouncement } from './end.js';

// True when the Earth is in sight from the rover's cell now (read from earth.bin, never computed).
export const seesEarthNow = (state) => state.tables.seesEarth(state.y * state.tables.n + state.x, state.t);

// «Transmitir · 1 h · −2 %»: hours and extra battery of the level (the usual load of those hours goes apart).
// With a state, the hours are those of now: doubled during an antenna fault (J6.4).
export const transmitLabel = (level, texts, state = null) => texts.transmit(state ? transmitHours(state) : level.txT, level.txE);

// Disabled while a route is planned, the rover moves or the game is over, when every package is sent,
// when the rover's cell does not see the Earth now and when a package already went from less than
// level.txMinKm away (J3.6).
export function transmitDisabled(state, { planned, busy }) {
  return Boolean(planned || busy || state.over) || state.sent >= state.level.need || !seesEarthNow(state) || nearSent(state);
}

// Why «Transmitir» is off although the Earth is in sight (J3.6): 'near-sent' when a package already went from
// this zone; null otherwise (the other reasons need no words: the blue layer and the counter say them).
export function transmitBlock(state) {
  if (state.over || state.sent >= state.level.need || !seesEarthNow(state)) return null;
  return nearSent(state) ? 'near-sent' : null;
}

// Why «Transmitir» is off, in the same order as transmitDisabled (null when it is on): 'over', 'planned', 'busy',
// 'all-sent', 'no-earth' (the rover's cell does not see the Earth now, earth.bin) or 'near-sent' (a package already
// went from less than level.txMinKm away). The cabin says it next to the button (J12).
export function transmitReason(state, { planned, busy }) {
  if (state.over) return 'over';
  if (planned) return 'planned';
  if (busy) return 'busy';
  if (state.sent >= state.level.need) return 'all-sent';
  if (!seesEarthNow(state)) return 'no-earth';
  if (nearSent(state)) return 'near-sent';
  return null;
}

// The engine call and the animation length (same pace as waiting).
export const runTransmit = (state) => transmit(state);
export const transmitDurationMs = (level, reduced = false, state = null) => waitDurationMs(state ? transmitHours(state) : level.txT, reduced);

// Packages still missing when the rover is at ASCENSO with enough battery (so the game goes on); 0 otherwise.
export function missingPackets(state) {
  const { level, scenario } = state;
  if (state.over || state.x !== scenario.pad.x || state.y !== scenario.pad.y) return 0;
  if (state.battery < level.minBat) return 0;
  return Math.max(0, level.need - state.sent);
}

// Text for the aria-live region once a transmission ends: package count, battery and clock, or the end.
export function transmitAnnouncement(before, after, texts) {
  if (after.over) return endAnnouncement(after, texts);
  const h = Math.floor(after.t);
  return texts.liveSent(after.sent, after.level.need, Math.floor(after.battery), Math.floor(h / 24) + 1, h % 24);
}
