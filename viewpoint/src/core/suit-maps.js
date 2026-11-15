// The textures of your own suit, made fit to be seen from 30 cm (E3, #181). Pure: it works on RGBA bytes, no DOM.
//
// NASA's Z-2 model packs its pieces in one atlas over a white background, and its relief comes as a grey height map (the
// weave of the cloth and the seams) where some pieces are black. Used as it is:
// - as a bump map, the white background and the black pieces next to the grey cloth are steps of the whole height range:
//   along every edge of a piece the GPU reads a cliff, and the cloth shows black and white streaks along its seams;
// - when the texture is filtered (mipmaps, anisotropy), the white background leaks into the edges of the pieces: light
//   hairlines along every seam on the colour, which show on the darker parts.
// So the height becomes a normal map whose gradient is only taken inside a piece and never across a step, and the colour is
// dilated: the background round each piece takes the colour of the piece.

/** Height map pixels at least this light are the background of the atlas, not a piece. */
export const BACKGROUND_MIN = 250;
/** A jump in height larger than this between neighbours is the edge of a piece (or of a black part), not relief. */
export const EDGE_STEP = 40;

/**
 * Where the pieces are: 1 on a piece, 0 on the background.
 * @param {Uint8ClampedArray|Uint8Array} heightRgba the height map (grey), RGBA
 * @returns {Uint8Array} one byte per pixel
 */
export function pieceMask(heightRgba) {
  const n = heightRgba.length / 4, mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = heightRgba[i * 4] < BACKGROUND_MIN ? 1 : 0;
  return mask;
}

/**
 * A tangent-space normal map from the height map: the slope is read between neighbours of the same piece only, so the
 * edges of the pieces and of their black parts stay flat instead of turning into cliffs. Flat (128, 128, 255) on the
 * background.
 * @param {Uint8ClampedArray|Uint8Array} heightRgba RGBA, grey
 * @param {number} w
 * @param {number} h
 * @param {number} strength how steep the relief reads: the slope per pixel of a full white step, before normalising
 * @param {Uint8Array} [mask] pieceMask(heightRgba)
 * @returns {Uint8ClampedArray} RGBA
 */
export function heightToNormal(heightRgba, w, h, strength, mask = pieceMask(heightRgba)) {
  const out = new Uint8ClampedArray(w * h * 4);
  const H = i => heightRgba[i * 4];
  // The slope towards one neighbour, or none if it is off the piece or across an edge.
  const step = (i, j) => (mask[j] && Math.abs(H(j) - H(i)) <= EDGE_STEP ? H(j) - H(i) : null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      let dx = 0, dy = 0;
      if (mask[i]) {
        const r = x + 1 < w ? step(i, i + 1) : null, l = x > 0 ? step(i, i - 1) : null;
        const d = y + 1 < h ? step(i, i + w) : null, u = y > 0 ? step(i, i - w) : null;
        // central difference where both sides are on the piece, one side where only one is
        dx = r !== null && l !== null ? (r - l) / 2 : r ?? (l !== null ? -l : 0);
        dy = d !== null && u !== null ? (d - u) / 2 : d ?? (u !== null ? -u : 0);
      }
      const sx = -dx / 255 * strength, sy = dy / 255 * strength; // v of the texture grows downwards in the image
      const len = Math.hypot(sx, sy, 1);
      out[o] = Math.round((sx / len * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((sy / len * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Grows the pieces over the background, `passes` pixels: each background pixel next to a piece takes the average of its
 * neighbours on the piece (or already grown). Filtering then mixes a piece only with itself. In place; only the frontier
 * is visited, so the cost goes with the length of the edges, not with the size of the atlas.
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} mask 1 on a piece; it is grown too
 * @param {number} passes
 */
export function dilate(rgba, w, h, mask, passes) {
  const near = i => { const x = i % w; return [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i >= w ? i - w : -1, i + w < w * h ? i + w : -1]; };
  const queued = new Uint8Array(w * h);
  let frontier = [];
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) continue;
    if (near(i).some(j => j >= 0 && mask[j])) { frontier.push(i); queued[i] = 1; }
  }
  for (let pass = 0; pass < passes && frontier.length; pass++) {
    const colours = new Float32Array(frontier.length * 3);
    frontier.forEach((i, n) => {
      let r = 0, g = 0, b = 0, k = 0;
      for (const j of near(i)) if (j >= 0 && mask[j]) { r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; k++; }
      colours[n * 3] = r / k; colours[n * 3 + 1] = g / k; colours[n * 3 + 2] = b / k;
    });
    const next = [];
    frontier.forEach((i, n) => {
      rgba[i * 4] = colours[n * 3]; rgba[i * 4 + 1] = colours[n * 3 + 1]; rgba[i * 4 + 2] = colours[n * 3 + 2];
      mask[i] = 1;
    });
    for (const i of frontier) for (const j of near(i)) if (j >= 0 && !mask[j] && !queued[j]) { queued[j] = 1; next.push(j); }
    frontier = next;
  }
  return rgba;
}

/** A piece whose mean lightness is under this is a dark part (bearings, rubber), not stained cloth. */
export const DARK_PIECE_MAX = 0.2;
/** …unless it is warm (red over blue, 0..1): the near-black brown of the worn gloves and boot linings, which is grime. */
export const WARM_MIN = 0.02;

/**
 * Which pieces of the atlas are dark parts: the pixels of a piece are told apart as a whole, not one by one, since a stain
 * on the cloth is as dark as a bearing (l ≈ 0.06 against 0.10 in the Z-2) and only the piece it lies on says which it is.
 * A dark piece is dark and neutral on average; the cloth is light on average, however stained.
 * @param {Uint8ClampedArray|Uint8Array} rgba the colour atlas
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} mask pieceMask, same size
 * @returns {Uint8Array} 1 where the pixel lies on a dark part, 0 elsewhere (and on the background)
 */
export function darkParts(rgba, w, h, mask) {
  const label = new Int32Array(w * h).fill(-1), stats = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = stats.length;
    let n = 0, lsum = 0, warm = 0;
    label[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
      lsum += (Math.max(r, g, b) + Math.min(r, g, b)) / 2; warm += r - b; n++;
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i >= w ? i - w : -1, i + w < w * h ? i + w : -1]) {
        if (j >= 0 && mask[j] && label[j] < 0) { label[j] = id; stack.push(j); }
      }
    }
    stats.push(lsum / n < DARK_PIECE_MAX && warm / n < WARM_MIN);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = label[i] >= 0 && stats[label[i]] ? 1 : 0;
  return out;
}
