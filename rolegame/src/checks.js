// Mission checks in the HUD (J6.3): what is still missing before lifting off. Pure: it reads the state.

// packets: sent of need; ready: every package sent and the battery at the lift-off minimum or above,
// so only reaching the pad is missing.
export function missionChecks(state) {
  const { level } = state;
  const done = state.sent >= level.need;
  return { packets: { sent: state.sent, need: level.need, done }, ready: done && state.battery >= level.minBat };
}

// Checks that go from not done to done between two states, in panel order: they pop and are announced once.
export function newlyDone(before, after) {
  const a = missionChecks(before);
  const b = missionChecks(after);
  const out = [];
  if (!a.packets.done && b.packets.done) out.push('packets');
  if (!a.ready && b.ready) out.push('ready');
  return out;
}
