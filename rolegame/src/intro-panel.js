// Panel of the introduction and the trials (J5): builds the DOM from the pure decisions of intro.js.
// It never decides anything itself: game.js passes the phase, the answers and the handlers.
import { introSteps, stepIndex, answerTrial, optionState, miniTexts } from './intro.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (className, text, onClick) => {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

// Steps bar: an ordered list, the current step with aria-current and the previous ones marked as done.
// With `onPick` (J13.3), each step is a button that goes to it.
export function stepsBar(phase, trials, texts, onPick = null) {
  const ol = el('ol', 'steps');
  ol.setAttribute('aria-label', texts.stepsLabel);
  const current = stepIndex(phase, trials);
  introSteps(trials).forEach((id, k) => {
    const li = el('li', k === current ? 'on' : k < current ? 'done' : '');
    const num = el('b', '', String(k));
    num.setAttribute('aria-hidden', 'true');
    const label = el('span', '', texts.steps[id]);
    if (onPick) {
      const b = button('steps__go', '', () => onPick(id));
      b.dataset.step = id;
      if (k === current) b.setAttribute('aria-current', 'step');
      b.append(num, label);
      li.append(b);
    } else {
      if (k === current) li.setAttribute('aria-current', 'step');
      li.append(num, label);
    }
    ol.append(li);
  });
  return ol;
}

// Heading of a phase: focusable from script, so the focus can land on it when the phase changes.
function heading(kicker, title) {
  const h = el('h2', 'intro__title', title);
  h.tabIndex = -1;
  return [el('p', 'kicker', kicker), h];
}

// Landing: what happened, the distance to ASCENSO and the way in (trials or straight to the mission).
export function landingPanel({ km, trials, texts, onStart, onSkip }) {
  const row = el('div', 'intro__actions');
  if (trials.length > 0) row.append(button('again', texts.startTrials, onStart), button('ghost', texts.skipToMission, onSkip));
  else row.append(button('again', texts.startMission, onSkip));
  return [...heading(texts.introKicker, texts.introTitle), el('p', 'lead', texts.introText(km, trials.length)), row];
}

// A trial: question and options; once answered, the verdict, the reveal, its figures and the next step.
// `extra` is a list of nodes for the reveal (sentences with data, the mini chart).
export function trialPanel({ trial, index, trials, choice, texts, extra = [], onAnswer, onNext, onReplay }) {
  const t = texts.trials[trial.key];
  const nodes = heading(texts.trialKicker(index + 1, trials.length, t.name), t.title);
  const q = el('div', 'q');
  q.setAttribute('role', 'group');
  const qid = `q-${trial.id}`;
  const h3 = el('h3', '', t.question);
  h3.id = qid;
  q.setAttribute('aria-labelledby', qid);
  q.append(h3);
  const answered = choice !== undefined;
  t.options.forEach((text, k) => {
    const state = answered ? optionState(trial, choice, k) : null;
    const b = button(`opt${state ? ` opt--${state}` : ''}`, '', () => onAnswer(k));
    const letter = el('b', '', 'ABC'[k]);
    letter.setAttribute('aria-hidden', 'true');
    b.append(letter, el('span', '', text));
    b.disabled = answered;
    q.append(b);
  });
  if (!answered) q.append(button('ghost intro__show', texts.showMe, () => onAnswer(-1)));
  nodes.push(q);
  if (!answered) return { nodes, reveal: null };
  const reveal = el('div', 'reveal');
  reveal.tabIndex = -1;
  const verdict = answerTrial(trial, choice);
  if (verdict !== 'shown') reveal.append(el('p', `verdict verdict--${verdict}`, verdict === 'ok' ? texts.verdictOk : texts.verdictKo));
  reveal.append(el('p', '', t.reveal), ...extra);
  nodes.push(reveal);
  const row = el('div', 'intro__actions');
  const last = trials.indexOf(trial) === trials.length - 1;
  row.append(button('again', last ? texts.startMission : texts.nextTrial, onNext));
  if (onReplay) row.append(button('ghost', texts.replay, onReplay));
  nodes.push(row);
  return { nodes, reveal, verdict };
}

// Battery mini chart (J5.3): 24 h × 0-100 %, Sun line and shadow line from batteryCurves.
export function batteryMini(curves, texts, colors) {
  const canvas = el('canvas', 'mini');
  canvas.setAttribute('role', 'img');
  const labels = miniTexts(curves, texts);
  canvas.setAttribute('aria-label', labels.label);
  canvas.draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 110;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 34, hours = curves.sun.length - 1;
    const X = (k) => pad + (k / hours) * (w - pad - 10);
    const Y = (v) => h - 20 - (v / 100) * (h - 32);
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.beginPath();
    for (const v of [0, 50, 100]) { g.moveTo(pad, Y(v)); g.lineTo(w - 10, Y(v)); }
    g.stroke();
    const line = (values, color) => {
      g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
      values.forEach((v, k) => (k ? g.lineTo(X(k), Y(v)) : g.moveTo(X(k), Y(v))));
      g.stroke();
    };
    line(curves.sun, colors.sun);
    line(curves.dark, colors.dark);
    g.font = '10.5px "JetBrains Mono", monospace';
    g.fillStyle = colors.muted;
    g.textAlign = 'right'; g.fillText('100 %', pad - 5, Y(100) + 4); g.fillText('0 %', pad - 5, Y(0) + 4);
    g.textAlign = 'left'; g.fillText(texts.miniStart, pad, h - 5);
    g.textAlign = 'right'; g.fillText(texts.miniEnd, w - 10, h - 5);
    const mid = Math.floor(hours / 2);
    g.textAlign = 'left';
    g.fillStyle = colors.sun; g.fillText(labels.sun, X(mid), Y(curves.sun[hours]) + 15);
    g.fillStyle = colors.dark; g.fillText(labels.dark, X(mid), Y(curves.dark[hours]) + 15);
  };
  return canvas;
}
