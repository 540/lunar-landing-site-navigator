// Render savings of G1.3 (#141) that leave the image unchanged: text checks on home/index.html, like render-bench.test.mjs.
// No Chrome and no GPU: the image is compared by hand with the render bench (npm run bench:render / bench:diff).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.readFileSync(path.join(ROOT, 'home/index.html'), 'utf8');
// The globe and its shader live in shared/render/moon-globe.js since G1.2 (#140).
const globe = fs.readFileSync(path.join(ROOT, 'shared/render/moon-globe.js'), 'utf8');

/** Source of the function `name`, from its header to the brace that closes it. */
function functionSource(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `falta la función ${name}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  assert.fail(`la función ${name} no se cierra`);
}

test('POLE_DISP: las 12 muestras del anillo solo cerca del polo, dentro de if(pf<1.)', () => {
  const m = globe.match(/export const POLE_DISP = `([\s\S]*?)`;/);
  assert.ok(m, 'falta POLE_DISP');
  const shader = m[1];
  const loop = shader.indexOf('for(int i=0;i<12;i++)');
  const branch = shader.indexOf('if(pf<1.){');
  assert.ok(loop >= 0, 'falta el bucle de 12 muestras');
  assert.ok(branch >= 0 && branch < loop, 'el bucle no está dentro de if(pf<1.)');
  const body = shader.slice(branch);
  assert.ok(body.indexOf('}') > body.indexOf('ra/=12.'), 'la media del anillo se sale del if');
  // Far from the pole (pf==1.) the height is the direct sample, as mix() gave before.
  assert.match(shader, /float hh=texture2D\(displacementMap,vDisplacementMapUv\)\.x;/);
  assert.match(body, /hh=mix\(ra,hh,pf\)/);
  // The Moon material and the shadow depth material both use it.
  assert.equal(globe.match(/replace\('#include <displacementmap_vertex>', POLE_DISP\)/g)?.length, 2);
});

test('frame: no pinta con la pantalla de misión delante ni con la página oculta, y el bucle sigue', () => {
  const frame = functionSource(home, 'frame');
  const guard = frame.match(/if\(([^)]*\)?[^)]*)\)\{([^}]*)return;\}/);
  assert.ok(guard, 'falta la salida temprana de frame');
  assert.match(guard[1], /document\.hidden/);
  assert.match(guard[1], /mode==="screen"/);
  assert.match(guard[1], /mode==="screen"&&!anim/, 'tiene que seguir pintando mientras dura el zoom a la pantalla de misión');
  assert.match(guard[2], /requestAnimationFrame\(frame\)/, 'al saltarse el frame, el bucle tiene que seguir');
  assert.match(guard[2], /last=0/, 'al volver, el primer frame no usa el tiempo acumulado');
  const render = frame.indexOf('renderer.render(scene,camera)');
  assert.ok(render > frame.indexOf(guard[0]), 'renderer.render tiene que ir después de la salida temprana');
  assert.match(home, /document\.addEventListener\("visibilitychange",\(\)=>\{last=0;\}\)/);
});

test('la textura de 4k libera la de 2k con dispose() al sustituirla', () => {
  const load = home.match(/tex\(MOON_TEX\.color4k[^\n]*/);
  assert.ok(load, 'falta la carga de la textura de 4k');
  assert.match(load[0], /if\(!err\)\{ANISO\.delete\(MOON\.useColor\(t4\)\);/);
  assert.match(globe, /useColor\(texture\) \{ const prev = material\.map; material\.map = texture; material\.needsUpdate = true; prev\.dispose\(\);/);
  // If the 4k one fails, the 2k one stays: dispose() only on success.
  assert.doesNotMatch(load[0].slice(load[0].indexOf('else')), /dispose/);
});
