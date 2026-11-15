#!/usr/bin/env node
// Evals competition: several explorers (Claude and/or opencode) search in parallel for the best position of a benchmark,
// and a DETERMINISTIC JUDGE (no AI) decides the outcome.
//
//   node evals/competition.ts --benchmark reto-polo-sur-v2 \
//        --agents claude:haiku:grid,claude:haiku:hillclimb,claude:sonnet:data,opencode:<provider>/<model>:robust
//   node evals/competition.ts … --dry-run               # shows what it would launch, without launching anything
//   node evals/competition.ts --benchmark reto-polo-sur-v2 --judge hv2-   # judge only, over existing runs
//
// Options: --max-runs 15  --max-candidates 20000  --timeout-min 20  --budget-usd 2 (claude only)
//          --robust-km 1  --finalists 3 (per agent)
//
// The judge: (1) checks in the DB that nobody touched the fixed parameters or exceeded the budget; (2) checks that the
// code did not change during the competition; (3) takes the best candidates of each agent; (4) re-evaluates them in points
// mode with spatial robustness; (5) ranks by robust score and stores everything (DB + .md report).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_DB, openDb, rows, saveRun } from './db.ts';
import { fingerprint } from './fingerprint.ts';
import { resolveScenario } from './lib.ts';
import { readScenario, runScenario } from './run.ts';
import { distanceKm } from '../src/search.ts';
import { STRATEGIES } from './strategies.ts';
import type { RawScenario, RunRow, Scenario } from '../src/types.ts';

interface CompetitionOptions {
  maxRuns: number;
  maxCandidates: number;
  timeoutMin: number;
  budgetUsd: number;
  robustKm: number;
  finalists: number;
  dryRun: boolean;
  benchmark?: string;
  agents?: string;
  judge?: string;
}
type Tool = 'claude' | 'opencode';
export interface AgentSpec { n: number; tool: Tool; model: string; strategy: string }
interface AgentExit { exitCode: number | null; signal: NodeJS.Signals | null; durationS: number }
interface AgentUsage { costUsd: number | null; tokens: number | null; turns: number | null }
/** A competitor: launched here (with spec, exit and usage) or, with --judge, found in the database by label. */
interface Competitor extends Partial<AgentSpec>, Partial<AgentExit>, Partial<AgentUsage> { key: string; prefix: string }
interface InvalidRun { id: number; label: string | null; reason: string }
interface Finalist { lat: number; lon: number; score: number }
type JudgedCompetitor = Competitor & { invalid: InvalidRun[]; validRuns: number; finalists: Finalist[] };
interface RankingRow { agent: string; name: string; lat: number; lon: number; robust: number; nominal: number; feasible: boolean; spread: number }
/** What we read of `claude -p --output-format json`. */
interface ClaudeOutput {
  total_cost_usd?: number;
  num_turns?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}
/** What we read of an `opencode run --format json` event (the shape varies by event). */
interface OpencodeTokens { input?: number; output?: number; reasoning?: number }
interface OpencodeEvent { part?: { tokens?: OpencodeTokens; cost?: unknown }; tokens?: OpencodeTokens; cost?: unknown; properties?: { info?: { tokens?: OpencodeTokens } } }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..');
const OUT = path.join(HERE, 'competitions');

// ---------- arguments ----------
const USAGE = `Uso:
  node evals/competition.ts --benchmark <escenario> --agents herramienta:modelo:estrategia,… [--dry-run]
  node evals/competition.ts --benchmark <escenario> --judge <prefijo>   # solo juez, sobre ejecuciones existentes

Opciones: --max-runs 15  --max-candidates 20000  --timeout-min 20  --budget-usd 2 (solo claude)
          --robust-km 1  --finalists 3 (por agente)
Estrategias: ${Object.keys(STRATEGIES).join(', ')}`;

function parseArgs(argv: string[]): CompetitionOptions & { benchmark: string } {
  const a: CompetitionOptions = { maxRuns: 15, maxCandidates: 20000, timeoutMin: 20, budgetUsd: 2, robustKm: 1, finalists: 3, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    const num = () => { i++; const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw new Error(`${k} debe ser un número > 0`); return n; };
    if (k === '--benchmark') { a.benchmark = v; i++; }
    else if (k === '--agents') { a.agents = v; i++; }
    else if (k === '--judge') { a.judge = v; i++; }
    else if (k === '--max-runs') a.maxRuns = num();
    else if (k === '--max-candidates') a.maxCandidates = num();
    else if (k === '--timeout-min') a.timeoutMin = num();
    else if (k === '--budget-usd') a.budgetUsd = num();
    else if (k === '--robust-km') a.robustKm = num();
    else if (k === '--finalists') a.finalists = num();
    else if (k === '--dry-run') a.dryRun = true;
    else throw new Error(`Argumento desconocido: ${k}`);
  }
  if (!a.benchmark) throw new Error('Falta --benchmark <nombre de evals/scenarios/*.json>');
  if (!a.judge && !a.agents) throw new Error('Indica --agents herramienta:modelo:estrategia,… o --judge <prefijo>');
  return { ...a, benchmark: a.benchmark };
}

const isTool = (t: string): t is Tool => t === 'claude' || t === 'opencode';

/**
 * Models of Chinese origin are NOT allowed. The NASA Space Apps 2026 terms forbid "participate, collaborate, or
 * coordinate with China or any Chinese-owned entity in relation to their participation" (https://www.spaceappschallenge.org/legal/).
 * Using models from Chinese companies (their API or their weights) in challenge work is, at best, a grey area: they are excluded.
 */
export const BLOCKED_MODEL = /deepseek|qwen|glm|zhipu|chatglm|kimi|moonshot|minimax|abab|baichuan|ernie|hunyuan|doubao|yi-|01-ai|internlm|step-?\d|stepfun|seed-oss|bytedance|baidu|alibaba|tencent/i;

/** "claude:haiku:grid,opencode:provider/model:data" → [{tool, model, strategy}] */
export function parseAgents(spec: string): AgentSpec[] {
  return spec.split(',').map((s) => s.trim()).filter(Boolean).map((s, i) => {
    const parts = s.split(':');
    if (parts.length !== 3) throw new Error(`Agente mal formado (herramienta:modelo:estrategia): ${s}`);
    const [tool, model, strategy] = parts;
    if (!isTool(tool)) throw new Error(`Herramienta desconocida: ${tool} (claude u opencode)`);
    if (!STRATEGIES[strategy]) throw new Error(`Estrategia desconocida: ${strategy}. Válidas: ${Object.keys(STRATEGIES).join(', ')}`);
    if (BLOCKED_MODEL.test(model)) throw new Error(`Modelo no permitido: ${model}. Los modelos de origen chino quedan excluidos por los términos de NASA Space Apps (ver BLOCKED_MODEL).`);
    return { n: i + 1, tool, model, strategy };
  });
}

// ---------- explorer prompt ----------
function buildPrompt({ agent, prefix, benchmarkFile, workDir, opts }: { agent: AgentSpec; prefix: string; benchmarkFile: string; workDir: string; opts: CompetitionOptions }): string {
  const rules = fs.readFileSync(path.join(HERE, 'AGENT.md'), 'utf8')
    .replaceAll('MAX_RUNS', String(opts.maxRuns)).replaceAll('MAX_CANDIDATES', String(opts.maxCandidates));
  const scen = readScenario(benchmarkFile);
  return `${rules}

## Tu encargo
- PREFIJO de etiquetas: \`${prefix}\`
- CARPETA DE TRABAJO (único sitio donde puedes escribir ficheros): \`${workDir}\`
- Benchmark: \`${path.relative(BACKEND, benchmarkFile)}\` (${scen.name}). ${scen.description ?? ''}
- Presupuesto: ${opts.maxRuns} ejecuciones, ${opts.maxCandidates} candidatos por ejecución, ${opts.timeoutMin} minutos.
- Estrategia asignada: ${STRATEGIES[agent.strategy]}
`;
}

// ---------- launch ----------
function commandFor(agent: AgentSpec, prompt: string, { workDir, mcpFile, opts }: { workDir: string; mcpFile: string; opts: CompetitionOptions }): [string, string[]] {
  if (agent.tool === 'claude') {
    return ['claude', ['-p', prompt, '--model', agent.model, '--output-format', 'json',
      '--strict-mcp-config', '--mcp-config', mcpFile, '--add-dir', workDir, '--max-budget-usd', String(opts.budgetUsd),
      '--allowedTools', 'Bash(node evals/run.ts:*)', 'Bash(sqlite3:*)', 'Bash(mkdir:*)', 'Read', 'Write', 'Edit', 'Glob', 'Grep']];
  }
  // opencode: --auto approves everything not denied; the judge checks code integrity.
  return ['opencode', ['run', '--model', agent.model, '--format', 'json', '--auto', '--archived', '--title', `evals ${agent.strategy}`, prompt]];
}

function runAgent(agent: AgentSpec, cmd: string, args: string[], logBase: string, timeoutMs: number): Promise<AgentExit> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = fs.openSync(`${logBase}.out`, 'w'), err = fs.openSync(`${logBase}.err`, 'w');
    const p = spawn(cmd, args, { cwd: BACKEND, stdio: ['ignore', out, err] });
    const timer = setTimeout(() => { fs.appendFileSync(`${logBase}.err`, `\n[competición] superó ${timeoutMs / 60000} min: cerrado\n`); p.kill('SIGTERM'); }, timeoutMs);
    p.on('error', (e) => { fs.appendFileSync(`${logBase}.err`, `\n[competición] no se pudo lanzar: ${e.message}\n`); });
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(out); fs.closeSync(err);
      resolve({ exitCode: code, signal, durationS: Math.round((Date.now() - t0) / 1000) });
    });
  });
}

/** Cost and tokens, if the output includes them (claude --output-format json; opencode --format json, as events). */
function usageFrom(agent: AgentSpec, logBase: string): AgentUsage {
  const txt = fs.existsSync(`${logBase}.out`) ? fs.readFileSync(`${logBase}.out`, 'utf8') : '';
  try {
    if (agent.tool === 'claude') {
      const j = JSON.parse(txt) as ClaudeOutput;
      const u = j.usage ?? {};
      return { costUsd: j.total_cost_usd ?? null, tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), turns: j.num_turns ?? null };
    }
    let tokens = 0, cost = 0, seen = false;
    for (const line of txt.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      const e = JSON.parse(line) as OpencodeEvent | null;
      const t = e?.part?.tokens ?? e?.tokens ?? e?.properties?.info?.tokens;
      if (t) { seen = true; tokens += (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0); }
      const c = e?.part?.cost ?? e?.cost;
      if (typeof c === 'number') cost += c;
    }
    return { costUsd: seen ? cost : null, tokens: seen ? tokens : null, turns: null };
  } catch { return { costUsd: null, tokens: null, turns: null }; }
}

// ---------- judge ----------
/** Checks the DB runs of a prefix against the benchmark. Returns {runs, invalid:[{id,label,reason}], validIds} */
export function auditRuns(
  db: DatabaseSync, prefix: string, bench: Scenario, opts: Pick<CompetitionOptions, 'maxRuns' | 'maxCandidates'>,
): { runs: RunRow[]; invalid: InvalidRun[]; validIds: number[] } {
  const runs = rows<RunRow>(db.prepare(`SELECT * FROM runs WHERE label LIKE ? ORDER BY id`), `${prefix}%`);
  const expect: Record<string, unknown> = {
    dates_json: JSON.stringify(bench.dates), weights_json: JSON.stringify(bench.weights), constraints_json: JSON.stringify(bench.constraints),
    aggregate: bench.aggregate, mission_days: bench.missionDays, step_minutes: bench.stepMinutes, mode: bench.mode,
    earth_mode: bench.earthMode, earth_min_elevation_deg: bench.earthMinElevationDeg,
  };
  const invalid: InvalidRun[] = [];
  for (const r of runs) {
    const col: Record<string, unknown> = r;
    const reasons = Object.entries(expect).filter(([k, v]) => col[k] !== v && !(col[k] == null && k.startsWith('earth_') && v === (k === 'earth_mode' ? bench.mode : 0))).map(([k]) => `cambió ${k}`);
    if (r.robustness_json) reasons.push('usó robustness');
    if ((r.terrain_json ?? null) !== (bench.terrain ? JSON.stringify(bench.terrain) : null)) reasons.push('cambió terrain');
    if ((r.total_evaluated ?? 0) > opts.maxCandidates) reasons.push(`${r.total_evaluated} candidatos > ${opts.maxCandidates}`);
    if (reasons.length) invalid.push({ id: r.id, label: r.label, reason: reasons.join('; ') });
  }
  const valid = runs.filter((r) => !invalid.some((x) => x.id === r.id));
  // Too many runs: those beyond the limit (in order) do not count.
  for (const r of valid.slice(opts.maxRuns)) invalid.push({ id: r.id, label: r.label, reason: `ejecución nº ${valid.indexOf(r) + 1} > ${opts.maxRuns}` });
  return { runs, invalid, validIds: valid.slice(0, opts.maxRuns).map((r) => r.id) };
}

/** Best feasible candidates of some runs, at least 0.5 km apart from each other. */
function finalists(db: DatabaseSync, runIds: number[], k: number): Finalist[] {
  if (!runIds.length) return [];
  const best = rows<Finalist>(db.prepare(`SELECT lat, lon, score FROM candidates WHERE run_id IN (${runIds.map(() => '?').join(',')}) AND feasible = 1
                           ORDER BY score DESC, lat, lon LIMIT 2000`), ...runIds);
  const out: Finalist[] = [];
  for (const r of best) {
    if (out.every((o) => distanceKm(o, r) >= 0.5)) out.push(r);
    if (out.length === k) break;
  }
  return out;
}

/** Re-evaluates every agent's finalists in points mode, nominal and with robustness, and stores the judge run. */
function judge(db: DatabaseSync, compId: string, benchRaw: RawScenario, agents: JudgedCompetitor[], opts: CompetitionOptions): { ranking: RankingRow[]; runId: number | null } {
  const points = agents.flatMap((a) => a.finalists.map((f, i) => ({ lat: f.lat, lon: f.lon, name: `${a.key}#${i + 1}` })));
  if (!points.length) return { ranking: [], runId: null };
  const { region, search, ...base } = benchRaw;
  const scen: RawScenario = { ...base, name: `${benchRaw.name}-juez`, points, robustness: { radiusKm: opts.robustKm, directions: 8, rings: 2 } };
  const { summary, iterations } = runScenario(scen, { label: `${compId}-juez` });
  const runId = saveRun(db, summary, iterations);
  // Points mode with robustness: one iteration, every candidate has its name, nominalScore and robustness.
  const evaluated = iterations[0].candidates!;
  const ranking = evaluated.map((c): RankingRow => ({ agent: c.name!.split('#')[0], name: c.name!, lat: c.lat, lon: c.lon, robust: c.score, nominal: c.nominalScore!, feasible: c.feasible, spread: c.robustness!.spread }))
    .sort((a, b) => (Number(b.feasible) - Number(a.feasible)) || (b.robust - a.robust) || (b.nominal - a.nominal));
  return { ranking, runId };
}

function report(comp: { id: string; benchmark: string; codeIntact: boolean }, agents: JudgedCompetitor[], ranking: RankingRow[], opts: CompetitionOptions): string {
  const best: Map<string, RankingRow> = new Map();
  for (const r of ranking) if (!best.has(r.agent)) best.set(r.agent, r);
  const table = agents.map((a) => ({ a, b: best.get(a.key) })).sort((x, y) => (Number(y.b?.feasible ?? 0) - Number(x.b?.feasible ?? 0)) || ((y.b?.robust ?? -1) - (x.b?.robust ?? -1)));
  return [
    `# Competición ${comp.id}: ${comp.benchmark}`,
    '',
    `- ${new Date().toISOString()} · ${agents.length} agentes · presupuesto ${opts.maxRuns} ejecuciones / ${opts.maxCandidates} candidatos por ejecución · juez: robustez a ${opts.robustKm} km`,
    `- Integridad del código: ${comp.codeIntact ? '✅ sin cambios durante la competición' : '❌ EL CÓDIGO CAMBIÓ durante la competición (resultados no fiables)'}`,
    '',
    '## Clasificación (puntuación robusta del mejor finalista de cada agente)',
    '',
    '| # | Agente | Herramienta | Modelo | Estrategia | Robusta | Nominal | Caída | Posición | Ejecuciones válidas / inválidas | Tiempo | Coste | Tokens |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...table.map(({ a, b }, i) => `| ${i + 1} | ${a.key} | ${a.tool ?? '—'} | ${a.model ?? '—'} | ${a.strategy ?? '—'} | ${b ? `${b.robust}${b.feasible ? '' : ' ❌'}` : '—'} | ${b?.nominal ?? '—'} | ${b?.spread ?? '—'} | ${b ? `(${b.lat.toFixed(4)}, ${b.lon.toFixed(4)})` : '—'} | ${a.validRuns} / ${a.invalid.length} | ${a.durationS ?? '—'} s | ${a.costUsd != null ? `$${a.costUsd.toFixed(3)}` : '—'} | ${a.tokens ?? '—'} |`),
    '',
    '## Infracciones (ejecuciones que no cuentan)',
    '',
    ...(agents.some((a) => a.invalid.length) ? agents.flatMap((a) => a.invalid.map((x) => `- ${a.key} · run ${x.id} (${x.label}): ${x.reason}`)) : ['Ninguna.']),
    '',
    '## Finalistas reevaluados por el juez',
    '',
    '| Finalista | Robusta | Nominal | Caída | Cumple |',
    '|---|---|---|---|---|',
    ...ranking.map((r) => `| ${r.name} (${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}) | ${r.robust} | ${r.nominal} | ${r.spread} | ${r.feasible ? '✅' : '❌'} |`),
    '',
  ].join('\n');
}

// ---------- main ----------
export async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return; }
  const opts = parseArgs(argv);
  const benchFile = path.join(HERE, 'scenarios', `${opts.benchmark}.json`);
  if (!fs.existsSync(benchFile)) throw new Error(`No existe ${benchFile}`);
  const benchRaw = readScenario(benchFile);
  const bench = resolveScenario(benchRaw);
  const compId = `c${new Date().toISOString().replace(/\D/g, '').slice(2, 14)}`;
  const compDir = path.join(OUT, compId);
  const codeBefore = fingerprint(bench).codeHash;

  let agents: Competitor[];
  if (opts.judge) {
    // Agent = prefix + next segment of the label (e.g. --judge hv2- → hv2-1-, hv2-2-, …).
    const judgePrefix = opts.judge;
    const labels = rows<{ label: string }>(openDb().prepare('SELECT label FROM runs WHERE label LIKE ?'), `${judgePrefix}%`).map((r) => r.label);
    agents = [...new Set(labels.map((l) => `${judgePrefix}${l.slice(judgePrefix.length).split('-')[0]}`))]
      .map((k) => ({ key: k, prefix: `${k}-` }));
    if (!agents.length) throw new Error(`No hay ejecuciones con prefijo ${opts.judge}`);
  } else {
    const launched = parseAgents(opts.agents!).map((a) => ({ ...a, key: `${compId}-a${a.n}`, prefix: `${compId}-a${a.n}-` }));
    agents = launched;
    fs.mkdirSync(compDir, { recursive: true });
    const mcpFile = path.join(compDir, 'mcp-empty.json');
    fs.writeFileSync(mcpFile, '{"mcpServers":{}}');
    const launches = launched.map((a) => {
      const workDir = path.join(compDir, `a${a.n}`);
      fs.mkdirSync(workDir, { recursive: true });
      const prompt = buildPrompt({ agent: a, prefix: a.prefix, benchmarkFile: benchFile, workDir, opts });
      fs.writeFileSync(path.join(workDir, 'prompt.md'), prompt);
      const [cmd, args] = commandFor(a, prompt, { workDir, mcpFile, opts });
      return { a, cmd, args, logBase: path.join(workDir, 'agent') };
    });
    if (opts.dryRun) {
      for (const l of launches) console.log(`[${l.a.key}] ${l.cmd} ${l.args.map((x) => (x.length > 60 ? `<prompt ${x.length} car.>` : x)).join(' ')}`);
      console.log(`\nPrompts en ${path.relative(process.cwd(), compDir)}/a*/prompt.md · no se ha lanzado nada (--dry-run).`);
      return;
    }
    console.log(`▶ Competición ${compId} · ${agents.length} agentes en paralelo · ${opts.timeoutMin} min máx.`);
    const results = await Promise.all(launches.map(async (l) => {
      const r = await runAgent(l.a, l.cmd, l.args, l.logBase, opts.timeoutMin * 60e3);
      console.log(`  ${l.a.key} (${l.a.tool}:${l.a.model}:${l.a.strategy}) terminó · código ${r.exitCode} · ${r.durationS} s`);
      return { ...r, ...usageFrom(l.a, l.logBase) };
    }));
    agents.forEach((a, i) => Object.assign(a, results[i]));
  }

  // Judge
  const db = openDb(DEFAULT_DB);
  const codeIntact = fingerprint(bench).codeHash === codeBefore;
  const judged: JudgedCompetitor[] = agents.map((a) => {
    const audit = auditRuns(db, a.prefix, bench, opts);
    return Object.assign(a, { invalid: audit.invalid, validRuns: audit.validIds.length, finalists: finalists(db, audit.validIds, opts.finalists) });
  });
  const { ranking, runId } = judge(db, compId, benchRaw, judged, opts);
  db.prepare(`INSERT INTO competitions (id, created_at, benchmark, config_json, code_intact, judge_run_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(compId, new Date().toISOString(), opts.benchmark, JSON.stringify({ ...opts, agents: opts.agents ?? null }), codeIntact ? 1 : 0, runId);
  const ins = db.prepare(`INSERT INTO competition_agents (competition_id, agent, tool, model, strategy, prefix, exit_code, duration_s, cost_usd, tokens,
    valid_runs, invalid_runs, best_robust, best_nominal, best_lat, best_lon, best_feasible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const a of judged) {
    const b = ranking.find((r) => r.agent === a.key);
    ins.run(compId, a.key, a.tool ?? null, a.model ?? null, a.strategy ?? null, a.prefix, a.exitCode ?? null, a.durationS ?? null, a.costUsd ?? null,
      a.tokens ?? null, a.validRuns, a.invalid.length, b?.robust ?? null, b?.nominal ?? null, b?.lat ?? null, b?.lon ?? null, b ? (b.feasible ? 1 : 0) : null);
  }
  db.close();
  fs.mkdirSync(compDir, { recursive: true });
  const md = report({ id: compId, benchmark: opts.benchmark, codeIntact }, judged, ranking, opts);
  fs.writeFileSync(path.join(compDir, 'report.md'), md);
  console.log(`\n${md}\nInforme: ${path.relative(process.cwd(), path.join(compDir, 'report.md'))}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e: unknown) => { console.error(`✖ ${(e as Error).message}`); process.exit(1); });
}
