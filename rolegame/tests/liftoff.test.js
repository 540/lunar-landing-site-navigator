// The ascent vehicle at ASCENSO (#398): clearance, beacon and the message when the lift-off is not cleared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liftoffStatus, liftoffMessage, beaconMode, zoneWords } from '../src/liftoff.js';
import { beaconOn, launchSettle, LAUNCH_MS, shouldLaunch } from '../src/cabin/launch.js';
import { TEXTS } from '../src/texts.js';
import { EN } from '../src/texts.en.js';

const level = { need: 3, minBat: 15 };
const scenario = { pad: { x: 8, y: 16 } };
const at = (o) => ({ level, scenario, x: 8, y: 16, sent: 0, battery: 80, over: null, ...o });

test('liftoffStatus: en ASCENSO sin paquetes, por batería, cerca y con la victoria', () => {
  assert.deepEqual(liftoffStatus(at({ sent: 1 })), { atPad: true, near: true, ready: false, reason: 'packets', missing: 2, lowBattery: false, minBat: 15 });
  assert.equal(liftoffStatus(at({ sent: 3, battery: 10 })).reason, 'battery');
  assert.equal(liftoffStatus(at({ sent: 3, over: 'win' })).ready, true);
  assert.equal(liftoffStatus(at({ over: 'time' })).reason, 'over');
  const next = liftoffStatus(at({ x: 9, y: 17 }));
  assert.equal(next.atPad, false); assert.equal(next.near, true);
  assert.equal(liftoffStatus(at({ x: 10 })).near, false);
});

test('la baliza: roja esperando a la tripulación, ámbar si no está autorizado, verde al ganar', () => {
  assert.equal(beaconMode(liftoffStatus(at({ x: 0, y: 0 }))), 'idle');
  assert.equal(beaconMode(liftoffStatus(at({ x: 9 }))), 'waiting');
  assert.equal(beaconMode(liftoffStatus(at({ sent: 3, over: 'win' }))), 'ready');
  assert.equal(beaconMode(liftoffStatus(at({ over: 'battery' }))), 'idle');
  assert.equal(beaconOn(0, 'ready'), true); assert.equal(beaconOn(500, 'ready'), true);
  assert.equal(beaconOn(50, 'waiting'), true); assert.equal(beaconOn(150, 'waiting'), false); assert.equal(beaconOn(250, 'waiting'), true);
  assert.equal(beaconOn(50), true); assert.equal(beaconOn(600), false);
});

test('el aviso en la nave: faltan paquetes (con la zona azul), batería y nada fuera de ASCENSO o al ganar', () => {
  const zone = { km: 1.2, wind: 'noreste', now: true };
  assert.deepEqual(liftoffMessage(liftoffStatus(at({ sent: 1 })), TEXTS, zone), {
    title: 'La nave está lista, pero control de misión no autoriza el despegue: faltan 2 paquetes.',
    todo: 'Envíalos desde zonas azules y vuelve: la más cercana está a 1,2 km al noreste.',
  });
  assert.match(liftoffMessage(liftoffStatus(at({ sent: 2 })), TEXTS).title, /falta 1 paquete\.$/);
  assert.match(liftoffMessage(liftoffStatus(at({ sent: 0, battery: 5 })), TEXTS).todo, /por debajo del 15 %/);
  assert.equal(liftoffMessage(liftoffStatus(at({ sent: 3, battery: 5 })), TEXTS).title,
    'La nave está lista, pero control de misión no autoriza el despegue: la batería está por debajo del 15 %.');
  assert.equal(liftoffMessage(liftoffStatus(at({ x: 3 })), TEXTS), null);
  assert.equal(liftoffMessage(liftoffStatus(at({ sent: 3, over: 'win' })), TEXTS), null);
  assert.match(liftoffMessage(liftoffStatus(at({ sent: 1 })), EN, zone).title, /2 packets are missing/);
});

test('zoneWords: rumbo y distancia de la zona azul desde el rover', () => {
  assert.deepEqual(zoneWords({ x: 8, y: 16 }, { x: 9, y: 15, km: 0.35, now: true }, TEXTS.winds), { km: 0.35, wind: 'noreste', now: true });
  assert.equal(zoneWords({ x: 8, y: 16 }, null, TEXTS.winds), null);
});

test('tras el despegue la cámara vuelve al horizonte; con la Tierra a la vista, después de mirarla', () => {
  assert.equal(launchSettle(LAUNCH_MS - 1), 0);
  assert.equal(launchSettle(LAUNCH_MS + 600 + 1500), 1);
  assert.equal(launchSettle(LAUNCH_MS + 2100, true), 0);
  assert.equal(launchSettle(LAUNCH_MS + 2500 + 1500, true), 1);
  assert.equal(shouldLaunch({ over: 'win', launched: false, reduced: false }), true);
  assert.equal(shouldLaunch({ over: 'win', launched: false, reduced: true }), false);
});
