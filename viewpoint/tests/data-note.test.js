// Data note (E9.4, #47): the lines of resolution come from meta.json, and the texts of the notice do not change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolutionLines, opensDataNote, showsVerdictSource, levelCitations } from '../src/core/data-note.js';
import { reliefNoticeKey } from '../src/core/relief.js';
import { TEXTS } from '../src/texts.js';
import { noteSections, setupDataNote } from '../src/data-note.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const readMeta = id => JSON.parse(fs.readFileSync(path.join(DIR, id, 'meta.json'), 'utf8'));

test('shackleton-rim: the zone, two detail levels, the 5 m ground (with how much is measured) and the far horizon', () => {
  const meta = readMeta('shackleton-rim');
  const lines = resolutionLines(meta);
  assert.deepEqual(lines, [
    { kind: 'zone', extentKm: 40, stepKm: 0.15625 },
    { kind: 'detail', extentKm: 20, stepKm: 0.078125 },
    { kind: 'detail', extentKm: 10, stepKm: 0.01953125 },
    { kind: 'detail', extentKm: 2.5, stepKm: 0.0048828125, measured: meta.detail[2].measured, rmsM: meta.detail[2].rmsM },
    { kind: 'far', extentKm: 300, stepKm: 1.171875 },
  ]);
  assert.ok(lines[3].measured > 0.05 && lines[3].measured < 0.2, 'about a tenth of the 5 m cells has a laser shot');
  assert.ok(lines[3].rmsM > 0.1 && lines[3].rmsM < 1, 'a typical error of tenths of a metre');
  assert.deepEqual(levelCitations(meta), ['LOLA 5 m/px de los sitios del polo sur (PGDA/GSFC), Barker et al. 2021']);
  assert.match(TEXTS.dataNote.detailMeasured('2,5 km', '4,9 m', 0.095, 0.37), /9,5 %.*interpolado.*0,37 m/);
});

test('mouton: the zone and the far horizon, without detail levels (#430)', () => {
  assert.deepEqual(resolutionLines(readMeta('mouton')), [
    { kind: 'zone', extentKm: 40, stepKm: 0.15625 },
    { kind: 'far', extentKm: 300, stepKm: 1.171875 },
  ]);
});

test('the steps are written as in the issue: 156 m, 78 m, 19,5 m and ~1,2 km', () => {
  assert.equal(TEXTS.dataNote.step(0.15625), '156 m');
  assert.equal(TEXTS.dataNote.step(0.078125), '78 m');
  assert.equal(TEXTS.dataNote.step(0.01953125), '19,5 m');
  assert.equal(TEXTS.dataNote.step(1.171875), '1,2 km');
});

test('the note opens only over LOLA relief, and the verdict line only in the mission viewer', () => {
  assert.equal(opensDataNote({ source: { type: 'lola' } }), true);
  assert.equal(opensDataNote({ source: { type: 'procedural' } }), false);
  assert.equal(opensDataNote({ source: { type: 'simulated' } }), false);
  assert.equal(showsVerdictSource(null), false);
  assert.equal(showsVerdictSource('fake'), true);
  assert.equal(showsVerdictSource('api'), true);
});

test('the texts of the notice do not change (V2.3, #78)', () => {
  assert.deepEqual(TEXTS.notice, {
    procedural: 'Relieve inventado',
    lola: 'Relieve LOLA',
    simulated: 'Relieve inventado',
    fakeOverReal: 'Relieve LOLA · veredicto con datos de ejemplo',
    realOverInvented: 'Relieve inventado · veredicto con datos reales',
  });
  assert.equal(reliefNoticeKey('lola', 'fake'), 'fakeOverReal');
  assert.equal(reliefNoticeKey('procedural', 'api'), 'realOverInvented');
  assert.equal(reliefNoticeKey('lola', 'api'), 'lola');
  assert.equal(reliefNoticeKey('simulated', null), 'simulated');
  assert.equal(reliefNoticeKey('procedural', 'fake'), 'procedural');
});

test('the tutorial step on #notice mentions «Fuentes»', () => {
  const step = TEXTS.tutorialSteps.find(s => s.target === '#notice');
  assert.match(step.text, /Fuentes/);
});

const titles = sections => sections.map(s => s.title);
const T = TEXTS.dataNote;

test('noteSections: sections and order for exploration, real API and simulated verdict', () => {
  const meta = readMeta('shackleton-rim');
  const base = [T.realTitle, T.resolutionTitle, T.approxTitle];
  // the exploration also says what textures the ground on foot (real, and the illustrative fine texture)
  assert.deepEqual(titles(noteSections(meta, null)), [...base, T.groundTitle, T.creditsTitle]);
  const ground = noteSections(meta, null).find(s => s.title === T.groundTitle).lines;
  assert.deepEqual(ground, [T.micro]);
  assert.match(T.micro, /ilustrativa.*no son rocas ni cráteres reales/);
  assert.deepEqual(titles(noteSections(meta, 'api')), [...base, T.verdictTitle, T.creditsTitle]);
  assert.deepEqual(titles(noteSections(meta, 'fake')), [...base, T.verdictTitle, T.creditsTitle]);
});

test('noteSections: relief products and credits come from meta.json', () => {
  const meta = readMeta('shackleton-rim');
  const sections = noteSections(meta, null), real = sections[0], credits = sections.at(-1);
  assert.ok(real.lines.includes(T.relief(meta.source.products, meta.source.demVersion)));
  assert.ok(credits.lines.includes(T.credits(meta.source.citation)));
});

test('noteSections: with a simulated verdict the sky and horizon are approximate, not real', () => {
  const meta = readMeta('shackleton-rim');
  const [real, , approx] = noteSections(meta, 'fake');
  assert.ok(!real.lines.includes(T.sunEarth) && !real.lines.includes(T.horizon));
  assert.ok(approx.lines.includes(T.approxSunEarth) && approx.lines.includes(T.approxHorizon));
  const [realApi, , approxApi] = noteSections(meta, 'api');
  assert.ok(realApi.lines.includes(T.sunEarth) && realApi.lines.includes(T.horizon));
  assert.ok(!approxApi.lines.includes(T.approxSunEarth));
});

test('noteSections: the real section says the relief height is at true scale (#335)', () => {
  const meta = readMeta('shackleton-rim');
  for (const source of [null, 'api', 'fake']) {
    const [real] = noteSections(meta, source);
    assert.ok(real.lines.includes('Altura del relieve a escala real (sin exagerar).'), String(source));
  }
});

// Minimal DOM stub: enough for setupDataNote (elements, listeners, dialog open/close, focus).
function stubDom() {
  let focused = null;
  const make = tag => {
    const el = {
      tag, tabIndex: 0, children: [], attrs: {}, listeners: {}, className: '', textContent: '', open: false,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      append(...c) { this.children.push(...c); },
      replaceChildren(...c) { this.children = c; },
      after(n) { this.sibling = n; },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
      fire(t) { (this.listeners[t] || []).forEach(f => f({ type: t })); },
      focus() { focused = this; },
    };
    if (tag === 'dialog') {
      el.showModal = () => { el.open = true; };
      el.close = () => { el.open = false; el.fire('close'); };
    }
    return el;
  };
  globalThis.document = { createElement: make };
  return { make, focused: () => focused };
}

test('setupDataNote: opens, flips aria-expanded, opens at the title, closes with «Cerrar» and returns focus whatever fires «close»', () => {
  const dom = stubDom();
  const notice = dom.make('p');
  notice.textContent = TEXTS.notice.lola;
  setupDataNote({ notice, meta: readMeta('shackleton-rim') });
  const button = notice.children[0];
  const panel = notice.sibling;
  assert.equal(panel.tag, 'dialog');
  assert.equal(button.attrs['aria-expanded'], 'false');
  button.fire('click');
  assert.equal(panel.open, true);
  assert.equal(button.attrs['aria-expanded'], 'true');
  const [title] = panel.children;
  const close = panel.children.at(-1);
  assert.equal(title.tag, 'h2');
  assert.equal(title.tabIndex, -1);
  assert.equal(dom.focused(), title);
  close.fire('click');
  assert.equal(panel.open, false);
  assert.equal(button.attrs['aria-expanded'], 'false');
  assert.equal(dom.focused(), button);
  // Any «close» of the dialog (the browser fires it on Esc) returns the focus. Real Esc needs a browser and is not tested here.
  button.fire('click');
  panel.open = false;
  panel.fire('close');
  assert.equal(button.attrs['aria-expanded'], 'false');
  assert.equal(dom.focused(), button);
});

test('setupDataNote: with procedural or simulated relief the notice stays plain text', () => {
  for (const type of ['procedural', 'simulated']) {
    const dom = stubDom();
    const notice = dom.make('p');
    notice.textContent = 'texto';
    setupDataNote({ notice, meta: { source: { type } } });
    assert.deepEqual(notice.children, []);
    assert.equal(notice.sibling, undefined);
    assert.equal(notice.textContent, 'texto');
  }
});
