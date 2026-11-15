// The note under the Advanced and Replan maps says which relief is drawn (#331): the LOLA image, still loading, or the
// invented one when the image does not load; and whether the verdicts over the real relief are simulated.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { reliefNote } from '../js/common/relief-note.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('reliefNote: which relief is under the map', () => {
  test('ready with the data API: LOLA relief', () => assert.equal(reliefNote('ready', 'api'), 'relieve LOLA'));
  test('ready with the simulated engine: LOLA relief, verdicts from example data', () => {
    assert.equal(reliefNote('ready', 'fake'), 'relieve LOLA · veredictos con datos de ejemplo');
  });
  test('ready with no source yet (no search, or the windows still loading): LOLA relief, no claim of simulated verdicts', () => {
    assert.equal(reliefNote('ready', null), 'relieve LOLA');
    assert.equal(reliefNote('ready', undefined), 'relieve LOLA');
  });
  test('loading', () => assert.equal(reliefNote('loading', 'api'), 'cargando el relieve…'));
  test('failed: the invented relief, and it says so', () => {
    assert.match(reliefNote('failed', 'api'), /^relieve inventado/);
    assert.match(reliefNote('failed', 'fake'), /^relieve inventado/);
  });
});

describe('one loader for the LOLA relief image', () => {
  const PNG = 'assets/south-pole-relief.png';
  for (const view of ['js/views/advanced.js', 'js/views/replan.js']) {
    test(`${view} uses the shared loader`, () => {
      const src = read(view);
      assert.ok(!src.includes('new Image()'), 'creates its own Image');
      assert.ok(!src.includes(`'${PNG}'`), 'loads the PNG itself');
      assert.ok(src.includes('reliefImage('), 'does not use reliefImage()');
    });
  }
  test('the PNG path is only in js/common/map.js, which handles the error', () => {
    const map = read('js/common/map.js');
    assert.ok(map.includes(`'${PNG}'`));
    assert.match(map, /\.onerror\s*=/);
    const others = ['js/app.js', ...['views', 'common', 'application', 'adapters'].flatMap(dir => dirFiles(`js/${dir}`))]
      .filter(f => f !== 'js/common/map.js' && read(f).includes(`'${PNG}'`));
    assert.deepEqual(others, []);
  });
});

function dirFiles(dir) {
  return readdirSync(new URL(`../${dir}`, import.meta.url)).filter(f => f.endsWith('.js')).map(f => `${dir}/${f}`);
}
