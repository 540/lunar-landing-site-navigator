// Log of the game (J6.4): what happened and when, newest first. Pure: it reads state.log.

// The `max` latest entries, newest first, each one with its day, hour, text and whether it is an event.
export function logLines(state, texts, max = 4) {
  return state.log.slice(-max).reverse().map((e) => {
    const h = Math.floor(e.t);
    return { event: e.kind !== 'sent', text: `${texts.clock(Math.floor(h / 24) + 1, h % 24)} · ${logText(e, state.level, texts)}` };
  });
}

// Text of one entry. The −12 % and the 24 h come from the level, not from the dictionary.
export function logText(entry, level, texts) {
  if (entry.kind === 'spike') return texts.logSpike(level.spikeE);
  if (entry.kind === 'antenna') return texts.logAntenna(level.antennaH);
  return texts.logSent(entry.n, level.need);
}

// Events (not packages) added between two states: what the screen reader hears after an action.
export const newEvents = (before, after) => after.log.slice(before.log.length).filter((e) => e.kind !== 'sent');
