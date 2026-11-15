// The validation matrix (validation/matrix.ts, `npm run validate`) without DEM: the rows that need terrain are reported
// as not run, the ephemeris, catalogue and mission rows are computed and within their limits, the status logic, and the
// per-point export and the HTML page of `npm run validate:view`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allUnits, bestNear, FOOTPRINT, NEAR, NEEDS, nearGrid, pixelFootprint, runUnit, unitKey } from '../validation/measure.ts';
import { llToXY } from '../src/terrain/dem.ts';
import { evaluate, glaserNearRow, renderMarkdown, ROWS } from '../validation/matrix.ts';
import { readPoints, toViewData, writeHtml, writePoints } from '../validation/view.ts';
import type { RowSpec } from '../validation/matrix.ts';
import type { ViewData } from '../validation/view.ts';
import type { GlaserNearResult, NearMetrics, Unit } from '../validation/measure.ts';

test('sin DEM: las filas de relieve no se ejecutan y el resto está dentro de sus límites', () => {
  const units: Unit[] = [{ kind: 'horizons' }, { kind: 'apollo' }, { kind: 'missions' }];
  const results = new Map(units.map((u) => [unitKey(u), runUnit(u)]));
  const terrainSections = /relieve|Horizonte|Sombra|Pendiente/;
  const rows = ROWS.filter((s) => !s.section.startsWith('Sin verdad')).map((s) => evaluate(s, results));
  for (const r of rows) {
    if (terrainSections.test(r.spec.section)) assert.equal(r.status, '⏭️', r.spec.what);
    else assert.ok(r.status === '✅' || r.status === 'ℹ️', `${r.spec.what}: ${r.status} ${r.note}`);
  }
  const md = renderMarkdown(rows, { demVersion: null });
  assert.match(md, /no ejecutado: falta el DEM/);
  assert.match(md, /Generado con `npm run validate -- --write`/);
});

test('estado: ✅ dentro, ⚠️ conocido dentro de su tope, ❌ fuera, ℹ️ informativa', () => {
  const spec = (d: number[], extra: Partial<RowSpec> = {}): RowSpec => ({
    section: 's', what: 'w', source: 'x', unit: 'pp', digits: 2, tolText: '±2 pp', limits: { rms: 1, max: 1.5, within: 50 },
    measure: () => ({ kind: 'numeric', d, ref: d.map(() => 10), tol: 2 }), ...extra,
  });
  const none = new Map<string, unknown>();
  const ok = evaluate(spec([0.5, -0.5]), none);
  assert.equal(ok.status, '✅');
  assert.equal(ok.bias, 0);
  assert.equal(ok.rms, 0.5);
  assert.equal(ok.pctRef, 5);
  assert.equal(ok.within, 100);
  assert.equal(evaluate(spec([0.5, -0.5], { known: 85 }), none).status, '⚠️');
  const worse = evaluate(spec([0.5, -2], { known: 85 }), none);
  assert.equal(worse.status, '❌');
  assert.match(worse.note, /máx\. 2,00 > 1,50/);
  assert.equal(evaluate(spec([9], { informative: true }), none).status, 'ℹ️');
  assert.equal(evaluate(spec([0], { measure: () => 'falta algo' }), none).status, '⏭️');
  assert.equal(evaluate(spec([], { measure: () => ({ kind: 'check', ok: [true, false] }), limits: { within: 100 } }), none).status, '❌');
});

test('vista (--view): cada fila lleva sus puntos y la página es autocontenida', () => {
  const units: Unit[] = [{ kind: 'horizons' }, { kind: 'apollo' }, { kind: 'missions' }];
  const results = new Map(units.map((u) => [unitKey(u), runUnit(u)]));
  const rows = ROWS.filter((s) => !s.section.startsWith('Sin verdad')).map((s) => evaluate(s, results));
  const data = toViewData(rows, { generatedAt: '2026-11-14T00:00:00Z', demVersion: null, commit: 'abc1234', seconds: 1, workers: 1 });
  for (const [i, r] of rows.entries()) {
    const v = data.rows[i];
    assert.equal(v.status, r.status);
    if (r.status === '⏭️') { assert.equal(v.points.length, 0); continue; }
    assert.equal(v.points.length, r.n, r.spec.what);
    assert.equal(v.points.filter((p) => p[7]).length, Math.round(((r.within ?? 0) * r.n!) / 100), `% dentro de ${r.spec.what}`);
  }
  const apollo = data.rows.find((r) => r.what.startsWith('Elevación del Sol en 30'))!;
  const [id, , , ours, ref, d] = apollo.points[0];
  assert.match(id, /^apollo\d+ · /);
  assert.ok(Math.abs(ours! - ref! - d!) < 1e-4, 'd = nuestro − referencia');
  const coords = data.rows.find((r) => r.what.startsWith('Coordenadas'))!;
  assert.ok(coords.points.every((p) => p[1] !== null && p[2] !== null), 'coordenadas de cada sitio');
  assert.ok(coords.points.some((p) => p[8] !== null), 'los sitios polares tienen x, y del mapa');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-view-'));
  try {
    writePoints(data, dir);
    assert.deepEqual(readPoints(dir), data, '--cached relee lo mismo');
    const html = fs.readFileSync(writeHtml(data, dir), 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<html lang="es">/);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/, 'sin recursos externos');
    const at = html.indexOf('id="validation-data"');
    const json = html.slice(html.indexOf('>', at) + 1, html.indexOf('</script>', at));
    const page = JSON.parse(json) as { meta: ViewData['meta']; rows: (ViewData['rows'][number] & { whatHtml: string; sourceHtml: string })[] };
    assert.deepEqual(page.meta, data.meta);
    assert.deepEqual(page.rows.map((r) => r.points), data.rows.map((r) => r.points), 'los puntos de la página son los de la medición');
    const coordsHtml = page.rows.find((r) => r.what.startsWith('Coordenadas'))!.sourceHtml;
    assert.match(coordsHtml, /<a href="https:\/\/[^"]+" target="_blank" rel="noopener">NSSDC<\/a>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#86: la malla del mejor punto cercano tiene 81 puntos, incluye la coordenada publicada y va cada 10 m', () => {
  const [lat, lon] = [-89.4505, -137.16];
  const grid = nearGrid(lat, lon);
  assert.equal(grid.length, 81);
  assert.equal(NEAR.halfM, 40);
  const centre = grid.filter((p) => p.dx === 0 && p.dy === 0);
  assert.equal(centre.length, 1);
  assert.deepEqual([centre[0].lat, centre[0].lon], [lat, lon], 'el centro es la coordenada publicada');
  const at = (dx: number, dy: number): [number, number] => { const p = grid.find((q) => q.dx === dx && q.dy === dy)!; return llToXY(p.lat, p.lon); };
  const [x0, y0] = llToXY(lat, lon);
  for (let dy = -40; dy <= 40; dy += 10) {
    for (let dx = -40; dx <= 40; dx += 10) {
      const [x, y] = at(dx, dy);
      assert.ok(Math.abs(x - x0 - dx) < 0.01 && Math.abs(y - y0 - dy) < 0.01, `(${dx}, ${dy}) en su sitio de la proyección`);
      if (dx < 40) { const [x2, y2] = at(dx + 10, dy); assert.ok(Math.abs(Math.hypot(x2 - x, y2 - y) - 10) <= 0.01, `vecinos en x a (${dx}, ${dy})`); }
      if (dy < 40) { const [x2, y2] = at(dx, dy + 10); assert.ok(Math.abs(Math.hypot(x2 - x, y2 - y) - 10) <= 0.01, `vecinos en y a (${dx}, ${dy})`); }
    }
  }
  const near = allUnits().filter((u) => u.kind === 'glaserNear');
  assert.equal(near.length, 3, 'una unidad por punto de la tabla 1 (C1, C2 y S)');
  assert.equal(NEEDS.glaserNear, 'dem');
});

test('#86: filas de la tabla 1 de Gläser (0 m) en el mejor punto cercano y en la coordenada publicada', () => {
  const none = new Map<string, unknown>();
  const best = ROWS.filter((s) => s.source.includes('tabla 1') && s.what.includes('mejor punto a ≤ 40 m'));
  assert.deepEqual(best.map((s) => s.what.split(',')[0]), ['% del tiempo con Sol', 'Iluminación media', 'Sombra continua más larga']);
  for (const s of best) {
    assert.equal(s.known, undefined, s.what);
    if (s.unit === 'pp') assert.ok(s.limits!.rms! <= 5 && s.limits!.max! <= 7, s.what);
    else { assert.equal(s.unit, 'h'); assert.ok(s.limits!.max! <= 100, s.what); }
    assert.equal(evaluate(s, none).status, '⏭️', `${s.what}: sin DEM no se ejecuta`);
  }
  const published = ROWS.filter((s) => s.known === 86);
  assert.deepEqual(published.map((s) => s.limits), [{ rms: 21, max: 30 }, { rms: 22.5, max: 32 }, { max: 540 }]);
  for (const s of published) {
    assert.match(s.what, /en la coordenada publicada \(redondeada/);
    assert.doesNotMatch(s.what, /\d+ a \d+ %/, 'sin resultados, el texto no cita cifras');
  }
});

/** Results of the three glaserNear units (C1, C2 and S of table 1) and of the glaser units, synthetic. */
function syntheticGlaser(): Map<string, unknown> {
  const r = new Map<string, unknown>();
  const vis10: [number, number][] = [[41, 73.2], [41.7, 72], [43.6, 84.6]];
  for (const [i, u] of allUnits().filter((x) => x.kind === 'glaserNear').entries()) {
    r.set(unitKey(u), { vis: 80, avg: 75, shadowH: 250, dx: 20, dy: -10, vis10: vis10[i] } satisfies GlaserNearResult);
  }
  for (const u of allUnits().filter((x) => x.kind === 'glaser')) r.set(unitKey(u), { vis: 60, avg: 55, shadowH: 500 });
  return r;
}

test('#86: bestNear elige el mayor % con Sol y, a igualdad, el más cercano al centro', () => {
  const grid = nearGrid(-89.4505, -137.16);
  const at = (dx: number, dy: number): number => grid.findIndex((p) => p.dx === dx && p.dy === dy);
  const metrics: NearMetrics[] = grid.map(() => ({ sunFraction: 0.5, energy: 0.4, longestNightH: 300 }));
  for (const [dx, dy] of [[40, 40], [-20, 10], [30, 0]]) metrics[at(dx, dy)] = { sunFraction: 0.8, energy: 0.7, longestNightH: 200 };
  metrics[at(10, 0)] = { sunFraction: 0.3, energy: 0.2, longestNightH: 900 };
  metrics[at(0, 10)] = { sunFraction: 0.6, energy: 0.5, longestNightH: 400 };
  const best = bestNear(grid, metrics);
  assert.deepEqual([best.dx, best.dy], [-20, 10], 'a igual sunFraction, el más cercano al centro');
  assert.ok(Math.abs(best.vis - 80) < 1e-9 && Math.abs(best.avg - 70) < 1e-9);
  assert.equal(best.shadowH, 200);
  assert.deepEqual(best.vis10.map((x) => Math.round(x * 1e9) / 1e9), [30, 60], 'mínimo y máximo de los 9 puntos a ±10 m');
  const flat = bestNear(grid, grid.map(() => ({ sunFraction: 0.5, energy: 0.4, longestNightH: 300 })));
  assert.deepEqual([flat.dx, flat.dy], [0, 0], 'todo igual: el centro');
});

test('#86: glaserNearRow con resultados sintéticos: etiqueta del mejor punto y tolerancia del 10 % en la sombra', () => {
  const r = syntheticGlaser();
  const shadow = glaserNearRow('shadowH')(r);
  assert.ok(typeof shadow !== 'string' && shadow.kind === 'numeric');
  assert.deepEqual(shadow.points!.map((p) => p.id), ['C1 (mejor a 20, -10 m)', 'C2 (mejor a 20, -10 m)', 'S (mejor a 20, -10 m)']);
  assert.deepEqual(shadow.ref, [268, 166, 221]);
  assert.deepEqual(shadow.d, [250 - 268, 250 - 166, 250 - 221]);
  assert.deepEqual((shadow.tol as number[]).map((x) => Math.round(x * 1e9) / 1e9), [26.8, 16.6, 22.1]);
  const vis = glaserNearRow('vis')(r);
  assert.ok(typeof vis !== 'string' && vis.kind === 'numeric');
  assert.deepEqual(vis.tol, [2, 2, 2]);
  assert.ok(Math.abs(vis.d[0] - (80 - 81.3)) < 1e-9);
});

test('#86: el rango a ±10 m de las filas en la coordenada publicada sale de vis10, no del texto', () => {
  const published = ROWS.filter((s) => s.known === 86);
  for (const s of published) {
    const row = evaluate(s, syntheticGlaser());
    assert.notEqual(row.status, '⏭️', s.what);
    assert.match(row.note, /a ±10 m el % con Sol va de 41,0 a 84,6 %/, s.what);
  }
  const md = renderMarkdown(published.map((s) => evaluate(s, syntheticGlaser())), { demVersion: null });
  assert.match(md, /va de 41,0 a 84,6 %/, 'la nota sale en VALIDATION.md también con ⚠️ o ❌');
});

test('#85: la huella es el interior del píxel de 60 m que contiene el sitio: 36 puntos cada 10 m', () => {
  const [lat, lon] = [-89.44027, -137.12649];
  const { grid, centre, siteOffsetM } = pixelFootprint(lat, lon);
  assert.equal(grid.length, 36);
  assert.deepEqual([FOOTPRINT.halfM, FOOTPRINT.stepM, FOOTPRINT.pixelM], [25, 10, 60]);
  const [cx, cy] = llToXY(centre.lat, centre.lon), [sx, sy] = llToXY(lat, lon);
  assert.ok(Math.abs(((cx / 60) % 1 + 1) % 1 - 0.5) < 1e-3 && Math.abs(((cy / 60) % 1 + 1) % 1 - 0.5) < 1e-3, 'el centro está a media celda de las aristas');
  assert.ok(Math.abs(sx - cx) <= 30 && Math.abs(sy - cy) <= 30, 'el sitio está dentro del píxel');
  assert.ok(Math.abs(siteOffsetM[0] - (sx - cx)) < 1e-3 && Math.abs(siteOffsetM[1] - (sy - cy)) < 1e-3);
  assert.ok(grid.every((p) => Math.abs(p.dx) <= 25 && Math.abs(p.dy) <= 25), 'ningún punto en una arista');
  const xy = new Map(grid.map((p) => [`${p.dx},${p.dy}`, llToXY(p.lat, p.lon)]));
  for (const p of grid) {
    const [x, y] = xy.get(`${p.dx},${p.dy}`)!;
    for (const [nx, ny] of [[p.dx + 10, p.dy], [p.dx, p.dy + 10]]) {
      const q = xy.get(`${nx},${ny}`);
      if (q) assert.ok(Math.abs(Math.hypot(q[0] - x, q[1] - y) - 10) <= 0.01, `vecinos a (${p.dx}, ${p.dy})`);
    }
  }
  const units = allUnits().filter((u) => u.kind === 'footprint');
  assert.deepEqual(units, [{ kind: 'footprint', id: 'shackleton-rim' }]);
  assert.equal(NEEDS.footprint, 'dem');
});

test('#85: fila de la huella de shackleton-rim frente a PGDA de 60 m, sin known y con tope ≤ 10 pp', () => {
  const rows = ROWS.filter((s) => s.what.includes('shackleton-rim') && s.what.includes('huella de 60 m'));
  assert.equal(rows.length, 1);
  const [s] = rows;
  assert.equal(s.known, undefined);
  assert.equal(s.unit, 'pp');
  assert.match(s.source, /AVGVISIB_85S_060M/);
  assert.ok(s.limits!.max! <= 10);
  assert.equal(evaluate(s, new Map()).status, '⏭️', 'sin DEM no se ejecuta');
  const r = new Map<string, unknown>([['footprint:shackleton-rim', { mean: 52.4, min: 35.8, max: 84.9, centre: 62.7 }]]);
  const row = evaluate(s, r);
  assert.equal(row.status, '✅');
  assert.ok(Math.abs(row.points[0].d! - (52.4 - 44.308)) < 1e-9);
  assert.match(row.points[0].id, /en el punto 62,7 %/);
  assert.doesNotMatch(s.what, /91,6/, 'el valor a 2 m no se escribe a mano');
  assert.equal(row.note, '', 'sin el resultado de pgda no hay nota');
  r.set('pgda:shackleton-rim', { h0: { sun: 0.627, earth: 0, skySr: null }, h2: { sun: 0.916, earth: 0, skySr: null } });
  assert.match(evaluate(s, r).note, /a 2 m y en el punto da 91,6 %/, 'sale de la medición de pgda');
});

test('#85: S2 a 2 m sigue con known: 85 y tope de 35 h (la transcripción es correcta)', () => {
  const s2 = ROWS.filter((s) => s.what.startsWith('Sombra continua más larga en S2'));
  assert.equal(s2.length, 1);
  assert.equal(s2[0].known, 85);
  assert.deepEqual(s2[0].limits, { max: 35 });
  assert.doesNotMatch(s2[0].what, /\d+ a \d+ h/, 'sin cifras medidas escritas a mano');
  const glaser = JSON.parse(fs.readFileSync(new URL('../validation/fixtures/glaser2018.json', import.meta.url), 'utf8')) as { points: unknown[][] };
  assert.deepEqual(glaser.points.find((p) => p[0] === 'S2'), ['S2', 2, -89.7815, -155.30, 2, 89.8, 82.1, 65]);
});

test('#85: las filas de los 49 puntos al sur de 85°S conservan known: 85 y sus límites', () => {
  const deep = ROWS.filter((s) => s.what.includes('49 puntos al sur de 85°S'));
  assert.deepEqual(deep.map((s) => [s.known, s.limits]), [
    [85, { rms: 7.4, mae: 3.0, max: 33, within: 71 }], [85, { rms: 6.3, mae: 2.4, max: 33, within: 79 }],
    [85, { rms: 7.6, mae: 2.8, max: 48, within: 75 }], [85, { rms: 4.0, mae: 2.0, max: 18.5, within: 75 }],
  ]);
});
