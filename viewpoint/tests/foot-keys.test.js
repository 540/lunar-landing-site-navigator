// E3.6: the keys of the view on foot (R watch, F flag, V view) with the guards of the window handler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footCommand } from '../src/core/foot-keys.js';

const key = (k, extra = {}) => ({ key: k, target: { tagName: 'CANVAS' }, ...extra });

test('f and F pick up or plant the flag; r and v keep their commands', () => {
  assert.equal(footCommand(key('f')), 'flag');
  assert.equal(footCommand(key('F')), 'flag');
  assert.equal(footCommand(key('r')), 'watch');
  assert.equal(footCommand(key('V')), 'view');
  assert.equal(footCommand(key('g')), null);
});

test('a held key does not repeat the action', () => {
  assert.equal(footCommand(key('f', { repeat: true })), null);
});

test('typing in a field, a modifier or an open modal does not pick up or plant the flag', () => {
  assert.equal(footCommand(key('f', { target: { tagName: 'INPUT' } })), null);
  assert.equal(footCommand(key('f', { target: { tagName: 'TEXTAREA' } })), null);
  assert.equal(footCommand(key('f', { ctrlKey: true })), null);
  assert.equal(footCommand(key('f', { metaKey: true })), null);
  assert.equal(footCommand(key('f'), { modal: true }), null);
});
