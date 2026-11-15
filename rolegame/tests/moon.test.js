// J8: the 3D Moon panel (moon-sky.js, moon3d.js, moon-panel.js) and the map / Moon tabs on phones (view-tabs.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { poleDir, skyAt, trail, orbitPath, chevrons, orbitFits, SYNODIC_H, EARTH_PERIOD_H, SUN_RADIUS, ORBIT_POINTS } from '../src/moon-sky.js';
import { nextTab, TABS } from '../src/view-tabs.js';
import { shouldLoadMoon, mapShown } from '../src/moon-panel.js';
import { sampleAt } from '../../viewpoint/src/core/series.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'data/procedural-shackleton');
const scenario = JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8'));
const series = JSON.parse(readFileSync(join(dir, 'series.json'), 'utf8'));
const startMs = Date.parse(scenario.startUtc);
const src = (f) => readFileSync(join(root, f), 'utf8');
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const nearV = (v, w, tol = 1e-9) => { near(v.x, w.x, tol); near(v.y, w.y, tol); near(v.z, w.z, tol); };
const unit = (v) => Math.hypot(v.x, v.y, v.z);

// ---- J8.1: pure sky ----

test('poleDir: azimut 0 en +x, 90° en −z y el cénit hacia −y (el polo sur abajo)', () => {
  nearV(poleDir(0, 0), { x: 1, y: 0, z: 0 });
  nearV(poleDir(90, 0), { x: 0, y: 0, z: -1 });
  nearV(poleDir(0, 90), { x: 0, y: -1, z: 0 });
});

test('trail: 49 puntos, de t a t + 96 h', () => {
  const t = 10;
  const tr = trail(series, startMs, t);
  assert.equal(tr.sun.length, 49);
  assert.equal(tr.earth.length, 49);
  const at = (h) => sampleAt(series, new Date(startMs + h * 3600e3)).sun;
  const first = at(t), last = at(t + 96);
  const scaled = (s) => { const d = poleDir(s.az, s.el); return { x: d.x * SUN_RADIUS, y: d.y * SUN_RADIUS, z: d.z * SUN_RADIUS }; };
  nearV(tr.sun[0], scaled(first));
  nearV(tr.sun[48], scaled(last));
});

test('orbitPath del Sol: 161 puntos y una vuelta completa de azimut (360° ± 5°)', () => {
  const path = orbitPath(series, startMs, 0, SYNODIC_H);
  assert.equal(path.length, ORBIT_POINTS + 1);
  let turn = 0;
  for (let k = 1; k < path.length; k++) {
    const a0 = Math.atan2(-path[k - 1].z, path[k - 1].x), a1 = Math.atan2(-path[k].z, path[k].x);
    let d = ((a1 - a0) * 180) / Math.PI;
    d = ((d + 540) % 360) - 180;
    turn += d;
  }
  assert.ok(Math.abs(Math.abs(turn) - 360) <= 5, `${turn}°`);
  assert.equal(orbitPath(series, startMs, 0, EARTH_PERIOD_H, ORBIT_POINTS, 'earth').length, 161);
});

test('chevrons: 12 posiciones de la órbita con direcciones unitarias', () => {
  const path = orbitPath(series, startMs, 0, SYNODIC_H);
  const ch = chevrons(path, 12);
  assert.equal(ch.length, 12);
  for (const c of ch) {
    near(unit(c.dir), 1, 1e-9);
    assert.ok(path.includes(c.pos));
  }
  assert.equal(chevrons(path, 6).length, 6);
});

test('series.json alcanza para la órbita del Sol desde la última hora de la partida', () => {
  assert.ok(orbitFits(series, scenario.hours));
  assert.ok(scenario.hours + SYNODIC_H <= series.count);
  // The last sample of the orbit from the last hour is inside the series.
  assert.doesNotThrow(() => orbitPath(series, startMs, scenario.hours, SYNODIC_H));
});

test('skyAt da el Sol y la Tierra de la serie, y el resumen los dice en los dos idiomas', () => {
  const s = skyAt(series, startMs, 0);
  near(s.sun.el, series.sun.el[0], 1e-9);
  near(s.earth.az, series.earth.az[0], 1e-9);
  assert.match(texts('es').moonSummary(s.sun.el, s.earth.el), /^La Luna en 3D\. Desde el polo sur, el Sol está a [−-]?\d+,\d° sobre el horizonte y la Tierra a [−-]?\d+,\d°\.$/);
  assert.match(texts('en').moonSummary(1.25, 5.4), /the Sun is 1\.3° above the horizon and the Earth 5\.4°/);
});

// ---- J8.1: the scene, by its text (three.js is not installed for Node) ----

test('moon3d.js usa el globo y la Tierra compartidos y no usa Math.random', () => {
  const s = src('src/moon3d.js');
  assert.match(s, /import \{ createMoonGlobe \} from '\.\.\/\.\.\/shared\/render\/moon-globe\.js';/);
  assert.match(s, /import \{ earthMapPixels, earthSpin \} from '\.\.\/\.\.\/shared\/render\/earth\.js';/);
  assert.match(s, /pixelRatio\(quality\.level,/);
  assert.match(s, /new IntersectionObserver\(/);
  assert.doesNotMatch(s, /Math\.random/);
});

test('modo ligero: three.js solo se pide con import() dinámico, y nunca en modo ligero', () => {
  // No static import of three.js or of the scene anywhere the game loads at start.
  for (const f of ['src/main.js', 'src/game.js', 'src/moon-panel.js', 'src/view-tabs.js', 'src/moon-sky.js']) {
    assert.doesNotMatch(src(f), /from ['"]three['"]|from ['"]\.\/moon3d\.js['"]/, f);
  }
  assert.match(src('src/moon-panel.js'), /load = \(\) => import\('\.\/moon3d\.js'\)/);
  assert.equal(shouldLoadMoon({ mapMode: 'light', narrow: false, tab: 'map' }), false);
  assert.equal(shouldLoadMoon({ mapMode: 'light', narrow: true, tab: 'moon' }), false);
  assert.equal(shouldLoadMoon({ mapMode: 'full', narrow: false, tab: 'map' }), true);
});

test('modo ligero: mountMoon oculta el recuadro y las pestañas y no llama a load()', async () => {
  const { mountMoon } = await import('../src/moon-panel.js');
  const el = () => ({ hidden: false, dataset: {}, classList: { add() {}, remove() {} } });
  const stage = el(), tablist = el(), host = el();
  let loads = 0;
  const api = mountMoon({ stage, tablist, host, mapMode: 'light', series, startMs, texts: texts('es'), load: () => { loads++; return Promise.resolve({}); } });
  assert.equal(host.hidden, true);
  assert.equal(tablist.hidden, true);
  assert.equal(api.mapHidden(), false);
  api.setTime(5);
  assert.equal(loads, 0);
});

test('la importmap de rolegame/index.html es la de three-version.js', async () => {
  const { THREE_URL } = await import('../../shared/render/three-version.js');
  assert.ok(src('index.html').includes(`{"imports":{"three":"${THREE_URL}"}}`));
});

// ---- J8.2: tabs ----

test('nextTab: flechas con vuelta, Inicio y Fin, y las demás teclas no cambian nada', () => {
  assert.deepEqual(TABS, ['map', 'moon']);
  assert.equal(nextTab('map', 'ArrowRight', TABS), 'moon');
  assert.equal(nextTab('moon', 'ArrowRight', TABS), 'map');
  assert.equal(nextTab('map', 'ArrowLeft', TABS), 'moon');
  assert.equal(nextTab('moon', 'Home', TABS), 'map');
  assert.equal(nextTab('map', 'End', TABS), 'moon');
  assert.equal(nextTab('map', 'Enter', TABS), 'map');
});

test('en el móvil el mapa no se pinta con «Luna 3D», y three.js no se pide hasta abrirla', () => {
  assert.equal(mapShown({ narrow: true, tab: 'moon' }), false);
  assert.equal(mapShown({ narrow: true, tab: 'map' }), true);
  assert.equal(mapShown({ narrow: false, tab: 'moon' }), true);
  assert.equal(shouldLoadMoon({ mapMode: 'full', narrow: true, tab: 'map' }), false);
  assert.equal(shouldLoadMoon({ mapMode: 'full', narrow: true, tab: 'moon' }), true);
});

test('las pestañas siguen el patrón accesible (tablist, tab, aria-selected, aria-controls, tabpanel)', () => {
  const html = src('index.html');
  assert.match(html, /id="view-tabs" role="tablist"/);
  assert.match(html, /role="tab" id="tab-map" data-tab="map" aria-controls="map-view" aria-selected="true"/);
  assert.match(html, /role="tab" id="tab-moon" data-tab="moon" aria-controls="moon" aria-selected="false"/);
  assert.match(html, /id="map-view" role="tabpanel"/);
  assert.match(html, /id="moon" role="tabpanel"/);
  assert.equal(texts('es').tabMap, 'Mapa');
  assert.equal(texts('es').tabMoon, 'Luna 3D');
});

test('«Dónde estás» empieza plegado en pantalla ancha: no carga la Luna 3D hasta que se abre', () => {
  assert.equal(shouldLoadMoon({ mapMode: 'full', narrow: false, tab: 'map', open: false }), false);
  assert.equal(shouldLoadMoon({ mapMode: 'full', narrow: false, tab: 'map', open: true }), true);
  // En el móvil manda la pestaña «Luna 3D», no el pliegue.
  assert.equal(shouldLoadMoon({ mapMode: 'full', narrow: true, tab: 'moon', open: false }), true);
});
