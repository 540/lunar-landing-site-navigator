// Introduction and trials (J5): the phases before the mission, the steps bar and the predict-and-reveal
// trials. Pure: no DOM here. The numbers the trials reveal come from the scenario tables and the engine.
import { createTables, newGame, pass } from './engine/index.js';

// Hour of the scenario the earth trial freezes the map at (prototype onAnswer: 96 h).
export const EARTH_TRIAL_HOUR = 96;
// Shadows trial: 48 hours of shadows in about 4.2 s (prototype runIntroAnim(0, 48, 4200)).
export const SHADOW_ANIM = { from: 0, to: 48, ms: 4200 };

// Ordered trials: id, text key (TEXTS.trials[key]) and index of the right option.
export const TRIALS = [
  { id: 'shadows', key: 'shadows', answer: 1 },
  { id: 'power', key: 'power', answer: 1 },
  { id: 'earth', key: 'earth', answer: 1 },
];

// Ids of the steps bar: the landing, one per trial and the mission.
export const introSteps = (trials = TRIALS) => ['landing', ...trials.map((t) => t.id), 'play'];

// Phase after `phase`: the landing goes to the first trial (or the mission), each trial to the next one.
export function nextPhase(phase, trials = TRIALS) {
  const steps = introSteps(trials);
  const i = steps.indexOf(phase);
  if (i < 0 || i >= steps.length - 1) return 'play';
  return steps[i + 1];
}

// Position in the bar; the end of the game counts as the mission.
export const stepIndex = (phase, trials = TRIALS) => introSteps(trials).indexOf(phase === 'end' ? 'play' : phase);

export const trialById = (id, trials = TRIALS) => trials.find((t) => t.id === id) ?? null;

// -1 is «Enséñamelo»: the reveal without a verdict.
export function answerTrial(trial, choice) {
  if (choice === -1) return 'shown';
  return choice === trial.answer ? 'ok' : 'ko';
}

// How option k is painted once answered: the right one always 'ok', the chosen one 'ko' if it was wrong.
export function optionState(trial, choice, k) {
  if (k === trial.answer) return 'ok';
  if (choice >= 0 && k === choice) return 'ko';
  return null;
}

// Scenario hour shown `elapsedMs` into the shadows animation, clamped to [from, to].
export function introHour(elapsedMs, { from, to, ms } = SHADOW_ANIM) {
  const k = Math.min(Math.max(elapsedMs / ms, 0), 1);
  return from + (to - from) * k;
}

// Cells that go from shadow to Sun and the other way between two hours (engine threshold: sunFrac > 0.5).
export function shadowChange(tables, from, to) {
  let toSun = 0;
  let toShadow = 0;
  for (let i = 0; i < tables.n * tables.n; i++) {
    const a = tables.sunFrac(i, from) > 0.5;
    const b = tables.sunFrac(i, to) > 0.5;
    if (!a && b) toSun++;
    else if (a && !b) toShadow++;
  }
  return { toSun, toShadow };
}

// Battery hour by hour parked in full Sun and in shadow, from the engine itself (newGame and pass on
// one-cell tables), so the trial and the game tell the same story. hours + 1 values each.
export function batteryCurves(level, { start = 60, hours = 24 } = {}) {
  const scenario = { grid: { n: 1, cellM: 1 }, hours: hours + 1, start: { x: 0, y: 0 }, pad: { x: -1, y: -1 } };
  const curve = (frac) => {
    const tables = createTables(new Uint8Array(hours + 1).fill(Math.round(frac * 255)).buffer, scenario);
    let s = { ...newGame(scenario, level, tables), battery: start };
    const out = [s.battery];
    for (let h = 0; h < hours; h++) {
      s = pass(s, 1);
      out.push(s.battery);
    }
    return out;
  };
  return { sun: curve(1), dark: curve(0) };
}

// First and last hour in which some cell sees the Earth, or null if it never shows up.
export function earthWindow(tables) {
  let first = null;
  let last = null;
  for (let h = 0; h < tables.hours; h++) {
    let any = false;
    for (let i = 0; i < tables.n * tables.n && !any; i++) any = tables.seesEarth(i, h);
    if (any) {
      if (first === null) first = h;
      last = h;
    }
  }
  return first === null ? null : { first, last };
}

// Mission day (1-based) of a game hour.
export const missionDay = (hour) => Math.floor(hour / 24) + 1;

// Labels of the battery mini chart and its accessible summary, from the rounded curve values.
export function miniTexts(curves, texts) {
  const start = curves.sun[0];
  const sun = curves.sun[curves.sun.length - 1];
  const dark = curves.dark[curves.dark.length - 1];
  return { label: texts.miniLabel(start, sun, dark), sun: texts.miniSun(sun), dark: texts.miniDark(dark) };
}
