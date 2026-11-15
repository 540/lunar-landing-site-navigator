// Guided tour engine: a spotlight that walks through the elements of a page in the order to use them.
// No dependencies beyond tour-memory.js (what is remembered in localStorage), so any screen of the site can use it
// (web/, home/, viewpoint/ and rolegame/ do), together with web/styles/tour.css and web/styles/tokens.css.
// The steps belong to each screen: web/js/common/tour.js, home/index.html.
import { markSeen, disableAutoTours, shouldAutoStart } from './tour-memory.js';
import { tourLabels } from './tour-labels.js';

export { DEFAULT_LABELS, tourLabels } from './tour-labels.js';

// ---------------- Overlay ----------------
const GAP = 14, MARGIN = 12, PAD = 6, DRIFT = 24;
let root = null, spot = null, pop = null;
let tour = null; // { view, steps, i, last, raf, returnFocus }

function build() {
  root = document.createElement('div');
  root.className = 'tour'; root.hidden = true;
  root.innerHTML = `<div class="tour__spot"></div>
    <div class="tour__pop" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      <span class="tour__count" id="tour-count"></span>
      <h2 id="tour-title"></h2>
      <p id="tour-text"></p>
      <div class="tour__actions">
        <button type="button" class="tour__skip" data-tour="skip">Saltar el tutorial</button>
        <button type="button" class="tour__btn" data-tour="more">Saber más</button>
        <button type="button" class="tour__btn" data-tour="prev">Anterior</button>
        <button type="button" class="tour__btn tour__btn--primary" data-tour="next">Siguiente</button>
      </div>
      <button type="button" class="tour__never" data-tour="never">No mostrar más tutoriales</button>
    </div>`;
  document.body.appendChild(root);
  spot = root.querySelector('.tour__spot'); pop = root.querySelector('.tour__pop');
  root.addEventListener('click', e => {
    const action = e.target.closest('[data-tour]')?.dataset.tour;
    if (action === 'skip') endTour();
    else if (action === 'never') { disableAutoTours(); endTour(); }
    else if (action === 'prev') show(tour.i - 1);
    else if (action === 'next') next();
    else if (action === 'more') more();
  });
}

const isVisible = el => !!el && el.getClientRects().length > 0;
const targetOf = step => { const el = document.querySelector(step.target); return isVisible(el) ? el : null; };
const button = name => pop.querySelector(`[data-tour="${name}"]`);

// Sticky or fixed elements (a top bar) are always on screen: scrolling to them would only move the page.
function isPinned(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const position = getComputedStyle(n).position;
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
}
function bringIntoView(el) {
  if (isPinned(el)) return;
  const r = el.getBoundingClientRect(), top = 90, room = innerHeight - top - MARGIN;
  if (r.top >= top && r.bottom <= innerHeight - MARGIN) return;
  scrollBy({ top: r.height > room ? r.top - top : r.top - top - (room - r.height) / 2, behavior: 'instant' });
}

function show(i) {
  tour.i = i; tour.last = ''; tour.anchor = null;
  const step = tour.steps[i], total = tour.steps.length, isLast = i === total - 1, L = tour.labels;
  root.querySelector('#tour-count').textContent = total > 1 ? L.count(i + 1, total) : L.single;
  button('skip').textContent = L.skip;
  button('more').textContent = L.more;
  button('prev').textContent = L.prev;
  button('never').textContent = L.never;
  root.querySelector('#tour-title').textContent = step.title;
  root.querySelector('#tour-text').textContent = step.text;
  button('prev').hidden = i === 0;
  button('more').hidden = !(step.more && tour.onMore);
  button('skip').hidden = isLast;
  button('never').hidden = !tour.auto; // only on the tour that opened by itself (#205)
  button('next').textContent = isLast ? L.done : L.next;
  const el = targetOf(step);
  if (el) bringIntoView(el);
  // The spotlight glides between steps, but follows scroll and layout changes without lag.
  root.classList.add('tour--moving');
  clearTimeout(tour.moving);
  tour.moving = setTimeout(() => root.classList.remove('tour--moving'), 320);
  place();
  button('next').focus({ preventScroll: true });
  tour.onStep?.(step, el); // after the focus moves: the page may react to the blur of its own elements
}

// Runs every frame while the tour is open: the target can move (scroll, animations, repaints).
function place() {
  const el = targetOf(tour.steps[tour.i]);
  const r = el ? el.getBoundingClientRect() : null;
  const vw = innerWidth, vh = innerHeight, pw = pop.offsetWidth, ph = pop.offsetHeight;
  const signature = r ? [r.left, r.top, r.width, r.height, vw, vh, pw, ph].join() : `none,${vw},${vh},${pw},${ph}`;
  if (signature === tour.last) return;
  tour.last = signature;
  const clampX = x => Math.max(MARGIN, Math.min(x, vw - pw - MARGIN));
  const clampY = y => Math.max(MARGIN, Math.min(y, vh - ph - MARGIN));
  spot.hidden = !r;
  if (!r) { tour.anchor = null; pop.style.left = clampX((vw - pw) / 2) + 'px'; pop.style.top = clampY((vh - ph) / 2) + 'px'; return; }
  Object.assign(spot.style, { left: r.left - PAD + 'px', top: r.top - PAD + 'px', width: r.width + PAD * 2 + 'px', height: r.height + PAD * 2 + 'px' });
  // The spotlight follows every pixel; the popover only moves when the target has really moved,
  // so it stays still (and clickable) over elements that drift, like the labels of home/.
  const a = tour.anchor, frame = [vw, vh, pw, ph].join();
  if (a && a.frame === frame && ['left', 'top', 'right', 'bottom'].every(k => Math.abs(a[k] - r[k]) < DRIFT)) return;
  tour.anchor = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, frame };
  // Visible part of the target: a tall element is treated as what is on screen.
  const v = { left: Math.max(r.left, 0), right: Math.min(r.right, vw), top: Math.max(r.top, 0), bottom: Math.min(r.bottom, vh) };
  const cx = clampX((v.left + v.right) / 2 - pw / 2);
  let x, y;
  if (v.bottom + PAD + GAP + ph <= vh - MARGIN) { x = cx; y = v.bottom + PAD + GAP; }             // below
  else if (v.top - PAD - GAP - ph >= MARGIN) { x = cx; y = v.top - PAD - GAP - ph; }              // above
  else if (v.right + PAD + GAP + pw <= vw - MARGIN) { x = v.right + PAD + GAP; y = clampY(v.top); } // right
  else if (v.left - PAD - GAP - pw >= MARGIN) { x = v.left - PAD - GAP - pw; y = clampY(v.top); }   // left
  else { x = clampX(v.right - pw - GAP); y = clampY(v.bottom - ph - GAP); }                       // inside, bottom corner
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}
function track() {
  if (!tour) return;
  place();
  tour.raf = requestAnimationFrame(track);
}

function next() {
  if (tour.i === tour.steps.length - 1) endTour(); else show(tour.i + 1);
}
// «Saber más»: leaves the tour and hands the current step to the page (web/ opens its explanation card).
function more() {
  const step = tour.steps[tour.i], el = targetOf(step), { onMore } = tour;
  endTour();
  onMore(step, el);
}

// Capture phase, and the event stops here: the page's own shortcuts (Escape in home/) do not fire under the tour.
function onKey(e) {
  if (!tour || !['Escape', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') endTour();
  else if (e.key === 'ArrowRight') next();
  else if (tour.i > 0) show(tour.i - 1);
}
document.addEventListener('keydown', onKey, true);

// The rest of the page stops taking clicks and focus while the tour is open.
function setPageInert(on) {
  for (const el of document.body.children) if (el !== root && el.tagName !== 'SCRIPT') el.inert = on;
}

// id: what is remembered as seen (a view or a screen). steps: [{ target, title, text, more? }]; target is a CSS
// selector and steps whose target is missing or hidden are skipped. Options:
//   onMore(step, el)  «Saber más» on steps with more: true
//   onStep(step, el)  a step is shown (e.g. to highlight something in a canvas)
//   onEnd()           the tour closes, however it ends
//   auto              set by startTourIfNew: the tour opened by itself, so it offers «No mostrar más tutoriales»
//   labels            button texts in another language (see DEFAULT_LABELS); without it, Spanish
export function startTour(id, allSteps, { onMore = null, onStep = null, onEnd = null, auto = false, labels = null } = {}) {
  if (tour) endTour();
  if (!root) build();
  const steps = (allSteps || []).filter(targetOf);
  if (!steps.length) return;
  tour = { view: id, steps, onMore, onStep, onEnd, auto, labels: tourLabels(labels), i: 0, last: '', raf: 0, moving: 0, returnFocus: document.activeElement };
  root.hidden = false;
  setPageInert(true);
  show(0);
  tour.raf = requestAnimationFrame(track);
}

export function endTour() {
  if (!tour) return;
  const { view, raf, moving, returnFocus, onEnd } = tour;
  tour = null;
  cancelAnimationFrame(raf); clearTimeout(moving);
  markSeen(view);
  root.hidden = true;
  setPageInert(false);
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  onEnd?.();
}

// Starts the tour only the first time that id is opened in this browser, unless the user turned the automatic
// tours off («No mostrar más tutoriales», #205).
export function startTourIfNew(id, steps, options) {
  if (tour && tour.view !== id) endTour();
  if (!tour && shouldAutoStart(id)) startTour(id, steps, { ...options, auto: true });
}
