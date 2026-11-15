// Where the labels «Sol» and «Tierra» go over the mission viewer (V1.3). Pure: no DOM, so node:test can check it.

/**
 * Centre (CSS px) of the label of a body projected at `p`: over its disc while the whole label fits, and otherwise held
 * whole inside the view, clear of the top bar (`top`), of the HUD (`bottomRatio` of the height) and of the zoom buttons
 * (`rightReserve` px from the right edge), so it is never cut and never makes the page wider.
 * `edge`: it was moved from its disc; `arrow`: 'left' or 'right' when the body is off that side of the view.
 */
export function labelPlacement(p, { width, height, labelWidth, margin = 24, rightReserve = 0, top = 112, bottomRatio = 0.55 }) {
  const half = labelWidth / 2;
  const minX = margin + half, maxX = Math.max(minX, width - Math.max(margin, rightReserve) - half);
  const x = Math.min(maxX, Math.max(minX, p.x)), y = Math.min(height * bottomRatio, Math.max(top, p.y));
  const edge = x !== p.x || y !== p.y;
  const arrow = p.x < margin * 2 ? 'left' : p.x > width - margin * 2 ? 'right' : null;
  return { x, y, edge, arrow };
}
