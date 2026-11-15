// Keyboard and screen reader on the map (J10.3, #244): what a cell is like without seeing it, and which shortcut a
// key press asks for. Pure: it reads the tables and the scenario; no DOM here.

// Straight-line distance between two cells, in km.
export const distanceKm = (a, b, cellM) => (Math.hypot(b.x - a.x, b.y - a.y) * cellM) / 1000;

// Direction from `from` to `to` on the 8-point compass, by the signs of the offsets (same rule as liveStart):
// 'n', 'ne', 'e', 'se', 's', 'so', 'o', 'no', or '' on the same cell. North is −y on the map.
export function compassDir(from, to) {
  const ns = to.y < from.y ? 'n' : to.y > from.y ? 's' : '';
  const ew = to.x > from.x ? 'e' : to.x < from.x ? 'o' : '';
  return ns + ew;
}

// What the cursor cell is like at `hour`: column and row (from 1), Sun (the threshold of loadSun and loadDark),
// Earth (earth.bin through `seesEarth(cellIndex, hour)`, or null when there is no Earth to report), and how far
// and in which direction the pad is.
// `nearSent(cell)` (J3.6): true when a package already went from less than level.txMinKm away; then `canSend`
// is false even with the Earth in sight.
// `earthIn(cellIndex, hour)` (#382): hours until the cell sees the Earth (within the forecast), or null; only asked
// when the Earth is reported and not in sight now.
export function cellReport({ tables, seesEarth = null, scenario, cell, hour, nearSent = null, earthIn = null }) {
  const i = cell.y * tables.n + cell.x;
  const earth = seesEarth ? Boolean(seesEarth(i, hour)) : null;
  return {
    earthIn: earth === false && earthIn ? earthIn(i, hour) : null,
    nearSent: earth && nearSent ? Boolean(nearSent(cell)) : false,
    col: cell.x + 1,
    row: cell.y + 1,
    lit: tables.sunFrac(i, hour) > 0.5,
    earth,
    padKm: distanceKm(cell, scenario.pad, scenario.grid?.cellM ?? tables.cellM),
    padDir: compassDir(cell, scenario.pad),
  };
}

// Shortcuts with the focus on the map, as in the mock-up of the epic map (J13): T, 2, 6, S, E, L, O and R. P and ?
// stay from J10.3; the cursor to the rover moved from R (now the mission status) to C. No Ctrl, Cmd or Alt, so the
// browser and the screen reader keep theirs. The same keys in every language.
export const SHORTCUTS = {
  transmit: 'T',
  'wait-2': '2',
  'wait-6': '6',
  'wait-sun': 'S',
  'wait-earth': 'E',
  'earth-layer': 'L',
  goal: 'O',
  status: 'R',
  'cursor-rover': 'C',
  'cursor-pad': 'P',
  help: '?',
};

const BY_KEY = Object.fromEntries(Object.entries(SHORTCUTS).map(([action, key]) => [key.toLowerCase(), action]));

// Action of a key press ({ key, shiftKey, ctrlKey, metaKey, altKey }), or null. Shift does not change the action.
export function keyAction(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return null;
  return BY_KEY[String(ev.key).toLowerCase()] ?? null;
}

// What «R» reads out (J13): battery, clock, packets, and whether the rover's cell has Sun and sees the Earth now
// (the Earth only while its layer is shown, as with the cursor). Pure: the caller passes the state and tables.
export function missionStatus(state, { earthShown = true } = {}) {
  const { tables, level } = state;
  const i = state.y * tables.n + state.x;
  const h = Math.floor(state.t);
  return {
    battery: Math.floor(state.battery),
    minBat: level.minBat,
    day: Math.floor(h / 24) + 1,
    hour: h % 24,
    hoursLeft: Math.max(0, Math.floor(level.deadline - state.t)),
    sent: state.sent,
    need: level.need,
    lit: tables.sunFrac(i, state.t) > 0.5,
    earth: earthShown ? tables.seesEarth(i, state.t) : null,
  };
}

/** Ms between two cell readings while driving from the cabin (J12.6): at most one a second. */
export const CELL_ANNOUNCE_MS = 1000;
/** Whether a new cell may be read aloud now, given when the last one was. */
export const cellAnnounceDue = (lastMs, nowMs, gapMs = CELL_ANNOUNCE_MS) => nowMs - lastMs >= gapMs;
