// Night (threshold and full night) and battery: src/night.ts, evaluateCell, the use cases and evals. All optional.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCell, normalizeWeights, rankSites } from '../src/search.ts';
import { sampleVectors, windows } from '../src/service.ts';
import { registerMask } from '../src/horizon.ts';
import { BATTERY_DEFAULTS, NIGHT_EXTENSION_LIMIT_DAYS, batteryFor, checkNightMinSunFraction, fullNightSamples, resolveBattery } from '../src/night.ts';
import { configureDem, demVersion } from '../src/terrain/dem.ts';
import { buildMask } from '../src/terrain/horizonMask.ts';
import { checkConstraints, evaluateCandidate, prepareSamples, resolveScenario } from '../evals/lib.ts';
import { fingerprint } from '../evals/fingerprint.ts';
import { rank, search, visibilityWindows } from '../src/useCases.ts';
import { REGIONS } from '../src/search.ts';
import { getSite } from '../src/sites.ts';
import type { EvaluateOptions, RawScenario } from '../src/types.ts';

const H = 3600e3;
const DAY = 86400e3;
const weights = normalizeWeights();
const base: EvaluateOptions = { mode: 'limb', stepMs: H, weights };
// Mid-latitude point of a previous search: 14-day mission from 2027-01-24 ends in the dark (night of ~350 h).
const MID = { lat: -65.31485, lon: -3.05572 };
const MID_START = Date.parse('2027-01-24T00:00:00Z');
const mission = sampleVectors(MID_START, MID_START + 14 * DAY, H);

describe('fullNightSamples (pura)', () => {
  const never = (): number => { throw new Error('no debería extender'); };
  test('sin noche en los extremos no se extiende', () => assert.equal(fullNightSamples(10, 3, 0, 0, never), 3));
  test('la noche del final se alarga hacia delante', () => assert.equal(fullNightSamples(10, 4, 0, 4, (d) => (d === 1 ? 6 : NaN)), 10));
  test('la noche del principio se alarga hacia atrás', () => assert.equal(fullNightSamples(10, 2, 2, 0, (d) => (d === -1 ? 9 : NaN)), 11));
  test('una noche interior más larga gana a las de los extremos', () => assert.equal(fullNightSamples(20, 8, 1, 1, () => 2), 8));
  test('todo el periodo a oscuras es una sola noche', () => assert.equal(fullNightSamples(10, 10, 10, 10, (d) => (d === -1 ? 3 : 5)), 18));
});

describe('noche real en evaluateCell', () => {
  test('sintético: horizonte a 89° (nunca hay Sol) → periodo + el límite de búsqueda por cada lado', () => {
    registerMask('night-test-wall', { stepDeg: 90, el: [89, 89, 89, 89], source: 'pared sintética' });
    const short = sampleVectors(MID_START, MID_START + 2 * DAY, H);
    const r = evaluateCell({ id: 'night-test-wall', name: 'pared', ...MID }, short, { ...base, fullNight: true });
    assert.equal(r.metrics.longestNightH, short.t.length);
    assert.equal(r.metrics.longestNightFullH, short.t.length + 2 * NIGHT_EXTENSION_LIMIT_DAYS * 24);
  });

  test('sintético: horizonte a −89° (siempre hay Sol) → sin noche', () => {
    registerMask('night-test-pit', { stepDeg: 90, el: [-89, -89, -89, -89], source: 'sima sintética' });
    const r = evaluateCell({ id: 'night-test-pit', name: 'sima', lat: -89.9, lon: 0 }, mission, { ...base, fullNight: true });
    assert.equal(r.metrics.longestNightH, 0);
    assert.equal(r.metrics.longestNightFullH, 0);
  });

  test('caso real (Luna esférica): la misión acaba de noche; recortada < 200 h, entera ≈ 349–369 h', () => {
    const plain = evaluateCell(MID, mission, base);
    const full = evaluateCell(MID, mission, { ...base, fullNight: true });
    assert.ok(plain.metrics.longestNightH < 200, `${plain.metrics.longestNightH} h`);
    assert.ok(full.metrics.longestNightFullH! >= 349 && full.metrics.longestNightFullH! <= 369, `${full.metrics.longestNightFullH} h`);
    // longestNightH and everything else stay the same: only the new metric is added.
    const { longestNightFullH, ...rest } = full.metrics;
    assert.deepEqual({ ...full, metrics: rest }, plain);
  });

  const DEM_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'terrain');
  const hasDem = fs.existsSync(path.join(DEM_DIR, 'cache')) && fs.readdirSync(path.join(DEM_DIR, 'cache')).some((f) => f.endsWith('.f32'));
  test('caso real con relieve LOLA a 2 m (solo con el DEM en caché): 349–369 h', { skip: !hasDem && 'sin DEM en terrain/cache' }, () => {
    configureDem({ dir: DEM_DIR });
    try {
      assert.ok(demVersion());
      const mask = buildMask(MID.lat, MID.lon, { observerHeightM: 2, resolution: 'precise' }); // in memory, no disk cache
      registerMask('night-test-mid', mask!);
      const r = evaluateCell({ id: 'night-test-mid', name: 'mid', ...MID }, sampleVectors(Date.parse('2027-02-07T00:00:00Z'), Date.parse('2027-02-21T00:00:00Z'), H), { ...base, fullNight: true });
      assert.ok(r.metrics.longestNightH < 200, `${r.metrics.longestNightH} h`);
      assert.ok(r.metrics.longestNightFullH! >= 349 && r.metrics.longestNightFullH! <= 369, `${r.metrics.longestNightFullH} h`);
    } finally {
      configureDem({ grids: [] });
    }
  });

  test('windows(): la noche real coincide con la de evaluateCell a la misma resolución', () => {
    const w = windows({ id: 'mid', name: 'mid', ...MID }, MID_START, MID_START + 14 * DAY, { stepMs: H, mask: null, night: { fullNight: true } });
    const e = evaluateCell(MID, mission, { ...base, fullNight: true });
    assert.equal(w.night!.longestNightHours, e.metrics.longestNightH);
    assert.equal(w.night!.longestNightFullHours, e.metrics.longestNightFullH);
    assert.equal(w.night!.extensionLimitDays, NIGHT_EXTENSION_LIMIT_DAYS);
  });
});

describe('umbral de Sol para la noche (nightMinSunFraction)', () => {
  const polar = { lat: -89.45, lon: -137 }; // grazing Sun: partial discs for days
  const sampled = sampleVectors(Date.parse('2027-02-01T00:00:00Z'), Date.parse('2027-03-15T00:00:00Z'), H);

  test('0 da exactamente lo mismo que sin el parámetro', () => {
    for (const cell of [polar, MID]) {
      for (const smp of [sampled, mission]) assert.deepEqual(evaluateCell(cell, smp, { ...base, nightMinSunFraction: 0 }), evaluateCell(cell, smp, base));
    }
  });

  test('0,5 equivale a mode=center y 1 a mode=full (solo en la noche)', () => {
    const center = evaluateCell(polar, sampled, { ...base, mode: 'center' });
    const full = evaluateCell(polar, sampled, { ...base, mode: 'full' });
    assert.equal(evaluateCell(polar, sampled, { ...base, nightMinSunFraction: 0.5 }).metrics.longestNightH, center.metrics.longestNightH);
    assert.equal(evaluateCell(polar, sampled, { ...base, nightMinSunFraction: 1 }).metrics.longestNightH, full.metrics.longestNightH);
  });

  test('un umbral mayor alarga (o deja igual) la noche y no toca el resto de métricas', () => {
    const limb = evaluateCell(polar, sampled, base);
    const strict = evaluateCell(polar, sampled, { ...base, nightMinSunFraction: 0.9 });
    assert.ok(strict.metrics.longestNightH > limb.metrics.longestNightH, `${strict.metrics.longestNightH} > ${limb.metrics.longestNightH}`);
    const { longestNightH: _a, ...a } = strict.metrics;
    const { longestNightH: _b, ...b } = limb.metrics;
    assert.deepEqual(a, b);
  });

  test('validación', () => {
    assert.equal(checkNightMinSunFraction(undefined), 0);
    for (const bad of [-0.1, 1.1, Number.NaN, '0.5']) assert.throws(() => checkNightMinSunFraction(bad), /nightMinSunFraction debe ser un número entre 0 y 1/);
  });
});

describe('batería', () => {
  test('aritmética exacta con los valores por defecto (100 W, 200 Wh/kg, DoD 0,9)', () => {
    assert.deepEqual(BATTERY_DEFAULTS, { survivalLoadW: 100, whPerKg: 200, depthOfDischarge: 0.9 });
    assert.deepEqual(batteryFor(360, BATTERY_DEFAULTS), { kWh: 36, kg: 200 }); // 36 000 Wh / 180 Wh/kg
    assert.deepEqual(batteryFor(182, BATTERY_DEFAULTS), { kWh: 18.2, kg: 101.11 }); // 18 200 / 180 = 101.111…
    assert.deepEqual(batteryFor(0, BATTERY_DEFAULTS), { kWh: 0, kg: 0 });
    assert.deepEqual(batteryFor(100, { survivalLoadW: 50, whPerKg: 150, depthOfDischarge: 0.8 }), { kWh: 5, kg: 41.67 }); // 5000 / 120
  });

  test('evaluateCell: con la noche real si está activada y, si no, con longestNightH', () => {
    const b = { ...BATTERY_DEFAULTS };
    const plain = evaluateCell(MID, mission, { ...base, battery: b });
    assert.deepEqual([plain.metrics.batteryKWh, plain.metrics.batteryKg], Object.values(batteryFor(plain.metrics.longestNightH, b)));
    const full = evaluateCell(MID, mission, { ...base, battery: b, fullNight: true });
    assert.deepEqual([full.metrics.batteryKWh, full.metrics.batteryKg], Object.values(batteryFor(full.metrics.longestNightFullH!, b)));
    assert.ok(full.metrics.batteryKg! > plain.metrics.batteryKg!);
  });

  test('resolveBattery: true = valores por defecto; valida campos y rangos', () => {
    assert.equal(resolveBattery(undefined), null);
    assert.equal(resolveBattery(false), null);
    assert.deepEqual(resolveBattery(true), BATTERY_DEFAULTS);
    assert.deepEqual(resolveBattery({ survivalLoadW: 40 }), { ...BATTERY_DEFAULTS, survivalLoadW: 40 });
    assert.throws(() => resolveBattery({ depthOfDischarge: 0 }), /battery.depthOfDischarge debe ser un número entre 0.05 y 1/);
    assert.throws(() => resolveBattery({ whPerKg: 5000 }), /battery.whPerKg/);
    assert.throws(() => resolveBattery({ volts: 28 } as never), /campo desconocido volts/);
    assert.throws(() => resolveBattery(7 as never), /battery debe ser true o un objeto/);
  });
});

describe('rankSites y evals', () => {
  test('rankSites: sin opciones no hay campos nuevos; con ellas, las métricas y el eco', () => {
    const o = { startMs: MID_START, endMs: MID_START + 14 * DAY, stepMs: H, mode: 'limb' as const };
    const sites = [{ id: 'mid', name: 'mid', ...MID }];
    const plain = rankSites(sites, o);
    assert.ok(!('night' in plain) && !('battery' in plain) && !('longestNightFullH' in plain.top[0].metrics));
    const same = rankSites(sites, { ...o, nightMinSunFraction: 0, fullNight: false, battery: null });
    assert.deepEqual({ ...same, timingMs: 0 }, { ...plain, timingMs: 0 });
    const r = rankSites(sites, { ...o, fullNight: true, battery: BATTERY_DEFAULTS });
    assert.deepEqual(r.night, { minSunFraction: 0, fullNight: true, extensionLimitDays: NIGHT_EXTENSION_LIMIT_DAYS });
    assert.deepEqual(r.battery, BATTERY_DEFAULTS);
    assert.ok(r.top[0].metrics.longestNightFullH! >= 349);
    assert.throws(() => rankSites(sites, { ...o, nightMinSunFraction: 3 }), /nightMinSunFraction/);
  });

  const SC: RawScenario = { name: 'noche', points: [MID], dates: ['2027-01-24'], missionDays: 14 };

  test('escenario: 0 / false / sin batería no cambian el scenarioHash; activados, sí y se guardan', () => {
    const hash = (raw: RawScenario): string => fingerprint(resolveScenario(raw)).scenarioHash;
    const h0 = hash(SC);
    assert.equal(hash({ ...SC, nightMinSunFraction: 0, fullNight: false, battery: null }), h0);
    const s = resolveScenario({ ...SC, nightMinSunFraction: 0.2, fullNight: true, battery: { survivalLoadW: 60 } });
    assert.equal(s.nightMinSunFraction, 0.2);
    assert.equal(s.fullNight, true);
    assert.deepEqual(s.battery, { ...BATTERY_DEFAULTS, survivalLoadW: 60 });
    assert.notEqual(fingerprint(s).scenarioHash, h0);
    assert.throws(() => resolveScenario({ ...SC, nightMinSunFraction: 2 }), /nightMinSunFraction/);
    assert.throws(() => resolveScenario({ ...SC, fullNight: 'si' as never }), /fullNight debe ser true o false/);
  });

  test('maxBatteryKg: activa la batería por defecto y se cumple o no según la noche', () => {
    const s = resolveScenario({ ...SC, fullNight: true, constraints: { maxBatteryKg: 150 } });
    assert.deepEqual(s.battery, BATTERY_DEFAULTS);
    const ev = evaluateCandidate(MID, s, prepareSamples(s));
    assert.ok(ev.metrics.batteryKg! > 150 && ev.metrics.longestNightFullH! >= 349);
    assert.equal(ev.feasible, false);
    assert.match(ev.violations[0], /batteryKg=\d+(\.\d+)? \(<= 150\)/);
    const ok = resolveScenario({ ...SC, fullNight: true, constraints: { maxBatteryKg: 250 } });
    assert.equal(evaluateCandidate(MID, ok, prepareSamples(ok)).feasible, true);
    // A missing metric counts as a violation (it can only happen if called by hand without battery).
    assert.equal(checkConstraints({ energy: 1, sunFraction: 1, earthFraction: 1, bothFraction: 1, longestNightH: 0, longestNoEarthH: 0, longestBothH: 0 }, { maxBatteryKg: 10 }).length, 1);
  });
});

describe('casos de uso', () => {
  const mid = { id: 'custom:-65.31485,-3.05572', name: 'p', custom: true, ...MID };
  test('visibilityWindows: night solo si se pide', () => {
    const q = { site: mid, startMs: MID_START, endMs: MID_START + 14 * DAY };
    assert.ok(!('night' in visibilityWindows(q).windows));
    const r = visibilityWindows({ ...q, night: { fullNight: true, battery: { ...BATTERY_DEFAULTS } } }).windows;
    assert.equal(r.night!.longestNightFullHours, 351.25);
    assert.equal(r.night!.battery!.kWh, 35.125);
  });

  test('search y rank: métricas nuevas en la malla y en el ranking', () => {
    const startMs = Date.parse('2027-01-01T00:00:00Z');
    const grid = search({ region: REGIONS['polo-sur'], startMs, days: 5, spacingKm: 80, refine: 0, night: { fullNight: true, battery: { ...BATTERY_DEFAULTS, survivalLoadW: 80 } } }).grid;
    assert.ok(grid.top.every((c) => c.metrics.longestNightFullH !== undefined && c.metrics.batteryKg !== undefined));
    assert.deepEqual(grid.battery, { ...BATTERY_DEFAULTS, survivalLoadW: 80 });
    const sites = rank({ sites: [getSite('apollo11')!], startMs, days: 5, night: { nightMinSunFraction: 0.5 } }).ranking;
    assert.deepEqual(sites.night, { minSunFraction: 0.5, fullNight: false });
  });
});
