// The options drawer (E8.2, #498): stored state, quality through resolveQuality, the keys and the groups of each door.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveQuality } from '../../shared/render/quality.js';
import { DEFAULT_OPTIONS, OPTIONS_KEY, decodeOptions, encodeOptions, forcedLevel, loadOptions, saveOptions, optionGroups, layersFor, isOptionsKey } from '../src/core/options.js';
import { createDrawer } from '../src/core/options-drawer.js';
import { TEXTS } from '../src/texts.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const memory = (initial = {}) => ({ data: { ...initial }, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = String(v); } });

test('the options are saved and read back', () => {
  const store = memory();
  const options = { quality: 'medio', layers: { panel: false, labels: true, ground: false } };
  saveOptions(store, options);
  assert.deepEqual(loadOptions(store), options);
  assert.deepEqual(decodeOptions(encodeOptions(options)), options);
});

test('without anything stored, or corrupt, the defaults come back', () => {
  assert.deepEqual(loadOptions(memory()), DEFAULT_OPTIONS);
  for (const raw of ['{', 'null', '7', '"x"', '[]', '{"quality":"ultra","layers":5}', '{"layers":{"panel":"no"}}']) {
    assert.deepEqual(loadOptions(memory({ [OPTIONS_KEY]: raw })), DEFAULT_OPTIONS, raw);
  }
  assert.deepEqual(loadOptions(null), DEFAULT_OPTIONS);
  assert.deepEqual(loadOptions({ getItem() { throw new Error('blocked'); } }), DEFAULT_OPTIONS);
  assert.doesNotThrow(() => saveOptions({ setItem() { throw new Error('full'); } }, DEFAULT_OPTIONS));
  // a valid value next to a wrong one is kept
  assert.deepEqual(loadOptions(memory({ [OPTIONS_KEY]: '{"quality":"bajo","layers":{"panel":false,"labels":1}}' })), { quality: 'bajo', layers: { panel: false, labels: true, ground: true } });
});

test('choosing a quality level forces it through resolveQuality and «auto» lets it go', () => {
  const params = new URLSearchParams('');
  const signals = { softwareRenderer: false, maxTextureSize: 16384, deviceMemory: 8, hardwareConcurrency: 16 };
  const auto = resolveQuality({ params, signals, stored: forcedLevel({ quality: 'auto' }) });
  assert.equal(auto.source, 'auto');
  for (const level of ['alto', 'medio', 'bajo']) {
    const q = resolveQuality({ params, signals, stored: forcedLevel({ quality: level }) });
    assert.deepEqual([q.level, q.source], [level, 'stored']);
  }
  // a modest device forced to alto goes to alto; back to auto it is measured again as before
  assert.equal(resolveQuality({ params, signals: { softwareRenderer: true }, stored: forcedLevel({ quality: 'alto' }) }).level, 'alto');
  assert.equal(resolveQuality({ params, signals: { softwareRenderer: true }, stored: forcedLevel({ quality: 'auto' }) }).level, 'bajo');
  // ?q= in the address still wins
  assert.equal(resolveQuality({ params: new URLSearchParams('q=bajo'), signals, stored: 'alto' }).source, 'url');
});

function fakeDrawer() {
  const listeners = {};
  const doc = { addEventListener: (type, fn) => { listeners[type] = fn; }, querySelector: () => null };
  const attrs = {};
  const dialog = { open: false, show() { this.open = true; }, close() { this.open = false; }, focused: 0, focus() { this.focused++; } };
  const button = { focused: 0, focus() { this.focused++; }, setAttribute: (k, v) => { attrs[k] = v; }, addEventListener: (type, fn) => { listeners[`button-${type}`] = fn; }, tagName: 'BUTTON' };
  const drawer = createDrawer({ dialog, button, doc });
  const press = (key, target = { tagName: 'BODY' }, extra = {}) => {
    const ev = { key, target, stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    listeners.keydown(ev);
    return ev;
  };
  return { drawer, dialog, button, attrs, press, doc, click: () => listeners['button-click']() };
}

test('O opens and closes the drawer, Esc closes it and the focus goes back to the button', () => {
  const { dialog, button, attrs, press } = fakeDrawer();
  press('o');
  assert.equal(dialog.open, true);
  assert.equal(attrs['aria-expanded'], 'true');
  assert.equal(dialog.focused, 1, 'the focus goes to the drawer so O still closes it');
  press('O');
  assert.equal(dialog.open, false);
  assert.equal(button.focused, 1);
  press('o');
  const esc = press('Escape');
  assert.equal(dialog.open, false);
  assert.equal(attrs['aria-expanded'], 'false');
  assert.equal(button.focused, 2);
  assert.ok(esc.stopped, 'Esc does not reach the foot view');
  assert.equal(press('Escape').stopped, false, 'closed: Esc is for the rest of the screen');
});

test('with a form control focused, O does nothing; with a modifier or while held, neither', () => {
  const { dialog, press } = fakeDrawer();
  for (const tag of ['INPUT', 'SELECT', 'TEXTAREA']) press('o', { tagName: tag });
  press('o', { tagName: 'DIV', isContentEditable: true });
  press('o', undefined, { ctrlKey: true });
  press('o', undefined, { repeat: true });
  assert.equal(dialog.open, false);
});

test('the button opens it, and O on the button itself works after closing', () => {
  const { dialog, button, click, press } = fakeDrawer();
  click();
  assert.equal(dialog.open, true);
  click();
  assert.equal(dialog.open, false);
  press('o', button);
  assert.equal(dialog.open, true);
});

test('O leaves another open dialog alone', () => {
  const ev = { key: 'o', target: {} };
  const deps = { isFormTarget: () => false, modalOpen: true, drawerOpen: false };
  assert.equal(isOptionsKey(ev, deps), false);
  assert.equal(isOptionsKey(ev, { ...deps, drawerOpen: true }), true);
});

test('in the mission viewer the drawer has no region group, nor the panel layer', () => {
  assert.deepEqual(optionGroups(), ['lang', 'region', 'quality', 'layers']);
  assert.deepEqual(optionGroups({ mission: true }), ['lang', 'quality', 'layers']);
  assert.deepEqual(layersFor(), ['panel', 'labels', 'ground']);
  assert.deepEqual(layersFor({ mission: true }), ['labels', 'ground']);
});

test('the HTML has the drawer, the region selector inside it and no texts written in it', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const drawer = html.match(/<dialog class="options" id="options"[\s\S]*?<\/dialog>/)[0];
  assert.match(drawer, /id="region-select"/);
  assert.match(drawer, /id="options-region-group"/);
  assert.match(html, /<button class="topbar-btn" id="options-btn"[^>]*aria-controls="options"/);
  // every element of the drawer comes empty: its texts are filled from the dictionaries
  assert.doesNotMatch(drawer.replace(/<[^>]+>/g, '').trim(), /\S/);
});

test('the texts of the drawer are in Spanish and the tutorial points to its button', () => {
  assert.equal(TEXTS.options.button, 'Opciones');
  assert.deepEqual(Object.keys(TEXTS.options.qualityChoices), ['auto', 'alto', 'medio', 'bajo']);
  assert.ok(TEXTS.tutorialSteps.some(s => s.target === '#options-btn'));
});

test('Esc leaves another open dialog («Fuentes», the tutorial) its own Esc', () => {
  const { dialog, doc, press } = fakeDrawer();
  press('o');
  doc.querySelector = () => ({});
  const esc = press('Escape');
  assert.equal(dialog.open, true, 'the drawer stays');
  assert.equal(esc.stopped, false);
  assert.equal(esc.prevented, false, 'the native cancel of the other dialog is not cancelled');
  doc.querySelector = () => null;
  press('Escape');
  assert.equal(dialog.open, false);
});
