// The landing timeline of Plan (#132), without the DOM: its span, hours ↔ positions, the verdict of each landing day
// and the Sun area. The verdicts come from the mission service; this only places and groups them.

const HOUR_MS = 36e5, DAY_MS = 864e5;
const dayOf = t => Math.floor(t / DAY_MS) * DAY_MS;

/**
 * What the timeline covers: from the first day of the searched window to its last day plus one mission, widened to
 * the landing on screen if it falls outside. { start, landingDays, totalHours, lastLanding }: landings go from
 * `start` to `lastLanding` (the last hour of the last landing day); the rest of the span is only mission.
 */
export function timelineSpan({ from, to, days, t0 }) {
  const start = dayOf(Math.min(from, t0 ?? from));
  const lastDay = dayOf(Math.max(to, t0 ?? to));
  const landingDays = Math.round((lastDay - start) / DAY_MS) + 1;
  return { start, landingDays, totalHours: (landingDays + days) * 24, lastLanding: lastDay + DAY_MS - HOUR_MS };
}

/** Position of an instant on the span, from 0 (start) to 1 (end), unclamped. */
export const fractionOf = (t, span) => (t - span.start) / (span.totalHours * HOUR_MS);

/** Landing under a position (0–1) of the span: snapped to the hour and kept between the first and the last landing. */
export function landingAt(fraction, span) {
  const t = span.start + Math.round(fraction * span.totalHours) * HOUR_MS;
  return clampLanding(t, span);
}

export const clampLanding = (t, span) => Math.max(span.start, Math.min(span.lastLanding, t));

/**
 * The mission window over the rows, as shares of the span: { x, w } from the landing `t` for `days` days. The window,
 * its bar and the preview of another landing all take it, so they line up; it never leaves the span (0 ≤ x, x + w ≤ 1).
 */
export function missionWindow(t, days, span) {
  const x = Math.max(0, Math.min(1, fractionOf(t, span)));
  return { x, w: Math.max(0, Math.min(1 - x, (days * 24) / span.totalHours)) };
}

/**
 * Landing after a key on the mission bar: arrows move it an hour (with Shift, a day); Home and End go to the first
 * and the last landing. null for any other key.
 */
export function landingForKey(t0, key, shift, span) {
  const step = shift ? DAY_MS : HOUR_MS;
  const to = { ArrowRight: t0 + step, ArrowUp: t0 + step, ArrowLeft: t0 - step, ArrowDown: t0 - step, Home: span.start, End: span.lastLanding }[key];
  return to === undefined ? null : clampLanding(to, span);
}

/**
 * Verdict of a landing day as the date picker gives it (landingDays of the mission service, one site): it works if
 * some hour works; it is «justo» if none works but some is marginal; otherwise it does not work.
 */
export function dayVerdict(own) {
  if (!own) return null;
  return own.viable ? 'viable' : own.marginal ? 'marginal' : 'not_viable';
}

/** Hour a day lands at when it is picked: its first viable slot, else its first marginal one, else its first one. */
export function dayLanding(own) {
  return (own.slots.find(x => x.code === 'viable') ?? own.slots.find(x => x.code === 'marginal') ?? own.slots[0]).t;
}

/** Consecutive days with the same verdict, as runs: [{ code, from, to }] with from and to the indexes of the days. */
export function verdictRuns(codes) {
  const runs = [];
  codes.forEach((code, i) => {
    const last = runs[runs.length - 1];
    if (last && last.code === code) last.to = i;
    else runs.push({ code, from: i, to: i });
  });
  return runs;
}

/**
 * The Sun row: one height per hour, the Sun's elevation over the terrain in degrees. An hour without the Sun in the
 * verdict's windows (`visible[h]` false) is 0 whatever the drawn sky says, so the area and the verdict never disagree;
 * an hour with it is at least `floor`, so a Sun grazing the terrain still shows. Without the hourly sky (`series`
 * null), every hour with the Sun takes `floor`.
 */
export function sunHeights(visible, series, floor = 0.1) {
  return Array.from(visible, (v, h) => (v ? Math.max(floor, series?.[h]?.sun.margin ?? floor) : 0));
}

/**
 * SVG path of an area under `heights` (one per hour), `width` hours wide and `height` high, with `top` the value at
 * the top. Each hour is a flat step, so an hour with the Sun covers its whole width; hours at 0 draw nothing.
 */
export function areaPath(heights, height, top) {
  let d = '';
  for (let h = 0; h < heights.length; h++) {
    if (!heights[h]) continue;
    let k = h;
    d += `M${h} ${height}`;
    for (; k < heights.length && heights[k]; k++) {
      const y = +(height - (Math.min(heights[k], top) / top) * height).toFixed(2);
      d += `L${k} ${y}L${k + 1} ${y}`;
    }
    d += `L${k} ${height}Z`;
    h = k;
  }
  return d;
}

/** Runs of hours with a body in sight, as [from, to) hour pairs, to draw them as bars. */
export function visibleRuns(visible) {
  const out = [];
  for (let h = 0; h < visible.length; h++) {
    if (!visible[h]) continue;
    let k = h;
    while (k < visible.length && visible[k]) k++;
    out.push([h, k]);
    h = k;
  }
  return out;
}

/**
 * When the problem a verdict reason talks about starts, if it is the longest shadow or the longest gap without the
 * Earth (the result fields of the mission service). null for any other reason, or for several.
 */
export function reasonStart(reason, r) {
  if (reason.includes(';')) return null; // several reasons: the date would belong to only one of them
  if (/sin Tierra/i.test(reason)) return r.longestEarthOutageStart ?? null;
  if (/sombra/i.test(reason)) return r.longestShadowStart ?? null;
  return null;
}

/** The first of several reasons joined with «; » (a verdict that fails more than one rule) and how many more there are. */
export function firstReason(reason) {
  const all = reason.split('; ');
  return { text: all[0], more: all.length - 1 };
}
