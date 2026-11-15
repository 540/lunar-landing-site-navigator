// Moving the flag (E2.2): dragging it over the terrain, the arrows of the keyboard, the reading of its latitude and longitude
// and the figures of the panel «Luz y Tierra en la bandera» at the new point. The maths is in core/flag-drag.js, the scene
// moves the pieces (scene.js) and the panel draws again (sky-panel.js).
import { prefersReducedMotion } from './core/motion.js';
import { UI, LANG } from './texts.js';
import { deg, pct } from '../../shared/format/number.js';
import { clampToGrid, flagFigures, stepFlag } from './core/flag-drag.js';
import { createFootFigures, insideGrid } from './core/foot-figures.js';
import { flagState, press, climb, plantPoint } from './core/foot-flag.js';
import { flagPlanUrl } from './core/flag-link.js';
import { MAX_DAYS } from './core/mission-link.js';
import { findBestPoint, improvement, periodSamples, scoreAt } from './core/best-point.js';

const GLIDE_MS = 450; // the flag's trip to the best point
const BUSY_AFTER_MS = 500; // the search says «Calculando…» when it takes longer than this
const coord = v => deg(LANG, v, 4, 4);

/**
 * @param {{view:object, frame:{fromScene:Function}, sky:object, series:object, hasGrid:boolean, period:() => {start:Date, days:number}, onChange:() => void, onSeries?:(series:object, mask:object|null) => void}} options
 *   `regionId`, `search`: the region and location.search, for the link «Comparar en el planificador» (E10.1);
 *   `period`: the period the bars show (E2.5: the best point is searched over it); `view`: the scene (with `flagAt`, `moveFlag` and `enableFlagDrag`); `sky`: the panel (with `setSource`); `hasGrid`: the
 *   region has a grid of masks (meta.maskGrid); `onChange`: called after the figures change, to repaint what depends on them
 * @returns {{setGrid:(grid:object|null) => void, periodChanged:() => void, place:(to:{x:number, z:number}) => Promise<boolean>}} `place`: takes the flag to a point for the guided visit; `periodChanged`: hides the note of the best point; `setGrid`: the grid, once downloaded (null if it could not be)
 */
export function setupFlag({ view, frame, sky, series, hasGrid, period, onChange, onSeries, regionId, search = '' }) {
  const T = UI.flag;
  const $ = id => document.getElementById(id);
  const button = $('flag-move'), note = $('flag-note');
  let grid = null;

  const paintPosition = at => {
    const { lat, lon } = frame.fromScene(at.x, at.z);
    $('flag-pos').textContent = T.position(coord(lat), coord(lon));
    return { lat, lon };
  };
  const home = view.flagAt(); // the site of the region: while the flag is here, the link carries the site of the catalogue
  const planLink = $('flag-plan');
  planLink.textContent = T.plan(MAX_DAYS);
  planLink.setAttribute('aria-label', T.planLabel(MAX_DAYS));
  /** The href follows the flag and the start date; no reload. Only from the drone. */
  const paintLink = (at = view.flagAt()) => {
    const { lat, lon } = frame.fromScene(at.x, at.z), { start, days } = period();
    const moved = Math.hypot(at.x - home.x, at.z - home.z) > 1e-6;
    planLink.href = flagPlanUrl({ lat, lon, moved, regionId, start, days, search, lang: LANG });
    planLink.hidden = !!view.foot?.active;
  };
  paintPosition(home);
  paintLink();

  const showNote = text => { note.textContent = text; note.hidden = !text; };
  showNote(hasGrid ? T.loading : T.noGrid);
  button.textContent = T.move;
  button.setAttribute('aria-label', T.moveLabel);

  /** Light and Earth at the point: the nearest grid point while dragging, the exact point on the drop and with the keys. */
  function show(at, exact) {
    showFigures(at, flagFigures(grid, series, at.x, at.z, { exact }));
  }
  function showFigures(at, figures) {
    sky.setSource({ series: figures.series, mask: figures.mask });
    onSeries?.(figures.series, figures.mask);
    paintPosition(at);
    paintLink(at);
    onChange();
  }

  function announce(at) {
    const { lat, lon } = paintPosition(at);
    paintLink(at);
    const now = sky.states();
    let said = '';
    if (now) $('flag-status').textContent = said = T.announce(coord(lat), coord(lon), now.sun.text, now.earth.text);
    sky.describe?.();
    return said;
  }

  // The note of «Mejor punto cercano» and the token of the search: any move of the visitor (drag, arrows, on foot) or a new
  // period makes the note stale and the search in flight obsolete.
  let touched = 0, moves = 0; // `moves`: moves of the flag by the visitor (drag, drop, arrows)
  const clearBest = () => { touched++; const el = document.getElementById('flag-best-note'); el.textContent = ''; el.hidden = true; };

  // The keyboard: only with the focus on the button and after activating it (click, Enter or Space), which picks the flag up
  // or lets it go and says so. Everywhere else, and before that, the arrows keep panning the camera. Escape lets it go.
  let holding = false;
  const setHolding = on => {
    holding = on;
    button.setAttribute('aria-pressed', String(on));
    if (on) $('flag-status').textContent = T.moving;
  };
  setHolding(false);
  // The guided visit (E6.1) locks the visitor's moves of the flag (drag, arrows, «Mejor punto cercano») while it is open.
  let lockedReason = null, moveLocked = false; // `moveLocked`: the drag and the arrows too (a chapter can leave them free, «Tú decides»)
  button.addEventListener('click', () => { if (grid && !view.foot?.active && !moveLocked) setHolding(!holding); });
  button.addEventListener('blur', () => setHolding(false));
  button.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { setHolding(false); return; } // the focus stays on the button
    // The arrows only move the flag once the button has picked it up, and only from the drone, as dragging does (E3.6 brings
    // it on foot).
    if (!holding || !grid || moveLocked || view.foot?.active || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const next = stepFlag(grid, view.flagAt(), ev.key);
    if (!next) return;
    ev.preventDefault();
    clearBest(); moves++;
    view.moveFlag(next.x, next.z);
    show(next, true);
    announce(next);
  });

  // «Mejor punto cercano» (E2.5): searches the grid over the period in view and takes the flag there like a drop (E2.2).
  const best = $('flag-best'), bestNote = $('flag-best-note');
  best.textContent = T.best;
  best.setAttribute('aria-label', T.bestLabel);
  const signed = v => {
    const text = pct(LANG, Math.abs(v));
    return Math.round(v) === 0 ? text : `${v < 0 ? '−' : '+'}${text}`;
  };
  // `spoken`: what announce() has just written to the live region; a polite region reads only its final content, so both go in one update
  const say = (text, spoken = '') => { bestNote.textContent = text; bestNote.hidden = !text; $('flag-status').textContent = spoken ? `${spoken} ${text}` : text; };
  const reduced = () => prefersReducedMotion();
  /** The flag glides to `to` in a short time (the pieces only shifted), or jumps with «reduce motion»; then the drop. */
  function glideTo(to, done, stale) {
    const from = view.flagAt();
    if (reduced() || typeof requestAnimationFrame !== 'function') { done(); return; }
    const t0 = performance.now();
    const step = now => {
      if (stale()) { done(true); return; }
      const k = Math.min(1, (now - t0) / GLIDE_MS), e = k * k * (3 - 2 * k);
      if (k < 1) { view.moveFlag(from.x + (to.x - from.x) * e, from.z + (to.z - from.z) * e, { full: false }); requestAnimationFrame(step); } else done();
    };
    requestAnimationFrame(step);
  }
  let searching = false, slowTimer = null;
  best.addEventListener('click', async () => {
    if (!grid || searching || lockedReason || view.foot?.active) return;
    searching = true;
    const token = ++touched;
    const origin = view.flagAt(), movesAtStart = moves;
    const stale = () => touched !== token || !!view.foot?.active;
    best.setAttribute('aria-busy', 'true');
    const slow = slowTimer = setTimeout(() => say(T.bestBusy), BUSY_AFTER_MS); // only if it takes long
    try {
      const { start, days } = period();
      const samples = periodSamples(series, start, days);
      const here = view.flagAt();
      const before = scoreAt(grid, series, samples, here.x, here.z);
      const found = await findBestPoint(grid, series, samples, here);
      clearTimeout(slow);
      if (stale()) { clearBest(); finish(); return; } // the visitor moved the flag or went on foot meanwhile
      const gain = improvement(before, found);
      // The gain shows in whole points: below that (or with a tiny score) the flag is already at the best point.
      // The score also counts the share of the Sun's disc in view, so it can improve while the hours with Sun and Earth round to 0.
      const worth = gain.score >= 0.5;
      const timeGain = Math.round(gain.sun) !== 0 || Math.round(gain.earth) !== 0;
      const text = !worth ? T.bestHere : timeGain ? T.bestGain(signed(gain.sun), signed(gain.earth)) : T.bestGainScore(signed(gain.score));
      const at = { x: found.x, z: found.z };
      const arrive = aborted => {
        if (!aborted && !stale()) { view.moveFlag(at.x, at.z); show(at, true); say(text, announce(at)); }
        else if (aborted && moves === movesAtStart) { view.moveFlag(origin.x, origin.z); show(origin, true); } // foot or period: back to where it was
        finish();
      };
      if (worth) glideTo(at, arrive, stale); else { say(text); finish(); }
    } catch (err) {
      console.error(err);
      say('');
      finish();
    }
  });
  // searching stays true until the glide has ended (or the search was dropped)
  function finish() {
    clearTimeout(slowTimer);
    searching = false;
    best.removeAttribute('aria-busy');
  }
  // On foot (E3.6): the flag is planted and the figures are those of its point; walking does not change them. Near it «Coger la
  // bandera» (F, or the button) takes it on your right arm: then the figures are those of where you stand, once a second while
  // walking and at once when you stop, and out of the grid they stay and a notice shows. «Plantar la bandera» puts it at your
  // feet (not outside the grid). The rocket and the astronaut do not move on foot: on going up the flag, planted where you are
  // if you carried it, takes them to its point (core/foot-flag.js).
  const act = $('foot-flag');
  act.setAttribute('aria-keyshortcuts', 'F');
  let footFigures = null, lastFoot = null, carried = false, replanted = false;
  const stateNow = () => (lastFoot ? flagState({ carried, me: lastFoot, flag: view.flagAt() }) : carried ? 'carried' : 'planted');
  let painted = null; // last painted state: the DOM is only written when it changes
  const paintAction = () => {
    const state = stateNow(), on = !!view.foot?.active && !!grid && state !== 'planted';
    const key = on ? state : 'off';
    if (key === painted) return;
    const was = painted;
    painted = key;
    if (!on) {
      // keep the focus somewhere stable: a hidden button drops it to <body>
      if (document.activeElement === act) $('view-btn')?.focus?.();
      act.hidden = true;
      return;
    }
    act.hidden = false;
    const text = state === 'carried' ? T.plant : T.grab;
    if (state === 'reach' && was !== 'reach') $('foot-status').textContent = `${T.grab} (F)`; // the flag came within reach
    act.textContent = text;
    act.setAttribute('aria-label', `${text} (F)`);
    act.title = `${text} (F)`;
  };
  const onFootMove = stopped => {
    const s = view.foot?.state?.();
    if (!s || !grid) return;
    lastFoot = { x: s.x, z: s.z, yaw: s.yaw };
    paintAction();
    if (!carried) return; // planted: the figures stay those of its point
    footFigures ||= createFootFigures({ grid, series });
    const r = footFigures.update(s.x, s.z, performance.now(), stopped);
    if (!r) return;
    if (r.status === 'outside') { showNote(T.outside); $('foot-status').textContent = T.outside; return; }
    if (r.status === 'inside') { showNote(''); $('foot-status').textContent = T.inside; }
    showFigures(r.at, r);
  };
  /** Key F or the button: pick the flag up when it is within reach, plant it when it is on your arm. */
  const flagAction = () => {
    const s = view.foot?.state?.();
    if (!s || !grid || !view.foot.active) return;
    lastFoot = { x: s.x, z: s.z, yaw: s.yaw };
    const r = press(stateNow(), { insideGrid: insideGrid(grid, s.x, s.z) });
    if (r.blocked) { $('foot-status').textContent = T.plantOutside; showNote(T.plantOutside); paintAction(); return; }
    if (r.did === 'grab') {
      carried = true;
      view.foot.carryFlag?.(true);
      footFigures = createFootFigures({ grid, series });
      const first = footFigures.update(s.x, s.z, performance.now(), true);
      if (first?.status === 'figures') showFigures(first.at, first);
      // picked up from just past the edge: the figures stay and the notice says so (footFigures is already outside)
      if (first?.status === 'outside') { showNote(T.outside); $('foot-status').textContent = `${T.grabbed} ${T.outside}`; }
      else $('foot-status').textContent = T.grabbed;
    } else if (r.did === 'plant') {
      carried = false; replanted = true; footFigures = null;
      const p = plantPoint(s), at = clampToGrid(grid, p.x, p.z);
      view.foot.carryFlag?.(false);
      view.foot.plantFlag?.(at.x, at.z);
      clearBest();
      showNote('');
      show(at, true);
      $('foot-status').textContent = T.planted;
    }
    paintAction();
  };
  act.addEventListener('click', flagAction);
  view.foot?.onFlagKey?.(flagAction);
  view.foot?.onChange?.(() => onFootMove(false));
  view.foot?.onStop?.(() => onFootMove(true));
  view.foot?.onModeChange?.(mode => {
    best.hidden = !grid || mode === 'foot';
    paintLink();
    footFigures = null;
    if (mode === 'foot') { touched++; carried = false; replanted = false; lastFoot = null; painted = null; paintAction(); return; }
    // going up hides the button: if it has the focus, move it to «Bajar a pie» (the view button is hidden in the drone too)
    if (document.activeElement === act) $('foot-btn')?.focus?.();
    act.hidden = true; painted = 'off';
    if (grid) showNote('');
    const up = climb({ carried });
    if (grid && lastFoot && (up.plant || replanted)) {
      // back up: a flag on your arm is planted where you were (the nearest point of the grid if you were outside); a flag
      // planted on foot stays where it is. Either way the rocket and the astronaut go to it.
      const at = up.plant ? clampToGrid(grid, lastFoot.x, lastFoot.z) : view.flagAt();
      if (up.plant) view.foot.carryFlag?.(false);
      clearBest(); moves++;
      view.moveFlag(at.x, at.z);
      if (up.plant) show(at, true);
    }
    carried = false; replanted = false; lastFoot = null;
  });

  // Taking the flag somewhere on behalf of the guided visit (E6.1): the same trip as «Mejor punto cercano» and the same drop.
  let placing = 0;
  /**
   * The flag travels to `to` (a jump with «reduce motion») and is dropped there, with the figures of the panel at that point.
   * A newer call, or going on foot, cancels the one in flight. Resolves true if the flag arrived.
   * With `jump` the flag goes there at once in any mode (also on foot): it is how the visit puts it back where it was.
   */
  function place(to, { jump = false } = {}) {
    if (jump) {
      placing++; clearBest();
      view.moveFlag(to.x, to.z);
      if (grid) show(to, true); else paintPosition(to);
      return Promise.resolve(true);
    }
    if (!grid || view.foot?.active) return Promise.resolve(false);
    clearBest();
    const token = ++placing, from = view.flagAt();
    return new Promise(resolve => {
      const stale = () => placing !== token || !!view.foot?.active;
      glideTo(to, aborted => {
        if (aborted || stale()) {
          if (placing === token) { view.moveFlag(from.x, from.z); show(from, true); } // cancelled by going on foot: back where it was
          resolve(false);
          return;
        }
        view.moveFlag(to.x, to.z);
        show(to, true);
        resolve(true);
      }, stale);
    });
  }

  /** Locks (with the reason, a text) or unlocks the flag's controls: the drag, the arrows and «Mejor punto cercano». `move: true` leaves the drag and the arrows free. */
  function setLocked(reason, { move = false } = {}) {
    lockedReason = reason || null;
    moveLocked = !!lockedReason && !move;
    if (lockedReason) { if (moveLocked) setHolding(false); touched++; }
    for (const [el, locked] of [[button, moveLocked], [best, !!lockedReason]]) {
      el.setAttribute('aria-disabled', String(locked));
      if (locked) el.title = lockedReason; else el.removeAttribute('title');
    }
    const gl = document.getElementById('gl');
    if (gl) gl.dataset.flagDraggable = moveLocked || !grid ? 'false' : 'true';
  }

  return {
    place,
    setLocked,
    /** The period in view changed: the note of the best point no longer applies. */
    periodChanged() { clearBest(); paintLink(); },
    setGrid(loaded) {
      grid = loaded;
      if (!grid) { showNote(T.noGrid); return; }
      showNote('');
      button.hidden = false;
      best.hidden = !!view.foot?.active;
      document.getElementById('gl').dataset.flagDraggable = 'true';
      view.enableFlagDrag({
        canDrag: () => !view.foot?.active && !moveLocked,
        limit: (x, z) => clampToGrid(grid, x, z),
        onMove: at => { clearBest(); moves++; show(at, false); },
        onDrop: at => { clearBest(); moves++; show(at, true); announce(at); },
      });
    },
  };
}
