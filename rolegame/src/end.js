// End of the game (J7): the figures of the finished game, what the screen reader hears and the link to the
// Mirador. Pure: no DOM here. It imports the Mirador's own region and date rules (pure, no DOM), so the game
// never offers a region or a start date that the Mirador would silently change.
import { REGION_IDS } from '../../viewpoint/src/core/regions.js';
import { isStartInRange } from '../../viewpoint/src/core/timeline.js';

// Figures of a finished game with the panel clock (day 1 at the start). Without packages in the state
// (before J3.1), sent and need are null and the texts do not mention them.
export function endSummary(state) {
  const { level } = state;
  const hours = Math.floor(state.t);
  const hasPackets = typeof state.sent === 'number';
  return {
    over: state.over,
    day: Math.floor(hours / 24) + 1,
    hour: hours % 24,
    battery: Math.floor(state.battery),
    sent: hasPackets ? state.sent : null,
    need: hasPackets ? level.need : null,
    packetsDone: hasPackets ? state.sent >= level.need : null,
    deadlineDay: level.deadline / 24,
    minBat: level.minBat,
  };
}

// Title and explanation of the end, for the aria-live region (once, when the game ends).
export function endAnnouncement(state, texts) {
  const end = texts.end[state.over];
  return `${end.title}. ${end.why(endSummary(state))}`;
}

// Relative address of the Mirador exploration at the scenario's region, start day and the instant the game
// ended (E2.4: ?region=…&start=…&day=…), or null when the Mirador could not open exactly that.
export function viewpointUrl(scenario, t) {
  const region = scenario.siteId;
  if (!REGION_IDS.includes(region)) return null;
  const startMs = Date.parse(scenario.startUtc);
  if (!Number.isFinite(startMs)) return null;
  const start = scenario.startUtc.slice(0, 10);
  if (!isStartInRange(start)) return null;
  const midnight = Date.parse(`${start}T00:00:00.000Z`);
  const day = Math.round((((startMs - midnight) / 3600e3 + t) / 24) * 1000) / 1000;
  return `../viewpoint/?region=${region}&start=${start}&day=${day}`;
}
