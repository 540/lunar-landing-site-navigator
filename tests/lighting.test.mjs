// Light and colour of the regolith shared by the Mirador, the game's cabin and the 3D sky (shared/render/lighting.js,
// #339): the values of the decision, and text checks that the three scenes take their lights from the module and only
// choose their exposure. The home keeps its intensities (its render bench must give the same picture).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AMBIENT, BOUNCE, EARTH, earthLightElevation, earthLightIntensity, REGOLITH, SUN, TONE_MAPPING } from '../shared/render/lighting.js';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const SCENES = {
  'viewpoint/src/scene.js': '../../shared/render/lighting.js',
  'rolegame/src/cabin/scene.js': '../../../shared/render/lighting.js',
  'web/js/common/sky3d.js': '../../../shared/render/lighting.js',
};

test('lighting.js tiene los valores decididos en #339', () => {
  assert.equal(REGOLITH, 0xadaaa3);
  assert.deepEqual({ ...SUN }, { color: 0xfff4e6, intensity: 30 });
  assert.deepEqual({ ...AMBIENT }, { color: 0xbfc8d6, intensity: 0.05 });
  assert.equal(BOUNCE.color, 0xd8d2c8);
  assert.equal(BOUNCE.intensity, 0.8);
  assert.deepEqual({ ...EARTH }, { color: 0x9fb8e8, intensity: 0.3, minElevationDeg: 25, fadeDeg: 2 });
  assert.equal(TONE_MAPPING, 'ACESFilmicToneMapping');
});

test('la luz de la Tierra se apaga bajo el horizonte y llega al menos desde 25°', () => {
  for (const el of [-10, -0.5, 0]) assert.equal(earthLightIntensity(el), 0, `Tierra a ${el}°`);
  assert.equal(earthLightIntensity(1), EARTH.intensity / 2);
  for (const el of [2, 5, 40]) assert.equal(earthLightIntensity(el), EARTH.intensity, `Tierra a ${el}°`);
  for (const el of [-10, 2, 5, 25]) assert.equal(earthLightElevation(el), 25, `Tierra a ${el}°`);
  assert.equal(earthLightElevation(40), 40);
});

test('el Mirador, la cabina y el cielo 3D colocan y encienden la luz de la Tierra con la misma regla', () => {
  for (const file of Object.keys(SCENES)) {
    const src = read(file);
    assert.match(src, /intensity = earthLightIntensity\(/, `${file} no apaga la luz de la Tierra bajo el horizonte`);
    assert.match(src, /earthLightElevation\(/, `${file} no eleva la luz de la Tierra`);
  }
});

test('los valores compartidos no se pueden cambiar desde una escena', () => {
  for (const v of [SUN, AMBIENT, BOUNCE, EARTH]) assert.ok(Object.isFrozen(v));
});

for (const [file, from] of Object.entries(SCENES)) {
  const src = read(file);

  test(`${file} importa sus luces de shared/render/lighting.js`, () => {
    assert.ok(src.includes(`from '${from}';`), 'falta el import de lighting.js');
    for (const name of ['SUN', 'AMBIENT', 'EARTH', 'TONE_MAPPING']) assert.match(src, new RegExp(`\\b${name}\\.|THREE\\[${name}\\]`), `no usa ${name}`);
  });

  test(`${file} no define colores ni intensidades propios para el Sol, el ambiente, el rebote y la Tierra`, () => {
    // An environment light built with a literal colour or a literal intensity (0, off until it is placed, is allowed)
    const literal = /new THREE\.(Ambient|Directional|Hemisphere)Light\(\s*(0x[0-9a-f]+|[^,)]*,\s*(?!0\s*\))[0-9.]+\s*\))/gi;
    assert.deepEqual(src.match(literal) ?? [], []);
    for (const old of ['0xfff4e6', '0xd8d2c8', '0x9fb8e8', '0x9fc4ff', '0xb8c4d8']) assert.ok(!src.includes(old), `sobra ${old}`);
    assert.doesNotMatch(src, /\b(SUN_INTENSITY|BOUNCE_FILL_INTENSITY|EARTH_FILL_INTENSITY)\b/);
  });

  test(`${file} usa ACES y solo elige su exposición`, () => {
    assert.match(src, /renderer\.toneMapping = THREE\[TONE_MAPPING\];/);
    assert.match(src, /renderer\.toneMappingExposure = EXPOSURE;/);
    assert.ok(!/ToneMapping\b(?!_)/.test(src.replace(/THREE\[TONE_MAPPING\]/g, '').replace(/toneMapping/g, '')), 'otro mapeo de tonos');
  });
}

test('el suelo del Mirador, de la cabina y del cielo 3D parte del regolito común', () => {
  assert.match(read('viewpoint/src/terrain-material.js'), /const TERRAIN_COLOR = REGOLITH;/);
  // The cabin and the 3D sky draw their ground with the Mirador's material (createTerrainLook, #393, #403).
  for (const file of ['rolegame/src/cabin/scene.js', 'web/js/common/sky3d.js']) {
    const src = read(file);
    assert.match(src, /import \{ createTerrainLook \} from '[./]+viewpoint\/src\/terrain-material\.js';/, file);
    assert.match(src, /createTerrainLook\(\{/, file);
  }
});

test('la portada solo toma los colores que ya coincidían y conserva sus intensidades (banco de render)', () => {
  const home = read('home/index.html');
  assert.match(home, /import \{AMBIENT,SUN\} from "\.\.\/shared\/render\/lighting\.js";/);
  assert.match(home, /new THREE\.DirectionalLight\(SUN\.color,3\.4\)/);
  assert.match(home, /new THREE\.AmbientLight\(AMBIENT\.color,\.05\)/);
  assert.match(home, /new THREE\.DirectionalLight\(0x7f9fd0,\.22\)/);
  assert.match(home, /toneMappingExposure=1\.3;/);
});

test('el traje del Mirador recibe la misma luz que antes de #339 (color × intensidad × exposición, ±5 %)', () => {
  // The suit has lights of its own (layer 1). #339 gave them the shared colours and lowered the exposure (0.85 → 0.75):
  // their strengths make up for both, so the suit looks as it did. The reference is the Mirador before #339.
  const BEFORE = {
    exposure: 0.85, sun: [0xfff4e6, 3.2], ambient: [0xffffff, 0.3], lamp: [0xf2f5ff, 0.9],
    hemi: { sky: 0x1a1c20, ground: 0x8f8b84, intensity: 1.5 },
  };
  const src = read('viewpoint/src/scene.js');
  const num = (re) => Number(src.match(re)[1]);
  const SHARED = { REGOLITH, 'AMBIENT.color': AMBIENT.color, 'SUN.color': SUN.color };
  const hex = (name) => SHARED[name] ?? Number(name);
  const bounce = src.match(/const BODY_BOUNCE = \{ sky: ([\w.]+), ground: ([\w.]+), intensity: ([\d.]+) \};/);
  const lamp = src.match(/const BODY_LAMP = \{ color: ([\w.]+), intensity: ([\d.]+) \};/);
  assert.ok(bounce && lamp, 'no encuentro BODY_BOUNCE o BODY_LAMP en viewpoint/src/scene.js');
  assert.match(src, /new THREE\.DirectionalLight\(SUN\.color, BODY_SUN_INTENSITY\)/);
  assert.match(src, /new THREE\.AmbientLight\(AMBIENT\.color, BODY_AMBIENT\)/);
  assert.match(src, /new THREE\.HemisphereLight\(BODY_BOUNCE\.sky, BODY_BOUNCE\.ground, BODY_BOUNCE\.intensity\)/);
  assert.match(src, /new THREE\.DirectionalLight\(BODY_LAMP\.color, BODY_LAMP\.intensity\)/);
  const NOW = {
    exposure: num(/const EXPOSURE = ([\d.]+);/),
    sun: [SUN.color, num(/const BODY_SUN_INTENSITY = ([\d.]+);/)],
    ambient: [AMBIENT.color, num(/const BODY_AMBIENT = ([\d.]+);/)],
    lamp: [hex(lamp[1]), Number(lamp[2])],
    hemi: { sky: hex(bounce[1]), ground: hex(bounce[2]), intensity: Number(bounce[3]) },
  };
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luma = (h) => 0.2126 * lin((h >> 16) / 255) + 0.7152 * lin(((h >> 8) & 255) / 255) + 0.0722 * lin((h & 255) / 255);
  // What reaches the tone mapping: luminance of the colour × intensity × exposure (ACES only sees the product).
  const light = (v) => ({
    sol: luma(v.sun[0]) * v.sun[1] * v.exposure,
    'lámpara del casco': luma(v.lamp[0]) * v.lamp[1] * v.exposure,
    'lado en sombra, mirando al suelo': (luma(v.ambient[0]) * v.ambient[1] + luma(v.hemi.ground) * v.hemi.intensity) * v.exposure,
    'lado en sombra, de perfil': (luma(v.ambient[0]) * v.ambient[1] + ((luma(v.hemi.ground) + luma(v.hemi.sky)) / 2) * v.hemi.intensity) * v.exposure,
    'lado en sombra, mirando arriba': (luma(v.ambient[0]) * v.ambient[1] + luma(v.hemi.sky) * v.hemi.intensity) * v.exposure,
  });
  const before = light(BEFORE), now = light(NOW);
  for (const k of Object.keys(before)) {
    const change = now[k] / before[k] - 1;
    assert.ok(Math.abs(change) <= 0.05, `traje, ${k}: ${(100 * change).toFixed(1)} % frente a antes de #339`);
  }
});
