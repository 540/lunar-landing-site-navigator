// Accuracy report of the calculation engine against JPL Horizons: the whole campaign, not the slice `npm test` runs.
//
//   npm run accuracy              prints the report; exits with an error if a budget is exceeded
//   npm run accuracy -- --write   also saves it as ACCURACY.md, so the diff of a change shows what it moved
//
// Direction: every point of fixtures/horizons.json. Rises and sets: every catalogue site, visibility mode and year
// of fixtures/horizons-events.json, one worker per site (~30 s on a laptop).
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { BUDGET_DEG, compareEvents, directionErrors, directionReference, eventsReference, percentile } from './accuracy.ts';
import type { EventsComparison } from './accuracy.ts';
import type { Body, Mode, PerBody } from '../../backend/src/types.ts';

const MODES: Mode[] = ['limb', 'center', 'full'];
const BODY_NAMES: Record<Body, string> = { sun: 'Sol', earth: 'Tierra' };

if (!isMainThread) {
  const { siteId } = workerData as { siteId: string };
  const [startMs, endMs] = [Date.parse(eventsReference.start), Date.parse(eventsReference.end)];
  parentPort!.postMessage(Object.fromEntries(MODES.map((mode) => [mode, compareEvents(siteId, mode, startMs, endMs)])));
} else {
  const sites = eventsReference.sites.map((s) => s.id);
  const queue = [...sites];
  const bySite: Record<string, Record<Mode, PerBody<EventsComparison>>> = {};
  const runNext = async () => {
    for (let siteId = queue.shift(); siteId; siteId = queue.shift()) {
      bySite[siteId] = await new Promise((resolve, reject) => {
        new Worker(new URL(import.meta.url), { workerData: { siteId } }).once('message', resolve).once('error', reject);
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), sites.length) }, runNext));

  const failures = [];
  const deg = (x: number): string => x.toFixed(4).replace('.', ',');
  const duration = (seconds: number): string => (seconds < 90 ? `${seconds.toFixed(0)} s` : `${(seconds / 60).toFixed(1).replace('.', ',')} min`);
  const lines = [
    '# Precisión del motor de cálculo frente a JPL Horizons',
    '',
    'Generado con `npm run accuracy -- --write`; no se edita a mano. Regenerarlo en el mismo commit que cambie el',
    'cálculo: el diff de este fichero dice si el cambio mejora o empeora la precisión.',
    '',
    `Referencia: JPL Horizons (DE441, marco MEAN_ME, esfera de 1737,4 km, sin refracción), 2026–2030.`,
    `Presupuesto: ${deg(BUDGET_DEG.max)}° de máximo y ${deg(BUDGET_DEG.rms)}° de media cuadrática.`,
    '',
    '## Dirección',
    '',
    'Separación angular entre la posición calculada y la de Horizons. El máximo cuenta también el error de',
    'elevación por separado.',
    '',
    '| Sitio de referencia | Cuerpo | Puntos | Máximo (°) | Percentil 99 (°) | Media cuadrática (°) |',
    '|---|---|---:|---:|---:|---:|',
  ];
  for (const series of directionReference.series) {
    const e = directionErrors(series);
    lines.push(`| ${series.site} | ${BODY_NAMES[series.body]} | ${e.points} | ${deg(e.maxDeg)} | ${deg(e.p99Deg)} | ${deg(e.rmsDeg)} |`);
    if (e.maxDeg > BUDGET_DEG.max || e.rmsDeg > BUDGET_DEG.rms) failures.push(`dirección ${series.site}/${series.body}`);
  }

  lines.push(
    '',
    '## Ortos y ocasos',
    '',
    'Instante de cada orto y ocaso frente al de Horizons, juntando los tres modos (`limb`, `center` y `full`).',
    'El error en tiempo es el error de dirección dividido por la velocidad con que el astro cruza el horizonte:',
    'por eso crece hacia los polos. El «equivalente» es ese error en tiempo multiplicado por la velocidad de',
    'elevación, y es lo que se compara con el presupuesto. Sin fila: el astro no sale ni se pone en ese sitio.',
    '',
    '| Sitio | Cuerpo | Eventos | Faltan | Sobran | Error mediano | Percentil 99 | Máximo | Equivalente máx. (°) | Horas visibles: cálculo − Horizons |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const siteId of sites) {
    for (const body of Object.keys(BODY_NAMES) as Body[]) {
      const perMode = MODES.map((mode) => bySite[siteId][mode][body]);
      const pairs = perMode.flatMap((m) => m.pairs);
      const missing = perMode.reduce((n, m) => n + m.missing.length, 0), extra = perMode.reduce((n, m) => n + m.extra.length, 0);
      const hoursOff = perMode.map((m) => m.visibleHours.computed - m.visibleHours.reference);
      const worstHours = hoursOff.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
      if (perMode.some((m) => Math.abs(m.visibleHours.computed - m.visibleHours.reference) > m.visibleHours.toleranceHours)) failures.push(`horas visibles ${siteId}/${body}`);
      if (missing + extra > 0) failures.push(`eventos sin pareja ${siteId}/${body}`);
      if (pairs.length === 0) continue;
      const seconds = pairs.map((p) => Math.abs(p.errorSeconds)).sort((a, b) => a - b);
      const equivalent = Math.max(...pairs.map((p) => p.equivalentDeg));
      if (equivalent > BUDGET_DEG.max) failures.push(`ortos y ocasos ${siteId}/${body}`);
      lines.push(`| ${siteId} | ${BODY_NAMES[body]} | ${pairs.length} | ${missing} | ${extra} | ${duration(percentile(seconds, 0.5))} | ${duration(percentile(seconds, 0.99))} | ${duration(seconds.at(-1)!)} | ${deg(equivalent)} | ${worstHours.toFixed(2).replace('.', ',')} h |`);
    }
  }
  lines.push('', failures.length ? `**Fuera de presupuesto:** ${failures.join('; ')}.` : 'Todo dentro del presupuesto.', '');

  const report = lines.join('\n');
  console.log(report);
  if (process.argv.includes('--write')) writeFileSync(new URL('../ACCURACY.md', import.meta.url), report);
  if (failures.length) process.exitCode = 1;
}
