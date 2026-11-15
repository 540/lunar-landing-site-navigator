// Numbers in the interface go through fmtNum (#329): «6,5 días», not «6.5 días». Keys of caches and
// announcements (`${c.days}|…`) keep the raw number: they never reach the user.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROFILES, transitNote, profileSource } from '../js/engine/catalog.js';
import { readdirSync } from 'node:fs';
import { isFilled, fieldText, simDay } from '../js/common/mission-text.js';
import { verdict } from '../js/engine/model.js';

const read = file => readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
// `${days}`, `${p.days}`, `${c.req.minEarthPct}`, `${gapLimit}`… interpolated as they are, outside a cache key
const RAW = /(?<!\|)\$\{[\w.]*\b(days|transitDays|batteryHours|minEarthPct|maxEarthGapHours|gapLimit)\}(?!\|)/g;
const VIEWS = ['views/plan.js', 'views/replan.js', 'views/advanced.js', 'views/advanced-scenarios.js', 'engine/catalog.js', 'engine/model.js', 'common/explanations.js'];

test('Planificar, Avanzado, Replanificar, el catálogo y el modelo no interpolan días, tránsito, batería ni Tierra sin fmtNum', () => {
  for (const file of VIEWS) {
    const source = read(file);
    assert.deepEqual([...source.matchAll(RAW)].map(m => m[0]), [], file);
    for (const text of ['${c.days} días', '${p.days} días', 'de ${form.mission.days}']) assert.ok(!source.includes(text), `${file}: ${text}`);
  }
});

// toFixed( writes a decimal point: in the interface it is only allowed for CSS and for numbers that are not text.
const TO_FIXED_OK = [
  /^\s*const y = \+\(.*\)\.toFixed\(2\);/, // common/timeline.js: an SVG coordinate, a number again with +( )
  /tl\.style\.clipPath = `inset\(/, // views/plan.js: a CSS clip-path
  /^const pctOf = f => `\$\{\(f \* 100\)\.toFixed\(3\)\}%`;/, // views/plan.js: CSS percentages (--x, --w, --tail)
  /#define \w+ \$\{/, // a GLSL constant written into a shader (viewpoint/src/ground-material.js): not text
];
const sources = dir => readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true }).filter(f => f.endsWith('.js')).map(f => `${dir}/${f}`);

test('ningún texto de interfaz de web/js ni del Mirador sale de toFixed( (solo CSS y coordenadas)', () => {
  const files = [...sources('web/js'), ...sources('viewpoint/src')];
  assert.ok(files.includes('web/js/engine/model.js') && files.includes('viewpoint/src/texts.js'), 'recorre las dos carpetas');
  const found = files.flatMap(file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n')
    .map((line, i) => ({ where: `${file}:${i + 1}`, line })).filter(({ line }) => line.includes('toFixed(')));
  assert.ok(found.length > 0, 'la lista de permitidos sigue haciendo falta');
  for (const { where, line } of found) assert.ok(TO_FIXED_OK.some(ok => ok.test(line)), `${where}: ${line.trim()}`);
});

test('el tránsito de 3,5 d sale con coma', () => {
  assert.equal(transitNote(3.5), 'si tarda 3,5 d');
  const artemis = PROFILES.find(p => p.id === 'artemis');
  assert.match(profileSource({ ...artemis, transitDays: 3.5 }), /Tránsito de 3,5 d:/);
});

test('el resumen del paso 2 no convierte un campo vacío en «0»', () => {
  const source = read('views/plan.js');
  const start = source.indexOf('function stepSummary');
  const summary = source.slice(start, source.indexOf('if (n === 3)', start));
  assert.ok(!summary.includes("fmtNum(+$('plan-"), 'stepSummary formatea los campos con fieldText');
  for (const id of ['plan-days', 'plan-battery', 'plan-earth']) assert.ok(summary.includes(`fieldText('${id}')`), id);
  assert.ok(source.includes("from '../common/mission-text.js'"), 'plan.js usa fieldText de common/mission-text.js');
});

test('fieldText: «—» con el campo vacío, el número con coma si no, sin «,0» en los enteros', () => {
  for (const empty of ['', '   ', 'abc', undefined, null]) {
    assert.equal(isFilled(empty), false, String(empty));
    assert.equal(fieldText(empty), '—', String(empty));
  }
  assert.equal(fieldText('6.5'), '6,5');
  assert.equal(fieldText(' 12 '), '12');
  assert.equal(fieldText('0'), '0');
  assert.equal(isFilled('0'), true);
});

test('el reloj de la simulación de Replanificar da siempre un día entero («Día 7 de 6,5»)', () => {
  const source = read('views/replan.js');
  assert.ok(source.includes('day: simDay(i, form.mission.days)'), 'el reloj usa simDay');
  assert.ok(!/const simDay =/.test(source), 'replan.js importa simDay de common/mission-text.js, no lo copia');
  for (let i = 0; i <= 6.5 * 24; i++) assert.ok(Number.isInteger(simDay(i, 6.5)), `hora ${i}: ${simDay(i, 6.5)}`);
  assert.equal(simDay(150, 6.5), 7);
  assert.equal(simDay(0, 6.5), 1);
  assert.equal(simDay(10 * 24, 10), 10, 'el final de una misión entera sigue en su último día');
});

test('el veredicto del modelo escribe los requisitos con coma (batería, Tierra mínima y cortes)', () => {
  const r = { series: [], sunAtLanding: true, earthAtLanding: true, maxDarkHours: 30, hoursSun: 5, pctEarth: 40, maxNoEarthHours: 50 };
  const v = verdict(r, { batteryHours: 6.5, minEarthPct: 62.5, maxEarthGapHours: 24.5 });
  const rules = v.trace.map(t => t.rule);
  assert.ok(rules.includes('Mayor tiempo a oscuras ≤ 6,5 h (lo que aguanta la batería)'), rules.join(' | '));
  assert.ok(rules.includes('Tierra visible ≥ 62,5 % de la misión'), rules.join(' | '));
  assert.ok(rules.includes('Sin Tierra como mucho 24,5 h seguidas'), rules.join(' | '));
  assert.match(v.reason, /la batería aguanta 6,5 h/);
  assert.match(v.reason, /pide 62,5 %/);
  assert.match(v.reason, /admite 24,5 h/);
  const text = [...rules, v.reason].join(' ');
  for (const raw of ['6.5', '62.5', '24.5']) assert.ok(!text.includes(raw), raw);
  // Integers stay as they are: no «,0»
  const whole = verdict(r, { batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48 });
  assert.ok(whole.trace.some(t => t.rule === 'Tierra visible ≥ 60 % de la misión'));
  assert.ok(!whole.trace.map(t => t.rule).join(' ').includes(',0'));
});
