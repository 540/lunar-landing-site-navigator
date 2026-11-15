// Panel of the end (J7): builds the DOM from the pure figures of end.js. It decides nothing itself: game.js
// passes the state, the scenario and the handlers.
import { endSummary, viewpointUrl } from './end.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// «Fin de la misión», the title in green or red, the explanation with the figures of the game and the actions
// (play again and, when the Mirador can open this site and date, the link to explore it in 3D). `extra` are
// the nodes that later stories add under the actions (illumination map, reference route).
export function endPanel({ state, scenario, texts, onPlayAgain, extra = [] }) {
  const box = el('section', `end end--${state.over}`);
  const title = el('h2', 'end__title', texts.end[state.over].title);
  title.tabIndex = -1;
  box.append(el('p', 'kicker', texts.endKicker), title, el('p', 'end__why', texts.end[state.over].why(endSummary(state))));
  const actions = el('div', 'end__actions');
  const again = el('button', 'again', texts.playAgain);
  again.type = 'button';
  again.addEventListener('click', onPlayAgain);
  actions.append(again);
  const url = viewpointUrl(scenario, state.t);
  if (url) {
    const link = el('a', 'ghost end__link', texts.viewpointLink);
    link.href = url;
    link.title = texts.viewpointLinkTitle(scenario.siteId, scenario.startUtc.slice(0, 10));
    actions.append(link);
  }
  box.append(actions, ...extra);
  return box;
}

// Illumination block (J7.2): the summary sentence, how to read the amber map with its 0–100 % scale, and the
// three lessons as an ordered list.
export function illuminationBlock({ summary, texts }) {
  const box = el('section', 'illum');
  box.append(el('p', 'illum__summary', texts.illumSummary(summary.bestPct, summary.herePct)));
  const legend = el('div', 'illum__legend');
  const bar = el('span', 'illum__bar');
  bar.setAttribute('aria-hidden', 'true');
  legend.append(el('span', 'illum__label', texts.illumLegend), el('span', 'illum__min', texts.illumLegendMin), bar, el('span', 'illum__max', texts.illumLegendMax));
  box.append(legend, el('p', 'hint', texts.illumNote));
  box.append(el('h3', 'lessons__title', texts.lessonsTitle));
  const ol = el('ol', 'lessons');
  for (const lesson of texts.lessons) {
    const li = el('li');
    li.append(el('b', '', lesson.title), document.createTextNode(` ${lesson.text}`));
    ol.append(li);
  }
  box.append(ol);
  return box;
}

// Reference block (J7.3): the solver's route against the player's, as a table with headers.
export function referenceBlock({ comparison, texts }) {
  const box = el('section', 'reference');
  box.append(el('h3', 'reference__title', texts.refTitle), el('p', 'hint', texts.refNote));
  const table = el('table', 'reference__table');
  table.append(el('caption', 'sr-only', texts.refCaption));
  const head = el('tr');
  head.append(el('td'), el('th', '', texts.refYou), el('th', '', texts.refSolver));
  for (const th of head.querySelectorAll('th')) th.scope = 'col';
  const thead = el('thead'); thead.append(head);
  const { player, solver } = comparison;
  const row = (label, a, b) => {
    const tr = el('tr');
    const th = el('th', '', label); th.scope = 'row';
    tr.append(th, el('td', '', a), el('td', '', b));
    return tr;
  };
  const tbody = el('tbody');
  tbody.append(
    row(texts.refMinBattery, texts.refPct(player.minBattery), texts.refPct(solver.minBattery)),
    row(texts.refArrival, player.arrived ? texts.clock(player.day, player.hour) : texts.refNotArrived, texts.clock(solver.day, solver.hour)),
  );
  table.append(thead, tbody);
  box.append(table);
  return box;
}
