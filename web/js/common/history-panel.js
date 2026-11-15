// «Historial» in the top bar (#246): the list of the missions planned in this browser, in a modal <dialog>.
// It only paints the history (common/mission-history.js) and says which mission to open; Plan opens it.
import { $, esc } from './util.js';
import { VERDICT_TONE } from './theme.js';
import { missionKey, missionProfileName } from './mission-history.js';
import { t, fmtNum, fmtDate, fmtDateTime } from './i18n.js';

const VERDICT_LABEL = { viable: t('tour.history.viable'), marginal: t('tour.history.marginal'), not_viable: t('tour.history.notViable') };
// Saved at: in UTC, like every other date of the planner, and saying so (#343).
const num = n => fmtNum(n, 3);

/**
 * @param {object} o
 * @param {object} o.history the mission history (createMissionHistory)
 * @param {Array} o.sites catalogue sites: a mission whose site is not there cannot be opened
 * @param {Function} o.onOpen called with the mission to open
 */
export function initHistoryPanel({ history, sites, onOpen }) {
  const dialog = $('history-dialog'), list = $('history-list');
  let shown = [];

  function item(m, i) {
    const site = sites.find(s => s.id === m.siteId), name = site?.name ?? m.siteId;
    const where = m.searchSiteId ? t('tour.history.fixedSite') : t('tour.history.bestOfZone');
    const requirements = [missionProfileName(m), t('tour.history.days', { n: num(m.days) }),
      t('tour.history.battery', { n: num(m.batteryHours) }), t('tour.history.earth', { n: num(m.minEarthPct) }),
      m.maxEarthGapHours != null ? t('tour.history.gaps', { n: num(m.maxEarthGapHours) }) : null].filter(Boolean).join(' · ');
    const search = [where, m.from ? `${fmtDate(m.from)} → ${fmtDate(m.to)}` : null,
      m.panelHeightM != null ? t('tour.history.heights', { panel: num(m.panelHeightM), antenna: num(m.antennaHeightM ?? m.panelHeightM) }) : null].filter(Boolean).join(' · ');
    const verdict = m.verdict ? `<span class="badge badge--pill" data-tone="${VERDICT_TONE[m.verdict]}" title="${esc(t('tour.history.verdictTitle'))}">${VERDICT_LABEL[m.verdict]}</span>` : '';
    return `<li class="history-item">
      <button type="button" class="history-item__open" data-open="${i}"${site ? '' : ' disabled'}>
        <span class="history-item__title"><b>${esc(name)}</b>${verdict}</span>
        <span>${esc(t('tour.history.lands', { date: fmtDateTime(m.t0) }))}</span>
        <small>${esc(requirements)}</small>
        <small>${esc(search)}</small>
        <small>${esc(site ? t('tour.history.saved', { date: fmtDateTime(m.savedAt) }) : t('tour.history.gone'))}</small>
      </button>
      <button type="button" class="btn history-item__remove" data-remove="${i}" aria-label="${esc(t('tour.history.removeLabel', { name, date: fmtDateTime(m.t0) }))}">${esc(t('tour.history.remove'))}</button>
    </li>`;
  }

  function render() {
    shown = history.list();
    list.innerHTML = shown.map(item).join('');
    list.hidden = !shown.length;
    $('history-empty').hidden = !!shown.length;
    $('history-clear').hidden = !shown.length;
  }

  $('btn-history').addEventListener('click', () => { render(); dialog.showModal(); });
  $('history-close').addEventListener('click', () => dialog.close());
  // A click on the backdrop (the dialog itself, outside its content) closes it, like Esc.
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  $('history-clear').addEventListener('click', () => { history.clear(); $('history-close').focus(); });
  list.addEventListener('click', e => {
    const open = e.target.closest('[data-open]'), remove = e.target.closest('[data-remove]');
    if (open) { dialog.close(); onOpen(shown[+open.dataset.open]); }
    else if (remove) {
      const i = +remove.dataset.remove;
      history.remove(missionKey(shown[i]));
      // The focus stays in the list: on the mission that takes its place, or on «Cerrar» when it was the last one.
      (list.querySelectorAll('[data-remove]')[Math.min(i, shown.length - 1)] ?? $('history-close')).focus();
    }
  });
  // Any change repaints an open list (also the ones Plan records behind it).
  history.onChange = () => { if (dialog.open) render(); };
}
