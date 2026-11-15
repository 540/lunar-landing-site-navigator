// The Earth as seen from the Moon, painted procedurally so it looks like the Earth and not like a blue ball: deep
// oceans, green and ochre continents, polar ice, cloud bands, the lit and the night side and a thin blue atmosphere.
// Pure (no DOM, no three.js): it fills RGBA pixel arrays; each screen wraps them in its own canvas and texture.
//
//   earthDiscPixels(size, opts)  a lit disc with its halo, for a sprite (viewpoint/src/scene.js)
//   earthMapPixels(w, h)         an equirectangular map, for a textured sphere (both 3D views)
//   earthSpin(ms), SIDEREAL_DAY_MS how far the Earth has turned on its axis at a time (one turn per sidereal day)

// ---- 3D value noise with a fixed seed: the same Earth on every visit ----
const hash = (x, y, z) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const fade = t => t * t * (3 - 2 * t);
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf),
    l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf);
}
function fbm(x, y, z, octaves) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * noise(x * f, y * f, z * f); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
}

const OCEAN_DEEP = [10, 38, 92], OCEAN_SHALLOW = [28, 92, 160];
const LAND_GREEN = [58, 104, 52], LAND_DRY = [158, 128, 84], ICE = [236, 242, 248], CLOUD = [250, 252, 255];
const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = t => Math.max(0, Math.min(1, t));

/** Colour of the surface (with its clouds) at a point of the unit sphere (y up). Returns [r, g, b] in 0–255. */
export function surfaceColor(x, y, z) {
  const lat = Math.asin(Math.max(-1, Math.min(1, y)));
  const land = fbm(x * 1.6 + 7, y * 1.6 + 3, z * 1.6 + 11, 5);
  const coast = 0.53;
  let rgb;
  if (land > coast) {
    const dry = fbm(x * 3 + 40, y * 3, z * 3, 3) + (1 - Math.abs(lat) / (Math.PI / 2)) * 0.15 - 0.08; // deserts near the tropics
    rgb = mixRgb(LAND_GREEN, LAND_DRY, clamp01((dry - 0.45) * 3));
  } else {
    rgb = mixRgb(OCEAN_DEEP, OCEAN_SHALLOW, clamp01((land - coast + 0.08) / 0.08) * 0.8);
  }
  // polar ice caps, with a ragged edge
  const ice = clamp01((Math.abs(lat) - 1.18 + (fbm(x * 4, y * 4, z * 4, 3) - 0.5) * 0.25) * 8);
  rgb = mixRgb(rgb, ICE, ice);
  // clouds: bands stretched along the parallels, thicker in the storm belts
  const c = fbm(x * 3.2 + 100, y * 6.5, z * 3.2 + 50, 5);
  const belt = 0.55 + 0.25 * Math.cos(lat * 4);
  const cloud = clamp01((c - (0.62 - belt * 0.12)) * 4.5) * 0.9;
  return mixRgb(rgb, CLOUD, cloud);
}

/**
 * A disc of the Earth, centred in a size×size RGBA image, with a soft blue halo around it. `light` is the direction of
 * the Sun in the disc's frame (x right, y up, z to the viewer): the side away from it is the night side.
 * `turn` rotates the globe about its axis (radians).
 */
export function earthDiscPixels(size, { light = [-0.55, 0.25, 0.8], turn = 0.6, radius = 0.36 } = {}) {
  const px = new Uint8ClampedArray(size * size * 4);
  const ln = Math.hypot(...light), L = light.map(v => v / ln);
  const cx = size / 2, R = size * radius, ct = Math.cos(turn), st = Math.sin(turn);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = (i + 0.5 - cx) / R, v = -(j + 0.5 - cx) / R, d2 = u * u + v * v, k = (j * size + i) * 4;
    if (d2 > 1) {
      // halo: thin and blue, fading out over 18 % of the radius, brighter on the lit side
      const d = Math.sqrt(d2), a = clamp01(1 - (d - 1) / 0.18);
      if (a <= 0) continue;
      const lit = clamp01(0.35 + 0.65 * ((u * L[0] + v * L[1]) / d));
      px[k] = 110; px[k + 1] = 170; px[k + 2] = 255; px[k + 3] = Math.round(255 * a * a * 0.55 * lit);
      continue;
    }
    const w = Math.sqrt(1 - d2);
    // the point on the globe, turned about the vertical axis
    const x = u * ct + w * st, z = -u * st + w * ct, y = v;
    let [r, g, b] = surfaceColor(x, y, z);
    // light: Lambert with a soft terminator, a faint night side and the limb a little darker
    const lambert = u * L[0] + v * L[1] + w * L[2];
    const day = clamp01((lambert + 0.08) / 0.35);
    const shade = (0.06 + 0.94 * day) * (0.78 + 0.22 * w);
    // atmosphere: blue haze towards the limb, on the lit side
    const haze = (1 - w) ** 2.2 * 0.75 * day;
    r = r * shade * (1 - haze) + 120 * haze; g = g * shade * (1 - haze) + 175 * haze; b = b * shade * (1 - haze) + 255 * haze;
    // a gently anti-aliased edge
    const edge = clamp01((1 - Math.sqrt(d2)) * R);
    px[k] = r; px[k + 1] = g; px[k + 2] = b; px[k + 3] = Math.round(255 * edge);
  }
  return px;
}

/** An equirectangular map of the same Earth (w×h RGBA, longitude across, latitude down), for a textured sphere. */
export function earthMapPixels(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / h) * Math.PI, y = Math.sin(lat), cl = Math.cos(lat);
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * 2 * Math.PI - Math.PI, k = (j * w + i) * 4;
      const [r, g, b] = surfaceColor(cl * Math.sin(lon), y, cl * Math.cos(lon));
      px[k] = r; px[k + 1] = g; px[k + 2] = b; px[k + 3] = 255;
    }
  }
  return px;
}

/** One turn of the Earth on its axis: a sidereal day, 23 h 56 min 4 s. */
export const SIDEREAL_DAY_MS = 86164091;
/** Angle (radians, 0–2π) the Earth has turned at time `ms` (any fixed origin: only the motion matters on screen). */
export const earthSpin = ms => (((ms % SIDEREAL_DAY_MS) + SIDEREAL_DAY_MS) % SIDEREAL_DAY_MS) / SIDEREAL_DAY_MS * 2 * Math.PI;
