// What the horizon on screen is made of (#330): with the API but no LOLA DEM, the texts say «Luna lisa», not «LOLA» (#338).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { horizonLabel, pointHorizonLabel, ownHorizon, dataBadge, badgeUpdate } from '../js/common/horizon-label.js';
import { EXPLANATIONS } from '../js/common/explanations.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('horizonLabel distingue el relieve inventado, la Luna lisa y el relieve LOLA', () => {
  assert.equal(horizonLabel('api', 'sphere'), 'de Luna lisa (sin relieve LOLA en este punto)');
  assert.equal(horizonLabel('api', 'mask'), 'LOLA');
  assert.equal(horizonLabel('fake', 'simulated-terrain'), 'de relieve inventado');
  assert.equal(horizonLabel('api', null), 'LOLA');
  assert.equal(horizonLabel(null, null), 'de relieve inventado');
});

test('Apolo 15 con el DEM cargado: fuera de su cobertura es liso, sin culpar al servidor', () => {
  // The server has the DEM (the badge says «relieve LOLA») but Apolo 15 (26°N) is out of its coverage: 'sphere'.
  const mission = { horizonModel: id => ({ shackleton: 'mask', apollo15: 'sphere' })[id] ?? null };
  assert.equal(dataBadge(true, 'applied', 'x').text, 'Datos reales · relieve LOLA');
  const label = horizonLabel('api', mission.horizonModel('apollo15'));
  assert.equal(label, 'de Luna lisa (sin relieve LOLA en este punto)');
  assert.doesNotMatch(label, /servidor/);
  assert.equal(horizonLabel('api', mission.horizonModel('shackleton')), 'LOLA');
});

test('un punto fuera del catálogo dice el modelo de su propio horizonte, no el del sitio', () => {
  // Without the DEM the catalogue site keeps its precomputed mask ('mask') and the point around it is a smooth sphere.
  const mission = { horizonModel: id => ({ shackleton: 'mask', 'shackleton~1km~0': 'sphere' })[id] ?? null };
  assert.equal(pointHorizonLabel('api', mission.horizonModel('shackleton~1km~0'), mission.horizonModel('shackleton')), 'de Luna lisa (sin relieve LOLA en este punto)');
  // Until the point is loaded, a site with a mask says nothing about it: no «LOLA».
  assert.equal(pointHorizonLabel('api', mission.horizonModel('shackleton~1km~1'), mission.horizonModel('shackleton')), '');
  // A site over the sphere means the server has no DEM: no point has terrain either.
  assert.equal(pointHorizonLabel('api', null, 'sphere'), 'de Luna lisa (sin relieve LOLA en este punto)');
  assert.equal(pointHorizonLabel('api', 'mask', 'mask'), 'LOLA');
  assert.equal(pointHorizonLabel('fake', null, null), 'de relieve inventado');
});

test('la insignia avisa cuando las ventanas cargadas son de Luna lisa', () => {
  assert.deepEqual([dataBadge(true, 'no-terrain', 'x').text, dataBadge(true, 'no-terrain', 'x').tone], ['Datos reales · Luna lisa (sin relieve)', 'warn']);
  assert.deepEqual([dataBadge(true, 'applied', 'x').text, dataBadge(true, 'applied', 'x').tone], ['Datos reales · relieve LOLA', 'ok']);
  assert.equal(dataBadge(true, null, 'x').text, 'Datos reales de la API');
  assert.equal(dataBadge(false, null, 'x').text, 'Datos de ejemplo');
  assert.match(dataBadge(true, 'no-terrain', 'x').note, /resultados son optimistas/);
  for (const effect of [null, 'applied']) assert.equal(dataBadge(true, effect, 'x').note, undefined);
  for (const effect of [null, 'applied', 'no-terrain']) assert.doesNotMatch(dataBadge(true, effect, 'x').title, /mapa lateral sigue simulado/);
});

test('ownHorizon rotula un punto con su propio modelo, con espacio delante, y calla mientras no lo sabe', () => {
  // The site has its catalogue mask, the point is not loaded yet: no «LOLA» borrowed from the site.
  assert.equal(ownHorizon('api', null, 'mask'), '');
  assert.equal(`horizonte${ownHorizon('api', null, 'mask')}`, 'horizonte');
  assert.equal(ownHorizon('api', 'sphere', 'mask'), ' de Luna lisa (sin relieve LOLA en este punto)');
  assert.equal(ownHorizon('api', 'mask', 'sphere'), ' LOLA');
  assert.equal(ownHorizon('api', null, 'sphere'), ' de Luna lisa (sin relieve LOLA en este punto)');
  assert.equal(ownHorizon('fake', null, 'mask'), ' de relieve inventado');
});

test('badgeUpdate solo pide repintar la insignia cuando cambia su texto', () => {
  assert.equal(badgeUpdate(undefined, null, null, 'x'), null, 'sin saber aún si hay API, no se pinta');
  const first = badgeUpdate(undefined, true, 'no-terrain', 'x');
  assert.equal(first.changed, true);
  assert.deepEqual([first.text, first.tone], ['Datos reales · Luna lisa (sin relieve)', 'warn']);
  assert.match(first.note, /resultados son optimistas/);
  assert.equal(badgeUpdate(first.text, true, 'no-terrain', 'x').changed, false, 'el mismo texto dos veces no se vuelve a anunciar');
  const relief = badgeUpdate(first.text, true, 'applied', 'x');
  assert.deepEqual([relief.changed, relief.tone, relief.note], [true, 'ok', undefined]);
  assert.equal(badgeUpdate('Datos reales de la API', true, null, 'x').changed, false);
  assert.deepEqual([badgeUpdate('', false, null, 'x').text, badgeUpdate('', false, null, 'x').tone], ['Datos de ejemplo', 'warn']);
});

test('Avanzado construye sus textos de horizonte con horizonLabel', () => {
  const advanced = source('../js/views/advanced.js');
  assert.match(advanced, /import \{[^}]*\bhorizonLabel\b[^}]*\} from '\.\.\/common\/horizon-label\.js'/);
  // With any quotes (', ", `): «horizonte LOLA» is no longer written by hand.
  assert.doesNotMatch(advanced, /horizonte LOLA/);
  assert.doesNotMatch(advanced, /Cada punto con su propio horizonte LOLA/);
});
test('la insignia ya no dice que el mapa lateral sigue simulado', () => {
  assert.ok(!source('../js/app.js').includes('el mapa lateral sigue simulado'));
});

test('la insignia es una región viva y Avanzado no rotula un punto con el modelo del sitio', () => {
  assert.match(source('../index.html'), /id="data-badge" role="status"/);
  const advanced = source('../js/views/advanced.js');
  // horizonLabel() only for the catalogue site itself (the 2D sky note); every point goes through ownHorizon(), with
  // the site model as its third argument, never as the point's own.
  assert.equal(advanced.match(/\bhorizonLabel\(/g)?.length, 1);
  assert.match(advanced, /horizonLabel\(res\?\.source, services\.mission\.horizonModel\(o\.site\.id\)\)/);
  const calls = [...advanced.matchAll(/\bownHorizon\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map(m => m[1]).filter(Boolean);
  assert.ok(calls.length >= 5, `ownHorizon() en los textos de los puntos (${calls.length})`);
  for (const args of calls) {
    assert.match(args, /, siteModel\(o\)$/, `el modelo del sitio va de tercer argumento: ownHorizon(${args})`);
    assert.doesNotMatch(args.replace(/, siteModel\(o\)$/, ''), /o\.site\.id|siteModel/, `el punto no toma el modelo del sitio: ownHorizon(${args})`);
  }
});

test('el texto en directo de la altura dice si la Luna es lisa', () => {
  const horizon = { mask: [0, 1] };
  const smooth = EXPLANATIONS.horizon.live({ horizon: { ...horizon, heightM: null }, horizonModel: 'sphere' });
  assert.match(smooth, /Luna lisa \(sin relieve\), sin dato de altura/);
  assert.doesNotMatch(smooth, /inventada/);
  assert.match(EXPLANATIONS.horizon.live({ horizon: { ...horizon, heightM: 1500 }, horizonModel: 'mask' }), /1,5 km \(LOLA\) sobre la referencia/);
  assert.match(EXPLANATIONS.horizon.live({ horizon: { ...horizon, heightM: null, heightKm: 2 }, horizonModel: 'simulated-terrain' }), /2 km \(inventada\) sobre la referencia/);
});
