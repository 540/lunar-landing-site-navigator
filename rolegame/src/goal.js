// Mission goal (J6.2): the three steps to leave the Moon with the figures of the level. Pure: no DOM here.

// Icons of the prototype (GICON in docs/juego-rol/index.html), as SVG templates; they are decorative. The Sun, Earth
// and verdict colours are the variables of styles/game.css (#341).
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
  const r = (a * Math.PI) / 180;
  const p = (v) => Math.round(v * 100) / 100;
  return `<line x1="${p(24 + Math.cos(r) * 13)}" y1="${p(22 + Math.sin(r) * 13)}" x2="${p(24 + Math.cos(r) * 17)}" y2="${p(22 + Math.sin(r) * 17)}"/>`;
}).join('');
export const GOAL_ICONS = {
  sun: `<svg viewBox="0 0 92 92" aria-hidden="true" focusable="false"><g class="g-spin"><circle cx="24" cy="22" r="9" style="fill:var(--sun)"/><g style="stroke:var(--sun)" stroke-width="2.5" stroke-linecap="round">${RAYS}</g></g><rect x="20" y="46" width="52" height="28" rx="5" fill="none" stroke="#ebe8e2" stroke-width="2.5"/><rect x="72" y="54" width="5" height="12" rx="1.5" fill="#ebe8e2"/><rect class="g-fill" x="25" y="51" width="42" height="18" rx="2.5" style="fill:var(--good)"/></svg>`,
  antenna: '<svg viewBox="0 0 92 92" aria-hidden="true" focusable="false"><circle cx="74" cy="20" r="11" style="fill:var(--earth)"/><path d="M68 15c3 1 4 4 2 7s1 5 4 6M77 11c-1 3 1 4 3 5" style="stroke:var(--good)" stroke-width="2.4" fill="none" stroke-linecap="round"/><g fill="none" style="stroke:var(--earth)" stroke-width="2.6" stroke-linecap="round"><path class="g-wave" d="M34 52a12 12 0 0 1 4-12"/><path class="g-wave" d="M40 56a22 22 0 0 1 8-20"/><path class="g-wave" d="M46 60a32 32 0 0 1 12-28"/></g><path d="M14 78l12-18 12 18M18 72h16" stroke="#ebe8e2" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 58a14 14 0 0 0 19-8z" fill="#ebe8e2"/></svg>',
  rocket: '<svg viewBox="0 0 92 92" aria-hidden="true" focusable="false"><path d="M18 82h56" stroke="#5b6068" stroke-width="3" stroke-linecap="round"/><path d="M30 82l6-10h20l6 10" stroke="#5b6068" stroke-width="2.5" fill="none"/><g class="g-rocket"><path class="g-flame" d="M37 62q5 14 5 16q0-2 5-16z" style="fill:var(--sun)"/><path d="M42 14c8 7 11 18 10 32l-2 16H34l-2-16c-1-14 2-25 10-32z" fill="#ebe8e2"/><circle cx="42" cy="34" r="4.5" fill="#060708"/><path d="M32 48l-7 10v6l8-4M52 48l7 10v6l-8-4" style="fill:var(--bad)"/></g></svg>',
};

// The three steps { icon, title, detail }: packages, deadline day and minimum battery from the level.
export function goalSteps(level, texts) {
  return [
    { icon: 'sun', title: texts.goalSunTitle, detail: texts.goalSunDetail },
    { icon: 'antenna', title: texts.goalPacketsTitle(level.need), detail: texts.goalPacketsDetail(level.txMinKm ?? 1) },
    { icon: 'rocket', title: texts.goalPadTitle(Math.ceil(level.deadline / 24)), detail: texts.goalPadDetail(level.minBat) },
  ];
}
