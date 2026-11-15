// The lander takes the verdict colours (ok / warn / bad) from web/styles/tokens.css (#341): text checks on its CSS and HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/styles/lander.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('index.html enlaza los tokens del sistema de diseño', () => {
  assert.match(html, /href="\.\.\/web\/styles\/tokens\.css"/);
});

test('--ok, --warn y --bad salen de los tokens', () => {
  assert.match(css, /--ok:\s*var\(--color-map-ok\);/);
  assert.match(css, /--warn:\s*var\(--color-map-warn\);/);
  assert.match(css, /--bad:\s*var\(--color-map-bad\);/);
  for (const banned of ['#7fd69a', '#f2c46b', '#f39283']) assert.ok(!css.toLowerCase().includes(banned), `sobra ${banned}`);
});
