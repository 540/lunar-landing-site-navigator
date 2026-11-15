// Deep polar uncertainty (issue #437): south of 85°S, the use cases that return time fractions or windows with terrain
// warn `deep_polar_uncertainty`; north of it, or without terrain, they do not. The figures of the message are the 2 m
// rows of VALIDATION.md (the saved measurement against the 60 m PGDA products): this test reads them back from there.
// Under `node --test` there is no DEM: the catalogue masks (backend/terrain/masks) give the terrain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEEP_POLAR, isDeepPolar, landingDates, rank, visibilityWindows } from '../src/useCases.ts';
import type { DomainWarningCode, WarningSink } from '../src/useCases.ts';
import { SITES } from '../src/sites.ts';
import { loadCatalogMasks } from '../src/horizon.ts';

loadCatalogMasks(fileURLToPath(new URL('../terrain', import.meta.url)));

const DAY = 86400e3;
const START = Date.parse('2027-01-01T00:00:00Z');
const site = (id: string) => SITES.find((s) => s.id === id)!;
const TERRAIN = { observerHeightM: 2 };

function sink(): WarningSink & { list: { code: DomainWarningCode; message: string }[] } {
  const list: { code: DomainWarningCode; message: string }[] = [];
  return { list, warn: (code, message) => { list.push({ code, message }); } };
}
const deep = (s: ReturnType<typeof sink>) => s.list.filter((x) => x.code === 'deep_polar_uncertainty');

test('el umbral es 85°S: la cresta de Shackleton queda dentro e IM-2 (84,8°S) fuera', () => {
  assert.equal(isDeepPolar(site('shackleton-rim')), true);
  assert.equal(isDeepPolar(site('im2-objetivo')), false);
  assert.equal(isDeepPolar({ lat: -85, lon: 0 }), false);
});

test('las cifras del mensaje son las de VALIDATION.md (filas de 85°S a 2 m)', () => {
  const md = readFileSync(new URL('../../VALIDATION.md', import.meta.url), 'utf8');
  const row = (what: RegExp): { rms: number; max: number } => {
    const line = md.split('\n').find((l) => what.test(l));
    assert.ok(line, `VALIDATION.md no tiene la fila ${what}`);
    const cells = line.split(' | ').map((c) => c.trim());
    const num = (c: string): number => Number(c.replace('−', '-').replace(',', '.'));
    // | qué | referencia | n | sesgo | MAE | RMS | % ref | Máx | …
    return { rms: num(cells[5]), max: num(cells[7]) };
  };
  const sun = row(/Fracción de tiempo con Sol, panel a 2 m, .*al sur de 85°S/);
  const earth = row(/Fracción de tiempo con la Tierra, antena a 2 m, .*al sur de 85°S/);
  const m = DEEP_POLAR.measured;
  assert.deepEqual({ sunRmsPp: sun.rms, sunMaxPp: sun.max, earthRmsPp: earth.rms, earthMaxPp: earth.max }, m,
    'VALIDATION.md ha cambiado: actualiza DEEP_POLAR.measured en backend/src/useCases.ts');
});

test('windows con relieve avisa en la cresta de Shackleton, no en IM-2 ni sin relieve', () => {
  const run = (id: string, terrain: typeof TERRAIN | null) => {
    const s = sink();
    visibilityWindows({ site: site(id), terrain, startMs: START, endMs: START + 5 * DAY }, s);
    return deep(s);
  };
  const shackleton = run('shackleton-rim', TERRAIN);
  assert.equal(shackleton.length, 1);
  assert.match(shackleton[0].message, /^Al sur de 85°S .* hasta 47 pp con el Sol y 33 pp con la Tierra .*VALIDATION\.md/);
  assert.deepEqual(run('im2-objetivo', TERRAIN), []);
  assert.deepEqual(run('shackleton-rim', null), []);
});

test('rank con relieve nombra los sitios al sur de 85°S; sin relieve, ninguno', () => {
  const run = (terrain: typeof TERRAIN | null) => {
    const s = sink();
    rank({ sites: [site('shackleton-rim'), site('im2-objetivo')], startMs: START, days: 2, terrain }, s);
    return deep(s);
  };
  const withTerrain = run(TERRAIN);
  assert.equal(withTerrain.length, 1);
  assert.match(withTerrain[0].message, /^shackleton-rim: Al sur de 85°S/);
  assert.deepEqual(run(null), []);
});

test('landing-dates con relieve avisa en la cresta de Shackleton, no en IM-2', () => {
  const run = (id: string) => {
    const s = sink();
    landingDates({ site: site(id), terrain: TERRAIN, startMs: START, endMs: START + 2 * DAY, dateStepMs: DAY, missionDays: 2 }, s);
    return deep(s).length;
  };
  assert.equal(run('shackleton-rim'), 1);
  assert.equal(run('im2-objetivo'), 0);
});
