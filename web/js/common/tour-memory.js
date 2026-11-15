// What the guided tour remembers in this browser (localStorage, per origin, shared by every screen of the site):
// which tours have been seen, and whether the user asked for no more automatic tours (#205).
// No DOM here, so it is tested with node (web/test/tour-memory.test.js). Without storage (private mode) nothing
// is remembered and the tours behave as on a first visit.
export const SEEN_KEY = 'llsn.tour.seen';
export const DISABLED_KEY = 'llsn.tour.disabled';

const storage = () => globalThis.localStorage;

export function seenViews() {
  try { return JSON.parse(storage().getItem(SEEN_KEY)) || {}; } catch { return {}; }
}
export function markSeen(view) {
  try { storage().setItem(SEEN_KEY, JSON.stringify({ ...seenViews(), [view]: true })); } catch { /* private mode: the tour just shows again */ }
}

// «No mostrar más tutoriales»: no tour opens by itself any more, on any screen. The «Tutorial» buttons still work.
export function autoToursDisabled() {
  try { return storage().getItem(DISABLED_KEY) === '1'; } catch { return false; }
}
export function disableAutoTours() {
  try { storage().setItem(DISABLED_KEY, '1'); } catch { /* private mode: nothing to remember */ }
}

// Whether the tour of that id opens by itself: only the first time, and never once the user has turned them off.
export const shouldAutoStart = id => !autoToursDisabled() && !seenViews()[id];
