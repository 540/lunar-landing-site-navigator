import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { buildScenario, levelsJson, makeWorld, encodePng, maskAt, SCENARIO_DIR, OUT_DIR, N, HOURS, MAP_SIZE, SEED, hourlySeries, HOUR_MS, AZB, SERIES_EXTRA_H, HORIZON, HORIZON_LOW, smoothHeight } from '../game-scenario.mjs';

const dir = fileURLToPath(SCENARIO_DIR);
const read = (name) => readFileSync(new URL(name, SCENARIO_DIR));
const scenario = JSON.parse(read('scenario.json'));
const sun = read('sun.bin');
const earth = read('earth.bin');

// PNG files are compared by their decoded content (every chunk but IDAT as is, IDAT inflated), so the test
// does not depend on the zlib version that compressed them: the same pixels can compress to different bytes.
function pngContent(buf) {
  const parts = [buf.subarray(0, 8)];
  const idat = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at), type = buf.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + len));
    else parts.push(buf.subarray(at, at + 12 + len));
    at += 12 + len;
  }
  parts.push(inflateSync(Buffer.concat(idat)));
  return Buffer.concat(parts);
}

test('regenerating gives exactly the committed files', () => {
  const files = buildScenario();
  assert.deepEqual(Object.keys(files).sort(), readdirSync(dir).sort());
  for (const [name, buf] of Object.entries(files)) {
    const same = name.endsWith('.png') ? pngContent(buf).equals(pngContent(read(name))) : buf.equals(read(name));
    assert.ok(same, `${name} differs`);
  }
  assert.equal(levelsJson(), readFileSync(new URL('levels.json', OUT_DIR), 'utf8'));
});

test('scenario.json has the required fields and the binaries match n and hours', () => {
  assert.equal(scenario.id, 'procedural-shackleton');
  assert.equal(typeof scenario.name, 'string');
  assert.equal(scenario.siteId, 'shackleton-rim');
  assert.deepEqual(scenario.grid, { n: 48, cellM: 250 });
  assert.deepEqual(scenario.start, { x: 24, y: 31 });
  assert.deepEqual(scenario.pad, { x: 34, y: 11 });
  assert.equal(scenario.hours, 336);
  assert.equal(scenario.seed, 11);
  assert.equal(typeof scenario.version, 'number');
  assert.ok(Number.isFinite(Date.parse(scenario.startUtc)) && scenario.startUtc.startsWith('2027-'));
  assert.ok(Array.isArray(scenario.sources) && scenario.sources.some((s) => s.includes('Fecha de inicio')));
  const n = scenario.grid.n, h = scenario.hours;
  assert.equal(read('cells.bin').length, n * n * 4);
  assert.equal(sun.length, h * n * n);
  assert.equal(earth.length, Math.ceil(h * n * n / 8));
});

test('map.png is a 512 × 512 greyscale PNG', () => {
  const png = read('map.png');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), MAP_SIZE);
  assert.equal(png.readUInt32BE(20), MAP_SIZE);
  assert.equal(png[24], 8);
  assert.equal(png[25], 0);
  // Single IDAT chunk right after IHDR (8 + 25 bytes).
  const len = png.readUInt32BE(33);
  assert.equal(png.toString('ascii', 37, 41), 'IDAT');
  assert.equal(inflateSync(png.subarray(41, 41 + len)).length, (MAP_SIZE + 1) * MAP_SIZE);
});

test('cells.bin holds the heights of makeWorld', () => {
  const cells = read('cells.bin');
  const H = new Float32Array(cells.buffer, cells.byteOffset, N * N);
  assert.deepEqual([...H], [...makeWorld(SEED).H]);
});

test('sun.bin has lit and shaded cells at hour 0, and the pad is neither always lit nor always shaded (the exit cell is always shaded: open decision)', () => {
  const lit = (h, i) => sun[h * N * N + i] > 127;
  let litCells = 0;
  for (let i = 0; i < N * N; i++) if (lit(0, i)) litCells++;
  assert.ok(litCells > 0 && litCells < N * N, `${litCells} lit cells at hour 0`);
  // The exit cell (24, 31) sits on a crater floor whose mask (>= 4.5°) is always above the Sun (< 1.3°):
  // starting in shade is part of the prototype relief. What matters is that the pad and the map do get Sun.
  const pad = scenario.pad.y * N + scenario.pad.x;
  let padHours = 0, anyLit = 0;
  for (let h = 0; h < HOURS; h++) {
    if (lit(h, pad)) padHours++;
    if (lit(h, 0) || lit(h, N * N - 1) || lit(h, 777)) anyLit++;
  }
  assert.ok(padHours > 0 && padHours < HOURS, `${padHours} lit hours at the pad`);
  assert.ok(anyLit > 0, 'the sampled cells never see the Sun');
});

test('map.png is not clipped: under 1 % of pixels are pure black', () => {
  const png = read('map.png');
  const len = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + len));
  let black = 0;
  for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) if (raw[y * (MAP_SIZE + 1) + 1 + x] === 0) black++;
  assert.ok(black / (MAP_SIZE * MAP_SIZE) < 0.01, `${black} black pixels`);
});

// Files the game needs for its first drawing (J4.1). map.png is only the fallback without WebGL.
export const FIRST_DRAW = ['scenario.json', 'sun.bin', 'cells.bin', 'earth.bin', 'masks.bin', 'series.json', 'map-normals.png', 'map-albedo.png', 'map-ao.png'];

test('the scenario folder weighs at most 5 MB, and the files of the first drawing at most 3 MB', () => {
  const total = readdirSync(dir).reduce((a, f) => a + statSync(dir + f).size, 0);
  assert.ok(total <= 5 * 1024 * 1024, `${total} bytes`);
  const first = FIRST_DRAW.reduce((a, f) => a + statSync(dir + f).size, 0) + statSync(fileURLToPath(new URL('levels.json', OUT_DIR))).size;
  assert.ok(first <= 3 * 1024 * 1024, `${first} bytes`);
});

// Header of an 8-bit PNG: width, height and colour type.
const pngHead = (png) => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20), depth: png[24], type: png[25] });

test('the detail textures are 1024 × 1024 (normals RGB, albedo and occlusion grey) and weigh at most 1.5 MB together (J4.1)', () => {
  assert.deepEqual(pngHead(read('map-normals.png')), { w: 1024, h: 1024, depth: 8, type: 2 });
  assert.deepEqual(pngHead(read('map-albedo.png')), { w: 1024, h: 1024, depth: 8, type: 0 });
  assert.deepEqual(pngHead(read('map-ao.png')), { w: 1024, h: 1024, depth: 8, type: 0 });
  const bytes = ['map-normals.png', 'map-albedo.png', 'map-ao.png'].reduce((a, f) => a + read(f).length, 0);
  assert.ok(bytes <= 1.5 * 1024 * 1024, `${bytes} bytes`);
  for (const k of ['normals', 'albedo', 'ao']) assert.equal(scenario.files[k].width, 1024);
});

test('encodePng with the sub filter decodes back to the same pixels (RGB)', () => {
  const w = 5, h = 3, px = new Uint8Array(w * h * 3).map((_, i) => (i * 37) % 256);
  const png = encodePng(px, w, h, { channels: 3, filter: 1 });
  const len = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + len));
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (w * 3 + 1)], 1);
    for (let x = 0; x < w * 3; x++) {
      const prev = x >= 3 ? px[y * w * 3 + x - 3] : 0;
      assert.equal((raw[y * (w * 3 + 1) + 1 + x] + prev) & 255, px[y * w * 3 + x]);
    }
  }
});

test('makeWorld gives heightAt, the bilinear height of the grid at cell coordinates', () => {
  const W = makeWorld(SEED);
  assert.equal(W.heightAt(3, 4), W.H[4 * N + 3]);
  assert.ok(Math.abs(W.heightAt(3.5, 4) - (W.H[4 * N + 3] + W.H[4 * N + 4]) / 2) < 1e-3);
});

test('levels.json is the prototype LEVELS plus slopeCost (J1.1), hints (J6.5), the event figures (J6.4) and txMinKm (J3.6)', () => {
  const html = readFileSync(new URL('../../docs/juego-rol/index.html', import.meta.url), 'utf8');
  const src = html.match(/const LEVELS=(\{[\s\S]*?\n\s*exp:\{[^\n]*\}\});/)[1];
  const proto = new Function(`return (${src});`)();
  const levels = JSON.parse(readFileSync(new URL('levels.json', OUT_DIR), 'utf8'));
  // No hints in expert (the prototype had lv === "exp" in its code).
  assert.deepEqual([levels.beg.hints, levels.mid.hints, levels.exp.hints], [true, true, false]);
  for (const level of Object.values(levels)) {
    assert.equal(level.slopeCost, 12);
    delete level.slopeCost;
    // Packages from zones at least 1 km apart (J3.6, #293).
    assert.equal(level.txMinKm, 1);
    delete level.txMinKm;
    delete level.hints;
    if (level.event) {
      // The prototype's own figures (newGame: 70 + r() * 70; pass: −12 and 24 h).
      assert.deepEqual([level.eventFrom, level.eventSpan, level.spikeE, level.antennaH], [70, 70, 12, 24]);
      for (const k of ['eventFrom', 'eventSpan', 'spikeE', 'antennaH']) delete level[k];
    }
  }
  assert.deepEqual(levels, proto);
});

// Runs the prototype's own maskAt/sunFrac/earthVis (lines of docs/juego-rol/index.html) with the Sun and Earth
// position injected instead of its toy sunAt/earthAt.
function loadPrototype() {
  const html = readFileSync(new URL('../../docs/juego-rol/index.html', import.meta.url), 'utf8');
  const lines = html.split('\n');
  const from = lines.findIndex((l) => l.startsWith('const N=48,CELL=250'));
  const to = lines.findIndex((l) => l.startsWith('function earthVis'));
  const code = lines.slice(from, to + 1).filter((l) => !l.startsWith('function sunAt') && !l.startsWith('function earthAt')).join('\n');
  const mk = new Function('inject', `${code}\nconst sunAt=()=>inject.sun,earthAt=()=>inject.earth;return{makeWorld,maskAt,sunFrac,earthVis};`);
  const inject = {};
  return { inject, proto: mk(inject) };
}

test('sun.bin and earth.bin agree with the prototype formulas for the same mask and az/el', () => {
  const { inject, proto } = loadPrototype();
  const PW = proto.makeWorld(11);
  const W = makeWorld(SEED);
  assert.deepEqual([...W.M], [...PW.M]);
  const t0 = Date.parse(scenario.startUtc);
  const s = hourlySeries(t0, HOURS);
  let checked = 0;
  for (const h of [0, 1, 100, 200, 335]) for (const i of [0, 777, 1500, scenario.start.y * N + scenario.start.x, scenario.pad.y * N + scenario.pad.x, 2303]) {
    inject.sun = { az: s.sunAz[h], el: s.sunEl[h] };
    inject.earth = { az: s.earthAz[h], el: s.earthEl[h] };
    assert.equal(maskAt(W, i, inject.sun.az), proto.maskAt(PW, i, inject.sun.az));
    assert.equal(sun[h * N * N + i], Math.round(proto.sunFrac(PW, i, 0) * 255), `sun h${h} i${i}`);
    const o = h * N * N + i;
    assert.equal((earth[o >> 3] >> (o & 7)) & 1, proto.earthVis(PW, i, 0) ? 1 : 0, `earth h${h} i${i}`);
    checked++;
  }
  assert.equal(checked, 30);
  assert.equal(new Date(t0 + HOUR_MS).toISOString().slice(0, 4), '2027');
});

test('masks.bin holds the 72-azimuth mask of every cell in hundredths of a degree (J3.4)', () => {
  const masks = read('masks.bin');
  assert.equal(masks.length, N * N * AZB * 2);
  assert.deepEqual(scenario.files.masks, {
    file: 'masks.bin', type: 'int16', endian: 'little', scale: 100, unit: 'deg', length: N * N * AZB, azimuths: AZB,
    layout: 'masks[i * 72 + k], azimuth k * 5° from north towards east',
  });
  const W = makeWorld(SEED);
  for (const i of [0, 777, scenario.start.y * N + scenario.start.x, scenario.pad.y * N + scenario.pad.x, N * N - 1]) {
    for (const k of [0, 17, 36, 71]) {
      const stored = masks.readInt16LE((i * AZB + k) * 2) / 100;
      assert.ok(Math.abs(stored - maskAt(W, i, k * 5)) <= 0.005 + 1e-9, `cell ${i} az ${k * 5}`);
    }
  }
});

test('series.json follows the viewpoint series format, with hours + 720 rows from startUtc (J3.4, J4.1)', () => {
  const doc = JSON.parse(read('series.json'));
  assert.equal(doc.version, 1);
  assert.equal(doc.siteId, scenario.siteId);
  assert.equal(doc.start, scenario.startUtc);
  assert.equal(doc.stepMinutes, 60);
  assert.equal(doc.count, HOURS + SERIES_EXTRA_H);
  assert.equal(typeof doc.source, 'string');
  for (const body of ['sun', 'earth']) for (const k of ['az', 'el']) assert.equal(doc[body][k].length, doc.count, `${body}.${k}`);
  assert.equal(scenario.files.series.file, 'series.json');
  assert.equal(scenario.files.series.count, doc.count);
  const s = hourlySeries(Date.parse(scenario.startUtc), 2);
  assert.deepEqual([doc.sun.az[0], doc.sun.el[0], doc.earth.az[0], doc.earth.el[0]], [s.sunAz[0], s.sunEl[0], s.earthAz[0], s.earthEl[0]]);
});

// The horizon atlas of a scenario file, decoded (grey PNG, filter 0 or 1 per row).
function horizonAtlasOf(file) {
  const png = read(file), w = png.readUInt32BE(16), h = png.readUInt32BE(20), len = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + len)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)];
    for (let x = 0; x < w; x++) {
      const b = raw[y * (w + 1) + 1 + x];
      out[y * w + x] = f === 1 && x > 0 ? (b + out[y * w + x - 1]) & 255 : b;
    }
  }
  return { w, h, bytes: out };
}

for (const [key, file, H] of [['horizon', 'map-horizon.png', HORIZON], ['horizonLow', 'map-horizon-low.png', HORIZON_LOW]]) {
  test(`${file} holds size² × directions horizon values in its atlas (J4.2, J4.3)`, () => {
    const meta = scenario.files[key];
    assert.equal(meta.file, file);
    assert.deepEqual([meta.size, meta.directions, meta.cols, meta.offset, meta.step], [H.size, H.directions, H.cols, H.offset, H.step]);
    const { w, h, bytes } = horizonAtlasOf(file);
    assert.equal(w, H.cols * H.size);
    assert.equal(h, meta.rows * H.size);
    assert.equal(bytes.length / (H.size * H.size), meta.rows * H.cols);
  });

  test(`${file}: the saturated values (below −2° or above 10.75°) never decide the Sun`, () => {
    // The Sun of this scenario stays between these elevations: a horizon out of the range is lit or dark anyway.
    const s = JSON.parse(read('series.json'));
    const els = s.sun.el.slice(0, HOURS);
    const lo = H.offset, hi = H.offset + 255 * H.step, half = 0.265;
    assert.ok(Math.min(...els) - half > lo, `${Math.min(...els)}`);
    assert.ok(Math.max(...els) + half < hi, `${Math.max(...els)}`);
    const { bytes } = horizonAtlasOf(file);
    let sat = 0;
    for (const v of bytes) if (v === 0 || v === 255) sat++;
    // Most saturated values are crater walls higher than 10.75°: always dark. REVISAR if the Sun climbs higher.
    assert.ok(sat / bytes.length < 0.25, `${(100 * sat / bytes.length).toFixed(1)} % saturated`);
  });
}

// ---- #309: no stripes in the detail relief ----

test('smoothHeight: pasa por las alturas de la rejilla y su pendiente no salta en los bordes de celda (la bilineal sí)', () => {
  const W = makeWorld(SEED);
  for (const [x, y] of [[3, 4], [20, 30], [34, 11]]) assert.ok(Math.abs(smoothHeight(W.H, x, y) - W.H[y * N + x]) < 1e-3);
  const slope = (f, x, y, e) => (f(x + e, y) - f(x - e, y)) / (2 * e);
  let jumpSmooth = 0, jumpBilinear = 0;
  for (let x = 2; x < N - 2; x++) for (const y of [7.3, 18.6, 31.2, 40.5]) {
    const left = (f) => slope(f, x - 0.01, y, 0.005), right = (f) => slope(f, x + 0.01, y, 0.005);
    const sm = (a, b) => smoothHeight(W.H, a, b);
    jumpSmooth += Math.abs(left(sm) - right(sm));
    jumpBilinear += Math.abs(left(W.heightAt) - right(W.heightAt));
  }
  assert.ok(jumpSmooth < jumpBilinear / 20, `salto suave ${jumpSmooth.toFixed(1)} frente a bilineal ${jumpBilinear.toFixed(1)}`);
});

test('map-normals.png no tiene bandas: entre columnas, los bordes de celda no saltan más que el resto', () => {
  const png = read('map-normals.png');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  let o = 8; const idat = [];
  while (o < png.length) { const len = png.readUInt32BE(o); if (png.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), st = w * 3, px = new Uint8Array(st * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (st + 1)];
    for (let x = 0; x < st; x++) { let v = raw[y * (st + 1) + 1 + x]; if (filter === 1 && x >= 3) v += px[y * st + x - 3]; px[y * st + x] = v & 255; }
  }
  // Mean east-west component of the normal per column, and how much it jumps between neighbouring columns.
  const col = new Float64Array(w);
  for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y < h; y++) s += px[y * st + x * 3]; col[x] = s / h; }
  const cellOf = (x) => Math.floor(Math.min(N - 1, Math.max(0, ((x + 0.5) * N) / w - 0.5)));
  let edge = 0, edges = 0, inside = 0, insides = 0;
  for (let x = 1; x < w; x++) {
    const j = Math.abs(col[x] - col[x - 1]);
    if (cellOf(x) !== cellOf(x - 1)) { edge += j; edges++; } else { inside += j; insides++; }
  }
  // With the bilinear base it was 6.8 (stripes every 1/48 of the map); with smoothHeight, 1.4.
  assert.ok(edge / edges < 2 * (inside / insides), `bordes ${(edge / edges).toFixed(3)} frente a dentro ${(inside / insides).toFixed(3)}`);
});

// #313: a scenario may override level fields; the solver and the game play the same merge.
test('scenarioLevels: mezcla los campos del escenario sobre LEVELS y falla con un nivel o un campo que no existe', async () => {
  const { scenarioLevels, LEVELS } = await import('../game-scenario.mjs');
  assert.deepEqual(scenarioLevels({ id: 'x' }), LEVELS);
  const lv = scenarioLevels({ id: 'x', levels: { exp: { deadline: 144 } } });
  assert.equal(lv.exp.deadline, 144);
  assert.equal(lv.exp.bat0, LEVELS.exp.bat0);
  assert.deepEqual(lv.beg, LEVELS.beg);
  assert.equal(LEVELS.exp.deadline, 240, 'no muta LEVELS');
  assert.throws(() => scenarioLevels({ id: 'x', levels: { hard: { deadline: 1 } } }), /no existe/);
  assert.throws(() => scenarioLevels({ id: 'x', levels: { beg: { deadlin: 1 } } }), /no es un campo/);
});

test('Mons Mouton guarda en scenario.json los campos de nivel que cambia y su solver.json cumple los márgenes de candidates', async () => {
  const { scenarioConfig, scenarioDir } = await import('../game-scenario.mjs');
  const cfg = scenarioConfig('lola-mouton');
  const sc = JSON.parse(readFileSync(new URL('scenario.json', scenarioDir('lola-mouton'))));
  assert.deepEqual(sc.levels, cfg.levels);
  const solved = JSON.parse(readFileSync(new URL('solver.json', scenarioDir('lola-mouton'))));
  for (const id of ['beg', 'mid', 'exp']) {
    const r = solved[id];
    assert.ok(r.winnable && !r.trivial, id);
    const [blo, bhi] = cfg.candidates.batteryMargin[id];
    const [tlo, thi] = cfg.candidates.timeMargin[id];
    assert.ok(r.batteryMargin >= blo && r.batteryMargin <= bhi, `${id} batería ${r.batteryMargin}`);
    assert.ok(r.timeMarginH >= tlo && r.timeMarginH <= thi, `${id} tiempo ${r.timeMarginH}`);
  }
});
