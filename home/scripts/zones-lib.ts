// Pure part of build-zones.ts: from the engine results of one zone to its record in home/data/zones.json.

export interface ZoneSource {
  id: string;
  lat: number;
  lon: number;
  /** Catalogue site of backend/src/sites.ts at the same place (its precomputed horizon mask is then used). */
  siteId?: string;
}

export type LightLevel = 'most' | 'half' | 'little' | 'never';
export type EarthLevel = 'always' | 'mostly' | 'sometimes' | 'never';

/** Share of the time with some of the Sun above the horizon, as the card says it. */
export function lightLevel(fraction: number): LightLevel {
  if (fraction >= 0.75) return 'most';
  if (fraction >= 0.35) return 'half';
  if (fraction > 0.02) return 'little';
  return 'never';
}

/** Share of the time with some of the Earth above the horizon, as the card says it. */
export function earthLevel(fraction: number): EarthLevel {
  if (fraction >= 0.99) return 'always';
  if (fraction >= 0.6) return 'mostly';
  if (fraction > 0.01) return 'sometimes';
  return 'never';
}

export interface EngineFigures {
  sunFraction: number;
  earthFraction: number;
  longestNightHours: number;
  /** The longest night reaches both ends of the period: it may be longer than measured. */
  nightTruncated: boolean;
  earthElevationDeg: readonly number[];
  horizon: { applied: boolean; source: 'catalog' | 'dem' | null; note: string | null };
  slope: { slopeDeg: number | null; slopeBaselineM: number | null; underestimated: boolean } | null;
  warnings: readonly string[];
}

const round = (x: number, digits: number): number => Number(x.toFixed(digits));

export function zoneRecord(zone: ZoneSource, f: EngineFigures) {
  const el = f.earthElevationDeg;
  return {
    id: zone.id,
    lat: zone.lat,
    lon: zone.lon,
    ...(zone.siteId ? { siteId: zone.siteId } : {}),
    light: { level: lightLevel(f.sunFraction), percent: round(f.sunFraction * 100, 1) },
    night: { longestHours: round(f.longestNightHours, 1), longestDays: round(f.longestNightHours / 24, 1), ...(f.nightTruncated ? { wholePeriod: true } : {}) },
    earth: {
      level: earthLevel(f.earthFraction),
      percent: round(f.earthFraction * 100, 1),
      elevationDeg: { min: round(Math.min(...el), 1), max: round(Math.max(...el), 1) },
    },
    horizon: f.horizon.applied ? { model: 'relief' as const, source: f.horizon.source, note: f.horizon.note } : { model: 'smooth' as const, note: f.horizon.note },
    slope: f.slope && f.slope.slopeDeg !== null
      ? { available: true, deg: round(f.slope.slopeDeg, 1), baselineM: f.slope.slopeBaselineM, underestimated: f.slope.underestimated }
      : { available: false },
    warnings: [...new Set(f.warnings)].sort(),
  };
}

export type ZoneRecord = ReturnType<typeof zoneRecord>;
