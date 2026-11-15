import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLS, COVER_CLOSE_S, FLIGHT_CONTROLS, createControls, powerFailure, press, raiseAlarm, setOn, setThrottle, systems, tick, visual } from '../src/sim/controls.js';

const after = (state, ...ids) => ids.reduce((s, id) => press(s, id).state, state);
const sounds = r => r.events.filter(e => e.type === 'sound').map(e => e.name);

test('cada control tiene un id único y una etiqueta', () => {
  assert.equal(new Set(CONTROLS.map(c => c.id)).size, CONTROLS.length);
  assert.ok(CONTROLS.length > 120, 'la cabina tiene más de cien controles');
  for (const c of CONTROLS) assert.ok(c.label, `${c.id} sin etiqueta`);
});

test('estado inicial: piloto automático puesto, motor sin armar y tren arriba', () => {
  const sys = systems(createControls());
  assert.deepEqual({ autopilot: sys.autopilot, engine: sys.engine, gear: sys.gear, rcs: sys.rcs, abort: sys.abort }, { autopilot: true, engine: false, gear: false, rcs: true, abort: false });
});

test('un interruptor cambia con cada pulsación y suena', () => {
  const r = press(createControls(), 'rcs');
  assert.equal(systems(r.state).rcs, false);
  assert.deepEqual(sounds(r), ['switch']);
  assert.equal(systems(press(r.state, 'rcs').state).rcs, true);
});

test('un interruptor con tapa pide dos pulsaciones: abrir la tapa y accionar', () => {
  const opened = press(createControls(), 'engineArm');
  assert.deepEqual(visual(opened.state, 'engineArm'), { on: false, cover: true });
  assert.deepEqual(sounds(opened), ['cover']);
  const armed = press(opened.state, 'engineArm');
  assert.equal(systems(armed.state).engineArmed, true);
});

test('al accionar un interruptor con tapa se retira la ayuda de «pulsa otra vez»', () => {
  const opened = press(createControls(), 'gear');
  assert.deepEqual(opened.events.filter(e => e.type === 'hint'), [{ type: 'hint', code: 'coverOpen', id: 'gear' }]);
  assert.ok(!opened.events.some(e => e.type === 'clearHint'), 'abrir la tapa no la retira');
  const thrown = press(opened.state, 'gear');
  assert.equal(systems(thrown.state).gear, true);
  assert.deepEqual(thrown.events.filter(e => e.type === 'clearHint'), [{ type: 'clearHint', id: 'gear' }]);
  assert.ok(!thrown.events.some(e => e.type === 'hint'));
});

test('la tapa se cierra sola y vuelve a proteger el interruptor', () => {
  let s = after(createControls(), 'gear', 'gear');
  assert.equal(visual(s, 'gear').cover, true);
  s = tick(s, COVER_CLOSE_S + 0.1);
  assert.deepEqual(visual(s, 'gear'), { on: true, cover: false });
  assert.equal(systems(press(s, 'gear').state).gear, true, 'la primera pulsación solo abre la tapa');
});

test('tick no crea estado nuevo si no hay tapas abiertas', () => {
  const s = createControls();
  assert.equal(tick(s, 1), s);
});

test('el motor necesita estar armado y con las válvulas de propelente abiertas', () => {
  let s = after(createControls(), 'engineArm', 'engineArm');
  assert.equal(systems(s).engine, true);
  s = after(s, 'propValves');
  assert.equal(systems(s).engine, false);
  assert.equal(systems(s).engineArmed, true);
});

test('sin el ordenador GNC el piloto automático se cae, con alarma, y no se puede volver a poner', () => {
  const off = press(createControls(), 'gnc');
  assert.equal(systems(off.state).autopilot, false);
  assert.equal(systems(off.state).alarm, true);
  assert.ok(off.events.some(e => e.type === 'hint' && e.code === 'autopilotLost'));
  const retry = press(off.state, 'autopilot');
  assert.equal(systems(retry.state).autopilot, false);
  assert.ok(retry.events.some(e => e.type === 'hint' && e.code === 'needsGnc'));
  assert.equal(systems(after(off.state, 'gnc', 'autopilot')).autopilot, true);
});

test('el botón de alarma la silencia', () => {
  const s = raiseAlarm(createControls());
  assert.equal(visual(s, 'masterAlarm').on, true);
  const r = press(s, 'masterAlarm');
  assert.equal(systems(r.state).alarm, false);
  assert.ok(r.events.some(e => e.type === 'ack'));
});

test('abortar es de un solo uso: una vez accionado no se desactiva', () => {
  const s = after(createControls(), 'abort', 'abort');
  assert.equal(systems(s).abort, true);
  const again = press(s, 'abort');
  assert.equal(systems(again.state).abort, true);
  assert.deepEqual(sounds(again), ['denied']);
  assert.equal(setOn(s, 'abort', false), s);
});

test('un selector giratorio recorre sus posiciones en los dos sentidos', () => {
  let s = createControls();
  assert.equal(systems(s).cabinLights, 1);
  s = press(s, 'cabinLights').state;
  assert.equal(systems(s).cabinLights, 2);
  s = press(s, 'cabinLights').state;
  assert.equal(systems(s).cabinLights, 0);
  assert.equal(systems(press(s, 'cabinLights', -1).state).cabinLights, 2);
});

test('la palanca de empuje sube y baja por pasos, entre 0 y 100 %', () => {
  let s = createControls();
  s = press(s, 'throttle').state;
  assert.equal(systems(s).throttle, 0.1);
  assert.equal(systems(press(s, 'throttle', -1).state).throttle, 0);
  assert.equal(systems(press(createControls(), 'throttle', -1).state).throttle, 0);
  assert.equal(systems(setThrottle(s, 7)).throttle, 1);
});

test('la tripulación puede poner un interruptor con tapa directamente', () => {
  const s = setOn(createControls(), 'engineArm', true);
  assert.deepEqual(visual(s, 'engineArm'), { on: true, cover: true });
  assert.equal(visual(tick(s, 2), 'engineArm').cover, false);
  assert.equal(setOn(s, 'engineArm', true), s);
});

test('los controles de adorno se encienden y se apagan sin tocar el vuelo', () => {
  const before = systems(createControls());
  let s = createControls();
  for (const c of CONTROLS) if (!FLIGHT_CONTROLS.includes(c)) s = press(s, c.id).state;
  assert.deepEqual(systems(s), before);
  assert.notEqual(visual(s, 'cb1').on, visual(createControls(), 'cb1').on);
});

test('pulsar un control que no existe no cambia nada', () => {
  const s = createControls(), r = press(s, 'nope');
  assert.equal(r.state, s);
  assert.deepEqual(r.events, []);
});

test('al estrellarse se apagan las luces de cabina y de paneles y salta la alarma', () => {
  const sys = systems(powerFailure(createControls()));
  assert.deepEqual({ cabinLights: sys.cabinLights, panelLights: sys.panelLights, alarm: sys.alarm }, { cabinLights: 0, panelLights: false, alarm: true });
});
