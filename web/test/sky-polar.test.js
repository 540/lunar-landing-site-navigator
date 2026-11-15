// The sky compass of Plan (sky-polar.js): its elevation scale, where a body falls on the dial and what it says in words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { polarScale, radiusOf, pointOf, bearing, polarSummary, reliefReading } from '../js/common/sky-polar.js';

const flat = (deg = 0) => new Array(360).fill(deg);
const hour = (sunEl, earthEl = 5, horizon = 0) => ({ sun: { az: 90, el: sunEl, horizon, margin: sunEl - horizon }, earth: { az: 0, el: earthEl, horizon, margin: earthEl - horizon } });

test('la escala abarca el relieve y las dos trayectorias, y nunca es menor que de −2° a 6°', () => {
  assert.deepEqual(polarScale(flat(), [hour(1, 2)]), { bottom: -2, top: 6, step: 2 });
  const s = polarScale(flat(-4), [hour(3, 11.2)]);
  assert.equal(s.bottom, -5);
  assert.equal(s.top, 13);
});

test('el borde es el fondo de la escala, el centro su cima y lo que se sale se queda en el borde o en el centro', () => {
  const scale = { bottom: -2, top: 8 };
  assert.equal(radiusOf(-2, scale, 100), 100);
  assert.equal(radiusOf(8, scale, 100), 0);
  assert.equal(radiusOf(3, scale, 100), 50);
  assert.equal(radiusOf(-30, scale, 100), 100);
  assert.equal(radiusOf(40, scale, 100), 0);
});

test('norte arriba y este a la derecha, como en un mapa', () => {
  const scale = { bottom: 0, top: 10 }, at = (az) => pointOf(az, 0, scale, 0, 0, 100).map(v => Math.round(v) + 0);
  assert.deepEqual(at(0), [0, -100]);
  assert.deepEqual(at(90), [100, 0]);
  assert.deepEqual(at(180), [0, 100]);
  assert.deepEqual(at(270), [-100, 0]);
});

test('el rumbo se lee con tres cifras y su viento más cercano', () => {
  assert.deepEqual(bearing(7), { text: '007°', wind: 'N' });
  assert.deepEqual(bearing(134.6), { text: '135°', wind: 'SE' });
  assert.deepEqual(bearing(-90), { text: '270°', wind: 'O' });
  assert.deepEqual(bearing(359.7), { text: '000°', wind: 'N' });
});

test('el resumen para lectores de pantalla dice dónde está cada uno y si lo tapa el relieve', () => {
  const text = polarSummary(hour(-1.5, 4, 0.5));
  assert.match(text, /Sol al E \(090°\), a −1,5° de altura: tapado por el relieve \(2,0° por debajo\)/);
  assert.match(text, /Tierra al N \(000°\), a 4,0° de altura: 3,5° sobre el relieve/);
});

test('el resumen da la Tierra por tapada si el centro está sobre el relieve pero no el borde inferior (#269)', () => {
  const at = earth => polarSummary({ sun: { az: 90, el: 3, horizon: 0, margin: 3, fullMargin: 2.73 }, earth: { az: 0, el: 2, horizon: 2 - earth.margin, ...earth } });
  const hidden = at({ margin: 0.5, fullMargin: -0.45 });
  assert.match(hidden, /Tierra al N \(000°\), a 2,0° de altura: tapado por el relieve \(0,5° por debajo\)/);
  assert.doesNotMatch(hidden, /Tierra[^.]*sobre el relieve/);
  assert.match(at({ margin: 1.5, fullMargin: 0.62 }), /Tierra al N \(000°\), a 2,0° de altura: 0,6° sobre el relieve/);
});

test('la ficha del astro dice «Tapado por el relieve» con el margen del borde inferior (#269)', () => {
  assert.deepEqual(reliefReading({ az: 0, el: 2, horizon: 1.5, margin: 0.5, fullMargin: -0.45 }), { seen: false, label: 'Tapado por el relieve', value: '−0,5°' });
  assert.deepEqual(reliefReading({ az: 0, el: 3, horizon: 1.5, margin: 1.5, fullMargin: 0.62 }), { seen: true, label: 'Sobre el relieve', value: '+0,6°' });
});
