// Bridge between the CSS tokens (styles/tokens.css) and the canvases.
// Charts do not hard-code colours or fonts: they read them here, so changing
// a token also changes maps, clocks and charts.

import { t } from './i18n.js';

const read = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Resolved semantic tokens. Call it once per drawing, not per stroke.
export function theme() {
  return {
    bg: read('--color-bg'),
    surface: read('--color-surface'),
    surfaceRaised: read('--color-surface-raised'),
    text: read('--color-text'),
    muted: read('--color-text-muted'),
    border: read('--color-border'),
    sun: read('--color-sun'),
    earth: read('--color-earth'),
    terrain: read('--color-terrain'),
    ok: read('--color-ok'),
    warn: read('--color-warn'),
    bad: read('--color-bad'),
    mapBg: read('--color-map-bg'),
    mapLine: read('--color-map-line'),
    mapText: read('--color-map-text'),
    mapTextSoft: read('--color-map-text-soft'),
    mapMark: read('--color-map-mark'),
    mapLabelBg: read('--color-map-label-bg'),
    mapSun: read('--color-map-sun'),
    mapEarth: read('--color-map-earth'),
    mapOk: read('--color-map-ok'),
    mapWarn: read('--color-map-warn'),
    mapBad: read('--color-map-bad'),
    mapMuted: read('--color-map-muted'),
    fontDisplay: read('--font-display'),
    fontBody: read('--font-body'),
    fontData: read('--font-data'),
  };
}

// Design system tone of each verdict code from the engine.
export const VERDICT_TONE = { viable: 'ok', marginal: 'warn', not_viable: 'bad' };
// CSS colour (variable) of a verdict, for inline styles.
export const verdictCssVar = code => `var(--color-${VERDICT_TONE[code]})`;

// ---------------- Light / dark ----------------
// js/theme-init.js sets data-theme on <html> before the first paint. Dark is the default, whatever the system
// says: the page is space. Light only when the person chooses it with the toggle (the choice is saved).
const KEY = 'llsn.theme';
const saved = () => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; } };

export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function apply(mode) { document.documentElement.dataset.theme = mode; }

// Wires the top-bar toggle. onChange repaints the canvases (they read the tokens when they draw).
export function initThemeToggle(button, onChange) {
  const label = () => {
    const light = currentTheme() === 'light';
    const text = t(light ? 'common.theme.toDark' : 'common.theme.toLight');
    button.setAttribute('aria-label', text);
    button.title = text;
    button.dataset.mode = currentTheme();
  };
  apply(saved() ?? 'dark');
  label();
  button.addEventListener('click', () => {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch { /* not saved: it lasts until the page reloads */ }
    const swap = () => { apply(next); label(); onChange(); };
    // The new face sweeps over the page from the button with a soft terminator (styles/base.css, View Transitions).
    // Without the API, or if the system asks for reduced motion, the change is instant.
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap();
    const r = button.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const root = document.documentElement.style;
    root.setProperty('--vt-x', `${x}px`);
    root.setProperty('--vt-y', `${y}px`);
    root.setProperty('--vt-r', `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    document.startViewTransition(swap);
  });
}
