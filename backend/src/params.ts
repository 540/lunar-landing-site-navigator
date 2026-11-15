// Parsing and validation of query parameters.
import { getSite } from './sites.ts';
import { MODES } from './visibility.ts';
import { BATTERY_DEFAULTS, BATTERY_LIMITS } from './night.ts';
import { panelOption } from './panel.ts';
import { SLOPE_BASELINE_LIMITS, SLOPE_DEFAULT_BASELINE_M, checkUncertifiedPolicy } from './terrain/slope.ts';
import { REFINE_MAX_DEG } from './horizon.ts';
import type { BatteryOptions, Mode, NightOptions, Panel, Site, SlopeRequest, SlopeUncertifiedPolicy } from './types.ts';

export class HttpError extends Error {
  declare status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const bad = (msg: string): HttpError => new HttpError(400, msg);

const UNITS: Record<string, number> = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 };

/** '10m', '1h', '2d', '30s' → milliseconds */
export function parseDuration(value: string | null | undefined, name: string): number {
  const m = /^(\d+(?:\.\d+)?)([smhd])$/.exec(value ?? '');
  if (!m) throw bad(`${name} debe ser una duración tipo 30s, 10m, 1h o 2d`);
  return Number(m[1]) * UNITS[m[2]];
}

/** Years accepted in dates: the engine is only validated against JPL Horizons in 2026–2030 (data/ACCURACY.md); outside this wider range the request is refused. */
export const DATE_YEAR_LIMITS: readonly [number, number] = [1900, 2100];

// Strict ISO 8601: date, optional time (T or a space), optional fraction and zone (Z, ±hh:mm or ±hhmm).
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?(Z|z|[+-]\d{2}:?\d{2})?$/;

/**
 * Strict ISO 8601 date (UTC when it has no zone). The calendar fields must survive a round trip (2027-02-30 is refused,
 * not moved to 2 March) and the year must be within DATE_YEAR_LIMITS.
 */
export function parseDate(value: string | null | undefined, name: string, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw bad(`Falta ${name}`);
  }
  // In an unencoded query string, the '+' of '+02:00' arrives as a space: restore it.
  value = value.replace(/(T\d\d:\d\d(?::\d\d(?:\.\d+)?)?) (\d\d:?\d\d)$/, '$1+$2');
  const m = ISO_DATE.exec(value);
  if (!m) throw bad(`${name} no es una fecha ISO 8601 válida: usa AAAA-MM-DD o AAAA-MM-DDThh:mm[:ss][Z|±hh:mm]`);
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0));
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
  const [minYear, maxYear] = DATE_YEAR_LIMITS;
  if (y < minYear || y > maxYear) throw bad(`${name} debe estar entre los años ${minYear} y ${maxYear}`);
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    throw bad(`${name} no es una fecha real: ${value}`);
  }
  let offsetMin = 0;
  const zone = m[8];
  if (zone && zone !== 'Z' && zone !== 'z') {
    const zm = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
    const zh = Number(zm[2]), zmin = Number(zm[3]);
    if (zh > 23 || zmin > 59) throw bad(`${name} tiene una zona horaria no válida: ${zone}`);
    offsetMin = (zm[1] === '-' ? -1 : 1) * (zh * 60 + zmin);
  }
  return t - offsetMin * 60e3;
}

// Plain decimal number: optional sign, digits with an optional fraction and an optional exponent. No spaces, hex or Infinity.
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Strict decimal number (`name` for the message). */
export function parseDecimal(value: string, name: string): number {
  const n = DECIMAL.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw bad(`${name} debe ser un número decimal (por ejemplo, -89.5): «${value}» no lo es`);
  return n;
}

const parseNumber = (value: string | null | undefined, name: string, min: number, max: number): number => {
  if (value === undefined || value === null || value === '') throw bad(`${name} debe ser un número`);
  const n = parseDecimal(value, name);
  if (n < min || n > max) throw bad(`${name} debe estar entre ${min} y ${max}`);
  return n;
};

/** Site from `site=<id>` or from `lat`/`lon` (and optional `heightKm`). */
export function parseSite(q: URLSearchParams): Site {
  if (q.get('site')) {
    const s = getSite(q.get('site'));
    if (!s) throw new HttpError(404, `Sitio desconocido: ${q.get('site')}`);
    return s;
  }
  if (q.get('lat') === null || q.get('lon') === null) throw bad('Indica site=<id> o lat y lon');
  const lat = parseNumber(q.get('lat'), 'lat', -90, 90);
  const lon = parseNumber(q.get('lon'), 'lon', -180, 360);
  const heightKm = q.get('heightKm') ? parseNumber(q.get('heightKm'), 'heightKm', -10, 12) : 0;
  return { id: `custom:${lat},${lon}`, name: 'Coordenadas personalizadas', lat, lon: lon > 180 ? lon - 360 : lon, heightKm, custom: true };
}

/**
 * List of sites: `sites=apollo11,im2-alunizaje,-89.5:0` (id or lat:lon). Repeated sites are kept once (`onDuplicate` is
 * told about each repeated item); an item with a colon that is not a valid lat:lon pair is a 400, not an unknown id.
 */
export function parseSiteList(value: string | null | undefined, onDuplicate?: (item: string) => void): Site[] {
  if (!value) throw bad('Falta sites (lista separada por comas de ids o lat:lon)');
  const items = value.split(',').map((x) => x.trim()).filter(Boolean);
  if (items.length > 10) throw bad('Máximo 10 sitios por comparación');
  const seen = new Set<string>();
  const out: Site[] = [];
  for (const item of items) {
    let site: Site;
    if (item.includes(':')) {
      const parts = item.split(':');
      if (parts.length !== 2) throw bad(`sites: «${item}» no es un id del catálogo ni un par lat:lon`);
      site = parseSite(new URLSearchParams({ lat: parts[0], lon: parts[1] }));
    } else {
      site = parseSite(new URLSearchParams({ site: item }));
    }
    if (seen.has(site.id)) { onDuplicate?.(item); continue; }
    seen.add(site.id);
    out.push(site);
  }
  return out;
}

export function parseMode(value: string | null | undefined): Mode {
  const mode = value || 'limb';
  if (!(mode in MODES)) throw bad(`mode debe ser uno de: ${Object.keys(MODES).join(', ')}`);
  return mode as Mode;
}

export function parseRange(q: URLSearchParams, { maxDays, defaultDays }: { maxDays: number; defaultDays: number }): { start: number; end: number } {
  const start = parseDate(q.get('start'), 'start', Date.now());
  const end = q.get('end') ? parseDate(q.get('end'), 'end') : start + defaultDays * 86400e3;
  if (end <= start) throw bad('end debe ser posterior a start');
  if (end - start > maxDays * 86400e3) throw bad(`El intervalo máximo es de ${maxDays} días`);
  return { start, end };
}

/** Optional flag: absent, '', 0 or false → false; 1 or true → true; anything else is an error. */
export function parseFlag(q: URLSearchParams, name: string): boolean {
  const raw = q.get(name);
  if (raw === null || raw === '' || raw === '0' || raw === 'false') return false;
  if (raw === '1' || raw === 'true') return true;
  throw bad(`${name} debe ser 1, true, 0 o false`);
}

/** Optional strict decimal in [min, max] (undefined when absent or empty). */
export const optionalNumber = (q: URLSearchParams, name: string, min: number, max: number): number | undefined => {
  const raw = q.get(name);
  if (raw === null || raw === '') return undefined;
  const n = parseDecimal(raw, name);
  if (n < min || n > max) throw bad(`${name} debe ser un número entre ${min} y ${max}`);
  return n;
};

/** Query names of the battery inputs. */
export const BATTERY_PARAMS: Readonly<Record<keyof BatteryOptions, string>> = { survivalLoadW: 'survivalLoadW', whPerKg: 'batteryWhPerKg', depthOfDischarge: 'batteryDoD' };

/**
 * Night options: `nightMinSunFraction` (0–1, default 0), `fullNight` (1/true) and the battery (`battery=1`, or any of
 * `survivalLoadW`, `batteryWhPerKg`, `batteryDoD`, which also turn it on unless `battery=0`). Returns null when none is on, so callers add nothing.
 */
export function parseNightOptions(q: URLSearchParams): NightOptions | null {
  const nightMinSunFraction = optionalNumber(q, 'nightMinSunFraction', 0, 1) ?? 0;
  const fullNight = parseFlag(q, 'fullNight');
  const given = Object.fromEntries((Object.entries(BATTERY_PARAMS) as [keyof BatteryOptions, string][])
    .map(([k, name]) => [k, optionalNumber(q, name, ...BATTERY_LIMITS[k])])
    .filter(([, v]) => v !== undefined)) as Partial<BatteryOptions>;
  // battery=0 (or false) turns it off even if a battery input is given: those inputs are then ignored.
  const batteryRaw = q.get('battery');
  const batteryOff = batteryRaw === '0' || batteryRaw === 'false';
  const battery = !batteryOff && (parseFlag(q, 'battery') || Object.keys(given).length > 0) ? { ...BATTERY_DEFAULTS, ...given } : null;
  if (nightMinSunFraction === 0 && !fullNight && !battery) return null;
  return {
    ...(nightMinSunFraction > 0 ? { nightMinSunFraction } : {}),
    ...(fullNight ? { fullNight } : {}),
    ...(battery ? { battery } : {}),
  };
}

/**
 * Optional `panel` (panel.ts): `tracking` (default, factor 1), `vertical-rotating` (cos(el)) or `horizontal` (max(0, sin(el))).
 * Only changes the `energy` metric. Returns `{}` when absent or `tracking`, so callers add nothing and responses do not change.
 */
export function parsePanel(q: URLSearchParams): { panel?: Exclude<Panel, 'tracking'> } {
  try {
    return panelOption(q.get('panel'));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

/**
 * Terrain slope (terrain/slope.ts): `slope=1`, `slopeBaselineM` (metres, default 100: Artemis III asks for < 10° over
 * 100 m) and `maxSlopeDeg` (filter). Any of the three turns it on. Returns null when none is given, so callers add
 * nothing and responses do not change.
 */
export function parseSlopeOptions(q: URLSearchParams): SlopeRequest | null {
  const on = parseFlag(q, 'slope');
  const baselineM = optionalNumber(q, 'slopeBaselineM', ...SLOPE_BASELINE_LIMITS);
  const maxSlopeDeg = optionalNumber(q, 'maxSlopeDeg', 0, 90);
  const uncertified = parseUncertifiedPolicy(q);
  if (!on && baselineM === undefined && maxSlopeDeg === undefined) return null;
  return { baselineM: baselineM ?? SLOPE_DEFAULT_BASELINE_M, ...(maxSlopeDeg !== undefined ? { maxSlopeDeg, uncertified } : {}) };
}

/**
 * `slopeUncertified` (exclude/keep, default exclude): what the maxSlopeDeg filter does with uncertified slopes
 * (underestimated: measured on a longer baseline than asked). Only the searches and rankings filter; it does not turn
 * the slope on by itself.
 */
export function parseUncertifiedPolicy(q: URLSearchParams): SlopeUncertifiedPolicy {
  const raw = q.get('slopeUncertified');
  try {
    return checkUncertifiedPolicy(raw === null || raw === '' ? undefined : raw);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

/**
 * Hybrid horizon of the terrain options (horizon.ts, refinedMask): `horizonRefine` (1/true/0/false; absent = default:
 * on in precise mode, off in fast) and `horizonRefineDeg` (threshold X in degrees, 0–2; 0 turns it off). Only the given ones.
 */
export function parseRefineOptions(q: URLSearchParams): { refine?: boolean; refineDeg?: number } {
  const raw = q.get('horizonRefine');
  const refine = raw === null || raw === '' ? undefined : parseFlag(q, 'horizonRefine');
  const refineDeg = optionalNumber(q, 'horizonRefineDeg', 0, REFINE_MAX_DEG);
  return { ...(refine !== undefined ? { refine } : {}), ...(refineDeg !== undefined ? { refineDeg } : {}) };
}
