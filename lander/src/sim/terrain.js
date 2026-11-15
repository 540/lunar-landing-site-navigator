// Procedural relief around the landing site, shared by the physics (ground under the lander) and the 3D scene.
// x is downrange and z to the right of the approach, both in metres from the target; heights over the site datum.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => { const e = Math.min(1, Math.max(0, (x - a) / (b - a))); return e * e * (3 - 2 * e); };

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const CELL = 500, HALF = 64; // crater lookup grid: 128 × 128 cells of 500 m

export const PAD_RADIUS_M = 30;

export function createTerrain(seed = 540) {
  const rand = mulberry32(seed);
  const craters = [];
  const add = (count, rMin, rMax, reach) => {
    for (let i = 0; i < count; i++) {
      const radius = rMin * Math.pow(rMax / rMin, Math.pow(rand(), 2.2));
      const dist = reach * Math.sqrt(rand()), ang = rand() * Math.PI * 2;
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      // Keep the pad itself clear: craters may crowd it but not sit on it.
      if (Math.hypot(x, z) < radius * 1.6 + PAD_RADIUS_M) continue;
      craters.push({ x, z, radius, depth: radius * (0.22 + 0.14 * rand()), rim: radius * (0.05 + 0.04 * rand()) });
    }
  };
  add(110, 900, 6500, 60000);
  add(260, 150, 900, 14000);
  add(420, 25, 150, 3200);
  add(380, 4, 25, 520);

  const grid = new Map();
  for (const c of craters) {
    const reach = c.radius * 2.2;
    const x0 = Math.floor((c.x - reach) / CELL), x1 = Math.floor((c.x + reach) / CELL);
    const z0 = Math.floor((c.z - reach) / CELL), z1 = Math.floor((c.z + reach) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const key = (i + HALF * 4) * 4096 + (j + HALF * 4);
      let list = grid.get(key);
      if (!list) grid.set(key, list = []);
      list.push(c);
    }
  }

  function cratersAt(x, z) {
    const list = grid.get((Math.floor(x / CELL) + HALF * 4) * 4096 + (Math.floor(z / CELL) + HALF * 4));
    if (!list) return 0;
    let h = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i], dx = x - c.x, dz = z - c.z, d2 = (dx * dx + dz * dz) / (c.radius * c.radius);
      if (d2 >= 4.84) continue;
      if (d2 < 1) h += -c.depth * (1 - d2) + c.rim * d2;
      else { const k = (2.2 - Math.sqrt(d2)) / 1.2; h += c.rim * k * k * k; }
    }
    return h;
  }

  function heightAt(x, z) {
    const r = Math.hypot(x, z);
    const hills = (valueNoise(x / 9000 + 31.7, z / 9000 + 12.3, seed) - 0.5) * 760
      + (valueNoise(x / 3300 + 5.1, z / 3300 + 77.9, seed + 1) - 0.5) * 240
      + (valueNoise(x / 900 + 9.4, z / 900 + 3.3, seed + 2) - 0.5) * 60;
    const ridge = 1 - Math.abs(valueNoise(x / 17000 + 3.9, z / 17000 + 8.2, seed + 3) * 2 - 1);
    const massifs = ridge * ridge * 2600 * smooth(9000, 42000, r);
    const swell = (valueNoise(x / 140 + 1.7, z / 140 + 6.1, seed + 4) - 0.5) * 5 + (valueNoise(x / 34 + 8.8, z / 34 + 2.6, seed + 5) - 0.5) * 1.1;
    const pad = smooth(PAD_RADIUS_M * 0.5, PAD_RADIUS_M * 2.5, r);
    return hills * smooth(250, 3800, r) + massifs + (swell + cratersAt(x, z)) * pad;
  }

  /** Slope of the ground along the track at x, on the 8 m the landing gear spans (deg, positive uphill). */
  const slopeDegAt = (x, z = 0) => (Math.atan2(heightAt(x + 4, z) - heightAt(x - 4, z), 8) * 180) / Math.PI;

  return { heightAt, slopeDegAt, craters };
}
