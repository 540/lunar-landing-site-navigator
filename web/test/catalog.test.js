// Mission profiles of the catalogue: a plan without a known profile (a link without ?profile=) must not break Plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, profileSource } from '../js/engine/catalog.js';

test('la fuente de un perfil dice de dónde salen sus umbrales y su tránsito', () => {
  const p = PROFILES[0];
  assert.match(profileSource(p), new RegExp(`^Umbrales: .*Tránsito de ${p.transitDays} d`));
});

test('sin perfil (enlace sin ?profile= o con uno que no existe) la fuente queda vacía en vez de fallar', () => {
  assert.equal(profileSource(undefined), '');
  assert.equal(profileSource(PROFILES.find(x => x.id === 'xyz')), '');
});
