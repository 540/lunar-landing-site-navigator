// The One Euro filter (Casiez, Roussel and Vogel, CHI 2012): smooths a noisy signal from a tracker without the lag of a
// plain average. Still, it smooths hard, so a hand at rest does not shake; moving fast, it follows at once. Pure.

const alpha = (cutoffHz, dt) => { const tau = 1 / (2 * Math.PI * cutoffHz); return 1 / (1 + tau / dt); };

/**
 * @param {{minCutoff?:number, beta?:number, dCutoff?:number}} [opts] minCutoff (Hz): smoothing at rest, lower is smoother;
 *   beta: how much faster it follows when the signal moves; dCutoff (Hz): smoothing of the speed estimate
 * @returns {{filter:(value:number, dt:number) => number, reset:() => void}}
 */
export function oneEuro({ minCutoff = 1, beta = 0.02, dCutoff = 1 } = {}) {
  let x = null, dx = 0;
  return {
    filter(value, dt) {
      if (x === null || !(dt > 0)) { x = value; dx = 0; return value; }
      const rawDx = (value - x) / dt;
      dx += alpha(dCutoff, dt) * (rawDx - dx);
      const cutoff = minCutoff + beta * Math.abs(dx);
      x += alpha(cutoff, dt) * (value - x);
      return x;
    },
    reset() { x = null; dx = 0; },
  };
}

/** One filter for each component of a 3D point. */
export function oneEuro3(opts) {
  const f = [oneEuro(opts), oneEuro(opts), oneEuro(opts)];
  return {
    filter: (p, dt) => ({ x: f[0].filter(p.x, dt), y: f[1].filter(p.y, dt), z: f[2].filter(p.z, dt) }),
    reset: () => f.forEach(c => c.reset()),
  };
}
