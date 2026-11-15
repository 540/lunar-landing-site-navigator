// Minimal client for the public JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), shared by the
// scripts that regenerate the reference fixtures. Observer tables for a point on the Moon: DE441, MEAN_ME frame,
// 1737.4 km sphere, apparent azimuth/elevation without refraction.
import type { Body } from '../../../backend/src/types.ts';

/** Horizons COMMAND of each body. */
export const BODIES: Record<Body, string> = { sun: '10', earth: '399' };

/** Observer point on the Moon (selenographic degrees, height in km). */
export interface ObserverSite { id: string; lat: number; lon: number; heightKm?: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const horizonsTime = (iso: string): string => iso.slice(0, 16).replace('T', ' ');
/** Date as Horizons prints it in its table: 2026-Jan-01 00:00 */
const horizonsStamp = (ms: number): string => {
  const d = new Date(ms), p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${MONTHS[d.getUTCMonth()]}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

/**
 * Rows of an observer table, one per instant from `start` to `stop` every `stepMinutes`. Each row is the list of
 * cells Horizons prints: date, solar flag, lunar flag and then the requested quantities, in order.
 * Throws unless Horizons counted the instants exactly as `start + i·step`, which is how the tests rebuild them.
 */
export async function fetchObserverTable({ site, body, start, stop, stepMinutes, quantities, rangeUnits = 'KM' }: {
  site: ObserverSite; body: Body; start: string; stop: string; stepMinutes: number; quantities: string; rangeUnits?: string;
}): Promise<string[][]> {
  const params = new URLSearchParams({
    format: 'text', COMMAND: `'${BODIES[body]}'`, OBJ_DATA: 'NO', EPHEM_TYPE: 'OBSERVER',
    CENTER: `'coord@301'`, COORD_TYPE: 'GEODETIC', SITE_COORD: `'${site.lon},${site.lat},${site.heightKm ?? 0}'`,
    START_TIME: `'${horizonsTime(start)}'`, STOP_TIME: `'${horizonsTime(stop)}'`, STEP_SIZE: `'${stepMinutes}m'`,
    QUANTITIES: `'${quantities}'`, ANG_FORMAT: 'DEG', RANGE_UNITS: rangeUnits, CSV_FORMAT: 'YES',
  });
  const text = await (await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`)).text();
  const table = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!table) throw new Error(`Horizons returned no table for ${site.id}/${body}:\n${text.slice(0, 2000)}`);
  const rows = table.trim().split('\n').map((line) => line.split(',').map((cell) => cell.trim()));
  const t0 = Date.parse(start);
  const count = Math.floor((Date.parse(stop) - t0) / (stepMinutes * 60_000)) + 1;
  if (rows.length !== count) throw new Error(`${site.id}/${body}: ${rows.length} rows, expected ${count}`);
  for (const i of [0, count - 1]) {
    const want = horizonsStamp(t0 + i * stepMinutes * 60_000);
    if (rows[i][0] !== want) throw new Error(`${site.id}/${body}: row ${i} is ${rows[i][0]}, expected ${want}`);
  }
  // Be gentle with a shared public service: queries go one at a time, with a pause in between.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return rows;
}
