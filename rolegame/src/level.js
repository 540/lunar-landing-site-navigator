// Level choice (J6.1): which level the address asks for, the address for another level, the seed of the
// event (J6.4) and what the solar panels do now in the rover's cell (J2.3, now here). Pure: no DOM here.

export const LEVEL_IDS = ['beg', 'mid', 'exp'];

// Level of `?level=`; without it or with an unknown one, 'beg'.
export function levelFromSearch(search) {
  const id = new URLSearchParams(search).get('level');
  return LEVEL_IDS.includes(id) ? id : 'beg';
}

// The same search with `level=id`, keeping every other parameter (like regionSearch of the viewpoint).
export function levelSearch(search, id) {
  const params = new URLSearchParams(search);
  params.set('level', id);
  return `?${params}`;
}

// Seed fixed by `?seed=<whole number>` (the demo game), or null to draw one for each new game.
export function seedFromSearch(search) {
  const raw = new URLSearchParams(search).get('seed');
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
}

// What the panels do in the rover's cell, with the engine's thresholds (passInPlace):
// 'sun' over half the disc (loadSun), 'below' when the Sun is under panelMin (no charge, expert),
// 'partial' with part of the disc that charges, 'dark' without Sun.
export function panelStatus({ tables, level, x, y, t }) {
  const f = tables.sunFrac(y * tables.n + x, t);
  if (f > 0.5) return 'sun';
  if (f <= 0) return 'dark';
  return f < level.panelMin ? 'below' : 'partial';
}
