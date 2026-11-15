// The catalogue of «Fuentes de datos» (#473): every entry has a name, a purpose, an organisation, a state and a well-formed
// https link, a licence is never invented (only MIT, Apache 2.0 and public domain, which the repo or the licence file
// states; the rest is a link to the terms), nothing is «pending», and the text exists in Spanish and in English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.document = { documentElement: {}, getElementById: () => null };
globalThis.location = { search: '', hash: '' };
Object.defineProperty(globalThis, 'localStorage', { value: null, configurable: true });

const { SOURCES } = await import('../js/engine/catalog.js');
const { es, en } = (await import('../js/i18n/sources.js'));
const STATUSES = ['used', 'validation', 'asset', 'reference'];
const LICENSES = ['MIT', 'Apache-2.0', 'public', 'terms'];
const items = SOURCES.flatMap(g => g.items);
const httpsUrl = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

test('cada entrada tiene nombre, uso, organismo, estado y URL https', () => {
  assert.ok(items.length >= 40);
  for (const i of items) {
    assert.ok(i.name && i.purpose && i.org, `sin nombre, uso u organismo: ${i.url}`);
    assert.ok(!/^sources\./.test(i.org), `${i.name}: falta la clave del organismo (${i.org})`);
    assert.ok(!i.cite || !/^sources\./.test(i.cite), `${i.name}: falta la clave de la cita (${i.cite})`);
    assert.ok(STATUSES.includes(i.status), `${i.name}: estado «${i.status}»`);
    assert.ok(httpsUrl(i.url), `${i.name}: URL ${i.url}`);
    assert.ok(LICENSES.includes(i.license.kind) && httpsUrl(i.license.url), `${i.name}: licencia o condiciones`);
  }
});

test('las claves es y en coinciden, y los textos están traducidos', () => {
  const keys = d => Object.keys(d).filter(k => k.startsWith('sources.')).sort();
  assert.deepEqual(keys(es), keys(en));
  for (const k of keys(es)) if (/\.(name|purpose)$/.test(k)) assert.notEqual(es[k], '', k);
  for (const g of SOURCES) assert.ok(g.group && g.items.length, 'grupo vacío');
});

test('ninguna entrada figura como pendiente y los textos no hablan de fuentes por conectar', () => {
  assert.equal(items.filter(i => i.status === 'pending').length, 0);
  for (const d of [es, en]) assert.ok(!('sources.status.pending' in d));
  const texts = ['js/common/explanations.js', 'js/common/explanations.en.js', 'js/i18n/tour.js', 'js/i18n/sources.js']
    .map(f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  assert.ok(!/qué falta conectar|still to be connected/.test(texts));
  assert.ok(!/spiceypy/.test(texts));
});

test('los textos del DEM, la pendiente y PGDA dicen lo que hace el código', () => {
  const text = key => items.map((_, n) => n).length && SOURCES.flatMap(g => g.items).find(i => i.purpose.includes(key));
  assert.match(text('LDEM_80S_20MPP_ADJ').purpose, /160 m/);
  assert.match(text('LDRM_80S_50MPP').purpose, /pendiente del producto|slope data/);
  assert.match(text('AVGVISIB_65S_240M').purpose, /Tierra|Earth/);
  assert.equal(items.find(i => i.name.includes('astronomy-engine')).version, '2.1.19');
});

test('«Limitaciones conocidas» incluye los supuestos declarados', () => {
  for (const d of [es, en]) for (const k of ['orientation', 'years', 'visibility', 'dsn']) assert.ok(d[`sources.limits.${k}`], k);
});
