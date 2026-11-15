import { UI, LANG, useLang } from './texts.js';
import { initLang, carryLang } from '../../shared/i18n/page.js';
import { num } from '../../shared/format/number.js';
import { dateTime } from '../../shared/format/time.js';
import { setupZoom } from './zoom.js';
import { setupHands } from './hands.js';
import { endTour, startTour, startTourIfNew } from '../../web/js/common/tour-engine.js';
import { sampleAt, formatDeg } from './core/series.js';
import { WINDOW_DAYS, SPEEDS, DEFAULT_SPEED_INDEX, START_MIN, START_MAX, clampStart, parseDay, isStartInRange, startFromSearch, dayLabel, instantAt, advance, nextSpeedIndex, stepRun, cancelRun } from './core/timeline.js';
import { pointFromSearch, isLiveStart, chooseSeries, loadLiveSeries, withTimeout, liveErrorText, noticeKey, startSearch, startAction, snapLive, liveDisabledError, LIVE_START_MIN, LIVE_START_MAX } from './core/live-series.js';
import { createSceneFrame } from './core/scene-frame.js';
import { parseMission } from './core/mission-link.js';
import { regionFromSearch, DEFAULT_REGION_ID, REGION_IDS, dayFromSearch, regionSearch, hasApproximateCoordinates, regionOptions, shouldApplyRegion, approxDescribedBy } from './core/regions.js';
import { setupDataNote } from './data-note.js';
import { setupLostNotice } from './lost.js';
import { setupOptions, attachView, setLayer } from './options-ui.js';
import { loadRegion, loadRegionMeta, loadMaskGrid, loadMask, loadSeries as loadRegionSeries, preloadRegion } from './region.js';
import { parseArrival, ARRIVE_KEY } from './core/region-transition.js';
import { createRegionChange, FOCUS_KEY } from './region-change.js';
import { setupSkyPanel } from './sky-panel.js';
import { placeSkyLabels } from './sky-labels.js';

const REGION_ID = regionFromSearch(location.search, id => console.error(`Región desconocida «${id}»: se abre ${DEFAULT_REGION_ID}.`));
// ?lat=…&lon=… opens a place that belongs to no region: the sky and the panel from the live API, without 3D terrain (E10.2).
const POINT = pointFromSearch(location.search);
const START_FOCUS_KEY = 'viewpoint-start-focus';
// ?data=fake means no API: the exploration then only shows the precomputed year.
const LIVE_ENABLED = new URLSearchParams(location.search).get('data') !== 'fake';
const DEFAULT_START = '2027-01-15'; // the date of the API parity example

useLang(initLang());
carryLang(LANG);

// With ?site=… the screen is the viewer of a mission from Plan (V1, #79): mission.js runs it.
const plan = parseMission(location.search);
// The options drawer (E8.2, #498): in the mission viewer it has no region group.
const optionsDrawer = setupOptions({ mission: !!plan });
if (plan) await import('./mission.js').then(m => m.startMission(plan));
else await runTour();

async function runTour() {
  document.title = UI.pageTitle;
  document.getElementById('title').textContent = UI.title;
  const help = document.getElementById('controls-help');
  help.textContent = UI.controlsHelp.split(' · ').join('\n'); // one control a line, in the corner
  help.hidden = false;
  document.getElementById('back-label').textContent = UI.back;
  document.getElementById('tutorial-label').textContent = UI.tutorial;

  // Tutorial: once per browser, and again from its button.
  document.getElementById('tutorial-btn').addEventListener('click', () => startTour('tour', UI.tutorialSteps));

  const $ = id => document.getElementById(id);
  // Arriving from a region change (E7.2, #497): the veil starts closed (fade) or the camera comes down (flight). Opening the
  // link directly has neither.
  const arrival = parseArrival(sessionStorage.getItem(ARRIVE_KEY));
  sessionStorage.removeItem(ARRIVE_KEY);
  if (arrival === 'fade') $('region-veil').classList.add('is-on');
  const openVeil = () => $('region-veil').classList.remove('is-on');
  setTimeout(openVeil, 8000); // never leaves the screen black if something below throws before the veil opens
  // A region change reloads the page with ?start= and ?day=, so the date and the day of the timeline survive it.
  const state = { start: startFromSearch(location.search, DEFAULT_START, LIVE_ENABLED ? isLiveStart : undefined), offsetDays: dayFromSearch(location.search, WINDOW_DAYS) ?? 0, playing: false, speedIndex: DEFAULT_SPEED_INDEX };
  const speedText = n => num(LANG, n, 3);
  let view = null; // the 3D scene, once it loads (null if it cannot)

  $('timeline-label').textContent = UI.timeline.label;
  $('start-label').textContent = UI.timeline.startDate;
  $('start-text').textContent = UI.timeline.startShort;
  $('start-go').textContent = UI.timeline.startGo;
  $('time-range').max = String(WINDOW_DAYS);
  $('start-date').min = LIVE_ENABLED ? LIVE_START_MIN : START_MIN;
  $('start-date').max = LIVE_ENABLED ? LIVE_START_MAX : START_MAX;
  $('start-date').value = state.start;
  $('time-range').setAttribute('aria-label', UI.timeline.slider);

  // One download of the current meta.json, shared by the selector (warning) and the relief.
  // A point without region has no meta.json, no relief and no grid of masks.
  const currentMeta = POINT && !POINT.error ? Promise.reject(new Error('no region')) : loadRegionMeta(REGION_ID);
  currentMeta.catch(() => {});
  const CURRENT_REGION = POINT ? null : REGION_ID; // what the selector shows as the region on screen
  setupRegionSelect();
  setupReset();
  setupHands(() => view);

  /**
   * «Restablecer» (E2.3, #154): back to the initial view of the drone. It is shown from the start, so the tutorial of the
   * first visit (which opens before the scene loads) has its step, and hidden again if there is no scene to restore.
   */
  function setupReset() {
    const btn = $('reset-view');
    $('reset-view-label').textContent = UI.resetView.text;
    btn.setAttribute('aria-label', UI.resetView.label);
    btn.title = UI.resetView.label;
    btn.addEventListener('click', () => view?.resetView());
    btn.hidden = false;
  }

  /**
   * Selector of regions (E2.4, #155): the options are REGION_IDS. It is filled at once with the ids and renamed from each
   * meta.json when it arrives, so a slow or failed fetch never holds the screen. The change is applied with the «Ver región»
   * button, so no arrow key, type-ahead or blur moves the page by itself (WCAG 3.2.2).
   */
  function setupRegionSelect() {
    const select = $('region-select');
    const go = $('region-go');
    $('region-select-label').textContent = UI.regionSelect.label;
    $('region-approx').textContent = UI.regionSelect.approx;
    go.textContent = UI.regionSelect.go;
    const fill = metas => {
      select.replaceChildren(...regionOptions(REGION_IDS, metas, LANG).map(o => new Option(o.label, o.id)));
      select.value = CURRENT_REGION ?? '';
    };
    fill([]);
    Promise.all(REGION_IDS.map(id => (id === CURRENT_REGION ? currentMeta : loadRegionMeta(id)).catch(() => null))).then(fill);
    // The warning belongs to the selector: it comes from the meta of the current region, whatever happens to the series or the relief.
    currentMeta.then(showApprox, () => showApprox(null));
    const sync = () => { go.disabled = !shouldApplyRegion(CURRENT_REGION, select.value); };
    select.addEventListener('change', sync);
    go.addEventListener('click', () => {
      if (regionChange.changing || !shouldApplyRegion(CURRENT_REGION, select.value)) return;
      regionChange.change(select.value, select.selectedOptions[0]?.textContent ?? select.value);
    });
    $('region-picker').hidden = false;
    // After a reload caused by the selector, focus goes back to it.
    if (sessionStorage.getItem(FOCUS_KEY)) {
      sessionStorage.removeItem(FOCUS_KEY);
      // The selector lives in the closed drawer: open it first or the focus goes nowhere
      optionsDrawer.open();
      select.focus();
    }
  }

  const regionChange = createRegionChange({
    doc: document, win: window, storage: sessionStorage, getView: () => view, texts: UI.regionTransition, preload: preloadRegion, openVeil,
    navigate: id => { location.search = regionSearch(location.search, id, state); },
  });

  /** Shows the warning and links it to the selector only together, so a screen reader never reads it for a verified region. */
  function showApprox(meta) {
    const describedBy = approxDescribedBy(meta, 'region-approx');
    if (describedBy) $('region-select').setAttribute('aria-describedby', describedBy);
    else $('region-select').removeAttribute('aria-describedby');
  }

  let series;
  let origin = null; // where the numbers come from: null (precomputed), or 'terrain' | 'flat' (live API, E10.2)
  let clampNow = clampStart; // the identity once the period is live: it is not inside the precomputed range
  const when = offset => instantAt(state.start, offset, clampNow);
  let maskGrid = null; // masks around the site (core/mask-grid.js), null until loaded or when the region has none
  async function loadRelief() {
    const { meta, heights, far, detail } = await loadRegion(REGION_ID, await currentMeta);
    // The flag goes at the coordinates of the catalogue (the centre of the region), through SceneFrame.
    $('notice').textContent = UI.notice[meta.source.type];
    setupDataNote({ notice: $('notice'), meta });
    document.title = `${UI.pageTitle} · ${meta.name[LANG] ?? meta.name.es}`;
    const flag = createSceneFrame(meta.sceneFrame).toScene(meta.center.lat, meta.center.lon);
    return { meta, heights, far, detail, flag };
  }

  // Every figure that does not come from the precomputed year carries its origin (live API, with or without relief).
  function showLiveNote(text) {
    $('live-note').textContent = text ?? '';
    $('live-note').hidden = !text;
  }

  // Does the period on screen fit in the precomputed year? (without it, the API is asked)
  function seriesFitsNow() {
    return isStartInRange(state.start);
  }

  function showSceneError(text) {
    const box = $('scene-error');
    box.textContent = text;
    box.hidden = false;
  }

  const maskLoad = POINT ? Promise.resolve(null) : loadMask(REGION_ID); // in parallel with the series: both are small
  maskLoad.catch(() => {});
  let seriesMask = null;
  if (POINT?.error) {
    $('sun-readout').textContent = UI.live.badPoint;
  } else {
    // A period the precomputed year holds never calls the API; one outside it, or a point without region, asks it (E10.2).
    if (POINT || !seriesFitsNow()) $('sun-readout').textContent = UI.live.loading;
    const api = () => import('../../web/js/adapters/visibility-api.js').then(m => m.apiVisibility({ baseUrl: new URLSearchParams(location.search).get('api') || undefined }));
    const chosen = await chooseSeries({
      start: state.start, days: WINDOW_DAYS, point: POINT,
      loadStatic: () => loadRegionSeries(REGION_ID), loadStaticMask: () => maskLoad,
      clamp: clampStart,
      live: async ({ lat, lon, startMs, days }) => {
        if (!LIVE_ENABLED) throw liveDisabledError();
        const visibility = await api();
        return withTimeout(loadLiveSeries({ sky: (from, to) => visibility.loadSky({ lat, lon }, from, to), lat, lon, startMs, days }));
      },
    });
    ({ series, mask: seriesMask, origin } = chosen);
    state.start = chosen.start;
    if (origin) clampNow = t => t;
    if (!series) $('sun-readout').textContent = chosen.failure && POINT ? '' : UI.loadError;
    if (chosen.failure) {
      console.error(chosen.failure);
      const reason = liveErrorText(chosen.failure, UI.live);
      showLiveNote(POINT ? UI.live.pointFailed(reason) : series ? UI.live.fallback(reason) : null);
    } else if (origin) {
      showLiveNote(UI.live.notice[noticeKey(origin)]);
    }
    $('start-date').value = state.start;
  }
  if (POINT) $('notice').textContent = UI.live.noTerrain;
  // Light and Earth at the flag (E1, #121). Without a series it still shows, to say there is nothing to show.
  const sky = setupSkyPanel({ series: series ?? null, mask: series ? seriesMask : null });
  // The tutorial of the first visit opens once the panel is up, so its steps are not skipped (the scene comes later).
  // The step of the flag only shows in regions with a grid of masks (the box carries `data-grid` for the tour engine).
  const gridMeta = await currentMeta.catch(() => null);
  if (gridMeta?.maskGrid) $('flag-pos-box').dataset.grid = 'true';
  startTourIfNew('tour', UI.tutorialSteps);
  let flagUi = null; // the flag's controls (flag-ui.js), once the scene is up
  let periodStart = null; // start date of the bars and the trails of the ring, to redo them only when it changes

  // The scene is loaded on its own: if the CDN or WebGL fail, the texts, the controls and the readout still work.
  // A relief data error and a scene (import/WebGL) error are different causes and show different texts.
  let footUi = null; // on foot (E3, #181)
  let visitUi = null; // the guided visit (E6.1)
  if (series && !POINT) {
    let relief;
    try {
      relief = await loadRelief();
    } catch (err) {
      console.error(err);
      showSceneError(UI.reliefError);
    }
    if (relief) {
      try {
        const { createScene } = await import('./scene.js');
        const { sun: initialSun } = sampleAt(series, when(state.offsetDays));
        view = createScene($('gl'), initialSun.az, relief, { explore: true, notice: setupLostNotice({ beforeShow: endTour }) });
        setupZoom(view);
        if (arrival === 'flight') view.descend(); // comes down over the new region
        openVeil(); // the scene is up: the rest of the loading shows, not a black screen
        const { setupFoot } = await import('./foot-ui.js');
        const sceneFrame = createSceneFrame(relief.meta.sceneFrame);
        let flagSeries = series; // the series at the flag's point once it moves (E2.2)
        const skyNow = () => sampleAt(flagSeries, when(state.offsetDays));
        footUi = setupFoot(view, sceneFrame, skyNow);
        const { setupGround } = await import('./ground-ui.js');
        const groundUi = setupGround(view, { onChange: on => setLayer('ground', on) });
        attachView(view, groundUi?.paint);
        // The watch on the left wrist (R): what E1 says, on your arm.
        const { setupWatch } = await import('./watch-ui.js');
        const watch = setupWatch(view, { regionId: REGION_ID, series, frame: sceneFrame, instant: () => when(state.offsetDays), start: () => when(0), days: WINDOW_DAYS, sky: skyNow });
        // Your gestures through the camera (arms, fingers, head and eyes, and the watch).
        const { setupGestures } = await import('./gesture-ui.js');
        setupGestures(view);
        // Virtual reality (#396): the button only appears with a headset.
        const { setupXR } = await import('./xr-ui.js');
        setupXR(view);
        const refreshFoot = footUi.refresh;
        footUi.refresh = () => { refreshFoot(); watch.refresh(); };
        // The wedge of the horizon ring and the labels «Sol» and «Tierra» follow the camera (E1, #121).
        view.onCameraChange(() => { sky.setHeading(view); placeLabels(); });
        window.addEventListener('resize', () => { sky.setHeading(view); placeLabels(); });
        // Background load, once the first scene is up: E2.2 and E2.5 read the light and the Earth around the flag from it.
        // Moving the flag (E2.2): without the grid (not loaded yet, or the region has none) it cannot be dragged.
        const { setupFlag } = await import('./flag-ui.js');
        flagUi = setupFlag({ view, frame: sceneFrame, sky, series, hasGrid: !!relief.meta.maskGrid, regionId: REGION_ID, search: location.search, period: () => ({ start: when(0), days: WINDOW_DAYS }), onChange: () => paintTime(), onSeries: (next, nextMask) => { flagSeries = next; watch.setSeries(next, nextMask); } });
        // Guided visit (E6.1): the chapters of this region; the card says when the grid is not there (yet).
        const { setupVisit } = await import('./visit-ui.js');
        const { chaptersFor } = await import('./visit-chapters.js');
        const visit = setupVisit({
          chapters: chaptersFor(REGION_ID), view, flag: flagUi, hasGrid: !!relief.meta.maskGrid, getSeries: () => series, getGrid: () => maskGrid,
          getDate: () => ({ start: state.start, offsetDays: state.offsetDays }),
          setDate: date => {
            state.offsetDays = date.offsetDays;
            // A chapter start the live series does not hold reloads with ?start= (the series would throw outside its range).
            if (startPlan(date.start) === 'reload') { applyStart(date.start); return; }
            state.start = date.start; $('start-date').value = state.start; paintTime(); announce();
          },
          endTutorial: endTour,
          // E6.2: the visit reads, runs and puts back the playback of the timeline
          time: {
            get: () => ({ playing: state.playing, speedIndex: state.speedIndex }),
            set: playback => { state.playing = playback.playing; state.speedIndex = playback.speedIndex; cancelRun(state); paintControls(); },
            runTo: (offsetDays, { speedIndex, onDone, onCancel }) => { state.speedIndex = speedIndex; state.playing = true; state.runTo = { offsetDays, onDone, onCancel }; paintControls(); },
            stop: () => { if (!cancelRun(state)) return; state.playing = false; paintControls(); },
          },
        });
        visitUi = visit;
        // The tutorial and the visit never open together: the tutorial button closes the visit first.
        $('tutorial-btn').addEventListener('click', () => visit.close({ focus: false }), true);
        loadMaskGrid(REGION_ID, relief.meta).then(grid => { maskGrid = grid; flagUi.setGrid(grid); visit.gridChanged(); });
      } catch (err) {
        console.error(err);
        showSceneError(UI.sceneError);
      }
    }
  }
  if (!view) $('reset-view').hidden = true;
  openVeil(); // the fade of arrival (also if the scene could not load)

  function paintControls() {
    $('play-btn').textContent = state.playing ? '❚❚' : '▶';
    $('play-btn').setAttribute('aria-label', state.playing ? UI.timeline.pause : UI.timeline.play);
    const speed = speedText(SPEEDS[state.speedIndex]);
    $('speed-prefix').textContent = UI.timeline.speedPrefix;
    $('speed-text').textContent = UI.timeline.speed(speed, SPEEDS[state.speedIndex] === 1);
  }

  // Screen-reader announcement, only for discrete actions (never per frame). It carries the state of the Sun and the Earth.
  function announce() {
    const instant = when(state.offsetDays);
    const now = sky.states();
    const states = now ? ` · ${UI.sky.announce(now.sun.text, now.earth.text)}` : '';
    $('time-status').textContent = UI.timeline.announce(dayLabel(state.offsetDays), dateTime(LANG, instant)) + states;
    sky.describe?.();
  }

  // «Sol» and «Tierra» in the scene (E1.4), with the countdown of the panel.
  function placeLabels() {
    const now = sky.states();
    if (!view || !now) return;
    const L = UI.sky.label;
    // On a phone the countdown stays in the panel: two long labels do not fit side by side.
    const detail = text => (window.innerWidth > 640 ? text.charAt(0).toLowerCase() + text.slice(1) : undefined);
    placeSkyLabels(view, {
      sun: { seen: now.sun.state !== 'hidden', name: now.sun.state === 'hidden' ? L.sunHidden : L.sun, detail: detail(now.sun.when) },
      earth: { seen: now.earth.state !== 'hidden', name: now.earth.state === 'hidden' ? L.earthHidden : L.earth, detail: detail(now.earth.when) },
    });
  }

  // Updates readout, slider and scene for the current instant.
  function paintTime() {
    const instant = when(state.offsetDays);
    const dateText = dateTime(LANG, instant);
    $('date-readout').textContent = dateText;
    $('time-range').value = String(state.offsetDays);
    $('time-range').setAttribute('aria-valuetext', UI.timeline.sliderValue(dayLabel(state.offsetDays), dateText));
    if (!series) return;
    if (state.start !== periodStart) {
      periodStart = state.start;
      flagUi?.periodChanged();
      sky.setPeriod(when(0), when(WINDOW_DAYS));
    }
    const { sun, earth } = sampleAt(series, instant);
    $('sun-readout').textContent = UI.sunReadout(formatDeg(sun.el, LANG), formatDeg(sun.az, LANG));
    sky.update(instant);
    if (view) {
      const now = sky.states();
      // Faded where the series says the relief hides them, as in the mission viewer.
      view.setSun(sun.az, sun.el, now.sun.state !== 'hidden');
      view.setExploreEarth(earth.az, earth.el, now.earth.state !== 'hidden');
      view.setSkyTime(instant); // the real stars turn with the time
      view.render();
      footUi?.refresh();
      placeLabels();
      visitUi?.timeChanged(); // the guided visit keeps the gaze on the Earth while the time runs
    }
  }

  $('play-btn').addEventListener('click', () => { cancelRun(state); state.playing = !state.playing; paintControls(); if (!state.playing) announce(); });
  $('speed-btn').addEventListener('click', () => { state.speedIndex = nextSpeedIndex(state.speedIndex); paintControls(); });
  $('time-range').addEventListener('input', e => { state.offsetDays = Number(e.target.value); paintTime(); });
  $('time-range').addEventListener('change', announce);
  // Keyboard: arrows move one hour, PageUp/PageDown one day, Home/End jump to the ends of the window.
  const KEY_STEPS = { ArrowLeft: -1 / 24, ArrowDown: -1 / 24, ArrowRight: 1 / 24, ArrowUp: 1 / 24, PageDown: -1, PageUp: 1 };
  $('time-range').addEventListener('keydown', e => {
    let next;
    if (e.key in KEY_STEPS) next = state.offsetDays + KEY_STEPS[e.key];
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = WINDOW_DAYS;
    else return;
    e.preventDefault();
    state.offsetDays = Math.min(WINDOW_DAYS, Math.max(0, next));
    paintTime();
    announce();
  });
  // A period the precomputed year holds changes in place, as the date is typed. Any other (a date outside 2027, or any date once
  // the numbers are live) reloads the page with ?start= and ?day= and the start-up asks the API (E10.2). That one never happens by
  // itself (WCAG 3.2.2): the «Ver fecha» button, shown while such a date is typed, or Enter applies it; the focus comes back after
  // the reload. An out-of-range or incomplete value snaps to the nearest valid date when the field loses focus.
  const startPlan = next => startAction({ next, current: state.start, origin, point: POINT, liveEnabled: LIVE_ENABLED, inRange: isStartInRange });
  const applyStart = next => {
    const action = startPlan(next);
    if (action === 'reload') {
      sessionStorage.setItem(START_FOCUS_KEY, '1');
      location.search = startSearch(location.search, { start: next, offsetDays: state.offsetDays });
    } else if (action === 'in-place') {
      state.start = next;
      paintTime();
      announce();
    }
  };
  const paintStartGo = () => {
    const pending = startPlan($('start-date').value) === 'reload';
    $('start-go').hidden = !pending;
    if (pending) $('start-date').setAttribute('aria-describedby', 'start-go');
    else $('start-date').removeAttribute('aria-describedby');
  };
  $('start-date').addEventListener('input', paintStartGo);
  $('start-date').addEventListener('change', e => {
    if (startPlan(e.target.value) === 'in-place') applyStart(e.target.value);
    paintStartGo();
  });
  $('start-date').addEventListener('keydown', e => {
    if (e.key === 'Enter') applyStart(e.target.value);
  });
  $('start-date').addEventListener('blur', e => {
    // An empty or half-typed date keeps the current start; only a real date out of range is clamped. Blur never reloads.
    const next = parseDay(e.target.value) ? (LIVE_ENABLED ? snapLive(e.target.value) : clampStart(e.target.value)) : state.start;
    e.target.value = next;
    if (startPlan(next) === 'in-place') applyStart(next);
    paintStartGo();
  });
  $('start-go').addEventListener('click', () => applyStart($('start-date').value));
  if (sessionStorage.getItem(START_FOCUS_KEY)) {
    sessionStorage.removeItem(START_FOCUS_KEY);
    $('start-date').focus();
  }

  let last = null;
  function frame(now) {
    if (state.playing && last !== null) {
      const dt = Math.min((now - last) / 1000, 0.1);
      if (state.runTo) {
        // A run of the guided visit: up to a day, without wrapping, and it stops there.
        const { offsetDays, onDone } = state.runTo;
        const step = stepRun(state.offsetDays, dt, SPEEDS[state.speedIndex], offsetDays);
        state.offsetDays = step.offsetDays;
        if (step.done) { state.runTo = null; state.playing = false; paintControls(); onDone?.(); }
      } else state.offsetDays = advance(state.offsetDays, dt, SPEEDS[state.speedIndex]);
      paintTime();
    }
    last = now;
    requestAnimationFrame(frame);
  }

  paintControls();
  paintTime();
  if (view) sky.setHeading(view);
  sky.describe?.();
  requestAnimationFrame(frame);
}

