import test from 'node:test';
import assert from 'node:assert/strict';
import { ABORT_S, GEAR_AUTO_ALT_M, IGNITION_S, createMission, stepMission } from '../src/sim/mission.js';
import { LANDER, START } from '../src/sim/physics.js';
import { createTerrain } from '../src/sim/terrain.js';

const DT = 1 / 60;
const terrain = createTerrain();
const base = () => ({ engine: false, engineArmed: false, autopilot: true, rcs: true, gear: false, abort: false, throttle: 0 });

/** Flies a whole descent. `crewActs` lets the crew flip the switches the mission asks for; `pilot` edits the systems each step. */
function fly({ ground = terrain, crewActs = true, pilot = () => {}, maxSeconds = 900 } = {}) {
  let m = createMission();
  const sys = base(), events = [];
  for (let i = 0; i < maxSeconds / DT && !m.ended; i++) {
    pilot(sys, m);
    const r = stepMission(m, sys, { pitch: sys.pitchInput ?? 0 }, DT, ground);
    m = r.mission;
    for (const e of r.events) {
      events.push(e);
      if (e.type === 'crew' && crewActs) { if (e.id === 'engineArm') sys.engine = sys.engineArmed = true; else sys.gear = true; }
    }
  }
  return { m, events };
}

test('el piloto automático aterriza suave en el sitio, con margen de combustible', () => {
  const { m } = fly();
  assert.equal(m.outcome.result, 'soft');
  assert.ok(m.outcome.vertical < 2.5 && m.outcome.horizontal < 0.5 && m.outcome.tiltDeg < 2);
  assert.ok(Math.abs(m.outcome.distanceM) < 10, 'a menos de 10 m del objetivo');
  assert.ok(m.state.fuelKg > 0.2 * LANDER.fuelKg);
  assert.ok(m.state.t > 90 && m.state.t < 180, `dura ${m.state.t} s`);
});

test('también sobre un suelo liso', () => {
  assert.equal(fly({ ground: undefined }).m.outcome.result, 'soft');
});

test('las fases van en orden: aproximación, frenado, descenso final y contacto', () => {
  const { events } = fly();
  assert.deepEqual(events.filter(e => e.type === 'phase').map(e => e.phase), ['braking', 'final', 'contact']);
  assert.equal(createMission().phase, 'approach');
});

test('con piloto automático la tripulación arma el motor antes de la ignición y baja el tren en el tramo final', () => {
  const { events } = fly();
  assert.deepEqual(events.filter(e => e.type === 'crew').map(e => e.id), ['engineArm', 'gear']);
  let m = createMission();
  for (let i = 0; i < IGNITION_S / DT; i++) m = stepMission(m, base(), {}, DT, terrain).mission;
  assert.equal(m.crew.armed, true);
  assert.equal(m.state.throttle, 0, 'sin armar no hay ignición');
  assert.ok(GEAR_AUTO_ALT_M > 300);
});

test('si el motor no se arma, la nave cae y se estrella, con aviso', () => {
  const { m, events } = fly({ crewActs: false });
  assert.equal(m.outcome.result, 'crash');
  assert.ok(m.outcome.reasons.includes('vertical'));
  assert.ok(events.some(e => e.type === 'warning' && e.code === 'noEngine'));
  assert.ok(events.some(e => e.type === 'warning' && e.code === 'sinkRate'));
});

test('sin el tren, el mismo descenso acaba en aterrizaje duro', () => {
  const { m, events } = fly({ pilot: sys => { sys.gear = false; } });
  assert.equal(m.outcome.result, 'hard');
  assert.deepEqual(m.outcome.reasons, ['gear']);
  assert.ok(events.some(e => e.type === 'warning' && e.code === 'gearUp'));
});

test('en manual manda la palanca: sin empuje, caída libre hasta el suelo', () => {
  const { m } = fly({ pilot: sys => { sys.autopilot = false; sys.engine = sys.engineArmed = true; sys.throttle = 0; } });
  assert.equal(m.outcome.result, 'crash');
  assert.equal(m.state.fuelKg, LANDER.fuelKg);
});

test('en manual el mando inclina la nave y el empuje frena', () => {
  let m = createMission();
  const sys = { ...base(), autopilot: false, engine: true, engineArmed: true, throttle: 0.8 };
  for (let i = 0; i < 6 / DT; i++) m = stepMission(m, sys, { pitch: 1 }, DT, terrain).mission;
  assert.ok(m.state.pitchDeg > 30);
  assert.ok(m.state.vx < START.vx);
  assert.equal(m.phase, 'braking');
});

test('tomar el mando al final y dejarlo caer desde poca altura: aterrizaje duro o fallido, nunca correcto', () => {
  const { m } = fly({ pilot: (sys, mission) => { if (mission.height < 40) { sys.autopilot = false; sys.throttle = 0; } } });
  assert.notEqual(m.outcome.result, 'soft');
});

test('abortar sube la nave a todo empuje y termina el descenso', () => {
  const { m, events } = fly({ pilot: (sys, mission) => { if (mission.state.t > 20) sys.abort = true; } });
  assert.deepEqual(m.outcome, { result: 'abort' });
  assert.ok(m.state.vz > 0, 'sube');
  assert.ok(m.state.t < 20 + ABORT_S + 1);
  assert.ok(events.some(e => e.type === 'phase' && e.phase === 'abort'));
});

test('quien gasta el combustible subiendo se queda sin él y avisa antes', () => {
  const { m, events } = fly({ pilot: sys => { sys.autopilot = false; sys.engine = sys.engineArmed = true; sys.throttle = 1; } });
  assert.ok(events.some(e => e.type === 'warning' && e.code === 'lowFuel'));
  assert.ok(['crash', 'lost'].includes(m.outcome.result));
});

test('una misión terminada ya no avanza', () => {
  const { m } = fly();
  const r = stepMission(m, base(), {}, DT, terrain);
  assert.equal(r.mission, m);
  assert.deepEqual(r.events, []);
});
