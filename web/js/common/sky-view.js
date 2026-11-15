// "El cielo desde el sitio" with its 2D / 3D switch (issue #62), shared by Plan and Advanced.
// 2D is the default and is the chart of always (charts.js drawSky); «Brújula», where the toggle offers it, is the same
// sky seen from above (sky-polar.js). 3D shows the relief around the site with the Sun
// and the Earth at the same azimuth and elevation (sky3d.js), from the same sky data plus the relief of the port.
// If the browser has no WebGL, three.js cannot be loaded or the context is lost, it goes back to 2D and says so.
// Under the 3D view the block only has «Sol» and «Tierra». The ⤢ next to the switch (issue #130) opens the 3D viewer of
// viewpoint/ at the same site and instant, on foot: there is only one big 3D.
import { drawSky } from './charts.js';
import { drawSkyPolar } from './sky-polar.js';
import { t } from './i18n.js';
import { skyStateLabel } from './sky-visibility.js';

const NOTICE = {
  webgl: t('common.sky.noWebgl'),
  load: t('common.sky.noLoad'),
  lost: t('common.sky.lost'),
};
const RELIEF_HINT = {
  lola: km => t('common.sky.reliefLola', { km }),
  simulated: km => t('common.sky.reliefSimulated', { km }),
  none: () => t('common.sky.reliefNone'),
  loading: () => t('common.sky.reliefLoading'),
};
const el = (tag, className, text) => { const e = document.createElement(tag); e.className = className; if (text) e.textContent = text; return e; };

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas the 2D chart
 * @param {HTMLElement} o.host empty element where the 3D sky is built
 * @param {HTMLElement} o.toggle group with its buttons, data-mode="2d", optionally "polar", and "3d" (aria-pressed)
 * @param {HTMLElement} o.notice where the fallback to 2D is announced (role="status")
 * @param {HTMLElement} o.hint short note next to the title
 * @param {number|(() => number)} o.height height of the 2D chart, in px; o.height3d, of the 3D one (the same by default).
 *   A function is read on every draw, so a view can size the sky to the window.
 * @param {(site: object, onReady: Function) => object|null|undefined} o.relief relief of the site (undefined while it loads)
 * @param {() => Promise<object>} [o.load3d] loads the 3D module (`createSky3d`, `hasWebGL`); only tests replace it
 * @param {Function} o.redraw asks the view to draw the sky again
 * @param {(site: object, index: number) => string|null} o.viewer URL of the 3D viewer at that site and hour (null: no ⤢)
 */
export function createSkyView({ canvas, host, toggle, notice, hint, height, height3d = height, hint2d = '', hintPolar = '', relief, redraw, viewer, load3d = () => import('./sky3d.js') }) {
  const label2d = canvas.getAttribute('aria-label');
  const buttons = [...toggle.querySelectorAll('button[data-mode]')];
  let mode = '2d', scene = null, starting = null, shownKey = null, problem = null;
  const open = el('a', 'sky-open', '⤢');
  open.setAttribute('aria-label', t('common.sky.open'));
  open.title = t('common.sky.openTitle');
  open.hidden = true;
  toggle.after(open);

  const paintToggle = () => buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  const setHint = text => { if (hint) hint.textContent = text; };
  // 2D and the compass draw the Sun and the Earth as markers of the same size: the note says so (#342).
  const flatHint = text => [text, t('common.sky.notToScale')].filter(Boolean).join(' · ');

  function fallback(reason) {
    mode = '2d';
    scene?.dispose(); scene = null; shownKey = null;
    buttons.find(b => b.dataset.mode === '3d').disabled = true; // it will not work in this session: do not offer it again
    notice.textContent = NOTICE[reason]; notice.hidden = false;
    paintToggle();
    redraw();
  }

  // The bar of the block: look at the Sun and look at the Earth.
  function buildBar() {
    const bar = el('div', 'sky3d__bar');
    const button = (text, label, onClick) => { const b = el('button', 'btn sky3d__btn', text); b.type = 'button'; b.setAttribute('aria-label', label); b.addEventListener('click', onClick); bar.append(b); return b; };
    button(t('common.sun'), t('common.sky.lookSun'), () => scene.lookAt('sun'));
    button(t('common.earth'), t('common.sky.lookEarth'), () => scene.lookAt('earth'));
    host.append(bar);
  }

  function start() {
    starting ??= load3d().then(async ({ createSky3d, hasWebGL }) => {
      if (!hasWebGL()) return fallback('webgl');
      try { scene = await createSky3d(host, { height: height3d, onLost: () => fallback('lost') }); }
      catch (err) { console.warn(`Vista 3D: ${err.message}`); return fallback('load'); }
      buildBar();
      redraw();
    }, err => { console.warn(`Vista 3D: ${err.message}`); fallback('load'); });
  }

  buttons.forEach(b => b.addEventListener('click', () => {
    if (b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    paintToggle();
    redraw();
  }));

  return {
    get mode() { return mode; },
    /** Note of the 2D chart (the 3D one writes its own). */
    set hint2d(text) { hint2d = text; if (mode === '2d') setHint(flatHint(text)); },
    /** The 3D scene, once started (for checks). */
    get scene() { return scene; },
    /** Draws the sky of `site` at hour `index` of `sky` ({ series, horizon }) in the chosen mode. */
    draw(site, sky, index) {
      const href = viewer?.(site, index);
      open.hidden = !href;
      if (href) open.href = href;
      const in3d = mode === '3d';
      if (!in3d && notice.textContent === t('common.sky.noTerrain')) { notice.textContent = ''; notice.hidden = true; } // it is about the 3D view only
      canvas.hidden = in3d; host.hidden = !in3d;
      const px = typeof height === 'function' ? height() : height;
      // The 2D and polar canvases also say whether each body is visible or hidden now, as the 3D one does (#337).
      const now = skyStateLabel(sky.series[Math.min(index, sky.series.length - 1)]);
      if (mode === 'polar') {
        setHint(flatHint(hintPolar)); drawSkyPolar(canvas, { horizon: sky.horizon }, { series: sky.series }, index, px);
        canvas.setAttribute('aria-label', `${canvas.getAttribute('aria-label')} ${now}`); return;
      }
      if (!in3d) { setHint(flatHint(hint2d)); canvas.setAttribute('aria-label', `${label2d}. ${now}`); drawSky(canvas, { horizon: sky.horizon }, { series: sky.series }, index, px); return; }
      if (!scene) { setHint(RELIEF_HINT.loading()); start(); return; }
      const terrain = relief(site, redraw); // undefined while it loads: the horizon alone meanwhile
      const key = `${site.id}|${site.lat}|${site.lon}|${terrain === undefined ? 'loading' : terrain?.source ?? 'none'}`;
      if (shownKey !== key || scene.sky !== sky) {
        problem = scene.setScene({ mask: sky.horizon.mask, relief: terrain ?? null, series: sky.series });
        scene.sky = sky; shownKey = key;
      }
      // Say it: no silent sky without ground. The notice has role="status", so a screen reader announces it too.
      const warning = t('common.sky.noTerrain');
      if (problem) { if (notice.textContent !== warning) notice.textContent = warning; notice.hidden = false; } // only touched when it changes: a live region re-announces any write
      else if (notice.textContent === warning) { notice.textContent = ''; notice.hidden = true; }
      const km = terrain ? Math.round(terrain.distancesKm[terrain.distancesKm.length - 1]) : 0;
      const note = `${RELIEF_HINT[terrain === undefined ? 'loading' : terrain?.source ?? 'none'](km)} · ${scene.stretched ? t('common.sky.stretched', { x: scene.stretch }) : t('common.sky.trueHeight')}`;
      setHint(note);
      scene.setInstant(index);
    },
  };
}
