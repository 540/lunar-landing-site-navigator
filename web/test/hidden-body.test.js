// A hidden body is drawn and named the same in every view (#337): drawSky runs on a recording canvas, without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = file => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js/common', file), 'utf8');
const between = (src, from, to) => { const a = src.indexOf(from); return a < 0 ? '' : src.slice(a, src.indexOf(to, a + from.length)); };

// theme() reads the CSS tokens: each token resolves to its own name, so t.surface is '--color-surface'.
globalThis.document = { documentElement: {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: name => name });
globalThis.devicePixelRatio = 1;
const { drawSky } = await import('../js/common/charts.js');

// A 2D context that records, for each arc (the body discs), the fill and stroke drawn on its path.
function recordingCanvas() {
  const discs = [];
  let current = null;
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '',
    setTransform() {}, beginPath() { current = null; }, moveTo() {}, lineTo() {}, closePath() {},
    fillText() {}, fillRect() {}, setLineDash() {},
    arc(x, y, r) { current = { r, alpha: ctx.globalAlpha }; discs.push(current); },
    fill() { if (current) current.fill = ctx.fillStyle; },
    stroke() { if (current) { current.stroke = ctx.strokeStyle; current.lineWidth = ctx.lineWidth; } },
  };
  return { canvas: { clientWidth: 360, width: 0, height: 0, style: {}, getContext: () => ctx }, discs };
}

const body = (az, fullMargin) => ({ az, el: fullMargin + 1, margin: fullMargin + 1, fullMargin });
const site = { horizon: { mask: new Array(360).fill(1) } };

function draw(sun, earth) {
  const { canvas, discs } = recordingCanvas();
  drawSky(canvas, site, { series: [{ sun, earth }] }, 0);
  assert.equal(discs.length, 2, 'drawSky dibuja un disco por astro');
  return { sun: discs[0], earth: discs[1] };
}

const hollow = (disc, col) => {
  assert.equal(disc.fill, '--color-surface', 'el disco tapado se rellena con t.surface');
  assert.equal(disc.stroke, col, 'el borde del disco tapado es del color del astro');
  assert.equal(disc.lineWidth, 2, 'el borde del disco tapado mide 2 px');
  assert.equal(disc.alpha, 1, 'el disco tapado no baja la opacidad');
};
const filled = (disc, col) => {
  assert.equal(disc.fill, col, 'el disco visible se rellena con el color del astro');
  assert.equal(disc.alpha, 1);
};

test('el cielo 2D dibuja hueco el astro tapado y relleno el visible', () => {
  const a = draw(body(90, -1), body(0, 2));
  hollow(a.sun, '--color-sun'); filled(a.earth, '--color-earth');
  const b = draw(body(90, 2), body(0, -1));
  filled(b.sun, '--color-sun'); hollow(b.earth, '--color-earth');
});

test('el cielo 2D decide con overRelief: tapado si el borde inferior del disco no asoma aunque asome el centro', () => {
  const { sun } = draw({ az: 90, el: 1, margin: 0.2, fullMargin: -0.1 }, body(0, 2));
  hollow(sun, '--color-sun');
});

test('drawSky no distingue el astro tapado solo por opacidad', () => {
  const sky = between(read('charts.js'), 'export function drawSky', 'export function drawLine');
  assert.ok(sky.length > 0, 'no hay drawSky en charts.js');
  assert.ok(!sky.includes('0.35'), 'drawSky aún baja la opacidad del astro tapado a 0,35');
  assert.match(sky, /overRelief\(/, 'drawSky no decide con overRelief');
});

// The state helper every sky view puts in its canvas label: the sentence a screen reader hears.
const { skyStateLabel } = await import('../js/common/sky-visibility.js');

test('skyStateLabel dice si cada astro se ve o está tapado ahora', () => {
  assert.equal(skyStateLabel({ sun: body(90, 2), earth: body(0, -1) }), 'Ahora: Sol visible, Tierra tapada.');
  assert.equal(skyStateLabel({ sun: body(90, -1), earth: body(0, 2) }), 'Ahora: Sol tapado, Tierra visible.');
  assert.equal(skyStateLabel({ sun: body(90, 2), earth: body(0, 2) }), 'Ahora: Sol visible, Tierra visible.');
  assert.equal(skyStateLabel({ sun: body(90, -1), earth: body(0, -1) }), 'Ahora: Sol tapado, Tierra tapada.');
  // Centre over the ridge, lower edge under it: overRelief decides, as in drawSky.
  assert.equal(skyStateLabel({ sun: { az: 90, el: 1, margin: 0.2, fullMargin: -0.1 }, earth: body(0, 2) }), 'Ahora: Sol tapado, Tierra visible.');
});

// sky3d.js imports three.js from a CDN and sky-view.js needs a DOM: that both use the helper is checked as text.
test('el cielo 3D y el 2D/Brújula ponen skyStateLabel en el aria-label del canvas', () => {
  for (const file of ['sky3d.js', 'sky-view.js']) {
    const src = read(file);
    assert.match(src, /import \{[^}]*\bskyStateLabel\b[^}]*\} from '\.\/sky-visibility\.js'/, `${file} no importa skyStateLabel`);
    assert.match(src, /skyStateLabel\(/, `${file} no usa skyStateLabel`);
  }
});
