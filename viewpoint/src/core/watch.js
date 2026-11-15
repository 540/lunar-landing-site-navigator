// The watch on your left wrist (E3, #181): what its screen says, from the same pure functions as the panel «Luz y Tierra
// en la bandera» of E1 (#121, core/sky-state.js). Pure: no DOM, no canvas.
import { fractionAt, sunState, earthState, nextChange, periodMetrics } from './sky-state.js';

const DAY_MS = 86400e3;

/**
 * @param {object} series series-2027.json (with visibleFraction)
 * @param {Date} date the instant of the timeline
 * @param {Date} start the start of the period of the timeline
 * @param {number} days its length
 * @returns {{sun:{state:string, change:object, fraction:number}, earth:{state:string, change:object, fraction:number},
 *   metrics:object}} change: nextChange of sky-state.js (a set or a rise and its hours, or none)
 */
export function watchReadout(series, date, start, days) {
  const until = new Date(start.getTime() + days * DAY_MS);
  const body = (name, stateOf) => {
    const fraction = fractionAt(series, name, date);
    return { state: stateOf(fraction), fraction, change: nextChange(series, name, date, until) };
  };
  return { sun: body('sun', sunState), earth: body('earth', earthState), metrics: periodMetrics(series, start, days) };
}

/** Hours as the watch says them: "45 min", "14 h", "3 d 2 h". */
export function shortDuration(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  const d = Math.floor(hours / 24), h = Math.round(hours - d * 24);
  return h ? `${d} d ${h} h` : `${d} d`;
}
