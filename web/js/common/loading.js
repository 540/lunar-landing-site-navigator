// The loading screen of the planner (#443): one component, #data-loading in web/index.html, for every wait on the
// visibility windows (the first search, the next ones and a change of dates that has to load them again).
// It only shows after a short wait, so an answer from the cache or the simulated engine does not flicker; after a
// longer one it says why; and a failure takes its place with the error and a way to try again.
const SHOW_AFTER_MS = 300;
const SLOW_AFTER_MS = 4000;

let current = null; // the wait on screen: a newer one replaces it, and an older one that ends does not hide it

/**
 * Starts a wait. `busy`: the element being reloaded, which gets aria-busy while the loader is visible.
 * @returns {{ done: () => void, fail: (message: string, retry: () => void) => void }}
 */
export function startLoading(busy, doc = document) {
  const $ = id => doc.getElementById(id);
  const box = $('data-loading'), slow = $('data-loading-slow'), error = $('data-loading-error'), retry = $('data-loading-retry');
  current?.stop();
  const timers = [];
  const handle = {
    stop() {
      timers.forEach(clearTimeout);
      busy?.removeAttribute('aria-busy');
    },
    done() {
      if (current !== handle) return;
      handle.stop(); current = null;
      box.hidden = true;
    },
    fail(message, onRetry) {
      if (current !== handle) return;
      handle.stop(); current = null;
      box.classList.add('is-error');
      slow.hidden = true;
      error.textContent = message;
      error.hidden = retry.hidden = false;
      box.hidden = false;
      retry.onclick = () => { box.hidden = true; onRetry(); };
    },
  };
  current = handle;
  box.classList.remove('is-error');
  error.hidden = retry.hidden = slow.hidden = true;
  timers.push(setTimeout(() => { box.hidden = false; busy?.setAttribute('aria-busy', 'true'); }, SHOW_AFTER_MS));
  timers.push(setTimeout(() => { slow.hidden = false; }, SLOW_AFTER_MS));
  return handle;
}
