// The real Earth of the shared skies (#487): where the textures live, what happens if the image fails, and no leftovers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EARTH_TEX, useRealEarth } from '../shared/render/earth-texture.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('las URL de las texturas de la Tierra caen en shared/render/tex/ y los ficheros existen', () => {
  const dir = path.join(ROOT, 'shared/render/tex');
  for (const [key, url] of Object.entries(EARTH_TEX)) {
    const file = fileURLToPath(url);
    assert.equal(path.dirname(file), dir, key);
    assert.ok(fs.existsSync(file), file);
  }
  assert.match(EARTH_TEX.day, /shared\/render\/tex\/earth-day-2k\.jpg$/);
});

test('con la imagen cargada, la textura la recibe y avisa', async () => {
  const calls = [];
  const texture = { image: 'procedural', needsUpdate: false, dispose() { calls.push(`dispose:${this.image}`); } };
  let asked = null, changed = 0;
  const ok = await useRealEarth(texture, { load: async (u) => { asked = u; return 'blue-marble'; }, onChange: () => changed++ });
  assert.deepEqual(calls, ['dispose:procedural'], 'dispose() runs before the image changes');
  assert.equal(ok, true);
  assert.equal(asked, EARTH_TEX.day);
  assert.equal(texture.image, 'blue-marble');
  assert.equal(texture.needsUpdate, true);
  assert.equal(changed, 1);
});

test('si la carga falla, la textura conserva la procedural', async () => {
  let disposed = 0;
  const texture = { image: 'procedural', needsUpdate: false, dispose() { disposed++; } };
  let changed = 0;
  const ok = await useRealEarth(texture, { load: async () => { throw new Error('sin red'); }, onChange: () => changed++ });
  assert.equal(ok, false);
  assert.equal(texture.image, 'procedural');
  assert.equal(texture.needsUpdate, false);
  assert.equal(changed, 0);
  assert.equal(disposed, 0);
});

test('el globo compartido, sky3d y moon3d usan la textura real y siguen teniendo la procedural', () => {
  for (const f of ['shared/render/sky-meshes.js', 'web/js/common/sky3d.js', 'rolegame/src/moon3d.js']) {
    const s = read(f);
    assert.match(s, /useRealEarth\(/, f);
    assert.match(s, /earthMapPixels\(/, f);
  }
});

test('cada llamada a makeEarthGlobe pasa onTexture (las escenas pintan a demanda)', () => {
  for (const f of ['viewpoint/src/scene.js', 'rolegame/src/cabin/scene.js']) {
    const s = read(f);
    assert.match(s, /makeEarthGlobe\(EARTH_RADIUS, \{ onTexture/, f);
  }
  assert.match(read('viewpoint/src/scene.js'), /makeEarth\(\(\) => draw\(\)\)/);
});

test('ningún fichero referencia home/tex/earth- y no hay copias duplicadas de las texturas', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of files) {
    if (f.startsWith('prototipo/') || f === 'tests/earth-texture.test.mjs' || !fs.existsSync(path.join(ROOT, f))) continue;
    if (/\.(jpg|png|gz|json|woff2?|bin)$/.test(f)) continue;
    assert.ok(!read(f).includes('home/tex/earth-'), `${f} cita home/tex/earth-`);
  }
  const copies = files.filter((f) => /(^|\/)earth-(day|night|clouds)-2k\.jpg$|(^|\/)earth-water-1k\.jpg$/.test(f));
  assert.equal(copies.length, 4, copies.join(', '));
  assert.ok(copies.every((f) => f.startsWith('shared/render/tex/')), copies.join(', '));
  assert.ok(!fs.existsSync(path.join(ROOT, 'home/tex/earth-day-2k.jpg')));
});

test('la portada carga las texturas de la Tierra desde shared/render/tex/', () => {
  const home = read('home/index.html');
  for (const f of ['earth-day-2k.jpg', 'earth-night-2k.jpg', 'earth-clouds-2k.jpg', 'earth-water-1k.jpg'])
    assert.ok(home.includes(`"../shared/render/tex/${f}"`), f);
});
