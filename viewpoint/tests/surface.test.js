// Look of the lunar surface (#393): the illustrative detail stays under the resolution of the relief and over the size of
// a pixel, the shoulder keeps the lit slopes from burning, and «Fuentes» says the detail is illustrative.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BAND, CRATERS, GRAZING, MAX_SLOPE, NOISE, TONE,
  craterCells, craterWeight, footprintKm, grazingStrength, noiseWavelengths, noiseWeight, surfaceGlsl, tone,
} from '../src/core/surface-detail.js';
import { TEXTS } from '../src/texts.js';
import { noteSections } from '../src/data-note.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readMeta = id => JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', id, 'meta.json'), 'utf8'));
// The grid steps of shackleton-rim: zone, two detail levels and the far ring.
const STEPS_KM = [0.15625, 0.078125, 0.01953125, 1.171875];
const TINY = 1e-9; // a footprint so small that only the limit of the relief counts

test('the detail stays under what the relief resolves: nothing the LOLA grid can show is invented', () => {
  for (const cell of STEPS_KM) {
    // a grid resolves waves from a few steps up: from there on the grain adds nothing
    for (const wavelength of noiseWavelengths()) {
      if (wavelength >= BAND.noiseHigh[1] * cell) assert.equal(noiseWeight(wavelength, TINY, cell), 0);
    }
    // a crater two steps across or more would be one the relief shows: none is drawn
    assert.equal(craterWeight(2 * cell, TINY, cell), 0);
    assert.equal(craterWeight(5 * cell, TINY, cell), 0);
    // and under one step the detail is whole
    assert.equal(craterWeight(0.5 * cell, TINY, cell), 1);
    assert.equal(noiseWeight(cell, TINY, cell), 1);
  }
});

test('a feature fades out before it is smaller than a pixel: no flicker', () => {
  const cell = 0.15625;
  for (const footprint of [0.00001, 0.001, 0.01]) {
    assert.equal(noiseWeight(footprint, footprint, cell), 0);
    assert.equal(noiseWeight(BAND.low[0] * footprint, footprint, cell), 0);
    assert.equal(craterWeight(footprint, footprint, cell), 0);
    assert.ok(noiseWeight(BAND.low[1] * footprint, footprint, 1e9) === 1);
  }
  // the weight grows with the size up to the limit of the relief: no jumps
  let last = 0;
  for (let size = 0.001; size < 0.02; size += 0.0005) {
    const w = noiseWeight(size, 0.002, 1e9);
    assert.ok(w >= last);
    last = w;
  }
});

test('the footprint of a pixel grows with the distance and with a grazing view', () => {
  const pixel = 0.001;
  assert.ok(Math.abs(footprintKm(1, pixel, 1) - 0.001) < 1e-12);
  assert.ok(footprintKm(2, pixel, 1) > footprintKm(1, pixel, 1));
  assert.ok(footprintKm(1, pixel, 0.1) > footprintKm(1, pixel, 1));
  assert.ok(Number.isFinite(footprintKm(1, pixel, 0)));
});

test('there is detail at every distance: from the far ring down to your boots', () => {
  const waves = noiseWavelengths(), cells = craterCells();
  assert.equal(waves.length, NOISE.octaves);
  assert.equal(cells.length, CRATERS.layers);
  // the coarsest grain reaches the step of the far ring, the finest is a couple of centimetres
  assert.ok(waves[0] >= 1.17 && waves.at(-1) < 0.00003);
  // craters from tens of metres down to a few centimetres across
  assert.ok(2 * CRATERS.radiusMax * cells[0] > 0.1 && 2 * CRATERS.radiusMin * cells.at(-1) < 0.00003);
  // each octave and layer overlaps the next: no band of sizes is left without detail
  for (let k = 1; k < waves.length; k++) assert.ok(waves[k - 1] / waves[k] < BAND.low[1] / BAND.low[0]);
  for (let k = 1; k < cells.length; k++) assert.ok(CRATERS.radiusMax * cells[k] > CRATERS.radiusMin * cells[k - 1]);
  // every crater, rim included (1.5 radii), stays inside its cell: its centre is between 0.3 and 0.7
  assert.ok(1.5 * CRATERS.radiusMax <= 0.3 + 1e-12);
});

test('the shoulder leaves the dark as it was and never burns the lit slopes', () => {
  // dark end: shadows and the ground the Sun grazes change by less than 5 %
  for (const light of [0.001, 0.01, 0.05]) assert.ok(Math.abs(tone(light) - light) / light < 0.05);
  // bright end: it never passes the ceiling, and still tells a brighter slope from a dimmer one
  let last = 0;
  for (let light = 0; light < 6; light += 0.05) {
    const out = tone(light);
    assert.ok(out < TONE.ceiling && out <= light + 1e-12);
    if (light > 0) assert.ok(out > last);
    last = out;
  }
  assert.equal(tone(-1), 0);
});

test('the bumps are gentler where the Sun grazes the ground, and never steeper than the limit', () => {
  assert.equal(grazingStrength(-0.5), GRAZING.min);
  assert.equal(grazingStrength(0), GRAZING.min);
  assert.equal(grazingStrength(GRAZING.fullCos), 1);
  assert.equal(grazingStrength(1), 1);
  assert.ok(grazingStrength(GRAZING.fullCos / 2) > GRAZING.min && grazingStrength(GRAZING.fullCos / 2) < 1);
  assert.ok(MAX_SLOPE <= Math.tan(20 * Math.PI / 180));
});

test('the shader carries the same numbers, takes no photo or albedo map, and only touches colour, normal and tone', () => {
  const glsl = surfaceGlsl();
  const all = Object.values(glsl).join('\n');
  assert.doesNotMatch(all, /sampler2D|texture2D|texture\(/); // computed from the position: no image
  assert.match(glsl.fragmentPars, new RegExp(`k < ${NOISE.octaves};`));
  assert.match(glsl.fragmentPars, new RegExp(`k < ${CRATERS.layers};`));
  assert.match(glsl.fragmentPars, new RegExp(String(TONE.ceiling).replace('.', '\\.')));
  assert.match(glsl.fragmentColor, new RegExp(String(GRAZING.fullCos).replace('.', '\\.')));
  // the vertex stage only passes the position on: the geometry (and with it the shadow map) is not moved
  assert.doesNotMatch(glsl.vertexMain, /gl_Position|transformed\s*[+\-*]?=/);
  assert.match(glsl.fragmentNormal, /normal = /);
  // modest devices draw one crater per cell
  assert.match(surfaceGlsl({ craterPasses: 1 }).fragmentPars, /j < 1;/);
  assert.match(glsl.fragmentPars, /j < 2;/);
  // every number is written as a GLSL float
  assert.doesNotMatch(all, /NaN|undefined|Infinity/);
});

test('«Fuentes» says the fine detail of the ground is illustrative, in every door', () => {
  const meta = readMeta('shackleton-rim');
  for (const verdictSource of [null, 'api', 'fake']) {
    const approx = noteSections(meta, verdictSource).find(s => s.title === TEXTS.dataNote.approxTitle);
    assert.ok(approx.lines.includes(TEXTS.dataNote.surfaceDetail));
  }
  assert.match(TEXTS.dataNote.surfaceDetail, /ilustrativos/);
  assert.match(TEXTS.dataNote.surfaceDetail, /veredicto/);
});

test('surfaceGlsl: `octaves` drops the finest octaves of grain, and by default keeps all of them (the cabin of the game, #393)', async () => {
  const { surfaceGlsl, NOISE } = await import('../src/core/surface-detail.js');
  assert.match(surfaceGlsl().fragmentPars, new RegExp(`k < ${NOISE.octaves};`));
  assert.match(surfaceGlsl({ octaves: 12 }).fragmentPars, /k < 12;/);
  assert.match(surfaceGlsl({ octaves: 99 }).fragmentPars, new RegExp(`k < ${NOISE.octaves};`));
});

test('surfaceGlsl: `cell` sets the grid step under each pixel; by default it is the mesh one, uSurfCell (the 3D sky of web/, #393)', () => {
  assert.match(surfaceGlsl().fragmentColor, /sfDetail\( vSurfP\.xz, sfFoot, uSurfCell \)/);
  const own = surfaceGlsl({ cell: 'max( 0.02, 0.15 * length( vSurfP.xz ) )' });
  assert.match(own.fragmentColor, /sfDetail\( vSurfP\.xz, sfFoot, max\( 0\.02, 0\.15 \* length\( vSurfP\.xz \) \) \)/);
  assert.equal(own.fragmentPars, surfaceGlsl().fragmentPars); // only where the step comes from changes
});
