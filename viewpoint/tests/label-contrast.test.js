// Contrast of the Sun and Earth labels (#332): the page is always dark (color-scheme: dark), so the labels do not
// switch to light chips when the system is in light mode; on a light chip the Sun and Earth borders fall below 3:1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'viewpoint.css');

test('viewpoint.css no cambia con el tema del sistema: no contiene prefers-color-scheme', () => {
  assert.doesNotMatch(fs.readFileSync(CSS, 'utf8'), /prefers-color-scheme/);
});
