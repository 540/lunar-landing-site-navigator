// Geometry of the horizon ring (E1.1, #122): the 360° horizon around the flag seen from above, north up and east to the
// right (azimuth of the API: from local north towards east). Pure: it returns numbers and SVG path strings, no DOM.
// Elevation is the distance to the centre, as in a sky chart: the higher, the closer to the centre. The scale is not
// linear (asinh): around 0° a degree takes many pixels, so the profile and the Sun, which barely leave ±2° at the pole,
// can be read, while the Earth (up to ~10°) still fits.

export const RING = Object.freeze({
  size: 200, // side of the viewBox
  centre: 100,
  horizonR: 64, // radius of elevation 0°
  gain: 15, // pixels per unit of asinh
  scaleDeg: 1.5, // elevation at which the scale stops being linear
  minR: 14, // the zenith side ends here
  maxR: 94, // the ground side ends here
});

const D2R = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Distance to the centre (viewBox units) of an elevation in degrees. */
export const radiusFor = el => clamp(RING.horizonR - RING.gain * Math.asinh(el / RING.scaleDeg), RING.minR, RING.maxR);

/** Point of the ring for an azimuth and an elevation (degrees). */
export function ringPoint(az, el) {
  const r = radiusFor(el);
  return { x: RING.centre + r * Math.sin(az * D2R), y: RING.centre - r * Math.cos(az * D2R) };
}

const fmt = n => Math.round(n * 100) / 100;

/** One point per azimuth of the mask, as is: azimuth k · stepDeg, elevation el[k]. No resampling. */
export const profilePoints = mask => Array.from(mask.el, (el, k) => ringPoint(k * mask.stepDeg, el));

/** Closed path of the sky seen over the profile of the mask. */
export function profilePath(mask) {
  return profilePoints(mask).map((p, k) => `${k ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join('') + 'Z';
}

/** Circle of an elevation, as a path (for the 0°, 5° and 10° guides). */
export function circlePath(el) {
  const r = fmt(radiusFor(el)), c = RING.centre;
  return `M${c - r} ${c}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

/**
 * Path of a body over the period, one dot every `everyH` hours, split in two: where it is seen (visibleFraction > 0) and
 * where it is not. Each dot is a zero-length segment: with round caps it is drawn as a dot.
 */
export function trailPaths(series, body, start, days, everyH = 2) {
  const step = Math.max(1, Math.round(everyH * 60 / series.stepMinutes));
  const first = Math.round((start.getTime() - Date.parse(series.start)) / (series.stepMinutes * 60e3));
  const last = Math.min(series.count - 1, first + Math.round(days * 24 * 60 / series.stepMinutes));
  const b = series[body];
  let seen = '', hidden = '';
  for (let i = Math.max(0, first); i <= last; i += step) {
    const p = ringPoint(b.az[i], b.el[i]);
    const dot = `M${fmt(p.x)} ${fmt(p.y)}h0`;
    if (b.visibleFraction[i] > 0) seen += dot; else hidden += dot;
  }
  return { seen, hidden };
}

/** Wedge of the camera: what the scene shows, as a sector of the ring from `az - half` to `az + half`. */
export function wedgePath(az, halfDeg) {
  const half = clamp(halfDeg, 1, 179);
  const a = ringPoint(az - half, -90), b = ringPoint(az + half, -90); // -90°: the outer edge
  const r = fmt(RING.maxR), c = RING.centre;
  return `M${c} ${c}L${fmt(a.x)} ${fmt(a.y)}A${r} ${r} 0 ${half > 90 ? 1 : 0} 1 ${fmt(b.x)} ${fmt(b.y)}Z`;
}
