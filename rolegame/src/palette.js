// Colours of the game for what CSS does not paint (canvas, SVG icons, three.js), read from the variables of
// styles/game.css so there is one value per colour (#341): --good, --warn and --bad come from web/styles/tokens.css.
// Read on first use and kept; without a DOM (tests) every colour is ''.

const VARS = { sun: '--sun', earth: '--earth', good: '--good', warn: '--warn', bad: '--bad' };
let cache = null;

/** The game's colours { sun, earth, good, warn, bad } as CSS colour strings (e.g. '#f2a33a'). */
export function gameColors(root = globalThis.document?.documentElement) {
  if (cache) return cache;
  const style = root && globalThis.getComputedStyle ? globalThis.getComputedStyle(root) : null;
  const colors = {};
  for (const [key, name] of Object.entries(VARS)) colors[key] = style ? style.getPropertyValue(name).trim() : '';
  if (colors.sun) cache = Object.freeze(colors); // not before game.css has loaded
  return colors;
}

/** '#rrggbb' (or '#rgb') with an alpha, as 'rgba(r,g,b,a)'; any other value is returned unchanged. */
export function withAlpha(color, alpha) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color || '');
  if (!m) return color;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}
