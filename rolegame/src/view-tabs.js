// Map / 3D Moon tabs on phones (J8.2, #235): the accessible tabs pattern (tablist, tab, tabpanel, aria-selected).
// nextTab is pure; wireTabs only touches the DOM it is given.

export const TABS = ['map', 'moon'];
// Below this width the map and the Moon share one square and the tabs show (the cut of game.css).
export const NARROW_QUERY = '(max-width: 899.98px)';

/** Tab chosen after a key on the tab list: arrows go round, Home and End to the ends; other keys change nothing. */
export function nextTab(current, key, tabs = TABS) {
  const i = tabs.indexOf(current);
  if (key === 'ArrowRight') return tabs[(i + 1) % tabs.length];
  if (key === 'ArrowLeft') return tabs[(i - 1 + tabs.length) % tabs.length];
  if (key === 'Home') return tabs[0];
  if (key === 'End') return tabs[tabs.length - 1];
  return current;
}

/**
 * Wires the tab buttons (data-tab="map" | "moon") of `tablist`. `onChange(tab)` runs when the choice changes;
 * returns { current(), select(tab) }. The stage gets data-view, which game.css uses to show one panel on phones.
 */
export function wireTabs(tablist, stage, { onChange } = {}) {
  const buttons = [...tablist.querySelectorAll('[role="tab"]')];
  let tab = 'map';
  function select(next, focus = false) {
    tab = next;
    stage.dataset.view = next;
    for (const b of buttons) {
      const on = b.dataset.tab === next;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    onChange?.(next);
  }
  for (const b of buttons) b.addEventListener('click', () => { if (b.dataset.tab !== tab) select(b.dataset.tab); });
  tablist.addEventListener('keydown', (e) => {
    const next = nextTab(tab, e.key);
    if (next === tab && !['Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    if (next !== tab) select(next, true); else buttons.find((b) => b.dataset.tab === next)?.focus();
  });
  select('map');
  return { current: () => tab, select };
}
