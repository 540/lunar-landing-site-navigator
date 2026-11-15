// J9.4: the expert texts and the lessons take their figures from facts of scenario.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXTS, texts } from '../src/texts.js';
import { withFacts } from '../src/facts-texts.js';
import { padDistanceKm } from '../src/hint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));
const scenarios = JSON.parse(readFileSync(join(root, 'data/scenarios.json'), 'utf8')).scenarios;
const scenarioOf = (id) => JSON.parse(readFileSync(join(root, 'data', id, 'scenario.json'), 'utf8'));
const FACTS = { earthFirstDay: 2, earthLastDay: 13, sunMaxElDeg: 1.2, sunAzPer48hDeg: 24.5, earthElRangeDeg: [-6.1, 6.4], padKm: 5.59, startMaskNorthDeg: 14.3 };

test('earthWindow con facts da la frase exacta y sin facts la forma sin cifras', () => {
  assert.equal(TEXTS.earthWindow({ earthFirstDay: 2, earthLastDay: 13 }), 'En esta partida la Tierra asoma hacia el día 2 y se esconde hacia el día 13.');
  assert.doesNotMatch(TEXTS.earthWindow(undefined), /\d/);
  assert.doesNotMatch(TEXTS.earthWindow(null), /\d/);
  assert.equal(texts('en').earthWindow({ earthFirstDay: 2, earthLastDay: 13 }), 'This game, Earth rises around day 2 and sets around day 13.');
});

test('cada escenario subido lleva facts y su padKm es el de padDistanceKm del cliente', () => {
  for (const id of scenarios) {
    const sc = scenarioOf(id);
    assert.ok(sc.facts, `${id} sin facts`);
    for (const k of ['earthFirstDay', 'earthLastDay', 'sunMaxElDeg', 'sunAzPer48hDeg', 'earthElRangeDeg', 'padKm', 'startMaskNorthDeg']) assert.ok(k in sc.facts, `${id}: falta ${k}`);
    assert.equal(sc.facts.padKm, padDistanceKm(sc, sc.grid.cellM), id);
  }
});

test('en experto, la introducción y las pruebas dicen las cifras de facts; en principiante, no cambian', () => {
  const exp = withFacts(TEXTS, { expert: true, facts: FACTS, level: levels.exp });
  assert.match(exp.introText(5.59, 3), /14,3° hacia el norte/);
  assert.match(exp.introText(5.59, 3), /a 5,6 km/);
  assert.match(exp.introText(5.59, 3), /control de misión no autoriza el despegue/);
  assert.match(exp.trials.shadows.question, /~24,5°/);
  assert.match(exp.trials.shadows.reveal, /no pasa de 1,2°/);
  assert.match(exp.trials.earth.question, /de −6,1° a 6,4°|de -6,1° a 6,4°/);
  assert.match(exp.trials.earth.reveal, /asoma hacia el día 2 y se esconde hacia el día 13/);
  assert.match(exp.trials.power.reveal, /−2,3 %\/h/);
  assert.deepEqual(exp.trials.shadows.options, TEXTS.trials.shadows.options);
  const beg = withFacts(TEXTS, { expert: false, facts: FACTS, level: levels.beg });
  assert.equal(beg.introText, TEXTS.introText);
  assert.equal(beg.trials, TEXTS.trials);
  assert.match(beg.lessons[0].text, /1,2° de altura/);
  // Another scenario, other figures, same texts.
  const other = withFacts(TEXTS, { expert: true, facts: { ...FACTS, startMaskNorthDeg: 7.8, earthFirstDay: 5 }, level: levels.exp });
  assert.match(other.introText(1, 3), /7,8°/);
  assert.match(other.trials.earth.reveal, /día 5/);
});

test('sin facts (escenario antiguo), los textos de experto no llevan cifras inventadas', () => {
  const exp = withFacts(TEXTS, { expert: true, facts: null, level: levels.exp });
  for (const text of [exp.introText(5, 3), exp.trials.shadows.question, exp.trials.shadows.reveal, exp.trials.earth.question, exp.trials.earth.reveal, exp.lessons[0].text]) {
    // 0,3° (link criterion), 0,53° (solar disc) and the level's txMinKm are rules, not figures of the scenario.
    assert.doesNotMatch(text.replace(TEXTS.goalPacketsDetail(levels.exp.txMinKm ?? 1), '').replace(/0,53°|0,3°/g, ''), /día \d|\d+(,\d)? ?°|\d km/, text);
  }
});

test('ningún texto de experto ni lección lleva a mano las cifras que están en facts', () => {
  const src = (file) => readFileSync(join(root, 'src', file), 'utf8');
  for (const file of ['texts.js', 'texts.en.js']) {
    const s = src(file);
    const from = s.indexOf('  introExpert:');
    const block = s.slice(s.indexOf('const earthWindowE'), s.indexOf('\n', s.indexOf('const earthWindowE') + 400))
      + s.slice(from, s.indexOf('  lessonSun:', from) + 300) + JSON.stringify(s.match(/lessons: \[[\s\S]*?\]/)[0]);
    for (const literal of ['día 2', 'día 14', 'day 2', 'day 14', '24°', '6 km', '30°', '~1,5°', '~1.5°']) {
      assert.ok(!block.includes(literal), `${file}: «${literal}» escrito a mano`);
    }
  }
});
