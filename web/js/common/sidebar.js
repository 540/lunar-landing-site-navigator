// Hidden sidebar: the mission settings that config() and adopt.js read. No view shows it.
import { PROFILES, CUSTOM_PROFILE, INITIAL_DATE, profileById, profileSource } from '../engine/catalog.js';
import { $, esc } from './util.js';
import { actions } from './state.js';

// ---------------- Mission settings ----------------
export function initMissionForm() {
  $('profile').innerHTML = [...PROFILES, CUSTOM_PROFILE].map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('date').value = INITIAL_DATE;
  applyProfile(PROFILES[0]);
}
function applyProfile(p) {
  // The user's own spacecraft keeps the requirements on screen: they are already the user's.
  if (p.custom) { $('profile-source').textContent = profileSource(p); return; }
  $('days').value = p.days; $('battery').value = p.batteryHours; $('min-earth').value = p.minEarthPct; $('max-earth-gap').value = p.maxEarthGapHours;
  $('transit').value = p.transitDays;
  $('profile-source').textContent = profileSource(p);
}
$('profile').addEventListener('change', () => { applyProfile(profileById($('profile').value)); actions.render(); });
['date', 'delay', 'days', 'battery', 'min-earth', 'max-earth-gap', 'transit', 'panel-height', 'antenna-height'].forEach(id => $(id).addEventListener('input', () => actions.render()));
