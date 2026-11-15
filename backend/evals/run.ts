#!/usr/bin/env node
// Runs an evals scenario and stores the run in evals/runs/<date>_<scenario>/.
//
// Each run is also stored in the evals/evals.db database (disable with --no-db, change with --db <file>).
//
// Usage:
//   node evals/run.ts evals/scenarios/polo-sur-2027.json
//   node evals/run.ts evals/scenarios/polo-sur-2027.json --set weights.energy=0.6 --set constraints.maxLongestNightH=48
//   node evals/run.ts <scenario> --label "pesos-energia" --out /other/folder --quiet
//
// Output per run:
//   scenario.json     resolved scenario (with defaults and normalized weights)
//   iterations.jsonl  one line per optimizer iteration
//   summary.json      best position, top, baselines, warnings, code version
//   report.md         human-readable report
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundaryWarning, evaluateBaselines, evaluatePoints, optimize, prepareSamples, resolveScenario } from './lib.ts';
import { distanceKm, heightsText, redundancyWarnings } from '../src/search.ts';
import { fastModeWarning, refineText } from '../src/horizon.ts';
import { DEFAULT_DB, openDb, row, saveRun } from './db.ts';
import { expectedNode, fingerprint, resultHash } from './fingerprint.ts';
import type { CountRow, IterationRecord, LatLon, RawScenario, RunSummary, Scenario, TopCandidate } from '../src/types.ts';

interface RunArgs { sets: string[]; quiet: boolean; db: string | null; out?: string; label?: string; scenario?: string }

const HERE = path.dirname(fileURLToPath(import.meta.url));

const USAGE = 'Uso: node evals/run.ts <escenario.json> [--set ruta=valor]… [--label texto] [--out dir] [--quiet] [--db fichero | --no-db]';

function parseArgs(argv: string[]): RunArgs & { scenario: string } {
  const a: RunArgs = { sets: [], quiet: false, db: DEFAULT_DB };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--set') a.sets.push(argv[++i]);
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--label') a.label = argv[++i];
    else if (x === '--quiet') a.quiet = true;
    else if (x === '--db') a.db = argv[++i];
    else if (x === '--no-db') a.db = null;
    else if (!a.scenario) a.scenario = x;
    else throw new Error(`Argumento inesperado: ${x}`);
  }
  if (!a.scenario) throw new Error('Uso: node evals/run.ts <escenario.json> [--set ruta=valor]… [--label texto] [--out dir] [--quiet]');
  return { ...a, scenario: a.scenario };
}

/** Reads a scenario JSON. Not validated here: resolveScenario validates (and completes) it. */
export function readScenario(file: string): RawScenario {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RawScenario;
}

/** --set a.b.c=value (the value is parsed as JSON when possible: numbers, arrays, booleans). */
function applySet(obj: object, expr: string): void {
  const eq = expr.indexOf('=');
  if (eq < 1) throw new Error(`--set mal formado: ${expr}`);
  const keys = expr.slice(0, eq).split('.');
  const text = expr.slice(eq + 1);
  let value: unknown = text;
  try { value = JSON.parse(text); } catch { /* stays as text */ }
  // Free path through the scenario: intermediate objects are created as needed.
  let o = obj as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
  o[keys.at(-1)!] = value;
}

function codeVersion(): string {
  try {
    const rev = execSync('git rev-parse --short HEAD', { cwd: HERE, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain -- .', { cwd: path.join(HERE, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `${rev}${dirty ? '+cambios' : ''}`;
  } catch { return 'sin-git'; }
}

const pct = (x: number): string => `${(100 * x).toFixed(1)} %`;
const fmtCand = (c: LatLon & { name?: string }): string => `${c.name && !c.name.startsWith('(') ? `${c.name} ` : ''}(${c.lat.toFixed(4)}, ${c.lon.toFixed(4)})`;

function report(summary: RunSummary, iterations: readonly IterationRecord[]): string {
  const s = summary.scenario;
  const b = summary.best;
  const lines = [
    `# Eval: ${s.name}${summary.label ? ` · ${summary.label}` : ''}`,
    '',
    s.description ? `${s.description}\n` : '',
    `- Ejecución: ${summary.runId} · código ${summary.codeVersion} · ${summary.totalEvaluated} candidatos en ${summary.elapsedMs} ms`,
    `- Huella: \`${summary.fingerprint.fingerprint}\` (escenario ${summary.fingerprint.scenarioHash}, código ${summary.fingerprint.codeHash}, lock ${summary.fingerprint.lockHash}, Node ${summary.fingerprint.nodeVersion}, astronomy-engine ${summary.fingerprint.engineVersion}) · resultado \`${summary.fingerprint.resultHash}\``,
    `- Fechas de alunizaje: ${s.dates.join(', ')} · misión de ${s.missionDays} días · paso ${s.stepMinutes} min · Sol: ${s.mode} · Tierra: ${s.earthMode}${s.earthMinElevationDeg ? ` ≥ ${s.earthMinElevationDeg}°` : ''} (discos) · agregado: ${s.aggregate === 'worst' ? 'peor fecha real' : 'media'}`,
    `- Pesos: ${Object.entries(s.weights).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`,
    `- Restricciones: ${Object.keys(s.constraints).length ? Object.entries(s.constraints).map(([k, v]) => `${k}=${v}`).join(', ') : 'ninguna'}`,
    `- Relieve: ${s.terrain ? `LOLA, modo ${s.terrain.resolution === 'fast' ? 'rápido (160/240 m)' : 'preciso (20 m + 160/240 m)'}, ${heightsText(s.terrain)}, ${refineText(s.terrain)}, DEM ${s.terrain.demVersion ?? 'NO DISPONIBLE'}` : 'desactivado (horizonte a 0°)'}`,
    ...(s.nightMinSunFraction || s.fullNight || s.battery ? [`- Noche: ${s.nightMinSunFraction ? `Sol < ${pct(s.nightMinSunFraction)} del disco` : `criterio ${s.mode}`}${s.fullNight ? ' · noche real (se extiende fuera de la misión)' : ''}${s.battery ? ` · batería: ${s.battery.survivalLoadW} W, ${s.battery.whPerKg} Wh/kg, DoD ${s.battery.depthOfDischarge} (solo el pack)` : ''}`] : []),
    ...(s.panel ? [`- Panel solar (solo energía): ${s.panel === 'horizontal' ? 'horizontal fijo, factor max(0, sen(el))' : 'vertical que gira hacia el Sol, factor cos(el)'}`] : []),
    `- Robustez espacial: ${s.robustness ? `peor valor en ${s.robustness.radiusKm} km (${s.robustness.directions} direcciones × ${s.robustness.rings} anillo/s)` : 'desactivada (puntuación nominal)'}`,
    '',
    '## Mejor posición',
    '',
    `**${fmtCand(b)}** · puntuación **${b.score}** · ${b.feasible ? '✅ cumple las restricciones' : `❌ no cumple: ${b.violations.join('; ')}`}`,
    ...(b.robustness ? ['', `Robustez a ${b.robustness.radiusKm} km (${b.robustness.points} puntos): nominal **${b.nominalScore}**, peor ${b.robustness.worstScore} en (${b.robustness.worstAt.lat.toFixed(4)}, ${b.robustness.worstAt.lon.toFixed(4)}), caída ${b.robustness.spread}.`] : []),
    '',
    `| Energía (disco) | Sol | Tierra | Ambos | Noche más larga | Sin Tierra más largo |`,
    `|---|---|---|---|---|---|`,
    `| ${pct(b.metrics.energy)} | ${pct(b.metrics.sunFraction)} | ${pct(b.metrics.earthFraction)} | ${pct(b.metrics.bothFraction)} | ${b.metrics.longestNightH} h | ${b.metrics.longestNoEarthH} h |`,
    ...(b.metrics.longestNightFullH !== undefined ? ['', `Noche real más larga (extendida fuera de la misión): **${b.metrics.longestNightFullH} h**.`] : []),
    ...(b.slope ? ['', b.slope.slopeDeg === null ? 'Pendiente: sin DEM en el punto.' : `Pendiente del terreno: **${b.slope.slopeDeg}°** en ${b.slope.slopeBaselineM} m (DEM de ${b.slope.demResolutionM} m/px${b.slope.underestimated ? `; base pedida ${b.slope.requestedBaselineM} m, subestimada` : ''}). Artemis III pide < 10° en 100 m.`] : []),
    ...(b.metrics.batteryKg !== undefined ? ['', `Batería para la noche: **${b.metrics.batteryKWh} kWh**, **${b.metrics.batteryKg} kg** de pack (sin electrónica, sin panel extra para recargar y sin márgenes: a nivel de sistema, ~2–3 veces más).`] : []),
    '',
    'Por fecha de alunizaje:',
    '',
    '| Fecha | Energía | Tierra | Ambos | Noche más larga |',
    '|---|---|---|---|---|',
    ...b.perDate.map((d) => `| ${d.date} | ${pct(d.energy)} | ${pct(d.earthFraction)} | ${pct(d.bothFraction)} | ${d.longestNightH} h |`),
    '',
    ...(summary.warnings.length ? ['## Avisos', '', ...summary.warnings.map((w) => `- ⚠️ ${w}`), ''] : []),
    '## Convergencia',
    '',
    '| Iteración | Malla (km) | Nuevos | Cumplen | Mejor | Puntuación | Mejora | Movimiento (km) |',
    '|---|---|---|---|---|---|---|---|',
    ...iterations.map((r) => `| ${r.iteration} | ${r.spacingKm} | ${r.evaluated} | ${r.feasibleCount}/${r.totalEvaluated} | ${fmtCand(r.best)} | ${r.best.score} | ${r.improvement ?? '—'} | ${r.bestMovedKm ?? '—'} |`),
    '',
    `Parada: **${summary.stop}**.`,
    '',
    (s.points ? '## Ranking de los puntos' : '## Top (zonas distintas)'),
    '',
    `| # | Posición | Puntuación${s.robustness ? ' (robusta) | Nominal | Caída' : ''} | Cumple | Energía | Tierra | Ambos | Noche máx. |`,
    `|---|---|---${s.robustness ? '|---|---' : ''}|---|---|---|---|---|`,
    ...summary.top.map((c, i) => `| ${i + 1} | ${fmtCand(c)} | ${c.score}${s.robustness ? ` | ${c.nominalScore} | ${c.robustness?.spread}` : ''} | ${c.feasible ? '✅' : '❌'} | ${pct(c.metrics.energy)} | ${pct(c.metrics.earthFraction)} | ${pct(c.metrics.bothFraction)} | ${c.metrics.longestNightH} h |`),
    '',
    ...(summary.baselines.length ? [
      '## Sitios de referencia (mismo escenario)',
      '',
      '| Sitio | Posición | Puntuación | Cumple | Energía | Tierra | Ambos | Noche máx. |',
      '|---|---|---|---|---|---|---|---|',
      ...summary.baselines.map((c) => ('error' in c ? `| ${c.id} | — | — | ${c.error} | | | | |`
        : `| ${c.name} | ${fmtCand(c)} | ${c.score} | ${c.feasible ? '✅' : '❌'} | ${pct(c.metrics.energy)} | ${pct(c.metrics.earthFraction)} | ${pct(c.metrics.bothFraction)} | ${c.metrics.longestNightH} h |`)),
      '',
    ] : []),
    `> ${summary.note}`,
    '',
  ];
  return lines.join('\n');
}

/** Runs an already loaded scenario (object) and returns {summary, iterations}. No I/O: also used by the tests. */
export function runScenario(
  raw: RawScenario,
  { label, onIteration }: { label?: string; onIteration?: (record: IterationRecord) => void } = {},
): { summary: RunSummary; iterations: IterationRecord[]; resolved: Scenario } {
  const t0 = performance.now();
  const s = resolveScenario(raw);
  const samples = prepareSamples(s);
  const iterations: IterationRecord[] = [];
  if (s.points) {
    const rec = evaluatePoints(s, samples);
    iterations.push(rec);
    onIteration?.(rec);
  } else {
    for (const rec of optimize(s, samples)) {
      iterations.push(rec);
      onIteration?.(rec);
    }
  }
  const last = iterations.at(-1)!; // there is always at least one iteration
  // Top of distinct zones from the last ranking (at least 4× the initial grid spacing apart).
  const minSep = 4 * s.search.spacingKm;
  const top: TopCandidate[] = s.points ? [...last.top] : [];
  if (!s.points) for (const c of last.top.concat(iterations.flatMap((r) => r.top)).sort((a, b) => (Number(b.feasible) - Number(a.feasible)) || (b.score - a.score))) {
    if (top.every((t) => distanceKm(t, c) >= minSep)) top.push(c);
    if (top.length === 5) break;
  }
  const warnings: string[] = [];
  const fp = { ...fingerprint(s), resultHash: resultHash(iterations) };
  const nvm = expectedNode();
  if (nvm && nvm !== process.versions.node) warnings.push(`Node ${process.versions.node} distinto del fijado en .nvmrc (${nvm}): el resultado podría variar en el último decimal.`);
  warnings.push(...redundancyWarnings(s.weights));
  const bw = s.region ? boundaryWarning(last.best, { search: s.search, region: s.region }) : null;
  if (bw) warnings.push(bw);
  if (s.terrain) {
    const all = iterations.flatMap((r) => r.candidates ?? []);
    const without = all.filter((c) => c.horizon === 'sphere').length;
    if (!s.terrain.demVersion) warnings.push('Relieve activado pero no hay DEM en la caché (backend/terrain/cache): se ha usado horizonte a 0°. Ejecuta `node scripts/fetch-dem.ts`.');
    else if (without) warnings.push(`${without} de ${all.length} candidatos quedan fuera de la cobertura del DEM en caché y se han evaluado con horizonte a 0°.`);
    // Fast mode near the pole (≤ −85° or with a 20 m window): the measured error, not just the reminder.
    const polar = fastModeWarning(s.terrain, all.filter((c) => c.horizon === 'mask'), 'modo puntos con terrain.resolution="precise"');
    if (polar) warnings.push(polar.replace(/^AVISO: r/, 'R'));
    else if (s.terrain.resolution === 'fast') warnings.push('Relieve en modo rápido (160/240 m): confirma los finalistas en modo puntos con terrain.resolution="precise".');
  }
  if (!last.best.feasible) warnings.push('Ningún candidato cumple todas las restricciones: relájalas o amplía la región/fechas.');
  if (Math.abs(last.best.lat) > 89) warnings.push('Mejor punto a menos de 1° del polo: el azimut depende de la convención de longitud y las coordenadas deben ser precisas al metro.');
  const summary: RunSummary = {
    runId: new Date().toISOString().replace(/[:.]/g, '-'),
    label: label ?? null,
    codeVersion: codeVersion(),
    fingerprint: fp,
    scenario: { name: s.name, description: s.description, region: s.region, dates: s.dates, missionDays: s.missionDays, stepMinutes: s.stepMinutes, mode: s.mode, earthMode: s.earthMode, earthMinElevationDeg: s.earthMinElevationDeg, aggregate: s.aggregate, weights: s.weights, constraints: s.constraints, search: s.search, robustness: s.robustness, ...(s.terrain ? { terrain: s.terrain } : {}), ...(s.points ? { points: s.points } : {}), ...(s.nightMinSunFraction ? { nightMinSunFraction: s.nightMinSunFraction } : {}), ...(s.fullNight ? { fullNight: s.fullNight } : {}), ...(s.battery ? { battery: s.battery } : {}), ...(s.panel ? { panel: s.panel } : {}) },
    best: last.best,
    stop: last.stop,
    iterations: iterations.length,
    totalEvaluated: last.totalEvaluated,
    top,
    baselines: evaluateBaselines(s, samples),
    warnings,
    note: `${s.terrain ? `Con relieve LOLA (${s.terrain.resolution === 'fast' ? 'rápido, 160/240 m' : 'preciso, 20 m + 160/240 m'}; ${heightsText(s.terrain)}; DEM ${s.terrain.demVersion ?? 'no disponible → 0°'})` : 'Sin relieve: horizonte de Luna lisa a 0°'}. Sol y Tierra como discos: Sol en modo ${s.mode} (energía = fracción del disco solar visible); Tierra en modo ${s.earthMode}${s.earthMinElevationDeg ? ` con ≥ ${s.earthMinElevationDeg}° de elevación` : ''}.`,
    elapsedMs: Math.round(performance.now() - t0),
  };
  return { summary, iterations, resolved: s };
}

// --- CLI ---
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(USAGE); process.exit(0); }
    const args = parseArgs(process.argv.slice(2));
    const raw = readScenario(args.scenario);
    for (const e of args.sets) applySet(raw, e);
    const log = args.quiet ? () => {} : (msg: string) => { process.stdout.write(`${msg}\n`); };
    log(`▶ Escenario ${raw.name} (${raw.dates?.length ?? 0} fechas)${args.label ? ` · ${args.label}` : ''}`);
    const { summary, iterations } = runScenario(raw, {
      label: args.label,
      onIteration: (r) => log(`  it ${r.iteration}: malla ${r.spacingKm} km · +${r.evaluated} candidatos · mejor ${fmtCand(r.best)} = ${r.best.score}${r.best.feasible ? '' : ' (no cumple)'}${r.improvement !== null ? ` · mejora ${r.improvement}` : ''} · ${r.elapsedMs} ms`),
    });
    const dir = path.join(args.out ?? path.join(HERE, 'runs'), `${summary.runId}_${raw.name}${args.label ? `_${args.label.replace(/[^\w-]+/g, '-')}` : ''}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(summary.scenario, null, 2));
    fs.writeFileSync(path.join(dir, 'iterations.jsonl'), iterations.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(dir, 'report.md'), report(summary, iterations));
    log(`✔ Mejor ${fmtCand(summary.best)} = ${summary.best.score} ${summary.best.feasible ? '(cumple)' : '(NO cumple)'} · parada: ${summary.stop} · ${summary.elapsedMs} ms`);
    for (const w of summary.warnings) log(`  ⚠️  ${w}`);
    log(`  Informe: ${path.relative(process.cwd(), path.join(dir, 'report.md'))}`);
    if (args.db) {
      const db = openDb(args.db);
      const id = saveRun(db, summary, iterations);
      const n = row<CountRow>(db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE run_id = ?'), id)!.n;
      db.close();
      log(`  Base de datos: ejecución #${id} con ${n} candidatos → ${path.relative(process.cwd(), args.db)}`);
    }
  } catch (e) {
    process.stderr.write(`✖ ${(e as Error).message}\n`);
    process.exit(1);
  }
}
