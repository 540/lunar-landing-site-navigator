// Keys of the view on foot, pure so they can be tested without three.js.

/** Keys the window listens to on foot: never in a text field or a list, and Space or Enter still press a focused button. */
export function ignoresKey(ev) {
  const t = ev.target, tag = String(t?.tagName ?? '').toLowerCase();
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return true;
  if (['input', 'select', 'textarea'].includes(tag) || t?.isContentEditable) return true;
  return tag === 'button' && (ev.key === ' ' || ev.key === 'Enter');
}

/** What a key does on foot: the watch (R), the flag (F), the view (V) or nothing (held keys repeat, and a modal or a field takes them). */
export function footCommand(ev, { modal = false } = {}) {
  if (ignoresKey(ev) || modal || ev.repeat) return null;
  return { r: 'watch', f: 'flag', v: 'view' }[String(ev.key).toLowerCase()] ?? null;
}
