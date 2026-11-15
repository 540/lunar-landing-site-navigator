// Basic accessibility (E8.3, #499): accessible names in index.html, contrast AA of the HUD pairs and «reduce motion».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { untranslatedKeys, texts } from '../src/texts.js';
import { prefersReducedMotion } from '../src/core/motion.js';
import { flightMode } from '../src/core/flight.js';
import { transitionMode } from '../src/core/region-transition.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('index.html');
const srcNames = [
  ...fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).map(f => `src/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'src/core')).map(f => `src/core/${f}`),
  '../shared/i18n/page.js',
];
const srcFiles = srcNames.map(read);

// ---- accessible names -------------------------------------------------------------------------------------------
/** The interactive elements of index.html with their attributes and the inner HTML. */
function controls() {
  const found = [];
  const re = /<(button|a|input|select)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/g;
  for (let m; (m = re.exec(html));) {
    const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a => [a[1], a[2] ?? '']));
    found.push({ tag: m[1], attrs, inner: m[3] ?? '', at: m.index });
  }
  return found.filter(c => !(c.tag === 'input' && ['hidden'].includes(c.attrs.type)));
}
// A script gives the control its name only if the very element is written: the id is looked up in a statement
// (`const jump = $('jump-btn')`) and the variable it lands in gets an `aria-label`, `.ariaLabel`, `.title`, `.textContent`
// or `.innerHTML` write, or the write is chained onto the lookup. A file that merely mentions the id and writes some
// name somewhere else does not count.
const NAME_WRITE = String.raw`(?:setAttribute\(\s*['"]aria-label(?:ledby)?['"]|ariaLabel\s*=|textContent\s*=|innerHTML\s*=|title\s*=)`;
function scriptNameWriter(id) {
  const escaped = id.replace(/-/g, '\\-');
  for (const [i, src] of srcFiles.entries()) {
    for (const ref of src.matchAll(new RegExp(`['"\`]#?${escaped}['"\`]`, 'g'))) {
      const before = src.slice(Math.max(0, ref.index - 80), ref.index);
      const alias = before.match(/(?:const|let|var|,)\s*([\w$]+)\s*=\s*[^=;,]*$/) ?? before.match(/([\w$]+)\s*=\s*[^=;,]*$/);
      if (alias && new RegExp(`\\b${alias[1].replace('$', '\\$')}\\.${NAME_WRITE}`).test(src)) return `${srcNames[i]}:${alias[1]}`;
      if (new RegExp(`^[^;\\n]*\\)\\??\\.${NAME_WRITE}`).test(src.slice(ref.index, ref.index + 120))) return `${srcNames[i]}:chained`;
    }
  }
  return null;
}
// Controls named inside a loop over a table of ids: the id is not looked up on its own, so the loop body is checked.
const LOOP_NAMED = {
  'zoom-in': ['src/zoom.js', /for \(const \[id, label[^\n]*\n\s*const (\w+) = document\.getElementById\(id\);\n\s*\1\.setAttribute\('aria-label', label\)/],
  'zoom-out': ['src/zoom.js', /for \(const \[id, label[^\n]*\n\s*const (\w+) = document\.getElementById\(id\);\n\s*\1\.setAttribute\('aria-label', label\)/],
  'jump-shadow': ['src/mission.js', /for \(const j of jumps\) \{\n\s*const (\w+) = \$\(j\.id\);[\s\S]*?\1\.textContent = j\.label\(/],
  'jump-earth': ['src/mission.js', /for \(const j of jumps\) \{\n\s*const (\w+) = \$\(j\.id\);[\s\S]*?\1\.textContent = j\.label\(/],
};
const idFilledByScript = id => scriptNameWriter(id) !== null
  || (id in LOOP_NAMED && LOOP_NAMED[id][1].test(read(LOOP_NAMED[id][0])) && read(LOOP_NAMED[id][0]).includes(`'${id}'`));

test('every button, link, input and select has an accessible name once the texts are painted', () => {
  const nameless = [];
  for (const c of controls()) {
    const { attrs } = c;
    const visibleText = c.inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+aria-hidden="true"[^>]*>[\s\S]*?<\/[^>]+>/g, '').replace(/<[^>]*>/g, '').trim();
    const labelledByFor = attrs.id && new RegExp(`<label[^>]*for="${attrs.id}"`).test(html);
    const insideLabel = c.tag === 'input' && /<label\b[^>]*>(?:(?!<\/label>)[\s\S])*$/.test(html.slice(0, c.at));
    const innerIds = [...c.inner.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    const named = attrs['aria-label'] || attrs['aria-labelledby'] || labelledByFor || insideLabel || visibleText
      || (attrs.id && idFilledByScript(attrs.id)) || innerIds.some(idFilledByScript) || attrs['data-hand-label'] !== undefined;
    if (!named) nameless.push(`<${c.tag}${attrs.id ? ` id="${attrs.id}"` : ''}>`);
  }
  assert.deepEqual(nameless, []);
});

test('the texts exist in both languages (the names painted in English too)', () => {
  assert.deepEqual(untranslatedKeys(), []);
});

test('no static Spanish name stays in index.html: a script repaints it, and its English text is not the Spanish one', () => {
  const stat = [...html.matchAll(/<[^>]*\b(?:aria-label|title|placeholder|alt)="[^"]+"[^>]*>/g)].map(m => m[0]);
  const es = texts('es'), en = texts('en');
  // Each static name is allowed only on an element a script gives the name again, from a texts.js entry that differs in English.
  const repainted = { glost: { entry: d => d.UI?.lost ?? d.lost, key: 'label', file: 'src/lost.js', write: /notice\.setAttribute\('aria-label', T\.label\)/ } };
  const unexpected = [];
  for (const tag of stat) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const rule = repainted[id];
    if (!rule) { unexpected.push(tag); continue; }
    assert.match(read(rule.file), rule.write, `${rule.file} repaints #${id}`);
    assert.notEqual(en.lost[rule.key], es.lost[rule.key], `#${id}: the English name is still the Spanish one`);
  }
  assert.deepEqual(unexpected, []);
});

test('the names painted by the scripts are English in English mode (every string of a naming group differs from the Spanish)', () => {
  const es = texts('es'), en = texts('en');
  const groups = ['lost', 'zoom'];
  const same = [];
  for (const g of groups) for (const [k, v] of Object.entries(es[g] ?? {})) {
    // A single word such as «Zoom» is the same in both languages; a phrase left identical is an untranslated one.
    if (typeof v === 'string' && v.includes(' ') && en[g][k] === v) same.push(`${g}.${k}`);
  }
  assert.deepEqual(same, []);
});

test('icon-only controls (+, −, ⤒, ⌚) get their name from the script, never from the glyph alone', () => {
  for (const id of ['zoom-in', 'zoom-out', 'jump-btn', 'watch-btn', 'view-btn', 'gesture-btn']) {
    const c = controls().find(x => x.attrs.id === id);
    assert.ok(c, id);
    assert.ok(c.attrs['aria-label'] || idFilledByScript(id), `${id} sin nombre`);
  }
});

test('no hidden control can take the focus: hidden ones are `hidden` (display: none) and none has tabindex > 0', () => {
  for (const c of controls()) assert.ok(!(Number(c.attrs.tabindex) > 0), `tabindex positivo en ${c.attrs.id}`);
  assert.doesNotMatch(read('src/styles/viewpoint.css'), /(?:opacity: 0|visibility: hidden)[^}]*pointer-events: auto/);
});

// ---- contrast ---------------------------------------------------------------------------------------------------
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = h => { const s = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)); };
const css = read('src/styles/viewpoint.css');
const token = name => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `--${name} in viewpoint.css`);
  return hex(m[1]);
};
/** Glass over black, the darkest case is the worst one for light text only if the scene is bright: over white it is the real worst. */
const over = ([r, g, b], a, base) => [r, g, b].map((v, i) => Math.round(v * a + base[i] * (1 - a)));

test('contrast AA: text of the HUD, the panel and the timeline over the glass (4.5:1)', () => {
  const glass = [12, 15, 19];
  // The glass is 78 % opaque: over the brightest relief (a sunlit rim ≈ #b0b0b0) it still has to read.
  const surfaces = { 'black': [0, 0, 0], 'glass over bright relief': over(glass, 0.78, [176, 176, 176]) };
  for (const [name, bg] of Object.entries(surfaces)) {
    for (const fg of ['fg', 'muted']) assert.ok(ratio(token(fg), bg) >= 4.5, `${fg} sobre ${name}: ${ratio(token(fg), bg).toFixed(2)}`);
  }
  const label = css.match(/--label-fg:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(ratio(hex(label[1]), over([12, 15, 19], 0.82, [176, 176, 176])) >= 4.5);
});

test('contrast: the border of the Sun and Earth labels, of the controls and the focus ring against the dark glass (3:1)', () => {
  const dark = over([12, 15, 19], 0.78, [176, 176, 176]);
  const tokens = read('../web/styles/tokens.css');
  const pick = v => { const m = tokens.match(new RegExp(`--${v}:\\s*(#[0-9a-fA-F]{6})`)); assert.ok(m, v); return hex(m[1]); };
  for (const v of ['orange-400', 'blue-400', 'green-400', 'amber-400']) assert.ok(ratio(pick(v), dark) >= 3, `${v}: ${ratio(pick(v), dark).toFixed(2)}`);
  // The ring is `--fg` with a black halo: it has to stand out from the glass over the brightest relief and from black.
  for (const [name, bg] of Object.entries({ 'glass over bright relief': dark, black: [0, 0, 0] })) {
    assert.ok(ratio(token('fg'), bg) >= 3, `focus ring over ${name}`);
  }
  // Borders of controls: the opaque --control-line against both surfaces (the glass fill alone does not identify a control).
  for (const [name, bg] of Object.entries({ 'glass over bright relief': dark, black: [0, 0, 0] })) {
    assert.ok(ratio(token('control-line'), bg) >= 3, `--control-line over ${name}: ${ratio(token('control-line'), bg).toFixed(2)}`);
  }
  // …and every control that draws a border uses it, not the faint --line of the dividers.
  const faint = [...css.matchAll(/(^|\n)([^{}\n@][^{}]*)\{([^{}]*border:\s*1px solid var\(--line\)[^{}]*)\}/g)]
    .filter(m => /cursor:\s*pointer/.test(m[3])).map(m => m[2].trim());
  assert.deepEqual(faint, [], 'controls with the faint --line border');
});

test('focus: one single ring for everything (a global :focus-visible, no per-control variants)', () => {
  assert.equal((css.match(/:focus-visible/g) ?? []).length, 1);
  assert.match(css, /^:focus-visible \{[^}]*outline: 2px solid/m);
  assert.doesNotMatch(css, /:focus-visible[^{]*\{[^}]*outline:\s*none/);
});

test('touch: controls are at least 44 px on touch screens', () => {
  const block = css.slice(css.indexOf('@media (pointer: coarse) {\n  button'));
  assert.match(block, /button[^{]*\{ min-height: 44px; \}/);
  assert.match(block, /\.topbar-btn[^{]*\{ min-height: 44px; min-width: 44px; \}/);
});

test('touch: every selector that sets a min-height under 44 px is repeated in the touch block (a more specific rule would win)', () => {
  const start = css.indexOf('@media (pointer: coarse) {\n  button');
  const touch = css.slice(start, css.indexOf('\n}\n', start));
  const base = css.slice(0, start).replace(/\/\*[\s\S]*?\*\//g, '');
  const small = [];
  for (const m of base.matchAll(/(^|\n)\s*([^{}@\n][^{}]*)\{([^{}]*)\}/g)) {
    const h = m[3].match(/min-height:\s*(\d+)px/);
    if (h && Number(h[1]) < 44) small.push(...m[2].split(',').map(x => x.trim()));
  }
  const missing = small.filter(sel => !touch.split(/[,{}]/).map(x => x.trim()).includes(sel) && !/^\.(chip)$/.test(sel));
  assert.deepEqual(missing, []);
  assert.ok(small.includes('.region-picker select'), 'the scan finds the region selector');
});

test('touch: a clickable control narrower than 44 px has its own min-width in the touch block (the step dots were 24 px)', () => {
  const start = css.indexOf('@media (pointer: coarse) {\n  button');
  const touch = css.slice(start, css.indexOf('\n}\n', start));
  const base = css.slice(0, start).replace(/\/\*[\s\S]*?\*\//g, '');
  const narrow = [];
  for (const m of base.matchAll(/(^|\n)\s*([^{}@\n][^{}]*)\{([^{}]*)\}/g)) {
    const w = m[3].match(/(?:^|[;\s])width:\s*(\d+)px/);
    if (w && Number(w[1]) < 44 && /cursor:\s*pointer/.test(m[3]) && !/::/.test(m[2])) narrow.push(...m[2].split(',').map(x => x.trim()));
  }
  assert.ok(narrow.includes('.visit__dot'), 'the scan finds the step dots');
  const missing = narrow.filter(sel => !new RegExp(`${sel.replace(/[.\[\]"=]/g, '\\$&')}[^{]*\\{[^}]*min-width: 44px`).test(touch));
  assert.deepEqual(missing, []);
});

// ---- reduced motion ---------------------------------------------------------------------------------------------
const win = matches => ({ matchMedia: q => ({ matches: q === '(prefers-reduced-motion: reduce)' && matches }) });

test('reduced motion: the shared function answers from the media query, and without matchMedia it is off', () => {
  assert.equal(prefersReducedMotion(win(true)), true);
  assert.equal(prefersReducedMotion(win(false)), false);
  assert.equal(prefersReducedMotion({}), false);
});

test('reduced motion: the default window is the page one, so a fake window reaches every caller', () => {
  const before = globalThis.window;
  try {
    globalThis.window = win(true);
    assert.equal(prefersReducedMotion(), true);
    globalThis.window = win(false);
    assert.equal(prefersReducedMotion(), false);
  } finally { if (before === undefined) delete globalThis.window; else globalThis.window = before; }
});

test('reduced motion: the camera flights and the region change never fly or glide, at any quality level', () => {
  for (const qualityLevel of ['bajo', 'medio', 'alto']) {
    assert.notEqual(flightMode({ reduceMotion: true, qualityLevel }), 'fly', `flightMode ${qualityLevel}`);
    assert.equal(transitionMode({ reducedMotion: true, qualityLevel, hasScene: true }), 'fade', `transitionMode ${qualityLevel}`);
  }
  assert.equal(flightMode({ reduceMotion: false, qualityLevel: 'medio' }), 'fly');
});

test('reduced motion: nothing in src/ asks matchMedia on its own, only core/motion.js', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'src')).filter(n => n.endsWith('.js'))) {
    assert.doesNotMatch(read(`src/${f}`), /prefers-reduced-motion/, f);
  }
});
