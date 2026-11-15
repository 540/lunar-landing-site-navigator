// Dictionaries of the planner (E8, #283): English has every Spanish key with the same shape, no key is repeated
// between areas, and every key that index.html names exists in English (in html.js, or in the area of its view).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AREAS } from '../js/i18n/index.js';
import { missingKeys, extraKeys } from '../../shared/i18n/lang.js';

for (const [area, { es, en }] of Object.entries(AREAS)) {
  test(`${area}: el inglés tiene todas las claves del español y ninguna de más`, () => {
    assert.deepEqual(missingKeys(es, en), [], `Faltan en inglés (web/js/i18n/${area}.js)`);
    if (area !== 'html') assert.deepEqual(extraKeys(es, en), [], `Sobran en inglés (web/js/i18n/${area}.js)`);
  });

  test(`${area}: mismas aridades y tipos en los dos idiomas`, () => {
    for (const k of Object.keys(es)) {
      assert.equal(typeof en[k], typeof es[k], `${k}: tipo distinto`);
      if (typeof es[k] === 'function') assert.equal(en[k].length, es[k].length, `${k}: aridad distinta`);
    }
  });

  test(`${area}: las claves llevan el prefijo de su área`, () => {
    for (const k of [...Object.keys(es), ...Object.keys(en)]) assert.ok(k.startsWith(`${area}.`), k);
  });
}

test('index.html: cada data-i18n tiene su texto en inglés', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(m => m[1]);
  const en = Object.assign({}, ...Object.values(AREAS).map(a => a.en));
  for (const k of keys) assert.equal(typeof en[k], 'string', `${k} no tiene texto en inglés en web/js/i18n/`);
});

// The texts of «Fuentes» are keyed by position in SOURCES (the catalogue reads them from the dictionary): a group or a
// row inserted in the middle shifts the rest, so both languages must hold exactly the keys the catalogue asks for.
test('sources: las claves por posición casan con SOURCES del catálogo', async () => {
  const { SOURCES } = await import('../js/engine/catalog.js');
  const { es, en } = AREAS.sources;
  const expected = SOURCES.flatMap((g, gi) => [`sources.g${gi}.group`, ...g.items.flatMap((_, ii) => [`sources.g${gi}.i${ii}.name`, `sources.g${gi}.i${ii}.purpose`])]);
  // .org and .cite are optional per item (only the ones that carry words), so they are not part of the positional set.
  const positional = d => Object.keys(d).filter(k => /^sources\.g\d+\./.test(k) && !/\.(note|org|cite)$/.test(k));
  assert.deepEqual(positional(es).sort(), [...expected].sort(), 'claves es');
  assert.deepEqual(positional(en).sort(), [...expected].sort(), 'claves en');
  // Every .org and .cite key must point to an existing item.
  const itemKeys = new Set(SOURCES.flatMap((g, gi) => g.items.map((_, ii) => `sources.g${gi}.i${ii}`)));
  for (const d of [es, en]) for (const k of Object.keys(d).filter(k => /^sources\.g\d+\.i\d+\.(org|cite)$/.test(k))) assert.ok(itemKeys.has(k.replace(/\.(org|cite)$/, '')), `${k} no apunta a ninguna entrada`);
  assert.deepEqual(Object.keys(es).filter(k => k.endsWith('.note')), Object.keys(en).filter(k => k.endsWith('.note')), 'notas de grupo');
});
