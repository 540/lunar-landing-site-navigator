// The chosen plan: Plan creates it, Advanced marks it and Replan uses it.
import { profileById, profileFor, profileSource } from '../engine/catalog.js';
import { $, isoLocal } from './util.js';
import { state, actions } from './state.js';

// Sets an option as the plan: its date and requirements flow to the other views.
// From Plan or Advanced it is a new approved plan (the original). From Replan (fromReplan) it only replaces the
// current plan: the original stays and the change goes to the history. With navigate, both go to Plan to see it.
// auto marks the automatic search's pick, which is not a plan the user adopted (Replan then warns it is a sample).
export function adopt(option, selected, navigate = true, { fromReplan = false, auto = false } = {}) {
  const cond = state.searchResult?.conditions;
  if (fromReplan && state.originalPlan) state.replanHistory = [...state.replanHistory, { from: state.plan, to: option }];
  else { state.originalPlan = { site: option.site, landing: option.landing }; state.planAdoptedByUser = !auto; state.replanHistory = []; }
  state.plan = option;
  $('date').value = isoLocal(option.landing); $('delay').value = 0;
  if (cond && !fromReplan) { $('days').value = cond.days; $('battery').value = cond.batteryHours; $('min-earth').value = cond.minEarthPct; $('max-earth-gap').value = cond.maxEarthGapHours; $('transit').value = cond.transitDays ?? ''; $('panel-height').value = cond.panelHeightM; $('antenna-height').value = cond.antennaHeightM; const p = profileById(profileFor(cond.profile, cond)); $('profile').value = p.id; $('profile-source').textContent = profileSource(p); }
  state.selected = selected || [option.site.id, ...state.selected.filter(x => x !== option.site.id)].slice(0, 3);
  actions.onAdopt(option, { fromReplan });
  if (navigate && location.hash !== '#plan') location.hash = '#plan'; else actions.render();
}
