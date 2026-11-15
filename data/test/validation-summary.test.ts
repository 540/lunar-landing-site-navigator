// The summary the web shows in «Cómo sabemos que es correcto» (web/assets/validation-summary.json) must be the one
// validation-summary.ts computes: no figure typed by hand and none left behind by a change in the engine or the
// fixtures. The rises and sets are left out here (the whole campaign takes ~30 s of CPU per core): for those,
// `npm run validation-summary -- --check`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { directionSummary, knownDiscrepancies, pgdaSummary, SUMMARY_URL, VALIDATION_URL } from './validation-summary.ts';

const saved = JSON.parse(readFileSync(SUMMARY_URL, 'utf8'));
const REGENERATE = 'regenéralo con `cd data && npm run validation-summary -- --write`';

test('el resumen de validación de la web coincide con los fixtures de PGDA', () => {
  assert.deepEqual(saved.pgda, pgdaSummary(), REGENERATE);
});

test('el resumen de validación de la web coincide con la dirección medida hoy frente a Horizons', () => {
  assert.deepEqual(saved.horizons.direction, directionSummary(), REGENERATE);
});

test('el resumen de validación de la web lleva los ortos y ocasos de todos los sitios de la referencia', () => {
  const groups = saved.horizons.events.groups as { body: string; sites: string[]; events: number; missing: number; extra: number }[];
  assert.equal(groups.filter((g) => g.body === 'sun').reduce((n, g) => n + g.sites.length, 0), 15);
  assert.ok(groups.some((g) => g.events > 0));
});

test('el resumen de validación de la web lleva todas las filas ⚠️ de VALIDATION.md, cada una con su issue', () => {
  // Read here without the parser of validation-summary.ts: a ⚠️ row it skipped would not show up in the comparison below.
  const warned = readFileSync(VALIDATION_URL, 'utf8').split('\n').filter((l) => /\|\s*⚠️[^|]*\|\s*$/.test(l));
  const rows = saved.knownDiscrepancies as { what: string; issue: number }[];
  assert.ok(warned.length > 0, 'VALIDATION.md no tiene filas ⚠️: si ya no hay discrepancias, quita este test');
  for (const line of warned) {
    const issue = Number(line.match(/⚠️ #(\d+)/)?.[1]);
    const row = rows.find((r) => line.startsWith(`| ${r.what} (`) && r.issue === issue);
    assert.ok(row, `falta en el resumen la fila ⚠️ de VALIDATION.md «${line.slice(2, 90)}…» (#${issue}): ${REGENERATE}`);
  }
  assert.equal(rows.length, warned.length, `el resumen lleva filas ⚠️ que VALIDATION.md ya no tiene: ${REGENERATE}`);
  assert.deepEqual(rows, knownDiscrepancies(), REGENERATE);
});

// The parser of the ⚠️ rows fails on a row it does not know how to read instead of skipping it: a row left out
// would vanish from the view without anyone noticing. Inline rows, with the shape of the ones of VALIDATION.md.
const REF = '[PGDA AVGVISIB_85S_060M_201608](http://imbrium.mit.edu/x.IMG) (V1.05, 60 m)';
const ISSUE = '⚠️ #85';
const warnedRow = (what: string, status = ISSUE): string =>
  `| ${what} | ${REF} | 49 | 2,47 | 2,69 | 7,50 | 31,2 % | 47,28 | 75,5 % | ±2 pp por punto; RMS ≤ 7,6 | ${status} |`;
const PGDA_ROW = 'Fracción de tiempo con Sol, panel a 2 m, 18,6 años desde 2010-01-01; 49 puntos al sur de 85°S';

test('las filas ⚠️ de VALIDATION.md se leen con su sujeto, su lugar y su nota', () => {
  const [pgda, s2] = knownDiscrepancies([
    warnedRow(`${PGDA_ROW} (el producto de 60 m difiere del de 240 m 6,3 pp RMS) (pp)`),
    warnedRow('Sombra continua más larga en S2 (−89,7815°, −155,30°), observador a 2 m, 2017–2037 (la fracción con Sol solo se desvía −2,6 pp) (h)'),
    warnedRow(`${PGDA_ROW} (pp)`, '✅'),
  ].join('\n'));
  assert.equal(pgda.subject, 'panel');
  assert.deepEqual(pgda.where, { southOfDeg: 85 });
  assert.deepEqual(pgda.note, { kind: 'productGap', resolutionM: 60, otherResolutionM: 240, rms: 6.3 });
  assert.equal(s2.subject, 'observer');
  assert.equal(s2.unit, 'h');
  assert.deepEqual(s2.where, { sites: ['S2'], lat: -89.7815, lon: -155.3 });
  assert.deepEqual(s2.period, { from: '2017', to: '2037' });
  assert.deepEqual(s2.note, { kind: 'sunFraction', bias: -2.6 });
});

test('las filas #86 conservan en el resumen el rango a ±10 m que VALIDATION.md escribe en la celda de estado', () => {
  const status = '⚠️ #86 (a ±10 m el % con Sol va de 41,0 a 84,6 %)';
  const [row] = knownDiscrepancies(warnedRow('% del tiempo con Sol, observador a 0 m, en la coordenada publicada, 2017–2037; C1, C2 y S (pp)', status));
  assert.deepEqual(row.note, { kind: 'nearGround', radiusM: 10, minPercent: 41, maxPercent: 84.6 });
  const saved86 = (saved.knownDiscrepancies as { issue: number; note?: { kind: string } }[]).filter((r) => r.issue === 86);
  assert.ok(saved86.length > 0 && saved86.every((r) => r.note?.kind === 'nearGround'), 'las filas #86 del resumen pierden su nota: ' + REGENERATE);
});

test('una barra escapada (\\|) dentro de una celda no parte la fila', () => {
  const [row] = knownDiscrepancies(warnedRow('Iluminación media \\| disco visible, observador a 0 m, 2017–2037; C1, C2 y S (pp)'));
  assert.equal(row.metric, 'meanIllumination');
  assert.deepEqual(row.where, { sites: ['C1', 'C2', 'S'] });
  assert.equal(row.issue, 85);
  assert.equal(row.rms, 7.5);
});

test('una fila ⚠️ que el lector no sabe leer hace fallar el resumen, no se salta', () => {
  const cases: [string, string, RegExp][] = [
    ['sin unidad', warnedRow(PGDA_ROW), /la unidad/],
    ['métrica desconocida', warnedRow(PGDA_ROW.replace('Fracción de tiempo con Sol', 'Temperatura media') + ' (pp)'), /la métrica/],
    ['sin issue', warnedRow(`${PGDA_ROW} (pp)`, '⚠️ pendiente'), /la issue/],
    ['sitios con barra', warnedRow('% del tiempo con Sol, observador a 0 m, 2017–2037; S1/S2 (pp)'), /el lugar/],
    ['nota desconocida', warnedRow(`${PGDA_ROW} (valores leídos a mano) (pp)`), /la nota/],
    ['frase desconocida tras los sitios', warnedRow('% del tiempo con Sol, observador a 0 m, 2017–2037; C1, C2 y S. Medido a mano (pp)'), /la nota/],
  ];
  for (const [name, line, error] of cases) assert.throws(() => knownDiscrepancies(line), error, name);
});
