// The Claude Code hook that keeps REST v1 and GraphQL from diverging (.claude/scripts/parity-hook.sh, #71): fed with
// sample hook JSON, it runs the parity check only for changes in backend/ or data/ of a checkout of this repo (here a
// temporary git worktree, as agents use), stays silent otherwise, and blocks (exit 2) a commit with a broken parity.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const hook = path.join(repo, '.claude/scripts/parity-hook.sh');
let tmp, wt, stub, calls;

/** Runs the hook with a JSON input; PARITY_SCRIPT is a stub that records the checkout it gets, unless `real`. */
function runHook(mode, input, { real = false } = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo };
  if (!real) env.PARITY_SCRIPT = stub;
  fs.writeFileSync(calls, '');
  const r = spawnSync('bash', [hook, mode], { input: JSON.stringify(input), env, encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, ran: fs.readFileSync(calls, 'utf8').trim() };
}

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-hook-')));
  wt = path.join(tmp, 'wt');
  execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', '--quiet', wt, 'HEAD']);
  // The same files as this checkout, uncommitted changes included (before committing them, or in a run before a commit).
  const diff = execFileSync('git', ['-C', repo, 'diff', 'HEAD', '--binary', '--', 'backend', 'data']);
  if (diff.length) execFileSync('git', ['-C', wt, 'apply', '--whitespace=nowarn'], { input: diff });
  const untracked = execFileSync('git', ['-C', repo, 'ls-files', '--others', '--exclude-standard', '-z', '--', 'backend', 'data'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of untracked.filter((x) => fs.lstatSync(path.join(repo, x)).isFile())) { // not the DEM cache symlink
    fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true });
    fs.copyFileSync(path.join(repo, f), path.join(wt, f));
  }
  for (const d of ['backend', 'data']) fs.symlinkSync(path.join(repo, d, 'node_modules'), path.join(wt, d, 'node_modules'));
  calls = path.join(tmp, 'calls');
  stub = path.join(tmp, 'stub.sh');
  fs.writeFileSync(stub, `#!/usr/bin/env bash\necho "$1" >> ${JSON.stringify(calls)}\n`);
});

after(() => {
  execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('editar en backend/ de un worktree comprueba la paridad en ese worktree', () => {
  const r = runHook('post-edit', { cwd: repo, tool_name: 'Edit', tool_input: { file_path: path.join(wt, 'backend/src/useCases.ts') } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.ran, wt);
});

test('editar en web/, fuera de git o en un notebook de data/ (notebook_path)', () => {
  assert.deepEqual(runHook('post-edit', { cwd: repo, tool_input: { file_path: path.join(wt, 'web/index.html') } }), { status: 0, stderr: '', ran: '' });
  assert.deepEqual(runHook('post-edit', { cwd: tmp, tool_input: { file_path: path.join(tmp, 'x/fichero.ts') } }), { status: 0, stderr: '', ran: '' });
  assert.equal(runHook('post-edit', { cwd: repo, tool_input: { notebook_path: path.join(wt, 'data/x.ipynb') } }).ran, wt);
});

test('Bash: solo git commit o git push, en el checkout de git -C, de cd … && o del cwd', () => {
  const touch = path.join(wt, 'data/src/notes.ts');
  fs.appendFileSync(touch, '\n');
  try {
    assert.equal(runHook('pre-bash', { cwd: tmp, tool_input: { command: 'ls -la && npm test' } }).ran, '');
    assert.equal(runHook('pre-bash', { cwd: tmp, tool_input: { command: `git -C ${wt} -c core.hooksPath=/dev/null commit -m "x"` } }).ran, wt);
    assert.equal(runHook('pre-bash', { cwd: tmp, tool_input: { command: `cd ${wt} && git add -A && git push origin HEAD:main` } }).ran, wt);
    assert.equal(runHook('pre-bash', { cwd: wt, tool_input: { command: 'git commit -am "x"' } }).ran, wt);
    assert.equal(runHook('pre-bash', { cwd: wt, tool_input: { command: 'git status && git log -1' } }).ran, '');
    // Stop: con cambios en data/ sin commit, comprueba; sin ellos, nada.
    assert.equal(runHook('stop', { cwd: wt, hook_event_name: 'Stop' }).ran, wt);
  } finally {
    execFileSync('git', ['-C', wt, 'checkout', '--quiet', '--', 'data/src/notes.ts']);
  }
  // Without changes in backend/ or data/ against origin/main (the usual case once pushed; the node_modules symlinks do
  // not count), Stop does nothing. Before pushing this checkout's changes, the worktree carries them: then it runs.
  const git = (...a) => spawnSync('git', ['-C', wt, ...a], { encoding: 'utf8' }).stdout.trim();
  const base = git('merge-base', 'origin/main', 'HEAD');
  const pending = git('status', '--porcelain', '--', 'backend', 'data', ':(exclude)backend/node_modules', ':(exclude)data/node_modules')
    || (base && git('diff', '--name-only', base, 'HEAD', '--', 'backend', 'data'));
  assert.equal(runHook('stop', { cwd: wt, hook_event_name: 'SubagentStop' }).ran, pending ? wt : '');
});

test('git commit con la paridad rota: exit 2 y en castellano qué diverge', () => {
  const file = path.join(wt, 'data/src/graphql/schema.graphql');
  const sdl = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, sdl.replace(/\n\s*"true: añade los ortos[^\n]*\n\s*events: Boolean/, ''));
  const r = runHook('pre-bash', { cwd: tmp, tool_input: { command: `git -C ${wt} -c core.hooksPath=/dev/null commit -am "x"` } }, { real: true });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /La API REST v1 y GraphQL divergen/);
  assert.match(r.stderr, /\/v1\/windows\?events/);
  assert.match(r.stderr, /no desactives el hook/);
});
