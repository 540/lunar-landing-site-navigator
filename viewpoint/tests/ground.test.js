// The ground on foot (E3, #181): where the illustrative fine texture may act (core/surface-detail.js, #393), its switch, and that it is said.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { craterWeight, detailStrength, noiseWeight } from '../src/core/surface-detail.js';
import { TEXTS } from '../src/texts.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const readMeta = id => JSON.parse(fs.readFileSync(path.join(DATA, id, 'meta.json'), 'utf8'));

test('fine texture: it may add detail only below the DEM resolution of each level (5 m ground, 19.5 m level, 156 m zone)', () => {
  const steps = id => [readMeta(id), ...(readMeta(id).detail ?? [])].map(l => l.grid.stepKm);
  assert.ok(steps('shackleton-rim').at(-1) < 0.005, 'the 5 m ground'); // the finest level sets the limit under your boots
  assert.equal(steps('mouton').length, 1);
  for (const id of ['shackleton-rim', 'gerlache', 'mouton']) {
    for (const cell of steps(id)) {
      // a crater two cells across, or a wave of four, is something the relief of that level shows: not invented
      assert.equal(craterWeight(2 * cell, 1e-9, cell), 0, id);
      assert.equal(noiseWeight(4 * cell, 1e-9, cell), 0, id);
      assert.equal(craterWeight(0.5 * cell, 1e-9, cell), 1, id);
    }
  }
});

test('«Textura fina»: on by default, and off only takes the detail away on foot', () => {
  assert.equal(detailStrength(), 1);
  assert.equal(detailStrength({ foot: true, micro: true }), 1);
  assert.equal(detailStrength({ foot: true, micro: false }), 0);
  assert.equal(detailStrength({ foot: false, micro: false }), 1); // the drone keeps it: the button is only on foot
});

test('fine texture: it says it is illustrative, in the button and in «Fuentes»', () => {
  assert.match(TEXTS.ground.microTitle, /ilustrativa.*no son rocas ni cráteres reales/);
  assert.match(TEXTS.dataNote.micro, /ilustrativa.*no son rocas ni cráteres reales/);
});
