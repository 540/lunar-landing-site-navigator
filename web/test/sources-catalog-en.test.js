// «Fuentes de datos» in English (#473): the organisation, citation and version columns, and the licence links, have no
// Spanish words, and every licence link names its resource and says that it opens in a new tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { documentElement: {}, getElementById: () => null };
globalThis.location = { search: '?lang=en', hash: '' };
Object.defineProperty(globalThis, 'localStorage', { value: null, configurable: true });

const { SOURCES } = await import('../js/engine/catalog.js');
const { sourceRow } = await import('../js/views/sources.js');
const items = SOURCES.flatMap(g => g.items);
const SPANISH = /\b(código|módulo|marco|servidor|sin|con|y|equipo|de|del|derivado|por|datos|abierto|producto)\b|[ñáéíóú]/i;

test('en inglés, organismo, cita y versión no llevan palabras en español', () => {
  for (const i of items) {
    for (const field of ['org', 'cite', 'version']) {
      if (!i[field]) continue;
      // Proper names with accents (Gläser) are fine: only Spanish words and letters are looked for.
      const text = i[field].replace(/Gläser/g, 'Glaser');
      assert.ok(!SPANISH.test(text), `${i.name}: ${field} «${i[field]}»`);
    }
  }
});

test('el enlace de licencia nombra el recurso y avisa de la pestaña nueva', () => {
  for (const i of items) {
    const cell = sourceRow(i)[4];
    assert.ok(cell.includes(`aria-label="`) && cell.includes(i.name.replace(/&/g, '&amp;').slice(0, 5)), i.name);
    assert.match(cell, /opens in a new tab/);
    assert.ok(!/\(link\)/.test(cell));
  }
});
