// Takes the NASA branding out of the textures of the Z-2 suit (viewpoint/assets/suit-z2.glb). NASA's atlas carries the
// NASA insignia, a US flag, a mission patch and the credit and logo of NASA's Advanced Concepts Lab; NASA Space Apps does
// not allow NASA branding, flags or mission identifiers in the project, so they are painted over before the glb is written
// and the suit only wears the 540 patch (viewpoint/src/scene.js). The patches become plain cloth, the credit and the logo
// on the empty background become background. Pure: it works on the raw bytes of an image (no DOM, no image library).
//
// Coordinates are pixels of the 4096 × 4096 atlas of the Z-2 (z2_Color_s and z2_Bump_s share the layout).

/** Atlas size the regions are measured on. */
export const ATLAS_SIZE = 4096;

/**
 * What is painted over. `fill`: 'sample' takes the median colour of `sample` (a patch of plain cloth or panel next to it),
 * 'white' paints background. `only: 'color'` leaves the relief map alone (the strip has no relief to clean).
 * `onlyMarked`: paint only the pixels that are not background (keeps the outline of the strip).
 */
export const BRANDING_REGIONS = [
  { name: 'us-flag', rect: [120, 2600, 282, 2802], fill: 'sample', sample: [600, 2840, 640, 2880] },
  { name: 'nasa-insignia', rect: [203, 3450, 352, 3600], fill: 'sample', sample: [600, 2840, 640, 2880] },
  { name: 'mission-patch', rect: [50, 3513, 213, 3690], fill: 'sample', sample: [600, 2840, 640, 2880] },
  { name: 'acl-logo-panel', rect: [608, 182, 660, 240], fill: 'sample', sample: [565, 190, 600, 235] },
  { name: 'acl-credit', rect: [3940, 1755, 4015, 3745], fill: 'white' },
  { name: 'acl-logo', rect: [3740, 3678, 4096, 4049], fill: 'white' },
  { name: 'strip-text', rect: [1340, 4036, 3780, 4090], fill: 'sample', sample: [2925, 4048, 3094, 4074], only: 'color', onlyMarked: true },
];

const BACKGROUND = 248;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Median colour of a rectangle [x0, y0, x1, y1) of an RGB(A) image. */
export function sampleColor(data, width, channels, [x0, y0, x1, y1]) {
  const out = [];
  for (let c = 0; c < Math.min(channels, 3); c++) {
    const values = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) values.push(data[(y * width + x) * channels + c]);
    out.push(median(values));
  }
  return out;
}

function inside(region, x, y) {
  if (region.rect) {
    const [x0, y0, x1, y1] = region.rect;
    return x >= x0 && x < x1 && y >= y0 && y < y1;
  }
  const [cx, cy, r] = region.circle;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function bounds(region, width, height) {
  const box = region.rect ?? [region.circle[0] - region.circle[2], region.circle[1] - region.circle[2], region.circle[0] + region.circle[2] + 1, region.circle[1] + region.circle[2] + 1];
  return [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(width, box[2]), Math.min(height, box[3])];
}

/**
 * Paints the branding regions in place. `kind` is 'color' or 'bump' (regions with `only: 'color'` skip the relief map).
 * Returns the names of the regions painted.
 */
export function removeBranding(data, { width, height, channels }, kind, regions = BRANDING_REGIONS) {
  if (width !== ATLAS_SIZE || height !== ATLAS_SIZE) throw new Error(`suit-branding: atlas de ${width} × ${height}, se esperaba ${ATLAS_SIZE} × ${ATLAS_SIZE}`);
  const painted = [];
  for (const region of regions) {
    if (region.only && region.only !== kind) continue;
    const colour = region.fill === 'white' ? [255, 255, 255] : sampleColor(data, width, channels, region.sample);
    const [x0, y0, x1, y1] = bounds(region, width, height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!inside(region, x, y)) continue;
        const i = (y * width + x) * channels;
        if (region.onlyMarked && Math.min(data[i], data[i + 1], data[i + 2]) >= BACKGROUND) continue;
        for (let c = 0; c < 3; c++) data[i + c] = colour[c];
      }
    }
    painted.push(region.name);
  }
  return painted;
}
