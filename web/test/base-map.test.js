// Both south-pole maps (Advanced and Replan) draw one base (#344): relief, hatching beyond the relief image, latitude
// rings, the names of the features and the note with the source and which way is up. Each view draws only its marks.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ringStepDeg, ringsFor, outsideRelief, NAMED_FEATURES, MAP_RADIUS_KM } from '../js/common/map.js';
import { baseMapNote } from '../js/common/relief-note.js';
import * as M from '../js/engine/model.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const centreKm = (lat, lon) => M.toMap(lat, lon);

describe('one base layer for both maps', () => {
  for (const view of ['js/views/advanced.js', 'js/views/replan.js']) {
    test(`${view} draws the base with drawBaseMap() and does not paint the relief, hatching or rings itself`, () => {
      const src = read(view);
      assert.ok(src.includes('drawBaseMap('), 'does not use drawBaseMap()');
      assert.ok(!src.includes('getTerrain('), 'draws the relief itself');
      assert.ok(!src.includes('createPattern('), 'draws the hatching itself');
      assert.ok(!src.includes('KM_PER_DEGREE'), 'draws the latitude rings itself');
      assert.ok(!src.includes('FEATURES'), 'labels the features itself');
    });
  }
  test('Advanced labels the features; Replan (280 px) does not', () => {
    assert.match(read('js/views/advanced.js'), /drawBaseMap\([^)]*names: true/);
    assert.match(read('js/views/replan.js'), /drawBaseMap\([^)]*names: false/);
  });
});

describe('latitude rings', () => {
  test('every 2° for the whole pole, 0.5° up close (45 km), 1° in between', () => {
    assert.equal(ringStepDeg(MAP_RADIUS_KM), 2);
    assert.equal(ringStepDeg(45), 0.5);
    assert.equal(ringStepDeg(100), 1);
  });
  test('the whole pole: 2°, 4° and 6° (−88°, −86°, −84°)', () => {
    assert.deepEqual(ringsFor({ x: 0, y: 0 }, MAP_RADIUS_KM).rings, [2, 4, 6]);
  });
  test('a region away from the pole: only the rings that cross the frame', () => {
    const { rings } = ringsFor(centreKm(-85, 0), 48); // 151 km from the pole, ±48 km: from 3.4° to 6.6°
    assert.deepEqual(rings, [3.5, 4, 4.5, 5, 5.5, 6, 6.5]);
  });
});

describe('hatching beyond the relief image', () => {
  test('the whole pole fits in the image', () => assert.equal(outsideRelief({ x: 0, y: 0 }, MAP_RADIUS_KM), false));
  test('up close (±45 km) on a point 170 km from the pole goes beyond it', () => {
    assert.equal(outsideRelief(centreKm(-90 + 170 / M.KM_PER_DEGREE, 0), 45), true);
  });
  test('Replan with a 250 km radius goes beyond it', () => assert.equal(outsideRelief(centreKm(-89.44, -137.13), 300), true));
  test('a region near the pole does not', () => assert.equal(outsideRelief(centreKm(-89.5, 0), 48), false));
});

describe('the note under both maps', () => {
  test('relief source and orientation', () => {
    assert.equal(baseMapNote('ready', 'api'), 'relieve LOLA · arriba, la cara que mira a la Tierra (0°)');
  });
  test('says the hatching when part of the frame has no relief', () => {
    assert.equal(baseMapNote('ready', 'api', { uncovered: true }), 'relieve LOLA · rayado: Luna lisa (sin relieve) · arriba, la cara que mira a la Tierra (0°)');
  });
});

describe('labels of Cabeus and Mons Mouton (#344)', () => {
  const kmBetween = (a, b) => { const p = M.toMap(a.lat, a.lon), q = M.toMap(b.lat, b.lon); return Math.hypot(p.x - q.x, p.y - q.y); };
  const feature = name => NAMED_FEATURES.find(f => f.name === name);
  test('Cabeus on its centre in the IAU Gazetteer of Planetary Nomenclature (85.33°S, 42.13°W)', () => {
    assert.ok(kmBetween(feature('Cabeus'), { lat: -85.33, lon: -42.13 }) < 1);
  });
  test('Mons Mouton on its summit measured on the LOLA DEM (84.67°S, 39.34°E)', () => {
    assert.ok(kmBetween(feature('Mons Mouton'), { lat: -84.67, lon: 39.34 }) < 1);
  });
  test('the label is where the feature is drawn (x, y follow lat, lon)', () => {
    for (const f of NAMED_FEATURES) {
      const p = M.toMap(f.lat, f.lon);
      assert.ok(Math.hypot(p.x - f.x, p.y - f.y) < 1e-9, f.name);
    }
  });
});
