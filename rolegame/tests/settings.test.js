// J13.3 (#311): header as in the mock-up, with «Ajustes» (quality, light mode, reduced motion) and the steps bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUALITY_KEY, QUALITY_CHOICES, qualityParams, pressedQuality, trapIndex } from '../src/settings.js';
import { mapQuality } from '../src/map-quality.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const main = readFileSync(join(root, 'src/main.js'), 'utf8');
const menu = html.slice(html.indexOf('id="settings-menu"'), html.indexOf('</header>'));

test('«Ajustes» abre un menú con la calidad, el modo ligero y reducir movimiento', () => {
  assert.match(html, /id="settings-btn" aria-haspopup="dialog" aria-expanded="false" aria-controls="settings-menu"/);
  assert.match(html, /id="settings-menu" role="dialog" data-aria-label="settings" hidden/);
  for (const q of QUALITY_CHOICES) assert.match(menu, new RegExp(`data-quality="${q}"`));
  assert.match(menu, /id="map-btn" role="switch"/);
  assert.match(menu, /id="motion-btn" role="switch"/);
  // Nothing of it is left loose in the header.
  const header = html.slice(html.indexOf('<header'), html.indexOf('id="settings-menu"'));
  assert.doesNotMatch(header, /id="(map|motion)-btn"/);
});

test('cada interruptor hace lo mismo que el botón suelto de antes', () => {
  assert.match(main, /motionSaved = toggledMotion\(reduced\(\)\)/);
  assert.match(main, /save\(MOTION_KEY, motionSaved\)/);
  assert.match(main, /motionBtn\.setAttribute\('aria-checked'/);
  assert.match(main, /const next = toggledMapMode\(game\?\.mapModeInUse\(\) \?\? 'light'\)/);
  assert.match(main, /mapBtn\.setAttribute\('aria-checked'/);
});

test('el menú se cierra con Escape, devuelve el foco y lo atrapa con Tab', () => {
  assert.match(main, /ev\.key === 'Escape'[^\n]*setMenu\(false, \{ focusButton: true \}\)/);
  assert.match(main, /trapIndex\(/);
  assert.equal(trapIndex(0, 4), 1);
  assert.equal(trapIndex(3, 4), 0, 'de la última a la primera');
  assert.equal(trapIndex(0, 4, true), 3, 'Mayús+Tab desde la primera va a la última');
  assert.equal(trapIndex(-1, 4), 0, 'fuera del menú entra por la primera');
  assert.equal(trapIndex(-1, 4, true), 3);
  assert.equal(trapIndex(0, 0), -1);
});

test('calidad: ?q= manda, luego lo elegido en «Ajustes» y si no la calibración de la portada', () => {
  assert.equal(QUALITY_KEY, 'llsn.gameQuality');
  assert.equal(qualityParams('?q=medio', 'bajo').get('q'), 'medio');
  assert.equal(qualityParams('?level=mid', 'bajo').get('q'), 'bajo');
  assert.equal(qualityParams('?level=mid', 'bajo').get('level'), 'mid');
  assert.equal(qualityParams('', null).get('q'), null);
  assert.equal(qualityParams('', 'cualquiera').get('q'), null, 'un valor guardado raro no cuenta');
  const q = (saved, stored) => mapQuality({ params: qualityParams('', saved), stored, webgl: true }).level;
  assert.equal(q('bajo', 'alto'), 'bajo', 'lo elegido gana a la calibración');
  assert.equal(q(null, 'alto'), 'alto');
  assert.equal(mapQuality({ params: qualityParams('', 'bajo'), webgl: true }).penumbra, false);
  assert.equal(pressedQuality('alto'), 'alto');
  assert.equal(pressedQuality('medio'), 'alto', 'medio también tiene penumbra');
  assert.equal(pressedQuality('bajo'), 'bajo');
  assert.equal(pressedQuality(undefined), 'alto');
});

test('la barra de pasos va bajo la cabecera y sus pasos llevan a cada prueba', () => {
  assert.match(html, /<\/header>\s*<!--[^>]*-->\s*<nav class="stepbar" id="stepbar" data-aria-label="stepsLabel"><\/nav>/);
  assert.match(main, /stepsHost: document\.getElementById\('stepbar'\)/);
  const panel = readFileSync(join(root, 'src/intro-panel.js'), 'utf8');
  assert.match(panel, /export function stepsBar\(phase, trials, texts, onPick = null\)/);
  assert.match(panel, /button\('steps__go', '', \(\) => onPick\(id\)\)/);
  const game = readFileSync(join(root, 'src/game.js'), 'utf8');
  assert.match(game, /if \(id === 'play'\) \{ if \(phase !== 'play'\) startPlay\(\); return; \}/);
});

test('los textos de «Ajustes» están en los dos idiomas', () => {
  for (const lang of ['es', 'en']) {
    const T = texts(lang);
    for (const k of ['settings', 'qualityTitle', 'qualityHigh', 'qualityLow', 'qualityNoteReload', 'qualityNoteLight', 'lightMap', 'lightMapDesc', 'motion', 'motionDesc']) {
      assert.equal(typeof T[k], 'string', `${lang}.${k}`);
    }
  }
  assert.equal(texts('es').settings, 'Ajustes');
  assert.equal(texts('en').settings, 'Settings');
});
