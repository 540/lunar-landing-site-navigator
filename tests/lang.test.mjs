import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickLang, LANGS, STORAGE_KEY, langFromSearch, translator, missingKeys, extraKeys, withLang,
} from '../shared/i18n/lang.js';

test('pickLang: la dirección manda, luego lo guardado, luego el navegador y, sin nada, español', () => {
  assert.equal(pickLang({ query: 'en', saved: 'es', languages: ['es-ES'] }), 'en');
  assert.equal(pickLang({ query: 'es', saved: 'en', languages: ['en-US'] }), 'es');
  assert.equal(pickLang({ query: 'fr', saved: 'en', languages: ['es-ES'] }), 'en');
  assert.equal(pickLang({ saved: null, languages: ['en-US'] }), 'en');
  assert.equal(pickLang({ saved: null, languages: ['es-ES'] }), 'es');
  assert.equal(pickLang({ saved: 'es', languages: ['en-US'] }), 'es');
  assert.equal(pickLang({ saved: 'en', languages: ['es-ES'] }), 'en');
  assert.equal(pickLang({ saved: 'fr', languages: ['es-AR'] }), 'es');
  assert.equal(pickLang({ saved: 'fr', languages: ['de-DE'] }), 'en');
  assert.equal(pickLang({ languages: [] }), 'es');
  assert.equal(pickLang(), 'es');
});

test('langFromSearch: solo idiomas conocidos', () => {
  assert.equal(langFromSearch('?lang=en'), 'en');
  assert.equal(langFromSearch('?data=fake&lang=es'), 'es');
  assert.equal(langFromSearch('?lang=fr'), null);
  assert.equal(langFromSearch(''), null);
  assert.equal(langFromSearch(undefined), null);
});

test('idiomas y clave de almacenamiento', () => {
  assert.deepEqual(LANGS, ['es', 'en']);
  assert.equal(STORAGE_KEY, 'llsn.lang');
});

test('translator: el idioma en uso, el español si falta la clave y la clave si falta en los dos', () => {
  const dicts = {
    es: { a: 'Sol', b: 'Tierra', n: ({ h }) => `${h} h`, tpl: 'Día {day} de {days}' },
    en: { a: 'Sun', n: ({ h }) => `${h} hrs`, tpl: 'Day {day} of {days}' },
  };
  const en = translator(dicts, 'en');
  assert.equal(en('a'), 'Sun');
  assert.equal(en('b'), 'Tierra');
  assert.equal(en('zzz'), 'zzz');
  assert.equal(en('n', { h: 3 }), '3 hrs');
  assert.equal(en('tpl', { day: 2, days: 10 }), 'Day 2 of 10');
  assert.equal(en('tpl', { day: 2 }), 'Day 2 of {days}');
  const es = translator(dicts, 'es');
  assert.equal(es('a'), 'Sol');
  assert.equal(translator(dicts, 'fr')('a'), 'Sol');
});

test('missingKeys y extraKeys', () => {
  assert.deepEqual(missingKeys({ a: 1, b: 2 }, { a: 1 }), ['b']);
  assert.deepEqual(extraKeys({ a: 1 }, { a: 1, c: 3 }), ['c']);
});

test('withLang: añade o cambia ?lang= en enlaces relativos y deja el resto', () => {
  assert.equal(withLang('../web/', 'en'), '../web/?lang=en');
  assert.equal(withLang('../web/?data=fake#plan', 'en'), '../web/?data=fake&lang=en#plan');
  assert.equal(withLang('../web/?lang=es', 'en'), '../web/?lang=en');
  assert.equal(withLang('#plan', 'en'), '#plan');
  assert.equal(withLang('https://www.540deg.com', 'en'), 'https://www.540deg.com');
  assert.equal(withLang('mailto:a@b.c', 'en'), 'mailto:a@b.c');
  assert.equal(withLang('../home/', 'fr'), '../home/');
});
