// The ascent vehicle and its lift-off (J12.8, #398).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchAt, beaconOn, plumeGrains, shouldLaunch, launchText, LAUNCH, LAUNCH_MS, CLIMB_KM, PAD_RADIUS_KM } from '../src/cabin/launch.js';
import { VEHICLE_OFFSET_KM } from '../src/cabin/ascent-vehicle.js';
import { cellToScene } from '../src/cabin/logic.js';
import { drawPad } from '../src/map-legend.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = texts('es');
const TE = texts('en');

test('despegue: subida a bordo, cuenta atrás 3-2-1, ignición y ascenso hasta perderse', () => {
  assert.equal(launchAt(0).phase, 'board');
  const b = LAUNCH.board;
  assert.deepEqual([launchAt(b + 10).count, launchAt(b + 1010).count, launchAt(b + 2010).count], [3, 2, 1]);
  assert.equal(launchAt(b + LAUNCH.count + 10).phase, 'ignite');
  assert.ok(launchAt(b + LAUNCH.count + 10).flash > 0.9, 'el destello está al principio de la ignición');
  assert.equal(launchAt(b + LAUNCH.count + LAUNCH.ignite + 100).phase, 'climb');
  const end = launchAt(LAUNCH_MS);
  assert.equal(end.done, true);
  assert.ok(Math.abs(end.altitudeKm - (0.0004 + CLIMB_KM)) < 1e-9);
  // Nothing moves before the ignition, and the height only grows after it.
  assert.equal(launchAt(b + LAUNCH.count - 1).altitudeKm, 0);
  let prev = -1;
  for (let ms = 0; ms <= LAUNCH_MS; ms += 50) { const a = launchAt(ms).altitudeKm; assert.ok(a >= prev); prev = a; }
});

test('la baliza parpadea: corta y cada 1,2 s', () => {
  assert.equal(beaconOn(0), true);
  assert.equal(beaconOn(500), false);
  assert.equal(beaconOn(1200), true);
});

test('el regolito sale en abanico desde la plataforma y se repite igual con la misma semilla', () => {
  const a = plumeGrains(50, 3), b = plumeGrains(50, 3);
  assert.deepEqual(a, b);
  for (const g of a) {
    assert.ok(g.vy > 0, 'sube');
    const v = Math.hypot(g.vx, g.vz);
    assert.ok(v >= 0.03 && v <= 0.08, 'de 30 a 80 m/s a ras de suelo');
  }
});

test('la cinemática solo se lanza al ganar, una vez, y nunca con movimiento reducido', () => {
  assert.equal(shouldLaunch({ over: 'win', launched: false, reduced: false }), true);
  assert.equal(shouldLaunch({ over: 'win', launched: true, reduced: false }), false);
  assert.equal(shouldLaunch({ over: 'win', launched: false, reduced: true }), false);
  for (const over of [null, 'battery', 'time']) assert.equal(shouldLaunch({ over, launched: false, reduced: false }), false);
});

test('los textos del despegue en español e inglés', () => {
  const b = LAUNCH.board;
  assert.equal(launchText(launchAt(0), T), 'La tripulación sube a la nave de ascenso…');
  assert.equal(launchText(launchAt(b + 1010), T), 'Despegue en 2…');
  assert.equal(launchText(launchAt(b + LAUNCH.count + 1), T), '¡Ignición!');
  assert.match(launchText(launchAt(LAUNCH_MS), T), /^Despegue confirmado/);
  assert.equal(launchText(launchAt(b + 10), TE), 'Lift-off in 3…');
  assert.match(TE.launchStill, /^Lift-off confirmed/);
});

test('la nave está en la celda de ASCENSO de cada escenario real, dentro de su plataforma y junto al rover', () => {
  for (const id of ['lola-mouton', 'lola-shackleton']) {
    const sc = JSON.parse(readFileSync(join(root, 'data', id, 'scenario.json'), 'utf8'));
    const p = cellToScene(sc, sc.pad.x, sc.pad.y);
    const vx = p.x + VEHICLE_OFFSET_KM.x, vz = p.z + VEHICLE_OFFSET_KM.z;
    const half = (sc.grid.n * sc.grid.cellM) / 2000;
    const cx = Math.round(((vx + half) * 1000) / sc.grid.cellM - 0.5), cz = Math.round(((vz + half) * 1000) / sc.grid.cellM - 0.5);
    assert.deepEqual({ x: cx, y: cz }, sc.pad, id);
    const off = Math.hypot(VEHICLE_OFFSET_KM.x, VEHICLE_OFFSET_KM.z);
    // Off the cell centre (where the rover stops) by more than the pad, so they do not overlap.
    assert.ok(off > PAD_RADIUS_KM + 0.004, 'el rover aparca fuera de la plataforma');
    assert.ok(off < sc.grid.cellM / 2000, 'dentro de la celda');
  }
});

test('en el mapa, el cohete despega de ASCENSO y deja el círculo vacío al acabar', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, k) => (typeof k === 'string' && !['fillStyle', 'strokeStyle', 'lineWidth'].includes(k) ? (...a) => calls.push([k, ...a]) : undefined), set: () => true });
  drawPad(ctx, 100, 100, 1);
  const still = calls.filter((c) => c[0] === 'moveTo').length;
  calls.length = 0;
  drawPad(ctx, 100, 100, 1, { lift: 0.5 });
  const firstMove = calls.filter((c) => c[0] === 'moveTo');
  assert.ok(firstMove.length > still, 'con la llama');
  assert.ok(firstMove.some((c) => c[2] < 100 - 8), 'el cohete ha subido');
  calls.length = 0;
  drawPad(ctx, 100, 100, 1, { lift: 1 });
  assert.equal(calls.filter((c) => c[0] === 'moveTo').length, 0, 'ya se ha ido');
});

// #398 (fallo en producción): con «Reducir movimiento» la victoria dejaba la nave en el suelo con solo un aviso, y
// «Ver el despegue» hacía lo mismo. Ahora siempre se ve algo: la cinemática o una imagen fija con la nave en el aire.
test('al ganar siempre se ve el despegue: cinemática, o imagen fija con la nave en el aire si se reduce el movimiento', async () => {
  const { launchPlan, stillPose, STILL_ALTITUDE_KM } = await import('../src/cabin/launch.js');
  assert.equal(launchPlan({ over: 'win', launched: false, reduced: false }), 'play');
  assert.equal(launchPlan({ over: 'win', launched: false, reduced: true }), 'still');
  assert.equal(launchPlan({ over: 'win', launched: true, reduced: true }), null);
  for (const over of [null, 'battery', 'time']) assert.equal(launchPlan({ over, launched: false, reduced: true }), null);
  const pose = stillPose();
  assert.ok(pose.altitudeKm === STILL_ALTITUDE_KM && pose.altitudeKm > 0.02, 'la etapa de ascenso, en el aire');
  assert.equal(pose.done, false, 'y visible');
  assert.ok(pose.thrust > 0, 'con el motor encendido');
  // La cabina usa el plan y, para la imagen fija, coloca la nave y gira la cabeza hacia ella.
  const here = dirname(fileURLToPath(import.meta.url));
  const panel = readFileSync(join(here, '../src/cabin/panel.js'), 'utf8');
  assert.match(panel, /launchPlan\(/);
  assert.match(panel, /plan === 'still'\) \{ cabin\.launchStill/);
  const scene = readFileSync(join(here, '../src/cabin/scene.js'), 'utf8');
  assert.match(scene, /launchStill\(\) \{ stillOn = true;/);
  // La cámara mira a la nave directamente (puede quedar detrás del rover, más allá del giro de la cabeza).
  assert.match(scene, /function aimStill\(\) \{[\s\S]{0,500}ascent\.still\(alt\)[\s\S]{0,200}camera\.lookAt\(aimV\)/);
  // La nave queda a ~18° sobre el horizonte, dentro de los 40° que se puede alzar la cabeza.
  const { stillAltitudeKm } = await import('../src/cabin/launch.js');
  for (const d of [0.057, 0.3, 0.1]) {
    const el = (Math.atan2(stillAltitudeKm(d), d) * 180) / Math.PI;
    assert.ok(el > 8 && el < 35, `a ${d} km, ${el}°`);
  }
  // Y al ganar, el giro de «llegar a la nave» no pisa el encuadre del despegue.
  assert.match(panel, /!lift\.status\.ready\) cabin\.lookAtVehicle/);
});
