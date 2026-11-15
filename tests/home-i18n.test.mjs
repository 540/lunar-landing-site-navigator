// English of the home page (home/i18n.js, #283): every Spanish text, data-i18n key, mission and zone has its
// English version, and the overlay keeps the links and ids of index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { missingKeys } from '../shared/i18n/lang.js';
import { EXPLORE_EN, HOME_TEXTS, ZONES_EN, localizeExplore, localizeZones } from '../home/i18n.js';

const html = fs.readFileSync(new URL('../home/index.html', import.meta.url), 'utf8');
const zonesJson = JSON.parse(fs.readFileSync(new URL('../home/data/zones.json', import.meta.url), 'utf8'));

test('el diccionario inglés tiene todas las claves del español', () => {
  assert.deepEqual(missingKeys(HOME_TEXTS.es, HOME_TEXTS.en), []);
});

test('cada data-i18n de home/index.html tiene su texto en inglés', () => {
  const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  assert.deepEqual(keys.filter((k) => !(k in HOME_TEXTS.en)), []);
});

test('cada clave que usa el script existe en los dos idiomas', () => {
  const used = [...html.matchAll(/\btx\("([^"]+)"[,)]/g)].map((m) => m[1]);
  assert.ok(used.length > 20);
  for (const k of used) {
    assert.ok(k in HOME_TEXTS.es || k in HOME_TEXTS.en, `${k} sin texto`);
    if (k in HOME_TEXTS.es) assert.ok(k in HOME_TEXTS.en, `${k} sin inglés`);
  }
});

test('las cuatro misiones y las zonas de «Explorar la Luna» tienen su inglés', () => {
  for (const id of ['simulador', 'tour', 'rol', 'aterrizaje']) {
    assert.ok(html.includes(`{id:"${id}"`), `${id} no está en ZONES`);
    for (const f of ['mission', 'name', 'place', 'coords', 'text']) assert.ok(ZONES_EN[id]?.[f], `${id}.${f}`);
    assert.equal(ZONES_EN[id].list.length, 3);
  }
  for (const { id } of zonesJson.zones) {
    for (const f of ['name', 'region', 'fact', 'why', 'ground', 'groundTxt']) assert.ok(EXPLORE_EN[id]?.[f], `${id}.${f}`);
    assert.ok(EXPLORE_EN[id].links.length >= 1);
  }
});

test('localizar cambia los textos y conserva id, href y enlaces; en español no toca nada', () => {
  const zones = () => [{ id: 'rol', name: 'Juego de rol', href: '../rolegame/', list: ['a'] }];
  const explore = () => [{ id: 'cabeus', name: 'Cráter Cabeus', links: [['../viewpoint/', 'A'], ['../web/', 'B'], ['../x/', 'C'], ['../y/', 'D']] }];
  assert.deepEqual(localizeZones(zones(), 'es'), zones());
  assert.deepEqual(localizeExplore(explore(), 'es'), explore());
  const [z] = localizeZones(zones(), 'en');
  assert.equal(z.id, 'rol');
  assert.equal(z.href, '../rolegame/');
  assert.notEqual(z.name, 'Juego de rol');
  const [e] = localizeExplore(explore(), 'en');
  assert.deepEqual(e.links.map(([h]) => h), ['../viewpoint/', '../web/', '../x/', '../y/']);
  assert.equal(e.links[3][1], 'D', 'sin etiqueta inglesa, la española');
});
