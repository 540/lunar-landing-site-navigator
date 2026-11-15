// Cabin of the rover (J12.1, #297): which scenarios offer it, where the camera goes, the descent, the head and the
// rover turning with inertia, the breathing and the dust. Pure parts only; the 3D scene is checked in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cabinRegion, cellToScene, headingToYaw, descentPose, stepLook, stepTurn, breathing, cabinEffects, lerpAngle,
  EYE_KM, DESCENT_START_KM, LOOK, REGION_ROOT,
} from '../src/cabin/logic.js';
import { createDust, emitDust, stepDust, apex, flightTime, G_KM } from '../src/cabin/dust.js';
import { mountCabin, cabinView } from '../src/cabin/panel.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scenarioOf = (id) => JSON.parse(readFileSync(join(root, 'data', id, 'scenario.json'), 'utf8'));
const mouton = scenarioOf('lola-mouton');
const shackleton = scenarioOf('lola-shackleton');
const procedural = scenarioOf('procedural-shackleton');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('la cabina se ofrece en los escenarios LOLA con mapa completo, no en el procedural ni en modo ligero', () => {
  assert.equal(cabinRegion({ scenario: mouton, mapMode: 'full' }), 'im2-objetivo');
  assert.equal(cabinRegion({ scenario: shackleton, mapMode: 'full' }), 'shackleton-rim');
  assert.equal(cabinRegion({ scenario: procedural, mapMode: 'full' }), null);
  assert.equal(cabinRegion({ scenario: mouton, mapMode: 'light' }), null);
  assert.equal(cabinRegion({ scenario: { ...mouton, siteId: 'otro-sitio' }, mapMode: 'full' }), null);
  assert.equal(cabinRegion({ scenario: null, mapMode: 'full' }), null);
});

test('cada escenario LOLA tiene su región del Mirador, con el mismo centro', () => {
  for (const sc of [mouton, shackleton]) {
    const dir = join(root, REGION_ROOT, sc.siteId);
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
    assert.deepEqual(meta.center, sc.center, sc.id);
    assert.ok(existsSync(join(dir, meta.heights.file)), `${sc.id}: ${meta.heights.file}`);
    // The 12 km of the game fit in the region the cabin draws.
    assert.ok(meta.extentKm >= (sc.grid.n * sc.grid.cellM) / 1000, sc.id);
  }
});

test('una celda del juego cae en el marco del Mirador: x al este, z al sur, centrado en el sitio', () => {
  const { n, cellM } = mouton.grid;
  const half = (n * cellM) / 2000;
  const c0 = cellToScene(mouton, 0, 0);
  near(c0.x, -half + cellM / 2000); near(c0.z, -half + cellM / 2000);
  const mid = cellToScene(mouton, n / 2 - 0.5, n / 2 - 0.5);
  near(mid.x, 0); near(mid.z, 0);
  const east = cellToScene(mouton, 10, 5), south = cellToScene(mouton, 9, 6);
  near(east.x - cellToScene(mouton, 9, 5).x, cellM / 1000);
  near(south.z - cellToScene(mouton, 9, 5).z, cellM / 1000);
});

test('la vista sale de la partida: posición del rover y rumbo hacia ASCENSO antes del primer paso', () => {
  const v = cabinView(mouton, { x: mouton.start.x, y: mouton.start.y, t: 3, route: [{ ...mouton.start }] });
  const p = cellToScene(mouton, mouton.start.x, mouton.start.y);
  near(v.x, p.x); near(v.z, p.z);
  assert.equal(v.t, 3);
  const dx = mouton.pad.x - mouton.start.x, dy = mouton.pad.y - mouton.start.y;
  near(v.heading, Math.atan2(dx, -dy));
  near(headingToYaw(Math.PI / 2), -Math.PI / 2);
});

test('la bajada sale del mapa (cenital, norte arriba, 13 km) y aterriza a 2,2 m mirando al frente', () => {
  const ground = 1.2, yaw = 2.1;
  const a = descentPose(0, { x: 1, z: 2, ground, yaw });
  near(a.y, ground + DESCENT_START_KM); near(a.pitch, -Math.PI / 2); near(a.yaw, 0);
  const b = descentPose(1, { x: 1, z: 2, ground, yaw });
  near(b.y, ground + EYE_KM); near(b.pitch, 0); near(b.yaw, yaw);
  assert.deepEqual([b.x, b.z], [1, 2]);
  // Monotonous fall, and the horizon (pitch above −10°) in view before the end.
  let prev = Infinity;
  for (let k = 0; k <= 1.0001; k += 0.05) { const p = descentPose(k, { x: 0, z: 0, ground, yaw }); assert.ok(p.y <= prev + 1e-12); prev = p.y; }
  assert.ok(descentPose(0.85, { x: 0, z: 0, ground, yaw }).pitch > -10 * Math.PI / 180);
  // Out of range values are clamped (the first frame can come a little before the start).
  assert.deepEqual(descentPose(-0.2, { x: 0, z: 0, ground, yaw }), descentPose(0, { x: 0, z: 0, ground, yaw }));
  near(lerpAngle(3, -3, 1), 3 + (2 * Math.PI - 6));
});

test('la cabeza tiene inercia y límites', () => {
  let look = stepLook({ yaw: 0, pitch: 0, vYaw: 0, vPitch: 0 }, 0, { push: { vYaw: 200, vPitch: -100 } });
  const after = stepLook(look, 0.1);
  assert.ok(after.yaw > 0 && after.pitch < 0);
  assert.ok(Math.abs(after.vYaw) < 200, 'frena sola');
  let l = after;
  for (let i = 0; i < 100; i++) l = stepLook(l, 0.05);
  assert.equal(l.vYaw, 0); assert.equal(l.vPitch, 0);
  const far = stepLook({ yaw: 0, pitch: 0, vYaw: 5000, vPitch: 5000 }, 1);
  assert.equal(far.yaw, LOOK.yaw); assert.equal(far.pitch, LOOK.pitchMax);
});

test('el rover gira sobre sí mismo con las flechas, acelera hasta 45 °/s y frena al soltar', () => {
  let t = { angle: 0, v: 0 };
  for (let i = 0; i < 20; i++) t = stepTurn(t, 0.05, 1);
  assert.equal(t.v, 45);
  assert.ok(t.angle > 0);
  for (let i = 0; i < 20; i++) t = stepTurn(t, 0.05, 0);
  assert.equal(t.v, 0);
  assert.ok(stepTurn({ angle: 0, v: 0 }, 0.1, -1).v < 0);
});

test('la respiración de la cabina es leve y desaparece con «Reducir movimiento»', () => {
  assert.deepEqual(breathing(1.3, true), { dy: 0, roll: 0, pitch: 0 });
  for (let t = 0; t < 10; t += 0.37) {
    const b = breathing(t, false);
    assert.ok(Math.abs(b.dy) <= 0.00002 + 1e-12 && Math.abs(b.roll) < 0.002 && Math.abs(b.pitch) < 0.002);
  }
});

test('calidad: sin destellos en «bajo», menos polvo y sombras más bastas (el regolito sigue la regla del Mirador)', () => {
  const low = cabinEffects('bajo'), mid = cabinEffects('medio'), high = cabinEffects('alto');
  // The regolith is not a cabin effect any more (#403): the ground is the Mirador's, with its own rule per level.
  for (const fx of [low, mid, high]) assert.equal(fx.regolith, undefined);
  assert.equal(low.flare, false); assert.equal(mid.flare, true);
  assert.ok(low.dust < mid.dust && mid.dust < high.dust);
  assert.ok(low.shadowMap <= mid.shadowMap && mid.shadowMap <= high.shadowMap);
});

test('el polvo vuela en parábolas sin aire: altura v²/2g y vuelve al suelo en 2v/g', () => {
  const d = createDust(4);
  emitDust(d, { x: 0, y: 0, z: 0, heading: 0, count: 1 });
  const vy = d.vel[1];
  let top = d.pos[1], t = 0;
  const dt = 0.001;
  while (d.alive[0]) { stepDust(d, dt); t += dt; if (d.alive[0]) top = Math.max(top, d.pos[1]); }
  near(top, apex(vy), 1e-8);
  near(t, flightTime(vy), 2 * dt);
  near(G_KM, 0.00162);
  // Deterministic: the same seed throws the same grains.
  const a = createDust(8), b = createDust(8);
  emitDust(a, { x: 0, y: 0, z: 0, count: 8 }); emitDust(b, { x: 0, y: 0, z: 0, count: 8 });
  assert.deepEqual([...a.vel], [...b.vel]);
  // Grains go mostly backwards (heading 0 = north: backwards is +z, south) and always up.
  for (let i = 0; i < 8; i++) { assert.ok(a.vel[i * 3 + 1] > 0); assert.ok(a.vel[i * 3 + 2] > 0); }
});

test('sin cabina (procedural o modo ligero) no se monta nada ni se pide three.js', () => {
  let loads = 0;
  const load = () => { loads++; return Promise.reject(new Error('no')); };
  for (const [scenario, mapMode] of [[procedural, 'full'], [mouton, 'light']]) {
    const c = mountCabin({ stack: null, corner: null, scenario, series: null, startMs: 0, mapMode, texts: texts('es'), load });
    assert.equal(c.offered, false);
    assert.equal(c.active(), false);
    c.setView({ x: 0, y: 0, t: 0 }); c.toLight();
  }
  assert.equal(loads, 0);
});

test('three.js solo llega con el import() dinámico de la escena; el motor no se toca', () => {
  for (const f of ['logic.js', 'dust.js', 'panel.js']) {
    const src = readFileSync(join(root, 'src/cabin', f), 'utf8');
    assert.doesNotMatch(src, /from 'three'/, f);
    assert.doesNotMatch(src, /engine\//, f);
  }
  const panel = readFileSync(join(root, 'src/cabin/panel.js'), 'utf8');
  assert.match(panel, /import\('\.\/scene\.js'\)/);
  assert.doesNotMatch(readFileSync(join(root, 'src/game.js'), 'utf8'), /cabin\//);
  // The goal opens once the descent has landed, not over it.
  assert.match(readFileSync(join(root, 'src/main.js'), 'utf8'), /cabin\.descend\(\)\.then\(open\)/);
});

test('los textos de la cabina existen en español e inglés', () => {
  for (const lang of ['es', 'en']) {
    const T = texts(lang);
    for (const k of ['viewModeLabel', 'viewMap', 'viewCabin', 'cabinLoading', 'cabinUnavailable']) assert.equal(typeof T[k], 'string', `${lang}.${k}`);
    const s = T.cabinSummary(T.winds.NE, 2.14, false, T.winds.N, -2);
    assert.match(s, lang === 'es' ? /Sol al noreste, a 2,1°, tapado por el relieve/ : /Sun to the/);
  }
});

// ---- Driving (J12.2) ----
import { stepCar, cellOf, bounceBack, stepSuspension, compassMark, cellBearing, DRIVE, CELL_M, kmh, cabinRouteMs, followRoute } from '../src/cabin/logic.js';
import { DRIVE_KEYS, CABIN_ACTIONS, TURBO_KEY } from '../src/cabin/panel.js';
import { createTables, newGame, move, stepCost } from '../src/engine/index.js';
import { SHORTCUTS } from '../src/cell-report.js';

const buf = (f) => { const b = readFileSync(join(root, 'data/lola-mouton', f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const levelsOf = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));

test('conducir: velocidad de rover creíble (≈43 km/h, 130 km/h con la marcha larga), marcha atrás lenta, gira sobre sí mismo', () => {
  // #403: 0.5 celdas/s eran 125 m/s (450 km/h) con celdas de 250 m.
  assert.ok(kmh(DRIVE.cruise) >= 30 && kmh(DRIVE.cruise) <= 60, `${kmh(DRIVE.cruise)} km/h`);
  assert.ok(DRIVE.turbo > DRIVE.cruise && kmh(DRIVE.turbo) <= 150, `${kmh(DRIVE.turbo)} km/h`);
  let c = { x: 10, y: 10, heading: 0, speed: 0 };
  for (let i = 0; i < 60; i++) c = stepCar(c, { throttle: 1 }, 0.1);
  near(c.speed, DRIVE.cruise);
  assert.ok(c.y < 10, 'hacia el norte (−y)');
  // 6 s at cruise: about 72 m, under a third of a cell.
  near(10 - c.y, (DRIVE.cruise * 6 - (DRIVE.cruise ** 2) / (2 * DRIVE.accel)) / CELL_M, 0.02);
  // The long gear, and letting go of it slows down to cruise without braking at once.
  for (let i = 0; i < 100; i++) c = stepCar(c, { throttle: 1, turbo: true }, 0.1);
  near(c.speed, DRIVE.turbo);
  const shifted = stepCar(c, { throttle: 1 }, 0.1);
  assert.ok(shifted.speed < DRIVE.turbo && shifted.speed > DRIVE.cruise, 'baja de marcha poco a poco');
  for (let i = 0; i < 100; i++) c = stepCar(c, { throttle: -1 }, 0.1);
  near(c.speed, -DRIVE.reverse);
  const spin = stepCar({ x: 0, y: 0, heading: 0, speed: 0 }, { steer: 1 }, 1);
  assert.ok(spin.heading > 0 && spin.x === 0 && spin.y === 0, 'gira sin moverse');
  const coast = stepCar({ x: 0, y: 0, heading: 0, speed: 8 }, {}, 1);
  assert.ok(coast.speed < 8 && coast.speed >= 0);
  // The size of the cell sets how far a metre goes on the grid.
  const half = stepCar({ x: 0, y: 0, heading: Math.PI / 2, speed: 10 }, { throttle: 1 }, 1, 125);
  const full = stepCar({ x: 0, y: 0, heading: Math.PI / 2, speed: 10 }, { throttle: 1 }, 1, 250);
  near(half.x, 2 * full.x, 1e-9);
});

test('piloto automático en la cabina: al paso del rover, nunca más de DRIVE.autopilotMaxMs, y sin saltos de celda', () => {
  near(cabinRouteMs(1), (CELL_M / DRIVE.autopilot) * 1000, 1e-6);
  assert.equal(cabinRouteMs(200), DRIVE.autopilotMaxMs, 'una ruta larga acelera');
  assert.equal(cabinRouteMs(3, CELL_M, { reduced: true }), 0);
  assert.equal(cabinRouteMs(0), 0);
  // Following the route: the car goes where the route is and turns towards it smoothly.
  let car = { x: 0, y: 0, heading: 0, speed: 0 };
  car = followRoute(car, { x: 0.02, y: 0 }, 0.1);
  near(car.x, 0.02, 1e-12);
  assert.ok(car.heading > 0 && car.heading < Math.PI / 2, 'gira hacia el este poco a poco');
  near(car.speed, (0.02 * CELL_M) / 0.1, 1e-9);
  for (let i = 0; i < 30; i++) car = followRoute(car, { x: car.x + 0.01, y: 0 }, 0.1);
  near(car.heading, Math.PI / 2, 1e-6);
  const still = followRoute(car, { x: car.x, y: car.y }, 0.1);
  assert.equal(still.speed, 0);
});

test('conducir celda a celda desde la cabina da el mismo estado que move con esa ruta', () => {
  const sc = JSON.parse(readFileSync(join(root, 'data/lola-mouton/scenario.json'), 'utf8'));
  const tables = createTables(buf('sun.bin'), sc, buf('cells.bin'), buf('earth.bin'));
  const level = levelsOf['lola-mouton']?.beg ?? levelsOf.beg ?? Object.values(levelsOf)[0].beg;
  let byStep = newGame(sc, level, tables);
  const start = byStep;
  // Drive north-east for a while, as the panel does: every time the car crosses into a neighbouring cell, one move().
  let car = { x: start.x, y: start.y, heading: Math.PI / 4, speed: 0 };
  const path = [];
  for (let i = 0; i < 400 && path.length < 6; i++) {
    const from = cellOf(car);
    const next = stepCar(car, { throttle: 1, turbo: true }, 0.5);
    const to = cellOf(next);
    if (to.x !== from.x || to.y !== from.y) {
      assert.equal(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)), 1, 'siempre a una vecina');
      if (stepCost(tables, level, from.y * tables.n + from.x, to.y * tables.n + to.x) === null) { car = bounceBack(next, from); continue; }
      byStep = move(byStep, [to]);
      path.push(to);
    }
    car = next;
  }
  assert.ok(path.length >= 3, `${path.length} celdas`);
  const byRoute = move(start, path);
  const strip = ({ tables: _t, ...rest }) => rest;
  assert.deepEqual(strip(byStep), strip(byRoute));
});

test('contra una pendiente imposible el rover vuelve dentro de su celda y se para', () => {
  const back = bounceBack({ x: 12.7, y: 9.2, heading: 0, speed: 0.4 }, { x: 12, y: 9 });
  assert.equal(back.speed, 0);
  assert.deepEqual(cellOf(back), { x: 12, y: 9 });
  assert.ok(back.x <= 12.45 + 1e-9);
});

test('la suspensión rebota con la gravedad lunar y se asienta; con «Reducir movimiento» va pegada al suelo', () => {
  let s = { y: NaN, v: 0 };
  s = stepSuspension(s, 1, 1 / 60);
  assert.equal(s.y, 1);
  // A bump of 20 cm: it goes up, comes back and settles.
  let top = 1;
  for (let i = 0; i < 30; i++) { s = stepSuspension(s, 1.0002, 1 / 60); top = Math.max(top, s.y); }
  for (let i = 0; i < 600; i++) s = stepSuspension(s, 1, 1 / 60);
  assert.ok(top > 1.0001);
  assert.ok(Math.abs(s.y - 1) < 0.00002, `${s.y}`);
  assert.deepEqual(stepSuspension({ y: 5, v: 1 }, 2, 0.1, true), { y: 2, v: 0 });
});

test('teclas de la cabina: W A S D y flechas conducen; la barra de acciones enseña los mismos atajos que el panel', () => {
  for (const k of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']) assert.ok(DRIVE_KEYS[k], k);
  for (const a of CABIN_ACTIONS) if (a.key) assert.equal(a.key, SHORTCUTS[a.id], a.id);
  assert.equal(CABIN_ACTIONS.find((a) => a.id === 'wait-sun').key, null, 'S conduce marcha atrás en la cabina');
  for (const lang of ['es', 'en']) {
    const T = texts(lang);
    for (const a of CABIN_ACTIONS) assert.equal(typeof T[a.label], 'string', `${lang}.${a.label}`);
    assert.match(T.cabinSlope(26), /26°/);
    for (const k of ['fullscreen', 'fullscreenExit', 'cabinEdge', 'cabinActionsLabel']) assert.equal(typeof T[k], 'string');
  }
});

test('brújula de la cabina: lo que tienes delante en el centro, a los lados lo que queda a 90°, fuera la flecha', () => {
  assert.deepEqual(compassMark(30, 30), { x: 0, off: 0 });
  assert.deepEqual(compassMark(120, 30), { x: 1, off: 0 });
  assert.deepEqual(compassMark(350, 20), { x: -30 / 90, off: 0 });
  assert.deepEqual(compassMark(200, 0), { x: -1, off: -1 });
  assert.deepEqual(compassMark(170, 0), { x: 1, off: 1 });
  near(cellBearing({ x: 5, y: 5 }, { x: 5, y: 2 }), 0);
  near(cellBearing({ x: 5, y: 5 }, { x: 8, y: 5 }), 90);
  near(cellBearing({ x: 5, y: 5 }, { x: 5, y: 9 }), 180);
  assert.match(texts('es').cabinZone(1.24, true), /Tierra · 1,2 km/);
  assert.match(texts('es').cabinZone(3, false), /Tierra pronto/);
});

// ---- J12.4 and J12.6 (#300, #302): autopilot from the cabin, keyboard and screen reader ----

test('teclas propias de la cabina: conducir, Intro con ruta, Escape con ruta, M al minimapa', async () => {
  const { cabinKey } = await import('../src/cabin/panel.js');
  const k = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra });
  assert.equal(cabinKey(k('w')), 'drive-key');
  assert.equal(cabinKey(k('ArrowLeft')), 'drive-key');
  assert.equal(cabinKey(k('Enter')), null, 'sin ruta, Intro no hace nada');
  assert.equal(cabinKey(k('Enter'), { planned: true }), 'autopilot');
  assert.equal(cabinKey(k('Escape'), { planned: true }), 'cancel-route');
  assert.equal(cabinKey(k('Escape'), { planned: true, fullWindow: true }), null, 'en ventana completa, Escape sale de ella');
  assert.equal(cabinKey(k('m')), 'minimap');
  assert.equal(cabinKey(k('Shift')), 'turbo', 'Mayús es la marcha larga');
  assert.equal(TURBO_KEY, 'shift');
  assert.equal(cabinKey(k('w', { ctrlKey: true })), null);
  // M no choca con los atajos del juego (J10.3, #318).
  const { SHORTCUTS } = await import('../src/cell-report.js');
  assert.ok(!Object.values(SHORTCUTS).map((v) => v.toLowerCase()).includes('m'));
});

test('al cruzar celdas conduciendo, como mucho un anuncio por segundo', async () => {
  const { cellAnnounceDue, CELL_ANNOUNCE_MS } = await import('../src/cell-report.js');
  assert.equal(CELL_ANNOUNCE_MS, 1000);
  assert.equal(cellAnnounceDue(-Infinity, 0), true);
  assert.equal(cellAnnounceDue(1000, 1999), false);
  assert.equal(cellAnnounceDue(1000, 2000), true);
});

test('piloto automático: la cabina conduce la ruta y retomar los mandos usa el motor en la celda alcanzada', () => {
  const src = readFileSync(join(root, 'src/game.js'), 'utf8');
  // The route stopped mid-way is replayed by the engine up to the cells walked: no state is invented.
  assert.match(src, /move\(before, out\.drive\.route\.slice\(before\.route\.length, before\.route\.length \+ walked\)\)/);
  for (const name of ['cabinDrive', 'cabinCancel', 'stopDrive', 'cabinPlan']) assert.match(src, new RegExp(`${name}:`), name);
  const panel = readFileSync(join(root, 'src/cabin/panel.js'), 'utf8');
  assert.match(panel, /game\.stopDrive\?\.\(\)/);
  // Closing the tutorial or the goal over the cabin gives it the keyboard back.
  const main = readFileSync(join(root, 'src/main.js'), 'utf8');
  assert.match(main, /returnTo: cabin\.focusTarget/);
  assert.match(main, /cabin\?\.focus\(\)/);
});

test('textos del piloto automático y del minimapa en los dos idiomas', () => {
  for (const lang of ['es', 'en']) {
    const T = texts(lang);
    assert.match(T.cabinDrive(1.25), lang === 'es' ? /1,3 km · Intro/ : /1\.3 km · Enter/);
    for (const k of ['cabinCancel', 'cabinTakeOver', 'cabinMinimap']) assert.equal(typeof T[k], 'string', `${lang}.${k}`);
    assert.match(T.cabinSummary('norte', 1, true, 'sur', 2), /M /);
  }
});

test('con «Reducir movimiento» la escena no balancea, no rebota, no sacude y no hace la bajada', () => {
  const scene = readFileSync(join(root, 'src/cabin/scene.js'), 'utf8');
  assert.match(scene, /descend\(\) \{ descent = isReduced\(\) \? null/);
  assert.match(scene, /const shake = !reduced &&/);
  assert.match(scene, /const lean = reduced \? 0/);
  assert.match(scene, /stepSuspension\(susp, ground, lastDt, reduced\)/);
});

test('el suelo de la cabina es el del Mirador a pie (#403): su material, sin parche ni pedruscos propios', async () => {
  const { readFileSync, existsSync: exists } = await import('node:fs');
  const src = readFileSync(new URL('../src/cabin/scene.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ createTerrainLook \} from '\.\.\/\.\.\/\.\.\/viewpoint\/src\/terrain-material\.js'/);
  assert.match(src, /terrain\.material\(/);
  assert.match(src, /terrain\.setFoot\(true\)/);
  assert.match(src, /buildLevels\(meta, /);
  assert.doesNotMatch(src, /micro\.js|patch-worker|InstancedMesh|occlusionColors|regolithNormalMap/);
  assert.ok(!exists(new URL('../src/cabin/micro.js', import.meta.url)) && !exists(new URL('../src/cabin/patch-worker.js', import.meta.url)));
  const { TEXTS } = await import('../src/texts.js');
  assert.match(TEXTS.cabinSource, /ilustrativ/);
  assert.match(TEXTS.cabinSummary('N', 1, true, 'S', 1), /ilustrativ/);
});
