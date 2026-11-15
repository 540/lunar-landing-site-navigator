import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['web', 'planner', 'lander', 'viewpoint', 'rolegame', 'home', 'shared'];

// After NASA's February 2026 restructuring, Artemis III is an Earth-orbit test and the first crewed landing is
// Artemis IV. Texts must not name the mission that lands, so they stay true if the plan changes again.
// Only these lines may mention «Artemis III», each with its reason.
const EXCEPTIONS = [
  // Title and URL of the 2024 NASA press release keep their original name.
  { file: 'web/js/engine/catalog.js', re: /url: '[^']*artemis-iii-moon-landing-regions\/'/ },
  { file: 'web/js/i18n/sources.js', re: /'sources\.g4\.i0\.name': '(Regiones candidatas de Artemis III|Artemis III candidate regions) \(NASA\)'/ },
  // The note explaining the change of plan (point 4 of the issue), in both languages.
  { file: 'web/js/i18n/sources.js', re: /NASA eligió estas regiones en 2024 para Artemis III\. Desde febrero de 2026, Artemis III es una prueba/ },
  { file: 'web/js/i18n/sources.js', re: /NASA chose these regions in 2024 for Artemis III\. Since February 2026, Artemis III is an Earth-orbit test/ },
];

test('ningún texto dice «Artemis III» fuera de las excepciones de Fuentes', () => {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-n', 'Artemis III', '--', ...DIRS], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    if (e.status !== 1) throw e; // 1 = no matches
  }
  const offenders = out.split('\n').filter(Boolean).filter(line => {
    const [file, , ...rest] = line.split(':');
    const text = rest.join(':');
    return !EXCEPTIONS.some(x => x.file === file && x.re.test(text));
  });
  assert.deepEqual(offenders, []);
});

test('Fuentes explica en es y en en el cambio de plan, con el comunicado de NASA', async () => {
  const { SOURCES } = await import('../web/js/engine/catalog.js');
  const { es, en } = await import('../web/js/i18n/sources.js');
  // Fuentes reads each name and purpose by position (sources.g<gi>.i<ii>.*): look the keys up from the url,
  // so the test fails if the keys and the url fall out of step.
  const find = url => {
    for (const [gi, g] of SOURCES.entries()) {
      const ii = g.items.findIndex(i => i.url === url);
      if (ii >= 0) return { key: `sources.g${gi}.i${ii}`, item: g.items[ii] };
    }
    assert.fail(`no hay fuente con la url ${url}`);
  };

  const release = find('https://www.nasa.gov/missions/artemis/nasa-shares-plans-to-accelerate-artemis-return-to-moon/');
  assert.ok(en[`${release.key}.name`], 'el comunicado de NASA no tiene nombre en inglés');
  assert.match(en[`${release.key}.name`], /NASA shares plans to accelerate the return to the Moon/);
  assert.equal(es[`${release.key}.name`], release.item.name);

  const regions = find('https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/');
  assert.match(es[`${regions.key}.purpose`], /Artemis III es una prueba en órbita terrestre \(2027\) y el primer alunizaje tripulado pasa a Artemis IV \(2028\)/);
  assert.match(en[`${regions.key}.purpose`], /Artemis III is an Earth-orbit test \(2027\) and the first crewed landing moves to Artemis IV \(2028\)/);
});
