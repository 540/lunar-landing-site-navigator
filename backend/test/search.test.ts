// Site search: grid, weights and metric consistency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, evaluateCell, gridCells, normalizeWeights, searchGrid } from '../src/search.ts';
import { sampleVectors } from '../src/service.ts';
import { R_MOON_KM } from '../src/ephemeris.ts';

const DEG = Math.PI / 180;
const startMs = Date.parse('2027-01-01T00:00:00Z');

test('gridCells: separación aproximadamente constante en km, también cerca del polo', () => {
  const cells = gridCells(REGIONS['polo-sur'], 15);
  assert.ok(cells.length > 100 && cells.length < 2000);
  // Points in the same row: distance between neighbours ~ 15 km (+-50 %).
  const row = cells.filter((c) => Math.abs(c.lat - cells[cells.length - 5].lat) < 1e-9);
  if (row.length > 2) {
    const d = R_MOON_KM * Math.cos(row[0].lat * DEG) * Math.abs(row[1].lon - row[0].lon) * DEG;
    assert.ok(d > 7.5 && d < 22.5, `separación ${d} km`);
  }
  assert.ok(cells.every((c) => c.lat >= -90 && c.lat <= -84 && c.lon >= -180 && c.lon <= 180));
});

test('normalizeWeights: suma 1 e ignora negativos', () => {
  const w = normalizeWeights({ energy: 2, comm: 2, both: 0, night: -5 });
  assert.equal(Math.round((w.energy + w.comm + w.both + w.night) * 1e9), 1e9);
  assert.equal(w.both, 0);
  assert.equal(w.night, 0);
  assert.throws(() => normalizeWeights({ energy: 0, comm: 0, both: 0, night: 0 }));
});

test('evaluateCell: métricas en rango y ambos ≤ min(Sol, Tierra)', () => {
  const stepMs = 3600e3;
  const sampled = sampleVectors(startMs, startMs + 30 * 86400e3, stepMs);
  for (const cell of [{ lat: 0.674, lon: 23.473 }, { lat: -89.45, lon: -137 }, { lat: -45, lon: 177 }]) {
    const r = evaluateCell(cell, sampled, { mode: 'limb', stepMs, weights: normalizeWeights() });
    const m = r.metrics;
    for (const k of ['energy', 'sunFraction', 'earthFraction', 'bothFraction'] as const) assert.ok(m[k] >= 0 && m[k] <= 1, k);
    assert.ok(m.bothFraction <= Math.min(m.sunFraction, m.earthFraction) + 1e-9);
    assert.ok(r.score >= 0 && r.score <= 100);
  }
});

test('searchGrid: el refinamiento nunca empeora el mejor resultado', () => {
  const o = { startMs, endMs: startMs + 15 * 86400e3, stepMs: 3600e3, mode: 'limb' as const, spacingKm: 30, refineTop: 3, top: 3 };
  const r0 = searchGrid(REGIONS['polo-sur'], { ...o, refine: 0 });
  const r2 = searchGrid(REGIONS['polo-sur'], { ...o, refine: 2 });
  assert.ok(r2.top[0].score >= r0.top[0].score);
  assert.equal(r2.levels.length, 3);
});

test('searchGrid: ningún resultado ni celda sale de la región, tampoco con el refinado (#84)', () => {
  const region = { latMin: -85, latMax: -84.5, lonMin: 28, lonMax: 31 };
  const r = searchGrid(region, { startMs, endMs: startMs + 14 * 86400e3, stepMs: 3600e3, mode: 'limb', spacingKm: 3, refine: 2, refineTop: 3, top: 5 });
  assert.equal(r.levels.length, 3);
  for (const c of [...r.cells, ...r.top]) {
    assert.ok(c.lat >= region.latMin && c.lat <= region.latMax, `latitud ${c.lat} fuera de la región`);
    assert.ok(c.lon >= region.lonMin && c.lon <= region.lonMax, `longitud ${c.lon} fuera de la región`);
  }
});

test('inRegion: longitudes módulo 360 y el polo vale con cualquier longitud', async () => {
  const { inRegion } = await import('../src/search.ts');
  const r = { latMin: -90, latMax: -85, lonMin: 170, lonMax: 180 };
  assert.ok(inRegion({ lat: -86, lon: 175 }, r));
  assert.ok(inRegion({ lat: -86, lon: -180 }, r));
  assert.ok(!inRegion({ lat: -86, lon: -179 }, r));
  assert.ok(!inRegion({ lat: -84, lon: 175 }, r));
  assert.ok(inRegion({ lat: -90, lon: 0 }, r));
  assert.ok(inRegion({ lat: -86, lon: 0 }, REGIONS['polo-sur']));
});

test('searchGrid: el top respeta la separación mínima entre resultados', async () => {
  const { distanceKm } = await import('../src/search.ts');
  const r = searchGrid(REGIONS['polo-sur'], { startMs, endMs: startMs + 15 * 86400e3, stepMs: 3600e3, mode: 'limb', spacingKm: 30, refine: 2, refineTop: 3, top: 5, minSepKm: 30 });
  for (let i = 0; i < r.top.length; i++) for (let j = i + 1; j < r.top.length; j++) assert.ok(distanceKm(r.top[i], r.top[j]) >= 30);
});

test('puntuación por variables: desglose suma la puntuación y pesos desconocidos fallan', async () => {
  const { scoreMetrics, scoreBreakdown, SCORE_VARIABLES } = await import('../src/search.ts');
  const m = { energy: 0.6, sunFraction: 0.7, earthFraction: 0.9, bothFraction: 0.5, longestNightH: 100, longestNoEarthH: 50, longestBothH: 80 };
  const w = normalizeWeights(Object.fromEntries(Object.keys(SCORE_VARIABLES).map((k) => [k, 1])));
  const total = Object.values(scoreBreakdown(m, w, 336)).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - scoreMetrics(m, w, 336)) < 0.05);
  assert.throws(() => normalizeWeights({ madeUp: 1 }), /Peso desconocido/);
  // Default weights: energy 0.7 + communication 0.3 (no redundant variables).
  assert.ok(Math.abs(scoreMetrics(m, normalizeWeights(), 336) - 100 * (0.7 * 0.6 + 0.3 * 0.9)) < 1e-9);
});

test('avisos de redundancia: ponderar variables que miden lo mismo avisa; los pesos por defecto no', async () => {
  const { redundancyWarnings } = await import('../src/search.ts');
  assert.deepEqual(redundancyWarnings(normalizeWeights()), []);
  assert.ok(redundancyWarnings(normalizeWeights({ energy: 1, sun: 0, night: 1 })).length >= 1);
  assert.ok(redundancyWarnings(normalizeWeights({ comm: 1, commGap: 1 })).some((w) => /commGap/.test(w)));
});

test('margen de elevación de la Tierra: exigir más elevación nunca aumenta la visibilidad', () => {
  const stepMs = 3600e3;
  const sampled = sampleVectors(startMs, startMs + 14 * 86400e3, stepMs);
  const cell = { lat: -83.69, lon: -5.388 };
  const w = normalizeWeights();
  const limb = evaluateCell(cell, sampled, { mode: 'limb', stepMs, weights: w }).metrics.earthFraction;
  const center = evaluateCell(cell, sampled, { mode: 'limb', stepMs, weights: w, earthMode: 'center' }).metrics.earthFraction;
  const center2 = evaluateCell(cell, sampled, { mode: 'limb', stepMs, weights: w, earthMode: 'center', earthMinElevationDeg: 2 }).metrics.earthFraction;
  assert.ok(limb >= center && center >= center2, `${limb} ≥ ${center} ≥ ${center2}`);
  assert.equal(evaluateCell(cell, sampled, { mode: 'limb', stepMs, weights: w }).periodH, 337);
});
