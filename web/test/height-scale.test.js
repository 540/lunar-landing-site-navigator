// Every view says the same about the height of the relief (#335): a fixed factor → «altura ×N», 1 → «altura real»,
// a chart without a fixed factor (the 2D sky and the compass) → «altura no a escala».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

// The texts of the views live in the i18n dictionaries (web/js/i18n/): Planificar's in plan.js, Avanzado's note in common.js.
test('Planificar, su HTML y el sistema de diseño dicen «altura no a escala», no «altura exagerada»', () => {
  for (const file of ['../js/i18n/plan.js', '../index.html', '../design-system.html']) {
    const text = source(file);
    assert.doesNotMatch(text, /altura exagerada/, file);
    assert.match(text, /altura no a escala/, file);
  }
});

test('la nota del cielo 2D de Avanzado dice «altura no a escala»', () => {
  assert.match(source('../js/views/advanced.js'), /common\.height\.noScale/);
  assert.match(source('../js/i18n/common.js'), /'common\.height\.noScale': ' · altura no a escala'/);
});

test('el ×3 del cielo 3D no se presenta como el estirado del 2D', () => {
  assert.doesNotMatch(source('../js/common/sky3d.js'), /as the 2D chart stretches/);
});
