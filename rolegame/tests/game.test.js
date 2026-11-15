import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, move, pathTo, pass, transmit } from '../src/engine/index.js';
import { applyTap, tapFeedback, NO_PATH, planRoute, decideAction, previewSeverity, previewAlert, previewAnnouncement, enterAction, moveDurationMs, MAX_MOVE_MS, animationProgress } from '../src/tap.js';
import { TEXTS } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data/procedural-shackleton');
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));

function realTables() {
  const b = readFileSync(join(dir, 'sun.bin'));
  const c = readFileSync(join(dir, 'cells.bin'));
  const e = readFileSync(join(dir, 'earth.bin'));
  return createTables(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.length),
    scenario,
    c.buffer.slice(c.byteOffset, c.byteOffset + c.length),
    e.buffer.slice(e.byteOffset, e.byteOffset + e.length),
  );
}

test('el HTML de rolegame/ carga y referencia ficheros que existen', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /<canvas id="map"/);
  assert.match(html, /id="panel"/);
  for (const ref of [...html.matchAll(/(?:src|href)="((?!https?:|\.\.\/)[^"#]+)"/g)].map((m) => m[1])) {
    assert.ok(existsSync(join(root, ref)), `falta ${ref}`);
  }
  const game = readFileSync(join(root, 'src/game.js'), 'utf8');
  assert.match(game, /data\/scenarios\.json/);
  const list = JSON.parse(readFileSync(join(root, 'data/scenarios.json'), 'utf8'));
  assert.ok(list.scenarios.includes(list.default));
  for (const id of list.scenarios) assert.ok(existsSync(join(root, 'data', id, 'scenario.json')), id);
  assert.match(game, /data\/levels\.json/);
  for (const f of ['scenario.json', 'sun.bin', 'cells.bin', 'earth.bin', 'masks.bin', 'series.json', 'map.png']) {
    assert.ok(existsSync(join(dir, f)), f);
    if (f !== 'map.png') assert.match(game, new RegExp(f.replace('.', '\\.')), `game.js no descarga ${f}`);
  }
});

test('la descarga hasta ver el mapa pesa menos de 3 MB', () => {
  const bytes = ['scenario.json', 'sun.bin', 'cells.bin', 'earth.bin', 'masks.bin', 'series.json', 'map.png', 'map-normals.png', 'map-albedo.png', 'map-ao.png'].reduce((a, f) => a + statSync(join(dir, f)).size, 0)
    + statSync(join(root, 'data/levels.json')).size;
  assert.ok(bytes < 3 * 1024 * 1024, `${bytes} bytes`);
});

// Simple sequence of routes: drive to each stop by the cheapest path, send what the engine lets (J3.6: one
// package per zone, so the stops that send are at least 1 km apart) and charge while the cell has Sun.
function playStops(tables, stops) {
  const lit = (s) => tables.sunFrac(s.y * tables.n + s.x, s.t + 0.5) > 0.5;
  let s = newGame(scenario, levels.beg, tables);
  for (const stop of stops) {
    if (s.over) break;
    s = move(s, pathTo(s, stop));
    for (let next = transmit(s); next !== s; next = transmit(s)) s = next;
    for (let k = 0; !s.over && s.battery < 98 && lit(s) && k < 200; k++) s = pass(s, 1);
  }
  return s;
}
// Three zones that see the Earth on the way, 4 to 5 cells (1 to 1.25 km) apart, and the pad.
const STOPS = [{ x: 24, y: 28 }, { x: 25, y: 24 }, { x: 25, y: 20 }, scenario.pad];

test('el escenario real se puede ganar con una secuencia sencilla de rutas, enviando cada paquete desde una zona distinta', () => {
  const end = playStops(realTables(), STOPS);
  assert.deepEqual({ ...playStops(realTables(), STOPS), tables: 0 }, { ...end, tables: 0 }, 'determinista');
  assert.equal(end.over, 'win');
  assert.equal(end.sent, levels.beg.need);
  assert.ok(end.battery >= levels.beg.minBat);
});

test('el cliente no calcula relieve, máscaras ni Sol', () => {
  for (const f of ['game.js', 'main.js']) {
    const src = readFileSync(join(root, 'src', f), 'utf8');
    assert.doesNotMatch(src, /makeWorld|earthVis/);
  }
});

test('applyTap: un movimiento que acaba en batería antes de la primera celda se aplica', () => {
  const tables = realTables();
  const s = newGame(scenario, levels.beg, tables);
  s.x = 24; s.y = 31; s.route = [{ x: 24, y: 31 }]; s.battery = 0.01; s.t = 30;
  const next = applyTap(s, { x: 25, y: 31 });
  assert.ok(next, 'el movimiento no se descarta');
  assert.equal(next.over, 'battery');
});

test('applyTap: tocar la celda actual no cambia nada', () => {
  const s = newGame(scenario, levels.beg, realTables());
  assert.equal(applyTap(s, { x: s.x, y: s.y }), null);
});

test('applyTap: tras el final se ignoran los toques y newGame reinicia', () => {
  const tables = realTables();
  const end = playStops(tables, STOPS);
  assert.equal(end.over, 'win');
  assert.equal(applyTap(end, { x: 0, y: 0 }), null);
  const again = newGame(scenario, levels.beg, tables);
  assert.equal(again.over, null);
  assert.equal(again.route.length, 1);
});

test('applyTap: sin ruta posible devuelve NO_PATH y la pantalla usa los grados del nivel', () => {
  const tables = realTables();
  const steep = { ...tables, height: (c) => (c === scenario.pad.y * tables.n + scenario.pad.x ? 0 : 5000) };
  const s = newGame(scenario, levels.beg, steep);
  assert.equal(applyTap(s, scenario.pad), NO_PATH);
  assert.equal(TEXTS.noPath(levels.beg.maxSlope), 'No hay ruta posible: las pendientes superan 26°');
  assert.deepEqual(tapFeedback(NO_PATH, levels.beg, TEXTS), {
    warning: 'No hay ruta posible: las pendientes superan 26°',
    announcement: 'No hay ruta posible: las pendientes superan 26°',
  });
});

test('tapFeedback: un toque que no es NO_PATH borra el aviso y no anuncia nada', () => {
  assert.deepEqual(tapFeedback(null, levels.beg, TEXTS), { warning: '', announcement: null });
  assert.deepEqual(tapFeedback({ over: null }, levels.beg, TEXTS), { warning: '', announcement: null });
});

test('pista de la plataforma: la distancia sale de start, pad y cellM, no de un número fijo', async () => {
  const { padDistanceKm, hintActive, pulsePhase, HINT_MS, PULSE_MS } = await import('../src/hint.js');
  const expected = Math.hypot(scenario.pad.x - scenario.start.x, scenario.pad.y - scenario.start.y) * scenario.grid.cellM / 1000;
  assert.equal(padDistanceKm(scenario, scenario.grid.cellM), expected);
  const sc = { start: { x: 0, y: 0 }, pad: { x: 3, y: 4 } };
  assert.equal(padDistanceKm(sc, 100), 0.5);
  assert.equal(padDistanceKm(sc, 1000), 5);
  assert.equal(padDistanceKm({ start: { x: 2, y: 2 }, pad: { x: 5, y: 6 } }, 200), 1);
  // Dura como mucho 5 s (WCAG 2.2.2, y dentro de los 6,5 s del criterio); con movimiento reducido el pulso no avanza.
  assert.equal(HINT_MS, 5000);
  assert.ok(hintActive(0) && hintActive(HINT_MS - 1) && !hintActive(HINT_MS));
  assert.equal(pulsePhase(900, true), 0);
  assert.equal(pulsePhase(PULSE_MS / 2, false), 0.5);
  assert.equal(pulsePhase(PULSE_MS, false), 0);
  assert.match(TEXTS.liveStart(2.5, 0, 0), /2,5 km en línea recta/);
  // The text the canvas draws, through the whole chain from start/pad/cellM.
  assert.equal(TEXTS.hintDistance(padDistanceKm(scenario, scenario.grid.cellM)), `${expected.toFixed(1).replace('.', ',')} km`);
  assert.equal(TEXTS.hintDistance(0.5), '0,5 km');
});

test('liveStart: anuncia a cuántos km y en qué dirección está la plataforma', () => {
  assert.equal(TEXTS.liveStart(5.6, 3, 4), 'La plataforma ASCENSO está a 5,6 km al noreste en línea recta.');
  assert.match(TEXTS.liveStart(1, -2, 2), /al noroeste/);
  assert.match(TEXTS.liveStart(1, 2, -2), /al sureste/);
  assert.match(TEXTS.liveStart(1, -2, -2), /al suroeste/);
  assert.match(TEXTS.liveStart(1, 0, 3), /al norte /);
  assert.match(TEXTS.liveStart(1, -3, 0), /al oeste /);
  // La dirección sale de start y pad del escenario (dy > 0 es norte, como liveCursor).
  const dx = scenario.pad.x - scenario.start.x, dy = scenario.start.y - scenario.pad.y;
  const text = TEXTS.liveStart(1, dx, dy);
  assert.match(text, /al (norte|sur|este|oeste|noreste|noroeste|sureste|suroeste) /);
});

test('createHint: arranca, se para al mover, se reinicia y respeta el movimiento reducido', async () => {
  const { createHint, HINT_MS } = await import('../src/hint.js');
  function harness(reduced) {
    let t = 0, nextId = 1;
    const rafs = new Map(), timers = new Map();
    const log = { frames: 0, starts: 0 };
    const hint = createHint({
      now: () => t,
      isReduced: () => reduced,
      raf: (f) => { rafs.set(nextId, f); return nextId++; },
      cancelRaf: (id) => rafs.delete(id),
      setTimer: (f, ms) => { timers.set(nextId, { f, at: t + ms }); return nextId++; },
      clearTimer: (id) => timers.delete(id),
      onFrame: () => { log.frames++; },
      onStart: () => { log.starts++; },
    });
    const advance = (ms) => {
      t += ms;
      for (const [id, f] of [...rafs]) { rafs.delete(id); f(); }
      for (const [id, tm] of [...timers]) if (tm.at <= t) { timers.delete(id); tm.f(); }
    };
    return { hint, log, advance, pending: () => rafs.size + timers.size };
  }

  // Con movimiento: anima cada frame y se apaga solo al acabar HINT_MS.
  const a = harness(false);
  a.hint.start();
  assert.equal(a.log.starts, 1);
  assert.ok(a.hint.active());
  a.advance(1000);
  assert.ok(a.hint.active() && a.log.frames >= 2);
  a.advance(HINT_MS);
  assert.ok(!a.hint.active());
  assert.equal(a.pending(), 0);

  // Mover el rover la para y cancela el temporizador pendiente.
  const b = harness(false);
  b.hint.start();
  b.advance(500);
  b.hint.stop();
  assert.ok(!b.hint.active());
  assert.equal(b.pending(), 0);
  const frames = b.log.frames;
  b.advance(100);
  assert.equal(b.log.frames, frames);

  // «Jugar otra vez»: vuelve a empezar y vuelve a anunciar.
  b.hint.start();
  assert.ok(b.hint.active());
  assert.equal(b.log.starts, 2);

  // Movimiento reducido: dibuja una vez, espera con un único temporizador y se apaga al acabar.
  const r = harness(true);
  r.hint.start();
  assert.equal(r.log.frames, 1);
  assert.equal(r.pending(), 1);
  r.advance(HINT_MS - 1);
  assert.equal(r.log.frames, 1);
  r.advance(1);
  assert.ok(!r.hint.active());
  assert.equal(r.pending(), 0);
  // Pararla antes también limpia el temporizador.
  r.hint.start();
  r.hint.stop();
  assert.equal(r.pending(), 0);
});

const cellM = scenario.grid.cellM;
const decide = (s, plan, action) => decideAction(s, plan, action, levels.beg, TEXTS, cellM);

test('vista previa: batería, hora y celda de llegada son las del estado tras conducir esa ruta', () => {
  const s = newGame(scenario, levels.beg, realTables());
  const plan = planRoute(s, { x: 28, y: 27 }, cellM);
  const driven = move(s, pathTo(s, { x: 28, y: 27 }));
  assert.equal(plan.preview.batteryEnd, driven.battery);
  assert.equal(plan.preview.hours, driven.t - s.t);
  assert.deepEqual(plan.preview.arrival, { x: driven.x, y: driven.y });
  assert.equal(plan.preview.batteryNow, s.battery);
  assert.ok(plan.preview.km > 0);
});

test('decisión del toque: planear no cambia el estado, conducir aplica la ruta y cancelar la olvida', () => {
  const s = newGame(scenario, levels.beg, realTables());
  const before = { ...s, route: s.route.slice() };
  const planned = decide(s, null, { type: 'tap', target: { x: 28, y: 27 } });
  assert.ok(planned.plan);
  assert.equal(planned.drive, null);
  assert.deepEqual({ ...s, route: s.route }, before, 'planear no muta el estado');
  assert.equal(s.route.length, 1);
  // Tocar otra celda cambia el plan.
  const replanned = decide(s, planned.plan, { type: 'tap', target: { x: 32, y: 23 } });
  assert.deepEqual(replanned.plan.target, { x: 32, y: 23 });
  // Conducir aplica exactamente la ruta planeada.
  const driven = decide(s, planned.plan, { type: 'drive' });
  assert.equal(driven.plan, null);
  assert.deepEqual(driven.drive, move(s, pathTo(s, { x: 28, y: 27 })));
  // Cancelar vuelve al estado sin plan.
  const cancelled = decide(s, planned.plan, { type: 'cancel' });
  assert.equal(cancelled.plan, null);
  assert.equal(cancelled.drive, null);
  // Conducir sin plan no hace nada.
  assert.equal(decide(s, null, { type: 'drive' }).drive, null);
});

test('decisión del toque: sin ruta posible no queda plan y se avisa', () => {
  const s = newGame(scenario, levels.beg, realTables());
  const tight = { ...s, level: { ...levels.beg, maxSlope: 0.01 } };
  const out = decideAction(tight, null, { type: 'tap', target: scenario.pad }, tight.level, TEXTS, cellM);
  assert.equal(out.plan, null);
  assert.equal(out.feedback.warning, TEXTS.noPath(0.01));
});

test('colores de la vista previa: rojo si la batería llega a 0, amarillo bajo level.minBat', () => {
  const { minBat } = levels.beg;
  assert.equal(previewSeverity({ batteryEnd: 0, over: 'battery' }, levels.beg), 'depleted');
  assert.equal(previewSeverity({ batteryEnd: 0, over: null }, levels.beg), 'depleted');
  assert.equal(previewSeverity({ batteryEnd: minBat - 0.1, over: null }, levels.beg), 'low');
  assert.equal(previewSeverity({ batteryEnd: minBat, over: null }, levels.beg), null);
  assert.equal(previewSeverity({ batteryEnd: 90, over: null }, levels.beg), null);
});

test('la vista previa de una ruta que agota la batería sale roja', () => {
  const s = newGame(scenario, levels.beg, realTables());
  s.battery = 1;
  const plan = planRoute(s, scenario.pad, cellM);
  assert.equal(plan.preview.severity, 'depleted');
  // km and arrival describe the stretch really driven, like hours and battery.
  const driven = plan.next.route.slice(s.route.length - 1);
  let km = 0;
  for (let i = 1; i < driven.length; i++) km += Math.hypot(driven[i].x - driven[i - 1].x, driven[i].y - driven[i - 1].y) * cellM / 1000;
  assert.equal(plan.preview.km, km);
  assert.deepEqual(plan.preview.arrival, driven[driven.length - 1]);
});

test('una ruta que acaba la partida por tiempo sale roja', () => {
  assert.equal(previewSeverity({ batteryEnd: 90, over: 'time' }, levels.beg), 'depleted');
});

test('la animación dura 1,8 s como mucho', () => {
  assert.equal(MAX_MOVE_MS, 1800);
  assert.equal(moveDurationMs(3), 270);
  assert.equal(moveDurationMs(500), 1800);
  assert.equal(moveDurationMs(0), 0);
});

test('los textos de la vista previa usan coma decimal y dicen la estimación', () => {
  assert.equal(TEXTS.livePreview(3.2, 4, 41.7), '3,2 km, 4 h, llegas con 41 %');
  assert.match(TEXTS.previewNote, /las sombras se mueven mientras conduces/);
});

test('previewAlert y previewAnnouncement: ninguno, bajo, agotada y tiempo', () => {
  const level = { minBat: 30 };
  const base = { km: 3.2, hours: 4, batteryEnd: 41.7, over: null, severity: null };
  const live = TEXTS.livePreview(3.2, 4, 41.7);
  assert.equal(previewAlert(base, level, TEXTS), '');
  assert.equal(previewAnnouncement(base, level, TEXTS), live);
  const low = { ...base, batteryEnd: 20, severity: 'low' };
  assert.equal(previewAlert(low, level, TEXTS), TEXTS.previewLow(30));
  assert.equal(previewAnnouncement(low, level, TEXTS), `${TEXTS.livePreview(3.2, 4, 20)}. ${TEXTS.previewLow(30)}`);
  const depleted = { ...base, batteryEnd: 0, severity: 'depleted', over: 'battery' };
  assert.equal(previewAlert(depleted, level, TEXTS), TEXTS.previewDepleted);
  assert.equal(previewAnnouncement(depleted, level, TEXTS), TEXTS.livePreviewDepleted(3.2, 4));
  const time = { ...base, severity: 'depleted', over: 'time' };
  assert.equal(previewAlert(time, level, TEXTS), TEXTS.previewTime);
  assert.equal(previewAnnouncement(time, level, TEXTS), `${live}. ${TEXTS.previewTime}`);
});

test('enterAction: Intro en la celda planeada conduce y en otra planea', () => {
  const plan = { target: { x: 2, y: 3 } };
  assert.equal(enterAction(plan, { x: 2, y: 3 }), 'drive');
  assert.equal(enterAction(plan, { x: 2, y: 4 }), 'plan');
  assert.equal(enterAction(null, { x: 2, y: 3 }), 'plan');
});

test('decisión del toque: tocar la celda del rover con un plan lo descarta y lo anuncia', () => {
  const s = newGame(scenario, levels.beg, realTables());
  const planned = decide(s, null, { type: 'tap', target: { x: 28, y: 27 } });
  const out = decide(s, planned.plan, { type: 'tap', target: { x: s.x, y: s.y } });
  assert.equal(out.plan, null);
  assert.equal(out.feedback.announcement, TEXTS.liveCancelled);
  // Sin plan previo no hay nada que anunciar.
  assert.equal(decide(s, null, { type: 'tap', target: { x: s.x, y: s.y } }).feedback.announcement, null);
});

// ---- Reduced motion (J10.2) ----

test('reduceMotion: lo guardado manda; sin nada guardado, el sistema', async () => {
  const { reduceMotion, toggledMotion, MOTION_KEY } = await import('../src/motion.js');
  assert.equal(reduceMotion({ systemPrefers: true, saved: null }), true);
  assert.equal(reduceMotion({ systemPrefers: false, saved: null }), false);
  assert.equal(reduceMotion({ systemPrefers: true, saved: 'full' }), false);
  assert.equal(reduceMotion({ systemPrefers: false, saved: 'reduce' }), true);
  assert.equal(reduceMotion({ systemPrefers: true, saved: 'otro' }), true);
  assert.equal(toggledMotion(true), 'full');
  assert.equal(toggledMotion(false), 'reduce');
  assert.equal(MOTION_KEY, 'llsn.motion');
});

test('con movimiento reducido conducir no se anima; sin él, como siempre', () => {
  assert.equal(moveDurationMs(10, { reduced: true }), 0);
  assert.equal(moveDurationMs(10, { reduced: false }), 900);
  assert.equal(moveDurationMs(10), 900);
});

test('game.css apaga animaciones y transiciones con la preferencia del sistema y con .reduce-motion', () => {
  const css = readFileSync(join(root, 'src/styles/game.css'), 'utf8');
  const media = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.ok(media, 'falta la regla del sistema');
  assert.match(media[1], /animation: none !important; transition: none !important/);
  assert.match(css, /\.reduce-motion \*[^{]*\{[^}]*animation: none !important; transition: none !important/);
});

test('el pulso de la plataforma no late con movimiento reducido', async () => {
  const { pulsePhase } = await import('../src/hint.js');
  assert.equal(pulsePhase(1234, true), 0);
});

test('el interruptor de movimiento está en «Ajustes», como interruptor con su etiqueta del diccionario', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /id="motion-label" data-text="motion"/);
  assert.match(html, /id="motion-btn" role="switch" aria-checked="false" aria-labelledby="motion-label"/);
  const main = readFileSync(join(root, 'src/main.js'), 'utf8');
  assert.match(main, /isReduced: reduced/);
  assert.match(main, /classList\.toggle\('reduce-motion'/);
});

test('animationProgress: un primer fotograma anterior al inicio da 0, no un valor negativo', () => {
  assert.equal(animationProgress(995, 1000, 1800), 0);
  assert.equal(animationProgress(1900, 1000, 1800), 0.5);
  assert.equal(animationProgress(5000, 1000, 1800), 1);
});
