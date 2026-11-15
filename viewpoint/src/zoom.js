import { UI } from './texts.js';
import { modalOpen } from './core/camera-input.js';

// Zoom (+ / −) on the right of the scene (the region viewer, main.js, and the mission viewer, mission.js), and the same with the + and − keys, unless you are typing in a field.
let current = null, keys = false;
export function setupZoom(view) {
  current = view; // a new scene (another region) takes the buttons over
  const box = document.getElementById('zoom');
  box.setAttribute('aria-label', UI.zoom.group);
  for (const [id, label, factor] of [['zoom-in', UI.zoom.in, 0.7], ['zoom-out', UI.zoom.out, 1 / 0.7]]) {
    const b = document.getElementById(id);
    b.setAttribute('aria-label', label); b.title = label;
    if (!b.dataset.wired) { b.dataset.wired = '1'; b.addEventListener('click', () => current?.zoom(factor)); }
  }
  box.hidden = false;
  if (keys) return;
  keys = true;
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea') || modalOpen(document)) return;
    if (e.key === '+' || e.key === '=') current?.zoom(0.7);
    else if (e.key === '-' || e.key === '_') current?.zoom(1 / 0.7);
  });
}
