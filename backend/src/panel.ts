// Solar panel orientation for the `energy` metric (search.ts → evaluateCell).
//
// energy = mean over the samples of visibleFraction(sun) × panelFactor(panel, el), with `el` the elevation of the
// centre of the solar disc in degrees. It only changes `energy`: sunFraction, the night, the Earth and the battery
// do not depend on the panel.
//
//   tracking           factor 1             panel that follows the Sun on two axes (normal incidence). Default and
//                                           the behaviour before this option existed (bit-identical).
//   vertical-rotating  factor cos(el)       vertical panel that rotates about the vertical axis to face the Sun's
//                                           azimuth (what polar landers actually fly, e.g. NASA's VSAT requirements).
//   horizontal         factor max(0, sin(el))  fixed horizontal panel.
//
// Pure geometry (cosine of the angle of incidence): no cell efficiency, temperature, limb darkening, Sun-distance
// variation (±3.4 %), self-shadowing of the lander or dust. At the pole, with the Sun at 0–2°, a horizontal panel
// gets ~sin(el) ≈ 0–3.5 % of the tracking power, while a vertical rotating one keeps cos(el) ≈ 99.9–100 %.
import type { Panel } from './types.ts';

const DEG = Math.PI / 180;

/** Accepted panel orientations (the first is the default). */
export const PANELS: readonly Panel[] = ['tracking', 'vertical-rotating', 'horizontal'];
export const DEFAULT_PANEL: Panel = 'tracking';

/** Human-readable formula of each factor (echoed by the APIs). */
export const PANEL_FORMULAS: Readonly<Record<Panel, string>> = {
  tracking: '1',
  'vertical-rotating': 'cos(el)',
  horizontal: 'max(0, sen(el))',
};

/**
 * Geometric factor of a panel for a Sun whose disc centre is at `sunElevationDeg` (cosine of the angle of incidence).
 * tracking → 1; vertical-rotating → cos(el); horizontal → max(0, sin(el)).
 */
export function panelFactor(panel: Panel, sunElevationDeg: number): number {
  if (panel === 'vertical-rotating') return Math.cos(sunElevationDeg * DEG);
  if (panel === 'horizontal') return Math.max(0, Math.sin(sunElevationDeg * DEG));
  return 1;
}

/** Validates a panel orientation; undefined/null/'' → the default (tracking). */
export function checkPanel(x: unknown): Panel {
  if (x === undefined || x === null || x === '') return DEFAULT_PANEL;
  if (typeof x !== 'string' || !(PANELS as readonly string[]).includes(x)) throw new Error('panel debe ser tracking, vertical-rotating u horizontal');
  return x as Panel;
}

/** Validated panel option: `{ panel }` only when it is not 'tracking' (so options and responses stay as before). */
export function panelOption(raw: unknown): { panel?: Exclude<Panel, 'tracking'> } {
  const panel = checkPanel(raw);
  return panel === 'tracking' ? {} : { panel };
}
