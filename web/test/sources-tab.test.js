// The «Fuentes de datos» tab (#494): it does not point to the repository, it does not show the table of discrepancies,
// and every study, report or presentation carries its full bibliographic citation, the same in Spanish and in English
// but for the conjunction. The view renders here with the real summary file and a stub DOM; the English copy runs in a
// process of its own (sources-tab-en.test.js, ?lang=en).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LANG = process.env.SOURCES_TEST_LANG ?? 'es';
const summary = JSON.parse(readFileSync(new URL('../assets/validation-summary.json', import.meta.url), 'utf8'));
const elements = {};
const element = id => (elements[id] ??= { innerHTML: '' });
globalThis.document = { documentElement: {}, getElementById: element };
globalThis.location = { search: `?lang=${LANG}`, hash: '' };
Object.defineProperty(globalThis, 'localStorage', { value: null, configurable: true });
globalThis.fetch = async () => ({ ok: true, json: async () => summary });

const { renderSources } = await import('../js/views/sources.js');
const { SOURCES } = await import('../js/engine/catalog.js');
const { DICTS } = await import('../js/i18n/index.js');
const dict = DICTS[LANG];
const AND = LANG === 'es' ? 'y' : 'and';
const items = SOURCES.flatMap(g => g.items);

async function rendered() {
  renderSources();
  for (let i = 0; i < 20 && !element('validation-tables').innerHTML.includes('<table'); i++) await new Promise(r => setTimeout(r, 5));
  return element('view-sources').innerHTML + element('validation-tables').innerHTML;
}

// The references of the ticket, letter by letter (the conjunction is «y» in Spanish and «and» in English).
const EXPECTED = [
  'Gläser, P., Oberst, J., Neumann, G. A., Mazarico, E., Speyerer, E. J. {and} Robinson, M. S. (2018). Illumination conditions at the lunar poles: Implications for future exploration. Planetary and Space Science, 162, 170–178. doi:10.1016/j.pss.2017.07.006',
  'Leone, G., Ahrens, C., Korteniemi, J., Gasparri, D., Kereszturi, A., Martynov, A., Schmidt, G. W., Calabrese, G. {and} Joutsenvaara, J. (2023). Sverdrup-Henson crater: A candidate location for the first lunar South Pole settlement. iScience, 26(10), 107853. doi:10.1016/j.isci.2023.107853',
  'Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T. {and} Torrence, M. H. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus, 211(2), 1066–1081. doi:10.1016/j.icarus.2010.10.030',
  'Barker, M. K., Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T. {and} Head, J. W. (2021). Improved LOLA elevation maps for south pole landing sites: Error estimates and their impact on illumination conditions. Planetary and Space Science, 203, 105119. doi:10.1016/j.pss.2020.105119',
  'Barker, M. K., Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., Head, J. W. {and} Sun, X. (2023). A New View of the Lunar South Pole from the Lunar Orbiter Laser Altimeter (LOLA). The Planetary Science Journal, 4(9), 183. doi:10.3847/PSJ/acf3e1',
  'Colaprete, A., Schultz, P., Heldmann, J., Wooden, D., Shirley, M., Ennico, K., et al. (2010). Detection of Water in the LCROSS Ejecta Plume. Science, 330(6003), 463–468. doi:10.1126/science.1186986',
  'Archinal, B. A., Acton, C. H., A’Hearn, M. F., Conrad, A., Consolmagno, G. J., Duxbury, T., et al. (2018). Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2015. Celestial Mechanics and Dynamical Astronomy, 130(3), 22. doi:10.1007/s10569-017-9805-5',
  'Cataldo, R., Zacny, K. {and} Schmitz, P. (2018). Radioisotope Power Systems to Enable Extended Lunar Science and In-Situ Resource Utilization Missions. Nuclear and Emerging Technologies for Space (NETS 2018), American Nuclear Society. NASA NTRS 20180004489',
  'Oleson, S., Colozza, A. J. {and} Uguccini, N. (2022). Overnight Power & Thermal Solutions for Lunar Landers. Commercial Lunar Payload Services (CLPS) Survive the Night Technology Workshop. NASA NTRS 20220018215',
  'Bluethmann, B. (2024). VIPER Rover Overview and Mobility and Hardware. Lunar Surface Innovation Consortium. NASA NTRS 20240013903',
  'Ortiz, L. {and} Dwyer Cianciolo, A. (2025). Artemis Human Landing System Overview: NASA 2025 International SPACE APPS Challenge. NASA NTRS 20250009323',
  'Taylor, C. {and} Pappa, R. (2023). Game Changing Development Program – Vertical Solar Array Technology (VSAT) Project. Game Changing Development Annual Program Review. NASA NTRS 20230012849',
  'Captain, J., Aguilar Ayala, B., Hancock, M., Archer, D., McAdam, A., Jarnot, A., Gawronska, A., Kleinhenz, J., et al. (2026). Prime-1: MSolo Overview and Results. Lunar Surface Science Workshop. NASA NTRS 20260003150',
  'Belbin, S., Mills, C. {and} Chan, R. (2024). Government Reference Design of the Vertical Solar Array Technology Demonstrator. 47th Aerospace Mechanisms Symposium. NASA NTRS 20240004914 · Creech, S. (2025). Update on NASA’s Human Landing System (HLS) Program: Public-Private Partnership Advancing Artemis Sustainable Lunar Exploration. 76th International Astronautical Congress. NASA NTRS 20250008728 · Gal-Edd, J., Fatig, C., Schier, J. {and} Lee, C. (2007). The Earth Based Ground Stations Element of the Lunar Program. 13th Ka and Broadband Communications Conference. NASA NTRS 20070036261',
  'Bleacher, J. E., George, T. {and} Esty, C. C. (2024). Lunar Site Selection. NASA white paper. NASA NTRS 20230016267',
].map(c => c.replaceAll('{and}', AND));

test(`la pestaña no enseña la tabla «Dónde nos alejamos de la referencia» ni la columna de issues (${LANG})`, async () => {
  const html = await rendered();
  assert.ok(!html.includes('validation__known'));
  assert.ok(!/alejamos de la referencia|stray from the reference/.test(html));
  assert.ok(!/<th[^>]*>\s*Issue\s*<\/th>/.test(html));
  assert.deepEqual(Object.keys(dict).filter(k => k.startsWith('sources.known.')), []);
  assert.ok(!('sources.col.issue' in dict) && !('sources.col.how' in dict));
  assert.ok(html.includes('<table'), 'las tablas de validación no se han pintado');
});

test(`ninguna cadena de sources.js remite al repositorio (${LANG})`, () => {
  const patterns = [/\b(backend|data|pipeline|web|shared|home|viewpoint)\//, /\.(ts|mjs|json|md)\b/, /\bnpm /, /\bnode /i, /\brepo(sitorio|sitory)?\b/i, /\bissues?\b/i, /#\d/, /\bfuentes\//, /\b(los tests?|el test|the tests?)\b/i];
  for (const [key, value] of Object.entries(dict).filter(([k]) => k.startsWith('sources.'))) {
    for (const re of patterns) assert.doesNotMatch(value, re, `${key} remite al repositorio (${re}): «${value}»`);
  }
});

test(`la pestaña pintada tampoco remite al repositorio (${LANG})`, async () => {
  const html = (await rendered()).replace(/<a [^>]*>/g, '<a>');
  for (const re of [/\b(backend|pipeline|shared|home|viewpoint)\//, /VALIDATION|validation-summary/, /\bnpm /, /<code>/, /\brepo\b/i, /#\d/]) assert.doesNotMatch(html, re, String(re));
});

test(`cada estudio, informe o presentación del catálogo tiene su cita completa (${LANG})`, () => {
  for (const i of items.filter(i => /^https:\/\/(ntrs\.nasa\.gov|doi\.org)\//.test(i.url) || i.references)) {
    assert.ok(i.references?.length, `${i.name}: sin cita`);
    for (const ref of i.references) {
      assert.ok(ref.authors?.length && /^\d{4}$/.test(String(ref.year)) && ref.title, `${i.name}: autores, año o título`);
      assert.ok(ref.doi || /^\d{11}$/.test(ref.ntrs), `${i.name}: ni DOI ni NTRS`);
    }
    assert.match(i.cite, /\(\d{4}\)\./, `${i.name}: «${i.cite}»`);
    assert.match(i.cite, /doi:10\.\S+|NASA NTRS \d{11}/, `${i.name}: «${i.cite}»`);
  }
});

test(`las citas coinciden letra a letra con las de la issue (${LANG})`, () => {
  const all = items.flatMap(i => i.references ?? []);
  const texts = items.filter(i => i.references).map(i => i.cite).join(' ¦ ');
  for (const c of EXPECTED) assert.ok(texts.includes(c), `falta la cita: ${c}`);
  assert.equal(new Set(all).size, EXPECTED.join(' · ').split(' · ').length);
});

test(`las citas se enlazan al DOI o a la ficha de NTRS y la vista las pinta (${LANG})`, async () => {
  const html = await rendered();
  for (const ref of items.flatMap(i => i.references ?? [])) {
    const href = ref.doi ? `https://doi.org/${ref.doi}` : `https://ntrs.nasa.gov/citations/${ref.ntrs}`;
    assert.ok(html.includes(`href="${href}"`), href);
    const anchors = html.split('<a ').filter(a => a.startsWith(`href="${href}"`) && a.includes('aria-label="'));
    assert.ok(anchors.length > 0, `aria-label: ${href}`);
    const title = ref.title.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    assert.ok(anchors.some(a => a.includes(`: ${title} (`)), `aria-label con el título y el aviso de pestaña nueva: ${href}`);
    assert.ok(html.includes(`<em>${ref.title.replace(/&/g, '&amp;')}</em>`), ref.title);
  }
});

test(`«Limitaciones conocidas» conserva la explicación de la desviación cerca del polo (${LANG})`, async () => {
  const html = await rendered();
  assert.ok(html.includes(dict['sources.limits.lowObserver']));
  assert.match(dict['sources.limits.lowObserver'], /PGDA/);
  assert.ok(html.includes(`<li>${dict['sources.limits.eclipses']}</li>`));
});

test('las citas son idénticas en español y en inglés salvo la conjunción', async () => {
  const { es, en } = await import('../js/i18n/sources.js');
  assert.equal(es['sources.cite.and'], 'y');
  assert.equal(en['sources.cite.and'], 'and');
  // The only text of a citation in the dictionaries is the DSN handbook («módulo»/«module»).
  for (const d of [es, en]) assert.deepEqual(Object.keys(d).filter(k => /^sources\.g\d+\.i\d+\.cite$/.test(k)), ['sources.g3.i0.cite']);
  assert.equal(es['sources.g3.i0.cite'].replace('módulo', 'module'), en['sources.g3.i0.cite']);
  assert.match(es['sources.g3.i0.cite'], /DSN Telecommunications Link Design Handbook/);
});
