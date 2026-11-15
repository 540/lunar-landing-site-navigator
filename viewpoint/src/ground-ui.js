// The button of the ground on foot (E3, #181): «Textura fina», the illustrative layer, on by default. Only on foot.
import { UI } from './texts.js';

const T = UI.ground; // loaded with the scene, once useLang() has chosen the language

export function setupGround(view, { onChange = () => {} } = {}) {
  const ground = view.ground;
  if (!ground) return;
  const micro = document.getElementById('micro-btn');
  micro.textContent = T.micro; micro.title = T.microTitle;
  const paint = () => {
    micro.setAttribute('aria-pressed', String(ground.micro));
    micro.hidden = !view.foot?.active;
  };
  micro.addEventListener('click', ev => { ground.setMicro(!ground.micro); paint(); onChange(ground.micro); if (ev.detail > 0) micro.blur(); });
  view.foot?.onModeChange(paint);
  paint();
  return { paint };
}
