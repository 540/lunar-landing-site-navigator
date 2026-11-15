// Regenerates fixtures/horizons.json: the JPL Horizons reference used by test/precision.test.ts.
//
//   node test/fixtures/fetch-horizons.ts
//
// Asks the public Horizons API (see horizons-api.ts) for the apparent azimuth and elevation
// and the distance of the Sun and the Earth seen from several points on the Moon (DE441, MEAN_ME frame, 1737.4 km
// sphere, no refraction). 10 sequential queries, ~1 min.
//
// Mind this when regenerating: for future dates Horizons predicts the relation between UTC and dynamical time, and
// that prediction gets updated. Values can move by a few ten-thousandths of a degree between downloads.
import { writeFileSync } from 'node:fs';
import { BODIES, fetchObserverTable } from './horizons-api.ts';
import type { ObserverSite } from './horizons-api.ts';
import type { Body } from '../../../backend/src/types.ts';

const START = '2026-01-01T00:00:00Z';
const STOP = '2031-01-01T00:00:00Z';
// 1313 min is not a multiple of any period in the problem (day, synodic month, year): instants sweep every phase.
const STEP_MINUTES = 1313;

// Sites chosen for what they exercise, not for mission interest: the direction error does not depend on the site.
const SITES: ObserverSite[] = [
  { id: 'equator', lat: 0, lon: 0, heightKm: 0 }, // Earth near the zenith: azimuth degenerates
  { id: 'equator-12km', lat: 0, lon: 0, heightKm: 12 }, // same vertical, maximum height the API accepts
  { id: 'east-limb', lat: 0, lon: 90, heightKm: 0 }, // Earth grazing the horizon
  { id: 'far-side', lat: -45.4446, lon: 177.5991, heightKm: 0 }, // Chang'e 4: Earth always below the horizon
  { id: 'south-pole', lat: -89.45, lon: -137, heightKm: 0 }, // Shackleton rim: grazing Sun
];

const t0 = Date.parse(START);
const count = Math.floor((Date.parse(STOP) - t0) / (STEP_MINUTES * 60_000)) + 1;
const series: { site: string; body: Body; az: number[]; el: number[]; distKm: number[] }[] = [];

for (const site of SITES) {
  for (const body of Object.keys(BODIES) as Body[]) {
    // Quantities 4 and 20: azimuth, elevation, distance, range rate.
    const rows = await fetchObserverTable({ site, body, start: START, stop: STOP, stepMinutes: STEP_MINUTES, quantities: '4,20' });
    series.push({ site: site.id, body, az: rows.map((r) => +r[3]), el: rows.map((r) => +r[4]), distKm: rows.map((r) => +r[5]) });
    console.log(`${site.id}/${body}: ${rows.length} points`);
  }
}

const fixture = {
  source: 'JPL Horizons, DE441, center coord@301 (MEAN_ME, 1737.4 km sphere), apparent az/el without refraction',
  fetchedAt: new Date().toISOString().slice(0, 10),
  start: START, stepMinutes: STEP_MINUTES, count, sites: SITES, series,
};
// One series per line: a regeneration diff stays bounded and git compresses it well.
const json = JSON.stringify({ ...fixture, series: [] }).replace('"series":[]', `"series":[\n${series.map((s) => JSON.stringify(s)).join(',\n')}\n]`);
writeFileSync(new URL('./horizons.json', import.meta.url), json + '\n');
console.log(`horizons.json: ${series.length * count} points, ${(json.length / 1e6).toFixed(2)} MB`);
