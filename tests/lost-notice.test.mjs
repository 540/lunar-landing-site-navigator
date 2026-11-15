// The "3D not available" notice of the home page (shared/render/lost-notice.js, #144), run with a small fake DOM:
// show/hide, inert on and off, focus in and back, the context loss events and the renderer that cannot be created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLostNotice, createRendererOrNotice, watchContextLoss } from '../shared/render/lost-notice.js';

// Just enough DOM: children, hidden, inert, focus (ignored while inert or hidden), contains and isConnected.
function fakeDom() {
  const doc = { activeElement: null };
  const el = (name, children = []) => {
    const node = {
      name, children, hidden: false, inert: false, isConnected: true, ownerDocument: doc, parent: null,
      focus() { for (let n = node; n; n = n.parent) if (n.inert || n.hidden) return; doc.activeElement = node; },
      contains(other) { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
      querySelector(sel) { return sel === 'a' ? link : null; },
    };
    for (const c of children) c.parent = node;
    return node;
  };
  const link = el('a');
  const notice = el('glost', [el('box', [link, el('reload')])]);
  notice.hidden = true;
  const loading = el('loading');
  const menuBtn = el('lightBtn'), scrBack = el('scrBack'), rocket = el('rocket');
  const app = el('app', [el('canvas'), loading, notice, el('hud', [menuBtn, rocket]), el('screen', [scrBack])]);
  const body = el('body', [app, el('script')]);
  doc.body = body;
  doc.activeElement = body;
  return { doc, app, body, notice, loading, link, menuBtn, scrBack, rocket };
}

const inertOf = d => [...d.app.children, ...d.body.children].filter(e => e !== d.app && e !== d.notice).map(e => e.inert);

test('show: el aviso aparece, #loading se va, el resto queda inerte y el foco pasa al primer enlace', () => {
  const d = fakeDom();
  const n = createLostNotice({ notice: d.notice, loading: d.loading, roots: [d.app, d.body], fallbackFocus: () => d.menuBtn });
  assert.equal(n.visible(), false);
  n.show();
  assert.equal(n.visible(), true);
  assert.equal(d.notice.hidden, false);
  assert.equal(d.loading.hidden, true);
  assert.ok(inertOf(d).every(Boolean), 'todo menos el aviso, inerte');
  assert.equal(d.notice.inert, false);
  assert.equal(d.app.inert, false);
  assert.equal(d.doc.activeElement, d.link);
});

test('hide: el aviso se va, la página deja de estar inerte y el foco vuelve adonde estaba', () => {
  const d = fakeDom();
  const n = createLostNotice({ notice: d.notice, loading: d.loading, roots: [d.app, d.body], fallbackFocus: () => d.menuBtn });
  d.rocket.focus();
  n.show();
  n.hide();
  assert.equal(n.visible(), false);
  assert.ok(inertOf(d).every(v => v === false), 'nada inerte');
  assert.equal(d.doc.activeElement, d.rocket);
  // Un segundo hide no cambia nada
  d.scrBack.focus();
  n.hide();
  assert.equal(d.doc.activeElement, d.scrBack);
});

test('hide: sin foco previo, o si el elemento ya no puede recibirlo, el foco va a fallbackFocus()', () => {
  const d = fakeDom();
  let mode = 'menu';
  const n = createLostNotice({ notice: d.notice, loading: d.loading, roots: [d.app, d.body], fallbackFocus: () => mode === 'screen' ? d.scrBack : d.menuBtn });
  n.show(); // focus was on <body>
  n.hide();
  assert.equal(d.doc.activeElement, d.menuBtn);
  d.rocket.focus();
  n.show();
  d.rocket.isConnected = false;
  mode = 'screen';
  n.hide();
  assert.equal(d.doc.activeElement, d.scrBack);
  d.rocket.isConnected = true;
  d.rocket.focus();
  n.show();
  d.rocket.hidden = true; // still in the page, but cannot take focus
  mode = 'menu';
  n.hide();
  assert.equal(d.doc.activeElement, d.menuBtn);
});

test('show dos veces no pierde adónde volver', () => {
  const d = fakeDom();
  const n = createLostNotice({ notice: d.notice, loading: d.loading, roots: [d.app, d.body], fallbackFocus: () => d.menuBtn });
  d.rocket.focus();
  n.show();
  n.show();
  n.hide();
  assert.equal(d.doc.activeElement, d.rocket);
});

test('watchContextLoss: webglcontextlost muestra el aviso (con preventDefault) y webglcontextrestored lo quita', () => {
  const d = fakeDom();
  const n = createLostNotice({ notice: d.notice, loading: d.loading, roots: [d.app, d.body], fallbackFocus: () => d.menuBtn });
  const canvas = new EventTarget();
  let restored = 0;
  const loss = watchContextLoss(canvas, { notice: n, onRestore: () => restored++ });
  const lostEvent = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(lostEvent);
  assert.equal(lostEvent.defaultPrevented, true);
  assert.equal(loss.lost(), true);
  assert.equal(n.visible(), true);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(loss.lost(), false);
  assert.equal(n.visible(), false);
  assert.equal(restored, 1);
  assert.ok(inertOf(d).every(v => v === false));
});

test('watchContextLoss: con la pantalla de misión abierta el aviso espera a showIfLost() (leaveScreen)', () => {
  const d = fakeDom();
  const n = createLostNotice({ notice: d.notice, loading: d.loading, roots: [d.app, d.body], fallbackFocus: () => d.scrBack });
  const canvas = new EventTarget();
  let mode = 'screen';
  const loss = watchContextLoss(canvas, { notice: n, deferWhile: () => mode === 'screen' });
  assert.equal(loss.showIfLost(), false, 'sin pérdida, leaveScreen sigue');
  assert.equal(n.visible(), false);
  d.scrBack.focus();
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  assert.equal(n.visible(), false, 'la pantalla de misión no necesita WebGL');
  assert.equal(loss.showIfLost(), true, 'al salir, el aviso en vez de la Luna en negro');
  assert.equal(n.visible(), true);
  assert.equal(d.doc.activeElement, d.link);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(d.doc.activeElement, d.scrBack);
  // Recuperado antes de salir de la pantalla: no hay aviso
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(loss.showIfLost(), false);
  assert.equal(n.visible(), false);
});

test('createRendererOrNotice: si no se puede crear el renderer, el aviso y la excepción, que para la escena', () => {
  const d = fakeDom();
  const n = createLostNotice({ notice: d.notice, loading: d.loading, roots: [d.app, d.body], fallbackFocus: () => d.menuBtn });
  const ok = {};
  assert.equal(createRendererOrNotice(() => ok, n), ok);
  assert.equal(n.visible(), false);
  const err = new Error('Error creating WebGL context.');
  assert.throws(() => createRendererOrNotice(() => { throw err; }, n), e => e === err);
  assert.equal(n.visible(), true);
  assert.equal(d.loading.hidden, true);
  assert.equal(d.doc.activeElement, d.link);
});
