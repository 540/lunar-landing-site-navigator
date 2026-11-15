// The ascent vehicle at ASCENSO (#398): whether mission control clears the lift-off and, if not, why. Pure: no DOM.
// The win is still decided by the engine (check): this only explains it, so arriving at the vehicle never reads as
// «nothing happens».
import { compassPoint } from './map-legend.js';

// { atPad, near, ready, reason, missing, lowBattery } for a game state.
//   atPad       the rover is on the pad's cell
//   near        the rover is on the pad's cell or a neighbouring one (the vehicle reacts as it arrives)
//   ready       the engine has given the win: the lift-off can be seen
//   reason      null when ready; 'packets' (packages missing), 'battery' (below level.minBat) or 'over' (lost)
//   missing     packages still to send
//   lowBattery  the battery is below the lift-off minimum
//   minBat      that minimum, for the texts
export function liftoffStatus(state) {
  const minBat = state.level.minBat;
  const { level, scenario } = state;
  const dx = Math.abs(state.x - scenario.pad.x), dy = Math.abs(state.y - scenario.pad.y);
  const atPad = dx === 0 && dy === 0;
  const near = Math.max(dx, dy) <= 1;
  const missing = Math.max(0, level.need - state.sent);
  const lowBattery = state.battery < level.minBat;
  if (state.over === 'win') return { atPad, near, ready: true, reason: null, missing: 0, lowBattery: false, minBat };
  const reason = state.over ? 'over' : missing > 0 ? 'packets' : lowBattery ? 'battery' : null;
  return { atPad, near, ready: false, reason, missing, lowBattery, minBat };
}

// The vehicle's beacon: red while it waits for the crew, amber when the crew is there but the lift-off is not
// cleared, green once it is cleared.
export function beaconMode(status) {
  if (status.ready) return 'ready';
  if (status.near && (status.reason === 'packets' || status.reason === 'battery')) return 'waiting';
  return 'idle';
}

// The message at the vehicle when the lift-off is not cleared (null otherwise): what is missing and what to do.
// `zone` is the nearest blue zone ({ km, wind, now } or null), already put in words by the caller.
export function liftoffMessage(status, texts, zone = null) {
  if (!status.atPad || status.ready) return null;
  if (status.reason === 'packets') {
    const todo = zone ? texts.liftoffDoPacketsZone(zone.km, zone.wind, zone.now) : texts.liftoffDoPackets;
    const battery = status.lowBattery ? ` ${texts.liftoffAlsoBattery(status.minBat)}` : '';
    return { title: texts.liftoffBlockedPackets(status.missing), todo: `${todo}${battery}` };
  }
  if (status.reason === 'battery') return { title: texts.liftoffBlockedBattery(status.minBat), todo: texts.liftoffDoBattery };
  return null;
}

// The nearest blue zone in words for liftoffMessage: { km, wind, now } from the rover's cell, or null.
// `zone` is { x, y, km, now } (game.nearestEarth); `winds` maps 'N'…'NO' to words (TEXTS.winds).
export function zoneWords(from, zone, winds) {
  if (!zone) return null;
  const az = (Math.atan2(zone.x - from.x, -(zone.y - from.y)) * 180) / Math.PI;
  return { km: zone.km, wind: winds[compassPoint(az).toUpperCase()], now: zone.now };
}
