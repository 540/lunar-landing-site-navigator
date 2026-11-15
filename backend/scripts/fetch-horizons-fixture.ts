// Downloads from JPL Horizons the apparent azimuth and elevation (no refraction) of the Sun and the Earth
// as seen from the lunar surface, and stores them in test/fixtures/horizons.json in compact form.
//
// Usage: npm run fixture
// Horizons uses DE441 and the MEAN_ME frame for the Moon; it is our precision reference in the tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const START = '2027-01-01 00:00';
const STOP = '2027-03-01 00:00';
const STEP_MINUTES = 30;
const SITES = [
  { id: 'chandrayaan3', lat: -69.373, lon: 32.319 },
  { id: 'shackleton-rim', lat: -89.45, lon: -137.0 },
];
const BODIES = { sun: '10', earth: '399' };

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'horizons.json');

interface FixtureSite { id: string; lat: number; lon: number; [body: string]: unknown }

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

async function fetchSeries(site: { id: string; lat: number; lon: number }, command: string): Promise<{ first: string | null; az: number[]; el: number[] }> {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${command}'`,
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${site.lon},${site.lat},0'`,
    EPHEM_TYPE: 'OBSERVER',
    START_TIME: `'${START}'`,
    STOP_TIME: `'${STOP}'`,
    STEP_SIZE: `'${STEP_MINUTES} m'`,
    QUANTITIES: "'4'",
    ANG_FORMAT: 'DEG',
    CSV_FORMAT: 'YES',
    TIME_DIGITS: 'MINUTES',
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Horizons respondió ${res.status} para ${site.id}/${command}`);
  const json = (await res.json()) as { result?: string };
  const text = json.result ?? '';
  if (!text.includes('$$SOE')) throw new Error(`Respuesta de Horizons sin $$SOE para ${site.id}/${command}:\n${text.slice(0, 500)}`);
  const lines = text.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n');
  const az: number[] = [], el: number[] = [];
  let first: string | null = null;
  for (const line of lines) {
    const cols = line.split(',').map((c) => c.trim());
    first ??= cols[0];
    // Columns: date, solar flag, lunar flag, azimuth, elevation
    const a = Number(cols[3]), e = Number(cols[4]);
    if (!Number.isFinite(a) || !Number.isFinite(e)) throw new Error(`Fila no numérica: ${line}`);
    az.push(round6(a));
    el.push(round6(e));
  }
  return { first, az, el };
}

const expected = (Date.parse(`${STOP.replace(' ', 'T')}Z`) - Date.parse(`${START.replace(' ', 'T')}Z`)) / (STEP_MINUTES * 60e3) + 1;
const fixture = {
  source: 'JPL Horizons API (DE441, MEAN_ME), az/el aparentes sin refracción, QUANTITIES=4',
  generated: new Date().toISOString(),
  start: `${START.replace(' ', 'T')}:00Z`,
  stepMinutes: STEP_MINUTES,
  count: expected,
  sites: [] as FixtureSite[],
};

for (const site of SITES) {
  const entry: FixtureSite = { id: site.id, lat: site.lat, lon: site.lon };
  for (const [body, command] of Object.entries(BODIES)) {
    const s = await fetchSeries(site, command);
    if (s.az.length !== expected) throw new Error(`${site.id}/${body}: ${s.az.length} filas, se esperaban ${expected}`);
    entry[body] = { az: s.az, el: s.el };
    console.log(`${site.id}/${body}: ${s.az.length} filas desde ${s.first}`);
  }
  fixture.sites.push(entry);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(fixture));
console.log(`Escrito ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
