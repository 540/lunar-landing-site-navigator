// «Reducir movimiento» (E8.3, #499): the one place that asks the system whether the person wants less motion.
// Every camera, flag and salute animation calls prefersReducedMotion() instead of repeating matchMedia.
const QUERY = '(prefers-reduced-motion: reduce)';

/** @param {{ matchMedia?: (q: string) => { matches: boolean } }} [win] window, or a fake one in tests */
export function prefersReducedMotion(win = globalThis.window ?? globalThis) {
  return !!win.matchMedia?.(QUERY)?.matches;
}
