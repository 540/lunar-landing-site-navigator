// A hidden body is named the same in every view (#337): «tapado» / «tapada».
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEXTS } from '../src/texts.js';

test('la etiqueta de la Tierra tapada dice «Tierra · tapada»', () => {
  assert.equal(TEXTS.mission.earthLabel(false), 'Tierra · tapada');
  assert.equal(TEXTS.mission.earthLabel(true), 'Tierra');
  assert.equal(TEXTS.mission.sunLabel(false), 'Sol · tapado');
});
