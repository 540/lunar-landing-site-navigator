// Pure decisions of the wait buttons (J2.1): which ones are enabled, what each one asks the engine,
// how long the animation lasts and what the screen reader hears. No DOM here.
import { wait } from './engine/index.js';
import { MAX_MOVE_MS } from './tap.js';
import { endAnnouncement } from './end.js';

export const WAIT_MS_PER_HOUR = 150;
export const UNTIL_SUN_MAX_H = 24;
export const UNTIL_EARTH_MAX_H = 24;

// The four buttons, in panel order: id, text key and the call to the engine.
export const WAIT_ACTIONS = [
  { id: 'wait-2', label: 'wait2', run: (s) => wait(s, 2) },
  { id: 'wait-6', label: 'wait6', run: (s) => wait(s, 6) },
  { id: 'wait-sun', label: 'waitSun', run: (s) => wait(s, UNTIL_SUN_MAX_H, { untilSun: true }) },
  { id: 'wait-earth', label: 'waitEarth', run: (s) => wait(s, UNTIL_EARTH_MAX_H, { untilEarth: true }) },
];

// True when the rover's cell has Sun now (same threshold as the engine: more than half the disc).
export const hasSun = (state) => state.tables.sunFrac(state.y * state.tables.n + state.x, state.t) > 0.5;

// True when the rover's cell sees the Earth now (earth.bin, J3.3).
export const hasEarth = (state) => state.tables.seesEarth(state.y * state.tables.n + state.x, state.t);

// Which buttons are disabled: all while a route is planned, the rover moves or the game is over;
// «Hasta tener sol» also when the cell already has Sun, «Hasta ver la Tierra» when it already sees
// the Earth. Returns { [id]: boolean }.
export function waitDisabled(state, { planned, busy }) {
  const blocked = Boolean(planned || busy || state.over);
  return {
    'wait-2': blocked,
    'wait-6': blocked,
    'wait-sun': blocked || hasSun(state),
    'wait-earth': blocked || hasEarth(state),
  };
}

// Animation length for `hours` of waiting: proportional, never longer than MAX_MOVE_MS, 0 with reduced motion.
export const waitDurationMs = (hours, reduced = false) =>
  reduced ? 0 : Math.min(Math.max(hours, 0) * WAIT_MS_PER_HOUR, MAX_MOVE_MS);

// Text for the aria-live region once the wait ends: hours waited, battery and clock, or the end of the game.
// After «Hasta ver la Tierra» (untilEarth) without the Earth in sight, it adds that it will not show up.
export function waitAnnouncement(before, after, texts, { untilEarth = false } = {}) {
  if (after.over) return endAnnouncement(after, texts);
  const h = Math.floor(after.t);
  const text = texts.liveWaited(after.t - before.t, Math.floor(after.battery), Math.floor(h / 24) + 1, h % 24);
  return untilEarth && !hasEarth(after) ? `${text}. ${texts.noEarthSoon(UNTIL_EARTH_MAX_H)}` : text;
}
