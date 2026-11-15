// One vocabulary for where the data comes from (#338): LOLA terrain, smooth Moon (no terrain), made-up terrain, real
// or approximate ephemerides and example data. «Simulado» is gone from what the user reads, and no explanation card
// talks about made-up data while the data API is the active source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DICTS } from '../js/i18n/index.js';
import { EXPLANATIONS_ES, sourceToday } from '../js/common/explanations.js';
import { EXPLANATIONS as EXPLANATIONS_EN } from '../js/common/explanations.en.js';

// The texts of a dictionary or a card: strings as they are, functions with sample arguments.
const texts = obj => Object.values(obj).map(v => (typeof v === 'function' ? String(v(1, 'A')) : String(v)));
const cardTexts = (cards, source) => Object.values(cards).flatMap(c =>
  [c.title, c.what, c.tells, sourceToday(c, source), c.real, c.calc, c.owner].map(String));

test('ningún texto del planificador dice «simulado»', () => {
  for (const s of [...texts(DICTS.es), ...cardTexts(EXPLANATIONS_ES, 'fake'), ...cardTexts(EXPLANATIONS_ES, 'api')]) {
    assert.doesNotMatch(s, /simulad/i, s);
  }
  for (const s of [...texts(DICTS.en), ...cardTexts(EXPLANATIONS_EN, 'fake'), ...cardTexts(EXPLANATIONS_EN, 'api')]) {
    assert.doesNotMatch(s, /simulated|prototype/i, s);
  }
  assert.doesNotMatch(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /datos simulados/);
});

test('la API sin DEM es siempre «Luna lisa (sin relieve)»: nada de «horizonte liso»', () => {
  for (const s of texts(DICTS.es)) assert.doesNotMatch(s, /horizonte liso|\bliso \(/, s);
  for (const s of texts(DICTS.en)) assert.doesNotMatch(s, /smooth horizon|flat horizon|^smooth \(/, s);
  // «Luna lisa» always carries «(sin relieve)», or the LOLA variant of the horizon label, never on its own.
  for (const s of [...texts(DICTS.es), ...cardTexts(EXPLANATIONS_ES, 'fake'), ...cardTexts(EXPLANATIONS_ES, 'api')]) {
    for (const m of s.matchAll(/Luna lisa(.{0,14})/g)) assert.match(m[1], /^ \(sin relieve/, s);
  }
  for (const s of [...texts(DICTS.en), ...cardTexts(EXPLANATIONS_EN, 'fake'), ...cardTexts(EXPLANATIONS_EN, 'api')]) {
    for (const m of s.matchAll(/smooth[- ]Moon(.{0,20})/gi)) assert.match(m[1], /^ \(no (LOLA )?terrain/, s);
  }
  assert.equal(DICTS.es['common.badge.noTerrain'], 'Datos reales · Luna lisa (sin relieve)');
  assert.equal(DICTS.en['common.badge.noTerrain'], 'Real data · smooth Moon (no terrain)');
  assert.equal(DICTS.es['common.badge.fake'], 'Datos de ejemplo');
  assert.equal(DICTS.en['common.badge.fake'], 'Example data');
});

test('sourceToday: con la API activa, la ficha dice su fuente real; sin ella, los datos de ejemplo', () => {
  const card = { demo: 'Datos de ejemplo.', api: 'API de datos.' };
  assert.equal(sourceToday(card, 'api'), 'API de datos.');
  assert.equal(sourceToday(card, 'fake'), 'Datos de ejemplo.');
  assert.equal(sourceToday(card, null), 'Datos de ejemplo.');
  assert.equal(sourceToday({ demo: 'Igual.' }, 'api'), 'Igual.');
});

const ONLY_WITHOUT_API = { es: /^Sin la API/, en: /^Without the API/ };

test('con la API activa, ninguna ficha habla de datos inventados ni solo del caso sin la API', () => {
  for (const [lang, cards, inventedData, invented, sample] of [
    ['es', EXPLANATIONS_ES, /datos inventados/i, /inventad/i, /datos de ejemplo/i],
    ['en', EXPLANATIONS_EN, /made-up data|invented data/i, /made-up|made up|invented/i, /example data|sample data/i],
  ]) {
    for (const [key, card] of Object.entries(cards)) {
      const shown = sourceToday(card, 'api');
      assert.doesNotMatch(shown, inventedData, `${lang} ${key}: ${shown}`);
      if (card.api) {
        // Its own text for the API: only the real source.
        assert.doesNotMatch(card.api, invented, `${lang} ${key}: ${card.api}`);
        assert.doesNotMatch(card.api, sample, `${lang} ${key}: ${card.api}`);
        continue;
      }
      // A line that only says what happens without the API needs its own `api` text, whatever else it says.
      assert.doesNotMatch(card.demo ?? '', ONLY_WITHOUT_API[lang], `${lang} ${key} necesita «api»: ${card.demo}`);
      // A line that names the sample data or the made-up terrain also says what the API gives, so it is true either way.
      if (invented.test(shown) || sample.test(shown)) {
        assert.match(shown, /\bAPI\b/, `${lang} ${key} habla de los datos de ejemplo sin nombrar la API: ${shown}`);
      }
    }
  }
});

test('toda ficha con texto para la API lo tiene en castellano y en inglés', () => {
  assert.deepEqual(Object.keys(EXPLANATIONS_EN).sort(), Object.keys(EXPLANATIONS_ES).sort());
  for (const [key, card] of Object.entries(EXPLANATIONS_ES)) {
    assert.equal(Boolean(EXPLANATIONS_EN[key].api), Boolean(card.api), key);
  }
});

test('las claves del mapa lateral que quitó #333 ya no están', () => {
  for (const k of ['tour.map.cursor', 'tour.map.pointNote']) {
    assert.equal(DICTS.es[k], undefined, k);
    assert.equal(DICTS.en[k], undefined, k);
  }
});

// The acceptance check of #338 over the other screens: «simulad…» only in the name of the planner screen
// («Simulador de misiones», «Simulador, mirador…», «desde el simulador»), and no «simulated» or «demo data» in English.
test('Mirador, juego de rol y portada: «simulado» solo como nombre del simulador', () => {
  const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const visible = text => text.split('\n').filter(line => !/^\s*(\/\/|\/?\*)/.test(line));
  for (const path of ['viewpoint/src/texts.js', 'rolegame/src/texts.js', 'home/i18n.js', 'home/index.html']) {
    for (const line of visible(read(path))) {
      for (const m of line.replace(/^\s*\w+:\s*/, '').matchAll(/\w*simula\w*/gi)) assert.match(m[0], /^simula(dor|dores|tor|tors)$/i, `${path}: ${line.trim()}`);
    }
  }
  for (const path of ['viewpoint/src/texts.en.js', 'rolegame/src/texts.en.js']) {
    for (const line of visible(read(path))) {
      // Object keys (simulated:) are code, not text.
      const text = line.replace(/^\s*\w+:\s*/, '');
      assert.doesNotMatch(text, /simulated|demo data|sample data/i, `${path}: ${line.trim()}`);
    }
  }
});
