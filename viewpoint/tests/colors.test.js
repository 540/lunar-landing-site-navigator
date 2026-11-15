// The Mirador takes the colours of the Sun and the Earth from web/styles/tokens.css (#334): text checks on viewpoint.css.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/styles/viewpoint.css'), 'utf8');

test('--sun y --earth salen de los tokens del mapa', () => {
  assert.match(css, /--sun:\s*var\(--color-map-sun\);/);
  assert.match(css, /--earth:\s*var\(--color-map-earth\);/);
});

test('viewpoint.css no escribe a mano los colores del Sol y de la Tierra', () => {
  for (const banned of ['#f3a83a', '#5aa2f2']) assert.ok(!css.toLowerCase().includes(banned), `sobra ${banned}`);
});

// #341: ok / warn / bad are the canonical ones of tokens.css (the -400 tones of the map), not a palette of the Mirador.
test('--ok, --warn y --bad salen de los tokens', () => {
  assert.match(css, /--ok:\s*var\(--color-map-ok\);/);
  assert.match(css, /--warn:\s*var\(--color-map-warn\);/);
  assert.match(css, /--bad:\s*var\(--color-map-bad\);/);
  for (const banned of ['#5fd08a', '#f3c23a', '#ff7a6b']) assert.ok(!css.toLowerCase().includes(banned), `sobra ${banned}`);
});
