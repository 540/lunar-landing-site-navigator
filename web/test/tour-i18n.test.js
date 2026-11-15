// Every step of the tutorials (common/tour.js) has its title and text in both languages (i18n/tour.js). tour.js
// imports the page state, so its steps are read from the source instead of importing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { es, en } from '../js/i18n/tour.js';

test('cada paso del tutorial tiene su título y su texto en español y en inglés', () => {
  const src = readFileSync(new URL('../js/common/tour.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const TOURS'), src.indexOf('\n};', src.indexOf('export const TOURS')));
  const keys = [];
  let view = null;
  for (const line of body.split('\n')) {
    const v = line.match(/^ {2}(\w+): \[/);
    if (v) view = v[1];
    const s = line.match(/\{ id: '([\w-]+)'/);
    if (s) keys.push(`tour.${view}.${s[1]}.title`, `tour.${view}.${s[1]}.text`);
  }
  assert.ok(keys.length > 20, 'no se han leído los pasos de tour.js');
  for (const k of keys) {
    assert.equal(typeof es[k], 'string', `${k} falta en español`);
    assert.equal(typeof en[k], 'string', `${k} falta en inglés`);
  }
});
