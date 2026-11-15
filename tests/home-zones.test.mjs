// «Explorar la Luna» de la portada: el paso de las cifras del motor a home/data/zones.json (home/scripts/zones-lib.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { earthLevel, lightLevel, zoneRecord } from '../home/scripts/zones-lib.ts';

const figures = (o = {}) => ({
  sunFraction: 0.5, earthFraction: 1, longestNightHours: 354, nightTruncated: false, earthElevationDeg: [58, 73.24, 60],
  horizon: { applied: false, source: null, note: 'Luna lisa' }, slope: null, warnings: [], ...o,
});

test('luz: casi siempre, la mitad, poca o nunca', () => {
  assert.equal(lightLevel(0.92), 'most');
  assert.equal(lightLevel(0.488), 'half');
  assert.equal(lightLevel(0.2), 'little');
  assert.equal(lightLevel(0), 'never');
});

test('Tierra: siempre, casi siempre, a ratos o nunca', () => {
  assert.equal(earthLevel(1), 'always');
  assert.equal(earthLevel(0.7), 'mostly');
  assert.equal(earthLevel(0.217), 'sometimes');
  assert.equal(earthLevel(0), 'never');
});

test('el registro redondea, pasa la noche a días y da el rango de altura de la Tierra', () => {
  const r = zoneRecord({ id: 'apollo-11', lat: 0.67, lon: 23.47, siteId: 'apollo11' }, figures({ sunFraction: 0.48812 }));
  assert.deepEqual(r.light, { level: 'half', percent: 48.8 });
  assert.deepEqual(r.night, { longestHours: 354, longestDays: 14.8 });
  assert.deepEqual(r.earth, { level: 'always', percent: 100, elevationDeg: { min: 58, max: 73.2 } });
  assert.deepEqual(r.horizon, { model: 'smooth', note: 'Luna lisa' });
  assert.deepEqual(r.slope, { available: false });
  assert.equal(r.siteId, 'apollo11');
});

test('sombra eterna: noche de todo el periodo, relieve y pendiente sin certificar', () => {
  const r = zoneRecord({ id: 'cabeus', lat: -84.675, lon: -48.725 }, figures({
    sunFraction: 0, longestNightHours: 8760.3, nightTruncated: true,
    horizon: { applied: true, source: 'dem', note: 'DEM' }, slope: { slopeDeg: 0.84, slopeBaselineM: 479, underestimated: true },
    warnings: ['b', 'a', 'b'],
  }));
  assert.equal(r.light.level, 'never');
  assert.equal(r.night.wholePeriod, true);
  assert.equal(r.horizon.model, 'relief');
  assert.deepEqual(r.slope, { available: true, deg: 0.8, baselineM: 479, underestimated: true });
  assert.deepEqual(r.warnings, ['a', 'b']);
  assert.equal('siteId' in r, false);
});

test('home/data/zones.json tiene las siete zonas con las cifras que lee la portada', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../home/data/zones.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(new URL('../home/index.html', import.meta.url), 'utf8');
  assert.equal(data.zones.length, 7);
  for (const z of data.zones) {
    assert.ok(html.includes(`{id:"${z.id}"`), `${z.id} sin textos en home/index.html`);
    assert.ok(['most', 'half', 'little', 'never'].includes(z.light.level));
    assert.ok(['always', 'mostly', 'sometimes', 'never'].includes(z.earth.level));
    assert.equal(typeof z.night.longestHours, 'number');
  }
});
