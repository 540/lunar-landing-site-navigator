// Fingerprint of a run: identifies EVERYTHING that can change the result.
//
//   scenarioHash  resolved scenario (defaults included, normalized weights; with terrain, also
//                 terrain.demVersion: which DEM was in the cache)
//   codeHash      computing code (src/*.ts + src/terrain/*.ts + evals/lib.ts); excludes reports and CLI.
//                 Version 2 (codeHashVersion): hashes the code with its TypeScript types erased, relative imports
//                 normalized to .js and no whitespace, so adding or changing ONLY types does not change it.
//                 Type-only files (src/types.ts: nothing but comments once erased) do not count.
//   lockHash      package-lock.json (exact dependency versions)
//   nodeVersion   Node version (Math.* functions may differ in the last bit between versions)
//   engineVersion installed astronomy-engine version
//   fingerprint   hash of all of the above
//
//   resultHash    hash of the RESULT (all candidates with their metrics), to check determinism:
//                 same fingerprint ⇒ should give the same resultHash. Otherwise something is not deterministic.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fingerprint, FingerprintParts, IterationRecord, Scenario } from '../src/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

export const CODE_HASH_VERSION = 2;

const sha = (data: string | Buffer): string => crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);

/** Canonical JSON: sorted keys, so the same content always gives the same hash. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Erases the TypeScript types (Node's own stripper, the same one that runs the code) without its experimental warning. */
function stripTypes(source: string): string {
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return stripTypeScriptTypes(source, { mode: 'strip' });
  } finally {
    process.emitWarning = emit;
  }
}

/** Code of one file with its TypeScript types erased (.ts) and relative imports `.ts` → `.js`. */
function erasedCode(file: string): string {
  const src = fs.readFileSync(file, 'utf8');
  return (file.endsWith('.ts') ? stripTypes(src) : src).replace(/(from\s*|import\(\s*)(['"])(\.{1,2}\/[^'"]+)\.ts\2/g, '$1$2$3.js$2');
}

/**
 * Code of one file as hashed by codeHash v2: erasedCode without whitespace. Removing whitespace is what makes it
 * insensitive to the blanks the stripper leaves; it could confuse `a - -b` with `a--b`, so codeHash is informative:
 * the judge of determinism is still resultHash (golden tests).
 */
export const normalizedCode = (file: string): string => erasedCode(file).replace(/\s+/g, '');

/** Nothing left but comments once the types are erased (a module of types only). The regex is only safe for this test. */
const isTypeOnly = (file: string): boolean => erasedCode(file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim() === '';

/** codeHash v2 of a backend folder (by default this one). Works on .js (before the migration) and .ts. */
export function codeHash(root: string = ROOT): string {
  const isCode = (f: string): boolean => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts');
  const list = (dir: string): string[] => fs.readdirSync(path.join(root, dir)).filter(isCode).map((f) => `${dir}/${f}`);
  const lib = ['evals/lib.ts', 'evals/lib.js'].filter((f) => fs.existsSync(path.join(root, f)));
  const files = [...list('src'), ...list('src/terrain'), ...lib]
    .filter((f) => !isTypeOnly(path.join(root, f)))
    .map((f) => ({ key: f.replace(/\.ts$/, '.js'), code: normalizedCode(path.join(root, f)) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const h = crypto.createHash('sha256');
  for (const { key, code } of files) h.update(key).update('\0').update(code).update('\0');
  return h.digest('hex').slice(0, 16);
}

function engineVersion(): string {
  try {
    const pkg: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'astronomy-engine', 'package.json'), 'utf8'));
    const version = pkg && typeof pkg === 'object' && 'version' in pkg ? pkg.version : undefined;
    return typeof version === 'string' ? version : 'desconocida';
  } catch { return 'desconocida'; }
}

/** Expected Node version (.nvmrc), to compare with the one in use. */
export function expectedNode(): string | null {
  try { return fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim(); } catch { return null; }
}

/** Fingerprint of environment + scenario. `resolvedScenario` is the output of resolveScenario(). */
export function fingerprint(resolvedScenario: Scenario): Fingerprint {
  const { dateMs, ...scenario } = resolvedScenario; // dateMs is derived from dates
  const parts: FingerprintParts = {
    scenarioHash: sha(canonical(scenario)),
    codeHash: codeHash(),
    codeHashVersion: CODE_HASH_VERSION,
    lockHash: sha(fs.existsSync(path.join(ROOT, 'package-lock.json')) ? fs.readFileSync(path.join(ROOT, 'package-lock.json')) : ''),
    nodeVersion: process.versions.node,
    engineVersion: engineVersion(),
  };
  return { ...parts, fingerprint: sha(canonical(parts)) };
}

/** Result hash: all evaluated candidates (sorted by position) with metrics, feasibility and per-date metrics. */
export function resultHash(iterations: readonly IterationRecord[]): string {
  const all = iterations.flatMap((r) => r.candidates ?? [])
    .map((c) => ({ lat: c.lat, lon: c.lon, score: c.score, feasible: c.feasible, violations: c.violations, metrics: c.metrics, perDate: c.perDate }))
    .sort((a, b) => (a.lat - b.lat) || (a.lon - b.lon));
  return sha(canonical(all));
}

// CLI: prints codeHash v2 of a backend folder (default: this one). `node evals/fingerprint.ts [folder]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(process.argv[2] ?? ROOT);
  console.log(`codeHash v${CODE_HASH_VERSION} ${codeHash(root)} (${root})`);
}
