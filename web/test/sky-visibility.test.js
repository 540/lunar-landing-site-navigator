// When the sky block counts a body as seen (#269): with its whole disc over the relief, as the windows and the verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { marginOverRelief, overRelief } from '../js/common/sky-visibility.js';
import { EXPLANATIONS } from '../js/common/explanations.js';

test('se ve solo con el disco entero sobre el relieve; sin fullMargin decide el centro', () => {
  assert.equal(overRelief({ margin: 0.5, fullMargin: -0.45 }), false);
  assert.equal(overRelief({ margin: 1.5, fullMargin: 0.55 }), true);
  assert.equal(overRelief({ margin: 0.5 }), true);
  assert.equal(overRelief({ margin: -0.1 }), false);
  assert.equal(marginOverRelief({ margin: 0.5, fullMargin: -0.45 }), -0.45);
  assert.equal(marginOverRelief({ margin: 0.5 }), 0.5);
});

test('la explicación en directo da la Tierra por tapada con el centro sobre el relieve pero no el borde inferior', () => {
  const body = (margin, fullMargin) => ({ az: 10, el: 2, horizon: 2 - margin, margin, fullMargin });
  const text = EXPLANATIONS.panorama.live({ now: { sun: body(1.5, 1.23), earth: body(0.5, -0.45) } });
  assert.match(text, /Tierra:.*→ TAPADA \(margen del borde inferior −0,5°\)/);
  assert.doesNotMatch(text, /Tierra:.*SE VE/);
  assert.match(text, /Sol:.*→ SE VE \(margen del borde inferior 1,2°\)/);
});

test('el bloque del cielo decide con sky-visibility.js y no con el margen del centro', () => {
  const common = new URL('../js/common/', import.meta.url);
  const files = [
    ...readdirSync(common).filter(f => f.endsWith('.js')).map(f => new URL(f, common)),
    new URL('../js/application/csv-export.js', import.meta.url),
  ];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /margin > 0|margin <= 0/, `${file.pathname} no decide con margin > 0`);
  }
  for (const f of ['common/sky3d.js', 'common/charts.js', 'common/sky-polar.js', 'common/sun-elevation.js', 'common/explanations.js', 'application/csv-export.js']) {
    assert.match(readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8'), /from '[./]*(common\/)?sky-visibility\.js'/, `${f} importa sky-visibility.js`);
  }
});
