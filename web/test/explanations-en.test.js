// Explanation cards (E8, #283): the English structure has every card, field and glossary entry of the Spanish one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPLANATIONS_ES, GLOSSARY_ES } from '../js/common/explanations.js';
import { EXPLANATIONS as EXPLANATIONS_EN, GLOSSARY as GLOSSARY_EN } from '../js/common/explanations.en.js';
import { missingKeys, extraKeys } from '../../shared/i18n/lang.js';

test('explicaciones: el inglés tiene las mismas fichas que el español', () => {
  assert.deepEqual(missingKeys(EXPLANATIONS_ES, EXPLANATIONS_EN), [], 'Faltan fichas en explanations.en.js');
  assert.deepEqual(extraKeys(EXPLANATIONS_ES, EXPLANATIONS_EN), [], 'Sobran fichas en explanations.en.js');
});

test('explicaciones: cada ficha en inglés tiene los mismos campos', () => {
  for (const [key, card] of Object.entries(EXPLANATIONS_ES)) {
    const en = EXPLANATIONS_EN[key];
    assert.deepEqual(missingKeys(card, en), [], `${key}: faltan campos`);
    assert.deepEqual(extraKeys(card, en), [], `${key}: sobran campos`);
    for (const f of Object.keys(card)) assert.equal(typeof en[f], typeof card[f], `${key}.${f}: tipo distinto`);
  }
});

test('explicaciones: el glosario en inglés tiene tantas entradas como el español', () => {
  assert.equal(GLOSSARY_EN.length, GLOSSARY_ES.length);
});
