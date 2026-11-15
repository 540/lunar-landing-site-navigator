// The guided visit (E6.1): the card with the question, the bet and the reveal, and the keyboard and announcements around it.
// The state and its transitions are in core/visit.js, the point of the chapter in core/visit-point.js and the chapters in
// visit-chapters.js; this file only draws the state and takes the flag where `flagTarget` says.
import { UI, LANG } from './texts.js';
import { pct, m, num, deg, km } from '../../shared/format/number.js';
import { hours, dateTime } from '../../shared/format/time.js';
import { WINDOW_DAYS, SPEEDS } from './core/timeline.js';
import { prefersReducedMotion } from './core/motion.js';
import { periodSamples } from './core/best-point.js';
import { pickContrastPoint, revealFigures } from './core/visit-point.js';
import { shadowFigures, shadowLengthKm, earthFigures, earthGaze, compareWithBest, RELIEF_HEIGHT_KM, FORMULA_EXAMPLE_DEG } from './core/visit-figures.js';
import { PHASES, LEVELS, startVisit, chapterOf, rightOption, bet, reveal, previous, next, chapterAt, hasPrevious, hasNext, setLevel, exit, outcome, flagTarget, parseLevel, isGraded, canMoveFlag } from './core/visit.js';

const LEVEL_KEY = 'viewpoint-visit-level';
const storedLevel = () => { try { return parseLevel(localStorage.getItem(LEVEL_KEY)); } catch { return parseLevel(null); } };
const storeLevel = level => { try { localStorage.setItem(LEVEL_KEY, level); } catch { /* private mode: it is just not remembered */ } };
const same = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9;

/**
 * @param {{chapters:object[], view:object, flag:{place:Function}, hasGrid:boolean, getSeries:() => object|null, getGrid:() => object|null,
 *   getDate:() => {start:string, offsetDays:number}, setDate:(date:{start:string, offsetDays:number}) => void, endTutorial:() => void,
 *   time?:{get:() => {playing:boolean, speedIndex:number}, set:(playback:{playing:boolean, speedIndex:number}) => void, runTo:(offsetDays:number, options:{speedIndex:number, onDone:() => void}) => void, stop:() => void},
 *   reducedMotion?:() => boolean}} options
 *   `chapters`: those of the region; `flag`: flag-ui.js (`place`, `setLocked`); `site`: where the flag is at the site of the region, where every chapter starts; `hasGrid`: the region has a grid of masks (meta.maskGrid);
 *   `getSeries`: the series of the site, not of the flag's point; `getDate`/`setDate`: the start date and day of the timeline;
 *   `time` (E6.2): the playback of the timeline (read it, put it back, run it up to a day at a speed, stop it); `reducedMotion`: no flights nor time running by itself
 * @returns {{gridChanged:() => void, timeChanged:() => void, isOpen:() => boolean, close:(options?:{focus?:boolean}) => void}} `gridChanged`: the grid has loaded (or failed), so the card can say it;
 *   `timeChanged`: the instant changed (every frame of the timeline), so the gaze keeps on the Earth while it runs
 */
export function setupVisit({ chapters, view, flag, site = view.flagAt(), hasGrid, getSeries, getGrid, getDate, setDate, endTutorial, time = null, reducedMotion = prefersReducedMotion }) {
  const T = UI.visit;
  const $ = id => document.getElementById(id);
  const button = $('visit-btn');
  $('visit-label').textContent = T.start;
  button.setAttribute('aria-label', T.startLabel);
  button.title = T.startLabel;
  if (!chapters.length) return { gridChanged() {}, timeChanged() {}, isOpen: () => false, close() {} };
  button.hidden = false;
  const card = $('visit');
  card.setAttribute('aria-label', T.card);
  $('visit-exit').textContent = T.exit;
  $('visit-prev').textContent = T.previous;
  $('visit-next').textContent = T.next;
  $('visit-skip').textContent = T.skip;
  $('visit-bet-label').textContent = T.bet;
  $('visit-levels').setAttribute('aria-label', T.levelGroup);

  const locks = [$('start-date')];
  let flagLock = null; // 'all' | 'move' (only the drag and the arrows free, «Tú decides») | null
  const lockFlag = mode => {
    if (mode === flagLock) return;
    flagLock = mode;
    flag.setLocked?.(mode ? T.locked : null, { move: mode === 'move' });
  };
  const lock = on => {
    if (!on) lockFlag(null);
    for (const el of locks) {
      if (!el) continue;
      el.disabled = on;
      if (on) { el.setAttribute('aria-disabled', 'true'); el.title = T.locked; } else { el.removeAttribute('aria-disabled'); el.removeAttribute('title'); }
    }
  };

  // `destination`: where the chapter takes the flag; `measured`: the value of the chapter's measure (for the right option); `shown`: the figures of the reveal, already formatted
  let state = null, saved = null, destination = null, measured = null, shown = null, best = null, folded = false, tookFoot = false, tracking = false, pendingExit = false, landingLook = null, pendingRun = null;
  const say = text => { $('visit-status').textContent = text; };

  // The levels: three buttons, the chosen one pressed.
  const levelButtons = LEVELS.map(level => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'visit__level';
    b.textContent = T.levels[level];
    b.addEventListener('click', () => { if (!state) return; state = setLevel(state, level); storeLevel(level); render(); });
    return b;
  });
  $('visit-levels').replaceChildren(...levelButtons);

  /** Why the reveal cannot be done now (a text), or null. Looks for the point only when everything else is there. */
  function blocker() {
    if (chapterOf(state).view === 'foot') return getSeries() ? null : T.noSeries; // on foot the series of the site is enough: no grid
    if (view.foot?.active) return T.needDrone;
    if (!hasGrid) return T.noGrid;
    if (!getGrid()) return T.loading;
    if (!getSeries()) return T.noSeries;
    return null;
  }

  // ---- the scene (E6.2): the visit goes down on foot, looks, and puts back what it moved ----
  const periodStart = chapter => new Date(`${chapter.start}T00:00:00Z`);
  const pausePlayback = () => { const p = saved?.playback; if (p) time?.set({ ...p, playing: false }); };
  const cancelRun = () => { tracking = false; pendingRun = null; time?.stop(); };
  /** Down on foot beside the flag (if it is not already), looking at `look` ({yaw, pitch}). */
  function goFoot(look) {
    if (!view.foot) return;
    if (view.foot.active) { view.foot.lookAt?.(look.yaw, look.pitch); return; }
    pendingExit = false;
    tookFoot = true;
    if (view.foot.flying) { landingLook = look; return; } // a flight down is under way (from an earlier chapter): the gaze is set on landing
    view.foot.enter({ flight: !reducedMotion(), look });
  }
  function leaveFoot() {
    if (!tookFoot) return;
    tookFoot = false;
    landingLook = null;
    if (view.foot?.active) view.foot.exit({ flight: false });
    else if (view.foot?.flying) pendingExit = true; // still flying down: go back up when it lands
  }
  view.foot?.onModeChange?.(mode => {
    if (mode !== 'foot') return;
    if (pendingExit) { pendingExit = false; view.foot.exit({ flight: false }); }
    else {
      if (landingLook) { const l = landingLook; landingLook = null; view.foot.lookAt?.(l.yaw, l.pitch); }
      if (pendingRun) { const run = pendingRun; pendingRun = null; run(); } // the run waited for the landing
    }
  });
  /** The gaze follows the Earth while the time runs (called by the timeline at every frame). */
  function followEarth() {
    if (!tracking || !state || !view.foot?.active) return;
    const g = earthGaze(getSeries(), instantNow());
    view.foot.lookAt?.(g.azimuth, g.lookElevation);
  }
  const instantNow = () => { const d = getDate(); return new Date(periodStart({ start: d.start }).getTime() + d.offsetDays * 86400000); };

  function findDestination(chapter) {
    const series = getSeries(), grid = getGrid();
    try {
      const period = periodSamples(series, new Date(`${chapter.start}T00:00:00Z`), WINDOW_DAYS);
      return pickContrastPoint(grid, series, period, state.origin, { radiusKm: chapter.action.radiusKm, minDifference: chapter.minDifference });
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  const figuresText = f => ({
    sunBefore: pct(LANG, f.before.sunTimeFraction * 100), sunAfter: pct(LANG, f.after.sunTimeFraction * 100),
    earthBefore: pct(LANG, f.before.earthTimeFraction * 100), earthAfter: pct(LANG, f.after.earthTimeFraction * 100),
    distance: m(LANG, Math.round(f.distanceM / 10) * 10),
  });
  const signed = v => `${Math.round(v) < 0 ? '−' : '+'}${num(LANG, Math.abs(v), 0)}`;
  const shadowText = f => ({
    instant: dateTime(LANG, f.date), elevation: deg(LANG, f.elevation, 1), length: km(LANG, f.lengthKm, f.lengthKm < 10 ? 1 : 0), height: km(LANG, RELIEF_HEIGHT_KM, 0),
    exampleDeg: deg(LANG, FORMULA_EXAMPLE_DEG, 1), exampleKm: km(LANG, shadowLengthKm(RELIEF_HEIGHT_KM, FORMULA_EXAMPLE_DEG), 1),
  });
  const earthText = metrics => ({ earthShare: pct(LANG, metrics.earthTimeFraction * 100), longestOutage: hours(LANG, metrics.longestEarthOutageHours) });
  const decideText = c => ({
    isBest: c.isBest,
    mineScore: num(LANG, c.mine.score, 1), bestScore: num(LANG, c.best.score, 1), gainScore: num(LANG, c.gain.score, 1),
    mineSun: pct(LANG, c.mine.sunTime * 100), bestSun: pct(LANG, c.best.sunTime * 100),
    mineEarth: pct(LANG, c.mine.earthTime * 100), bestEarth: pct(LANG, c.best.earthTime * 100),
    mineEnergy: pct(LANG, c.mine.energy * 100), bestEnergy: pct(LANG, c.best.energy * 100),
    gainSun: `${signed(c.gain.sun)} %`, gainEarth: `${signed(c.gain.earth)} %`,
  });

  /** Takes the flag where the state says (the destination only while revealed) and the date of the chapter. */
  async function sync() {
    const target = flagTarget(state, destination);
    if (!same(target, view.flagAt())) await flag.place(target);
  }

  function enterChapter() {
    destination = null; measured = null; shown = null; best = null;
    cancelRun();
    pausePlayback(); // the scene must stay on the instant the chapter describes
    const chapter = chapterOf(state);
    if (chapter.view !== 'foot') leaveFoot();
    const date = getDate();
    if (date.start !== chapter.start || date.offsetDays !== 0) setDate({ start: chapter.start, offsetDays: 0 });
    render();
    say(T.announceChapter(state.index + 1, state.chapters.length, T.chapters[chapter.id].title));
    return sync();
  }

  function render() {
    const chapter = chapterOf(state), text = T.chapters[chapter.id];
    $('visit-count').textContent = T.chapterOf(state.index + 1, state.chapters.length);
    $('visit-title').textContent = text.title;
    $('visit-question').textContent = text.question[state.level];
    levelButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(LEVELS[i] === state.level)));
    const revealed = state.phase === PHASES.revealed;
    const graded = isGraded(chapter);
    const right = revealed && measured !== null ? rightOption(chapter, measured) : -1;
    const options = $('visit-options');
    options.replaceChildren(...chapter.options.map((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'visit__option';
      b.textContent = text.options[o.id];
      b.setAttribute('aria-pressed', String(state.choice === i));
      b.setAttribute('aria-disabled', String(revealed));
      if (revealed) b.dataset.result = i === right ? 'correct' : state.choice === i ? 'wrong' : '';
      b.addEventListener('click', () => {
        if (!state || state.phase === PHASES.revealed) return;
        state = bet(state, i);
        render();
        say(T.yourBet(text.options[o.id]));
        $('visit-options').children[i]?.focus();
      });
      return b;
    }));
    const why = revealed ? null : blocker();
    const result = $('visit-result');
    if (revealed) {
      const kind = outcome(state, measured ?? NaN);
      const chosen = state.choice === null ? null : text.options[chapter.options[state.choice].id];
      const verdict = kind === 'correct' ? T.correct(chosen) : kind === 'wrong' ? T.wrong(chosen, text.options[chapter.options[right].id]) : graded ? T.noBet : T.compared;
      result.dataset.kind = kind;
      $('visit-verdict').textContent = verdict;
      $('visit-explain').textContent = shown ? text.reveal[state.level](shown) : '';
    } else {
      $('visit-verdict').textContent = '';
      $('visit-explain').textContent = '';
    }
    result.hidden = !revealed;
    // A chapter without options has no bet: «Comprobar» reveals from the question.
    $('visit-reveal').textContent = graded ? T.reveal : T.check;
    $('visit-reveal').hidden = revealed || (graded ? state.phase !== PHASES.bet : false);
    $('visit-skip').hidden = revealed || !graded || state.phase !== PHASES.question;
    $('visit-bet-label').hidden = !graded;
    options.hidden = !graded;
    const toBest = $('visit-to-best');
    toBest.textContent = T.toBest;
    toBest.hidden = !(revealed && best && !best.isBest);
    lockFlag(canMoveFlag(state) ? 'move' : 'all');
    $('visit-reveal').setAttribute('aria-disabled', String(!!why));
    $('visit-skip').setAttribute('aria-disabled', String(!!why));
    $('visit-reveal').setAttribute('aria-disabled', String(!!why));
    const note = $('visit-note');
    const hint = !why && !graded && !revealed ? T.moveHint : '';
    note.textContent = why ?? hint;
    note.hidden = !why && !hint;
    $('visit-prev').setAttribute('aria-disabled', String(!hasPrevious(state)));
    $('visit-next').setAttribute('aria-disabled', String(!hasNext(state)));
    $('visit-dots').replaceChildren(...state.chapters.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'visit__dot';
      b.setAttribute('aria-label', T.chapterDot(i + 1, state.chapters.length, T.chapters[c.id].title));
      if (i === state.index) b.setAttribute('aria-current', 'step');
      b.addEventListener('click', () => { go(chapterAt(state, i)); $('visit-dots').children[i]?.focus(); }); // render() rebuilds the dots: the focus goes to the new one
      return b;
    }));
    card.dataset.folded = String(folded);
    $('visit-body').hidden = folded;
    const fold = $('visit-fold');
    fold.textContent = folded ? T.unfold : T.fold;
    fold.setAttribute('aria-expanded', String(!folded));
  }

  /** What each action finds and does on the scene. Returns false (after saying why) if the chapter cannot be revealed now. */
  const ACTIONS = {
    'move-flag-to-contrast': async chapter => {
      const found = findDestination(chapter);
      if (!found) return say_(T.noPoint);
      const figures = revealFigures(getGrid(), getSeries(), periodStart(chapter), WINDOW_DAYS, state.origin, found);
      return { destination: found, measured: found.difference, shown: figuresText(figures) };
    },
    'foot-look-away-from-sun': async chapter => {
      const f = shadowFigures(getSeries(), periodStart(chapter), WINDOW_DAYS);
      if (!f) return say_(T.noInstant);
      setDate({ start: chapter.start, offsetDays: f.offsetDays });
      goFoot({ yaw: f.azimuth + 180, pitch: 0 });
      return { measured: f.lengthKm, shown: shadowText(f) };
    },
    'foot-look-at-earth': async chapter => {
      const series = getSeries(), f = earthFigures(series, periodStart(chapter), WINDOW_DAYS);
      if (!f.run) return say_(T.noEarth);
      const first = earthGaze(series, f.run.from);
      setDate({ start: chapter.start, offsetDays: f.run.fromOffsetDays });
      goFoot({ yaw: first.azimuth, pitch: first.lookElevation });
      if (reducedMotion() || !time) {
        setDate({ start: chapter.start, offsetDays: f.run.toOffsetDays });
        const last = earthGaze(series, f.run.to);
        view.foot?.lookAt?.(last.azimuth, last.lookElevation);
      } else {
        const start = () => {
          tracking = true;
          time.runTo(f.run.toOffsetDays, { speedIndex: SPEEDS.length - 1, onDone: () => { followEarth(); tracking = false; }, onCancel: () => { tracking = false; } });
        };
        // A flight down is under way: the time runs once the visitor has landed, or the Earth would set before they see it.
        if (view.foot?.flying && !view.foot.active) pendingRun = start; else start();
      }
      return { measured: f.metrics.earthTimeFraction, shown: earthText(f.metrics) };
    },
    'compare-with-best': async chapter => {
      say(T.checking);
      const c = await compareWithBest(getGrid(), getSeries(), periodStart(chapter), WINDOW_DAYS, view.flagAt());
      return { best: c, shown: decideText(c) };
    },
  };
  /** Says why a chapter cannot be revealed (the note and the live region) and returns null. */
  function say_(text) { $('visit-note').textContent = text; $('visit-note').hidden = false; say(text); return null; }

  async function doReveal() {
    if (!state || state.phase === PHASES.revealed) return;
    const why = blocker();
    if (why) { render(); say(why); return; }
    const chapter = chapterOf(state), before = state;
    let found;
    try {
      found = await ACTIONS[chapter.action.type](chapter);
    } catch (err) {
      console.error(err);
      found = say_(T.noSeries);
    }
    if (!found || state !== before) return; // it could not be shown, or the visitor went to another chapter meanwhile
    const after = reveal(state, { available: true });
    if (after === state) return;
    state = after;
    destination = found.destination ?? null;
    measured = found.measured ?? null;
    shown = found.shown;
    best = found.best ? { ...found.best, isBest: found.best.isBest } : null;
    render();
    const text = T.chapters[chapter.id];
    say(`${T.announceReveal} ${$('visit-verdict').textContent} ${text.reveal[state.level](shown)}`);
    $('visit-result').focus();
    if (chapter.action.type !== 'compare-with-best') await sync(); // «Tú decides» leaves the flag where the visitor put it
  }

  /** «Llevar la bandera al mejor punto». */
  async function takeToBest() {
    if (!state || state.phase !== PHASES.revealed || !best) return;
    await flag.place({ x: best.best.x, z: best.best.z }, { jump: reducedMotion() });
    say(T.announceBest);
  }

  function go(nextState) {
    if (nextState === state) return;
    state = nextState;
    enterChapter();
  }

  function setFolded(on) {
    folded = on;
    render();
    $(on ? 'visit-fold' : 'visit-title').focus?.();
  }

  function open() {
    if (state?.active) return;
    endTutorial();
    saved = { date: getDate(), flag: view.flagAt(), playback: time?.get() ?? null };
    tookFoot = false; pendingExit = false; landingLook = null; pendingRun = null;
    state = startVisit(chapters, { level: storedLevel(), origin: site });
    lock(true);
    folded = false;
    card.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    enterChapter();
    $('visit-title').focus();
  }

  function close({ focus = true } = {}) {
    if (!state?.active) return;
    state = exit(state);
    const target = saved?.flag ?? flagTarget(state, null);
    lock(false);
    destination = null; measured = null; shown = null; best = null;
    cancelRun();
    if (saved?.playback) time?.set(saved.playback);
    leaveFoot();
    card.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (!same(target, view.flagAt())) flag.place(target, { jump: true }); // also on foot, where a trip is not possible
    if (saved) setDate(saved.date);
    saved = null;
    say(T.announceExit);
    if (focus) button.focus();
    state = null;
  }

  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => (state?.active ? close() : open()));
  $('visit-exit').addEventListener('click', () => close());
  $('visit-fold').addEventListener('click', () => setFolded(!folded));
  $('visit-prev').addEventListener('click', () => state && go(previous(state)));
  $('visit-next').addEventListener('click', () => state && go(next(state)));
  $('visit-reveal').addEventListener('click', doReveal);
  $('visit-skip').addEventListener('click', doReveal);
  $('visit-to-best').addEventListener('click', takeToBest);
  // Escape from inside the card: it folds, and once folded it leaves.
  card.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || !state) return;
    ev.preventDefault();
    ev.stopPropagation(); // foot-view.js listens on window: on foot Escape must not also go up to the drone
    if (folded) close(); else setFolded(true);
  });

  return { gridChanged: () => { if (state) render(); }, timeChanged: followEarth, isOpen: () => !!state?.active, close };
}
