// DSN mode (issue #103): the Moon above the minimum elevation of some DSN station, and `earthDsn` in the windows.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DSN_MIN_ELEVATION_DEG, DSN_STATIONS, dsnMargin, dsnWindows, moonElevations } from '../src/dsn.ts';
import { windows } from '../src/service.ts';
import { visibilityWindows } from '../src/useCases.ts';
import { getSite } from '../src/sites.ts';

/** test/fixtures/dsn-horizons.json (scripts/fetch-dsn-fixture.ts): the Moon seen from each DSN antenna in JPL Horizons. */
interface DsnFixture { t: string[]; stations: Record<string, { antenna: string; az: number[]; el: number[] }> }
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/dsn-horizons.json', import.meta.url), 'utf8')) as DsnFixture;

const DAY_MS = 86400e3;
const START = Date.parse('2027-01-01T00:00:00Z');
// Near side, spherical horizon: the Earth is always high in the sky (~70°), visible the whole time.
const apollo11 = getSite('apollo11')!;
const midpoints = (wins: readonly { start: string; end: string }[]): number[] => wins.map((x) => (Date.parse(x.start) + Date.parse(x.end)) / 2);

describe('elevación de la Luna desde la DSN frente a JPL Horizons', () => {
  for (const [k, station] of DSN_STATIONS.entries()) {
    test(`${station.name} (${station.antenna}): error ≤ 0,1° en elevación`, () => {
      const ref = fixture.stations[station.id];
      assert.equal(ref.antenna, station.antenna);
      assert.ok(fixture.t.length >= 5, 'al menos 5 instantes');
      let max = 0;
      for (const [i, t] of fixture.t.entries()) max = Math.max(max, Math.abs(moonElevations(Date.parse(t))[k] - ref.el[i]));
      assert.ok(max <= 0.1, `error máximo ${max.toFixed(4)}°`);
    });
  }
});

describe('ventanas de la DSN', () => {
  const end = START + 10 * DAY_MS;
  const w = windows(apollo11, START, end, { mask: null, dsnMinElevationDeg: DSN_MIN_ELEVATION_DEG });

  test('con la Luna bajo el horizonte de las tres estaciones, earthDsn es falso aunque la Tierra se vea desde el sitio', () => {
    assert.equal(w.earth.fractionOfTime, 1, 'la Tierra se ve todo el tiempo desde Apolo 11');
    const ed = w.earthDsn!;
    assert.ok(ed.fractionOfTime < 1 && ed.fractionOfTime > 0.5, `earthDsn ${ed.fractionOfTime}`);
    // The gaps between earthDsn windows: no station has the Moon above 10°.
    const gaps = ed.windows.slice(1).map((x, i) => ({ start: ed.windows[i].end, end: x.start }));
    assert.ok(gaps.length > 3);
    for (const ms of midpoints(gaps)) {
      assert.ok(moonElevations(ms).every((el) => el < DSN_MIN_ELEVATION_DEG), new Date(ms).toISOString());
      assert.ok(dsnMargin(ms) < 0);
    }
    for (const ms of midpoints(ed.windows)) assert.ok(moonElevations(ms).some((el) => el > DSN_MIN_ELEVATION_DEG), new Date(ms).toISOString());
  });

  test('es la intersección de la Tierra visible con la Luna sobre alguna estación', () => {
    const hidden = windows(apollo11, START, end, { mask: { stepDeg: 90, el: [80, 80, 80, 80, 80], source: 'test' }, dsnMinElevationDeg: DSN_MIN_ELEVATION_DEG });
    assert.equal(hidden.earth.totalHours, 0);
    assert.equal(hidden.earthDsn!.totalHours, 0, 'sin Tierra visible no hay earthDsn');
    assert.ok(w.earthDsn!.totalHours <= w.earth.totalHours);
  });

  test('los cruces se refinan al segundo', () => {
    const t = Array.from({ length: 4 * 24 * 3 + 1 }, (_, i) => START + i * 15 * 60e3);
    for (const [s, e] of dsnWindows(t)) {
      if (s > t[0]) assert.ok(Math.abs(dsnMargin(s)) < 0.01, new Date(s).toISOString());
      if (e < t.at(-1)!) assert.ok(Math.abs(dsnMargin(e)) < 0.01, new Date(e).toISOString());
    }
  });

  test('sin dsnMinElevationDeg no hay earthDsn y el resto no cambia', () => {
    const plain = windows(apollo11, START, end, { mask: null });
    assert.ok(!('earthDsn' in plain));
    const { earthDsn: _, ...rest } = w;
    assert.deepEqual(rest, plain);
  });

  test('el caso de uso: dsn añade earthDsn y la información de las estaciones; la banda no lo lleva', () => {
    const u = visibilityWindows({ site: apollo11, startMs: START, endMs: end, dsn: true, horizonBandDeg: 0.3 });
    assert.deepEqual(u.windows.earthDsn, w.earthDsn);
    assert.equal(u.dsn!.minElevationDeg, 10);
    assert.equal(u.dsn!.minElevationAssumed, true);
    assert.deepEqual(u.dsn!.stations.map((s) => s.antenna), ['DSS-14', 'DSS-63', 'DSS-43']);
    assert.ok(!('earthDsn' in u.horizonBand!.raised));
    const off = visibilityWindows({ site: apollo11, startMs: START, endMs: end });
    assert.equal(off.dsn, null);
    assert.ok(!('earthDsn' in off.windows));
  });
});
