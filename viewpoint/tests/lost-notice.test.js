// "3D not available" notice of the Mirador (G1.2b, #286): #glost in index.html with the home page's logic
// (shared/render/lost-notice.js), created in src/lost.js and used by createScene in both doors (exploration and mission).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRendererOrNotice, watchContextLoss } from '../../shared/render/lost-notice.js';
import { redrawAfterRestore, setupLostNotice } from '../src/lost.js';
import { TEXTS } from '../src/texts.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('index.html tiene el aviso #glost oculto, como diálogo de alerta, con los dos enlaces y «Recargar»', () => {
  const html = read('index.html');
  const glost = html.match(/<div class="glost" id="glost"[^>]*>[\s\S]*?<\/ul>[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(glost, 'falta #glost');
  const open = glost[0].match(/<div class="glost"[^>]*>/)[0];
  for (const attr of ['role="alertdialog"', 'aria-modal="true"', 'aria-label="', 'aria-describedby="glost-text"', 'hidden']) assert.ok(open.includes(attr), attr);
  assert.match(glost[0], /<p id="glost-text"><\/p>/);
  assert.match(glost[0], /<a href="\.\.\/home\/" id="glost-home">/);
  assert.match(glost[0], /<a href="\.\.\/web\/" id="glost-planner">/);
  assert.match(glost[0], /<button[^>]*id="glost-reload"[^>]*type="button"/);
});

test('los textos del aviso, en texts.js', () => {
  assert.equal(TEXTS.lost.text, 'La vista 3D no está disponible en este equipo o se ha detenido.');
  assert.equal(TEXTS.lost.home, 'Portada');
  assert.equal(TEXTS.lost.planner, 'Simulador de misiones');
  assert.equal(TEXTS.lost.reload, 'Recargar');
});

test('scene.js usa el aviso y las estrellas compartidos, y ya no define makeStars', () => {
  const scene = read('src/scene.js');
  assert.match(scene, /import \{ createRendererOrNotice, watchContextLoss \} from '\.\.\/\.\.\/shared\/render\/lost-notice\.js';/);
  assert.match(scene, /import \{ sunTexture, sunDiscTexture, makeEarthGlobe, starPoints \} from '\.\.\/\.\.\/shared\/render\/sky-meshes\.js';/);
  assert.match(read('../shared/render/sky-meshes.js'), /import \{ starField \} from '\.\/stars\.js';/);
  assert.doesNotMatch(scene, /makeStars/);
  assert.match(scene, /createRendererOrNotice\(makeRenderer, notice\)/);
  assert.match(scene, /watchContextLoss\(canvas, \{ notice, onRestore: \(\) => redrawAfterRestore\(\{ light, renderer, scene, camera \}\) \}\)/);
  // the two doors hand the notice to createScene; the mission viewer, with the link back to its plan
  assert.match(read('src/main.js'), /createScene\([^\n]*\{ explore: true, notice: setupLostNotice\(\{ beforeShow: endTour \}\) \}\)/);
  assert.match(read('src/main.js'), /import \{ endTour, startTour, startTourIfNew \} from '\.\.\/\.\.\/web\/js\/common\/tour-engine\.js';/);
  assert.match(read('src/mission.js'), /createScene\([^\n]*\{ foot: true, notice: setupLostNotice\(\{ plannerHref: planUrl\(plan, location\.search\) \}\) \}\)/);
});

// Just enough DOM for lost.js and lost-notice.js: ids, children, hidden, inert, focus, contains, text and listeners.
function fakeDom() {
  const doc = { activeElement: null };
  const byId = {};
  const el = (id, children = []) => {
    const listeners = {};
    const node = {
      id, children, hidden: false, inert: false, isConnected: true, ownerDocument: doc, parent: null, textContent: '', attrs: {},
      setAttribute(k, v) { node.attrs[k] = v; },
      addEventListener(type, f) { (listeners[type] ??= []).push(f); },
      click() { for (const f of listeners.click ?? []) f(); },
      focus() { for (let n = node; n; n = n.parent) if (n.inert || n.hidden) return; doc.activeElement = node; },
      contains(other) { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
      querySelector(sel) { return sel === 'a' ? byId['glost-home'] : sel === '.back' ? byId.back : null; },
    };
    for (const c of children) c.parent = node;
    byId[id] = node;
    return node;
  };
  const notice = el('glost', [el('box', [el('glost-text'), el('list', [el('glost-home'), el('glost-planner')]), el('glost-reload')])]);
  notice.hidden = true;
  const body = el('body', [el('gl'), notice, el('topbar', [el('back')]), el('stage'), el('hud', [el('play-btn')])]);
  doc.body = body;
  doc.activeElement = body;
  doc.getElementById = id => byId[id] ?? null;
  doc.querySelector = sel => (sel === '.back' ? byId.back : null);
  return { doc, byId, notice, body };
}

test('setupLostNotice pone los textos y «Recargar» recarga', () => {
  const d = fakeDom();
  let reloads = 0;
  setupLostNotice({ doc: d.doc, reload: () => reloads++ });
  assert.equal(d.byId['glost-text'].textContent, TEXTS.lost.text);
  assert.equal(d.byId['glost-home'].textContent, 'Portada');
  assert.equal(d.byId['glost-planner'].textContent, 'Simulador de misiones');
  assert.equal(d.byId['glost-reload'].textContent, 'Recargar');
  assert.equal(d.notice.attrs['aria-label'], TEXTS.lost.label);
  d.byId['glost-reload'].click();
  assert.equal(reloads, 1);
  // exploration: «Simulador de misiones» keeps the ../web/ of index.html
  assert.equal(d.byId['glost-planner'].href, undefined);
});

test('setupLostNotice: en el visor de misión, «Simulador de misiones» lleva al plan del que se vino', () => {
  const d = fakeDom();
  const href = '../web/?site=shackleton-rim&t0=1794672000000#plan';
  setupLostNotice({ doc: d.doc, reload: () => {}, plannerHref: href });
  assert.equal(d.byId['glost-planner'].href, href);
});

test('createRendererOrNotice: con un make() que lanza, el aviso aparece, el resto queda inerte y el foco va a «Portada»', () => {
  const d = fakeDom();
  const notice = setupLostNotice({ doc: d.doc, reload: () => {} });
  d.byId['play-btn'].focus();
  const err = new Error('Error creating WebGL context.');
  assert.throws(() => createRendererOrNotice(() => { throw err; }, notice), e => e === err);
  assert.equal(notice.visible(), true);
  assert.equal(d.notice.hidden, false);
  assert.ok(d.body.children.filter(c => c !== d.notice).every(c => c.inert), 'todo menos el aviso, inerte');
  assert.equal(d.doc.activeElement, d.byId['glost-home']);
  // Si el contexto vuelve, el aviso se va y el foco vuelve adonde estaba
  notice.hide();
  assert.equal(d.doc.activeElement, d.byId['play-btn']);
  assert.ok(d.body.children.every(c => !c.inert));
});

test('con el tutorial abierto (todo inerte, #glost incluido), el aviso cierra el tutorial y sus controles funcionan', () => {
  const d = fakeDom();
  const tourRoot = { id: 'tour', children: [], hidden: false, inert: false, parent: d.body };
  // the tutorial's setPageInert(true): every child of body but its root, the notice too
  const setPageInert = on => { for (const c of d.body.children) if (c !== tourRoot) c.inert = on; };
  d.body.children.push(tourRoot);
  setPageInert(true);
  d.doc.activeElement = d.body;
  let ends = 0;
  // endTour: the tutorial hides and gives the page back
  const endTour = () => { ends++; tourRoot.hidden = true; setPageInert(false); };
  const notice = setupLostNotice({ doc: d.doc, reload: () => {}, beforeShow: endTour });
  assert.throws(() => createRendererOrNotice(() => { throw new Error('no WebGL'); }, notice));
  assert.equal(ends, 1, 'el tutorial se cierra');
  assert.equal(d.notice.inert, false, 'el aviso no queda inerte');
  assert.equal(d.doc.activeElement, d.byId['glost-home'], 'el foco llega a «Portada»');
  assert.ok(d.body.children.filter(c => c !== d.notice && c !== tourRoot).every(c => c.inert), 'el resto, inerte');
  // a second show (e.g. a context loss) does not end anything again
  notice.show();
  assert.equal(ends, 1);
});

test('el aviso se vuelve usable aunque algo lo dejara inerte antes de mostrarse', () => {
  const d = fakeDom();
  d.notice.inert = true;
  const notice = setupLostNotice({ doc: d.doc, reload: () => {} });
  notice.show();
  assert.equal(d.notice.inert, false);
  assert.equal(d.doc.activeElement, d.byId['glost-home']);
});

test('createRendererOrNotice: si el renderer se crea, no hay aviso', () => {
  const d = fakeDom();
  const notice = setupLostNotice({ doc: d.doc, reload: () => {} });
  const renderer = {};
  assert.equal(createRendererOrNotice(() => renderer, notice), renderer);
  assert.equal(notice.visible(), false);
});

// A canvas that dispatches webglcontextlost / webglcontextrestored, as the browser does.
function fakeCanvas() {
  const listeners = {};
  return {
    addEventListener(type, f) { (listeners[type] ??= []).push(f); },
    dispatch(type) {
      const e = { type, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } };
      for (const f of listeners[type] ?? []) f(e);
      return e;
    },
  };
}

test('pérdida de contexto: el aviso aparece; al volver, se va, el foco vuelve y la escena se redibuja con su sombra', () => {
  const d = fakeDom();
  const notice = setupLostNotice({ doc: d.doc, reload: () => {} });
  const canvas = fakeCanvas();
  const light = { shadow: { needsUpdate: false } };
  const renders = [];
  const renderer = { render: (scene, camera) => renders.push([scene, camera]) };
  const scene = {}, camera = {};
  let restores = 0;
  // the same wiring as createScene in scene.js
  watchContextLoss(canvas, { notice, onRestore: () => { restores++; redrawAfterRestore({ light, renderer, scene, camera }); } });
  d.byId['play-btn'].focus();

  const lost = canvas.dispatch('webglcontextlost');
  assert.equal(lost.defaultPrevented, true, 'preventDefault, para que el contexto pueda volver');
  assert.equal(notice.visible(), true);
  assert.ok(d.body.children.filter(c => c !== d.notice).every(c => c.inert));
  assert.equal(d.doc.activeElement, d.byId['glost-home']);
  assert.equal(renders.length, 0);

  canvas.dispatch('webglcontextrestored');
  assert.equal(notice.visible(), false);
  assert.ok(d.body.children.every(c => !c.inert));
  assert.equal(d.doc.activeElement, d.byId['play-btn']);
  assert.equal(restores, 1);
  assert.equal(light.shadow.needsUpdate, true, 'la sombra se vuelve a dibujar');
  assert.deepEqual(renders, [[scene, camera]]);
});
