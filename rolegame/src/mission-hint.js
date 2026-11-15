// Mission hint (J3.5): extends the energy hint of J2.4 with the Earth and the packages. Pure: no DOM here.
import { energyHint } from './energy-hint.js';
import { seesEarthNow, transmitBlock } from './transmit.js';
import { earthOutlook, outlookDay } from './earth-outlook.js';

// Prototype priority (hint()): everything sent, then shadow with a low battery, then the Earth here or elsewhere.
// At 0 h (nothing done yet) only the energy hint can show; otherwise the general help stays.
export function missionHint(state) {
  if (state.over) return null;
  const energy = energyHint(state);
  if (state.t === 0) return energy;
  if (state.sent >= state.level.need) return 'all-sent';
  if (energy) return energy;
  // #382: when almost no place sees the Earth (it is too low), say so and when it will rise.
  if (!seesEarthNow(state)) return earthOutlook(state.tables, state.t).few ? 'earth-few' : 'earth-elsewhere';
  return transmitBlock(state) === 'near-sent' ? 'earth-near-sent' : 'earth-here';
}

// Spanish wind of an azimuth, from the compass of the sky (bearing(az).wind: N, NE, E, SE, S, SO, O, NO).
const WIND_WORDS = { N: 'norte', NE: 'noreste', E: 'este', SE: 'sureste', S: 'sur', SO: 'suroeste', O: 'oeste', NO: 'noroeste' };
export const windWord = (wind) => WIND_WORDS[wind];

// Text of a hint key. Without the Earth layer on screen, 'earth-elsewhere' points at the ring with the
// bearing of the Earth from the series (`wind`, e.g. 'SE'): never written by hand.
// `outlook` (#382) is earthOutlook at the current hour, for 'earth-few'.
export function missionHintText(key, { earthLayer, wind, minKm = 1, outlook = null }, texts) {
  switch (key) {
    case 'all-sent': return texts.hintAllSent;
    case 'shadow-low': return texts.energyShadowLow;
    case 'earth-here': return texts.hintEarthHere;
    case 'earth-near-sent': return texts.hintEarthNearSent(minKm);
    case 'earth-elsewhere': return earthLayer ? texts.hintEarthLayer : texts.hintEarthRing(texts.winds?.[wind] ?? windWord(wind));
    case 'earth-few': return outlookText(outlook, { earthLayer }, texts);
    default: return null;
  }
}

// Words for a few Earth cells (#382): how many see it now and the days it rises and is seen from many places.
// The days come from earth.bin through earthOutlook, never written by hand.
export function outlookText(outlook, { earthLayer = true } = {}, texts) {
  if (!outlook) return texts.hintEarthLayer;
  const day = (h) => (h === null ? null : outlookDay(h));
  return texts.hintEarthFew({
    now: outlook.now,
    marked: earthLayer && outlook.now > 0,
    // With few cells now, riseHour is always later than now (or null when it never rises again).
    riseDay: day(outlook.riseHour),
    manyDay: day(outlook.manyHour),
  });
}
