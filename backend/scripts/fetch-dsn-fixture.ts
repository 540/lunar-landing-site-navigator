// Downloads from JPL Horizons the apparent elevation and azimuth (no refraction) of the Moon seen from the three DSN
// reference antennas (DSS-14 Goldstone, DSS-63 Madrid, DSS-43 Canberra, Horizons' own observer sites) and stores them
// in test/fixtures/dsn-horizons.json. It is the independent reference of src/dsn.ts (issue #103, test/dsn.test.ts).
//
// Usage: npm run fixture:dsn
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const START = '2027-01-01 00:00';
const STOP = '2027-12-27 00:00';
const STEP = '7 d';
const STATIONS = { goldstone: 'DSS-14', madrid: 'DSS-63', canberra: 'DSS-43' };

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'dsn-horizons.json');
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

async function fetchStation(antenna: string): Promise<{ t: string[]; az: number[]; el: number[] }> {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: "'301'",
    CENTER: `'${antenna}@399'`,
    EPHEM_TYPE: 'OBSERVER',
    START_TIME: `'${START}'`,
    STOP_TIME: `'${STOP}'`,
    STEP_SIZE: `'${STEP}'`,
    QUANTITIES: "'4'",
    ANG_FORMAT: 'DEG',
    CSV_FORMAT: 'YES',
    TIME_DIGITS: 'MINUTES',
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Horizons respondió ${res.status} para ${antenna}`);
  const text = ((await res.json()) as { result?: string }).result ?? '';
  if (!text.includes('$$SOE')) throw new Error(`Respuesta de Horizons sin $$SOE para ${antenna}:\n${text.slice(0, 500)}`);
  const t: string[] = [], az: number[] = [], el: number[] = [];
  for (const line of text.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n')) {
    // Columns: date, solar flag, lunar flag, azimuth, elevation
    const cols = line.split(',').map((c) => c.trim());
    const a = Number(cols[3]), e = Number(cols[4]);
    if (!Number.isFinite(a) || !Number.isFinite(e)) throw new Error(`Fila no numérica: ${line}`);
    t.push(new Date(`${cols[0].replace(/-(\w{3})-/, ' $1 ')} UTC`).toISOString());
    az.push(round6(a));
    el.push(round6(e));
  }
  return { t, az, el };
}

const fixture = {
  source: 'JPL Horizons API (DE441), Luna (301) vista desde DSS-14, DSS-63 y DSS-43, az/el aparentes sin refracción, QUANTITIES=4',
  generated: new Date().toISOString(),
  t: [] as string[],
  stations: {} as Record<string, { antenna: string; az: number[]; el: number[] }>,
};

for (const [id, antenna] of Object.entries(STATIONS)) {
  const s = await fetchStation(antenna);
  if (fixture.t.length && s.t.join() !== fixture.t.join()) throw new Error(`${antenna}: instantes distintos de los de las otras estaciones`);
  fixture.t = s.t;
  fixture.stations[id] = { antenna, az: s.az, el: s.el };
  console.log(`${antenna}: ${s.t.length} filas desde ${s.t[0]}`);
}

fs.writeFileSync(OUT, `${JSON.stringify(fixture)}\n`);
console.log(`Escrito ${OUT}`);
