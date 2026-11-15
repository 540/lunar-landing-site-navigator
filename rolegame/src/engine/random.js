// Seeded pseudo-random generator (J6.4), ported from rng() of the prototype (docs/juego-rol/index.html).
// Pure and deterministic: the same seed always gives the same sequence. The engine has no other source of chance.
export function rng(seed) {
  let a = seed | 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
