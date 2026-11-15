// Dictionaries of the planner, one file per area so each view is translated on its own. Every file exports
// { es, en } with keys prefixed by its area; html.js holds the English of the static texts of index.html (their
// Spanish stays in the HTML). test/i18n.test.js checks that English has every Spanish key and no key is repeated.
import * as common from './common.js';
import * as plan from './plan.js';
import * as advanced from './advanced.js';
import * as replan from './replan.js';
import * as sources from './sources.js';
import * as explanations from './explanations.js';
import * as tour from './tour.js';
import * as html from './html.js';

export const AREAS = { common, plan, advanced, replan, sources, explanations, tour, html };
export const DICTS = {
  es: Object.assign({}, ...Object.values(AREAS).map(a => a.es)),
  en: Object.assign({}, ...Object.values(AREAS).map(a => a.en)),
};
