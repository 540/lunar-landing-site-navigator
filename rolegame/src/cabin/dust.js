// Regolith dust of the cabin (J12.1, ready for driving in J12.2): grains kicked by the wheels fly in clean parabolas,
// with no air to slow them or hold them up, and vanish when they fall back to the ground. Pure and deterministic: a
// seeded generator and plain arrays, so node:test can check the physics and three.js only copies the positions.
// Units: km and seconds, as the Mirador's scene.

/** Lunar gravity in km/s² (1.62 m/s²). */
export const G_KM = 0.00162;

/** A pool of `max` grains: positions, velocities and the ground height each one falls back to. */
export function createDust(max, seed = 7) {
  return {
    max, seed,
    pos: new Float32Array(max * 3), vel: new Float32Array(max * 3),
    floor: new Float32Array(max), alive: new Uint8Array(max), age: new Float32Array(max),
    next: 0,
  };
}

// Park–Miller, as the stars: the same burst every time.
function rnd(d) {
  d.seed = (d.seed * 16807) % 2147483647;
  return (d.seed - 1) / 2147483646;
}

/**
 * Kicks `count` grains from a wheel at (x, y, z) km, spraying around `heading` (radians, 0 = north, clockwise) with
 * speeds of 0.4 … 1.6 m/s, mostly backwards and up. Old grains are reused when the pool is full.
 */
export function emitDust(d, { x, y, z, heading = 0, count = 12, spread = 1.2 }) {
  for (let n = 0; n < count; n++) {
    const i = d.next; d.next = (d.next + 1) % d.max;
    const a = heading + Math.PI + (rnd(d) - 0.5) * spread;
    const speed = (0.4 + 1.2 * rnd(d)) / 1000;
    const up = 0.35 + 0.6 * rnd(d);
    const flat = Math.sqrt(1 - up * up);
    d.pos[i * 3] = x; d.pos[i * 3 + 1] = y; d.pos[i * 3 + 2] = z;
    d.vel[i * 3] = Math.sin(a) * flat * speed;
    d.vel[i * 3 + 1] = up * speed;
    d.vel[i * 3 + 2] = -Math.cos(a) * flat * speed;
    d.floor[i] = y; d.alive[i] = 1; d.age[i] = 0;
  }
}

/** Moves every grain dtS seconds along its parabola (exact for constant gravity); a grain under its floor dies. */
export function stepDust(d, dtS) {
  let alive = 0;
  for (let i = 0; i < d.max; i++) {
    if (!d.alive[i]) continue;
    const k = i * 3;
    d.pos[k] += d.vel[k] * dtS;
    d.pos[k + 1] += d.vel[k + 1] * dtS - 0.5 * G_KM * dtS * dtS;
    d.pos[k + 2] += d.vel[k + 2] * dtS;
    d.vel[k + 1] -= G_KM * dtS;
    d.age[i] += dtS;
    if (d.pos[k + 1] < d.floor[i]) { d.alive[i] = 0; d.pos[k + 1] = -1e6; } else alive++;
  }
  return alive;
}

/** Highest point and flight time of a grain launched upwards at v km/s: v²/2g and 2v/g (a check for the tests). */
export const apex = (v) => (v * v) / (2 * G_KM);
export const flightTime = (v) => (2 * v) / G_KM;
