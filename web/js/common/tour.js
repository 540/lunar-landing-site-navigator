// Guided tour of web/: the first time a view is opened it walks through its elements in the order to use them.
// It is the guided half of the explanation mode: each step can open the full card of its element.
// The engine (spotlight, popover, what has been seen) is tour-engine.js, shared with the other screens.
import { EXPLANATIONS } from './explanations.js';
import { actions } from './state.js';
import { t } from './i18n.js';
import * as engine from './tour-engine.js';

// One list per view. target: CSS selector (steps whose target is missing or hidden are skipped).
// key: entry of EXPLANATIONS behind «Saber más» (optional). id: its title and text are tour.<view>.<id>.title / .text.
export const TOURS = {
  plan: [
    { id: 'lander', target: '#plan-form [data-explain="plan-lander"]', key: 'plan-lander' },
    { id: 'requirements', target: '#plan-form [data-explain="requirements"]', key: 'requirements' },
    { id: 'zone', target: '#plan-form [data-explain="plan-zone"]', key: 'plan-zone' },
    { id: 'window', target: '#plan-form [data-explain="plan-window"]', key: 'plan-window' },
    { id: 'best', target: '.plan-result', key: 'best' },
    { id: 'timeline', target: '.res-when:not([hidden])', key: 'timeline' },
    { id: 'sky', target: '.res-sky', key: 'panorama' },
    { id: 'replan', target: '.plan-replan' },
    { id: 'next', target: '#res-advanced' },
  ],
  advanced: [
    { id: 'mission', target: '.mission-box', key: 'mission-details' },
    { id: 'podium', target: '#podium', key: 'top3' },
    { id: 'window', target: '#window-box', key: 'landing-strip' },
    { id: 'around', target: '#detail-around', key: 'around' },
    { id: 'time', target: '#detail .player', key: 'time' },
    { id: 'scenarios', target: '.adv-modes', key: 'scenarios' },
    { id: 'map', target: '.top-map-box', key: 'light-map' },
  ],
  replan: [
    { id: 'delay', target: '.rp-delay', key: 'replan-window' },
    { id: 'answer', target: '#rp-answer', key: 'original-plan' },
    { id: 'outcomes', target: '#rp-outcomes', key: 'exit-a' },
    { id: 'details', target: '.rp-details > summary', key: 'sweep' },
  ],
  sources: [
    { id: 'sources', target: '#view-sources', key: 'sources' },
  ],
};

const stepsOf = view => (TOURS[view] || []).map(s => ({
  ...s, title: t(`tour.${view}.${s.id}.title`), text: t(`tour.${view}.${s.id}.text`), more: !!EXPLANATIONS[s.key],
}));
// «Saber más»: opens the explanation card of the step.
const options = { onMore: (step, el) => actions.openExplanation(step.key, el) };

export const startTour = view => engine.startTour(view, stepsOf(view), options);
// Called on every view change: starts the tour only the first time the view is opened in this browser.
export const startTourIfNew = view => engine.startTourIfNew(view, stepsOf(view), options);
