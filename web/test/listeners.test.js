// Each control of the interface listens once per event: a handler registered twice runs twice per click, and a
// toggle such as ▶ of Plan (which clicks the ▶ of the mission) starts and stops in the same click.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../js/', import.meta.url);
const files = readdirSync(root, { recursive: true }).filter(f => f.endsWith('.js'));

test('ningún control engancha dos veces el mismo evento por id', () => {
  const seen = new Map(), repeated = [];
  for (const file of files) {
    const source = readFileSync(new URL(file, root), 'utf8');
    for (const [, id, event] of source.matchAll(/\$\('([\w-]+)'\)\.addEventListener\('(\w+)'/g)) {
      const key = `${id}:${event}`;
      if (seen.has(key)) repeated.push(`${key} (${seen.get(key)} y ${file})`);
      else seen.set(key, file);
    }
  }
  assert.deepEqual(repeated, []);
});
