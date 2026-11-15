// Regenerates fixtures/horizons-events.json: the rises and sets of the Sun and the Earth according to
// JPL Horizons, used by test/events.test.ts and by the accuracy report.
//
//   node test/fixtures/fetch-horizons-events.ts
//
// Horizons only tabulates rises and sets to the minute and only for the upper limb, so the events are derived
// here: the elevation and the angular diameter are downloaded every 2 h for each catalogue site (28 sequential
// queries, ~3 min), interpolated, and the instant where each visibility margin crosses zero is located.
// Near the horizon the interpolation adds less than 1e-7°, and the limb events agree with Horizons' own
// rise/set table to the minute.
//
// Mind this when regenerating: for future dates Horizons predicts the relation between UTC and dynamical time, and
// that prediction gets updated. Events can move by a few seconds between downloads.
import { writeFileSync } from 'node:fs';
import { SITES } from '../../../backend/src/sites.ts';
import { BODIES, fetchObserverTable } from './horizons-api.ts';
import type { Body, Mode } from '../../../backend/src/types.ts';
import type { BodyEvents, EventsReferenceSite } from '../accuracy.ts';

const START = '2026-01-01T00:00:00Z';
const STOP = '2031-01-01T00:00:00Z';
const STEP_MINUTES = 120;
const STEP_MS = STEP_MINUTES * 60_000;
// Same convention as backend/src/visibility.ts: margin = elevation + k · angular radius.
const MODES: Record<Mode, number> = { limb: 1, center: 0, full: -1 };
// Events are searched one day inside the downloaded span, where the 4-point interpolation has neighbours on both sides.
const EDGE_MS = 86_400_000;
const SCAN_MS = 60_000;

const t0 = Date.parse(START);

/** 4-point Lagrange interpolation of a series sampled every STEP_MS from t0. */
function interpolate(values: number[], ms: number): number {
  const x = (ms - t0) / STEP_MS;
  const i = Math.max(1, Math.min(values.length - 3, Math.floor(x)));
  const u = x - i;
  return (-u * (u - 1) * (u - 2) / 6) * values[i - 1] + ((u + 1) * (u - 1) * (u - 2) / 2) * values[i]
    - ((u + 1) * u * (u - 2) / 2) * values[i + 1] + ((u + 1) * u * (u - 1) / 6) * values[i + 2];
}

/**
 * Zero crossings of the visibility margin as [time in ms, elevation rate in °/h]; rate > 0 is a rise.
 * `visibleAtStart` says which side of the horizon the body is on when the search begins: without it, a body
 * that never crosses (the Earth, from most sites) could not be told always visible from never visible.
 */
function crossings(elevation: number[], radius: number[], k: number): BodyEvents {
  const margin = (ms: number): number => interpolate(elevation, ms) + k * interpolate(radius, ms);
  const events: [number, number][] = [];
  const end = Date.parse(STOP) - EDGE_MS;
  let before = margin(t0 + EDGE_MS);
  const visibleAtStart = before > 0;
  for (let ms = t0 + EDGE_MS + SCAN_MS; ms <= end; ms += SCAN_MS) {
    const after = margin(ms);
    if ((before > 0) !== (after > 0)) {
      let lo = ms - SCAN_MS, hi = ms;
      while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        if ((margin(mid) > 0) === (before > 0)) lo = mid; else hi = mid;
      }
      const time = Math.round((lo + hi) / 2);
      const ratePerHour = (margin(time + 30_000) - margin(time - 30_000)) * 60;
      events.push([time, Number(ratePerHour.toPrecision(5))]);
    }
    before = after;
  }
  return { visibleAtStart, crossings: events };
}

const sites: EventsReferenceSite[] = [];
for (const { id, lat, lon } of SITES) {
  const events = {} as EventsReferenceSite['events'];
  for (const body of Object.keys(BODIES) as Body[]) {
    // Quantities 4 and 13: azimuth, elevation, angular diameter in arcseconds.
    const rows = await fetchObserverTable({ site: { id, lat, lon }, body, start: START, stop: STOP, stepMinutes: STEP_MINUTES, quantities: '4,13' });
    const elevation = rows.map((r) => +r[4]), radius = rows.map((r) => +r[5] / 7200);
    events[body] = Object.fromEntries(Object.entries(MODES).map(([mode, k]) => [mode, crossings(elevation, radius, k)])) as Record<Mode, BodyEvents>;
    console.log(`${id}/${body}: ${Object.values(events[body]).map((e) => e.crossings.length).join(' + ')} events`);
  }
  // The coordinates travel with the events: the reference stays valid if the catalogue is corrected later.
  sites.push({ id, lat, lon, events });
}

const fixture = {
  source: 'JPL Horizons, DE441, center coord@301 (MEAN_ME, 1737.4 km sphere), zero crossings of elevation + k·radius',
  fetchedAt: new Date().toISOString().slice(0, 10),
  start: new Date(t0 + EDGE_MS).toISOString(),
  end: new Date(Date.parse(STOP) - EDGE_MS).toISOString(),
  crossingFormat: '[time in ms since the Unix epoch, elevation rate in degrees per hour (> 0 rise, < 0 set)]',
};
// One site per line: a regeneration diff stays bounded.
const json = `${JSON.stringify(fixture).slice(0, -1)},"sites":[\n${sites.map((s) => JSON.stringify(s)).join(',\n')}\n]}`;
writeFileSync(new URL('./horizons-events.json', import.meta.url), json + '\n');
console.log(`horizons-events.json: ${(json.length / 1e6).toFixed(2)} MB`);
