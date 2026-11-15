// When a body of the sky block counts as seen (#269): with its whole disc over the relief, the `full` criterion the
// windows, the verdict and the timeline decide with (the same fix as #192 in viewpoint/). Pure, no DOM.
//   body: { margin, fullMargin? } of the hourly sky (loadSky): `margin` is the disc centre over the horizon and
//   `fullMargin` its lower edge (margin − radius, /v1/track 1.22.0). Without `fullMargin` (older API) the centre decides.
import { t } from './i18n.js';

/** Degrees of the lower edge of the disc over the relief; the centre's if the series has no `fullMargin`. */
export const marginOverRelief = body => body.fullMargin ?? body.margin;

/** The whole disc is over the relief: the body is seen. */
export const overRelief = body => marginOverRelief(body) > 0;

/** The state of both bodies at one instant, in words, for the canvas label of every sky view (#337). */
export const skyStateLabel = ({ sun, earth }) => t('tour.sky.state', { sun: overRelief(sun), earth: overRelief(earth) });
