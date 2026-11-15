// English of the onboard landing (#283): the same keys and shapes as the Spanish dictionary, with Spanish as fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEXTS, texts, untranslatedKeys, formatNumber, fixed } from '../src/texts.js';
import { EN, COCKPIT } from '../src/texts.en.js';
import { CONTROLS } from '../src/sim/controls.js';

function sameShape(es, en, path) {
  if (typeof es === 'function') {
    assert.equal(typeof en, 'function', `${path} is not a function in English`);
    assert.equal(en.length, es.length, `${path}: different arity`);
  } else if (Array.isArray(es)) {
    assert.ok(Array.isArray(en), `${path} is not a list in English`);
    assert.equal(en.length, es.length, `${path}: different length`);
    es.forEach((item, i) => sameShape(item, en[i], `${path}[${i}]`));
  } else if (es && typeof es === 'object') {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort(), `${path}: different keys`);
    for (const k of Object.keys(es)) sameShape(es[k], en[k], `${path}.${k}`);
  } else {
    assert.equal(typeof en, typeof es, `${path}: different type`);
  }
}

test('texts(lang): Spanish by default, English with Spanish fallback', () => {
  assert.equal(texts('es'), TEXTS);
  assert.equal(texts('fr'), TEXTS);
  for (const k of Object.keys(TEXTS)) assert.ok(k in texts('en'), k);
});

test('English has every Spanish key, with the same shape', () => {
  assert.deepEqual(untranslatedKeys(), []);
  for (const k of Object.keys(EN)) assert.ok(k in TEXTS, `«${k}» is in English but not in Spanish`);
  for (const k of Object.keys(TEXTS)) sameShape(TEXTS[k], EN[k], k);
});

test('every engraved control label and rotary position has English', () => {
  const words = new Set(CONTROLS.filter(c => c.kind !== 'breaker').flatMap(c => [c.label, ...(c.positions ?? [])]));
  const same = new Set(['RCS', 'OFF', 'ALT', 'ACT', 'NAV', 'VEL', 'PROG', 'VERB', 'COM', 'ECLSS', 'ELEC', 'IMU', 'GNC 2', 'HOLD ACT', 'TRIM',
    'UHF', 'VHF A', 'VHF B', 'TRANSPONDER', 'BAT 1', 'BAT 2', 'BAT 3', 'BAT 4', 'BUS A', 'BUS B', 'AUDIO CDR', 'AUDIO PLT', 'INTERCOM', 'VOX']);
  const missing = [...words].filter(w => !/^\d+$/.test(w) && !same.has(w) && !(w in COCKPIT));
  assert.deepEqual(missing, []);
  assert.equal(texts('es').cockpit('TREN'), 'TREN');
  assert.equal(texts('en').cockpit('TREN'), 'GEAR');
  assert.equal(texts('en').cockpit('SIN TRADUCIR'), 'SIN TRADUCIR');
});

test('the cockpit screens and the cabin signs only draw labels the English map knows', () => {
  for (const file of ['displays.js', 'cabin.js', 'panels.js']) {
    const src = readFileSync(new URL(`../src/scene/${file}`, import.meta.url), 'utf8');
    const literals = [...src.matchAll(/'([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9₂ ·/%°()m]+[A-ZÁÉÍÓÚÑ)%°])'/g)].map(m => m[1]);
    const unknown = literals.filter(t => !(t in COCKPIT) && !['ON', 'OFF', 'AUTO', 'MANUAL', 'RCS', 'YXZ', 'BUS A / BUS B', 'O₂'].includes(t));
    assert.deepEqual(unknown, [], file);
  }
});

test('figures follow the locale of each language', () => {
  assert.equal(formatNumber(2100.5, 1, 'en'), '2,100.5');
  assert.equal(formatNumber(2100.5, 1, 'es'), '2.100,5');
  assert.equal(fixed(1.25, 1, 'en'), '1.3');
  assert.equal(fixed(1.25, 1, 'es'), '1,3');
  assert.equal(formatNumber(1234, 0, 'es'), '1.234');
  assert.equal(fixed(-3.24, 1, 'es'), '−3,2');
  assert.equal(fixed(2100, 0, 'es'), '2100', 'the cockpit cells are fixed-width: no thousands grouping');
  assert.equal(fixed(2100, 0, 'es').padStart(4, ' ').length, 4);
  assert.equal(fixed(4600.5, 1, 'en'), '4600.5');
  assert.equal(texts('en').radio.height(500, -3.24), 'Pilot: 500 metres, descending at 3.2.');
});
