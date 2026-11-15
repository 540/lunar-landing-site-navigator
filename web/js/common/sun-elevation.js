// Solar elevation for the panels (#69, 4.3 and 4.4): only to show, it decides no verdict.
//
// What matters at the pole is the Sun's height over the terrain, not its elevation:
//   - Polar landers fly vertical panels that rotate to face the Sun (NASA VSAT requirements, see backend/README.md).
//     Their factor is cos(el) (backend/src/panel.ts): with the Sun at 0–3° it keeps 99.9–100 % of the power. A low Sun
//     does not make them yield less; a horizontal panel would get sin(el), 0–5 %.
//   - What does cut the power is the terrain: with the disc centre less than its radius (~0.27°) over the horizon, part
//     of the disc is hidden; and the LOLA horizon has an error of ~0.3° (rms < 0.3° against LDRM, backend/README.md,
//     «Validación»). So with the Sun less than 0.27° + 0.3° ≈ 0.6° over the terrain, the panel may really be half lit
//     or in shadow even if the model says «luz».

import { fmtDeg } from './i18n.js';
import { overRelief } from './sky-visibility.js';

/** Below this height over the terrain (degrees) the panel may be in shadow: Sun radius (0.27°) + LOLA error (0.3°). */
export const LOW_SUN_MARGIN_DEG = 0.6;

/** The Sun's height over the terrain is low enough to warn: the panel may yield little or nothing. */
export const lowSun = marginDeg => marginDeg < LOW_SUN_MARGIN_DEG;

/**
 * Solar elevation of a mission from its hour-by-hour sky (`series[i].sun = { el, margin }`, as sky() gives it), over the
 * hours with the whole Sun disc over the terrain (overRelief, as the verdict counts them): { litHours, meanEl, minEl, minMargin, lowHours }, with lowHours the
 * lit hours below LOW_SUN_MARGIN_DEG. minMargin and lowHours use `margin`, the disc centre, on which that threshold is
 * defined. Null without lit hours.
 */
export function missionSun(series) {
  const lit = series.filter(k => overRelief(k.sun));
  if (!lit.length) return null;
  let sum = 0, minEl = Infinity, minMargin = Infinity, lowHours = 0;
  for (const { sun } of lit) {
    sum += sun.el;
    minEl = Math.min(minEl, sun.el);
    minMargin = Math.min(minMargin, sun.margin);
    if (lowSun(sun.margin)) lowHours++;
  }
  return { litHours: lit.length, meanEl: sum / lit.length, minEl, minMargin, lowHours };
}

/** Degrees with one decimal, in the language of the page: 1,1° / 1.1° (shared/format, #343). */
export { fmtDeg };
