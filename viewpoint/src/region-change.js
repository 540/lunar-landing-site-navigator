// Orchestration of the region change (E7.2, #497). Everything it touches comes in as a parameter (document, window, storage,
// scene, preload, navigation, timers), so the tests drive it with fakes.
import { prefersReducedMotion } from './core/motion.js';
import { createPreloadProgress, transitionMode, settlePreload, decideChange, ARRIVE_KEY, FADE_MS } from './core/region-transition.js';

export const FOCUS_KEY = 'viewpoint-region-focus';

/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {Window} o.win
 * @param {Storage} o.storage
 * @param {() => any} o.getView the 3D scene (null if it could not load)
 * @param {object} o.texts UI.regionTransition
 * @param {(id:string, onProgress:Function, signal:AbortSignal) => Promise<any>} o.preload
 * @param {(id:string) => void} o.navigate
 * @param {() => void} o.openVeil
 * @param {{setTimeout:Function, setInterval:Function, clearInterval:Function}} [o.timers]
 */
export function createRegionChange({ doc, win, storage, getView, texts: T, preload, navigate, openVeil, timers = { setTimeout: (f, ms) => setTimeout(f, ms), setInterval: (f, ms) => setInterval(f, ms), clearInterval: t => clearInterval(t) } }) {
  const $ = id => doc.getElementById(id);
  let changing = false;
  let undoChange = null; // puts the page back as it was before the change (cancel, or back from the bfcache)
  // Coming back (Back button) the browser may restore the page from its cache with the transition still on screen.
  win.addEventListener('pageshow', e => { if (e.persisted && undoChange) undoChange(); });

  /**
   * The camera rises (or the screen fades out) while the files of the destination preload, with a progress bar; then it
   * navigates, as always. If the preload fails or takes too long it navigates anyway. Escape or the button cancel it while
   * the page has not navigated yet.
   */
  async function change(id, name) {
    changing = true;
    const view = getView();
    const mode = transitionMode({ reducedMotion: prefersReducedMotion(win), qualityLevel: view?.quality?.level, hasScene: !!view });
    const box = $('region-progress'), bar = $('region-progress-bar');
    const progress = createPreloadProgress();
    const paint = () => {
      const pct = Math.round(progress.value * 100);
      bar.setAttribute('aria-valuenow', String(pct));
      bar.setAttribute('aria-valuetext', T.percent(pct));
      $('region-progress-fill').style.width = `${pct}%`;
    };
    bar.setAttribute('aria-label', T.progressLabel);
    $('region-progress-text').textContent = T.loading(name);
    paint();
    box.hidden = false;
    const abort = new AbortController();
    let cancelled = false;
    const flight = mode === 'flight' ? view.ascend() : null;
    if (!flight) $('region-veil').classList.add('is-on');
    // The rest of the page is out of reach (keyboard and screen reader) while it changes; the cancel button gets the focus.
    const behind = [...doc.body.children].filter(el => el !== box && el.id !== 'region-veil' && !el.inert);
    behind.forEach(el => { el.inert = true; });
    const cancelBtn = $('region-cancel');
    cancelBtn.textContent = T.cancel;
    const cancel = () => { cancelled = true; abort.abort(); };
    cancelBtn.addEventListener('click', cancel);
    cancelBtn.focus();
    let restored = null;
    undoChange = () => (restored = (async () => {
      undoChange = null;
      cancel(); // also ends the wait below when the undo comes from the bfcache
      box.hidden = true;
      behind.forEach(el => { el.inert = false; });
      cancelBtn.removeEventListener('click', cancel);
      if (flight) await flight.cancel(); else openVeil();
      changing = false;
      $('region-select').focus();
    })());
    const onKey = e => { if (e.key === 'Escape') cancel(); };
    win.addEventListener('keydown', onKey);
    const preloading = preload(id, files => { progress.update(files); paint(); }, abort.signal);
    let poll;
    const outcome = await Promise.race([
      Promise.all([settlePreload(preloading), flight ? flight.done : new Promise(r => timers.setTimeout(r, FADE_MS))]),
      new Promise(r => { poll = timers.setInterval(() => { if (cancelled) r(null); }, 50); }),
    ]);
    timers.clearInterval(poll);
    win.removeEventListener('keydown', onKey);
    if (decideChange({ outcome: outcome?.[0] ?? null, cancelled }) === 'restore') {
      await (undoChange?.() ?? restored);
      return 'restored';
    }
    if (outcome[0] === 'ready') { progress.update([{ loaded: 1, total: 1, done: true }]); paint(); }
    storage.setItem(FOCUS_KEY, '1');
    storage.setItem(ARRIVE_KEY, mode);
    navigate(id);
    return 'navigated';
  }

  return { change, get changing() { return changing; } };
}
