import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, assessLanding } from '../src/sim/outcome.js';

const contact = (over = {}) => ({ vz: -1.2, vx: 0.3, pitchDeg: 1, slopeDeg: 0, gearDown: true, fuelKg: 300, distanceM: 5, ...over });

test('contacto suave, vertical y con el tren abajo: aterrizaje correcto', () => {
  const r = assessLanding(contact());
  assert.equal(r.result, 'soft');
  assert.deepEqual(r.reasons, []);
  assert.ok(r.score > 80);
});

test('los límites del aterrizaje correcto son los del tren del LM', () => {
  assert.deepEqual(LIMITS.soft, { vertical: 3, horizontal: 1.2, tiltDeg: 6 });
  assert.equal(assessLanding(contact({ vz: -3 })).result, 'soft');
  assert.equal(assessLanding(contact({ vz: -3.1 })).result, 'hard');
});

test('demasiado rápido en vertical: duro y, pasado el segundo límite, fallido', () => {
  const hard = assessLanding(contact({ vz: -4.5 }));
  assert.equal(hard.result, 'hard');
  assert.deepEqual(hard.reasons, ['vertical']);
  const crash = assessLanding(contact({ vz: -9 }));
  assert.equal(crash.result, 'crash');
  assert.equal(crash.score, 0);
});

test('la velocidad horizontal vuelca la nave', () => {
  assert.deepEqual(assessLanding(contact({ vx: -2 })).reasons, ['horizontal']);
  assert.equal(assessLanding(contact({ vx: -2 })).result, 'hard');
  assert.equal(assessLanding(contact({ vx: 6 })).result, 'crash');
});

test('la inclinación cuenta contra el suelo: cabeceo más pendiente', () => {
  assert.equal(assessLanding(contact({ pitchDeg: 4, slopeDeg: 1 })).result, 'soft');
  const tilted = assessLanding(contact({ pitchDeg: 4, slopeDeg: 5 }));
  assert.equal(tilted.result, 'hard');
  assert.deepEqual(tilted.reasons, ['tilt']);
  assert.equal(assessLanding(contact({ pitchDeg: -15 })).result, 'crash');
});

test('sin el tren desplegado baja un escalón: lo suave es duro y lo duro, fallido', () => {
  const soft = assessLanding(contact({ gearDown: false }));
  assert.equal(soft.result, 'hard');
  assert.deepEqual(soft.reasons, ['gear']);
  assert.equal(assessLanding(contact({ gearDown: false, vz: -4 })).result, 'crash');
});

test('la puntuación premia la precisión y el combustible', () => {
  const close = assessLanding(contact({ distanceM: 2 })).score, far = assessLanding(contact({ distanceM: 250 })).score;
  assert.ok(close > far);
  assert.ok(assessLanding(contact({ fuelKg: 400 })).score > assessLanding(contact({ fuelKg: 0 })).score);
});
