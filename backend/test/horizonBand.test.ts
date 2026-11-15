// Horizon robustness band (issue #64): the windows recomputed with the horizon raised and lowered, and the range of each
// figure. Synthetic masks registered by hand: no DEM needed.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { registerMask } from '../src/horizon.ts';
import { visibilityWindows } from '../src/useCases.ts';
import type { Windows } from '../src/types.ts';

const DAY = 86400e3;
const START = Date.parse('2027-01-01T00:00:00Z');
const POLAR = { lat: -89, lon: 0 };
/** A ridge of 1.5° over half of the sky and a flat horizon at 0.5° over the rest, shifted by `shift`. */
const ridge = (shift: number): number[] => Array.from({ length: 360 }, (_, az) => (az < 180 ? 1.5 : 0.5) + shift);
registerMask('band-test', { stepDeg: 1, el: ridge(0), source: 'cresta sintética' });
registerMask('band-test-up', { stepDeg: 1, el: ridge(0.5), source: 'cresta sintética + 0,5°' });
registerMask('band-test-down', { stepDeg: 1, el: ridge(-0.5), source: 'cresta sintética − 0,5°' });

const site = (id: string) => ({ id, name: id, ...POLAR });
const q = { site: site('band-test'), startMs: START, endMs: START + 60 * DAY, mode: 'center' as const };
/** The part of the windows that does not name the site. */
const bodies = (w: Windows) => ({ sun: w.sun, earth: w.earth, sunAndEarth: w.sunAndEarth });

describe('banda de robustez del horizonte', () => {
  test('sin horizonBandDeg (o con 0) no hay banda y las ventanas nominales no cambian con ella', () => {
    const plain = visibilityWindows(q);
    assert.equal(plain.horizonBand, null);
    assert.equal(visibilityWindows({ ...q, horizonBandDeg: 0 }).horizonBand, null);
    const banded = visibilityWindows({ ...q, horizonBandDeg: 0.3 });
    assert.deepEqual(banded.windows, plain.windows);
    assert.equal(banded.horizonBand!.deg, 0.3);
  });

  test('raised y lowered son las ventanas de la misma máscara subida y bajada', () => {
    const band = visibilityWindows({ ...q, horizonBandDeg: 0.5 }).horizonBand!;
    assert.deepEqual(bodies(band.raised), bodies(visibilityWindows({ ...q, site: site('band-test-up') }).windows));
    assert.deepEqual(bodies(band.lowered), bodies(visibilityWindows({ ...q, site: site('band-test-down') }).windows));
  });

  test('subir el horizonte quita visibilidad, bajarlo la da, y el rango contiene la cifra nominal', () => {
    const r = visibilityWindows({ ...q, horizonBandDeg: 0.3 });
    const band = r.horizonBand!;
    for (const body of ['sun', 'earth', 'sunAndEarth'] as const) {
      const nominal = r.windows[body], range = band.range[body];
      assert.ok(band.raised[body].totalHours <= nominal.totalHours && nominal.totalHours <= band.lowered[body].totalHours, body);
      for (const key of ['totalHours', 'fractionOfTime', 'longestWindowHours'] as const) {
        const values = [nominal[key], band.raised[body][key], band.lowered[body][key]];
        assert.deepEqual(range[key], { min: Math.min(...values), max: Math.max(...values) }, `${body}.${key}`);
        assert.ok(range[key].min <= nominal[key] && nominal[key] <= range[key].max, `${body}.${key}`);
      }
    }
    // At 89°S the Sun stays within ~1.5° of the horizon: 0.3° must change the hours of Sun.
    assert.ok(band.range.sun.totalHours.max - band.range.sun.totalHours.min > 10);
    assert.ok(!('longestNightHours' in band.range));
  });

  test('una banda mayor da un rango que contiene al de una menor', () => {
    const narrow = visibilityWindows({ ...q, horizonBandDeg: 0.1 }).horizonBand!.range.sun.fractionOfTime;
    const wide = visibilityWindows({ ...q, horizonBandDeg: 0.6 }).horizonBand!.range.sun.fractionOfTime;
    assert.ok(wide.min <= narrow.min && narrow.max <= wide.max);
  });

  test('en la esfera y con earthMinElevationDeg: el desplazamiento se suma a la elevación mínima de la Tierra', () => {
    const sphere = { site: { id: 'custom:-85,10', name: 'p', custom: true, lat: -85, lon: 10 }, startMs: START, endMs: START + 60 * DAY };
    const band = visibilityWindows({ ...sphere, earthMinElevationDeg: 2, horizonBandDeg: 0.5 }).horizonBand!;
    assert.deepEqual(band.raised.earth, visibilityWindows({ ...sphere, earthMinElevationDeg: 2.5 }).windows.earth);
    assert.deepEqual(band.lowered.earth, visibilityWindows({ ...sphere, earthMinElevationDeg: 1.5 }).windows.earth);
    // The Sun does not use earthMinElevationDeg: it only moves with the band.
    assert.ok(band.raised.sun.totalHours < band.lowered.sun.totalHours);
    const cancelled = visibilityWindows({ ...sphere, earthMinElevationDeg: 0.5, horizonBandDeg: 0.5 });
    assert.deepEqual(cancelled.horizonBand!.lowered.earth, visibilityWindows(sphere).windows.earth);
  });

  test('con la noche: rango de la noche más larga (más larga con el horizonte subido)', () => {
    const r = visibilityWindows({ ...q, night: { fullNight: true }, horizonBandDeg: 0.3 });
    const band = r.horizonBand!, night = r.windows.night!;
    assert.deepEqual(night, visibilityWindows({ ...q, night: { fullNight: true } }).windows.night);
    assert.ok(band.raised.night!.longestNightHours >= night.longestNightHours && night.longestNightHours >= band.lowered.night!.longestNightHours);
    assert.deepEqual(band.range.longestNightHours, { min: band.lowered.night!.longestNightHours, max: band.raised.night!.longestNightHours });
    assert.ok(band.range.longestNightFullHours!.min <= night.longestNightFullHours! && night.longestNightFullHours! <= band.range.longestNightFullHours!.max);
  });
});
