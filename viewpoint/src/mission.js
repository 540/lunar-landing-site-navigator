// Viewer of a mission from Plan (V1, #79): the lander on the relief of its site, and the mission played from the landing
// to the end. Opened with ?site=<id>&t0=<ISO>&days=<n> (core/mission-link.js), and from the ⤢ of the sky of Plan at the
// instant of its cursor and on foot (?at=, ?view=foot; #130).
// Rule of truth: the scene illustrates, it does not decide. Light or shadow and Earth yes or no come from the mission
// service of Plan (web/js/application/mission-service.js), the same windows as the verdict; never from three.js.
import { setupZoom } from './zoom.js';
import { setupHands } from './hands.js';
import { UI, LANG } from './texts.js';
import { num } from '../../shared/format/number.js';
import { dateTime } from '../../shared/format/time.js';
import { formatDeg } from './core/series.js';
import { createSceneFrame } from './core/scene-frame.js';
import { regionFor, regionNear, planUrl } from './core/mission-link.js';
import { missionFrame, batteryAt } from './core/mission-state.js';
import { attachView } from './options-ui.js';
import { placeSkyLabels } from './sky-labels.js';
import { SPEEDS, DEFAULT_SPEED_INDEX, advanceWithin, nextSpeedIndex } from './core/timeline.js';
import { loadRegion } from './region.js';
import { reliefNoticeKey } from './core/relief.js';
import { setupDataNote } from './data-note.js';
import { setupLostNotice } from './lost.js';
import { formatHours } from '../../planner/src/rules.js';
import { SITES } from '../../web/js/engine/catalog.js';
import { CUSTOM_SITE_ID, customSite } from '../../web/js/common/custom-site.js';
import { createMissionService } from '../../web/js/application/mission-service.js';
import { autoVisibility } from '../../web/js/adapters/visibility-auto.js';

const $ = id => document.getElementById(id);
const DAY_MS = 864e5;

function showSceneError(text) {
  const box = $('scene-error');
  box.textContent = text;
  box.hidden = false;
}

/** True when the site falls inside the square of the region (with a margin, so the lander does not sit on the edge). */
const insideRegion = (meta, p) => Math.max(Math.abs(p.x), Math.abs(p.z)) < meta.extentKm / 2 - 1;

/** The hour-by-hour sky of the mission service, as a promise (it only draws: it decides nothing). */
const loadSky = (service, site, t0, days) => new Promise((resolve, reject) => {
  const hit = service.sky(site, t0, days, (sky, err) => (sky ? resolve(sky) : reject(err ?? new Error('sin cielo'))));
  if (hit) resolve(hit);
});

export async function startMission(plan) {
  const T = UI.mission;
  const utc = ms => dateTime(LANG, ms);
  const deg = v => formatDeg(v, LANG);
  const own = plan.siteId === CUSTOM_SITE_ID && !plan.error;
  const site = own ? customSite(plan.lat, plan.lon) : SITES.find(s => s.id === plan.siteId);
  document.body.classList.add('is-mission');
  document.title = plan.siteId ? T.pageTitle(site ? T.siteShort(site) : plan.siteId) : T.unknownSite;
  $('title').textContent = site ? T.siteName(site) : T.unknownSite;
  $('back-label').textContent = T.back;
  document.querySelector('.back').href = planUrl(plan, location.search);
  $('tutorial-btn').hidden = true;
  $('timeline').hidden = true;
  if (plan.error || !site) { showSceneError(T.badLink); return; }
  $('date-readout').textContent = T.landing(utc(plan.t0), plan.days);

  const regionId = own ? regionNear(site, SITES) : regionFor(site.id);
  if (!regionId) { showSceneError(T.noRegion); return; }

  // The same composition as Plan: the data API if it answers, the simulated engine if not, and the same rules.
  const { visibility } = autoVisibility(new URLSearchParams(location.search));
  const service = createMissionService({ visibility, sites: [site] });
  const mission = { days: plan.days, batteryHours: plan.batteryHours, minEarthPct: plan.minEarthPct, maxEarthGapHours: plan.maxEarthGapHours };
  $('sun-readout').textContent = T.loading;

  let region, sky;
  try {
    region = await loadRegion(regionId);
  } catch (err) {
    console.error(err);
    showSceneError(UI.reliefError);
    return;
  }
  $('notice').textContent = UI.notice[region.meta.source.type];
  try {
    await service.prepare({ fromMs: plan.t0 - DAY_MS, toMs: plan.t0 + (plan.days + 1) * DAY_MS });
    sky = await loadSky(service, site, plan.t0, plan.days);
  } catch (err) {
    console.error(err);
    showSceneError(T.noData);
    $('sun-readout').textContent = '';
    return;
  }
  const { verdict, r } = service.judge(site, plan.t0, mission);
  if (r.noData || !sky.series?.length) { showSceneError(T.noData); $('sun-readout').textContent = ''; return; }
  const noticeKey = reliefNoticeKey(region.meta.source.type, service.source);
  $('notice').textContent = UI.notice[noticeKey];
  if (noticeKey !== region.meta.source.type) {
    $('notice').title = UI.noticeMismatch;
    $('notice').classList.add('notice-warn');
  }
  setupDataNote({ notice: $('notice'), meta: region.meta, verdictSource: service.source });

  // The lander goes at the coordinates of the catalogue site, placed through SceneFrame.
  const lander = createSceneFrame(region.meta.sceneFrame).toScene(site.lat, site.lon);
  if (!insideRegion(region.meta, lander)) { showSceneError(T.noRegion); return; }

  let view = null, footUi = null;
  try {
    const { createScene } = await import('./scene.js');
    view = createScene($('gl'), sky.series[0].sun.az, { ...region, flag: lander }, { foot: true, notice: setupLostNotice({ plannerHref: planUrl(plan, location.search) }) });
    setupZoom(view);
    attachView(view);
    setupHands(() => view);
    // On foot (E3, #130): the same view as in the exploration, next to the lander.
    const { setupFoot } = await import('./foot-ui.js');
    footUi = setupFoot(view, createSceneFrame(region.meta.sceneFrame), () => {
      const f = missionFrame(service, site, sky, plan.t0, at());
      return f.sunDir && f.earthDir ? { sun: f.sunDir, earth: f.earthDir } : null;
    });
  } catch (err) {
    console.error(err);
    showSceneError(UI.sceneError);
  }

  // ---- Timeline of the mission: from t0 to t0 + days, played fast ----
  const state = { offsetDays: plan.atMs ? (plan.atMs - plan.t0) / DAY_MS : 0, playing: false, speedIndex: DEFAULT_SPEED_INDEX };
  const at = () => plan.t0 + state.offsetDays * DAY_MS;
  const dayOf = off => Math.min(Math.floor(off) + 1, Math.ceil(plan.days));
  $('mission-panel-label').textContent = T.panelLabel;
  $('mission-rule').textContent = T.rule;
  $('mission-panel').hidden = false;
  $('timeline').hidden = false;
  $('start-field').hidden = true;
  $('timeline-label').textContent = T.timelineLabel;
  $('time-range').max = String(plan.days);
  $('time-range').setAttribute('aria-label', T.slider);

  function paintControls() {
    $('play-btn').textContent = state.playing ? '❚❚' : '▶';
    $('play-btn').setAttribute('aria-label', state.playing ? UI.timeline.pause : UI.timeline.play);
    const speed = SPEEDS[state.speedIndex];
    $('speed-prefix').textContent = UI.timeline.speedPrefix;
    $('speed-text').textContent = UI.timeline.speed(num(LANG, speed, 3), speed === 1);
  }

  function paintTime() {
    const t = at(), f = missionFrame(service, site, sky, plan.t0, t), dateText = utc(t);
    $('date-readout').textContent = T.instant(dateText, dayOf(state.offsetDays), plan.days);
    $('time-range').value = String(state.offsetDays);
    $('time-range').setAttribute('aria-valuetext', T.sliderValue(dayOf(state.offsetDays), plan.days, dateText));
    $('sun-readout').textContent = f.sunDir ? UI.sunReadout(deg(f.sunDir.el), deg(f.sunDir.az)) : '';
    $('state-sun').textContent = f.sun ? T.light : T.shadow;
    $('state-sun').dataset.on = String(f.sun);
    $('state-earth').textContent = f.earth ? T.earth : T.noEarth;
    $('state-earth').dataset.on = String(f.earth);
    $('mission-note').hidden = !f.mismatch.length;
    $('mission-note').textContent = f.mismatch.length ? T.mismatch(f.mismatch) : '';
    paintBattery(t);
    const ended = state.offsetDays >= plan.days;
    $('mission-verdict').hidden = !ended;
    if (view && f.sunDir) {
      view.setSun(f.sunDir.az, f.sunDir.el, f.sun);
      if (f.earthDir) view.setEarth(f.earthDir.az, f.earthDir.el, f.earth, t);
      const when = t instanceof Date ? t : new Date(t);
      if (!Number.isNaN(when.getTime())) view.setSkyTime(when); // the real stars turn with the time
      view.setLanderLit(f.sun);
      view.render();
      footUi?.refresh();
      placeLabels(f);
    }
    return f;
  }

  // «Sol» and «Tierra» over their discs (shared with the exploration, sky-labels.js).
  function placeLabels(f) {
    placeSkyLabels(view, { sun: { seen: f.sun, name: T.sunLabel(f.sun) }, earth: { seen: f.earth, name: T.earthLabel(f.earth) } });
  }
  window.addEventListener('resize', () => paintTime());
  view?.onCameraChange(() => placeLabels(missionFrame(service, site, sky, plan.t0, at())));

  // ---- Battery (V1.4): the domain's missionTimeline, the same model as «▶ Simular la misión» of Replan ----
  const tl = service.timeline(site, plan.t0, mission, 10 * 60e3);
  if (tl) {
    $('battery').hidden = false;
    $('battery-label').textContent = T.battery;
    $('battery-note').hidden = false;
    $('battery-note').textContent = T.batteryNote(plan.batteryHours);
    if (tl.emptyAtMs !== null) {
      const f = (tl.emptyAtMs - plan.t0) / (plan.days * DAY_MS);
      $('empty-mark').hidden = false;
      $('empty-mark').style.left = `calc(8px + (100% - 16px) * ${f})`;
      $('empty-mark').title = T.emptyAt(utc(tl.emptyAtMs));
    }
  }
  function paintBattery(t) {
    const b = batteryAt(tl, plan.t0, t);
    if (!b) return;
    const pct = Math.round(b.level * 100);
    $('battery-fill').style.width = `${pct}%`;
    $('battery').dataset.level = b.empty ? 'empty' : b.level < 0.25 ? 'low' : 'ok';
    $('battery-value').textContent = b.empty ? T.empty : T.percent(pct);
    $('battery-note').textContent = b.empty ? T.emptyAt(utc(tl.emptyAtMs)) : T.batteryNote(plan.batteryHours);
  }

  // The verdict and the rule that limits most, with the same text as Plan.
  $('verdict-title').textContent = T.verdictTitle(verdict);
  $('verdict-title').dataset.code = verdict.code;
  $('verdict-reason').textContent = T.verdictReason(verdict);

  const announce = () => {
    const f = missionFrame(service, site, sky, plan.t0, at());
    $('time-status').textContent = T.announce(dayOf(state.offsetDays), plan.days, utc(at()), f.sun, f.earth)
      + (state.offsetDays >= plan.days ? ` ${T.ended(T.verdictTitle(verdict), T.verdictReason(verdict))}` : '');
  };

  $('play-btn').addEventListener('click', () => {
    if (!state.playing && state.offsetDays >= plan.days) state.offsetDays = 0; // play again from the landing
    state.playing = !state.playing;
    paintControls();
    if (!state.playing) announce();
  });
  $('speed-btn').addEventListener('click', () => { state.speedIndex = nextSpeedIndex(state.speedIndex); paintControls(); });
  $('time-range').addEventListener('input', e => { state.offsetDays = Number(e.target.value); paintTime(); });
  $('time-range').addEventListener('change', announce);
  const KEY_STEPS = { ArrowLeft: -1 / 24, ArrowDown: -1 / 24, ArrowRight: 1 / 24, ArrowUp: 1 / 24, PageDown: -1, PageUp: 1 };
  $('time-range').addEventListener('keydown', e => {
    let next;
    if (e.key in KEY_STEPS) next = state.offsetDays + KEY_STEPS[e.key];
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = plan.days;
    else return;
    e.preventDefault();
    state.offsetDays = Math.min(plan.days, Math.max(0, next));
    paintTime();
    announce();
  });

  // ---- Jumps (V1.5): to the start of the longest shadow and of the longest Earth outage, the metrics of the domain
  // (planner/src/rules.js), with the camera looking at what covers the Sun or the Earth. No shadow, no button. ----
  const jumps = [
    { id: 'jump-shadow', start: r.longestShadowStart, hours: r.maxDarkHours, body: 'sunDir', label: T.jumpShadow, kind: 'shadow' },
    { id: 'jump-earth', start: r.longestEarthOutageStart, hours: r.maxNoEarthHours, body: 'earthDir', label: T.jumpEarth, kind: 'earth' },
  ];
  for (const j of jumps) {
    const b = $(j.id);
    b.hidden = !(j.start !== null && j.hours > 0);
    if (b.hidden) continue;
    b.textContent = j.label(formatHours(j.hours));
    b.addEventListener('click', () => {
      state.playing = false;
      paintControls();
      state.offsetDays = (j.start - plan.t0) / DAY_MS;
      const f = paintTime();
      if (view && f[j.body]) { view.lookToward(f[j.body].az, f[j.body].el); view.render(); placeLabels(f); }
      $('time-status').textContent = T.jumped(j.kind, utc(j.start));
    });
  }

  let last = null;
  function frame(now) {
    if (state.playing && last !== null) {
      state.offsetDays = advanceWithin(state.offsetDays, Math.min((now - last) / 1000, 0.1), SPEEDS[state.speedIndex], plan.days);
      paintTime();
      if (state.offsetDays >= plan.days) { state.playing = false; paintControls(); announce(); }
    }
    last = now;
    requestAnimationFrame(frame);
  }

  paintControls();
  paintTime();
  if (plan.foot) view?.foot?.enter({ flight: false });
  requestAnimationFrame(frame);
  return { service, site, sky, setOffset: d => { state.offsetDays = d; paintTime(); } };
}
