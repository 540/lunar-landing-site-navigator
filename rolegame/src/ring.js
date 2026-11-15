// Horizon ring (J3.4): the mask of the rover's cell and the Sun and Earth series in the shape of the sky
// compass of Plan (web/js/common/sky-polar.js), and the bearing marks on the map border. Pure: it reads
// masks.bin and series.json (both from the pipeline) and never recomputes horizons or ephemerides.

export const MASK_AZIMUTHS = 72;
export const MASK_SCALE = 100;
// Same criterion as earthVis in the pipeline: the Earth counts as visible 0.3° over the mask.
export const EARTH_MARGIN = 0.3;

// 360 values (one per degree, from north towards east) linearly interpolated between the 72 azimuths.
export function cellMask(masks, cell) {
  const step = 360 / MASK_AZIMUTHS;
  const base = cell * MASK_AZIMUTHS;
  const out = new Array(360);
  for (let a = 0; a < 360; a++) {
    const f = a / step;
    const b0 = Math.floor(f) % MASK_AZIMUTHS;
    const b1 = (b0 + 1) % MASK_AZIMUTHS;
    const t = f - Math.floor(f);
    out[a] = (masks[base + b0] * (1 - t) + masks[base + b1] * t) / MASK_SCALE;
  }
  return out;
}

// Mask at any azimuth: linear between whole degrees (exact, since the 72 knots fall on whole degrees).
export function maskAt(mask, az) {
  const a = ((az % 360) + 360) % 360;
  const a0 = Math.floor(a);
  const t = a - a0;
  return mask[a0 % 360] * (1 - t) + mask[(a0 + 1) % 360] * t;
}

// The first `hours` rows of the series as the sky compass wants them: { sun, earth } with az, el and margin
// over the relief. The Earth's margin also takes off EARTH_MARGIN, so «over the relief» means seesEarth.
export function ringSeries(series, mask, hours = series.sun.az.length) {
  const rows = Math.min(hours, series.sun.az.length);
  const out = new Array(rows);
  for (let h = 0; h < rows; h++) {
    const sun = { az: series.sun.az[h], el: series.sun.el[h] };
    const earth = { az: series.earth.az[h], el: series.earth.el[h] };
    sun.margin = sun.el - maskAt(mask, sun.az);
    earth.margin = earth.el - maskAt(mask, earth.az) - EARTH_MARGIN;
    out[h] = { sun, earth };
  }
  return out;
}

// Row of the series for a game hour (whole hours, clamped), as the ring and the arrow read it.
export const seriesRow = (hours, t) => Math.min(Math.max(Math.floor(t), 0), hours - 1);

// Point on the map border towards an azimuth: 0 up (north, −y), 90 right, 180 down, 270 left.
// `size` is the side of the square map and `margin` how far inside the border; angle in radians.
export function bearingPoint(az, size, margin) {
  const angle = (az * Math.PI) / 180;
  const r = size / 2 - margin;
  return { x: size / 2 + Math.sin(angle) * r, y: size / 2 - Math.cos(angle) * r, angle };
}
