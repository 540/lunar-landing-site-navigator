// Where and when the Earth will be in sight (#382): how many cells see it now, when it starts to show and when it
// is seen from many places, which cells will see it in the next hours, and the next hour a given cell sees it.
// Pure: it only reads seesEarth from the tables (earth.bin, whole hours); no DOM here. The cabin (J12) reuses it.

// Below this many cells the blue layer is easy to miss on the map: each one gets a ring. On small grids (tests),
// 1 % of the map, so «few» never means every cell.
export const FEW_EARTH_CELLS = 20;
export const fewThreshold = (tables) => Math.min(FEW_EARTH_CELLS, Math.max(1, Math.ceil(tables.n * tables.n * 0.01)));
// From this share of the map on, the Earth «is seen from many places».
export const MANY_EARTH_SHARE = 0.05;
// Hours ahead of the forecast layer.
export const FORECAST_HOURS = 24;

const counts = new WeakMap();

// Cells that see the Earth at each whole hour of the scenario (computed once per tables).
export function earthCounts(tables) {
  let out = counts.get(tables);
  if (out) return out;
  out = new Int32Array(tables.hours);
  const cells = tables.n * tables.n;
  for (let h = 0; h < tables.hours; h++) {
    let k = 0;
    for (let i = 0; i < cells; i++) if (tables.seesEarth(i, h)) k++;
    out[h] = k;
  }
  counts.set(tables, out);
  return out;
}

const firstHour = (list, from, ok) => {
  for (let h = from; h < list.length; h++) if (ok(list[h])) return h;
  return null;
};

// What the player needs to know at `hour`: { now, few, riseHour, manyHour, many }.
// - now: cells that see the Earth at this whole hour.
// - few: true when they are fewer than fewThreshold (FEW_EARTH_CELLS on the game grid; 0 included).
// - riseHour: first hour from now with at least that many cells (when it «starts to show»), or null.
// - manyHour: first hour from now with at least MANY_EARTH_SHARE of the map, or null.
export function earthOutlook(tables, hour) {
  const list = earthCounts(tables);
  const h = Math.min(Math.max(Math.floor(hour), 0), tables.hours - 1);
  const many = Math.ceil(tables.n * tables.n * MANY_EARTH_SHARE);
  const few = fewThreshold(tables);
  const now = list[h];
  return {
    now,
    few: now < few,
    riseHour: firstHour(list, h, (k) => k >= few),
    manyHour: firstHour(list, h, (k) => k >= many),
    many,
  };
}

// Cells that do not see the Earth at `hour` but will at some whole hour of the next `ahead` hours.
export function earthForecastCells(tables, hour, ahead = FORECAST_HOURS) {
  const h0 = Math.floor(hour);
  const last = Math.min(tables.hours - 1, h0 + ahead);
  const out = [];
  for (let i = 0; i < tables.n * tables.n; i++) {
    if (tables.seesEarth(i, h0)) continue;
    for (let h = h0 + 1; h <= last; h++) if (tables.seesEarth(i, h)) { out.push(i); break; }
  }
  return out;
}

// First whole hour from `hour` on (this one included) at which `cell` sees the Earth, or null.
export function nextEarthHour(tables, cell, hour, limit = tables.hours) {
  const end = Math.min(tables.hours, limit);
  for (let h = Math.max(0, Math.floor(hour)); h < end; h++) if (tables.seesEarth(cell, h)) return h;
  return null;
}

// Mission day (from 1) of a game hour, as the clock says it.
export const outlookDay = (hour) => Math.floor(hour / 24) + 1;
