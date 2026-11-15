// The battery of the user's own spacecraft (#253): the hours without the Sun come out of it instead of being typed.
// Pure: no DOM. It is the inverse of batteryFor in backend/src/night.ts (the battery a night of N hours asks for):
//
//   hours = Wh × DoD / W            (autonomyHours)
//   kg    = Wh / (Wh/kg)            (batteryMass: with two of Wh, kg and Wh/kg, the third one)
//
// so batteryFor(autonomyHours(b), b) gives back kWh = Wh × DoD / 1000 and kg = Wh / (Wh/kg) (test/battery.test.js
// checks it against the engine). The mass is the pack's only: no electronics, no extra array to recharge it, no margins.
// The battery never travels to the API: only the hours do, inside its range (/v1/best-landings, 0–720 h).

/** The defaults of the engine (BATTERY_DEFAULTS of backend/src/night.ts, with their sources there). */
export const BATTERY_DEFAULTS = Object.freeze({ survivalLoadW: 100, whPerKg: 200, depthOfDischarge: 0.9 });

const given = v => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Hours the battery holds the survival load in the dark. null when the formula gives nothing: a capacity, a load or a
 * depth of discharge missing, a load ≤ 0, or a depth of discharge outside (0, 1]. Never Infinity nor NaN.
 */
export function autonomyHours({ capacityWh, depthOfDischarge, survivalLoadW }) {
  if (!given(capacityWh) || !given(survivalLoadW) || !given(depthOfDischarge) || depthOfDischarge > 1) return null;
  return (capacityWh * depthOfDischarge) / survivalLoadW;
}

/** The hours as they are shown and sent to the API: one decimal. */
export const roundHours = h => Math.round(h * 10) / 10;

/**
 * Capacity, mass and specific energy of the pack. With two of the three, the third one is deduced (`deduced` names it);
 * with the capacity alone, the mass comes from the default specific energy (`deduced: 'batteryKg'`, `defaulted: true`).
 * With the three given, nothing is deduced: whether they agree is rule B5 of the coherence. Values ≤ 0 count as not given.
 */
export function batteryMass({ capacityWh, whPerKg, batteryKg }) {
  const wh = given(capacityWh) ? capacityWh : null, spec = given(whPerKg) ? whPerKg : null, kg = given(batteryKg) ? batteryKg : null;
  if (wh != null && spec != null && kg != null) return { capacityWh: wh, whPerKg: spec, batteryKg: kg, deduced: null, defaulted: false };
  if (wh != null && kg != null) return { capacityWh: wh, whPerKg: wh / kg, batteryKg: kg, deduced: 'whPerKg', defaulted: false };
  if (wh != null) {
    const s = spec ?? BATTERY_DEFAULTS.whPerKg;
    return { capacityWh: wh, whPerKg: s, batteryKg: wh / s, deduced: 'batteryKg', defaulted: spec == null };
  }
  if (kg != null && spec != null) return { capacityWh: kg * spec, whPerKg: spec, batteryKg: kg, deduced: 'capacityWh', defaulted: false };
  return { capacityWh: null, whPerKg: spec, batteryKg: kg, deduced: null, defaulted: false };
}

/**
 * The battery as the user describes it → what the plan uses: the capacity (typed or deduced from kg and Wh/kg), the
 * hours (null if the formula gives nothing) and the mass of the pack.
 *   battery: { capacityWh, depthOfDischarge, survivalLoadW, whPerKg?, batteryKg?, dryMassKg? }
 */
export function describeBattery(battery) {
  const mass = batteryMass(battery);
  const hours = autonomyHours({ ...battery, capacityWh: mass.capacityWh });
  return { ...mass, hours: hours == null ? null : roundHours(hours), exactHours: hours };
}
