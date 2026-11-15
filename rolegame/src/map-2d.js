// Light map (J0, kept as the J10.4 light mode): map.png in a 2D canvas and a veil from the Sun fraction of each
// cell (sun.bin). No WebGL and no three.js: it works on any device and it is what the full map falls back to.

// Opacity 0..255 of the shade veil over a cell: full Sun none, full shadow SHADOW_VEIL, so the relief of map.png
// still reads in shadow (#309; it was 200, nearly black).
export const SHADOW_VEIL = 165;
export const veilAlpha = (sunFrac) => Math.round((1 - sunFrac) * SHADOW_VEIL);

/** canvas: the 2D map canvas. images.map: map.png loaded. Returns { mode: '2d', paint(ctx, hour) }. */
export function createMap2d({ canvas, tables, images }) {
  const n = tables.n;
  const veil = document.createElement('canvas');
  veil.width = n; veil.height = n;
  const veilCtx = veil.getContext('2d');
  const veilData = veilCtx.createImageData(n, n);

  function paintVeil(hour) {
    for (let i = 0; i < n * n; i++) veilData.data[i * 4 + 3] = veilAlpha(tables.sunFrac(i, hour));
    veilCtx.putImageData(veilData, 0, 0);
  }
  function paint(ctx, hour) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(images.map, 0, 0, canvas.width, canvas.height);
    paintVeil(hour);
    ctx.drawImage(veil, 0, 0, canvas.width, canvas.height);
  }
  return { mode: '2d', paint };
}
