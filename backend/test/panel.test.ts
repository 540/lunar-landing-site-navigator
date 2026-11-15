// Solar panel orientation (src/panel.ts): only changes `energy`. Without it (or with `tracking`) nothing changes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCell, normalizeWeights, rankSites, searchGrid } from '../src/search.ts';
import { sampleVectors } from '../src/service.ts';
import { siteFrame, topocentric } from '../src/ephemeris.ts';
import { visibleFraction } from '../src/visibility.ts';
import { getSite } from '../src/sites.ts';
import { PANELS, PANEL_FORMULAS, checkPanel, panelFactor, panelOption } from '../src/panel.ts';
import { resolveScenario } from '../evals/lib.ts';
import { fingerprint } from '../evals/fingerprint.ts';
import { rank, search } from '../src/useCases.ts';
import { REGIONS } from '../src/search.ts';
import type { EvaluateOptions, GridSearch, Panel, RawScenario, SiteRanking } from '../src/types.ts';

const H = 3600e3;
const DAY = 86400e3;
const base: EvaluateOptions = { mode: 'limb', stepMs: H, weights: normalizeWeights() };
const START = Date.parse('2027-01-24T00:00:00Z');
const mission = sampleVectors(START, START + 14 * DAY, H);
const RIM = getSite('shackleton-rim')!;
const MID = { lat: -65.31485, lon: -3.05572 };

describe('panelFactor (pura)', () => {
  const close = (a: number, b: number): void => assert.ok(Math.abs(a - b) < 1e-15, `${a} ≠ ${b}`);
  test('tracking vale 1 siempre', () => {
    for (const el of [-30, -0.1, 0, 0.5, 2, 45, 90]) assert.equal(panelFactor('tracking', el), 1);
  });
  test('vertical-rotating = cos(el)', () => {
    assert.equal(panelFactor('vertical-rotating', 0), 1);
    close(panelFactor('vertical-rotating', 60), 0.5);
    close(panelFactor('vertical-rotating', 30), Math.sqrt(3) / 2);
    close(panelFactor('vertical-rotating', 90), 0);
    close(panelFactor('vertical-rotating', -10), Math.cos(10 * Math.PI / 180));
  });
  test('horizontal = max(0, sen(el))', () => {
    assert.equal(panelFactor('horizontal', 0), 0);
    close(panelFactor('horizontal', 30), 0.5);
    close(panelFactor('horizontal', 90), 1);
    close(panelFactor('horizontal', 2), Math.sin(2 * Math.PI / 180)); // ≈ 0.0349: Sol rasante en el polo
    assert.equal(panelFactor('horizontal', -0.2), 0);
    assert.equal(panelFactor('horizontal', -45), 0);
  });
  test('validación y valores por defecto', () => {
    assert.deepEqual(PANELS, ['tracking', 'vertical-rotating', 'horizontal']);
    assert.deepEqual(PANEL_FORMULAS, { tracking: '1', 'vertical-rotating': 'cos(el)', horizontal: 'max(0, sen(el))' });
    for (const x of [undefined, null, '', 'tracking']) assert.equal(checkPanel(x), 'tracking');
    for (const x of ['vertical', 'Horizontal', 1, true]) assert.throws(() => checkPanel(x), /panel debe ser tracking, vertical-rotating u horizontal/);
    assert.deepEqual(panelOption('tracking'), {});
    assert.deepEqual(panelOption(undefined), {});
    assert.deepEqual(panelOption('horizontal'), { panel: 'horizontal' });
  });
});

describe('evaluateCell con panel', () => {
  test('tracking es idéntico al comportamiento anterior (media de visibleFraction, bit a bit)', () => {
    const plain = evaluateCell(MID, mission, base);
    assert.deepEqual(evaluateCell(MID, mission, { ...base, panel: 'tracking' }), plain);
    // Same computation as before the option existed: mean visible fraction of the disc, same summation order.
    const frame = siteFrame(MID);
    let sum = 0;
    for (const v of mission.vecs) sum += visibleFraction(topocentric(frame, v.sun, 'sun'), null);
    assert.equal(plain.metrics.energy, Math.round((sum / mission.vecs.length) * 1e4) / 1e4);
  });

  test('cada paso suma visibleFraction × factor, y solo cambia energy y la puntuación', () => {
    const frame = siteFrame(MID);
    const plain = evaluateCell(MID, mission, base);
    for (const panel of ['vertical-rotating', 'horizontal'] as Panel[]) {
      let sum = 0;
      for (const v of mission.vecs) {
        const sun = topocentric(frame, v.sun, 'sun');
        sum += visibleFraction(sun, null) * panelFactor(panel, sun.el);
      }
      const r = evaluateCell(MID, mission, { ...base, panel, fullNight: true, battery: { survivalLoadW: 100, whPerKg: 200, depthOfDischarge: 0.9 } });
      const ref = evaluateCell(MID, mission, { ...base, fullNight: true, battery: { survivalLoadW: 100, whPerKg: 200, depthOfDischarge: 0.9 } });
      assert.equal(r.metrics.energy, Math.round((sum / mission.vecs.length) * 1e4) / 1e4);
      assert.ok(r.metrics.energy < plain.metrics.energy);
      assert.deepEqual({ ...r.metrics, energy: 0 }, { ...ref.metrics, energy: 0 }, 'el panel no toca sunFraction, la noche, la Tierra ni la batería');
      assert.ok(r.score < ref.score);
    }
  });

  test('caso real en el polo (cresta de shackleton-rim): horizontal ≪ vertical-rotating ≈ tracking', () => {
    const e = Object.fromEntries((['tracking', 'vertical-rotating', 'horizontal'] as Panel[])
      .map((panel) => [panel, evaluateCell(RIM, mission, { ...base, panel }).metrics]));
    // Sun between ~0.2° and ~0.8°: cos(el) ≈ 1 and sin(el) ≈ 0.003–0.013.
    assert.ok(e.tracking.sunElevationRangeDeg[1] < 2);
    assert.ok(e.tracking.energy > 0.9);
    assert.ok(Math.abs(e['vertical-rotating'].energy - e.tracking.energy) < 0.001, JSON.stringify(e));
    assert.ok(e.horizontal.energy < 0.02, JSON.stringify(e));
    assert.ok(e.horizontal.energy < e['vertical-rotating'].energy / 50);
  });
});

describe('búsquedas', () => {
  const opts = { startMs: START, endMs: START + 5 * DAY, stepMs: H, mode: 'limb' as const };
  const noTiming = <T extends { timingMs: number }>(r: T): Omit<T, 'timingMs'> => ({ ...r, timingMs: undefined });

  test('rankSites y searchGrid: tracking explícito = sin panel; sin panel no hay eco', () => {
    const plain = rankSites([RIM], opts);
    assert.ok(!('panel' in plain));
    assert.deepEqual(noTiming(rankSites([RIM], { ...opts, panel: 'tracking' })), noTiming(plain));
    const region = { latMin: -90, latMax: -86, lonMin: -180, lonMax: 180 };
    const g = { ...opts, spacingKm: 80, refine: 0, refineTop: 1, top: 3 };
    const grid = searchGrid(region, g);
    assert.ok(!('panel' in grid));
    assert.deepEqual(noTiming(searchGrid(region, { ...g, panel: 'tracking' })), noTiming(grid));
  });

  test('rankSites con panel: eco y energía menor', () => {
    const plain = rankSites([RIM], opts);
    const r = rankSites([RIM], { ...opts, panel: 'horizontal' });
    assert.equal(r.panel, 'horizontal');
    assert.ok(r.top[0].metrics.energy < plain.top[0].metrics.energy / 50);
    assert.equal(r.top[0].metrics.sunFraction, plain.top[0].metrics.sunFraction);
  });
});

describe('evals: escenario `panel`', () => {
  const raw: RawScenario = { name: 'panel', points: ['shackleton-rim'], dates: ['2027-01-24'], missionDays: 2 };
  test('sin panel o con tracking: mismo escenario y mismo scenarioHash', () => {
    const plain = resolveScenario(raw);
    assert.ok(!('panel' in plain));
    const tracking = resolveScenario({ ...raw, panel: 'tracking' });
    assert.ok(!('panel' in tracking));
    assert.equal(fingerprint(tracking).scenarioHash, fingerprint(plain).scenarioHash);
  });
  test('con otro panel: se guarda y cambia el scenarioHash; inválido da error', () => {
    const s = resolveScenario({ ...raw, panel: 'vertical-rotating' });
    assert.equal(s.panel, 'vertical-rotating');
    assert.notEqual(fingerprint(s).scenarioHash, fingerprint(resolveScenario(raw)).scenarioHash);
    assert.throws(() => resolveScenario({ ...raw, panel: 'inclinado' as Panel }), /panel debe ser/);
  });
});

describe('casos de uso rank y search', () => {
  const sites = [RIM, getSite('apollo11')!];
  const q = (panel?: Exclude<Panel, 'tracking'>) => rank({ sites, startMs: START, days: 5, ...(panel ? { panel } : {}) }).ranking;

  test('sin panel no hay eco', () => {
    assert.ok(!('panel' in q()));
  });

  test('panel=horizontal y vertical-rotating en el ranking y en la malla', () => {
    assert.equal(q('horizontal').panel, 'horizontal');
    const grid = search({ region: REGIONS['polo-sur'], startMs: START, days: 5, spacingKm: 80, refine: 0, panel: 'vertical-rotating' }).grid;
    assert.equal(grid.panel, 'vertical-rotating');
  });

  test('panel inválido: error con mensaje en español', () => {
    assert.throws(() => q('inclinado' as 'horizontal'), /panel debe ser tracking, vertical-rotating u horizontal/);
  });
});
