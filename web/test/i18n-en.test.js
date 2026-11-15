// The texts added the same day as the English version (#283) also come out in English: the relief note of the maps
// (#331), the badge and the horizon (#330), the state of the sky (#337), the own spacecraft (#251) and the numbers
// (#329). This file loads the modules as a page opened with ?lang=en (each test file runs in its own process), so `t`
// and both fmtNum are English here; the Spanish of the same keys is checked against the dictionary, and the other
// test files keep asserting the Spanish output.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const battery = { value: '6.5' };
globalThis.document = { documentElement: {}, getElementById: id => (id === 'battery' ? battery : null) };
globalThis.location = { search: '?lang=en', hash: '' };
Object.defineProperty(globalThis, 'localStorage', { value: null, configurable: true });

const { lang, t, fmtNum: i18nNum } = await import('../js/common/i18n.js');
const { DICTS } = await import('../js/i18n/index.js');
const { fmtNum } = await import('../../shared/format/number.js');
const { reliefNote } = await import('../js/common/relief-note.js');
const { horizonLabel, dataBadge } = await import('../js/common/horizon-label.js');
const { skyStateLabel } = await import('../js/common/sky-visibility.js');
const { PROFILES, CUSTOM_PROFILE, profileSource, profileSwitchNotice, transitNote } = await import('../js/engine/catalog.js');
const { missionProfileName } = await import('../js/common/mission-history.js');
const { PLAY_LABEL, paintPlayButtons } = await import('../js/common/player.js');
const { FEATURES } = await import('../js/engine/model.js');
const { fieldText } = await import('../js/common/mission-text.js');
const { EXPLANATIONS } = await import('../js/common/explanations.js');

const es = key => DICTS.es[key];

test('la página se abre en inglés con ?lang=en', () => {
  assert.equal(lang, 'en');
  assert.equal(document.documentElement.lang, 'en');
});

test('nota del relieve de los mapas (#331) en inglés, y el español de siempre en el diccionario', () => {
  assert.equal(reliefNote('ready', 'api'), 'LOLA terrain');
  assert.equal(reliefNote('ready', null), 'LOLA terrain');
  assert.equal(reliefNote('ready', 'fake'), 'LOLA terrain · verdicts from example data');
  assert.equal(reliefNote('loading', 'api'), 'loading the terrain…');
  assert.equal(reliefNote('failed', 'fake'), 'made-up terrain: the LOLA terrain could not be loaded');
  assert.deepEqual(['common.relief.lola', 'common.relief.lolaSimulated', 'common.relief.loading', 'common.relief.failed'].map(es), [
    'relieve LOLA', 'relieve LOLA · veredictos con datos de ejemplo', 'cargando el relieve…', 'relieve inventado: no se ha podido cargar el relieve LOLA',
  ]);
});

test('insignia y horizonte (#330) en inglés', () => {
  assert.equal(horizonLabel('api', 'sphere'), 'smooth Moon (no LOLA terrain at this point)');
  assert.equal(horizonLabel('fake', null), 'made-up terrain');
  const b = dataBadge(true, 'no-terrain', 'http://x');
  assert.equal(b.text, 'Real data · smooth Moon (no terrain)');
  assert.doesNotMatch(`${b.title} ${b.note}`, /\b(relieve|servidor|vistas|resultados)\b/);
  assert.equal(dataBadge(true, 'applied', 'x').text, 'Real data · LOLA terrain');
  assert.doesNotMatch(dataBadge(false, null, 'x').title, /\b(Sin|datos|motor)\b/);
});

test('estado del cielo para lectores de pantalla (#337) en inglés', () => {
  assert.equal(skyStateLabel({ sun: { margin: 2 }, earth: { margin: -1 } }), 'Now: Sun visible, Earth hidden.');
});

test('nave propia (#251): nombre, origen de los umbrales, historial y aviso, en inglés', () => {
  assert.equal(CUSTOM_PROFILE.name, 'Your own spacecraft');
  assert.match(profileSource(CUSTOM_PROFILE), /^Thresholds: set by the user/);
  assert.equal(profileSwitchNotice(PROFILES[0].id, CUSTOM_PROFILE.id), 'You changed a requirement: the spacecraft is now «Your own spacecraft».');
  assert.equal(es('common.profile.switchNotice'), 'Has cambiado un requisito: la nave pasa a ser «{name}».');
  assert.equal(missionProfileName({ profile: 'unknown' }), 'Your own spacecraft');
  assert.match(profileSource(PROFILES[1]), /^Thresholds: .* 6 d transit: /);
});

test('botones de reproducir (Planificar y Avanzado) en inglés', () => {
  assert.deepEqual(PLAY_LABEL, { play: 'Play the mission', pause: 'Pause the mission' });
  assert.deepEqual([es('common.player.play'), es('common.player.pause')], ['Reproducir la misión', 'Pausar la misión']);
  const b = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  paintPlayButtons([b], 3);
  assert.equal(b.attrs['aria-label'], 'Pause the mission');
});

test('nombres del mapa de Avanzado sobre el relieve inventado, en inglés', () => {
  const names = FEATURES.mountains.map(m => m.name);
  assert.deepEqual(names, ['Malapert massif', 'Mons Mouton', 'Connecting ridge', 'Connecting ridge']);
  assert.deepEqual([es('common.feature.malapert'), es('common.feature.connectingRidge')], ['Macizo de Malapert', 'Cresta de conexión']);
});

test('números (#329): punto decimal en inglés con los dos fmtNum', () => {
  assert.equal(fmtNum(6.5), '6.5');
  assert.equal(fmtNum(-1.5), '−1.5');
  assert.equal(i18nNum(6.5), '6.5');
  assert.equal(fieldText('6.5'), '6.5');
  assert.equal(transitNote(6), 'if it takes 6 d, like Orion on Artemis');
  assert.equal(t('plan.req.range', { label: 'Days', min: fmtNum(0.5), max: fmtNum(30) }), 'Days: between 0.5 and 30');
});

test('fichas del modo explicación tocadas por #330, #329 y #331, en inglés', () => {
  const horizon = { mask: [0, 1] };
  assert.match(EXPLANATIONS.horizon.live({ horizon: { ...horizon, heightM: null }, horizonModel: 'sphere' }), /^Site height: smooth Moon \(no terrain\), no height data · horizon between 0° and 1°$/);
  assert.match(EXPLANATIONS.horizon.live({ horizon: { ...horizon, heightM: 1500 }, horizonModel: 'mask' }), /1\.5 km \(LOLA\) above the reference/);
  assert.match(EXPLANATIONS.horizon.live({ horizon: { ...horizon, heightM: null, heightKm: 2 }, horizonModel: 'simulated-terrain' }), /2 km \(made up\) above the reference/);
  battery.value = '6.5';
  assert.match(EXPLANATIONS['no-sun'].live({ result: { maxDarkHours: 0 } }), /the profile battery lasts 6\.5 h$/);
  battery.value = '';
  assert.match(EXPLANATIONS['no-sun'].live({ result: { maxDarkHours: 0 } }), /the profile battery lasts — h$/);
  assert.match(EXPLANATIONS['top-map'].demo, /If that image does not load, the map draws the made-up terrain/);
});
