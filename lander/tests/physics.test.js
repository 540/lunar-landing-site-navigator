import test from 'node:test';
import assert from 'node:assert/strict';
import { G0, G_MOON, LANDER, createState, effectiveThrottle, massOf, step } from '../src/sim/physics.js';

const DT = 1 / 120;
const run = (state, command, seconds, systems) => { for (let i = 0; i < Math.round(seconds / DT); i++) state = step(state, command, DT, systems); return state; };
const still = (over = {}) => createState({ x: 0, alt: 1000, vx: 0, vz: 0, pitchDeg: 0, ...over });
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('sin motor cae con la gravedad lunar: 1,62 m/s²', () => {
  const s = run(still(), { throttle: 0 }, 10);
  near(s.vz, -G_MOON * 10, 0.01);
  near(s.alt, 1000 - 0.5 * G_MOON * 100, 0.2);
  assert.equal(s.fuelKg, LANDER.fuelKg);
});

test('el empuje que iguala al peso mantiene la velocidad vertical', () => {
  const hover = (massOf(still()) * G_MOON) / LANDER.maxThrustN;
  const s = run({ ...still(), throttle: hover }, { throttle: hover }, 5);
  near(s.vz, 0, 0.08);
});

test('el consumo sigue al empuje: T / (Isp · g0)', () => {
  const s = run({ ...still(), throttle: 1 }, { throttle: 1 }, 10);
  near(LANDER.fuelKg - s.fuelKg, (LANDER.maxThrustN / (LANDER.ispS * G0)) * 10, 0.5);
});

test('al quemar combustible la nave pesa menos y acelera más con el mismo empuje', () => {
  let s = { ...still(), throttle: 1 };
  const first = step(s, { throttle: 1 }, DT).vz - s.vz;
  s = run(s, { throttle: 1 }, 30);
  const later = step(s, { throttle: 1 }, DT).vz - s.vz;
  assert.ok(later > first);
});

test('sin combustible el motor se apaga', () => {
  const s = run({ ...still(), fuelKg: 20, throttle: 1 }, { throttle: 1 }, 12);
  assert.equal(s.fuelKg, 0);
  assert.equal(s.thrustN, 0);
  assert.ok(s.vz < 0, 'vuelve a caer');
});

test('motor sin armar: no hay empuje aunque se pida', () => {
  const s = run(still(), { throttle: 1 }, 3, { engine: false, rcs: true });
  assert.equal(s.throttle, 0);
  near(s.vz, -G_MOON * 3, 0.01);
});

test('el motor no baja de su empuje mínimo estable, o se corta', () => {
  assert.equal(effectiveThrottle(0.02), 0);
  assert.equal(effectiveThrottle(0.07), LANDER.minThrottle);
  assert.equal(effectiveThrottle(0.6), 0.6);
  assert.equal(effectiveThrottle(3), 1);
});

test('inclinada hacia atrás, la nave frena su avance', () => {
  const s = run({ ...still({ vx: 50, pitchDeg: 30 }), throttle: 0.5 }, { throttle: 0.5, pitchDeg: 30 }, 5);
  assert.ok(s.vx < 50);
  const upright = run({ ...still({ vx: 50 }), throttle: 0.5 }, { throttle: 0.5, pitchDeg: 0 }, 5);
  near(upright.vx, 50, 1e-9);
});

test('el giro está limitado por los propulsores y, sin RCS, la actitud no cambia', () => {
  const turned = run(still(), { throttle: 0, pitchDeg: 40 }, 2);
  near(turned.pitchDeg, LANDER.pitchRateDegS * 2, 0.1);
  const frozen = run(still({ pitchDeg: 12 }), { throttle: 0, pitchDeg: 40 }, 2, { engine: true, rcs: false });
  assert.equal(frozen.pitchDeg, 12);
  assert.equal(frozen.pitchRateDegS, 0);
});
