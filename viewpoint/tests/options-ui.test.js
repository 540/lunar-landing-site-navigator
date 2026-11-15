// The wiring of the options drawer (E8.2, #498) with a small fake DOM: layers, ground detail, quality and the mission door.
import test from 'node:test';
import assert from 'node:assert/strict';

function makeDom() {
  const els = {};
  const make = (tag = 'div') => {
    const el = {
      tag, children: [], listeners: {}, dataset: {}, attrs: {}, checked: false, disabled: false, textContent: '', removed: false, title: '',
      className: '', closest: () => ({ dataset: {} }),
      append(...n) { this.children.push(...n); }, insertBefore(n) { this.children.push(n); }, remove() { this.removed = true; },
      addEventListener(t, fn) { this.listeners[t] = fn; }, setAttribute(k, v) { this.attrs[k] = v; },
      focus() {}, show() { this.open = true; }, close() { this.open = false; },
    };
    return el;
  };
  const classes = new Set();
  globalThis.document = {
    getElementById: id => (els[id] ??= make()),
    createElement: tag => make(tag),
    addEventListener() {},
    querySelector: () => null,
    body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) } },
  };
  return { els, classes };
}
const memory = (initial = {}) => ({ data: { ...initial }, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = String(v); } });
let n = 0;
async function load(opts = {}) {
  const dom = makeDom();
  globalThis.localStorage = memory(opts.stored);
  Object.defineProperty(globalThis, 'location', { value: { search: '', href: 'http://x/', reload() {} }, configurable: true });
  const mod = await import(`../src/options-ui.js?${n++}`);
  return { ...dom, mod };
}
const boxes = els => Object.fromEntries(els['options-layers'].children.map(w => [w.children[0].value, w.children[0]]));

test('layers: the panel and the labels go by a class on <body>, and the choice is stored', async () => {
  const { els, classes, mod } = await load();
  mod.setupOptions({});
  const b = boxes(els);
  b.panel.checked = false; b.panel.listeners.change();
  b.labels.checked = false; b.labels.listeners.change();
  assert.ok(classes.has('layer-off-panel') && classes.has('layer-off-labels'));
  b.panel.checked = true; b.panel.listeners.change();
  assert.ok(!classes.has('layer-off-panel'));
  assert.equal(JSON.parse(localStorage.data[Object.keys(localStorage.data)[0]]).layers.labels, false);
});

test('ground detail: the box, the storage and the «Textura fina» button follow each other', async () => {
  const { els, mod } = await load();
  mod.setupOptions({});
  let micro = true, repaints = 0;
  mod.attachView({ ground: { setMicro: on => { micro = on; } } }, () => { repaints++; });
  assert.equal(repaints, 1, 'attachView paints once with the stored value');
  const ground = boxes(els).ground;
  ground.checked = false; ground.listeners.change();
  assert.equal(micro, false);
  assert.equal(repaints, 2, 'unticking repaints the button');
  mod.setLayer('ground', true); // from the button
  assert.equal(ground.checked, true);
  assert.equal(micro, true);
  assert.equal(mod.layerOn('ground'), true);
});

test('attachView applies the stored ground detail', async () => {
  const { OPTIONS_KEY } = await import('../src/core/options.js');
  const { mod } = await load({ stored: { [OPTIONS_KEY]: '{"quality":"auto","layers":{"ground":false}}' } });
  mod.setupOptions({});
  let micro = true;
  mod.attachView({ ground: { setMicro: on => { micro = on; } } });
  assert.equal(micro, false);
});

test('quality: the arrows only pick; «Aplicar» stores it and reloads once', async () => {
  const { els, mod } = await load();
  let reloads = 0;
  mod.setupOptions({ reload: () => { reloads++; } });
  const radios = els['options-quality'].children.map(w => w.children[0]);
  const apply = els['options-quality-apply'];
  assert.equal(apply.disabled, true);
  for (const r of radios) r.listeners.change(); // moving through every radio
  assert.equal(reloads, 0, 'moving between radios does not reload');
  assert.equal(apply.disabled, false);
  apply.listeners.click();
  assert.equal(reloads, 1);
  assert.equal(JSON.parse(localStorage.data[Object.keys(localStorage.data)[0]]).quality, radios.at(-1).value);
});

test('quality: going back to the stored level leaves «Aplicar» off', async () => {
  const { els, mod } = await load();
  mod.setupOptions({ reload() { assert.fail('no reload'); } });
  const radios = els['options-quality'].children.map(w => w.children[0]);
  radios[1].listeners.change();
  radios[0].listeners.change();
  assert.equal(els['options-quality-apply'].disabled, true);
});

test('the mission viewer has no region group and no panel layer', async () => {
  const { els, mod } = await load();
  mod.setupOptions({ mission: true });
  assert.equal(els['options-region-group'].removed, true);
  assert.deepEqual(Object.keys(boxes(els)), ['labels', 'ground']);
  const full = await load();
  full.mod.setupOptions({});
  assert.notEqual(full.els['options-region-group']?.removed, true);
});

test('setupOptions returns the drawer: opening it before focusing the region selector (reload path) shows the dialog', async () => {
  const { els, mod } = await load();
  const drawer = mod.setupOptions({});
  assert.equal(els.options.open, undefined);
  drawer.open();
  assert.equal(els.options.open, true);
  assert.equal(els['options-btn'].attrs['aria-expanded'], 'true');
});
