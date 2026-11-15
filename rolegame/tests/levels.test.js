// J6: level selector and panels (J6.1), mission goal (J6.2), checks (J6.3), events (J6.4) and help by level (J6.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, pass, wait, move, pathTo, transmit, rng } from '../src/engine/index.js';
import { LEVEL_IDS, levelFromSearch, levelSearch, seedFromSearch, panelStatus } from '../src/level.js';
import { goalSteps } from '../src/goal.js';
import { missionChecks, newlyDone } from '../src/checks.js';
import { levelHint, earthToggleShown } from '../src/aids.js';
import { earthLayerOn } from '../src/earth-layer.js';
import { missionHintText } from '../src/mission-hint.js';
import { logLines, newEvents } from '../src/event-log.js';
import { planRoute, decideAction } from '../src/tap.js';
import { transmitLabel } from '../src/transmit.js';
import { keyAction, SHORTCUTS } from '../src/cell-report.js';
import { TEXTS } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));
const { beg, mid, exp } = levels;

// Small synthetic world: n × n cells with the Sun fraction `sun(h, c)` (0..1) and the Earth `earth(h, c)`.
const N = 5, HOURS = 400;
const scenario = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 0, y: 0 }, pad: { x: 4, y: 0 } };
function world(sun, earth = () => false) {
  const s = new Uint8Array(HOURS * N * N);
  const bits = new Uint8Array(Math.ceil((HOURS * N * N) / 8));
  for (let h = 0; h < HOURS; h++) for (let c = 0; c < N * N; c++) {
    const o = h * N * N + c;
    s[o] = Math.round(sun(h, c) * 255);
    if (earth(h, c)) bits[o >> 3] |= 1 << (o & 7);
  }
  return createTables(s.buffer, scenario, undefined, bits.buffer);
}
const strip = ({ tables: _t, ...rest }) => rest;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// ---- J6.1 · Level selector and panels ----

test('levelFromSearch: el nivel de ?level=, y principiante si falta o no existe', () => {
  assert.deepEqual(LEVEL_IDS, ['beg', 'mid', 'exp']);
  assert.equal(levelFromSearch('?level=exp'), 'exp');
  for (const s of ['', '?level=hard', '?level=']) assert.equal(levelFromSearch(s), 'beg');
});

test('levelSearch cambia el nivel sin tocar los demás parámetros', () => {
  const s = levelSearch('?seed=7', 'mid');
  assert.match(s, /seed=7/);
  assert.match(s, /level=mid/);
  assert.equal(levelFromSearch(levelSearch('?level=beg&seed=2', 'exp')), 'exp');
});

test('seedFromSearch: un entero fija la semilla; sin él, null', () => {
  assert.equal(seedFromSearch('?seed=3'), 3);
  assert.equal(seedFromSearch(''), null);
  assert.equal(seedFromSearch('?seed=abc'), null);
});

test('panelStatus con los umbrales del motor (experto: panelMin 0,5)', () => {
  // A stub with the exact fraction: 0.5 cannot be stored in sun.bin (uint8).
  const at = (f, level) => panelStatus({ tables: { n: 1, sunFrac: () => f }, level, x: 0, y: 0, t: 0 });
  assert.equal(at(0.4, exp), 'below');
  assert.equal(at(0.5, exp), 'partial');
  assert.equal(at(0.8, exp), 'sun');
  assert.equal(at(0, exp), 'dark');
  assert.equal(at(0.4, beg), 'partial');
  for (const k of ['sun', 'partial', 'dark', 'below']) assert.equal(typeof TEXTS.panelStatus[k], 'string');
});

test('cada nivel tiene sus cifras: intermedio 66 %, 20 %, día 12; experto 70 %, 25 %, día 10', () => {
  assert.deepEqual([mid.bat0, mid.minBat, mid.deadline / 24], [66, 20, 12]);
  assert.deepEqual([exp.bat0, exp.minBat, exp.deadline / 24], [70, 25, 10]);
  for (const id of LEVEL_IDS) assert.equal(typeof TEXTS.levelNames[id], 'string');
});

test('el HTML tiene el selector de nivel con aria-pressed y textos del diccionario', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(html, /class="levels" role="group" data-aria-label="levelLabel"/);
  for (const id of LEVEL_IDS) assert.match(html, new RegExp(`data-level="${id}"[^>]*aria-pressed`));
  assert.ok(TEXTS.tutorialSteps.some((s) => s.target === '.levels'), 'paso del tutorial para el selector');
});

// ---- Equilibrium with the real tables (until the solver, #237) ----

const dir = join(root, 'data/procedural-shackleton');
const realScenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const real = createTables(buf('sun.bin'), realScenario, buf('cells.bin'), buf('earth.bin'));

// Drives to each stop, sends what the engine lets (one package per zone, J3.6) and charges while it has Sun.
function playStops(level, stops, options = {}) {
  const lit = (s) => real.sunFrac(s.y * real.n + s.x, s.t + 0.5) > 0.5;
  let s = newGame(realScenario, level, real, options);
  for (const stop of stops) {
    if (s.over) break;
    s = move(s, pathTo(s, stop));
    for (let next = transmit(s); next !== s; next = transmit(s)) s = next;
    for (let k = 0; !s.over && s.battery < 98 && lit(s) && k < 200; k++) s = pass(s, 1);
  }
  return s;
}
const PAD = realScenario.pad;
// The zones the solver sent from (solver.json, J9.1), each at least 1 km from the others, and the pad.
const SEQUENCES = {
  mid: [{ x: 24, y: 28 }, { x: 27, y: 25 }, { x: 36, y: 18 }, { x: 37, y: 2 }, PAD],
  exp: [{ x: 24, y: 28 }, { x: 28, y: 26 }, { x: 40, y: 11 }, { x: 40, y: 7 }, { x: 38, y: 2 }, PAD],
};

for (const id of ['mid', 'exp']) {
  test(`${id}: el escenario real se gana con una secuencia conocida, sin evento y con cada evento en los extremos`, () => {
    const level = levels[id];
    for (const event of [null, { at: 70, type: 'spike' }, { at: 140, type: 'spike' }, { at: 70, type: 'antenna' }, { at: 140, type: 'antenna' }]) {
      const end = playStops(level, SEQUENCES[id], { event });
      assert.equal(end.over, 'win', `${id} con ${JSON.stringify(event)}: ${end.over} a ${end.t} h`);
      assert.equal(end.sent, level.need);
      assert.ok(end.battery >= level.minBat);
    }
  });
}

// ---- J6.2 · Mission goal ----

test('goalSteps: las cifras salen del nivel', () => {
  const m = goalSteps(mid, TEXTS);
  assert.deepEqual(m.map((s) => s.icon), ['sun', 'antenna', 'rocket']);
  assert.match(m[1].title, /^Envía tu informe a la Tierra en 4 paquetes/);
  // J3.6: what the packages are for and the distance between zones, from the level.
  assert.match(m[1].detail, /no autoriza el despegue/);
  assert.match(m[1].detail, /a más de 1 km de los anteriores/);
  assert.match(goalSteps({ ...mid, txMinKm: 1.5 }, TEXTS)[1].detail, /1,5 km/);
  assert.match(m[2].title, /antes del día 12$/);
  assert.equal(m[2].detail, 'Con al menos 20 % de batería.');
  const e = goalSteps(exp, TEXTS);
  assert.match(e[1].title, /5 paquetes/);
  assert.match(e[2].title, /día 10/);
  assert.match(e[2].detail, /25 %/);
  assert.match(goalSteps({ ...mid, need: 7 }, TEXTS)[1].title, /7 paquetes/);
});

test('ningún paso del objetivo dice que la Tierra está al norte', () => {
  for (const s of goalSteps(beg, TEXTS)) assert.doesNotMatch(`${s.title} ${s.detail}`, /norte/);
});

// ---- J6.3 · Checks ----

test('missionChecks: paquetes y listo para despegar', () => {
  const lv = { ...mid };
  const g = (sent, battery) => ({ level: lv, sent, battery });
  assert.deepEqual(missionChecks(g(3, 50)), { packets: { sent: 3, need: 4, done: false }, ready: false });
  const all = missionChecks(g(4, 20));
  assert.equal(all.packets.done, true); assert.equal(all.ready, true);
  const low = missionChecks(g(4, 19));
  assert.equal(low.packets.done, true); assert.equal(low.ready, false);
});

test('newlyDone: lo que se cumple entre dos estados, una sola vez', () => {
  const g = (sent, battery) => ({ level: mid, sent, battery });
  assert.deepEqual(newlyDone(g(3, 10), g(4, 10)), ['packets']);
  assert.deepEqual(newlyDone(g(3, 30), g(4, 30)), ['packets', 'ready']);
  assert.deepEqual(newlyDone(g(4, 30), g(4, 25)), []);
  assert.deepEqual(newlyDone(g(4, 10), g(4, 30)), ['ready']);
});

// ---- J6.4 · Events ----

test('rng: misma semilla, misma secuencia', () => {
  const a = rng(5), b = rng(5);
  for (let k = 0; k < 5; k++) assert.equal(a(), b());
});

test('newGame: misma semilla, mismo evento; principiante sin eventos', () => {
  const t = world(() => 1);
  assert.deepEqual(newGame(scenario, mid, t, { seed: 9 }).event, newGame(scenario, mid, t, { seed: 9 }).event);
  for (let seed = 1; seed <= 20; seed++) assert.equal(newGame(scenario, beg, t, { seed }).event, null);
});

test('con las semillas 1 a 20 en intermedio, el evento cae en [70, 140) y salen los dos tipos', () => {
  const t = world(() => 1);
  const types = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const ev = newGame(scenario, mid, t, { seed }).event;
    assert.ok(ev.at >= 70 && ev.at < 140, `${seed}: ${ev.at}`);
    types.add(ev.type);
  }
  assert.deepEqual([...types].sort(), ['antenna', 'spike']);
});

test('pico forzado a las 10 h: 12 puntos menos que sin evento y una entrada en el registro', () => {
  const t = world(() => 0);
  const base = pass(newGame(scenario, { ...mid, bat0: 60 }, t, { event: null }), 12);
  const hit = pass(newGame(scenario, { ...mid, bat0: 60 }, t, { event: { at: 10, type: 'spike' } }), 12);
  near(hit.battery, base.battery - 12);
  assert.deepEqual(hit.log, [{ t: 10, kind: 'spike' }]);
  assert.equal(hit.event.done, true);
});

test('un pico con la batería en 8 % acaba la partida sin batería', () => {
  const g = { ...newGame(scenario, mid, world(() => 1), { event: { at: 0.5, type: 'spike' } }), battery: 8 };
  const end = pass(g, 1);
  assert.equal(end.over, 'battery');
  assert.equal(end.battery, 0);
});

test('antena forzada a las 0 h: transmitir a las 5 h dura el doble; a las 30 h, lo normal', () => {
  const t = world(() => 1, () => true);
  let g = newGame(scenario, mid, t, { event: { at: 0, type: 'antenna' } });
  g = pass(g, 5);
  assert.equal(g.antennaUntil, 24.5);
  const slow = transmit(g);
  assert.equal(slow.t - g.t, 2 * mid.txT);
  assert.equal(transmitLabel(mid, TEXTS, g), 'Transmitir · 4 h · −3 %');
  const later = pass(g, 25);
  assert.equal(transmit(later).t - later.t, mid.txT);
  assert.equal(transmitLabel(mid, TEXTS, later), 'Transmitir · 2 h · −3 %');
  // Same extra load in total: txE points over the doubled time.
  const noEvent = transmit(pass(newGame(scenario, mid, t, { event: null }), 5));
  const passed = pass(g, 2 * mid.txT);
  near(passed.battery - slow.battery, mid.txE);
  assert.equal(noEvent.sent, 1);
});

test('misma semilla y mismas acciones dan el mismo estado, registro incluido; no se muta el registro de entrada', () => {
  const t = world((h) => (h % 12 < 6 ? 1 : 0), () => true);
  const run = () => {
    let s = newGame(scenario, mid, t, { seed: 4 });
    s = transmit(s);
    s = wait(s, 100);
    s = transmit(s);
    return strip(s);
  };
  assert.deepEqual(run(), run());
  const g = newGame(scenario, mid, t, { event: { at: 1, type: 'spike' } });
  const snapshot = JSON.stringify(strip(g));
  pass(g, 5); transmit(g);
  assert.equal(JSON.stringify(strip(g)), snapshot);
});

test('la vista previa no delata el evento; conducir lo aplica', () => {
  const t = world(() => 1);
  const g = newGame(scenario, mid, t, { event: { at: 1, type: 'spike' } });
  const quiet = newGame(scenario, mid, t, { event: null });
  const plan = planRoute(g, { x: 3, y: 0 }, 250);
  assert.equal(plan.preview.batteryEnd, planRoute(quiet, { x: 3, y: 0 }, 250).preview.batteryEnd);
  const out = decideAction(g, plan, { type: 'drive' }, mid, TEXTS, 250);
  near(out.drive.battery, plan.preview.batteryEnd - mid.spikeE);
  assert.equal(newEvents(g, out.drive).length, 1);
});

test('el registro: las 4 últimas, la más reciente arriba, con día, hora y texto del nivel', () => {
  const state = { level: mid, log: [
    { t: 1, kind: 'sent', n: 1 }, { t: 3, kind: 'sent', n: 2 }, { t: 5, kind: 'sent', n: 3 },
    { t: 75.5, kind: 'spike' }, { t: 80, kind: 'sent', n: 4 },
  ] };
  const lines = logLines(state, TEXTS);
  assert.equal(lines.length, 4);
  assert.equal(lines[0].text, 'Día 4 · 08:00 · Paquete enviado a la Tierra (4/4)');
  assert.deepEqual(lines[1], { event: true, text: 'Día 4 · 03:00 · Pico de consumo: el calefactor se ha disparado (−12 %).' });
  assert.match(TEXTS.logAntenna(mid.antennaH), /24 h/);
});

// ---- J6.5 · Help by level ----

test('levelHint: en experto ninguna pista; en principiante la de energía', () => {
  const g = (level) => ({ ...newGame(scenario, level, world(() => 0.2)), t: 3, battery: 10 });
  assert.equal(levelHint(g(exp), exp), null);
  assert.equal(levelHint(g(beg), beg), 'shadow-low');
});

test('intermedio: la pista de la Tierra habla de las zonas azules con la capa y del anillo sin ella', () => {
  // Another cell sees the Earth (#382: with none at all the hint is 'earth-few').
  const g = { ...newGame(scenario, mid, world(() => 1, (_h, c) => c === N * N - 1)), t: 3 };
  const key = levelHint(g, mid);
  assert.equal(key, 'earth-elsewhere');
  assert.match(missionHintText(key, { earthLayer: earthLayerOn(mid, true), wind: 'SE' }, TEXTS), /zonas azules/);
  assert.match(missionHintText(key, { earthLayer: earthLayerOn(mid, false), wind: 'SE' }, TEXTS), /anillo/);
});

test('el botón «Tierra visible» solo en intermedio; experto nunca enciende la capa', () => {
  assert.deepEqual(LEVEL_IDS.map((id) => earthToggleShown(levels[id])), [false, true, false]);
  assert.equal(earthLayerOn(exp, true), false);
  assert.equal(SHORTCUTS['earth-layer'], 'L');
  assert.equal(keyAction({ key: 'l' }), 'earth-layer');
  assert.equal(keyAction({ key: 't' }), 'transmit');
});

test('levels.json tiene hints en los tres niveles y los datos del evento en intermedio y experto', () => {
  assert.deepEqual(LEVEL_IDS.map((id) => levels[id].hints), [true, true, false]);
  for (const level of [mid, exp]) assert.deepEqual([level.eventFrom, level.eventSpan, level.spikeE, level.antennaH], [70, 70, 12, 24]);
  assert.equal(beg.event, false);
});
