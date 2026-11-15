// The drawer of options (E8.2, #498): open and close, the focus and the keys. It works on the elements it is given
// (a <dialog> opened without blocking the page, and its button), so tests can use fakes. Keys: O toggles, Esc closes.
import { isFormTarget, modalOpen } from './camera-input.js';
import { isOptionsKey } from './options.js';

export function createDrawer({ dialog, button, doc, onToggle = () => {} }) {
  const isOpen = () => dialog.open === true;
  const open = () => {
    if (isOpen()) return;
    dialog.show();
    button.setAttribute('aria-expanded', 'true');
    dialog.focus?.(); // on the drawer itself, so O still closes it
    onToggle(true);
  };
  const close = () => {
    if (!isOpen()) return;
    dialog.close();
    button.setAttribute('aria-expanded', 'false');
    button.focus?.();
    onToggle(false);
  };
  const toggle = () => (isOpen() ? close() : open());
  const onKey = ev => {
    // Another dialog on top («Fuentes», the tutorial) keeps its own Esc
    const otherModal = !!doc.querySelector?.(`dialog[open]${dialog.id ? `:not(#${dialog.id})` : ''}, .tour:not([hidden])`);
    if (ev.key === 'Escape' && isOpen() && !otherModal) { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if (isOptionsKey(ev, { isFormTarget: t => t !== button && isFormTarget(t), modalOpen: modalOpen(doc), drawerOpen: isOpen() })) { ev.preventDefault(); ev.stopPropagation(); toggle(); }
  };
  button.addEventListener('click', toggle);
  // Capture on the document: before the window listeners of the camera and the foot view see the key
  doc.addEventListener('keydown', onKey, true);
  return { open, close, toggle, isOpen };
}
