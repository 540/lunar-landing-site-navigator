// Solar elevation for the panels (#69, 4.3 and 4.4): the low-Sun threshold and the mission figures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOW_SUN_MARGIN_DEG, lowSun, missionSun, fmtDeg } from '../js/common/sun-elevation.js';

const hour = (el, horizon) => ({ sun: { el, horizon, margin: el - horizon }, earth: { el: 5, horizon: 0, margin: 5 } });

test('el umbral es el radio del Sol más el error del horizonte LOLA: 0,6° sobre el relieve', () => {
  assert.equal(LOW_SUN_MARGIN_DEG, 0.6);
  assert.equal(lowSun(0.59), true);
  assert.equal(lowSun(-1), true);
  assert.equal(lowSun(0.6), false);
});

test('la media y el mínimo de la misión solo cuentan las horas con Sol sobre el relieve', () => {
  const s = missionSun([hour(-2, 0), hour(1, 0.5), hour(2, 0.4), hour(3, 0.2), hour(0.5, 1)]);
  assert.equal(s.litHours, 3);
  assert.equal(s.meanEl, 2);
  assert.equal(s.minEl, 1);
  assert.equal(s.minMargin, 0.5);
  assert.equal(s.lowHours, 1);
});

test('sin horas de Sol no hay cifras de la misión', () => {
  assert.equal(missionSun([hour(-1, 0), hour(0.2, 0.5)]), null);
});

test('los grados van con coma decimal', () => {
  assert.equal(fmtDeg(1.06), '1,1°');
  assert.equal(fmtDeg(-0.6), '−0,6°');
});

test('las horas con luz son las del disco entero sobre el relieve; el umbral bajo sigue con el centro (#269)', () => {
  const at = sun => ({ sun, earth: { el: 5, horizon: 0, margin: 5 } });
  const s = missionSun([at({ el: 1, margin: 0.2, fullMargin: -0.07 }), at({ el: 1.2, margin: 0.5, fullMargin: 0.23 }), at({ el: 2, margin: 1.5, fullMargin: 1.23 })]);
  assert.equal(s.litHours, 2);
  assert.equal(s.minMargin, 0.5);
  assert.equal(s.lowHours, 1);
  const old = missionSun([at({ el: 1, margin: 0.2 }), at({ el: 1.2, margin: 0.5 }), at({ el: 2, margin: 1.5 })]);
  assert.deepEqual([old.litHours, old.minMargin, old.lowHours], [3, 0.2, 2]);
});
