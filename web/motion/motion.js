// Motion helpers (proposal). When adopted, this file moves to js/common/motion.js.
// All of them honour reduced motion: they jump straight to the final value.

const mq = matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => mq.matches || document.documentElement.dataset.motion === 'off';

// Easings for canvas animation (the CSS ones live in motion.css).
export const ease = {
  linear: t => t,
  standard: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: t => 1 - Math.pow(1 - t, 4),
  in: t => t * t * t,
  spring: t => (t >= 1 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(7 * t)), // overshoots 4 % and settles
};

// Animates a number from `from` to `to`. Returns a function that cancels it.
export function tween({ from = 0, to = 1, ms = 280, easing = ease.out, delay = 0, step, done }) {
  if (reducedMotion() || ms <= 0) { step(to, 1); done?.(); return () => {}; }
  let id, start = null;
  const frame = now => {
    if (start === null) start = now + delay;
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    if (now >= start) step(from + (to - from) * easing(t), t);
    if (t < 1) id = requestAnimationFrame(frame); else done?.();
  };
  id = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(id);
}

// A value that can be retargeted half-way (an arc, an opacity).
// For canvases: every change calls `onChange`, which repaints.
export function animatedValue(initial, { ms = 280, easing = ease.out } = {}, onChange = () => {}) {
  let v = initial, cancel = null;
  return {
    get v() { return v; },
    set(x) { cancel?.(); cancel = null; v = x; onChange(v); },
    to(target, o = {}) {
      cancel?.();
      cancel = tween({ from: v, to: target, ms: o.ms ?? ms, easing: o.easing ?? easing, delay: o.delay ?? 0, step: x => { v = x; onChange(v); }, done: o.done });
    },
  };
}

// Counts up to a number inside an element, starting from the value it had.
export function countTo(el, to, { format = n => String(Math.round(n)), ms = 600, from } = {}) {
  el._cancel?.();
  const start = from ?? el._value ?? to;
  if (start === to) { el._value = to; el.textContent = format(to); return; }
  el._cancel = tween({ from: start, to, ms, step: v => { el._value = v; el.textContent = format(v); } });
}

// Restarts a CSS class animation (.motion-flash, .motion-enter…).
export function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

// FLIP: elements with data-flip travel from their old place to the new one.
// `getElements` returns the current list; `mutate` changes the DOM.
export function flip(getElements, mutate, { ms = 480, easing = 'cubic-bezier(0.16, 1, 0.3, 1)' } = {}) {
  const before = new Map(getElements().map(e => [e.dataset.flip, e.getBoundingClientRect()]));
  mutate();
  if (reducedMotion()) return;
  for (const e of getElements()) {
    const a = before.get(e.dataset.flip), b = e.getBoundingClientRect();
    if (!a) { e.animate([{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }], { duration: ms, easing }); continue; }
    const dx = a.left - b.left, dy = a.top - b.top;
    if (dx || dy) e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing });
  }
}

// View change with View Transitions; without support it just changes.
export function viewTransition(change) {
  if (!document.startViewTransition || reducedMotion()) { change(); return null; }
  return document.startViewTransition(change);
}

// Mission player: advances fractional hours at a constant pace, so the Sun, the Earth
// and the shadows glide instead of jumping 2 h at a time.
export function createPlayer({ max, hoursPerSecond = 18, onTick, onToggle = () => {} }) {
  let id = null, last = 0, h = 0;
  const frame = now => {
    h += (Math.min(64, now - last) / 1000) * hoursPerSecond; last = now;
    if (h > max()) h = 0;
    onTick(h);
    id = requestAnimationFrame(frame);
  };
  return {
    get playing() { return id !== null; },
    get hour() { return h; },
    seek(x) { h = Math.max(0, Math.min(max(), x)); onTick(h); },
    stop() { if (id !== null) { cancelAnimationFrame(id); id = null; onToggle(false); } },
    toggle() {
      if (id !== null) { this.stop(); return false; }
      last = performance.now(); id = requestAnimationFrame(frame); onToggle(true);
      return true;
    },
  };
}

// Mixes two colours (#rrggbb or rgb()) for canvas cross-fades.
const toRgb = c => {
  if (c[0] === '#') { const n = parseInt(c.length === 4 ? c.slice(1).replace(/./g, x => x + x) : c.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  return (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
};
export function mix(a, b, t, alpha = 1) {
  const x = toRgb(a), y = toRgb(b);
  return `rgba(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(', ')}, ${alpha})`;
}
