// Night criteria, the whole ("full") night around a period and battery sizing.
//
// All of it is optional: with the defaults (nightMinSunFraction 0, no fullNight, no battery) nothing changes.
//  - Night sample: by default, the Sun is not visible according to `mode` (margin <= 0; with 'limb' one sliver of the
//    disc is enough to end the night). With nightMinSunFraction > 0, a sample is night when the visible fraction of the
//    solar disc is below that value.
//  - Full night: the longest night that touches the period is measured whole. If the period starts (ends) in the dark,
//    the search goes backwards (forwards) from the first (last) sample, with the same step, until the first lit sample
//    or NIGHT_EXTENSION_LIMIT_DAYS.
//  - Battery: energy and PACK mass to get through that night at a constant survival load. Pack only: no electronics,
//    no extra solar array to recharge it and no margins (at system level it comes out ~2–3 times heavier).
import { moonFixedVectors, topocentric } from './ephemeris.ts';
import { fractionEdgeY, margin, visibleFraction } from './visibility.ts';
import type { BatteryInput, BatteryOptions, BatteryResult, HorizonMask, Mode, PerBody, SampledVectors, SiteFrame, Topocentric, Vec3 } from './types.ts';

const DAY_MS = 86400e3;
const HOUR_MS = 3600e3;

/** How far the full night is searched past each end of the period. A lunar night lasts ≤ ~15 days except in permanent shadow. */
export const NIGHT_EXTENSION_LIMIT_DAYS = 30;

/**
 * Battery defaults, each with its source and passage (checked on 2026-11-14):
 *  - survivalLoadW 100 W: Cataldo, Zacny and Schmitz, "Radioisotope Power Systems to Enable Extended Lunar Science and
 *    In-Situ Resource Utilization Missions", NETS 2018 (NASA GRC, https://ntrs.nasa.gov/citations/20180004489),
 *    section IV: "A lunar equatorial mission requiring 100 We throughout the lunar day and night was used for the
 *    comparison". In the source it is the continuous day-and-night load of an equatorial mission; here it is used as a
 *    proxy for the night survival load. For reference, VIPER: Bluethmann, "VIPER Rover Overview and Mobility and
 *    Hardware" (NASA JSC, LSIC 2024, https://ntrs.nasa.gov/citations/20240013903), slide 2 "VIPER Rover Overview":
 *    "Battery capacity (start of life @ 0C): 5,420 W-hr" and "50 hours survival in low power mode". Not from COMPASS,
 *    which works with ~40 W of night operations plus ~6 W of losses: kept at 100 W so that batteryKg of /v1 with
 *    battery=1 does not change.
 *  - whPerKg 200 (pack level) and depthOfDischarge 0.9: NASA GRC COMPASS team (Oleson, Colozza, Uguccini), "Overnight
 *    Power & Thermal Solutions for Lunar Landers", CLPS Survive the Night Technology Workshop, 2022
 *    (https://ntrs.nasa.gov/citations/20220018215), slide 15 "Battery Design": "Specific energy of ~200 Whr/kg"
 *    (~20 kWh pack of commercial LG 18650 MJ1 cells) and "Use 90% DoD to reduce battery mass (only expect 125
 *    charge/discharge cycles, so this is acceptable)". 200 Wh/kg is the optimistic end: the flight-proven Li-ion
 *    battery of Cataldo 2018 (46.8 kWh, ~432 kg) is ~108 Wh/kg.
 */
export const BATTERY_DEFAULTS: Readonly<BatteryOptions> = { survivalLoadW: 100, whPerKg: 200, depthOfDischarge: 0.9 };

/** Accepted ranges of the battery inputs (also used by the HTTP parameters). */
export const BATTERY_LIMITS: Readonly<Record<keyof BatteryOptions, [number, number]>> = {
  survivalLoadW: [0, 10000],
  whPerKg: [10, 1000],
  depthOfDischarge: [0.05, 1],
};

const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;

/** Is this Sun position night? (see the header). */
export function isNight(sun: Topocentric, mask: HorizonMask | null, mode: Mode, nightMinSunFraction: number = 0): boolean {
  return nightMinSunFraction > 0 ? visibleFraction(sun, mask, fractionEdgeY(nightMinSunFraction)) < nightMinSunFraction : !(margin(sun, mask, mode) > 0);
}

/** Validates nightMinSunFraction (0..1). */
export function checkNightMinSunFraction(x: unknown): number {
  if (x === undefined || x === null) return 0;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) throw new Error('nightMinSunFraction debe ser un número entre 0 y 1');
  return x;
}

/** Resolves the battery option: true = defaults; an object overrides some fields; false/null/undefined = off. Validates ranges. */
export function resolveBattery(input: BatteryInput | undefined): BatteryOptions | null {
  if (input === undefined || input === null || input === false) return null;
  if (input !== true && (typeof input !== 'object' || Array.isArray(input))) throw new Error('battery debe ser true o un objeto { survivalLoadW, whPerKg, depthOfDischarge }');
  const given = input === true ? {} : input;
  for (const k of Object.keys(given)) if (!(k in BATTERY_DEFAULTS)) throw new Error(`battery: campo desconocido ${k}. Válidos: ${Object.keys(BATTERY_DEFAULTS).join(', ')}`);
  const out = { ...BATTERY_DEFAULTS, ...Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)) } as BatteryOptions;
  for (const [k, [min, max]] of Object.entries(BATTERY_LIMITS) as [keyof BatteryOptions, [number, number]][]) {
    const v = out[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`battery.${k} debe ser un número entre ${min} y ${max}`);
  }
  return out;
}

/**
 * Battery for a night of `nightH` hours: kWh = load × hours / 1000; kg = kWh × 1000 / (DoD × Wh/kg).
 * Pack mass only (no electronics, no extra array to recharge, no margins).
 */
export function batteryFor(nightH: number, b: BatteryOptions): BatteryResult {
  const kWh = (b.survivalLoadW * nightH) / 1000;
  return { kWh: round(kWh, 3), kg: round((kWh * 1000) / (b.depthOfDischarge * b.whPerKg), 2) };
}

// Sun vectors outside a sample, cached per sample and step (every point of a search shares them).
const outside: WeakMap<SampledVectors, Map<string, Vec3[]>> = new WeakMap();

/** Moon→Sun vector `k` steps (k ≥ 1) before (dir −1) or after (dir +1) the sampled period. */
function sunBeyond(sampled: SampledVectors, stepMs: number, dir: 1 | -1, k: number): Vec3 {
  let byKey = outside.get(sampled);
  if (!byKey) { byKey = new Map(); outside.set(sampled, byKey); }
  const key = `${dir}:${stepMs}`;
  let list = byKey.get(key);
  if (!list) { list = []; byKey.set(key, list); }
  const edge = dir > 0 ? sampled.t[sampled.t.length - 1] : sampled.t[0];
  while (list.length < k) list.push(moonFixedVectors(new Date(edge + dir * (list.length + 1) * stepMs)).sun);
  return list[k - 1];
}

/** Most samples the whole night is searched past one end of the period (nightBeyond stops there). */
export const extensionLimitSamples = (stepMs: number): number => Math.floor((NIGHT_EXTENSION_LIMIT_DAYS * DAY_MS) / stepMs);

/**
 * Wraps an `extend(dir)` of fullNightSamples to remember whether any side reached the limit: the night may go on past
 * it (near permanent shadow) and the whole night is then a lower bound.
 */
export function watchTruncation(extend: (dir: 1 | -1) => number, limit: number): { extend: (dir: 1 | -1) => number; truncated: () => boolean } {
  let hit = false;
  return {
    extend: (dir) => { const k = extend(dir); if (k >= limit) hit = true; return k; },
    truncated: () => hit,
  };
}

/** Night samples counted outwards from one end of the period (dir −1 = before, +1 = after), up to the first lit one or the limit. */
export function nightBeyond(
  frame: SiteFrame, mask: HorizonMask | null, sampled: SampledVectors, stepMs: number, dir: 1 | -1, mode: Mode, nightMinSunFraction: number = 0,
): number {
  const max = extensionLimitSamples(stepMs);
  let k = 0;
  while (k < max && isNight(topocentric(frame, sunBeyond(sampled, stepMs, dir, k + 1), 'sun'), mask, mode, nightMinSunFraction)) k++;
  return k;
}

/**
 * Longest full night (in samples) from the night runs of the period: `longest` (longest run inside), `leading` (run that
 * starts at the first sample) and `trailing` (run that ends at the last one). Only the edge runs are extended.
 */
export function fullNightSamples(
  n: number, longest: number, leading: number, trailing: number, extend: (dir: 1 | -1) => number,
): number {
  const before = leading > 0 ? extend(-1) : 0;
  const after = trailing > 0 ? extend(1) : 0;
  if (leading === n) return before + n + after; // dark all the period: one single night
  return Math.max(longest, before + leading, trailing + after);
}

/** Night of a site over a sample (/v1/windows): longest night inside and, optionally, the full one. */
export function nightOfSample(
  frame: SiteFrame, mask: HorizonMask | null, sampled: SampledVectors, stepMs: number,
  { mode, nightMinSunFraction = 0, fullNight = false, battery = null }: { mode: Mode; nightMinSunFraction?: number; fullNight?: boolean; battery?: BatteryOptions | null },
): { longestNightH: number; longestNightFullH?: number; fullNightTruncated?: true; battery?: BatteryResult & { nightH: number } } {
  const n = sampled.vecs.length;
  let run = 0, longest = 0, leading = 0, leadingOpen = true;
  for (const v of sampled.vecs as PerBody<Vec3>[]) {
    if (isNight(topocentric(frame, v.sun, 'sun'), mask, mode, nightMinSunFraction)) {
      run++;
      if (run > longest) longest = run;
      if (leadingOpen) leading++;
    } else { run = 0; leadingOpen = false; }
  }
  const h = stepMs / HOUR_MS;
  const longestNightH = round(longest * h, 3);
  const watch = watchTruncation((dir) => nightBeyond(frame, mask, sampled, stepMs, dir, mode, nightMinSunFraction), extensionLimitSamples(stepMs));
  const full = fullNight ? round(fullNightSamples(n, longest, leading, run, watch.extend) * h, 3) : undefined;
  const nightH = full ?? longestNightH;
  return {
    longestNightH,
    ...(full !== undefined ? { longestNightFullH: full } : {}),
    ...(full !== undefined && watch.truncated() ? { fullNightTruncated: true as const } : {}),
    ...(battery ? { battery: { nightH, ...batteryFor(nightH, battery) } } : {}),
  };
}
