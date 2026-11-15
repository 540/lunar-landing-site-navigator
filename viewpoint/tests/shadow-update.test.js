// The Sun's shadow map is redrawn only when the Sun moves (G1.3, #141): text checks on scene.js, without WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scene = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src/scene.js'), 'utf8');

test('la luz del Sol no recalcula la sombra en cada render, solo al crear la escena', () => {
  const created = scene.indexOf('const light = new THREE.DirectionalLight(');
  const setSun = scene.indexOf('function setSun(');
  const init = scene.slice(created, setSun);
  assert.match(init, /light\.shadow\.autoUpdate = false;/);
  assert.match(init, /light\.shadow\.needsUpdate = true;/);
});

test('setSun pide redibujar la sombra al mover la luz', () => {
  const start = scene.indexOf('function setSun(');
  const end = scene.indexOf('\n  }\n', start);
  const body = scene.slice(start, end);
  assert.match(body, /light\.shadow\.needsUpdate = true;/);
  assert.ok(body.lastIndexOf('light.shadow.needsUpdate') > body.indexOf('light.position.set('), 'needsUpdate después de mover la luz');
});
