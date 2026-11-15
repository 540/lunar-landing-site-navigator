// Note of sources (E9.4, #47): the notice becomes a button that opens a panel with what is real and what is approximate.
import { UI } from './texts.js';
import { levelCitations, opensDataNote, resolutionLines, showsVerdictSource } from './core/data-note.js';

function section(title, lines) {
  const box = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = title;
  const ul = document.createElement('ul');
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.append(li);
  }
  box.append(h, ul);
  return box;
}

/** Lines of each section of the note; the figures come from meta.json. `verdictSource` is only set in the mission viewer. */
export function noteSections(meta, verdictSource, T = UI.dataNote) {
  const levels = resolutionLines(meta).map(l => (l.measured !== undefined ? T.detailMeasured(T.km(l.extentKm), T.step(l.stepKm), l.measured, l.rmsM) : T[l.kind](T.km(l.extentKm), T.step(l.stepKm))));
  // With a simulated verdict the mission viewer draws the sky and horizon from the simulated engine: they are not real.
  const simulated = verdictSource === 'fake';
  const reliefLine = T.relief(meta.source.products, meta.source.demVersion);
  const sections = [
    { title: T.realTitle, lines: simulated ? [reliefLine, T.reliefScale] : [T.sunEarth, reliefLine, T.reliefScale, T.horizon] },
    { title: T.resolutionTitle, lines: levels },
    {
      title: T.approxTitle,
      lines: [...(simulated ? [T.approxSunEarth, T.approxHorizon] : []), T.noPhoto, T.surfaceDetail, T.farNoShadow, T.shadowsIllustration],
    },
  ];
  if (showsVerdictSource(verdictSource)) {
    sections.push({ title: T.verdictTitle, lines: [verdictSource === 'api' ? T.verdictApi : T.verdictFake] });
  }
  // The ground on foot (exploration only, the mission viewer has the plain ground): the fine texture is not real data
  if (!showsVerdictSource(verdictSource)) sections.push({ title: T.groundTitle, lines: [T.micro] });
  sections.push({ title: T.creditsTitle, lines: [T.credits(meta.source.citation), ...levelCitations(meta).map(T.credits), T.ephemeris, T.suit, T.gestures] });
  return sections;
}

/**
 * Turns the notice into a button that opens the note, if the relief is LOLA. Otherwise leaves it as plain text.
 * The panel is a native modal <dialog>: it traps focus, makes the page inert and closes with Esc.
 * Whatever closes it, the focus goes back to the notice button.
 */
export function setupDataNote({ notice, meta, verdictSource = null }) {
  if (!opensDataNote(meta)) return;
  const T = UI.dataNote;
  const text = notice.textContent;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'notice__btn';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', `${text}. ${T.openLabel}`);
  const label = document.createElement('span');
  label.textContent = text;
  const more = document.createElement('span');
  more.className = 'notice__more';
  more.textContent = T.open;
  button.append(label, ' · ', more);
  notice.replaceChildren(button);

  const panel = document.createElement('dialog');
  panel.className = 'data-note';
  panel.id = 'data-note';
  panel.setAttribute('aria-labelledby', 'data-note-title');
  const title = document.createElement('h2');
  title.id = 'data-note-title';
  title.textContent = T.title;
  title.tabIndex = -1;
  const body = document.createElement('div');
  body.className = 'data-note__body';
  for (const s of noteSections(meta, verdictSource)) body.append(section(s.title, s.lines));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'data-note__close';
  close.textContent = T.close;
  panel.append(title, body, close);
  notice.after(panel);

  button.addEventListener('click', () => {
    panel.showModal();
    button.setAttribute('aria-expanded', 'true');
    // Focus the title, not «Cerrar» (at the end of a scrolling panel): the note opens from the top.
    title.focus();
  });
  close.addEventListener('click', () => panel.close());
  panel.addEventListener('close', () => {
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  });
}
