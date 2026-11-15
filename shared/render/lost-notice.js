/* "3D not available" notice (#144): #glost replaces the 3D scene with links to other screens and a reload button.
   Used by the home page (home/index.html) and, since G1.2b (#286), by the Mirador (viewpoint/src/lost.js). It gets
   its elements as arguments, so tests/lost-notice.test.mjs can run it with a small fake DOM. */

/* show(): the notice appears, #loading goes away, the rest of the page turns inert (no focus, hidden from assistive
   technology) and focus moves to the first link. hide(): the reverse, and focus goes back to where it was before the
   notice, or to fallbackFocus() if that element is gone or cannot take focus any more.
   roots: the elements whose children turn inert (except the notice and the roots themselves). */
export function createLostNotice({ notice, loading, roots, fallbackFocus }) {
  const doc = notice.ownerDocument;
  let returnTo = null;
  const setInert = on => {
    for (const root of roots) for (const el of root.children) if (el !== notice && !roots.includes(el)) el.inert = on;
  };
  return {
    show() {
      if (!notice.hidden) return;
      const active = doc.activeElement;
      returnTo = active && active !== doc.body && !notice.contains(active) ? active : null;
      notice.hidden = false;
      if (loading) loading.hidden = true;
      setInert(true);
      notice.querySelector('a').focus({ preventScroll: true });
    },
    hide() {
      if (notice.hidden) return;
      notice.hidden = true;
      setInert(false);
      const to = returnTo;
      returnTo = null;
      if (to && to.isConnected) to.focus({ preventScroll: true });
      if (!to || doc.activeElement !== to) fallbackFocus?.()?.focus({ preventScroll: true });
    },
    visible: () => !notice.hidden,
  };
}

/* Context loss of the canvas: the notice on webglcontextlost (preventDefault, so the context can come back), unless
   deferWhile() says to wait (the mission screen, which needs no WebGL, is open: showIfLost() shows it on leaving).
   On webglcontextrestored three.js rebuilds its state: the notice goes away and onRestore() runs. */
export function watchContextLoss(canvas, { notice, deferWhile = () => false, onRestore }) {
  let lost = false;
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; if (!deferWhile()) notice.show(); });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; notice.hide(); onRestore?.(); });
  return {
    lost: () => lost,
    showIfLost() { if (lost) notice.show(); return lost; },
  };
}

/* Creates the renderer with make(); if that throws (no WebGL), shows the notice and rethrows, so the rest of the
   scene does not run. */
export function createRendererOrNotice(make, notice) {
  try { return make(); } catch (err) { notice.show(); throw err; }
}
