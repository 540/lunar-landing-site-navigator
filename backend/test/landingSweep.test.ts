// Landing-date sweep (src/landingSweep.ts and the landingDates use case): coherence with evaluateCell, a real case, good windows,
// limits and errors.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GOOD_FRACTION_OF_BEST, SweepOptionError, sweepLandingDates } from '../src/landingSweep.ts';
import { evaluateCell, normalizeWeights, resolveNightOptions } from '../src/search.ts';
import { sampleVectors } from '../src/service.ts';
import { registerMask, resolveTerrain, configureMasks } from '../src/horizon.ts';
import { configureDem, makeGrid } from '../src/terrain/dem.ts';
import { landingDates } from '../src/useCases.ts';
import { getSite } from '../src/sites.ts';
import type { Cell, EvaluateOptions, Grid, LandingSweep, LandingSweepOptions } from '../src/types.ts';

const H = 3600e3;
const DAY = 86400e3;
const MID: Cell = { lat: -65.31485, lon: -3.05572 };
const Y2027 = Date.parse('2027-01-01T00:00:00Z');
const BATTERY = { survivalLoadW: 100, whPerKg: 200, depthOfDischarge: 0.9 };

configureMasks({ diskCache: false });

/** evaluateCell over the mission that starts at `dateMs`, with the same options as the sweep. */
function reference(cell: Cell, dateMs: number, o: LandingSweepOptions): ReturnType<typeof evaluateCell> {
  const night = resolveNightOptions(o).opts;
  const opts: EvaluateOptions = {
    mode: o.mode, stepMs: o.stepMs, weights: normalizeWeights(o.weights), earthMode: o.earthMode ?? o.mode,
    earthMinElevationDeg: o.earthMinElevationDeg ?? 0, terrain: resolveTerrain(o.terrain, 'precise'), ...night, ...(o.panel ? { panel: o.panel } : {}),
  };
  return evaluateCell(cell, sampleVectors(dateMs, dateMs + o.missionDays * DAY, o.stepMs), opts);
}

/** Every date of `idx` matches evaluateCell exactly (metrics and score). */
function assertCoherent(cell: Cell, o: LandingSweepOptions, idx: number[]): LandingSweep {
  const r = sweepLandingDates(cell, o);
  for (const i of idx) {
    const d = r.dates[i];
    const ref = reference(cell, Date.parse(d.date), o);
    assert.deepEqual(d.metrics, ref.metrics, `${d.date}: métricas`);
    assert.equal(d.score, ref.score, `${d.date}: puntuación`);
  }
  return r;
}

const BASE: LandingSweepOptions = { startMs: Y2027, endMs: Y2027 + 40 * DAY, dateStepMs: DAY, missionDays: 14, stepMs: H, mode: 'limb' };

describe('coherencia con evaluateCell (cada fecha = evaluateCell de su misión)', () => {
  test('Luna esférica, opciones por defecto', () => {
    assertCoherent(MID, BASE, [0, 1, 7, 13, 22, 29, 40]);
  });

  test('noche real, batería, umbral de Sol, panel vertical, Tierra en modo full y pesos propios', () => {
    assertCoherent(MID, {
      ...BASE, fullNight: true, battery: BATTERY, nightMinSunFraction: 0.3, panel: 'vertical-rotating', earthMode: 'full',
      earthMinElevationDeg: 2, weights: { energy: 0.5, comm: 0.2, night: 0.3 },
    }, [0, 3, 11, 19, 26, 33, 40]);
  });

  test('paso entre fechas de 6 h, misión de 10 días muestreada cada 2 h', () => {
    assertCoherent(MID, { ...BASE, endMs: Y2027 + 5 * DAY, dateStepMs: 6 * H, missionDays: 10, stepMs: 2 * H, fullNight: true }, [0, 1, 2, 9, 20]);
  });

  test('relieve sintético (máscara registrada): horizonte de 3° al este y 1° al oeste', () => {
    const el = Array.from({ length: 36 }, (_, i) => (i * 10 > 0 && i * 10 < 180 ? 3 : 1));
    registerMask('sweep-test-ridge', { stepDeg: 10, el, source: 'cresta sintética' });
    assertCoherent({ id: 'sweep-test-ridge', name: 'cresta', ...MID }, { ...BASE, fullNight: true, battery: BATTERY }, [0, 5, 12, 18, 27, 40]);
  });

  test('relieve con DEM sintético (terrain): la máscara del punto, igual que evaluateCell', () => {
    // Pole-centred synthetic DEM: flat floor with a 2 km plateau beyond 20 km. The point sits ~10 km from the pole.
    const res = 400, half = 60000, n = Math.round((2 * half) / res), a = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * res, y = half - (j + 0.5) * res;
      a[j * n + i] = Math.hypot(x, y) > 20000 ? 2000 : 0;
    }
    const grid: Grid = makeGrid({ name: 'sweep-synthetic', res, X0: -half, Y0: half, w: n, h: n, a });
    configureDem({ grids: [grid] });
    try {
      const polar = { lat: -89.7, lon: 40 };
      const r = assertCoherent(polar, { ...BASE, terrain: { enabled: true, observerHeightM: 2, resolution: 'fast' }, fullNight: true }, [0, 9, 17, 31, 40]);
      assert.equal(r.site.horizon, 'mask');
      assert.ok(r.terrain);
    } finally {
      configureDem({ grids: [] });
    }
  });
});

describe('caso real: (−65,31485, −3,05572) a lo largo de 2027, misión de 14 días', () => {
  const r = sweepLandingDates(MID, { ...BASE, endMs: Date.parse('2027-12-31T00:00:00Z'), fullNight: true, battery: BATTERY });

  test('las mejores fechas tienen mucha más energía que las peores', () => {
    assert.equal(r.dates.length, 365);
    const bestE = r.best.slice(0, 5).map((d) => d.metrics.energy);
    const worstE = r.worst.slice(0, 5).map((d) => d.metrics.energy);
    assert.ok(Math.min(...bestE) >= 0.9, `mejores: ${bestE}`);
    assert.ok(Math.max(...worstE) <= 0.1, `peores: ${worstE}`);
    // Landing at sunrise: the Sun is up (or about to rise) and stays for the whole mission. At sunset: night.
    assert.ok(r.best[0].metrics.longestNightH <= 24, `${r.best[0].metrics.longestNightH} h`);
    assert.ok(r.worst[0].metrics.longestNightH >= 300, `${r.worst[0].metrics.longestNightH} h`);
    // The whole night (and the battery to get through it) only weighs on the bad dates.
    assert.ok(r.worst[0].metrics.batteryKg! > 150 && r.best[0].metrics.batteryKg! < r.worst[0].metrics.batteryKg!, `${r.best[0].metrics.batteryKg} / ${r.worst[0].metrics.batteryKg} kg`);
  });

  test('ciclo de ~29,5 días (mes sinódico) en la energía y en las ventanas buenas', () => {
    const e = r.dates.map((d) => d.metrics.energy);
    const mean = e.reduce((a, b) => a + b, 0) / e.length;
    const ac = (lag: number): number => e.slice(lag).reduce((acc, x, i) => acc + (x - mean) * (e[i] - mean), 0);
    let bestLag = 0;
    for (let lag = 20; lag <= 40; lag++) if (bestLag === 0 || ac(lag) > ac(bestLag)) bestLag = lag;
    assert.ok(bestLag >= 29 && bestLag <= 30, `autocorrelación máxima a ${bestLag} días`);
    assert.ok(r.goodWindows.length >= 12 && r.goodWindows.length <= 13, `${r.goodWindows.length} ventanas`);
    const starts = r.goodWindows.map((w) => Date.parse(w.best.date));
    const gaps = starts.slice(1).map((s, i) => (s - starts[i]) / DAY);
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    assert.ok(Math.abs(meanGap - 29.53) < 1, `separación media entre ventanas: ${meanGap.toFixed(2)} días`);
  });

  test('fase del Sol al alunizar: la peor fecha aluniza con el Sol a punto de ponerse o ya de noche', () => {
    const w = r.worst[0];
    assert.ok(!w.sun.visibleAtLanding || (w.sun.hoursToChange ?? Infinity) <= 24, JSON.stringify(w.sun));
    const b = r.best[0];
    assert.ok(b.sun.visibleAtLanding ? b.sun.hoursToChange === null || b.sun.hoursToChange >= 14 * 24 - 24 : (b.sun.hoursToChange ?? Infinity) <= 24, JSON.stringify(b.sun));
  });

  test('rendimiento: un año con paso de 1 día y misión de 14 días cada hora en menos de 2 s', () => {
    assert.ok(r.timingMs.total < 2000, `${r.timingMs.total} ms`);
    assert.equal(r.samples, 364 * 24 + 14 * 24 + 1 + 2 * 30 * 24); // the samples are computed once (with the full-night margin)
  });
});

describe('ventanas buenas y resumen', () => {
  const r = sweepLandingDates(MID, { ...BASE, endMs: Y2027 + 90 * DAY, constraints: { minEnergy: 0.8 } });

  test('con restricciones: tramos seguidos de fechas que las cumplen, con su mejor fecha', () => {
    assert.ok(r.goodWindows.length >= 2);
    assert.deepEqual(r.goodCriterion, { constraints: true, minScore: null, relativeToBest: null });
    const inWindow = new Set<string>();
    for (const w of r.goodWindows) {
      const ds = r.dates.filter((d) => d.date >= w.start && d.date <= w.end);
      assert.equal(ds.length, w.dates);
      assert.ok(ds.every((d) => d.feasible && d.metrics.energy >= 0.8));
      assert.equal(w.durationDays, (Date.parse(w.end) - Date.parse(w.start)) / DAY);
      assert.equal(w.best.score, Math.max(...ds.map((d) => d.score)));
      ds.forEach((d) => inWindow.add(d.date));
      // Maximal: the dates just outside do not meet the constraints.
      const i0 = r.dates.findIndex((d) => d.date === w.start), i1 = r.dates.findIndex((d) => d.date === w.end);
      if (i0 > 0) assert.equal(r.dates[i0 - 1].feasible, false);
      if (i1 < r.dates.length - 1) assert.equal(r.dates[i1 + 1].feasible, false);
    }
    for (const d of r.dates) if (!inWindow.has(d.date)) assert.equal(d.feasible, false);
    assert.equal(r.stats.feasibleFraction, r.stats.goodFraction);
    assert.ok(r.dates.filter((d) => !d.feasible).every((d) => d.violations!.length > 0 && /energy/.test(d.violations![0])));
  });

  test('sin restricciones ni minScore: buena = 90 % de la mejor puntuación', () => {
    const p = sweepLandingDates(MID, { ...BASE, endMs: Y2027 + 90 * DAY });
    assert.equal(p.goodCriterion.relativeToBest, DEFAULT_GOOD_FRACTION_OF_BEST);
    assert.equal(p.goodCriterion.minScore, Math.round(0.9 * p.stats.score.max * 100) / 100);
    assert.ok(!('feasible' in p.dates[0]) && !('constraints' in p) && !('feasibleFraction' in p.stats));
    const good = p.dates.filter((d) => d.score >= p.goodCriterion.minScore!).length;
    assert.equal(p.goodWindows.reduce((a, w) => a + w.dates, 0), good);
  });

  test('minScore y restricciones se combinan', () => {
    const both = sweepLandingDates(MID, { ...BASE, endMs: Y2027 + 90 * DAY, constraints: { minEnergy: 0.8 }, minScore: 95 });
    assert.ok(both.stats.goodFraction <= r.stats.goodFraction);
    for (const w of both.goodWindows) assert.ok(both.dates.filter((d) => d.date >= w.start && d.date <= w.end).every((d) => d.score >= 95 && d.feasible));
  });

  test('mejores y peores, estadísticas', () => {
    assert.equal(r.best.length, 10);
    assert.deepEqual(r.best.map((d) => d.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(r.worst[0].rank, r.dates.length);
    for (let i = 1; i < r.best.length; i++) assert.ok(r.best[i - 1].score >= r.best[i].score);
    for (let i = 1; i < r.worst.length; i++) assert.ok(r.worst[i - 1].score <= r.worst[i].score);
    const scores = r.dates.map((d) => d.score);
    assert.equal(r.stats.score.max, Math.max(...scores));
    assert.equal(r.stats.score.min, Math.min(...scores));
    assert.equal(r.stats.dates, 91);
    assert.ok(r.stats.energy.min <= r.stats.energy.mean && r.stats.energy.mean <= r.stats.energy.max);
  });

  test('sitio con Sol siempre (sima sintética): todo el rango es una sola ventana', () => {
    registerMask('sweep-test-pit', { stepDeg: 90, el: [-89, -89, -89, -89], source: 'sima sintética' });
    const p = sweepLandingDates({ id: 'sweep-test-pit', name: 'sima', ...MID }, { ...BASE, constraints: { maxLongestNightH: 0 } });
    assert.equal(p.goodWindows.length, 1);
    assert.equal(p.goodWindows[0].dates, 41);
    assert.equal(p.goodWindows[0].durationDays, 40);
  });

  test('sitio sin Sol nunca (pared sintética): ninguna ventana con minEnergy', () => {
    registerMask('sweep-test-wall', { stepDeg: 90, el: [89, 89, 89, 89], source: 'pared sintética' });
    const p = sweepLandingDates({ id: 'sweep-test-wall', name: 'pared', ...MID }, { ...BASE, constraints: { minEnergy: 0.1 } });
    assert.deepEqual(p.goodWindows, []);
    assert.equal(p.stats.energy.max, 0);
    assert.ok(p.dates.every((d) => d.sun.visibleAtLanding === false && d.sun.hoursToChange === null));
  });

  test('maxBatteryKg activa la batería con sus valores por defecto', () => {
    const p = sweepLandingDates(MID, { ...BASE, endMs: Y2027 + 5 * DAY, constraints: { maxBatteryKg: 100 } });
    assert.ok(p.battery && p.dates.every((d) => d.metrics.batteryKg !== undefined));
  });
});

describe('límites y errores del motor', () => {
  const bad: [string, Partial<LandingSweepOptions>, RegExp][] = [
    ['end antes de start', { endMs: Y2027 - DAY }, /posterior/],
    ['rango de más de 400 días', { endMs: Y2027 + 401 * DAY }, /400 días/],
    ['paso entre fechas de menos de 1 h', { dateStepMs: 30 * 60e3, stepMs: 15 * 60e3 }, /1 h/],
    ['dateStep no múltiplo de step', { dateStepMs: 5 * H, stepMs: 2 * H }, /múltiplo de step/],
    ['misión no múltiplo de step', { missionDays: 14, stepMs: 5 * H }, /múltiplo de step/],
    ['misión de más de 60 días', { missionDays: 61 }, /60/],
    ['demasiado cálculo (fechas × muestras)', { endMs: Y2027 + 400 * DAY, dateStepMs: H, missionDays: 30, stepMs: 15 * 60e3 }, /Demasiado/],
    ['restricción desconocida', { constraints: { minNothing: 1 } as never }, /Restricción desconocida/],
    ['minScore fuera de rango', { minScore: 120 }, /minScore/],
    ['top no entero', { top: 2.5 }, /top/],
  ];
  for (const [name, o, msg] of bad) {
    test(name, () => assert.throws(() => sweepLandingDates(MID, { ...BASE, ...o }), (e: unknown) => e instanceof SweepOptionError && msg.test((e as Error).message)));
  }
});

describe('caso de uso landingDates', () => {
  const custom = { id: 'custom:-65.31485,-3.05572', name: 'Coordenadas personalizadas', heightKm: 0, custom: true, ...MID };

  test('mismos resultados que el motor, con los valores por defecto (paso de 1 h)', () => {
    const r = landingDates({ site: custom, startMs: Y2027, endMs: Date.parse('2027-02-15T00:00:00Z'), dateStepMs: DAY, missionDays: 14, constraints: { minEnergy: 0.8 }, top: 3 });
    assert.equal(r.sweep.kind, 'landing-dates');
    assert.equal(r.sweep.stepMinutes, 60);
    assert.equal(r.sweep.dates.length, 46);
    assert.equal(r.sweep.best.length, 3);
    assert.deepEqual(r.sweep.constraints, { minEnergy: 0.8 });
    const engine = sweepLandingDates(custom, { ...BASE, endMs: Date.parse('2027-02-15T00:00:00Z'), constraints: { minEnergy: 0.8 }, top: 3 });
    assert.deepEqual(r.sweep.dates, engine.dates);
    assert.deepEqual(r.sweep.goodWindows, engine.goodWindows);
    // The verdict names the constraints each date misses.
    for (const d of r.sweep.dates) assert.deepEqual(r.verdicts.get(d), { meets: d.feasible, violated: d.feasible ? [] : ['minEnergy'] });
  });

  test('sitio del catálogo, panel, noche real y batería', () => {
    const r = landingDates({
      site: getSite('im1')!, startMs: Y2027, endMs: Date.parse('2027-01-20T00:00:00Z'), dateStepMs: DAY, missionDays: 10, panel: 'horizontal',
      night: { fullNight: true, battery: { ...BATTERY } }, weights: { energy: 1, comm: 0 },
    });
    assert.equal(r.sweep.panel, 'horizontal');
    assert.equal(r.sweep.weights.energy, 1);
    assert.ok(r.sweep.dates.every((d) => d.metrics.longestNightFullH !== undefined && d.metrics.batteryKg !== undefined));
    assert.match(r.sweep.note, /panel horizontal/);
  });

  test('la nota dice que la energía supone un panel que sigue al Sol', () => {
    const r = landingDates({ site: getSite('apollo11')!, startMs: Y2027, endMs: Y2027 + 2 * DAY, dateStepMs: DAY, missionDays: 14 });
    assert.match(r.sweep.note, /panel que sigue al Sol/);
  });
});
