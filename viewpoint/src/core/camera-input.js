// Input rules of the tour camera (E2.1, #152). Pure: no three.js, no DOM events, so they can be tested.

/** True if the keyboard event goes to a form control or an editable element: the camera keys must leave it alone. */
export function isFormTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName ?? '').toLowerCase();
  return ['input', 'select', 'textarea', 'button'].includes(tag) || target.isContentEditable === true;
}

/**
 * True while a modal is over the scene: an open <dialog> («Fuentes») or the tutorial. The options drawer (#options) is
 * non modal and does not count: its own controls are already form targets. Its keys are not for the camera,
 * which listens on the window and would move behind it.
 * @param {{ querySelector(selector: string): unknown } | null | undefined} doc
 */
export const modalOpen = doc => !!doc?.querySelector?.('dialog[open]:not(#options), .tour:not([hidden])');

/**
 * Double tap detector. Feed it `{type: 'down'|'up'|'cancel', id, x, y, t}` of touch pointers; `up` returns true when it
 * completes a double tap. A tap is a finger that goes down and up within `maxPx`; a second finger (pinch, two-finger pan)
 * or a drag is not a tap, and a cancel forgets the first tap.
 */
export function createDoubleTapDetector({ maxMs = 300, maxPx = 20, touchEchoMs = 800 } = {}) {
  const fingers = new Set();
  let down = null, lastTap = null, lastTouchAt = -Infinity;
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < maxPx;
  return {
    handle(ev) {
      if (ev.type === 'down') {
        fingers.add(ev.id);
        down = fingers.size === 1 ? { id: ev.id, x: ev.x, y: ev.y } : null;
        if (fingers.size > 1) lastTap = null;
        return false;
      }
      if (ev.type === 'cancel') { fingers.delete(ev.id); down = null; lastTap = null; return false; }
      lastTouchAt = ev.t;
      fingers.delete(ev.id);
      const tap = down && down.id === ev.id && near(ev, down);
      down = null;
      if (!tap) { lastTap = null; return false; }
      if (lastTap && ev.t - lastTap.t < maxMs && near(ev, lastTap)) { lastTap = null; return true; }
      lastTap = { t: ev.t, x: ev.x, y: ev.y };
      return false;
    },
    /** The browser also fires a dblclick after a double tap: it is ignored if a touch ended within `touchEchoMs`. */
    isTouchEcho(t) { return t - lastTouchAt <= touchEchoMs; },
  };
}
