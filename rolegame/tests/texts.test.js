// Every data-text / data-aria-label / data-title key in rolegame/index.html must resolve to a non-empty string in TEXTS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';


const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ATTRS = ['data-text', 'data-aria-label', 'data-title'];

for (const attr of ATTRS) {
  test(`rolegame/index.html: every ${attr} key exists in TEXTS`, () => {
    const keys = [...html.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map((m) => m[1]);
    for (const key of keys) {
      assert.equal(typeof TEXTS[key], 'string', `${attr}="${key}" is not in TEXTS`);
      assert.ok(TEXTS[key].trim().length > 0, `${attr}="${key}" is empty`);
    }
  });
}

test('rolegame/index.html uses at least one dictionary key', () => {
  assert.ok(ATTRS.some((attr) => html.includes(`${attr}="`)));
});

test('rolegame/index.html has no hardcoded visible text', () => {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]*>/g, '');
  assert.equal(body.trim(), '', `literal text in <body>: "${body.trim()}"`);
});

test('rolegame/index.html has no literal aria-label, title or alt attributes', () => {
  for (const attr of ['aria-label', 'title', 'alt']) {
    const body = html.replace(/<head>[\s\S]*?<\/head>/, '');
    assert.ok(!new RegExp(`(^|[\\s"'])${attr}=`).test(body), `literal ${attr}= in <body>`);
  }
});

// ---- English (J10.1) ----
import { texts, untranslatedKeys, TEXTS } from '../src/texts.js';
import { EN } from '../src/texts.en.js';

// Same text in both languages on purpose.
const SAME_IN_BOTH = new Set(['packetsValue', 'langEs', 'langEn', 'miniStart', 'miniEnd', 'scaleKm', 'ringRange', 'kbdEsc']);

// Compares the shape of two dictionary values: same nested keys, same arity, same tutorial targets.
function sameShape(es, en, path) {
  if (typeof es === 'function') {
    assert.equal(typeof en, 'function', `${path} no es función en inglés`);
    assert.equal(en.length, es.length, `${path}: aridad distinta`);
  } else if (Array.isArray(es)) {
    assert.ok(Array.isArray(en), `${path} no es lista en inglés`);
    assert.equal(en.length, es.length, `${path}: longitud distinta`);
    es.forEach((item, i) => sameShape(item, en[i], `${path}[${i}]`));
  } else if (es && typeof es === 'object') {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort(), `${path}: claves distintas`);
    for (const k of Object.keys(es)) sameShape(es[k], en[k], `${path}.${k}`);
  } else {
    assert.equal(typeof en, typeof es, `${path}: tipo distinto`);
  }
}

test('texts(lang): español por defecto, inglés con recurso al español en lo que falte', () => {
  assert.equal(texts('es'), TEXTS);
  assert.equal(texts('fr'), TEXTS);
  for (const k of Object.keys(TEXTS)) assert.ok(k in texts('en'), k);
});

test('el inglés tiene las mismas claves, aridades y pasos del tutorial que el español', () => {
  for (const k of Object.keys(EN)) assert.ok(k in TEXTS, `«${k}» está en inglés pero no en español`);
  for (const k of Object.keys(EN)) sameShape(TEXTS[k], EN[k], k);
  assert.deepEqual(EN.tutorialSteps.map((s) => s.target), TEXTS.tutorialSteps.map((s) => s.target));
});

test('claves sin traducir al inglés (se traducen antes de fusionar)', (t) => {
  const missing = untranslatedKeys();
  if (missing.length) t.diagnostic(`Sin inglés todavía: ${missing.join(', ')}`);
  // Strict while the dictionary is complete; a story that adds Spanish keys sees them listed here.
  assert.deepEqual(missing, [], `Faltan en rolegame/src/texts.en.js: ${missing.join(', ')}`);
});

test('ningún texto inglés es igual al español salvo las excepciones', () => {
  const sample = (v) => {
    if (typeof v !== 'function') return v;
    try { return v(...Array.from({ length: v.length }, (_, i) => i + 2.5)); } catch { return v(...Array.from({ length: v.length }, () => 'Shift+E')); }
  };
  for (const k of Object.keys(EN)) {
    if (SAME_IN_BOTH.has(k) || k === 'ringSummary' || typeof EN[k] === 'object') continue;
    assert.notEqual(sample(EN[k]), sample(TEXTS[k]), `«${k}» sale igual en los dos idiomas`);
  }
  EN.tutorialSteps.forEach((s, i) => {
    assert.notEqual(s.title, TEXTS.tutorialSteps[i].title);
    assert.notEqual(s.text, TEXTS.tutorialSteps[i].text);
  });
});

test('las cifras usan el formato de cada idioma', () => {
  assert.equal(texts('en').previewRouteValue(1.5, 2), '1.5 km · 2 h');
  assert.equal(texts('es').previewRouteValue(1.5, 2), '1,5 km · 2 h');
  assert.equal(texts('en').hintEarthRing('southeast'), 'Check the horizon ring: Earth peeks out to the southeast, skimming the horizon.');
});

test('el resumen del anillo en inglés dice dónde están el Sol y la Tierra', () => {
  const c = { sun: { az: 90, el: 1.2, margin: 0.5 }, earth: { az: 135, el: 2, margin: -1 } };
  assert.equal(texts('en').ringSummary(c), 'Horizon ring. Sun to the E (090°), 1.2° high: 0.5° above the terrain. Earth to the SE (135°), 2.0° high: hidden by the terrain (1.0° below).');
  assert.equal(texts('es').ringSummary(c), 'Anillo del horizonte. Sol al este (090°), a 1,2° de altura: 0,5° sobre el relieve. Tierra al sureste (135°), a 2,0° de altura: tapado por el relieve (1,0° por debajo).');
});

test('el selector de idioma está en index.html con aria-pressed y nombre del grupo', () => {
  assert.match(html, /<div class="lang" role="group" data-aria-label="langLabel">/);
  assert.match(html, /data-lang="es"[^>]*aria-pressed/);
  assert.match(html, /data-lang="en"[^>]*aria-pressed/);
});

// ---- Hidden body (#337): the same word as in the other views ----
test('ningún texto en español dice «Tierra oculta»: se dice «Tierra tapada»', () => {
  const source = readFileSync(new URL('../src/texts.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('Tierra oculta'), 'src/texts.js aún dice «Tierra oculta»');
  assert.equal(TEXTS.statNoEarth, 'Tierra tapada');
});
