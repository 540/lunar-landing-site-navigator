// Walking inside the cabin: a circle (the astronaut) against the walls and the footprints of the furniture.

/** Pushes the circle at (x, z) out of every box [minX, maxX, minZ, maxZ] and keeps it inside `bounds`. */
export function resolve(pos, radius, bounds, obstacles) {
  let { x, z } = pos;
  for (let pass = 0; pass < 3; pass++) {
    for (const [x0, x1, z0, z1] of obstacles) {
      const cx = Math.min(x1, Math.max(x0, x)), cz = Math.min(z1, Math.max(z0, z));
      const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2), push = (radius - d) / d;
        x += dx * push; z += dz * push;
      } else {
        // Centre inside the box: leave through the nearest face.
        const exits = [[x - x0, -1, 0], [x1 - x, 1, 0], [z - z0, 0, -1], [z1 - z, 0, 1]].sort((a, b) => a[0] - b[0])[0];
        x += exits[1] * (exits[0] + radius); z += exits[2] * (exits[0] + radius);
      }
    }
    x = Math.min(bounds.maxX - radius, Math.max(bounds.minX + radius, x));
    z = Math.min(bounds.maxZ - radius, Math.max(bounds.minZ + radius, z));
  }
  return { x, z };
}

export const blocked = (pos, radius, bounds, obstacles) => {
  const r = resolve(pos, radius, bounds, obstacles);
  return Math.hypot(r.x - pos.x, r.z - pos.z) > 1e-6;
};
