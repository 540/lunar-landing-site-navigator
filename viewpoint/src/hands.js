import { UI } from './texts.js';
import { createHandPointer } from '../../shared/hands/pointer.js';
import { celebrateSalute } from './salute.js';

// Hand control of the Mirador (shared/hands/pointer.js): the index points and the thumb clicks any control; a pinch turns
// the camera around the point it looks at and zooms, and a salute as the astronaut's makes stars and 540 patches come out of
// the helmet (salute.js). `getView` gives the 3D scene, or null while there is none.
const HAND_GAIN = 1.5; // the hand crossing a third of the height of the camera image is a quarter turn
export function setupHands(getView) {
  const button = document.getElementById('hands-btn');
  button.setAttribute('aria-label', UI.hands.label);
  button.hidden = false;
  createHandPointer({
    buttons: [button],
    labels: { on: UI.hands.on, off: UI.hands.off },
    canDrag: () => !!getView(),
    onDrag: (dx, dy) => getView().orbit(dx * HAND_GAIN, dy * HAND_GAIN),
    onZoom: factor => getView().dolly(1 / factor),
    onSalute: () => celebrateSalute(getView()?.astronautOnScreen()),
  });
}
