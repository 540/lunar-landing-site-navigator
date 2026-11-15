// The scroll of the left list of «Explorar la Luna» (.xover .chips in home/index.html) is styled like the rest of the home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chipsFade, chipsScrolls } from '../home/src/menu-layout.mjs';

const html = readFileSync(new URL('../home/index.html', import.meta.url), 'utf8');
const rule = (selector) => {
  const start = html.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `falta la regla ${selector}`);
  return html.slice(start, html.indexOf('\n.xover', start + 1));
};

test('la lista usa los colores de la portada en la barra', () => {
  const css = rule('.xover .chips');
  assert.match(css, /scrollbar-width:thin/);
  assert.match(css, /scrollbar-color:var\(--line-strong\) transparent/);
  assert.match(html, /\.xover \.chips::-webkit-scrollbar-thumb\{background:var\(--line-strong\)/);
  assert.match(html, /\.xover \.chips::-webkit-scrollbar-button\{display:none/);
});

test('la lista no salta de ancho ni deja pasar la rueda', () => {
  const css = rule('.xover .chips');
  assert.match(css, /scrollbar-gutter:stable/);
  assert.match(css, /overscroll-behavior:contain/);
});

test('el desvanecido solo aparece en el lado con contenido oculto', () => {
  assert.match(html, /\.xover \.chips\.more-up\{--fade-top:var\(--fade-size\)\}/);
  assert.match(html, /\.xover \.chips\.more-down\{--fade-bottom:var\(--fade-size\)\}/);
  // the mask only on the fade classes, so the cards keep their backdrop blur when nothing fades
  assert.doesNotMatch(rule('.xover .chips'), /mask-image/);
  assert.match(html, /\.xover \.chips\.more-up,\.xover \.chips\.more-down\{-webkit-mask-image:linear-gradient/);
  // the focused or revealed card stops clear of the fade
  assert.match(rule('.xover .chips'), /scroll-padding-block:var\(--fade-size\)/);
  assert.match(html, /function syncChipsFade/);
  assert.match(html, /chipsFade\(L\)/);
});

test('la tarjeta de la zona elegida se lleva a la vista sin animar con movimiento reducido', () => {
  assert.match(html, /scrollIntoView\(\{block:"nearest",behavior:reduce\?"auto":"smooth"\}\)/);
});

test('la fila horizontal de móvil no cambia', () => {
  assert.match(html, /\.chips\{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none/);
});

test('chipsFade: sin desvanecido si cabe, abajo en el tope, ambos en medio, arriba al final', () => {
  assert.deepEqual(chipsFade({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), { up: false, down: false });
  assert.deepEqual(chipsFade({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 }), { up: false, down: true });
  assert.deepEqual(chipsFade({ scrollTop: 200, scrollHeight: 900, clientHeight: 300 }), { up: true, down: true });
  assert.deepEqual(chipsFade({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 }), { up: true, down: false });
  // sub-pixel remainder at the end: still no fade below
  assert.deepEqual(chipsFade({ scrollTop: 599.5, scrollHeight: 900, clientHeight: 300 }), { up: true, down: false });
  assert.deepEqual(chipsFade({ scrollTop: 598, scrollHeight: 900, clientHeight: 300 }), { up: true, down: true });
});

test('chipsScrolls: la fila horizontal de móvil (sin desbordar en vertical) no se desplaza', () => {
  assert.equal(chipsScrolls({ scrollHeight: 80, clientHeight: 80 }), false);
  assert.equal(chipsScrolls({ scrollHeight: 900, clientHeight: 300 }), true);
});
