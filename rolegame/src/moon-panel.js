// The «Dónde estás» box (J8.1, #234) and its tab on phones (J8.2, #235): decides when the 3D scene loads and keeps
// it in step with the game clock. three.js is only asked for with a dynamic import() of moon3d.js, after the first
// drawing of the map and only in full map mode: in light mode (J10.4) the box stays hidden and nothing loads.
import { skyAt } from './moon-sky.js';
import { wireTabs, NARROW_QUERY } from './view-tabs.js';

/** Whether the scene should be loaded now: full map mode and, on a phone, only once the «Luna 3D» tab is open. */
export const shouldLoadMoon = ({ mapMode, narrow, tab, open = true }) => mapMode === 'full' && (narrow ? tab === 'moon' : open);

/** Where the box remembers whether it is open on wide screens. Closed by default: it pushed the game panel down. */
export const MOON_OPEN_KEY = 'llsn.moonOpen';

/** Whether the map should repaint: always on wide screens; on a phone, only with the «Mapa» tab. */
export const mapShown = ({ narrow, tab }) => !narrow || tab === 'map';

/** Ms after the last clock change before the screen-reader summary is updated (not on every animation frame). */
export const SUMMARY_DELAY_MS = 400;

/**
 * Mounts the box. Returns { setTime(t), mapHidden(), toLight(), setTexts(T) }.
 *   stage, tablist, host  the .stage, the #view-tabs list and the #moon box of rolegame/index.html
 *   mapMode               'full' or 'light' (game.mapModeInUse())
 *   load                  () → import('./moon3d.js'); a parameter so tests can count it
 *   onShowMap             () → the map has to be drawn again (the «Mapa» tab came back)
 */
export function mountMoon({ stage, tablist, host, mapMode, series, startMs, texts, isReduced, onShowMap, load = () => import('./moon3d.js') }) {
  let T = texts;
  let mode = mapMode;
  // Light mode: no box, no tabs, no three.js.
  function hideAll() {
    host.hidden = true; tablist.hidden = true; stage.dataset.view = 'map';
    stage.classList.remove('stage--moon');
  }
  if (mode !== 'full') { hideAll(); return { setTime() {}, mapHidden: () => false, toLight() {}, setTexts() {} }; }
  const view = host.querySelector('.moon__view');
  const narrowQuery = matchMedia(NARROW_QUERY);
  let scene = null, loading = null, t = 0, summaryTimer = 0, failed = false;
  stage.classList.add('stage--moon');
  host.hidden = false; tablist.hidden = false;

  // On wide screens the box starts folded to its title: a button opens it (and only then three.js loads).
  let open = false;
  try { open = localStorage.getItem(MOON_OPEN_KEY) === '1'; } catch { /* private window */ }
  const title = host.querySelector('#moon-title');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'moon__toggle';
  toggle.setAttribute('aria-controls', 'moon-body');
  const body = document.createElement('div');
  body.id = 'moon-body';
  body.className = 'moon__body';
  body.append(...[...host.children].filter((c) => !c.classList.contains('moon__head')));
  host.append(body);
  // The title's text moves to the button, and so does its data-text (main.js fills it again on a language switch).
  if (title) { toggle.dataset.text = title.dataset.text; delete title.dataset.text; toggle.append(...title.childNodes); title.replaceChildren(toggle); }
  function setOpen(next) {
    open = next;
    host.classList.toggle('is-closed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    try { localStorage.setItem(MOON_OPEN_KEY, open ? '1' : '0'); } catch { /* private window */ }
  }
  host.classList.toggle('is-closed', !open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.addEventListener('click', () => { setOpen(!open); sync(); });

  // wireTabs selects «Mapa» while it is being wired: until it returns there is nothing to sync.
  let tabs = null;
  tabs = wireTabs(tablist, stage, { onChange: (tab) => {
    if (!tabs) return;
    if (mapShown({ narrow: narrowQuery.matches, tab })) onShowMap?.();
    sync();
  } });
  narrowQuery.addEventListener?.('change', () => { if (mapShown({ narrow: narrowQuery.matches, tab: tabs.current() })) onShowMap?.(); sync(); });

  function notice() {
    failed = true;
    view.replaceChildren();
    const p = document.createElement('p');
    p.className = 'moon__unavailable'; p.textContent = T.moonUnavailable;
    view.append(p);
  }

  function summary() {
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      const s = skyAt(series, startMs, t);
      view.setAttribute('aria-label', T.moonSummary(s.sun.el, s.earth.el));
    }, SUMMARY_DELAY_MS);
  }

  // Loads the scene when it should be on screen; shows or hides it as the tab and the width say.
  function sync() {
    const narrow = narrowQuery.matches, tab = tabs.current();
    const visible = narrow ? tab === 'moon' : open;
    if (scene) { scene.setActive(visible); if (visible) scene.setTime(t); return; }
    if (failed || loading || !shouldLoadMoon({ mapMode: mode, narrow, tab, open })) return;
    loading = load().then((m) => {
      if (mode !== 'full') return;
      try {
        scene = m.createMoonScene(view, { series, startMs, isReduced });
        scene.setTime(t);
        sync();
      } catch { notice(); }
    }).catch(() => notice());
  }

  view.setAttribute('role', 'img');
  summary();
  // After the first drawing of the map: give the page a frame before asking for three.js and the textures.
  requestAnimationFrame(() => setTimeout(sync, 0));

  return {
    setTime(next) {
      if (next === t) return;
      t = next;
      if (scene) scene.setTime(t);
      summary();
    },
    /** True on a phone with the «Luna 3D» tab chosen: the game skips painting the map. */
    mapHidden: () => !mapShown({ narrow: narrowQuery.matches, tab: tabs.current() }),
    /** Light map by hand: the scene goes away and the box with it. */
    toLight() { mode = 'light'; scene?.dispose(); scene = null; hideAll(); onShowMap?.(); },
    setTexts(next) { T = next; if (failed) notice(); summary(); },
  };
}
