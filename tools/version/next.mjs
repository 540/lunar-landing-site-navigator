#!/usr/bin/env node
// Decides the version of the deploy of HEAD (lib.mjs) from git and the labels of the issues on GitHub.
//   node tools/version/next.mjs [--out <version.json>]
// Prints the result as JSON; with --out, also writes the version.json the site shows (shared/version/badge.js).
// In GitHub Actions it reads GITHUB_TOKEN and GITHUB_REPOSITORY for the labels and writes version, tag and create to
// GITHUB_OUTPUT. Without a token the labels are unknown and only the commit messages decide.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_PATHS, resolveVersion } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function gitState(cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  const lines = text => text.split('\n').filter(Boolean);
  return {
    tags: lines(git('tag', '--merged', 'HEAD', '--list', 'v*')),
    headTags: lines(git('tag', '--points-at', 'HEAD', '--list', 'v*')),
    headSubject: git('log', '-1', '--format=%s'),
    commit: git('rev-parse', '--short', 'HEAD'),
    siteMessages: sinceTag => git('log', '--format=%B%x1e', ...(sinceTag ? [`${sinceTag}..HEAD`] : []), '--', ...SITE_PATHS)
      .split('\x1e').map(m => m.trim()).filter(Boolean),
  };
}

export function githubLabels({ token, repository, fetchImpl = fetch }) {
  return async issue => {
    if (!token || !repository) return [];
    try {
      const res = await fetchImpl(`https://api.github.com/repos/${repository}/issues/${issue}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'site-version' },
      });
      if (!res.ok) return [];
      return ((await res.json()).labels ?? []).map(label => label.name);
    } catch {
      return [];
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outAt = process.argv.indexOf('--out');
  const out = outAt > 0 ? process.argv[outAt + 1] : null;
  const state = gitState(ROOT);
  const labelsOf = githubLabels({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY });
  const result = await resolveVersion({ ...state, labelsOf });
  const info = { version: result.version, commit: state.commit, date: new Date().toISOString().slice(0, 10) };
  if (out) fs.writeFileSync(out, JSON.stringify(info) + '\n');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\ntag=v${result.version}\ncreate=${result.create}\n`);
  }
  console.log(JSON.stringify({ ...info, ...result }));
}
