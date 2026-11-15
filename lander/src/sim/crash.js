// What a crash looks like over time: the timeline the scene, the page and the camera read every frame.
// Pure: no three.js and no DOM. `t` is seconds since the impact.

export const CRASH_CARD_S = 3.4; // the failed-landing card comes once the worst has passed

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = (a, b, t) => { const k = clamp01((t - a) / (b - a)); return k * k * (3 - 2 * k); };

/**
 * Returns { flash, shake, smoke, emergency, cracks, sparks } for `t` seconds after the impact, each 0–1
 * (`sparks` is true while new sparks may fly). With `reduced` (prefers-reduced-motion) nothing shakes or blinks:
 * the flash becomes a slow fade and the emergency light stays steady.
 */
export function crashEffects(t, { reduced = false } = {}) {
  if (!(t >= 0)) return { flash: 0, shake: 0, smoke: 0, emergency: 0, cracks: 0, sparks: false };
  const smoke = smooth(0.15, 2.6, t) * 0.62;
  const cracks = reduced ? smooth(0, 0.8, t) : 1;
  if (reduced) {
    return { flash: 0.55 * smooth(0, 0.6, t) * (1 - smooth(0.6, 2.2, t)), shake: 0, smoke, emergency: 0.8 * smooth(0.4, 1.4, t), cracks, sparks: false };
  }
  // A hard white-orange flash that dies in under a second, and a shake that decays over three.
  const flash = t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) * 4.2);
  const shake = Math.exp(-t * 1.25) * (t < 2.8 ? 1 : 0.4);
  // Red emergency lamps: off for the first instant, then on and off twice a second.
  const emergency = t < 0.35 ? 0 : Math.floor((t - 0.35) * 2.4) % 2 === 0 ? 1 : 0.12;
  return { flash: clamp01(flash), shake, smoke, emergency, cracks, sparks: t < 1.6 };
}
