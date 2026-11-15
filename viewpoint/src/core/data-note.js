// Data note (E9.4, #47): which numbers the note of sources shows. Pure functions, no DOM.

/** The notice opens the note only over real LOLA relief; procedural and simulated relief keep it as plain text. */
export const opensDataNote = meta => meta?.source?.type === 'lola';

/**
 * Resolution levels of a region, straight from its meta.json: the base zone, each `detail` level in file order and,
 * if there is one, the far horizon. A region without `detail` or `far` (like mouton) gives a single line.
 * @returns {{kind: 'zone'|'detail'|'far', extentKm: number, stepKm: number}[]}
 */
export function resolutionLines(meta) {
  const lines = [{ kind: 'zone', extentKm: meta.extentKm, stepKm: meta.grid.stepKm }];
  for (const level of meta.detail ?? []) {
    const line = { kind: 'detail', extentKm: level.extentKm, stepKm: level.grid.stepKm };
    // A level that says how much of it is measured (the 5 m ground of pipeline/ground.mjs) shows it.
    if (Number.isFinite(level.measured) && Number.isFinite(level.rmsM)) Object.assign(line, { measured: level.measured, rmsM: level.rmsM });
    lines.push(line);
  }
  if (meta.far) lines.push({ kind: 'far', extentKm: meta.far.extentKm, stepKm: meta.far.grid.stepKm });
  return lines;
}

/** The citations of the detail levels that bring their own source (the 5 m ground), each once. */
export const levelCitations = meta => [...new Set((meta.detail ?? []).map(l => l.citation).filter(Boolean))];

/** Whether the line about where the verdict comes from is shown: only in the mission viewer (`verdictSource` is 'api' or 'fake'). */
export const showsVerdictSource = verdictSource => verdictSource === 'api' || verdictSource === 'fake';
