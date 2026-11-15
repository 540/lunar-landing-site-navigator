// Labels «Sol» and «Tierra» over their discs in the scene (#label-sun, #label-earth), shared by the mission viewer (V1.3)
// and the exploration (E1.4). Where each goes is core/sky-labels.js (labelPlacement): over its disc while it fits and,
// off screen, held whole at the edge with an arrow to where the body is, clear of the column of buttons on the right.

import { labelPlacement } from './core/sky-labels.js';

/**
 * @param {{labels: () => {sun: object|null, earth: object|null}}} view the scene
 * @param {{sun?: {seen: boolean, name: string, detail?: string}, earth?: {seen: boolean, name: string, detail?: string}}} bodies
 *   `detail` (the countdown in the exploration) goes after the name: «Sol · se pone en 14 h»
 */
export function placeSkyLabels(view, bodies) {
  const at = view.labels(), w = window.innerWidth, h = window.innerHeight;
  // The column of buttons on the right edge (on foot, zoom, watch…): the labels stay clear of it.
  const rail = document.querySelector('.side')?.getBoundingClientRect(), rightReserve = rail?.width ? w - rail.left + 8 : 0;
  // Nor over the top bar, the region selector or the title, which on a phone take several rows.
  const clear = Math.max(0, ...['.topbar', '#region-picker', '#title'].map(sel => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r?.height ? r.bottom : 0;
  }));
  const top = Math.max(112, clear + 16);
  const placed = []; // boxes of the labels already placed: the second one steps down if they meet
  for (const body of ['sun', 'earth']) {
    const el = document.getElementById(`label-${body}`), p = at[body], info = bodies[body];
    el.hidden = !p || !info;
    if (el.hidden) continue;
    const text = info.detail ? `${info.name} · ${info.detail}` : info.name;
    const side = labelPlacement(p, { width: w, height: h, labelWidth: 0 }).arrow;
    const shown = side === 'left' ? `← ${text}` : side === 'right' ? `${text} →` : text;
    if (el.textContent !== shown) el.textContent = shown;
    // Measured with its final text: the clamp keeps the whole label inside the view.
    const { x, y: at0, edge } = labelPlacement(p, { width: w, height: h, labelWidth: el.offsetWidth, rightReserve, top });
    const half = el.offsetWidth / 2, tall = el.offsetHeight + 6;
    let y = at0;
    for (const o of placed) if (Math.abs(o.x - x) < o.half + half && Math.abs(o.y - y) < tall) y = o.y + tall;
    placed.push({ x, y, half });
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.dataset.seen = String(info.seen);
    if (edge || y !== at0) el.dataset.edge = ''; else delete el.dataset.edge;
  }
}
