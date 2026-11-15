// The 2D sky, the compass and the map of Advanced draw the Sun and the Earth as markers of the same size, and each says
// so with «Sol y Tierra no a escala» (#342). createSkyView runs on stub elements and a recording canvas, without a DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// theme() reads the CSS tokens: each token resolves to its own name.
const element = () => {
  const attrs = {}, handlers = {};
  return {
    hidden: false, textContent: '', className: '', dataset: {}, style: {},
    getAttribute: name => attrs[name] ?? null, setAttribute: (name, value) => { attrs[name] = value; },
    addEventListener: (type, fn) => { handlers[type] = fn; }, click: () => handlers.click?.(), after() {}, append() {},
  };
};
globalThis.document = { documentElement: {}, createElement: element };
globalThis.getComputedStyle = () => ({ getPropertyValue: name => name });
globalThis.devicePixelRatio = 1;
const { createSkyView } = await import('../js/common/sky-view.js');
const { t } = await import('../js/common/i18n.js');

const NOTE = t('common.sky.notToScale');
const noop = () => {};
// A 2D context that accepts every call; gradients and measurements answer with stubs of their own.
const ctx = new Proxy({}, {
  get: (target, key) => key in target ? target[key] : () => ({ addColorStop: noop, width: 0 }),
  set: (target, key, value) => { target[key] = value; return true; },
});

function view({ hint2d = '', hintPolar = '' } = {}) {
  const canvas = { ...element(), clientWidth: 360, width: 0, height: 0, getContext: () => ctx };
  canvas.setAttribute('aria-label', 'Cielo');
  const modes = ['2d', 'polar', '3d'].map(mode => { const b = element(); b.dataset.mode = mode; return b; });
  const toggle = { ...element(), querySelectorAll: () => modes };
  const hint = element();
  const sky = createSkyView({ canvas, host: element(), toggle, notice: element(), hint, height: 200, hint2d, hintPolar, relief: noop, redraw: noop, viewer: () => null });
  return { sky, hint, modes };
}
const body = (az, margin) => ({ az, el: margin, margin, fullMargin: margin - 0.3 });
const SKY = { horizon: { mask: new Array(360).fill(1) }, series: [{ sun: body(90, 3), earth: body(200, 5) }] };
const site = { id: 'x', lat: -89.5, lon: 0 };

test('el cielo 2D dice «Sol y Tierra no a escala», con nota propia y sin ella', () => {
  const plain = view();
  plain.sky.draw(site, SKY, 0);
  assert.equal(plain.hint.textContent, NOTE, 'sin nota del 2D, la nota sola, sin « · » delante');
  const noted = view({ hint2d: 'Relieve LOLA' });
  noted.sky.draw(site, SKY, 0);
  assert.equal(noted.hint.textContent, `Relieve LOLA · ${NOTE}`);
  noted.sky.hint2d = '';
  assert.equal(noted.hint.textContent, NOTE, 'al vaciar hint2d sigue la nota, sin « · » delante');
  noted.sky.hint2d = 'Otra nota';
  assert.equal(noted.hint.textContent, `Otra nota · ${NOTE}`);
});

test('la Brújula dice «Sol y Tierra no a escala», con nota propia y sin ella', () => {
  for (const [hintPolar, expected] of [['', NOTE], ['Visto desde arriba', `Visto desde arriba · ${NOTE}`]]) {
    const { sky, hint, modes } = view({ hintPolar });
    modes[1].click();
    sky.draw(site, SKY, 0);
    assert.equal(sky.mode, 'polar');
    assert.equal(hint.textContent, expected);
  }
});

test('el mapa de Avanzado lleva la nota solo cuando dibuja las direcciones del Sol y la Tierra', () => {
  const src = readFileSync(new URL('../js/views/advanced.js', import.meta.url), 'utf8');
  assert.match(src, /const scaleNote = now \? `\$\{t\('common\.sky\.notToScale'\)\}\. ` : '';/, 'la nota depende de `now`, el mismo que dibuja las direcciones');
  assert.match(src, /if \(now\) \{[\s\S]*?BODY_MARKER_RADIUS_PX[\s\S]*?\n  \}/, 'las direcciones con sus marcadores se dibujan bajo `if (now)`');
  assert.match(src, /\$\('map-note'\)\.textContent = `[^`]*\$\{scaleNote\}[^`]*`/, '#map-note no incluye la nota');
});

test('la nota existe en español y en inglés', async () => {
  const { DICTS } = await import('../js/i18n/index.js');
  assert.equal(DICTS.es['common.sky.notToScale'], 'Sol y Tierra no a escala');
  assert.equal(DICTS.en['common.sky.notToScale'], 'Sun and Earth not to scale');
});

// Overlap (#342): where the two markers touch, the Earth on top is a ring, without fill, and the Sun is still drawn.
// A recording context: each marker is the run of calls between a `beginPath` and the next one, with the colours at hand.
function recordingView(mode, bodies) {
  const log = [];
  const rec = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : (...args) => {
      if (key === 'beginPath') log.push({ fill: false, stroke: false, arc: null, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle });
      else if (log.length) {
        const cur = log.at(-1);
        if (key === 'arc') cur.arc = args;
        if (key === 'fill') { cur.fill = true; cur.fillStyle = target.fillStyle; }
        if (key === 'stroke') { cur.stroke = true; cur.strokeStyle = target.strokeStyle; }
      }
      return { addColorStop: noop, width: 0 };
    },
    set: (target, key, value) => { target[key] = value; return true; },
  });
  const canvas = { ...element(), clientWidth: 360, width: 0, height: 0, getContext: () => rec };
  const modes = ['2d', 'polar', '3d'].map(m => { const b = element(); b.dataset.mode = m; return b; });
  const sky = createSkyView({ canvas, host: element(), toggle: { ...element(), querySelectorAll: () => modes }, notice: element(), hint: element(), height: 200, hint2d: '', hintPolar: '', relief: noop, redraw: noop, viewer: () => null });
  if (mode === 'polar') modes[1].click();
  sky.draw(site, { horizon: { mask: new Array(360).fill(1) }, series: [bodies] }, 0);
  const radius = 6;
  return log.filter(m => m.arc && (m.arc[2] === radius || m.arc[2] === radius - 1));
}
const ringOf = (markers, colour) => markers.filter(m => m.stroke && !m.fill && m.strokeStyle === colour);
const filledOf = (markers, colour) => markers.filter(m => m.fill && m.fillStyle === colour);

for (const mode of ['2d', 'polar']) {
  test(`en el cielo ${mode} la Tierra es un aro donde se solapa con el Sol, y los dos van rellenos si están separados`, () => {
    const sameSpot = recordingView(mode, { sun: body(90, 3), earth: body(90, 3) });
    assert.equal(ringOf(sameSpot, '--color-earth').length, 1, 'la Tierra, sin relleno');
    assert.equal(filledOf(sameSpot, '--color-earth').length, 0);
    assert.equal(filledOf(sameSpot, '--color-sun').length, 1, 'el Sol sigue dibujado');
    const apart = recordingView(mode, { sun: body(90, 3), earth: body(250, 5) });
    assert.equal(filledOf(apart, '--color-earth').length, 1);
    assert.equal(filledOf(apart, '--color-sun').length, 1);
    assert.equal(ringOf(apart, '--color-earth').length, 0);
  });
}

// #505: when the 3D scene cannot build the terrain, the view says so in its notice (role="status") and the normal relief note
// comes back once a site or relief builds fine. A stub scene stands for the WebGL one.
test('el cielo 3D avisa en el aviso (role="status") si no hay terreno y lo retira cuando vuelve a haberlo', async () => {
  const canvas = { ...element(), clientWidth: 360, width: 0, height: 0, getContext: () => ctx };
  const modes = ['2d', 'polar', '3d'].map(m => { const b = element(); b.dataset.mode = m; return b; });
  const notice = element(), hint = element();
  const problems = ['empty', null];
  const scene = { sky: null, stretched: false, stretch: 1, setScene: () => problems.shift(), setInstant: noop, dispose: noop, lookAt: noop };
  const load3d = async () => ({ hasWebGL: () => true, createSky3d: async () => scene });
  let sky;
  const redraw = () => sky.draw(site, SKY, 0);
  sky = createSkyView({ canvas, host: element(), toggle: { ...element(), querySelectorAll: () => modes }, notice, hint, height: 200, relief: () => null, redraw, viewer: () => null, load3d });
  modes[2].click(); // draws once; the scene loads and draws again: the first setScene reports the problem
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(notice.textContent, t('common.sky.noTerrain'));
  assert.equal(notice.hidden, false);
  sky.draw(site, { ...SKY, series: [...SKY.series] }, 0); // another sky: setScene again, now without a problem
  assert.equal(notice.hidden, true, 'the warning goes away once the scene builds');
  assert.match(hint.textContent, / · /, 'the normal relief note is back');
  assert.notEqual(hint.textContent, t('common.sky.noTerrain'));
});

// #505: the warning is written once (a live region re-announces every write), hidden outside 3D and back on return to 3D.
test('el aviso sin terreno no se reescribe en cada dibujo y vuelve al regresar a 3D', async () => {
  const canvas = { ...element(), clientWidth: 360, width: 0, height: 0, getContext: () => ctx };
  const modes = ['2d', 'polar', '3d'].map(m => { const b = element(); b.dataset.mode = m; return b; });
  let writes = 0, text = '';
  const notice = { ...element(), get textContent() { return text; }, set textContent(v) { writes++; text = v; } };
  const scene = { sky: null, stretched: false, stretch: 1, setScene: () => 'empty', setInstant: noop, dispose: noop, lookAt: noop };
  const load3d = async () => ({ hasWebGL: () => true, createSky3d: async () => scene });
  let sky;
  sky = createSkyView({ canvas, host: element(), toggle: { ...element(), querySelectorAll: () => modes }, notice, hint: element(), height: 200, relief: () => null, redraw: () => sky.draw(site, SKY, 0), viewer: () => null, load3d });
  modes[2].click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const before = writes;
  sky.draw(site, SKY, 1); sky.draw(site, SKY, 2);
  assert.equal(writes, before, 'the same warning is not written again');
  modes[0].click(); // 2D: the warning is about 3D only
  assert.equal(notice.hidden, true);
  modes[2].click(); // back to 3D with the same key: it comes back
  assert.equal(notice.textContent, t('common.sky.noTerrain'));
  assert.equal(notice.hidden, false);
});

// #505: static checks on the bare branch of sky3d.js (no WebGL here).
test('sky3d.js: la escena sin terreno no rompe setStretch ni dispose', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../js/common/sky3d.js', import.meta.url), 'utf8');
  assert.match(src, /if \(terrain\) terrain\.scale\.y = wall\.scale\.y = stretch;/, 'setStretch guards the null terrain');
  assert.match(src, /const drop = obj => \{ if \(!obj\) return;/, 'drop ignores null (dispose)');
  assert.match(src, /terrain = wall = stars = null;/, 'the bare branch leaves no terrain, wall or stars');
  assert.match(src, /if \(data\.bare\) compassTags\[n\]\.hidden = true/, 'the compass tags are hidden when bare');
});
