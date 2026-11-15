// Longest stretch without the Earth (R6) of a mission field. Empty means no limit, and then R6 is off: the domain
// only turns it on with a finite number (planner/src/ranking.js). Read as 0, every mission that loses the Earth for
// a single hour would fail, and Replan would contradict Plan and Advanced.
export const earthGapOf = v => (v == null || String(v).trim() === '' || !Number.isFinite(+v) ? undefined : Math.max(0, +v));

/** Whether the mission limits the hours without the Earth. */
export const hasEarthGap = h => Number.isFinite(h);
