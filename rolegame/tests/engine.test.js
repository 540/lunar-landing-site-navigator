import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTables, newGame, pass, wait, move, transmit, check, sentTooClose, nearSent, slope, stepCost, pathTo } from '../src/engine/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const levels = JSON.parse(readFileSync(join(here, '../data/levels.json'), 'utf8'));
const mid = levels.mid;

const N = 5;
const HOURS = 400;
const scenario = { grid: { n: N, cellM: 250 }, hours: HOURS, start: { x: 0, y: 0 }, pad: { x: 4, y: 0 } };

// Synthetic tables: `fill(hour, cell)` returns 0..255.
function tables(fill, sc = scenario) {
  const buf = new Uint8Array(HOURS * N * N);
  for (let h = 0; h < HOURS; h++) for (let c = 0; c < N * N; c++) buf[h * N * N + c] = fill(h, c);
  return createTables(buf.buffer, sc);
}
// Drives to a cell by the cheapest path.
const go = (g, target) => move(g, pathTo(g, target));
const sunny = tables(() => 255);
const dark = tables(() => 0);
const alternating = tables((h) => (Math.floor(h / 6) % 2 === 0 ? 255 : 0));

test('al Sol la batería sube y en sombra baja, con las cifras del nivel', () => {
  const lowBat = { ...mid, bat0: 50 };
  const up = pass(newGame(scenario, lowBat, sunny), 2);
  assert.equal(up.battery, 50 + (mid.charge - mid.loadSun) * 2);
  const down = pass(newGame(scenario, lowBat, dark), 2);
  assert.equal(down.battery, 50 - mid.loadDark * 2);
});

test('conducir consume más que estar parado', () => {
  const g = newGame(scenario, mid, sunny);
  const parked = pass(g, 1);
  const driven = pass(g, 1, mid.moveE);
  assert.ok(driven.battery < parked.battery);
  const moved = move(g, [{ x: 1, y: 0 }]);
  assert.equal(moved.t, 1);
  assert.ok(moved.battery < parked.battery);
});

test('move: horizontal 1 h, diagonal √2 h, registra la ruta', () => {
  const g = newGame(scenario, mid, sunny);
  assert.equal(move(g, pathTo(g, { x: 2, y: 0 })).t, 2);
  const d = move(g, [{ x: 1, y: 1 }]);
  assert.ok(Math.abs(d.t - Math.SQRT2) < 1e-9);
  assert.deepEqual(move(g, [{ x: 1, y: 1 }, { x: 2, y: 1 }]).route, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }]);
});

// Level without packages to send: reaching the pad is enough (the J3.1 rule is tested below).
const noPackets = { ...mid, need: 0 };

test('gana al llegar a la plataforma con batería suficiente (nivel sin paquetes)', () => {
  const end = move(newGame(scenario, noPackets, sunny), pathTo(newGame(scenario, noPackets, sunny), { x: 4, y: 0 }));
  assert.equal(end.over, 'win');
  assert.deepEqual([end.x, end.y], [4, 0]);
});

test('no gana en la plataforma con batería por debajo del mínimo', () => {
  const g = { ...newGame(scenario, mid, sunny), x: 4, y: 0, battery: mid.minBat - 1 };
  assert.equal(check(g).over, null);
});

test('pierde por batería a 0', () => {
  const end = pass(newGame(scenario, mid, dark), 100);
  assert.equal(end.over, 'battery');
  assert.equal(end.battery, 0);
});

test('pierde por día límite', () => {
  const end = pass(newGame(scenario, mid, sunny), mid.deadline + 10);
  assert.equal(end.over, 'time');
  assert.equal(end.t, mid.deadline);
});

test('interpola la fracción de Sol entre horas', () => {
  const ramp = tables((h) => (h === 0 ? 0 : 255));
  assert.equal(ramp.sunFrac(0, 0.5), 0.5);
  assert.equal(ramp.sunFrac(0, 1000), 1);
});

test('determinismo: misma secuencia, mismo estado final', () => {
  const run = () => {
    let s = newGame(scenario, mid, alternating);
    s = pass(s, 3);
    s = go(s, { x: 2, y: 2 });
    s = pass(s, 5, 0.3);
    s = go(s, { x: 4, y: 0 });
    const { tables: _t, ...rest } = s;
    return rest;
  };
  assert.deepEqual(run(), run());
});

test('las acciones no mutan el estado de entrada', () => {
  const g = newGame(scenario, mid, alternating);
  const snapshot = JSON.stringify({ ...g, tables: null });
  pass(g, 4, 1);
  go(g, { x: 3, y: 3 });
  check(g);
  assert.equal(JSON.stringify({ ...g, tables: null }), snapshot);
});

test('el motor no usa document, window, fetch, Math.random ni Date.now', () => {
  const dir = join(here, '../src/engine');
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(src, /\b(document|window|fetch)\b|Math\.random|Date\.now/, f);
  }
});

test('createTables lee la forma documentada y falla si el tamaño no cuadra', () => {
  const t = createTables(new Uint8Array(HOURS * N * N).buffer, scenario);
  assert.equal(t.n, N);
  assert.equal(t.hours, HOURS);
  assert.throws(() => createTables(new Uint8Array(HOURS * N * N - 1).buffer, scenario), /expected/);
  assert.throws(() => createTables(new ArrayBuffer(0), { grid: { cellM: 250 } }), /lacks/);
  const sunBuf = new Uint8Array(HOURS * N * N).buffer;
  assert.throws(() => createTables(sunBuf, { grid: { n: N, hours: HOURS } }), /cellM/);
  assert.throws(() => createTables(sunBuf, { grid: { n: N, hours: HOURS, cellM: 0 } }), /cellM/);
});

test('move: sin batería en el primer medio paso, se queda en su celda', () => {
  const g = newGame(scenario, { ...mid, bat0: 1 }, dark);
  const end = go(g, { x: 1, y: 0 });
  assert.equal(end.over, 'battery');
  assert.deepEqual([end.x, end.y], [0, 0]);
  assert.equal(end.route.length, 1);
});

test('move: la batería se agota a mitad de trayecto y se para en la celda alcanzada', () => {
  const end = go(newGame(scenario, { ...mid, bat0: 6 }, dark), { x: 3, y: 0 });
  assert.equal(end.over, 'battery');
  assert.deepEqual([end.x, end.y], [1, 0]);
  assert.deepEqual(end.route, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
});

test('move: el día límite llega a mitad de trayecto y se para en la celda alcanzada', () => {
  const g = { ...newGame(scenario, mid, sunny), t: mid.deadline - 1.5 };
  const end = go(g, { x: 0, y: 3 });
  assert.equal(end.over, 'time');
  assert.deepEqual([end.x, end.y], [0, 1]);
});

test('pathTo: un objetivo fuera de la rejilla lanza RangeError', () => {
  const g = newGame(scenario, mid, sunny);
  assert.throws(() => go(g, { x: N, y: 0 }), RangeError);
  assert.throws(() => go(g, { x: 0, y: -1 }), RangeError);
});

test('pathTo: un objetivo no entero o NaN lanza RangeError', () => {
  const g = newGame(scenario, mid, sunny);
  assert.throws(() => go(g, { x: 1.5, y: 0 }), RangeError);
  assert.throws(() => go(g, { x: 0, y: 0.5 }), RangeError);
  assert.throws(() => go(g, { x: NaN, y: 0 }), RangeError);
  assert.throws(() => go(g, { x: 0, y: undefined }), RangeError);
});

test('move: valida su propia ruta (fuera de la rejilla, no entera, saltos entre no vecinas)', () => {
  const g = newGame(scenario, mid, sunny);
  assert.throws(() => move(g, [{ x: N, y: 0 }]), RangeError);
  assert.throws(() => move(g, [{ x: 1.5, y: 0 }]), RangeError);
  assert.throws(() => move(g, [{ x: NaN, y: 0 }]), RangeError);
  assert.throws(() => move(g, [{ x: 3, y: 3 }]), /neighbouring/);
  assert.throws(() => move(g, [{ x: 1, y: 0 }, { x: 3, y: 0 }]), /neighbouring/);
});

test('move: cruzar la plataforma de camino a otro destino termina con win en ella', () => {
  const sc = { ...scenario, pad: { x: 2, y: 0 } };
  const end = go(newGame(sc, noPackets, tables(() => 255, sc)), { x: 4, y: 0 });
  assert.equal(end.over, 'win');
  assert.deepEqual([end.x, end.y], [2, 0]);
});

test('move: en una partida ya terminada devuelve el mismo estado', () => {
  const over = pass(newGame(scenario, mid, dark), 100);
  assert.deepEqual(go(over, { x: 1, y: 0 }), over);
});

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('panelMin: por debajo no carga (pero aplica loadDark); por encima carga', () => {
  const exp = { ...levels.exp, bat0: 50 };
  const low = pass(newGame(scenario, exp, tables(() => 102)), 2); // f = 0.4 < 0.5
  near(low.battery, 50 - exp.loadDark * 2);
  const high = pass(newGame(scenario, exp, tables(() => 153)), 2); // f = 0.6 >= 0.5
  near(high.battery, 50 + (exp.charge * 0.6 - exp.loadSun) * 2);
});

test('loadSun/loadDark cambian en f = 0.5 con Sol parcial', () => {
  const lowBat = { ...mid, bat0: 50 };
  const dim = pass(newGame(scenario, lowBat, tables(() => 102)), 2); // f = 0.4
  near(dim.battery, 50 + (mid.charge * 0.4 - mid.loadDark) * 2);
  const bright = pass(newGame(scenario, lowBat, tables(() => 153)), 2); // f = 0.6
  near(bright.battery, 50 + (mid.charge * 0.6 - mid.loadSun) * 2);
});

test('la batería no pasa del 100 %', () => {
  const g = pass(newGame(scenario, { ...mid, bat0: 95 }, sunny), 50);
  assert.equal(g.battery, 100);
});

// Terrain for routes: 7x7 grid, 250 m cells, heights from `h(x, y)`.
const M = 7;
const routeScenario = { grid: { n: M, cellM: 250 }, hours: HOURS, start: { x: 0, y: 3 }, pad: { x: 6, y: 3 } };
function terrain(h, sc = routeScenario) {
  const sun = new Uint8Array(HOURS * M * M).fill(255);
  const cells = new Float32Array(M * M);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) cells[y * M + x] = h(x, y);
  return createTables(sun.buffer, sc, cells.buffer);
}
const level = { ...mid, maxSlope: 20, slopeCost: 12 };
// 250 m rise over a 250 m cell = 45°; 50 m = 11.3°.
const wall = terrain((x, y) => (x === 3 && y >= 1 && y <= 5 ? 250 : 0));

test('slope y stepCost: grados, coste y null sobre el máximo', () => {
  assert.ok(Math.abs(slope(wall, 3 * M + 2, 3 * M + 3) - 45) < 1e-9);
  assert.equal(slope(wall, 0, 1), 0);
  assert.equal(stepCost(wall, level, 3 * M + 2, 3 * M + 3), null);
  assert.equal(stepCost(wall, level, 0, 1), 1);
  assert.ok(Math.abs(stepCost(wall, level, 0, M + 1) - Math.SQRT2) < 1e-9);
  const gentle = terrain((x) => (x === 1 ? 50 : 0));
  const deg = (Math.atan(50 / 250) * 180) / Math.PI;
  assert.ok(Math.abs(stepCost(gentle, level, 0, 1) - (1 + deg / 12)) < 1e-9);
});

test('pathTo rodea una pared infranqueable por el camino más barato', () => {
  const g = newGame(routeScenario, level, wall);
  const path = pathTo(g, { x: 6, y: 3 });
  assert.deepEqual(path[0], { x: 0, y: 3 });
  assert.deepEqual(path.at(-1), { x: 6, y: 3 });
  for (let i = 1; i < path.length; i++) {
    assert.notEqual(stepCost(wall, level, path[i - 1].y * M + path[i - 1].x, path[i].y * M + path[i].x), null);
  }
  const cost = path.slice(1).reduce((a, p, i) => a + stepCost(wall, level, path[i].y * M + path[i].x, p.y * M + p.x), 0);
  assert.ok(Math.abs(cost - 6 * Math.SQRT2) < 1e-9, `coste ${cost}`);
  assert.ok(path.some((p) => p.x === 3 && (p.y === 0 || p.y === 6)));
});

test('pathTo elige la ruta recta cuando no hay obstáculos', () => {
  const g = newGame(routeScenario, level, terrain(() => 0));
  assert.equal(pathTo(g, { x: 6, y: 3 }).length, 7);
});

test('pathTo devuelve null si el destino está rodeado de pendientes imposibles', () => {
  const pit = terrain((x, y) => (x === 6 && y === 3 ? 0 : Math.abs(x - 6) <= 1 && Math.abs(y - 3) <= 1 ? 250 : 0));
  assert.equal(pathTo(newGame(routeScenario, level, pit), { x: 6, y: 3 }), null);
});

test('mover por una cuesta suave cuesta más tiempo que en llano', () => {
  const flat = newGame(routeScenario, level, terrain(() => 0));
  const hill = newGame(routeScenario, level, terrain((x) => x * 50));
  const target = { x: 2, y: 3 };
  assert.ok(move(hill, pathTo(hill, target)).t > move(flat, pathTo(flat, target)).t);
});

test('move rechaza un paso que supera la pendiente máxima', () => {
  const g = newGame(routeScenario, level, wall);
  assert.throws(() => move({ ...g, x: 2 }, [{ x: 3, y: 3 }]), RangeError);
});

test('createTables comprueba el tamaño de cells.bin y expone la altura', () => {
  assert.throws(() => createTables(new Uint8Array(HOURS * M * M).buffer, routeScenario, new Float32Array(3).buffer));
  assert.equal(wall.height(3 * M + 3), 250);
  assert.equal(wall.cellM, 250);
});

test('mismas tablas y mismas acciones dan el mismo estado', () => {
  const run = () => {
    let g = newGame(routeScenario, level, wall);
    g = move(g, pathTo(g, { x: 6, y: 3 }));
    return g;
  };
  const a = run();
  const b = run();
  assert.deepEqual({ ...a, tables: 0 }, { ...b, tables: 0 });
});

test('pathTo en el escenario real, de esquina a esquina, tarda menos de 10 ms', async () => {
  const { readFileSync } = await import('node:fs');
  const dir = join(here, '../data/procedural-shackleton');
  const real = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
  const buf = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  const t = createTables(buf('sun.bin'), real, buf('cells.bin'));
  const g = { ...newGame(real, levels.beg, t), x: 0, y: 0 };
  const target = { x: t.n - 1, y: t.n - 1 };
  pathTo(g, target); // warm-up
  // Median of several runs: one GC pause or a loaded runner must not fail the release gate.
  const times = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    pathTo(g, target);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[4];
  assert.ok(median < 10, `median ${median} ms`);
});

// ---- Wait (J2.1) ----

const strip = ({ tables: _t, ...rest }) => rest;
const sunAt5 = tables((h) => (h >= 5 ? 255 : 0));

test('wait: 2 h y 6 h dan lo mismo que pass sin mover el rover ni tocar la ruta', () => {
  const g = go(newGame(scenario, mid, alternating), { x: 2, y: 1 });
  for (const h of [2, 6]) {
    const w = wait(g, h);
    const p = pass(g, h);
    assert.equal(w.t, p.t);
    assert.equal(w.battery, p.battery);
    assert.equal(w.over, p.over);
    assert.deepEqual([w.x, w.y], [g.x, g.y]);
    assert.deepEqual(w.route, g.route);
  }
});

test('wait untilSun: para al final del primer paso con Sol en la celda (t = 5)', () => {
  const g = newGame(scenario, mid, sunAt5);
  const end = wait(g, 24, { untilSun: true });
  assert.equal(end.t, 5);
  assert.ok(sunAt5.sunFrac(0, end.t) > 0.5);
  assert.equal(end.battery, pass(g, 5).battery);
});

test('wait untilSun: si la celda nunca entra al Sol, para en las horas pedidas', () => {
  const end = wait(newGame(scenario, mid, dark), 24, { untilSun: true });
  assert.equal(end.t, 24);
  assert.equal(end.over, null);
});

test('wait: la batería a 0 o el día límite paran la espera ahí', () => {
  const flat = wait(newGame(scenario, { ...mid, bat0: 5 }, dark), 24, { untilSun: true });
  assert.equal(flat.over, 'battery');
  assert.equal(flat.battery, 0);
  assert.equal(flat.t, 2.5);
  const late = wait({ ...newGame(scenario, mid, sunny), t: mid.deadline - 1 }, 6);
  assert.equal(late.over, 'time');
  assert.equal(late.t, mid.deadline);
});

test('wait: en una partida ya terminada devuelve el mismo estado', () => {
  const over = pass(newGame(scenario, mid, dark), 100);
  assert.equal(wait(over, 6), over);
  assert.equal(wait(over, 24, { untilSun: true }), over);
});

test('wait no muta el estado de entrada y es determinista', () => {
  const g = go(newGame(scenario, mid, alternating), { x: 1, y: 2 });
  const snapshot = JSON.stringify(strip(g));
  const a = wait(g, 6);
  const b = wait(g, 6);
  wait(g, 24, { untilSun: true });
  assert.equal(JSON.stringify(strip(g)), snapshot);
  assert.deepEqual(strip(a), strip(b));
  assert.deepEqual(strip(wait(g, 24, { untilSun: true })), strip(wait(g, 24, { untilSun: true })));
});

// ---- Transmit (J3.1) and wait until the Earth (J3.3) ----

// earth.bin with the bit of (hour, cell) set when `visible(hour, cell)`.
function earthBits(visible, n = N, hours = HOURS) {
  const bits = new Uint8Array(Math.ceil((hours * n * n) / 8));
  for (let h = 0; h < hours; h++) for (let c = 0; c < n * n; c++) {
    const o = h * n * n + c;
    if (visible(h, c)) bits[o >> 3] |= 1 << (o & 7);
  }
  return bits.buffer;
}
function withEarth(sunFill, visible) {
  const sun = new Uint8Array(HOURS * N * N);
  for (let h = 0; h < HOURS; h++) for (let c = 0; c < N * N; c++) sun[h * N * N + c] = sunFill(h, c);
  return createTables(sun.buffer, scenario, undefined, earthBits(visible));
}
const beg = levels.beg;

test('seesEarth: cada hora vale lo que dice su fila, sin interpolar; sin earth.bin nunca', () => {
  const t = withEarth(() => 0, (h) => h === 5);
  assert.equal(t.seesEarth(0, 5), true);
  assert.equal(t.seesEarth(0, 5.9), true);
  assert.equal(t.seesEarth(0, 4.99), false);
  assert.equal(t.seesEarth(0, 6), false);
  assert.equal(dark.seesEarth(0, 5), false);
  const lastRow = withEarth(() => 0, (h) => h === HOURS - 1);
  assert.equal(lastRow.seesEarth(0, HOURS + 50), true, 'acotada a la última fila');
  const oneCell = withEarth(() => 0, (_h, c) => c === 7);
  assert.equal(oneCell.seesEarth(7, 0), true);
  assert.equal(oneCell.seesEarth(6, 0), false);
});

test('createTables falla si earth.bin no mide ceil(hours × n × n / 8) bytes', () => {
  const sun = new Uint8Array(HOURS * N * N).buffer;
  const size = Math.ceil((HOURS * N * N) / 8);
  assert.doesNotThrow(() => createTables(sun, scenario, undefined, new ArrayBuffer(size)));
  assert.throws(() => createTables(sun, scenario, undefined, new ArrayBuffer(size - 1)), /earth\.bin.*expected/);
  assert.throws(() => createTables(sun, scenario, undefined, new ArrayBuffer(size + 1)), /earth\.bin.*expected/);
});

const sunnyEarth = withEarth(() => 255, () => true);
const darkEarth = withEarth(() => 0, () => true);

test('transmit (principiante, Tierra visible): 1 h, 2 puntos extra y un paquete más', () => {
  const lit = transmit(newGame(scenario, beg, sunnyEarth));
  assert.equal(lit.t, 1);
  near(lit.battery, 85 + 5 - 0.7 - 2);
  assert.equal(lit.sent, 1);
  const shade = transmit(newGame(scenario, beg, darkEarth));
  near(shade.battery, 85 - 1.2 - 2);
  assert.equal(shade.sent, 1);
});

test('transmit (intermedio, en sombra): 2 h y 59 % (66 − 2 × (2 + 1,5))', () => {
  const end = transmit(newGame(scenario, mid, darkEarth));
  assert.equal(end.t, 2);
  near(end.battery, 59);
  assert.equal(end.sent, 1);
});

test('transmit devuelve el mismo objeto sin Tierra, con la partida acabada o con todo enviado', () => {
  const noEarth = newGame(scenario, beg, withEarth(() => 255, () => false));
  assert.equal(transmit(noEarth), noEarth);
  const over = { ...newGame(scenario, beg, sunnyEarth), over: 'battery' };
  assert.equal(transmit(over), over);
  const done = { ...newGame(scenario, beg, sunnyEarth), sent: beg.need };
  assert.equal(transmit(done), done);
});

test('transmit: si la batería llega a 0 transmitiendo, acaba en battery y no cuenta el paquete', () => {
  const end = transmit(newGame(scenario, { ...mid, bat0: 3 }, darkEarth));
  assert.equal(end.over, 'battery');
  assert.equal(end.t, 1);
  assert.equal(end.sent, 0);
  assert.equal(end.battery, 0);
});

test('victoria: en la plataforma hacen falta todos los paquetes', () => {
  const atPad = { ...newGame(scenario, beg, sunnyEarth), x: 4, y: 0 };
  assert.equal(check({ ...atPad, sent: beg.need - 1 }).over, null);
  assert.equal(check({ ...atPad, sent: beg.need }).over, 'win');
  // Crossing the pad without the packages does not end the game.
  const sc = { ...scenario, pad: { x: 2, y: 0 } };
  const crossed = go(newGame(sc, beg, tables(() => 255, sc)), { x: 4, y: 0 });
  assert.equal(crossed.over, null);
  assert.deepEqual([crossed.x, crossed.y], [4, 0]);
  // Transmitting the last package at the pad wins (here without the 1 km rule of J3.6, tested below).
  let s = { ...newGame(scenario, { ...beg, txMinKm: 0 }, sunnyEarth), x: 4, y: 0 };
  for (let k = 0; k < beg.need; k++) s = transmit(s);
  assert.equal(s.sent, beg.need);
  assert.equal(s.over, 'win');
});

test('transmit no muta el estado de entrada y es determinista', () => {
  const g = newGame(scenario, mid, withEarth((h) => (h % 4 < 2 ? 255 : 0), () => true));
  const snapshot = JSON.stringify(strip(g));
  const a = transmit(g);
  const b = transmit(g);
  assert.equal(JSON.stringify(strip(g)), snapshot);
  assert.deepEqual(strip(a), strip(b));
});

const earthAt5 = withEarth(() => 0, (h) => h >= 5);

test('wait untilEarth: para al final del primer paso con la Tierra a la vista (t = 5)', () => {
  const g = newGame(scenario, mid, earthAt5);
  const end = wait(g, 24, { untilEarth: true });
  assert.equal(end.t, 5);
  assert.equal(end.battery, pass(g, 5).battery);
});

test('wait untilEarth: si la celda no ve la Tierra en 24 h, acaba en t = 24 sin terminar la partida', () => {
  const end = wait(newGame(scenario, beg, withEarth(() => 0, () => false)), 24, { untilEarth: true });
  assert.equal(end.t, 24);
  assert.equal(end.over, null);
});

test('wait untilEarth: la batería a 0 o el día límite paran la espera', () => {
  const never = withEarth(() => 0, () => false);
  const flat = wait(newGame(scenario, { ...mid, bat0: 5 }, never), 24, { untilEarth: true });
  assert.equal(flat.over, 'battery');
  assert.equal(flat.t, 2.5);
  const late = wait({ ...newGame(scenario, mid, never), t: mid.deadline - 1 }, 24, { untilEarth: true });
  assert.equal(late.over, 'time');
  assert.equal(late.t, mid.deadline);
});

test('wait untilEarth: partida acabada → mismo estado; no muta y es determinista', () => {
  const over = { ...newGame(scenario, mid, earthAt5), over: 'time' };
  assert.equal(wait(over, 24, { untilEarth: true }), over);
  const g = newGame(scenario, mid, earthAt5);
  const snapshot = JSON.stringify(strip(g));
  const a = wait(g, 24, { untilEarth: true });
  assert.equal(JSON.stringify(strip(g)), snapshot);
  assert.deepEqual(strip(a), strip(wait(g, 24, { untilEarth: true })));
});

// ---- Packages from different zones (J3.6, #293) ----

test('J3.6: tras enviar, desde la misma celda o a menos de 1 km no se envía; a 1 km o más, sí', () => {
  assert.equal(beg.txMinKm, 1);
  const at = (st, x, y) => ({ ...st, x, y });
  const first = transmit(at(newGame(scenario, beg, sunnyEarth), 0, 0));
  assert.equal(first.sent, 1);
  assert.deepEqual(first.sentFrom, [{ x: 0, y: 0 }]);
  // Same cell, and 3 cells (0.75 km) away: the same state comes back.
  assert.equal(transmit(first), first);
  assert.ok(nearSent(first));
  const near = at(first, 3, 0);
  assert.equal(transmit(near), near);
  assert.ok(sentTooClose(first, { x: 3, y: 0 }));
  // 4 cells of 250 m = 1 km: it sends.
  const far = transmit(at(first, 4, 0));
  assert.equal(far.sent, 2);
  assert.deepEqual(far.sentFrom, [{ x: 0, y: 0 }, { x: 4, y: 0 }]);
  // The third one has to be 1 km from both: (2, 4) is 1.12 km from each.
  const between = at(far, 2, 0);
  assert.equal(transmit(between), between);
  assert.equal(transmit(at(far, 2, 4)).sent, 3);
});

test('J3.6: sin txMinKm (o con 0) no hay límite de distancia', () => {
  let s = newGame(scenario, { ...beg, txMinKm: 0 }, sunnyEarth);
  for (let k = 0; k < beg.need; k++) s = transmit(s);
  assert.equal(s.sent, beg.need);
  const legacy = { ...beg };
  delete legacy.txMinKm;
  assert.equal(transmit(transmit(newGame(scenario, legacy, sunnyEarth))).sent, 2);
});

test('J3.6: transmit no muta sentFrom de la entrada y un envío fallido por batería no cuenta la zona', () => {
  const g = transmit(newGame(scenario, beg, sunnyEarth));
  const before = JSON.stringify(g.sentFrom);
  transmit({ ...g, x: 4, y: 4 });
  assert.equal(JSON.stringify(g.sentFrom), before);
  const dead = transmit(newGame(scenario, { ...mid, bat0: 3 }, darkEarth));
  assert.equal(dead.over, 'battery');
  assert.deepEqual(dead.sentFrom, []);
});
