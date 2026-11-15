// Hand control of a screen: pointing with the index at the camera moves a pointer, folding the thumb clicks what it
// points at (any link, button or control of the page, or the canvas), a pinch drags the scene of the screen and a pinch
// in each hand zooms it (the rules are in gesture.js). It builds its own elements (the camera preview, with space behind
// the user, and the pointer; styles in hands.css) and loads the camera and the hand tracking
// (camera.js) only when it is turned on. Texts for the user in the page language (<html lang>, shared/i18n/page.js).
import { SALUTE, pointerToScreen, saluteMeasures } from './gesture.js';

const STORE_KEY = 'llsn.hands'; // sessionStorage: the hand control stays on from one screen of the site to the next
const ES = {
  preview: 'Control con las manos',
  loading: 'Abriendo la cámara…',
  none: 'Enseña una mano a la cámara.',
  seen: 'Señala la pantalla con el índice para apuntar.',
  drag: 'Señala con el índice para apuntar. Junta pulgar e índice para agarrar la vista; con las dos manos, zoom.',
  point: 'Dobla el pulgar para pulsar donde apuntas.',
  hot: 'Dobla el pulgar para pulsar aquí.',
  grab: 'Agarrado: mueve la mano para girar la vista.',
  zoom: 'Zoom: separa las manos para acercarte y júntalas para alejarte.',
  denied: 'Sin permiso para usar la cámara. Dáselo a esta página en el navegador y vuelve a probar.',
  'no-camera': 'No encuentro ninguna cámara en este dispositivo.',
  camera: 'No he podido abrir la cámara. ¿La está usando otra aplicación?',
  unsupported: 'Este navegador no deja usar la cámara aquí.',
  load: 'No se ha podido cargar el seguimiento de manos. Revisa la conexión y vuelve a probar.',
};
const EN = {
  preview: 'Hand control',
  loading: 'Opening the camera…',
  none: 'Show a hand to the camera.',
  seen: 'Point at the screen with your index finger to aim.',
  drag: 'Point with your index finger to aim. Pinch thumb and index to grab the view; with both hands, zoom.',
  point: 'Fold your thumb to click where you are pointing.',
  hot: 'Fold your thumb to click here.',
  grab: 'Grabbed: move your hand to turn the view.',
  zoom: 'Zoom: spread your hands apart to zoom in, bring them together to zoom out.',
  denied: 'No permission to use the camera. Allow it for this page in the browser and try again.',
  'no-camera': 'No camera found on this device.',
  camera: 'Could not open the camera. Is another app using it?',
  unsupported: 'This browser does not allow the camera here.',
  load: 'Could not load hand tracking. Check your connection and try again.',
};
// Read when used: this module may load before the page has set its language.
const texts = () => (globalThis.document?.documentElement?.lang === 'en' ? EN : ES);
const ERRORS = ['denied', 'no-camera', 'camera', 'unsupported', 'load'];
const CLICKABLE = 'a[href],button,summary,select,input,textarea,label,[role="button"],[tabindex]:not([tabindex="-1"])';
const MAGNET_PX = 22; // a control this close to the pointer takes it
// With ?manos=diagnostico in the address, the preview also shows the measures of the salute of each hand, live, and
// which of them miss (the limits are those of isSalute in gesture.js), to tune the gesture with real hands.
const DIAGNOSIS = new URLSearchParams(location.search).get('manos') === 'diagnostico';
const diagnosis = (hands, aspect, state) => hands.map((lm, i) => {
  const m = saluteMeasures(lm, aspect), L = SALUTE, mark = ok => ok ? '✓' : '✗', n = v => v.toFixed(2).replace('.', ',');
  const straight = m.reach.filter(r => r > L.straightAt).length >= 3 && m.reach.every(r => r > L.foldedAt);
  return `Mano ${i + 1} · saludo\n`
    + `${mark(straight)} dedos ${m.reach.map(n).join(' ')} (3 > ${n(L.straightAt)}, todos > ${n(L.foldedAt)})\n`
    + `${mark(m.spread <= L.togetherAt)} juntos ${n(m.spread)} (≤ ${n(L.togetherAt)})\n`
    + `${mark(m.tilt >= L.tiltAt && m.tilt <= L.tiltUpTo)} de lado ${Math.round(m.tilt)}° (${L.tiltAt}–${L.tiltUpTo})\n`
    + `${mark(m.height <= L.highAt)} altura ${n(m.height)} (≤ ${n(L.highAt)})`;
}).concat(hands.length ? [] : ['Sin manos'])
  .concat(`Seguimiento: ${state.salutes} saludo(s)${state.pointing ? ' · apuntando' : ''}${state.grabbing ? ' · agarrando' : ''}`).join('\n');

function clickable(el) {
  const c = el?.closest?.(CLICKABLE);
  return c && !c.disabled && c.getAttribute('aria-disabled') !== 'true' ? c : null;
}

/** What is under (x, y): `raw`, the element itself, and `hot`, the control there or within MAGNET_PX. */
function pick(x, y) {
  const raw = document.elementFromPoint(x, y);
  let hot = clickable(raw);
  for (let i = 0; i < 8 && !hot; i++) {
    const a = i * Math.PI / 4;
    hot = clickable(document.elementFromPoint(x + MAGNET_PX * Math.cos(a), y + MAGNET_PX * Math.sin(a)));
  }
  return { raw, hot };
}

/** A click of the hand on `el` at (x, y). A slider goes to the value under the pointer; a list, which a script cannot open, to its next option. */
function activate(el, x, y) {
  const changed = () => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  if (el.matches?.('input[type="range"]')) {
    const r = el.getBoundingClientRect(), min = Number(el.min || 0), max = Number(el.max || 100);
    el.value = String(min + (max - min) * Math.min(1, Math.max(0, (x - r.left) / r.width)));
    changed();
  } else if (el.matches?.('select')) {
    if (el.options.length) { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; changed(); }
  } else {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
  }
}

/**
 * @param {object} o
 * @param {HTMLElement} [o.mount] where the preview and the pointer are added
 * @param {HTMLElement[]} [o.buttons] buttons that turn it on and off: this keeps their `aria-pressed` and the text of their `[data-hand-label]`
 * @param {{on:string, off:string}} [o.labels] text of the buttons: `off` to turn it on, `on` to turn it off
 * @param {() => boolean} [o.canDrag] true when the screen has something to drag and zoom right now
 * @param {(dx:number, dy:number) => void} [o.onDrag] the hand moved while pinching, in heights of the camera image (to the user's right and down are positive)
 * @param {(factor:number) => void} [o.onZoom] zoom factor: over 1 is closer
 * @param {() => void} [o.onSalute] a hand saluted (the hand flat by the head, as the astronaut of the Mirador)
 * @param {boolean} [o.resume] false: it is not turned on by itself on load; the screen calls `resume()` where it has hand control
 * @returns {{start: () => Promise<void>, stop: () => void, pause: () => void, resume: () => void, readonly active: boolean}}
 *   `pause()` turns it off without forgetting it was on, and `resume()` turns it on again if it was.
 */
export function createHandPointer({ mount = document.body, buttons = [], labels = { on: 'Dejar de usar las manos', off: 'Mover con las manos' }, canDrag = () => true, onDrag = () => {}, onZoom = () => {}, onSalute = () => {}, resume: resumeOnLoad = true } = {}) {
  const el = (tag, cls, parent) => { const e = document.createElement(tag); e.className = cls; e.setAttribute('aria-hidden', 'true'); parent.append(e); return e; };
  const card = document.createElement('aside');
  card.className = 'handcam'; card.hidden = true; card.setAttribute('aria-label', texts().preview);
  const view = el('div', 'handview', card);
  const video = el('video', '', view); // plays the camera; what is seen is the canvas, with space behind the user
  video.muted = true; video.playsInline = true;
  const canvas = el('canvas', '', view);
  const dots = [el('i', 'handdot', view), el('i', 'handdot', view)];
  const msg = document.createElement('p');
  msg.setAttribute('role', 'status');
  card.append(msg);
  const debug = DIAGNOSIS ? el('pre', 'handdiag', card) : null;
  const decided = { salutes: 0, pointing: false, grabbing: false }; // what the tracking decided, for the diagnosis
  const cursor = el('i', 'handcur', mount);
  mount.append(card);

  let abort = null, raw = null, hot = null, at = { x: 0, y: 0 }, clickTimer = 0;

  function show(key) {
    if (card.dataset.state !== key) { card.dataset.state = key; msg.textContent = texts()[key]; }
    card.classList.toggle('grab', key === 'grab' || key === 'zoom');
    card.classList.toggle('err', ERRORS.includes(key));
    card.hidden = false;
  }
  function paintButtons(on) {
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(on));
      const label = b.querySelector('[data-hand-label]');
      if (label) label.textContent = on ? labels.on : labels.off;
    }
    document.documentElement.classList.toggle('hands-on', on);
  }
  const pointerEvent = (type, bubbles) => new PointerEvent(type, { bubbles, cancelable: true, view: window, clientX: at.x, clientY: at.y, pointerType: 'mouse', isPrimary: true });
  /** The pointer is over `next`: the page hears it as it hears the mouse, and the control under it is outlined. */
  function hover(next) {
    if (next.raw !== raw) { raw?.dispatchEvent(pointerEvent('pointerleave', false)); raw = next.raw; }
    if (next.hot !== hot) {
      hot?.classList.remove('hand-hover');
      hot?.dispatchEvent(pointerEvent('pointerleave', false));
      hot = next.hot;
      hot?.classList.add('hand-hover');
      hot?.dispatchEvent(pointerEvent('pointerenter', false));
    }
    raw?.dispatchEvent(pointerEvent('pointermove', true));
  }

  function onState(s) {
    decided.pointing = !!s.pointer; decided.grabbing = s.grabbing;
    const box = { w: view.clientWidth, h: view.clientHeight };
    dots.forEach((d, i) => {
      const o = s.hands[i];
      d.classList.toggle('on', !!o); d.classList.toggle('grab', !!o?.grabbing);
      if (o) d.style.transform = `translate(${o.x * box.w}px,${o.y * box.h}px)`;
    });
    const drag = canDrag();
    cursor.classList.toggle('on', !!s.pointer);
    cursor.classList.toggle('press', s.pressed);
    if (!s.pointer) hover({ raw: null, hot: null });
    else {
      at = pointerToScreen(s.pointer, innerWidth, innerHeight);
      cursor.style.transform = `translate(${at.x}px,${at.y}px)`;
      // While the thumb is folded the target is kept: the index moves a little with it.
      if (!s.pressed) hover(pick(at.x, at.y));
    }
    cursor.classList.toggle('hot', !!hot);
    show(s.zooming && drag ? 'zoom' : !s.present ? 'none' : s.grabbing && drag ? 'grab' : hot ? 'hot' : s.pointer ? 'point' : drag ? 'drag' : 'seen');
  }
  function onClick() {
    const target = hot ?? raw;
    if (!target) return;
    cursor.classList.add('click');
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => cursor.classList.remove('click'), 260);
    activate(target, at.x, at.y);
  }

  function close() {
    abort?.abort(); abort = null;
    hover({ raw: null, hot: null });
    paintButtons(false);
    card.hidden = true; delete card.dataset.state;
    dots.forEach(d => d.classList.remove('on', 'grab'));
    cursor.classList.remove('on', 'press', 'hot', 'click');
  }
  const remember = on => { try { on ? sessionStorage.setItem(STORE_KEY, '1') : sessionStorage.removeItem(STORE_KEY); } catch { /* no storage: it is turned on by hand on each screen */ } };

  async function start() {
    if (abort) return;
    const ac = abort = new AbortController();
    paintButtons(true); show('loading'); remember(true);
    try {
      const { startHandControl } = await import('./camera.js').catch(err => { throw Object.assign(err, { code: 'load' }); });
      await startHandControl({
        video, canvas, signal: ac.signal, onState, onClick,
        onMove: (dx, dy) => { if (canDrag()) onDrag(dx, dy); },
        onZoom: f => { if (canDrag()) onZoom(f); },
        onSalute: () => { decided.salutes++; onSalute(); },
        onLandmarks: debug ? (hands, aspect) => { debug.textContent = diagnosis(hands, aspect, decided); } : null,
      });
    } catch (err) {
      if (ac !== abort) return; // turned off (or on again) meanwhile
      console.error('Control con las manos:', err);
      close(); remember(false);
      show(ERRORS.includes(err.code) ? err.code : 'camera'); // the message stays until the next try
    }
  }
  function stop() { close(); remember(false); }

  for (const b of buttons) b.addEventListener('click', () => (abort ? stop() : start()));
  paintButtons(false);
  addEventListener('pagehide', close); // the camera closes, and the next screen opens it again
  const remembered = () => { try { return sessionStorage.getItem(STORE_KEY) === '1'; } catch { return false; /* no storage */ } };
  const resume = () => { if (remembered()) start(); };
  if (resumeOnLoad) resume();

  return { start, stop, pause: close, resume, get active() { return !!abort; } };
}
