// English of the South Pole Lookout (#283): the same keys and shapes as the Spanish dictionary, with Spanish as fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEXTS, texts, untranslatedKeys } from '../src/texts.js';
import { EN, reasonToEnglish } from '../src/texts.en.js';
import { formatDeg } from '../src/core/series.js';
import { dateTime } from '../../shared/format/time.js';
import { regionOptions } from '../src/core/regions.js';

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

test('English has every Spanish key, with the same shape and tutorial targets', () => {
  assert.deepEqual(untranslatedKeys(), []);
  for (const k of Object.keys(EN)) assert.ok(k in TEXTS, `«${k}» is in English but not in Spanish`);
  for (const k of Object.keys(TEXTS)) sameShape(TEXTS[k], EN[k], k);
  assert.deepEqual(EN.tutorialSteps.map(s => s.target), TEXTS.tutorialSteps.map(s => s.target));
});

test('figures and dates follow the locale of each language', () => {
  assert.equal(formatDeg(229.5968, 'en'), '229.6°');
  assert.equal(formatDeg(229.5968), '229,6°');
  assert.equal(dateTime('en', new Date('2027-01-15T00:00:00Z')), '15 Jan 2027 · 00:00 UTC');
  assert.equal(texts('en').dataNote.step(0.01953125), '19.5 m');
  assert.equal(texts('es').dataNote.step(0.01953125), '19,5 m');
});

test('mission viewer: site names and verdict titles by id and code, Spanish as fallback', () => {
  const M = texts('en').mission;
  assert.notEqual(M.siteName({ id: 'malapert', name: 'Macizo de Malapert' }), 'Macizo de Malapert');
  assert.equal(M.siteName({ id: 'unknown', name: 'Sitio' }), 'Sitio');
  assert.equal(M.verdictTitle({ code: 'unknown', title: 'Raro' }), 'Raro');
  for (const code of ['viable', 'marginal', 'not_viable']) assert.ok(M.verdictTitle({ code, title: '' }));
  assert.equal(texts('es').mission.verdictTitle({ code: 'viable', title: 'Viable' }), 'Viable');
});

test('verdict reasons of the planner templates come out in English; unknown text is kept', () => {
  const en = reasonToEnglish('Por poco: Sombra más larga: 10 h (la batería aguanta 12 h); Pendiente de 4,5° en 20 m (máximo 8°)');
  assert.doesNotMatch(en, /Sombra|batería|Pendiente|máximo|Por poco/);
  assert.match(en, /4\.5°/);
  assert.equal(reasonToEnglish('Algo nuevo'), 'Algo nuevo');
});

test('region selector names regions in the language in use, falling back to Spanish and then the id', () => {
  const metas = [{ name: { es: 'Macizo', en: 'Massif' } }, { name: { es: 'Solo español' } }, null];
  assert.deepEqual(regionOptions(['a', 'b', 'c'], metas, 'en').map(o => o.label), ['Massif', 'Solo español', 'c']);
  assert.deepEqual(regionOptions(['a', 'b', 'c'], metas).map(o => o.label), ['Macizo', 'Solo español', 'c']);
});
