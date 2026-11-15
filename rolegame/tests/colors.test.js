// The game's colours have one value each (#341): --good / --warn / --bad come from web/styles/tokens.css, and the canvas,
// the SVG icons and three.js read the variables of game.css (palette.js) instead of repeating them as literals.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameColors, withAlpha } from '../src/palette.js';
import { GOAL_ICONS } from '../src/goal.js';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const css = fs.readFileSync(path.join(src, 'styles/game.css'), 'utf8');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith('.js') && e.name !== 'palette.js' ? [p] : [];
  });
}

test('--good, --warn y --bad salen de los tokens', () => {
  assert.match(css, /--good:\s*var\(--color-map-ok\);/);
  assert.match(css, /--warn:\s*var\(--color-map-warn\);/);
  assert.match(css, /--bad:\s*var\(--color-map-bad\);/);
  for (const banned of ['#46c08a', '#e6c14d', '#e5564b', '70, 192, 138']) assert.ok(!css.toLowerCase().includes(banned), `sobra ${banned}`);
});

test('el código no repite como literales el Sol, la Tierra ni los veredictos', () => {
  const banned = /#(f2a33a|4f9df0|46c08a|e6c14d|e5564b)\b|0x(f2a33a|4f9df0)\b|24[23], ?163, ?58/i;
  for (const file of jsFiles(src)) {
    const hit = fs.readFileSync(file, 'utf8').match(banned);
    assert.equal(hit, null, `${path.relative(src, file)} escribe ${hit?.[0]} a mano`);
  }
});

test('los iconos del objetivo pintan con las variables de game.css', () => {
  const svg = Object.values(GOAL_ICONS).join('');
  for (const name of ['sun', 'earth', 'good', 'bad']) assert.match(svg, new RegExp(`var\\(--${name}\\)`));
});

test('gameColors lee las variables CSS del documento', () => {
  const values = { '--sun': ' #f2a33a', '--earth': '#4f9df0', '--good': '#3fbf7f', '--warn': '#e6c14d', '--bad': '#e5675e' };
  const root = {};
  globalThis.getComputedStyle = (el) => {
    assert.equal(el, root);
    return { getPropertyValue: (name) => values[name] ?? '' };
  };
  try {
    assert.deepEqual({ ...gameColors(root) }, { sun: '#f2a33a', earth: '#4f9df0', good: '#3fbf7f', warn: '#e6c14d', bad: '#e5675e' });
  } finally {
    delete globalThis.getComputedStyle;
  }
});

test('withAlpha pasa un hexadecimal a rgba y deja lo demás como está', () => {
  assert.equal(withAlpha('#f2a33a', 0.4), 'rgba(242,163,58,0.4)');
  assert.equal(withAlpha('#fff', 0), 'rgba(255,255,255,0)');
  assert.equal(withAlpha('rgb(1, 2, 3)', 0.5), 'rgb(1, 2, 3)');
  assert.equal(withAlpha('', 0.5), '');
});
