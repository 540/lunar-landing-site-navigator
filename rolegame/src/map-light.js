// Light of the map (J4.1): pure functions the shader of map-gl.js repeats in GLSL, so node:test can check them.
// Axes of the map: east +x, north −y (image up), up +z. No DOM here.

const DEG = Math.PI / 180;

// Ambient light: base and sky-facing part (#309: was 0.028 + 0.05, which left shadows pure black). map-gl.js repeats it.
export const AMBIENT = [0.16, 0.1];
// Colour of that ambient: nearly neutral grey. Blue means «the Earth is in sight from here» on this map (J3.2), so the
// shadow must not look blue (it was 0.75, 0.9, 1.25).
export const AMBIENT_TINT = [0.9, 0.92, 1.0];

// Unit vector towards the Sun at an azimuth (from north towards east) and an elevation, in degrees.
export function sunVector(az, el) {
  const a = az * DEG, e = el * DEG;
  return [Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), Math.sin(e)];
}

// Colour [r, g, b] 0..1 of a pixel, as light() of the prototype (l. 292-298): `sun` (0..1, fraction of the disc in
// sight) plays the part of its shadow; `normal` is the unit normal and `light` the sunVector.
export function shade({ albedo, ao, normal, light, sun }) {
  const a = albedo * ao;
  const lam = Math.max(0, normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]);
  const val = Math.pow(1 - Math.exp(-1.7 * a * sun * lam * 7), 0.85);
  // Ambient from the sky side: (gy * 0.5 + 0.85) / |n| with the normal (−gx, −gy, 1) / |n|. Strong enough for the
  // relief to read in shadow (light reflected by the ground and the Earth, #309), still far below direct Sun.
  const es = Math.max(0, -0.5 * normal[1] + 0.85 * normal[2]);
  const amb = (AMBIENT[0] + AMBIENT[1] * es) * a * ao;
  return [
    Math.min(1, val * 0.99 + amb * AMBIENT_TINT[0]),
    Math.min(1, val * 0.965 + amb * AMBIENT_TINT[1]),
    Math.min(1, val * 0.92 + amb * AMBIENT_TINT[2]),
  ];
}

// Sun fraction of every cell at an hour (interpolated, as the rules read it), 0..255, for a texture of n × n.
export function sunGrid(tables, hour) {
  const n = tables.n, out = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = Math.round(tables.sunFrac(i, hour) * 255);
  return out;
}

// 'gl' with WebGL on real hardware; '2d' (map.png and the shade veil) otherwise.
export const mapMode = ({ webgl, softwareRenderer }) => (webgl && !softwareRenderer ? 'gl' : '2d');

// ---------- Horizon per pixel (J4.2) ----------
// Half the apparent diameter of the Sun and the threshold of «lit», as sunFrac of the pipeline and the rules.
export const SUN_DISC = 0.53;
export const LIT = 0.5;

// Horizon (degrees) at map point (u, v) (0..1, north up) towards `az`, from an atlas `horizon` (Uint8) described by
// `meta` ({ size, directions, cols, offset, step }): bilinear between the four nearest points (centres at
// (x + 0.5) / size) and linear between the two nearest directions.
export function horizonAt(horizon, meta, u, v, az) {
  const { size, directions, cols, offset, step } = meta;
  const width = cols * size;
  const X = Math.min(size - 1, Math.max(0, u * size - 0.5)), Y = Math.min(size - 1, Math.max(0, v * size - 0.5));
  const x0 = Math.min(size - 2, Math.floor(X)), y0 = Math.min(size - 2, Math.floor(Y)), fx = X - x0, fy = Y - y0;
  const f = (((az % 360) + 360) % 360) / (360 / directions);
  const d0 = Math.floor(f) % directions, d1 = (d0 + 1) % directions, t = f - Math.floor(f);
  const at = (x, y, d) => offset + horizon[(Math.floor(d / cols) * size + y) * width + (d % cols) * size + x] * step;
  const bil = (d) => (at(x0, y0, d) * (1 - fx) + at(x0 + 1, y0, d) * fx) * (1 - fy)
    + (at(x0, y0 + 1, d) * (1 - fx) + at(x0 + 1, y0 + 1, d) * fx) * fy;
  return bil(d0) * (1 - t) + bil(d1) * t;
}

// Sun fraction 0..1 of a map point: the disc over the horizon, with penumbra (the formula of sunFrac in the
// pipeline). Without penumbra (low quality, J4.3) it is 0 or 1.
export function pixelSun(horizon, meta, u, v, az, el, penumbra = true) {
  const h = horizonAt(horizon, meta, u, v, az);
  if (!penumbra) return el > h ? 1 : 0;
  return Math.max(0, Math.min(1, (el - h) / SUN_DISC + LIT));
}
