// Days of the mission viewer with a decimal comma (#329): «día 3 de 6,5», not «6.5».
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEXTS } from '../src/texts.js';

test('instant, sliderValue y announce escriben los días con coma', () => {
  const texts = [
    TEXTS.mission.instant('15 ene', 3, 6.5),
    TEXTS.mission.sliderValue(3, 6.5, '15 ene'),
    TEXTS.mission.announce(3, 6.5, '15 ene', true, false),
  ];
  for (const text of texts) {
    assert.ok(text.includes('de 6,5'), text);
    assert.ok(!text.includes('6.5'), text);
  }
});

test('la línea de tiempo del Mirador pasa el día por fmtNum y no le añade «,0»', () => {
  assert.equal(TEXTS.timeline.sliderValue(7, '15 ene'), 'Día 7 de 60 · 15 ene');
  assert.equal(TEXTS.timeline.announce(60, '15 ene'), 'Día 60 de 60 · 15 ene');
  assert.equal(TEXTS.timeline.sliderValue(2.5, '15 ene'), 'Día 2,5 de 60 · 15 ene');
});
