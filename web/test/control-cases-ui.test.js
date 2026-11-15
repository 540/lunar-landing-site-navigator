// The in-app explanation of the control cases (#102), which a test of the catalogue alone does not cover: the «Casos de
// control» table of Fuentes de datos and the note of «¿Dónde?» in Planificar. Two checks: the table has its three rows
// with their texts and the LROC link, and the note shows on the Chang'e 4 and Apollo 15 options but not on the
// approximate sites. The English copy runs in a process of its own (control-cases-ui-en.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const LANG = process.env.SOURCES_TEST_LANG ?? 'es';

function element(id) {
  const listeners = {}, attrs = {}, classes = new Set();
  return {
    id, textContent: '', innerHTML: '', value: '', hidden: false, disabled: false, dataset: {}, style: {}, children: [],
    offsetWidth: 0, listeners, attrs,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c), on) },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener() {}, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: k => { delete attrs[k]; },
    getAttribute: k => attrs[k] ?? null, appendChild() {}, after() {}, querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, focus() {}, scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }), getContext: () => null,
  };
}
const elements = new Map();
const byId = id => elements.get(id) ?? elements.set(id, element(id)).get(id);
globalThis.document = {
  getElementById: byId, querySelector: () => element('any'), querySelectorAll: () => [], addEventListener() {},
  createElement: () => element('new'), documentElement: element('html'), body: element('body'),
};
globalThis.location = { hash: '', search: `?lang=${LANG}` };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
Object.defineProperty(globalThis, 'localStorage', { value: null, configurable: true });
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

const { renderSources } = await import('../js/views/sources.js');
const { initPlanForm } = await import('../js/views/plan.js');
const { services } = await import('../js/common/state.js');
const { CONTROL_CASES, SITES, APPROXIMATE_LABEL } = await import('../js/engine/catalog.js');
const { DICTS } = await import('../js/i18n/index.js');
const dict = DICTS[LANG];
services.mission = { isReady: () => false, prepare: () => new Promise(() => {}), heightsEffect: () => null };

const escaped = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test(`Fuentes de datos: la tabla de casos de control tiene sus tres filas, con textos y fuente (${LANG})`, () => {
  renderSources();
  const html = byId('view-sources').innerHTML;
  const section = html.slice(html.indexOf('validation__control'));
  assert.ok(section.includes(escaped(dict['sources.control.title'])), 'falta el título');
  const body = section.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = body.split('<tr>').slice(1);
  assert.equal(rows.length, CONTROL_CASES.length);
  CONTROL_CASES.forEach((c, i) => {
    const site = SITES.find(s => s.id === c.siteId);
    const title = dict[`sources.control.${c.id}.case`].replace('{site}', site?.name ?? '');
    assert.ok(rows[i].includes(escaped(title)), `fila ${c.id}: el caso`);
    assert.ok(rows[i].includes(escaped(dict[`sources.control.${c.id}.why`])), `fila ${c.id}: el porqué`);
    assert.ok(rows[i].includes(escaped(dict[`sources.control.${c.id}.expected`])), `fila ${c.id}: lo esperado`);
    assert.equal(rows[i].includes(`href="${c.source}"`), Boolean(c.source), `fila ${c.id}: el enlace a la fuente`);
  });
  assert.ok(rows[0].includes('https://lroc.im-ldi.com/images/1100'), 'Chang\'e 4 enlaza con LROC');
  assert.ok(rows[0].includes(escaped(dict['sources.control.source'])), 'texto del enlace');
  assert.doesNotMatch(section.slice(0, section.indexOf('</div>')), /sources\.control\./, 'clave sin traducir');
});

test(`Planificar · «¿Dónde?»: la nota sale en Chang'e 4 y Apolo 15, no en los aproximados (${LANG})`, () => {
  initPlanForm();
  const html = byId('plan-sites').innerHTML;
  const options = [...html.matchAll(/<button type="button" class="site-option"[^>]*data-site="([\w-]*)"><b>[\s\S]*?<\/b>(?:<span>([\s\S]*?)<\/span>)?<\/button>/g)]
    .map(([, id, note]) => ({ id, note }));
  const note = id => options.find(o => o.id === id)?.note;
  assert.equal(note('change4'), escaped(dict['common.control.far-side.hint']));
  assert.equal(note('apollo15'), escaped(dict['common.control.near-side.hint']));
  const approximate = SITES.filter(s => s.approximate);
  assert.ok(approximate.length, 'hay sitios aproximados en el catálogo');
  for (const s of approximate) assert.equal(note(s.id), escaped(APPROXIMATE_LABEL), `${s.id}: la etiqueta de aproximado`);
  const hintTexts = ['far-side', 'near-side'].map(k => escaped(dict[`common.control.${k}.hint`]));
  const hints = options.filter(o => hintTexts.includes(o.note));
  assert.deepEqual(hints.map(o => o.id).sort(), ['apollo15', 'change4']);
  assert.doesNotMatch(html, /common\.control\./, 'clave sin traducir');
});
