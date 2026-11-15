// Battery in the HUD (J2.2): pure helpers for the bar colour, the hours it lasts parked in shadow
// and what the screen reader hears. No DOM here.

// Below this percentage the bar turns yellow (prototype threshold, renderHud).
export const WARN_BATTERY = 40;

// 'bad' below the lift-off minimum, 'warn' below WARN_BATTERY, 'good' otherwise.
export function batteryLevel(battery, level) {
  if (battery < level.minBat) return 'bad';
  if (battery < WARN_BATTERY) return 'warn';
  return 'good';
}

// Whole hours the rover lasts parked in shadow: the planner's maxDarkHours for this game.
export const darkHours = (battery, level) => Math.max(0, Math.floor(battery / level.loadDark));

// aria-valuetext of the battery meter: percentage and whether it is below the lift-off minimum.
export function batteryValueText(battery, level, texts) {
  const pct = Math.floor(battery);
  return battery < level.minBat ? texts.batteryBelowMin(pct, level.minBat) : texts.batteryAboveMin(pct, level.minBat);
}
