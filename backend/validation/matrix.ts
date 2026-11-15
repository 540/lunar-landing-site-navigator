// Validation matrix: one row per endpoint (or metric) × official reference, with its statistics, its tolerance and its
// status. The rows are built from the results of the measurement units (measure.ts) that validate.ts runs.
//
// Status of a row:
//   ✅ every limit holds;  ⚠️ a known problem (with its issue): its limits are today's values, a ceiling so that it
//   cannot get worse unseen;  ❌ some limit is exceeded;  ℹ️ informative, no pass/fail;  ⏭️ not run (missing data).
//
// The limits come from the measurement of 2026-11-14 (see TOLERANCE_RULE): they guard against regressions, they do
// not tune anything. A change that improves a ⚠️ row should lower its ceiling in the same commit.
import { BUDGET_DEG } from '../../data/test/accuracy.ts';
import { FOOTPRINT_SITES, fixture } from './measure.ts';
import type { ConsistencyResult, FootprintResult, GlaserNearResult, GlaserResult, Glaser, IllumFixture, Leone, Missions, MissionsResult, PgdaPoints, PgdaResult, PsrFixture, SlopeFixture, SlopeResult, Unit } from './measure.ts';

export type Results = ReadonlyMap<string, unknown>;

/** Limits of a row: statistics (absolute values) and the minimum % of points within the per-point tolerance. */
export interface Limits { rms?: number; mae?: number; bias?: number; max?: number; within?: number }

/**
 * What is known of one point of a row besides its d, for `npm run validate -- --view` (the statistics never read it):
 * its name, its coordinates and, when the row has no `ref` (no % of reference column), our value and the reference.
 */
export interface PointMeta { id: string; lat?: number; lon?: number; ours?: number; ref?: number }

interface Numeric {
  kind: 'numeric';
  /** ours − reference, one per point (in the row unit). */
  d: number[];
  /** Reference values, for the % of reference column (absent: no such column). */
  ref?: number[];
  /** Per-point tolerance (one value or one per point). */
  tol: number | number[];
  /** false: d is an error magnitude (≥ 0), there is no bias. */
  signed?: boolean;
  /** Regressions found besides the statistics (they make the row ❌). */
  failures?: string[];
  /** One per point, parallel to d. */
  points?: PointMeta[];
  /** Measured context of the row (it goes in its note, also when ⚠️); no pass/fail. */
  remark?: string;
}
interface Check { kind: 'check'; ok: boolean[]; failures?: string[]; points?: PointMeta[] }
type Measured = Numeric | Check;

export interface RowSpec {
  section: string;
  what: string;
  /** Markdown: name, version and link of the reference. */
  source: string;
  unit: string;
  digits: number;
  /** Text of the per-point tolerance. */
  tolText: string;
  limits?: Limits;
  /** Known problem: issue number (the row is ⚠️ while within its ceilings). */
  known?: number;
  informative?: boolean;
  /** Result of the row, or a string saying why it was not run. */
  measure: (r: Results) => Measured | string;
}

/** One point of a row as the view shows it (`npm run validate -- --view`); null where it does not apply. */
export interface PointResult {
  id: string; lat: number | null; lon: number | null;
  ours: number | null; ref: number | null;
  /** ours − reference (or the error magnitude when the row is unsigned); null in a check row. */
  d: number | null;
  tol: number | null;
  /** Within its tolerance, or the check passed. */
  ok: boolean;
}

export interface RowResult {
  spec: RowSpec;
  n: number | null;
  bias: number | null; mae: number | null; rms: number | null; pctRef: number | null; max: number | null; within: number | null;
  status: '✅' | '⚠️' | '❌' | 'ℹ️' | '⏭️';
  /** Why not run, or what failed. */
  note: string;
  /** false: d is an error magnitude (no bias). */
  signed: boolean;
  /** Every point of the row (empty if not run). VALIDATION.md does not use them. */
  points: PointResult[];
}

export const TOLERANCE_RULE = 'Los límites salen de la medición del 2026-11-14: en las filas ✅, el valor medido con un margen '
  + '(RMS, MAE y máximo, un 10–20 % más redondeado hacia arriba; % dentro, unos 3 puntos menos), o el presupuesto que ya '
  + 'existía (Horizons, pendiente, iluminación de 240 m); en las ⚠️, el valor actual redondeado hacia arriba, como tope.';

// ---------------------------------------------------------------- helpers

const NO_DEM = 'falta el DEM LOLA (node scripts/fetch-dem.ts)';
const NO_CAP = 'falta el DEM de 160 m del casquete (node scripts/fetch-dem.ts)';
const get = <T>(r: Results, u: Unit): T | undefined => r.get(Object.values(u).join(':')) as T | undefined;

const PGDA = fixture<PgdaPoints>('pgda-points.json');
const GLASER = fixture<Glaser>('glaser2018.json');
const LEONE = fixture<Leone>('leone2023.json');
const MISSIONS = fixture<Missions>('missions.json');
const ILLUM = fixture<IllumFixture>('illumination.json');
const PSR = fixture<PsrFixture>('psr.json');
const SLOPE = fixture<SlopeFixture>('slope.json');
const link = (text: string, url: string): string => `[${text}](${url})`;
const pgdaSource = (k: keyof PgdaPoints['products']): string => {
  const p = PGDA.products[k];
  return `${link(`PGDA ${p.product}`, p.url)} (${p.version}, ${p.resolutionM} m)`;
};
const GLASER_SRC = (table: 1 | 2): string => link(`Gläser et al. 2018, tabla ${table}`, GLASER.source);

const pgdaPoint = (p: PgdaPoints['points'][number]): PointMeta => ({ id: p[1] ?? p[0], lat: p[2], lon: p[3] });

/** PGDA rows: product `k` against field `field` of the PGDA unit at one height. */
function pgdaRow(k: 'earth65' | 'earth85' | 'sun65' | 'sun85', field: 'earth' | 'sun', heightM: number): RowSpec['measure'] {
  const col = { earth65: 4, earth85: 5, sun65: 6, sun85: 7 }[k];
  return (r) => {
    const d: number[] = [], ref: number[] = [], points: PointMeta[] = [];
    for (const p of PGDA.points) {
      const want = p[col] as number | null;
      if (want === null) continue;
      const got = get<PgdaResult>(r, { kind: 'pgda', id: p[0] })?.[`h${heightM}` as 'h0' | 'h2'];
      if (!got) return NO_DEM;
      d.push((got[field] - want) * 100); ref.push(want * 100); points.push(pgdaPoint(p));
    }
    return { kind: 'numeric', d, ref, tol: 2, points };
  };
}

function skyRow(heightM: number): RowSpec['measure'] {
  return (r) => {
    const d: number[] = [], ref: number[] = [], points: PointMeta[] = [];
    for (const p of PGDA.points) {
      const got = get<PgdaResult>(r, { kind: 'pgda', id: p[0] })?.[`h${heightM}` as 'h0' | 'h2'];
      if (!got) return NO_DEM;
      if (got.skySr === null || p[8] === null) continue;
      d.push(got.skySr - p[8]); ref.push(p[8]); points.push(pgdaPoint(p));
    }
    return { kind: 'numeric', d, ref, tol: 0.1, points };
  };
}

function glaserRow(table: 1 | 2, field: 'vis' | 'avg' | 'shadowH', only?: (id: string) => boolean): RowSpec['measure'] {
  const col = ({ vis: 5, avg: 6, shadowH: 7 } as const)[field];
  return (r) => {
    const d: number[] = [], ref: number[] = [], tol: number[] = [], points: PointMeta[] = [];
    for (const [index, p] of GLASER.points.entries()) {
      if (p[1] !== table || (only && !only(p[0]))) continue;
      const got = get<GlaserResult>(r, { kind: 'glaser', index });
      if (!got) return NO_DEM;
      d.push(got[field] - p[col]); ref.push(p[col]); tol.push(field === 'shadowH' ? 0.1 * p[col] : 2); points.push({ id: p[0], lat: p[2], lon: p[3] });
    }
    return { kind: 'numeric', d, ref, tol, points };
  };
}

/** Table 1 of Gläser (0 m) against the best point within 40 m of the published coordinate (glaserNear unit). */
export function glaserNearRow(field: 'vis' | 'avg' | 'shadowH'): RowSpec['measure'] {
  const col = ({ vis: 5, avg: 6, shadowH: 7 } as const)[field];
  return (r) => {
    const d: number[] = [], ref: number[] = [], tol: number[] = [], points: PointMeta[] = [];
    for (const [index, p] of GLASER.points.entries()) {
      if (p[1] !== 1) continue;
      const got = get<GlaserNearResult>(r, { kind: 'glaserNear', index });
      if (!got) return NO_DEM;
      d.push(got[field] - p[col]); ref.push(p[col]); tol.push(field === 'shadowH' ? 0.1 * p[col] : 2);
      points.push({ id: `${p[0]} (mejor a ${got.dx}, ${got.dy} m)`, lat: p[2], lon: p[3] });
    }
    return { kind: 'numeric', d, ref, tol, points };
  };
}

/**
 * Table 1 of Gläser at the published coordinate, with the measured ±10 m range of the % with Sun (vis10 of the
 * glaserNear units: minimum and maximum over C1, C2 and S) as the remark; without those results, no figures.
 */
function glaserPublishedRow(field: 'vis' | 'avg' | 'shadowH'): RowSpec['measure'] {
  const measure = glaserRow(1, field);
  return (r) => {
    const m = measure(r);
    if (typeof m === 'string' || m.kind !== 'numeric') return m;
    const near = GLASER.points.flatMap((p, index) => (p[1] === 1 ? [get<GlaserNearResult>(r, { kind: 'glaserNear', index })] : []));
    if (near.some((x) => !x)) return m;
    const lo = Math.min(...near.map((x) => x!.vis10[0])), hi = Math.max(...near.map((x) => x!.vis10[1]));
    return { ...m, remark: `a ±10 m el % con Sol va de ${formatNumber(lo, 1)} a ${formatNumber(hi, 1)} %` };
  };
}

/** % with Sun over the footprint of the 60 m PGDA pixel (footprint unit) against the pixel of AVGVISIB_85S_060M. */
function footprintRow(r: Results): ReturnType<RowSpec['measure']> {
  const d: number[] = [], ref: number[] = [], points: PointMeta[] = [];
  let remark = '';
  for (const id of FOOTPRINT_SITES) {
    const got = get<FootprintResult>(r, { kind: 'footprint', id });
    if (!got) return NO_DEM;
    const p = PGDA.points.find((q) => q[0] === id)!;
    const want = (p[7] as number) * 100;
    d.push(got.mean - want); ref.push(want);
    points.push({ ...pgdaPoint(p), id: `${p[1] ?? p[0]} (en el punto ${formatNumber(got.centre, 1)} %; huella de ${formatNumber(got.min, 1)} a ${formatNumber(got.max, 1)} %)` });
    // The 2 m value at the site comes from the pgda unit (same results), so the text never carries a typed figure.
    const h2 = get<PgdaResult>(r, { kind: 'pgda', id })?.h2.sun;
    if (h2 !== undefined) remark = `a 2 m y en el punto da ${formatNumber(h2 * 100, 1)} %`;
  }
  return { kind: 'numeric', d, ref, tol: FOOTPRINT_MAX_PP, points, ...(remark ? { remark } : {}) };
}
/** Ceiling of the footprint row (#85): the measured value (8.77 pp with the real DEM, 2026-11-15) rounded up with some margin, never more than 10 pp. */
const FOOTPRINT_MAX_PP = 9.5;

function leoneRow(heightM: number): RowSpec['measure'] {
  return (r) => {
    const d: number[] = [], ref: number[] = [], points: PointMeta[] = [];
    for (const [index, p] of LEONE.points.entries()) {
      const got = get<Record<'h0' | 'h2', number>>(r, { kind: 'leone', index })?.[`h${heightM}` as 'h0' | 'h2'];
      if (got === undefined) return NO_DEM;
      d.push(got - p[3]); ref.push(p[3]); points.push({ id: p[0], lat: p[1], lon: p[2] });
    }
    return { kind: 'numeric', d, ref, tol: 2, points };
  };
}

/** A slope point: the row has no `ref` column, so the product value goes in the point (ours = ref + d in the view). */
const slopePoint = (lat: number, lon: number, ref: number): PointMeta => ({ id: `${lat}, ${lon}`, lat, lon, ref });
const slope = (r: Results): SlopeResult | string => get<SlopeResult>(r, { kind: 'slope' }) ?? NO_DEM;
const missions = (r: Results): MissionsResult => get<MissionsResult>(r, { kind: 'missions' })!;
const labelled = (ids: readonly string[]): PointMeta[] => ids.map((id) => ({ id }));
const consistency = (r: Results): ConsistencyResult => get<ConsistencyResult>(r, { kind: 'consistency' })!;
const apolloPoint = (i: number): PointMeta => { const [id, , time] = MISSIONS.apollo.rows[i]; return { id: `${id} · ${time}` }; };
const horizonsSrc = link('JPL Horizons', 'https://ssd.jpl.nasa.gov/horizons/') + ' (DE441, MEAN_ME)';
const PERIOD_186 = '18,6 años desde 2010-01-01';
/**
 * Gläser table 1 (#86): at 0 m the result depends on the position within metres and the coordinates are rounded; the
 * measured ±10 m range goes in the status (glaserPublishedRow). The sites stay at the end, where the web summary
 * (data/test/validation-summary.ts) reads them.
 */
const PUBLISHED_0M = 'observador a 0 m, en la coordenada publicada (redondeada: a ras de suelo el resultado cambia decenas de puntos en metros, rango a ±10 m en el estado), 2017–2037; C1, C2 y S';
const BEST_0M = 'observador a 0 m, mejor punto a ≤ 40 m de la coordenada publicada (malla de 81 puntos cada 10 m, solo máscara), 2017–2037; C1, C2 y S';

// ---------------------------------------------------------------- rows

export const ROWS: RowSpec[] = [
  // ---- /v1/sun-earth and /v1/track
  {
    section: 'Sol y Tierra: dirección (/v1/sun-earth, /v1/track)',
    what: 'Azimut y elevación del Sol y la Tierra, 5 sitios (ecuador, 12 km, limbo este, cara oculta, polo sur), 2026–2030, cada 1313 min; error = máx(separación, |Δelevación|)',
    source: `${horizonsSrc}, \`data/test/fixtures/horizons.json\``, unit: '°', digits: 4,
    tolText: `${String(BUDGET_DEG.max).replace('.', ',')}° por punto`, limits: { rms: BUDGET_DEG.rms, max: BUDGET_DEG.max, within: 100 },
    measure: (r) => {
      const { errorsDeg, labels } = get<{ errorsDeg: number[]; labels: string[] }>(r, { kind: 'horizons' })!;
      return { kind: 'numeric', d: errorsDeg, tol: BUDGET_DEG.max, signed: false, points: labels.map((id) => ({ id })) };
    },
  },
  {
    section: 'Sol y Tierra: dirección (/v1/sun-earth, /v1/track)',
    what: 'Elevación del Sol en 30 instantes de las misiones Apollo (1969–1972: orto, alunizaje, fin de la última EVA, mediodía)',
    source: `${horizonsSrc}, \`validation/fixtures/missions.json\``, unit: '°', digits: 4,
    tolText: `${String(BUDGET_DEG.max).replace('.', ',')}° por punto`, limits: { mae: 0.0015, max: BUDGET_DEG.max, within: 100 },
    measure: (r) => {
      const rows = get<{ rows: [number, number | null, number][] }>(r, { kind: 'apollo' })!.rows;
      const points = rows.map(([ours, , hz], i): PointMeta => ({ ...apolloPoint(i), ours, ref: hz }));
      return { kind: 'numeric', d: rows.map(([ours, , hz]) => ours - hz), tol: BUDGET_DEG.max, points };
    },
  },
  {
    section: 'Sol y Tierra: dirección (/v1/sun-earth, /v1/track)',
    what: 'Elevación del Sol en 24 instantes Apollo frente a la tabla «Working on the Moon» (sin los ortos). Informativa: la tabla (calculada en 2008) discrepa de Horizons, y con Horizons coincidimos a 0,002°',
    source: link('ALSJ, Working on the Moon', MISSIONS.apollo.source), unit: '°', digits: 3, tolText: '—', informative: true,
    measure: (r) => {
      const all = get<{ rows: [number, number | null, number][] }>(r, { kind: 'apollo' })!.rows;
      const rows = all.filter((x) => x[1] !== null);
      const points = all.flatMap((x, i) => (x[1] === null ? [] : [apolloPoint(i)]));
      return { kind: 'numeric', d: rows.map(([ours, wotm]) => ours - wotm!), ref: rows.map(([, wotm]) => wotm!), tol: 0.1, points };
    },
  },
  // ---- /v1/windows: Earth
  ...([2, 0] as const).map((h): RowSpec => ({
    section: 'Visibilidad de la Tierra con relieve (/v1/rank, /v1/windows; terrain=1)',
    what: `Fracción de tiempo con la Tierra, antena a ${h} m, ${PERIOD_186}; 101 puntos al sur de 65°S`,
    source: pgdaSource('earth65'), unit: 'pp', digits: 2, tolText: '±2 pp por punto',
    limits: h === 2 ? { rms: 2.6, mae: 1.0, max: 15, within: 84 } : { rms: 3.5, mae: 1.4, max: 16.5, within: 83 },
    measure: pgdaRow('earth65', 'earth', h),
  })),
  ...([2, 0] as const).map((h): RowSpec => ({
    section: 'Visibilidad de la Tierra con relieve (/v1/rank, /v1/windows; terrain=1)',
    what: `Fracción de tiempo con la Tierra, antena a ${h} m, ${PERIOD_186}; 49 puntos al sur de 85°S (el producto de 60 m difiere del de 240 m 6,8 pp RMS)`,
    source: pgdaSource('earth85'), unit: 'pp', digits: 2, tolText: '±2 pp por punto', known: 85,
    limits: h === 2 ? { rms: 7.4, mae: 3.0, max: 33, within: 71 } : { rms: 6.3, mae: 2.4, max: 33, within: 79 },
    measure: pgdaRow('earth85', 'earth', h),
  })),
  ...([2, 0] as const).map((h): RowSpec => ({
    section: 'Visibilidad de la Tierra con relieve (/v1/rank, /v1/windows; terrain=1)',
    what: `Fracción de tiempo con la Tierra, antena a ${h} m, ${PERIOD_186}; 7 puntos con nombre del polo sur (valores leídos del mapa de PGDA por los autores)`,
    source: link('Leone et al. 2023, tabla 2', LEONE.source), unit: 'pp', digits: 2, tolText: '±2 pp por punto',
    limits: { rms: 0.7, mae: 0.6, max: 1.2, within: 100 },
    measure: leoneRow(h),
  })),
  // ---- /v1/windows: Sun
  ...([2, 0] as const).map((h): RowSpec => ({
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: `Fracción de tiempo con Sol, panel a ${h} m, ${PERIOD_186}; 101 puntos al sur de 65°S`,
    source: pgdaSource('sun65'), unit: 'pp', digits: 2, tolText: '±2 pp por punto',
    limits: h === 2 ? { rms: 4.0, mae: 1.8, max: 20, within: 78 } : { rms: 4.0, mae: 2.0, max: 20, within: 74 },
    measure: pgdaRow('sun65', 'sun', h),
  })),
  ...([2, 0] as const).map((h): RowSpec => ({
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: `Fracción de tiempo con Sol, panel a ${h} m, ${PERIOD_186}; 49 puntos al sur de 85°S (el producto de 60 m difiere del de 240 m 6,3 pp RMS)`,
    source: pgdaSource('sun85'), unit: 'pp', digits: 2, tolText: '±2 pp por punto', known: 85,
    limits: h === 2 ? { rms: 7.6, mae: 2.8, max: 48, within: 75 } : { rms: 4.0, mae: 2.0, max: 18.5, within: 75 },
    measure: pgdaRow('sun85', 'sun', h),
  })),
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: 'Definición igualada (motor, no caso de uso): solo el DEM de 240 m, observador a 0 m, paso de 6 h, 18,6 años; 59 puntos de 85–80°S. Además, cada punto ±0,1 pp de su valor de la comparación de 2026-11',
    source: link('PGDA AVGVISIB_65S_240M_201608', PGDA.products.sun65.url) + ` (${PGDA.products.sun65.version}, 240 m), \`validation/fixtures/illumination.json\``,
    unit: 'pp', digits: 2, tolText: '±2 pp por punto', limits: { rms: 1.5, bias: 0.5 },
    measure: (r) => {
      const got = get<{ pairs: [number, number][]; regressions: string[] }>(r, { kind: 'illumination240' });
      if (!got) return NO_DEM;
      const points = ILLUM.points.map(([id, lat, lon]): PointMeta => ({ id, lat, lon }));
      return { kind: 'numeric', d: got.pairs.map(([a, b]) => a - b), ref: got.pairs.map(([, b]) => b), tol: 2, failures: got.regressions, points };
    },
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: `Fracción de tiempo con Sol en \`shackleton-rim\`, observador a 0 m, media de la huella de 60 m (36 puntos cada 10 m dentro del píxel que contiene el sitio, solo máscara) frente a ese píxel de PGDA, ${PERIOD_186}, paso de 1 h`,
    source: pgdaSource('sun85'), unit: 'pp', digits: 2, tolText: `±${String(FOOTPRINT_MAX_PP).replace('.', ',')} pp (huella frente a píxel)`,
    limits: { max: FOOTPRINT_MAX_PP }, measure: footprintRow,
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: '% del tiempo con Sol (visibilidad solar), observador a 2 m, 2017–2037; C1, C2, S1 y S2',
    source: GLASER_SRC(2) + ' (LOLA 20 m)', unit: 'pp', digits: 2, tolText: '±2 pp por punto',
    limits: { rms: 1.5, mae: 0.85, max: 2.9, within: 75 }, measure: glaserRow(2, 'vis'),
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: 'Iluminación media (fracción media del disco solar visible, /v1/rank), observador a 2 m, 2017–2037; C1, C2, S1 y S2',
    source: GLASER_SRC(2) + ' (LOLA 20 m)', unit: 'pp', digits: 2, tolText: '±2 pp por punto',
    limits: { rms: 1.2, mae: 0.75, max: 2.3, within: 75 }, measure: glaserRow(2, 'avg'),
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: 'Sombra continua más larga, observador a 2 m, 2017–2037; C1, C2 y S1',
    source: GLASER_SRC(2) + ' (LOLA 20 m)', unit: 'h', digits: 1, tolText: '±10 % por punto',
    limits: { max: 3, within: 100 }, measure: glaserRow(2, 'shadowH', (id) => id !== 'S2'),
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: 'Sombra continua más larga en S2 (−89,7815°, −155,30°), observador a 2 m, 2017–2037. La fila coincide con la tabla 2 del artículo (204,70°E: 82,1 %, 89,8 %, 65 h); no es sensibilidad a la posición, la medición está en `backend/README.md`',
    source: GLASER_SRC(2) + ' (LOLA 20 m)', unit: 'h', digits: 1, tolText: '±10 % por punto', known: 85,
    limits: { max: 35 }, measure: glaserRow(2, 'shadowH', (id) => id === 'S2'),
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: `% del tiempo con Sol, ${PUBLISHED_0M}`,
    source: GLASER_SRC(1) + ' (LOLA 20 m)', unit: 'pp', digits: 2, tolText: '±2 pp por punto', known: 86,
    limits: { rms: 21, max: 30 }, measure: glaserPublishedRow('vis'),
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: `Iluminación media, ${PUBLISHED_0M}`,
    source: GLASER_SRC(1) + ' (LOLA 20 m)', unit: 'pp', digits: 2, tolText: '±2 pp por punto', known: 86,
    limits: { rms: 22.5, max: 32 }, measure: glaserPublishedRow('avg'),
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: `Sombra continua más larga, ${PUBLISHED_0M}`,
    source: GLASER_SRC(1) + ' (LOLA 20 m)', unit: 'h', digits: 1, tolText: '±10 % por punto', known: 86,
    limits: { max: 540 }, measure: glaserPublishedRow('shadowH'),
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: `% del tiempo con Sol, ${BEST_0M}`,
    source: GLASER_SRC(1) + ' (LOLA 20 m)', unit: 'pp', digits: 2, tolText: '±2 pp por punto',
    limits: { rms: 4.2, max: 6.1 }, measure: glaserNearRow('vis'),
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: `Iluminación media, ${BEST_0M}`,
    source: GLASER_SRC(1) + ' (LOLA 20 m)', unit: 'pp', digits: 2, tolText: '±2 pp por punto',
    limits: { rms: 5, max: 7 }, measure: glaserNearRow('avg'),
  },
  {
    section: 'Iluminación con relieve (/v1/windows, /v1/rank; terrain=1)',
    what: `Sombra continua más larga, ${BEST_0M}`,
    source: GLASER_SRC(1) + ' (LOLA 20 m)', unit: 'h', digits: 1, tolText: '±10 % por punto',
    limits: { max: 95 }, measure: glaserNearRow('shadowH'),
  },
  // ---- /v1/horizon
  ...([2, 0] as const).map((h): RowSpec => ({
    section: 'Horizonte (/v1/horizon)',
    what: `Ángulo sólido del cielo visible, Ω = Σ (1 − sen h)·Δaz del perfil, observador a ${h} m; 101 puntos al sur de 65°S (validación indirecta: integra el perfil, no lo compara acimut a acimut)`,
    source: pgdaSource('skyv65'), unit: 'sr', digits: 3, tolText: '±0,1 sr por punto (1,7 % del valor medio)',
    limits: h === 2 ? { rms: 0.085, mae: 0.05, max: 0.5, within: 88 } : { rms: 0.095, mae: 0.06, max: 0.5, within: 81 },
    measure: skyRow(h),
  })),
  // ---- PSR
  {
    section: 'Sombra permanente (/v1/rank, terrain=1)',
    what: 'Puntos fuera de una PSR (12 a menos de 200 m de una) con Sol alguna vez y del interior (a más de 500 m del borde) sin Sol, 18,6 años, paso de 1 h, modo preciso, observador a 0 m',
    source: link('PGDA LPSR_80S_20MPP_ADJ', 'https://pgda.gsfc.nasa.gov/products/90') + ' (Barker et al. 2023, 20 m)', unit: 'puntos', digits: 0,
    tolText: 'clasificación exacta', limits: { within: 100 },
    measure: (r) => {
      const got = get<{ rows: [string, 0 | 1, number][] }>(r, { kind: 'psr' });
      if (!got) return NO_CAP;
      const points = got.rows.map(([id, psr, f], i): PointMeta => ({ id: `${id}, ${psr ? 'dentro' : 'fuera'} de PSR: Sol el ${formatNumber(f * 100, 2)} % del tiempo`, lat: PSR.points[i][1], lon: PSR.points[i][2] }));
      return { kind: 'check', ok: got.rows.map(([, psr, f]) => (f > 0) === (psr === 0)), failures: got.rows.filter(([, psr, f]) => (f > 0) !== (psr === 0)).map(([id]) => id), points };
    },
  },
  // ---- slope
  {
    section: 'Pendiente (slope=1 en /v1/*)',
    what: 'Con LDRM en caché, el valor devuelto es el del producto (bases 100 m y 400 m)',
    source: link('PGDA LDRM_80S_50MPP_ADJ_SLP_100M/400M', 'https://pgda.gsfc.nasa.gov/products/90') + ' (Barker et al. 2023)', unit: '°', digits: 4,
    tolText: '6e-4° por punto (3 decimales del fixture)', limits: { max: 6e-4, within: 100 },
    measure: (r) => {
      const s = slope(r);
      if (typeof s === 'string') return s;
      return s.hasLdrm ? { kind: 'numeric', d: s.ldrmErrors, tol: 6e-4, points: s.ldrmPoints.map(([lat, lon, ref]) => slopePoint(lat, lon, ref)) } : 'falta LDRM en terrain/cache/ldrm (node scripts/fetch-dem.ts --slope)';
    },
  },
  ...([[100, 'win100', 0.7, 1], [400, 'win400', 0.3, 0.5]] as const).map(([base, key, rms, tol]): RowSpec => ({
    section: 'Pendiente (slope=1 en /v1/*)',
    what: `Ajuste al DEM de 20 m (sin LDRM), base de ${base} m; 240 puntos de las ventanas de 20 m. Además, cada punto ±0,01° de su valor de 2026-11`,
    source: link(`PGDA LDRM 50 m, base ${base} m`, 'https://pgda.gsfc.nasa.gov/products/90'), unit: '°', digits: 2, tolText: `±${String(tol).replace('.', ',')}° por punto`,
    limits: { rms },
    measure: (r) => {
      const s = slope(r);
      if (typeof s === 'string') return s;
      const points = SLOPE.win.map(([lat, lon, p100, p400]): PointMeta => slopePoint(lat, lon, base === 100 ? p100 : p400));
      return s.has20m ? { kind: 'numeric', d: s[key], tol, failures: s.regressions.filter((x) => !x.includes(' 800 m')), points } : 'faltan las ventanas de 20 m (node scripts/fetch-dem.ts --catalog)';
    },
  })),
  {
    section: 'Pendiente (slope=1 en /v1/*)',
    what: 'Ajuste al DEM de 160 m, base de 800 m; 93 puntos del casquete de 80°S. Además, cada punto ±0,01° de su valor de 2026-11',
    source: link('PGDA LDRM 50 m, base 800 m', 'https://pgda.gsfc.nasa.gov/products/90'), unit: '°', digits: 2, tolText: '±0,5° por punto',
    limits: { rms: 0.3 },
    measure: (r) => {
      const s = slope(r);
      if (typeof s === 'string') return s;
      const points = SLOPE.cap.map(([lat, lon, , p800]): PointMeta => slopePoint(lat, lon, p800));
      return s.hasCap ? { kind: 'numeric', d: s.cap800, tol: 0.5, failures: s.regressions.filter((x) => x.includes(' 800 m')), points } : NO_CAP;
    },
  },
  {
    section: 'Pendiente (slope=1 en /v1/*)',
    what: 'Base de 100 m con el DEM de 160 m: subestimada, ninguna cuenta como apta (`meetsMaxSlope: null`); con LDRM, la respuesta de LDRM',
    source: link('PGDA LDRM 50 m, base 100 m', 'https://pgda.gsfc.nasa.gov/products/90'), unit: 'puntos', digits: 0, tolText: 'sin falsos aptos', limits: { within: 100 },
    measure: (r) => {
      const s = slope(r);
      if (typeof s === 'string') return s;
      return s.hasCap ? { kind: 'check', ok: s.capFalseApt, points: SLOPE.cap.map(([lat, lon]) => ({ id: `${lat}, ${lon}`, lat, lon })) } : NO_CAP;
    },
  },
  // ---- catalogue and missions
  {
    section: 'Catálogo (/v1/sites) y misiones reales (/v1/windows)',
    what: 'Coordenadas de los 14 sitios de misiones del catálogo; |d| = distancia al valor oficial',
    source: `${link('NSSDC', MISSIONS.coordinates.rows[0][3])} (Apollo) y ${link('LROC/ASU', 'https://lroc.im-ldi.com/images')} (resto)`, unit: 'm', digits: 1,
    tolText: 'según la precisión publicada: 5–155 m', limits: { within: 100 },
    measure: (r) => {
      const c = missions(r).coordinates;
      const points = MISSIONS.coordinates.rows.map(([id, lat, lon]): PointMeta => ({ id, lat, lon }));
      return { kind: 'numeric', d: c.map((x) => x.distM), tol: c.map((x) => x.tolM), signed: false, points };
    },
  },
  {
    section: 'Catálogo (/v1/sites) y misiones reales (/v1/windows)',
    what: 'Blue Ghost M1: horas de luz desde el alunizaje (2025-03-02 08:34 UTC) hasta el ocaso (limb, sin relieve: no hay DEM fuera del polo sur)',
    source: link('Firefly, «346 hours of daylight»', MISSIONS.facts.blueghost1.source), unit: 'h', digits: 2,
    tolText: '±3 h (cifra redondeada, sin definición de ocaso; el relieve local no se modela)', limits: { max: 3 },
    measure: (r) => ({ kind: 'numeric', d: [missions(r).blueGhostDaylightH - MISSIONS.facts.blueghost1.daylightHours], ref: [MISSIONS.facts.blueghost1.daylightHours], tol: 3, points: [{ id: 'Blue Ghost M1' }] }),
  },
  {
    section: 'Catálogo (/v1/sites) y misiones reales (/v1/windows)',
    what: 'SLIM: el primer ocaso tras el alunizaje cae el 31 de enero de 2024 (hora de Japón)',
    source: link('JAXA (SLIM)', MISSIONS.facts.slim.source), unit: 'fechas', digits: 0, tolText: 'misma fecha', limits: { within: 100 },
    measure: (r) => ({ kind: 'check', ok: [missions(r).slimFirstSunsetJst === MISSIONS.facts.slim.firstNightDateJst], points: [{ id: `SLIM: primer ocaso el ${missions(r).slimFirstSunsetJst} (JST), referencia ${MISSIONS.facts.slim.firstNightDateJst}` }] }),
  },
  {
    section: 'Catálogo (/v1/sites) y misiones reales (/v1/windows)',
    what: 'Chandrayaan-3 con relieve (2 m): el ocaso llega después de que el lander se durmiera (2023-09-04 02:30 UTC)',
    source: link('ISRO (Chandrayaan-3)', MISSIONS.facts.chandrayaan3.source), unit: 'fechas', digits: 0, tolText: 'ocaso posterior', limits: { within: 100 },
    measure: (r) => ({ kind: 'check', ok: [Date.parse(missions(r).ch3.sunset) > Date.parse(MISSIONS.facts.chandrayaan3.landerSleep)], points: [{ id: `Chandrayaan-3: ocaso ${missions(r).ch3.sunset}, lander dormido ${MISSIONS.facts.chandrayaan3.landerSleep}` }] }),
  },
  {
    section: 'Catálogo (/v1/sites) y misiones reales (/v1/windows)',
    what: 'Chandrayaan-3 con relieve (2 m): orto siguiente frente al «next sunrise expected on September 22» (fecha sin hora ni definición de orto; a 69°S el Sol sube ~4° al día). Informativa',
    source: link('ISRO (Chandrayaan-3)', MISSIONS.facts.chandrayaan3.source), unit: 'h', digits: 1, tolText: '—', informative: true,
    measure: (r) => ({ kind: 'numeric', d: [(Date.parse(missions(r).ch3.sunrise) - Date.parse(`${MISSIONS.facts.chandrayaan3.expectedSunrise}T00:00:00Z`)) / 3600e3], tol: 24, points: [{ id: `Chandrayaan-3: orto ${missions(r).ch3.sunrise} frente a ${MISSIONS.facts.chandrayaan3.expectedSunrise}` }] }),
  },
  // ---- no official truth
  {
    section: 'Sin verdad oficial: consistencia interna',
    what: '/v1/rank frente a /v1/windows: fracción con Sol, con Tierra y con ambos; 7 sitios, 2 periodos de 30 días, con y sin relieve',
    source: 'sin verdad oficial', unit: 'pp', digits: 3, tolText: '±0,25 pp por par (rank muestrea cada hora; windows, al segundo)',
    limits: { max: 0.25, within: 100 },
    measure: (r) => ({ kind: 'numeric', d: consistency(r).rankVsWindowsPp, tol: 0.25, points: labelled(consistency(r).labels.rankVsWindows) }),
  },
  {
    section: 'Sin verdad oficial: consistencia interna',
    what: '/v1/landing-dates frente a /v1/rank en sus 3 mejores fechas: misma puntuación (im2-objetivo, enero de 2027, 14 días, relieve a 2 m)',
    source: 'sin verdad oficial', unit: 'puntos de score', digits: 3, tolText: '±0,01', limits: { max: 0.01, within: 100 },
    measure: (r) => ({ kind: 'numeric', d: consistency(r).landingVsRank, tol: 0.01, points: labelled(consistency(r).labels.landing) }),
  },
  {
    section: 'Sin verdad oficial: consistencia interna',
    what: '/v1/search frente a /v1/rank en sus 3 mejores puntos: misma puntuación (región de Mons Mouton, enero de 2027, 14 días)',
    source: 'sin verdad oficial', unit: 'puntos de score', digits: 3, tolText: '±0,01', limits: { max: 0.01, within: 100 },
    measure: (r) => ({ kind: 'numeric', d: consistency(r).searchVsRank, tol: 0.01, points: labelled(consistency(r).labels.search) }),
  },
];

// ---------------------------------------------------------------- evaluation

const mean = (x: readonly number[]): number => x.reduce((a, b) => a + b, 0) / x.length;

export function evaluate(spec: RowSpec, results: Results): RowResult {
  const empty = { n: null, bias: null, mae: null, rms: null, pctRef: null, max: null, within: null, signed: true, points: [] };
  const m = spec.measure(results);
  if (typeof m === 'string') return { spec, ...empty, status: '⏭️', note: `no ejecutado: ${m}` };
  let row: RowResult;
  const meta = (i: number): PointMeta => m.points?.[i] ?? { id: `#${i + 1}` };
  if (m.kind === 'check') {
    const points = m.ok.map((ok, i): PointResult => { const p = meta(i); return { id: p.id, lat: p.lat ?? null, lon: p.lon ?? null, ours: p.ours ?? null, ref: p.ref ?? null, d: null, tol: null, ok }; });
    row = { spec, ...empty, n: m.ok.length, within: (100 * m.ok.filter(Boolean).length) / m.ok.length, status: '✅', note: m.failures?.length ? `fallan: ${m.failures.join(', ')}` : '', points };
  } else {
    const abs = m.d.map(Math.abs);
    const tol = (i: number): number => (Array.isArray(m.tol) ? m.tol[i] : m.tol);
    const within = (i: number): boolean => abs[i] <= tol(i) + 1e-12;
    const rms = Math.sqrt(mean(m.d.map((x) => x * x)));
    const points = m.d.map((d, i): PointResult => {
      const p = meta(i), ref = m.ref?.[i] ?? p.ref ?? null;
      return { id: p.id, lat: p.lat ?? null, lon: p.lon ?? null, ours: p.ours ?? (ref === null ? null : ref + d), ref, d, tol: tol(i), ok: within(i) };
    });
    row = {
      spec, n: m.d.length, bias: m.signed === false ? null : mean(m.d), mae: mean(abs), rms,
      pctRef: m.ref ? (100 * rms) / mean(m.ref.map(Math.abs)) : null, max: Math.max(...abs),
      within: (100 * abs.filter((_, i) => within(i)).length) / abs.length, status: '✅', note: m.remark ?? '',
      signed: m.signed !== false, points,
    };
  }
  if (spec.informative) return { ...row, status: 'ℹ️' };
  const L = spec.limits ?? {};
  const over: string[] = [];
  const fmt = (x: number): string => formatNumber(x, Math.max(spec.digits, 2));
  if (L.rms !== undefined && row.rms !== null && row.rms > L.rms) over.push(`RMS ${fmt(row.rms)} > ${fmt(L.rms)}`);
  if (L.mae !== undefined && row.mae !== null && row.mae > L.mae) over.push(`MAE ${fmt(row.mae)} > ${fmt(L.mae)}`);
  if (L.bias !== undefined && row.bias !== null && Math.abs(row.bias) > L.bias) over.push(`|sesgo| ${fmt(Math.abs(row.bias))} > ${fmt(L.bias)}`);
  if (L.max !== undefined && row.max !== null && row.max > L.max) over.push(`máx. ${fmt(row.max)} > ${fmt(L.max)}`);
  if (L.within !== undefined && row.within !== null && row.within < L.within - 1e-9) over.push(`dentro ${row.within.toFixed(1)} % < ${L.within} %`);
  const failures = m.failures ?? [];
  if (m.kind === 'numeric' && failures.length) over.push(`regresión en ${failures.length} puntos: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`);
  if (over.length) return { ...row, status: '❌', note: [...over, ...(row.note ? [row.note] : [])].join('; ') };
  return { ...row, status: spec.known ? '⚠️' : '✅' };
}

// ---------------------------------------------------------------- report

export const formatNumber = (x: number, digits: number): string => {
  const s = Math.abs(x) < 1e-3 && x !== 0 && digits >= 4 ? x.toExponential(1) : x.toFixed(digits);
  return s.replace('.', ',').replace(/^-/, '−');
};
export const limitsText = (s: RowSpec): string => {
  const L = s.limits ?? {}, f = (x: number): string => formatNumber(x, Math.max(s.digits, x < 0.01 ? 4 : 2)).replace(/,?0+$/, '').replace(/,$/, '');
  const parts = [
    L.rms !== undefined ? `RMS ≤ ${f(L.rms)}` : '', L.mae !== undefined ? `MAE ≤ ${f(L.mae)}` : '', L.bias !== undefined ? `|sesgo| ≤ ${f(L.bias)}` : '',
    L.max !== undefined ? `máx. ≤ ${f(L.max)}` : '', L.within !== undefined ? `dentro ≥ ${L.within} %` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '';
};

/** A table cell: the vertical bars of |d| would split it. */
const cell = (s: string): string => s.replace(/\|/g, '\\|');

export function renderMarkdown(rows: readonly RowResult[], meta: { demVersion: string | null }): string {
  const v = (x: number | null, d: number): string => (x === null ? '—' : formatNumber(x, d));
  const status = (r: RowResult): string => {
    if (r.status === '⚠️') return `⚠️ #${r.spec.known}${r.note ? ` (${r.note})` : ''}`;
    if (r.status === '⏭️') return `⏭️ ${r.note}`;
    if (r.status === '❌') return `❌ ${r.note}`;
    if (r.status === 'ℹ️') return 'ℹ️ informativa';
    return r.note ? `✅ (${r.note})` : '✅';
  };
  const count = (s: RowResult['status']): number => rows.filter((r) => r.status === s).length;
  const lines = [
    '# Matriz de validación frente a fuentes oficiales',
    '',
    'Generado con `npm run validate -- --write`; no se edita a mano. Cada fila compara lo que calcula el motor, por los',
    'mismos casos de uso que sirven `/v1` y GraphQL (`backend/src/useCases.ts`), con una referencia oficial guardada en',
    '`backend/validation/fixtures/` (muestras pequeñas: nunca los productos completos). Mide, no ajusta: refleja el estado',
    'actual del cálculo. Regenerarlo en el mismo commit que cambie el cálculo; el diff dice qué se ha movido.',
    '',
    `DEM LOLA de la medición: \`${meta.demVersion ?? 'ninguno'}\`. Resumen: ${count('✅')} ✅, ${count('⚠️')} ⚠️, ${count('❌')} ❌, ${count('ℹ️')} ℹ️, ${count('⏭️')} ⏭️.`,
    '',
    '- **Columnas.** d = nuestro valor − referencia, por punto. Sesgo = media de d; MAE = media de |d|; RMS = raíz de la',
    '  media de d²; % ref = RMS dividido por el valor medio de la referencia; Máx = mayor |d|; % dentro = puntos con |d|',
    '  dentro de la tolerancia por punto. pp = puntos porcentuales; sr = estereorradianes.',
    '- **Estado.** ✅ dentro de todos sus límites; ⚠️ problema conocido, con su issue: sus límites son el valor actual, un',
    '  tope para que no empeore sin que se vea; ❌ fuera de algún límite (`npm run validate` falla); ℹ️ informativa, sin',
    '  aprobado ni suspenso; ⏭️ no ejecutada por falta de datos (el DEM no está en git: `node scripts/fetch-dem.ts`).',
    `- **Tolerancias.** ${TOLERANCE_RULE} Por punto: ±2 pp en fracciones de tiempo (la escala de los`,
    '  productos de PGDA y la diferencia de un píxel), ±10 % en la sombra más larga, ±0,1 sr en el cielo visible, el',
    '  presupuesto de `data/ACCURACY.md` (0,006°) en direcciones y la precisión publicada en coordenadas.',
    '',
    '| Endpoint · métrica | Referencia oficial | n | Sesgo | MAE | RMS | % ref | Máx | % dentro | Tolerancia · límites | Estado |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|',
  ];
  let section = '';
  for (const r of rows) {
    if (r.spec.section !== section) {
      section = r.spec.section;
      lines.push(`| **${section}** | | | | | | | | | | |`);
    }
    const d = r.spec.digits, u = r.spec.unit;
    const tol = [r.spec.tolText, limitsText(r.spec)].filter((x) => x && x !== '—').join('; ') || '—';
    lines.push(`| ${cell(r.spec.what)} (${u}) | ${r.spec.source} | ${r.n ?? '—'} | ${v(r.bias, d)} | ${v(r.mae, d)} | ${v(r.rms, d)} | ${r.pctRef === null ? '—' : `${formatNumber(r.pctRef, 1)} %`} | ${v(r.max, d)} | ${r.within === null ? '—' : `${formatNumber(r.within, 1)} %`} | ${cell(tol)} | ${cell(status(r))} |`);
  }
  lines.push(
    '',
    '## Cómo se mide',
    '',
    '- **Periodos y muestreo.** Como cada referencia: los mapas de PGDA promedian un ciclo nodal (18,6 años, aquí desde',
    '  2010-01-01) con paso horario, y Gläser et al. 2018 cubren 2017–2037 con paso de 1 h. Las fracciones de tiempo frente',
    '  a PGDA y a Leone salen de `/v1/rank` (una muestra por hora, como PGDA); la fila de consistencia comprueba que',
    '  `/v1/windows` da lo mismo (±0,25 pp). Frente a Gläser, el % con Sol y la sombra más larga salen de `/v1/windows`',
    '  (ortos y ocasos al segundo) y la iluminación media, de `/v1/rank`. La API limita un intervalo a 366 días (rank, a',
    '  120): los casos de uso no, y el periodo entero va en una sola llamada.',
    '- **Puntos de PGDA.** Los sitios del catálogo al sur de 65°S y una malla de 8 latitudes (70°S a 89,3°S) × 12 longitudes,',
    '  con el píxel más cercano de cada producto (`node validation/fetch-fixtures.ts` los vuelve a muestrear desde imbrium.mit.edu).',
    '  Los sitios del catálogo se piden como `site=<id>` (máscara del catálogo si la tiene) y el resto, por coordenadas.',
    '- **Alturas.** 2 m es la altura por defecto de la API; 0 m es la definición de los mapas de PGDA y de la tabla 1 de Gläser.',
    '  Por debajo de 1 m la API ya avisa (`low_observer_height`).',
    '- **Sin relieve fuera del polo sur.** Las filas de misiones al norte de 60°S (Blue Ghost, SLIM) usan el horizonte esférico.',
    '',
    '## Qué no cubre',
    '',
    '- La tabla de elevaciones del Sol de «Working on the Moon» (ALSJ) no es referencia de aprobado o suspenso: discrepa de',
    '  JPL Horizons hasta 2° (calculada en 2008), y Horizons coincide con el motor a 0,002°. Sale como fila informativa.',
    '- Ortos y ocasos frente a Horizons, sitio a sitio y modo a modo: en `data/ACCURACY.md` (`npm run accuracy`).',
    '- Los valores de Mazarico et al. 2011 que cita la tabla 1 de Gläser (240 m), el polo norte, el producto de 120 m',
    '  (75S) y `/v1/light-map` y `/v1/best-landings` (mismas máscaras y la misma evaluación que `/v1/rank`).',
    '- `/v1/horizon` se valida integrado (ángulo sólido), no acimut a acimut: no hay un perfil oficial publicado.',
    '- Las misiones con fecha y sin hora (SLIM, Chandrayaan-3) solo se comprueban como fechas.',
    '',
  );
  return lines.join('\n');
}
