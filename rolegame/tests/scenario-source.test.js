// J9.2: which scenario opens, the badge and the tutorial follow the relief source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarioId, scenarioPath, badgeText, tutorialStepsFor, isRealRelief, scenarioName, levelsFor } from '../src/scenario-source.js';
import { TEXTS, texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const list = { default: 'procedural-shackleton', scenarios: ['procedural-shackleton', 'lola-shackleton'] };
const procedural = { id: 'procedural-shackleton', name: 'Shackleton procedural', siteId: 'shackleton-rim' };
const lola = { id: 'lola-shackleton', name: { es: 'Cresta de Shackleton', en: 'Shackleton ridge' }, siteId: 'shackleton-rim', source: { type: 'lola' } };

test('scenarioId: el de ?scenario= si está en la lista; si no, el de por defecto', () => {
  assert.equal(scenarioId(list, ''), 'procedural-shackleton');
  assert.equal(scenarioId(list, '?scenario=lola-shackleton'), 'lola-shackleton');
  assert.equal(scenarioId(list, '?scenario=../../etc'), 'procedural-shackleton');
  assert.equal(scenarioPath('lola-shackleton'), 'data/lola-shackleton/');
});

test('la etiqueta dice «Relieve LOLA · <región>» con LOLA y «Relieve inventado» con el procedural (#338)', () => {
  assert.equal(badgeText(lola, TEXTS), 'Relieve LOLA · Cresta de Shackleton');
  assert.equal(badgeText(procedural, TEXTS), 'Relieve inventado');
  assert.equal(isRealRelief(procedural), false);
  assert.equal(scenarioName(lola), 'Cresta de Shackleton');
});

test('las etiquetas de los escenarios subidos siguen a su scenario.json', () => {
  const data = JSON.parse(readFileSync(join(root, 'data/scenarios.json'), 'utf8'));
  for (const id of data.scenarios) {
    const sc = JSON.parse(readFileSync(join(root, 'data', id, 'scenario.json'), 'utf8'));
    const badge = badgeText(sc, TEXTS);
    if (sc.source?.type === 'lola') assert.match(badge, /^Relieve LOLA · /, id);
    else assert.equal(badge, 'Relieve inventado', id);
  }
});

test('el tutorial cuenta dónde se aterriza según el sitio del escenario y qué significa la etiqueta', () => {
  const steps = tutorialStepsFor(procedural, TEXTS);
  assert.equal(steps.length, TEXTS.tutorialSteps.length);
  assert.match(steps[0].text, /cresta del cráter Shackleton/);
  assert.doesNotMatch(steps[0].text, /Mons Mouton/);
  assert.match(tutorialStepsFor({ ...procedural, siteId: 'im2-objetivo' }, TEXTS)[0].text, /Mons Mouton/);
  const badgeStep = (s) => s.find((x) => x.target === '.badge');
  assert.match(badgeStep(steps).text, /inventado/);
  assert.match(badgeStep(tutorialStepsFor(lola, TEXTS)).text, /LOLA/);
});

test('en inglés, la etiqueta y el tutorial usan el nombre en inglés', () => {
  assert.equal(badgeText(lola, texts('en'), 'en'), 'LOLA terrain · Shackleton ridge');
  assert.equal(badgeText(procedural, texts('en'), 'en'), 'Made-up terrain');
  assert.match(tutorialStepsFor(procedural, texts('en'), 'en')[0].text, /rim of Shackleton crater/);
});

// #313: a scenario may change some level fields; the game plays the merge, as the pipeline's solver.
test('levelsFor: los campos de scenario.levels mandan sobre levels.json, y sin ellos se juegan los comunes', () => {
  const common = { beg: { deadline: 336, bat0: 85 }, mid: { deadline: 288, bat0: 66 }, exp: { deadline: 240, bat0: 70 } };
  assert.equal(levelsFor(common, procedural), common);
  const mouton = levelsFor(common, { levels: { beg: { deadline: 192 }, exp: { deadline: 144 } } });
  assert.deepEqual(mouton.beg, { deadline: 192, bat0: 85 });
  assert.equal(mouton.mid, common.mid);
  assert.deepEqual(mouton.exp, { deadline: 144, bat0: 70 });
  assert.equal(common.beg.deadline, 336, 'no muta levels.json');
});

test('Mons Mouton es el escenario por defecto y juega con el día límite acortado (#313)', () => {
  const data = JSON.parse(readFileSync(join(root, 'data/scenarios.json'), 'utf8'));
  assert.equal(data.default, 'lola-mouton');
  assert.equal(scenarioId(data, ''), 'lola-mouton');
  for (const id of ['procedural-shackleton', 'lola-shackleton']) assert.equal(scenarioId(data, `?scenario=${id}`), id);
  const sc = JSON.parse(readFileSync(join(root, 'data/lola-mouton/scenario.json'), 'utf8'));
  const common = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));
  const lv = levelsFor(common, sc);
  assert.deepEqual([lv.beg.deadline, lv.mid.deadline, lv.exp.deadline], [192, 168, 144]);
  assert.equal(badgeText(sc, TEXTS), 'Relieve LOLA · Mons Mouton');
});
