// State of the mission viewer at an instant (V1.2, #73). Pure: no DOM, no three.js.
// Rule of truth of the V1 epic: the scene illustrates, it does not decide. Light or shadow and Earth yes or no come from
// the visibility windows of the mission service (visibleAt), the same as the verdict; never from the shadow map.
// The direction of the Sun and the Earth comes from the sky of the same service (the same source as those windows).
const HOUR_MS = 36e5;
const norm360 = deg => ((deg % 360) + 360) % 360;
const lerp = (a, b, f) => a + (b - a) * f;
const lerpAz = (a, b, f) => norm360(a + (((b - a + 540) % 360) - 180) * f);

/**
 * How far (degrees) the lower edge of a drawn disc may be on the wrong side of the horizon before it counts as a
 * contradiction of the windows (#192): it covers the rounding and the hourly interpolation of the sky series at the exact
 * instant of a crossing, such as the jumps to the longest shadow and Earth outage, which fall right on one.
 */
export const MISMATCH_TOLERANCE_DEG = 0.15;

/**
 * A body of the hour-by-hour sky ({ az, el, horizon, margin, fullMargin } every hour from t0) at any instant,
 * interpolated. `margin` is that of the disc centre; `fullMargin`, that of its lower edge (the `full` criterion of the
 * windows); a sky without it uses `margin`. Outside the series it holds the first or the last sample.
 */
export function bodyAt(series, t0, t, body) {
  if (!series?.length) return null;
  const pos = Math.min(series.length - 1, Math.max(0, (t - t0) / HOUR_MS));
  const i = Math.min(Math.floor(pos), Math.max(0, series.length - 2)), f = series.length > 1 ? pos - i : 0;
  const a = series[i][body], b = series[Math.min(i + 1, series.length - 1)][body];
  const full = x => x.fullMargin ?? x.margin;
  return {
    az: lerpAz(a.az, b.az, f), el: lerp(a.el, b.el, f), horizon: lerp(a.horizon, b.horizon, f),
    margin: lerp(a.margin, b.margin, f), fullMargin: lerp(full(a), full(b), f),
  };
}

/**
 * What the viewer shows at `t`: the state from the windows (`sun`, `earth`: visible or not), the directions to draw,
 * and `mismatch`, the bodies whose drawn position contradicts that state by more than MISMATCH_TOLERANCE_DEG: seen
 * with the lower edge of the disc under the horizon, or not seen with it over (the windows count a body as visible when
 * the whole disc is up, #192). Then the state wins and the scene says so.
 */
export function missionFrame(service, site, sky, t0, t) {
  const seen = service.visibleAt(site, t) ?? { sun: false, earth: false };
  const sun = bodyAt(sky?.series, t0, t, 'sun'), earth = bodyAt(sky?.series, t0, t, 'earth');
  const contradicts = (drawn, visible) => (visible ? drawn.fullMargin < -MISMATCH_TOLERANCE_DEG : drawn.fullMargin > MISMATCH_TOLERANCE_DEG);
  const mismatch = [];
  if (sun && contradicts(sun, seen.sun)) mismatch.push('sun');
  if (earth && contradicts(earth, seen.earth)) mismatch.push('earth');
  return { t, sun: seen.sun, earth: seen.earth, sunDir: sun, earthDir: earth, mismatch };
}

/**
 * Battery (0 to 1) at `t` from the mission timeline of the service ({ steps, stepMs, emptyAtMs }): the step that holds
 * `t`. `empty` once the instant the battery runs out has passed (it only exists when R4 fails).
 */
export function batteryAt(timeline, t0, t) {
  if (!timeline?.steps.length) return null;
  const i = Math.min(timeline.steps.length - 1, Math.max(0, Math.floor((t - t0) / timeline.stepMs)));
  const empty = timeline.emptyAtMs !== null && t >= timeline.emptyAtMs;
  return { level: empty ? 0 : timeline.steps[i].battery, empty };
}
