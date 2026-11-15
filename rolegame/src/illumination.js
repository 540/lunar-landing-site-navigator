// Illumination map of the end (J7.2): how much of the mission each cell had Sun. Pure: a sum over sun.bin,
// already loaded in the tables (no pipeline step). No DOM here.

// The prototype never shows less than a day: a very short game would only show one instant.
export const MIN_HOURS = 24;

// Mean sunFrac of every cell over the whole hours 0 … H − 1, H = min(hours, max(MIN_HOURS, ceil(tEnd))).
// Hour by hour (the prototype sampled every 4 h). Float32Array of n × n.
export function illumination(tables, tEnd) {
  const cells = tables.n * tables.n;
  const hours = Math.min(tables.hours, Math.max(MIN_HOURS, Math.ceil(tEnd)));
  const out = new Float32Array(cells);
  for (let h = 0; h < hours; h++) for (let i = 0; i < cells; i++) out[i] += tables.sunFrac(i, h);
  for (let i = 0; i < cells; i++) out[i] /= hours;
  return out;
}

// Best cell of the map and the cell where the rover ended, as whole percentages.
export function illuminationSummary(illum, state) {
  let best = 0;
  for (const v of illum) if (v > best) best = v;
  const here = illum[state.y * state.scenario.n + state.x];
  return { bestPct: Math.round(best * 100), herePct: Math.round(here * 100) };
}

// RGBA pixels of the amber layer (prototype illumLayer): --sun with opacity round(150 × f), composited in
// 'screen' mode over map.png by the caller.
export function illuminationPixels(illum) {
  const px = new Uint8ClampedArray(illum.length * 4);
  for (let i = 0; i < illum.length; i++) {
    px[i * 4] = 242; px[i * 4 + 1] = 163; px[i * 4 + 2] = 58;
    px[i * 4 + 3] = Math.round(150 * illum[i]);
  }
  return px;
}
