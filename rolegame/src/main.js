// Boot module: fills the screen with the texts dictionary of the language in use and starts the game.
// The language (J10.1) is the saved one or the browser's (shared/i18n/lang.js); switching it repaints in place.
import { texts } from './texts.js';
import { startGame } from './game.js';
import { startTour, startTourIfNew } from '../../web/js/common/tour-engine.js';
import { pickLang, langFromSearch, STORAGE_KEY, QUERY_KEY } from '../../shared/i18n/lang.js';
import { carryLang } from '../../shared/i18n/page.js';
import { reduceMotion, toggledMotion, MOTION_KEY } from './motion.js';
import { STABILISER_KEY, stabiliserOn } from './cabin/light.js';
import { toggledMapMode, MAP_KEY } from './map-mode.js';
import { levelFromSearch, seedFromSearch } from './level.js';
import { mountMoon } from './moon-panel.js';
import { mountCabin } from './cabin/panel.js';
import { badgeText, tutorialStepsFor, isRealRelief } from './scenario-source.js';
import { QUALITY_KEY, pressedQuality, trapIndex } from './settings.js';

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
// In private mode a choice is not saved: it lasts until the page reloads.
// Guide line of the cabin (J12): 'off' hides it.
const GUIDE_KEY = 'llsn.cabinGuide';
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not saved */ } };

const queryLang = langFromSearch(location.search);
if (queryLang) save(STORAGE_KEY, queryLang);
let lang = pickLang({ query: queryLang, saved: read(STORAGE_KEY), languages: navigator.languages ?? [navigator.language] });
carryLang(() => lang);

// Reduced motion (J10.2): the system preference unless the switch in «Ajustes» (J13.3) says otherwise.
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
let motionSaved = read(MOTION_KEY);
const reduced = () => reduceMotion({ systemPrefers: systemMotion.matches, saved: motionSaved });
const motionBtn = document.getElementById('motion-btn');
function applyMotion() {
  document.documentElement.classList.toggle('reduce-motion', reduced());
  motionBtn.setAttribute('aria-checked', String(reduced()));
}
applyMotion();
systemMotion.addEventListener?.('change', applyMotion);
motionBtn.addEventListener('click', () => {
  motionSaved = toggledMotion(reduced());
  save(MOTION_KEY, motionSaved);
  applyMotion();
});
// Camera stabiliser of the cabin (fix of J12.2): on by default, a switch in «Ajustes».
let stabSaved = read(STABILISER_KEY);
const stable = () => stabiliserOn(stabSaved);
const stabBtn = document.getElementById('stab-btn');
stabBtn.setAttribute('aria-checked', String(stable()));
stabBtn.addEventListener('click', () => {
  stabSaved = stable() ? 'off' : 'on';
  save(STABILISER_KEY, stabSaved);
  stabBtn.setAttribute('aria-checked', String(stable()));
});
const langButtons = [...document.querySelectorAll('[data-lang]')];
const qualityButtons = [...document.querySelectorAll('[data-quality]')];
const qualityNote = document.getElementById('quality-note');

// Game handle, once the scenario has loaded (the badge and the tutorial read its scenario).
let game = null;

// Fills every data-text, data-aria-label and data-title of the page; it can run again after a switch.
function applyTexts() {
  const T = texts(lang);
  document.documentElement.lang = lang;
  document.title = T.pageTitle;
  for (const el of document.querySelectorAll('[data-text]')) el.textContent = T[el.dataset.text];
  for (const el of document.querySelectorAll('[data-aria-label]')) el.setAttribute('aria-label', T[el.dataset.ariaLabel]);
  for (const el of document.querySelectorAll('[data-title]')) el.setAttribute('title', T[el.dataset.title]);
  for (const b of langButtons) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  showQuality();
  if (game?.scenario) {
    const badge = document.querySelector('.badge');
    badge.textContent = badgeText(game.scenario, T, lang);
    badge.classList.toggle('badge--real', isRealRelief(game.scenario));
  }
}
applyTexts();

// The introduction (J5) opens first; the tutorial of the first visit and the pad hint start with the mission.
// Level and seed of the event come from the address (J6.1, J6.4): ?level=mid&seed=3 replays the same game.
// 3D Moon (J8.1, J8.2): mounted once the map is drawn; until then it hears nothing.
let moon = null;
// Cabin of the rover (J12.1): over the map on LOLA scenarios in full mode; the map is not painted while it is shown.
let cabin = null;
game = await startGame(document.getElementById('map'), document.getElementById('panel'), {
  lang, isReduced: reduced, mapMode: read(MAP_KEY), quality: read(QUALITY_KEY),
  stepsHost: document.getElementById('stepbar'),
  onMapMode: () => { showMapMode(); if (game?.mapModeInUse() !== 'full') { moon?.toLight(); cabin?.toLight(); } },
  onTime: (t, view) => { moon?.setTime(t); cabin?.setView(view); },
  isMapHidden: () => moon?.mapHidden() ?? false,
  levelId: levelFromSearch(location.search),
  seed: seedFromSearch(location.search),
  levelButtons: [...document.querySelectorAll('[data-level]')],
  onPlay: () => {
    // The goal (J6.2) opens when the page is usable: after the tutorial of the first visit, never under it.
    // Closing it starts the pad hint. On a LOLA scenario the camera first comes down from the map to the cabin (J12.1).
    // Over the cabin, closing the tutorial or the goal gives the keyboard back to the cabin, not to the map (J12.6).
    const goal = () => game.openGoal(cabin?.active() ? { returnTo: cabin.focusTarget } : undefined);
    const open = () => {
      tour(startTourIfNew, { onEnd: () => { cabin?.focus(); goal(); } });
      if (!document.getElementById('map').closest('[inert]')) goal();
    };
    if (cabin?.offered) cabin.descend().then(open); else open();
  },
});
applyTexts();

// Light map (J10.4): pressed while the light map is in use. Turning it on drops WebGL in place; turning it off
// reloads the page (the full map needs a new WebGL context), which the button's title says.
if (game) {
  moon = mountMoon({
    stage: document.querySelector('.stage'), tablist: document.getElementById('view-tabs'), host: document.getElementById('moon'),
    mapMode: game.mapModeInUse(), series: game.series, startMs: game.startMs, texts: texts(lang), isReduced: reduced,
    onShowMap: () => game.redraw(),
  });
  const mapCanvas = document.getElementById('map');
  cabin = mountCabin({
    stack: mapCanvas.parentElement, corner: mapCanvas.parentElement.querySelector('.map-corner'),
    scenario: game.scenario, series: game.series, startMs: game.startMs, mapMode: game.mapModeInUse(),
    level: game.quality?.level ?? 'medio', texts: texts(lang), isReduced: reduced, game, quality: game.quality, isStable: stable, lang: () => lang,
    guideOn: () => read(GUIDE_KEY) !== 'off',
  });
  // «Ajustes»: the guide line on the ground of the cabin (J12), only where the cabin exists.
  const guideRow = document.getElementById('guide-row'), guideBtn = document.getElementById('guide-btn');
  guideRow.hidden = !cabin.offered;
  guideBtn.setAttribute('aria-checked', String(read(GUIDE_KEY) !== 'off'));
  guideBtn.addEventListener('click', () => {
    const on = read(GUIDE_KEY) === 'off';
    save(GUIDE_KEY, on ? 'on' : 'off');
    guideBtn.setAttribute('aria-checked', String(on));
    cabin.setGuideOn();
  });
  // The postcard from the cabin (J12.7) also on the end panel, when the cabin is offered.
  if (cabin.offered) game.setEndExtra(() => cabin.postcardButton());
  game.redraw();
}
const mapBtn = document.getElementById('map-btn');
function showMapMode() { mapBtn.setAttribute('aria-checked', String(game?.mapModeInUse() !== 'full')); showQuality(); }
showMapMode();
mapBtn.addEventListener('click', () => {
  const next = toggledMapMode(game?.mapModeInUse() ?? 'light');
  save(MAP_KEY, next);
  if (next === 'light') { game?.toLightMap(); moon?.toLight(); cabin?.toLight(); showMapMode(); } else location.reload();
});

for (const b of langButtons) {
  b.addEventListener('click', () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    save(STORAGE_KEY, lang);
    // An old ?lang= in the address would win over the new choice on reload.
    if (queryLang) {
      const url = new URL(location.href);
      url.searchParams.set(QUERY_KEY, lang);
      history.replaceState(history.state, '', url.href);
    }
    applyTexts();
    game?.setLang(lang);
    moon?.setTexts(texts(lang));
    cabin?.setTexts(texts(lang));
  });
}

// ---- «Ajustes» (J13.3): a menu under its button, closed with Escape or a click outside, focus kept inside ----

// Map quality: the level the map is using is pressed; picking the other one saves it and reloads (the map loads the
// horizon of its level once). In light mode the map is drawn by cells and the choice does not apply.
function showQuality() {
  const T = texts(lang);
  const light = game?.mapModeInUse?.() !== 'full';
  const level = pressedQuality(game?.quality?.level);
  for (const b of qualityButtons) {
    b.setAttribute('aria-pressed', String(!light && b.dataset.quality === level));
    b.disabled = light;
  }
  qualityNote.textContent = light ? T.qualityNoteLight : T.qualityNoteReload;
}
for (const b of qualityButtons) {
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-pressed') === 'true') return;
    save(QUALITY_KEY, b.dataset.quality);
    location.reload();
  });
}

const settingsBtn = document.getElementById('settings-btn');
const settingsMenu = document.getElementById('settings-menu');
const menuControls = () => [...settingsMenu.querySelectorAll('button:not(:disabled)')];
function setMenu(open, { focusButton = false } = {}) {
  settingsMenu.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', String(open));
  if (open) menuControls()[0]?.focus();
  else if (focusButton) settingsBtn.focus();
}
settingsBtn.addEventListener('click', () => setMenu(settingsMenu.hidden));
settingsMenu.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { ev.preventDefault(); setMenu(false, { focusButton: true }); return; }
  if (ev.key !== 'Tab') return;
  const list = menuControls();
  ev.preventDefault();
  list[trapIndex(list.indexOf(document.activeElement), list.length, ev.shiftKey)]?.focus();
});
document.addEventListener('pointerdown', (ev) => {
  if (!settingsMenu.hidden && !ev.target.closest('.settings')) setMenu(false);
});

// Tutorial: once per browser, and again from its button, in the language in use.
// The badge and the tutorial tell the relief and the place of the scenario that loaded (J9.2).
const steps = () => (game?.scenario ? tutorialStepsFor(game.scenario, texts(lang), lang) : texts(lang).tutorialSteps);
const tour = (start, options = {}) => start('juego', steps(), { ...options, labels: texts(lang).tourLabels });
document.getElementById('tutorial-btn').addEventListener('click', () => tour(startTour));
