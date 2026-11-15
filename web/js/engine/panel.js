// How the solar panel of the spacecraft is mounted (#254). The same three orientations the data API knows
// (backend/src/panel.ts, `panel` of /v1/rank): the factor applied to the visible fraction of the solar disc, with `el`
// the elevation of its centre. It only changes the energy the panel gets: never the verdict, the night or the Earth.
//
//   tracking           1                 follows the Sun on two axes (the default: what the energy was before)
//   vertical-rotating  cos(el)           vertical, turning about the vertical axis to face the Sun's azimuth
//   horizontal         max(0, sin(el))   fixed and horizontal
//
// A fixed vertical panel (no turning) is not modelled by the engine, so it is not offered.
// Pure: no DOM. Texts in the dictionary (i18n/plan.js, plan.panel.…), like the classes of coherence.js.
import { t } from '../common/i18n.js';

export const PANELS = ['tracking', 'vertical-rotating', 'horizontal'];
export const DEFAULT_PANEL = 'tracking';

/** A known orientation, or null (a link or the history cannot bring one the engine does not know). */
export const panelOf = v => (PANELS.includes(v) ? v : null);

/** Its name on screen: «Seguidor de dos ejes», «Vertical giratorio», «Horizontal fijo». */
export const panelName = id => t(`plan.panel.${panelOf(id) ?? DEFAULT_PANEL}`);
/** Its factor, as the API echoes it: «1», «cos(el)», «max(0, sen(el))». */
export const panelFormula = id => t(`plan.panel.formula.${panelOf(id) ?? DEFAULT_PANEL}`);

// Above this latitude a horizontal panel gets little: the Sun stays low over the horizon all the time.
export const POLAR_PANEL_LAT_DEG = 80;
// The tilt of the Moon's axis to the ecliptic: at latitude φ the Sun never rises above 90° − |φ| + 1.54°.
export const LUNAR_AXIAL_TILT_DEG = 1.54;
/** The highest the Sun gets at that latitude, in degrees (≈ 2.1° at the Shackleton ridge, ≈ 11.4° at IM-1). */
export const maxSunElevationDeg = latDeg => 90 - Math.abs(latDeg) + LUNAR_AXIAL_TILT_DEG;
/** The most a horizontal panel gets at that latitude, in % of a tracking one: sin of that Sun (≈ 3.7 % at the ridge). */
export const horizontalMaxPct = latDeg => 100 * Math.sin((maxSunElevationDeg(latDeg) * Math.PI) / 180);

/** Whether a panel does not work at that latitude: horizontal, beyond 80°. */
export const panelUselessAt = (panel, latDeg) => panel === 'horizontal' && Number.isFinite(latDeg) && Math.abs(latDeg) > POLAR_PANEL_LAT_DEG;
