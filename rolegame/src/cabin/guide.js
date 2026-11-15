// Where the rover is heading, from the cabin (J12, «saber hacia dónde va»): the guide line on the ground ahead, the
// heading in words and degrees for the compass, and why «Transmitir» is off. Pure: no DOM, no three.js.

/** Length of the guide line ahead of the rover (km) and the spacing of its points. */
export const GUIDE_KM = 0.18;
export const GUIDE_STEP_KM = 0.012;
/** Above this share of the level's maximum slope a climb is «steep» (yellow); above the maximum, impossible (red). */
export const STEEP_SHARE = 0.6;

/** 'ok', 'steep' or 'no' for a slope in degrees and the level's maximum. */
export function slopeTone(deg, maxSlope) {
  if (deg > maxSlope) return 'no';
  return deg > maxSlope * STEEP_SHARE ? 'steep' : 'ok';
}

/**
 * Points of the guide line, in cells (fractional), from the rover forwards along `heading` (radians from north,
 * clockwise; north is −y). Each point carries the tone of the game cell it lies in, from the slope the engine uses
 * to enter that cell: `cellSlope(from, to)` in degrees for neighbouring cells (null outside the grid). Inside the
 * rover's own cell the tone is 'ok'. Stops at the edge of the grid.
 */
export function guidePath({ x, y, heading }, { cellM, n, maxSlope, cellSlope, lengthKm = GUIDE_KM, stepKm = GUIDE_STEP_KM }) {
  const dx = Math.sin(heading), dy = -Math.cos(heading);
  const here = { x: Math.round(x), y: Math.round(y) };
  const pts = [];
  let prev = here, tone = 'ok';
  for (let d = stepKm; d <= lengthKm + 1e-9; d += stepKm) {
    const cx = x + (dx * d * 1000) / cellM, cy = y + (dy * d * 1000) / cellM;
    const cell = { x: Math.round(cx), y: Math.round(cy) };
    if (cell.x < 0 || cell.y < 0 || cell.x >= n || cell.y >= n) break;
    if (cell.x !== prev.x || cell.y !== prev.y) {
      const deg = cellSlope(prev, cell);
      tone = deg === null ? 'no' : worst(tone, slopeTone(deg, maxSlope));
      prev = cell;
    }
    pts.push({ x: cx, y: cy, tone });
  }
  return pts;
}
const RANK = { ok: 0, steep: 1, no: 2 };
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

/** «NE · 045°»: the nearest of the eight winds (in the texts' words) and the heading in three digits. */
export function headingLabel(headingRad, windsShort) {
  const deg = ((Math.round((headingRad * 180) / Math.PI) % 360) + 360) % 360;
  const wind = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
  return `${windsShort?.[wind] ?? wind} · ${String(deg).padStart(3, '0')}°`;
}
