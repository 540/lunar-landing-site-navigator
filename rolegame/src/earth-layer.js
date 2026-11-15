// «Tierra visible» layer (J3.2): whether the level shows it and which cells see the Earth at an hour.
// Pure: it only reads seesEarth from the tables (earth.bin); no DOM here.

// 'on' always, 'toggle' when the player turned it on (button in J6.5), 'none' never (prototype showEarth).
export function earthLayerOn(level, toggled) {
  if (level.earth === 'on') return true;
  if (level.earth === 'toggle') return Boolean(toggled);
  return false;
}

// Indices of the cells that see the Earth at `hour` (the whole hour: earth.bin is not interpolated).
export function earthCells(tables, hour) {
  const out = [];
  for (let i = 0; i < tables.n * tables.n; i++) if (tables.seesEarth(i, hour)) out.push(i);
  return out;
}
