// Landing site and sky of the day. The rim of Cabeus B is one of the Artemis candidate landing regions (NASA, 2024).
// Sun and Earth come from the project's engine (`track` use case of backend/src/useCases.ts, smooth Moon, observer
// on the ground) for these coordinates and this instant; azimuths clockwise from north.
import { EARTH_DIAMETER_DEG, LANDER_MAGNIFY, SUN_DIAMETER_DEG } from '../../shared/render/sky-bodies.js';

export const SITE = Object.freeze({
  name: 'Borde de Cabeus B',
  latDeg: -82.3,
  lonDeg: -54.5,
  date: '2027-11-19T12:00:00Z',
  sun: { azDeg: 344.64, elDeg: 8.85 },
  earth: { azDeg: 54.8, elDeg: 3.99 },
  approachAzDeg: 110, // heading of the final approach: the Earth ahead to the left, the Sun behind the left shoulder
});

export const MOON_RADIUS_M = 1737400;
// The Sun and the Earth are drawn at twice their real size (shared/render/sky-bodies.js) so that they read through a
// cabin window, the Earth still 3.6 times wider than the Sun (#342): 1.06° and 3.8°.
export const EARTH_ANGULAR_DEG = EARTH_DIAMETER_DEG * LANDER_MAGNIFY;
export const SUN_ANGULAR_DEG = SUN_DIAMETER_DEG * LANDER_MAGNIFY;

// The Sun's two sprites in the sky of scene/world.js, at SUN_SKY_SHARE of the sky radius. The disc's gradient is fully
// bright up to SUN_CORE_STOP_LANDER, so that core is SUN_ANGULAR_DEG wide (sunSpriteWidth), and fades fast after it so
// the disc does not read wider than that (#342). The halo is a sprite SUN_HALO_SHARE of the sky radius wide.
export const SUN_SKY_SHARE = 0.95;
export const SUN_CORE_STOP_LANDER = 0.3;
export const SUN_DISC_STOPS = Object.freeze([[0, '#fff'], [SUN_CORE_STOP_LANDER, '#fff'], [0.31, 'rgba(255,246,225,.2)'], [1, 'rgba(255,240,210,0)']]);
export const SUN_HALO_SHARE = 0.5;
export const SUN_HALO_OPACITY = 0.9;
export const SUN_HALO_STOPS = Object.freeze([[0, 'rgba(255,244,222,.55)'], [0.25, 'rgba(255,236,205,.14)'], [1, 'rgba(255,230,190,0)']]);

/** Unit vector of a sky direction in scene axes: x along the approach, y up, z to the right of the approach. */
export function skyVector({ azDeg, elDeg }, approachAzDeg = SITE.approachAzDeg) {
  const rel = ((azDeg - approachAzDeg) * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(rel), Math.sin(el), Math.cos(el) * Math.sin(rel)];
}
