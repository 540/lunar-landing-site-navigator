// Summary of the measured errors of the engine, for the "Cómo sabemos que es correcto" section of the web
// (web/assets/validation-summary.json, read by web/js/views/sources.js). Every figure is computed here, none is typed:
//
//   - JPL Horizons: the engine of today against fixtures/horizons.json (direction) and fixtures/horizons-events.json
//     (rises and sets), with the same functions as the tests and `npm run accuracy` (accuracy.ts).
//   - PGDA: the pairs (PGDA value, engine value) stored in backend/validation/fixtures/*.json. The engine values there
//     are those of the comparison the fixture names; `npm run validate` (which needs the LOLA DEM) checks that the
//     engine of today still gives them (± 0.01° of slope, ± 0.1 pp of illumination, the same shadow verdict).
//   - Known discrepancies: the ⚠️ rows of VALIDATION.md (the last measurement saved by `cd backend && npm run validate
//     -- --write`, which needs the LOLA DEM), each with its issue. When an issue is fixed its row turns ✅ there and
//     leaves this block on the next --write.
//
//   npm run validation-summary              prints the summary
//   npm run validation-summary -- --write   also saves web/assets/validation-summary.json
//   npm run validation-summary -- --check   fails if the saved file differs (no DEM needed, ~30 s)
//
// test/validation-summary.test.ts checks the saved file in `npm test`, without the rises and sets (too slow there).
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { BUDGET_DEG, compareEvents, directionErrors, directionReference, eventsReference, instantOf, percentile } from './accuracy.ts';
import type { Body, Mode } from '../../backend/src/types.ts';

export const SUMMARY_URL = new URL('../../web/assets/validation-summary.json', import.meta.url);
const PGDA_FIXTURES = new URL('../../backend/validation/fixtures/', import.meta.url);
export const VALIDATION_URL = new URL('../../VALIDATION.md', import.meta.url);
const MODES: Mode[] = ['limb', 'center', 'full'];
const BODIES: Body[] = ['sun', 'earth'];
// Latitude bands of the rises and sets, the ones of the table in data/README.md («Limitaciones»): the time error
// grows towards the poles, so one row for all the sites would hide it.
const BANDS = [{ id: 'low', maxAbsLat: 75 }, { id: 'near-polar', maxAbsLat: 87 }, { id: 'polar', maxAbsLat: 90 }];

const round = (x: number, decimals: number): number => Number(x.toFixed(decimals));
/** First URL and product name (in brackets) in the `source` field of a fixture, and the month of the comparison its description names. */
const urlOf = (source: string): string => source.match(/https?:\/\/\S+/)![0];
const productOf = (source: string): string => source.match(/\(([^)]+)\)/)![1];
const comparisonOf = (description: string): string => description.match(/comparación del (\d{4}-\d{2})/)![1];

export interface PairStats { points: number; rms: number; bias: number; maxAbs: number }
/** Root mean square, bias and worst case of (engine − reference), scaled by `k` and rounded. */
function pairStats(pairs: readonly (readonly [number, number])[], k: number, decimals: number): PairStats {
  const d = pairs.map(([engine, reference]) => (engine - reference) * k);
  return {
    points: d.length,
    rms: round(Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length), decimals),
    bias: round(d.reduce((s, x) => s + x, 0) / d.length, decimals),
    maxAbs: round(Math.max(...d.map(Math.abs)), decimals),
  };
}

/** Direction of the Sun and the Earth against Horizons: every point of fixtures/horizons.json, computed now. */
export function directionSummary() {
  const perSeries = directionReference.series.map((s) => ({ site: s.site, body: s.body, ...directionErrors(s) }));
  const points = perSeries.reduce((n, s) => n + s.points, 0);
  const worst = perSeries.reduce((a, b) => (b.maxDeg > a.maxDeg ? b : a));
  return {
    sourceUrl: 'https://ssd.jpl.nasa.gov/horizons/',
    reference: directionReference.source,
    fetchedAt: directionReference.fetchedAt,
    from: directionReference.start.slice(0, 10),
    to: instantOf(directionReference.count - 1).toISOString().slice(0, 10),
    sites: directionReference.sites.length,
    series: perSeries.length,
    points,
    rmsDeg: round(Math.sqrt(perSeries.reduce((s, e) => s + e.rmsDeg ** 2 * e.points, 0) / points), 4),
    maxDeg: round(worst.maxDeg, 4),
    worst: { site: worst.site, body: worst.body },
    budgetDeg: BUDGET_DEG,
  };
}

/** PGDA products: statistics of the pairs stored in backend/validation/fixtures. */
export function pgdaSummary() {
  const fixture = <T>(name: string): T & { description: string; source: string } => JSON.parse(readFileSync(new URL(name, PGDA_FIXTURES), 'utf8'));
  const slope = fixture<{ cap: number[][]; win: number[][] }>('slope.json');
  const illumination = fixture<{ points: [string, number, number, number, number][] }>('illumination.json');
  const psr = fixture<{ points: [string, number, number, 0 | 1, boolean, number][] }>('psr.json');
  const outside = psr.points.filter((p) => p[3] === 0), inside = psr.points.filter((p) => p[3] === 1);
  return {
    slope: {
      sourceUrl: urlOf(slope.source), product: productOf(slope.source), comparison: comparisonOf(slope.description),
      // win: lat, lon, LDRM 100 m, LDRM 400 m, engine 100 m, engine 400 m. cap: lat, lon, LDRM 100 m, LDRM 800 m, engine 800 m.
      window100m: pairStats(slope.win.map((r) => [r[4], r[2]] as const), 1, 2),
      window400m: pairStats(slope.win.map((r) => [r[5], r[3]] as const), 1, 2),
      cap800m: pairStats(slope.cap.map((r) => [r[4], r[3]] as const), 1, 2),
    },
    illumination: {
      sourceUrl: urlOf(illumination.source), product: productOf(illumination.source), comparison: comparisonOf(illumination.description),
      // Fractions of time (0–1) turned into percentage points.
      sunFraction: pairStats(illumination.points.map((p) => [p[4], p[3]] as const), 100, 2),
    },
    permanentShadow: {
      sourceUrl: urlOf(psr.source), product: productOf(psr.source), comparison: comparisonOf(psr.description),
      outside: { points: outside.length, agree: outside.filter((p) => p[5] > 0).length },
      inside: { points: inside.length, agree: inside.filter((p) => p[5] === 0).length },
    },
  };
}

export interface KnownDiscrepancy {
  /** The text of the row in VALIDATION.md, as is (Spanish): it ties the entry to its row. */
  what: string;
  metric: 'sunFraction' | 'earthFraction' | 'meanIllumination' | 'longestShadow';
  /** What stands at `heightM` above the ground in the comparison, as the row says it: a panel, an antenna or an observer. */
  subject: 'panel' | 'antenna' | 'observer';
  heightM: number;
  /** Where: the points south of a latitude (PGDA grid) or named sites (Gläser et al. 2018), with the coordinates of a lone site. */
  where: { southOfDeg: number } | { sites: string[]; lat?: number; lon?: number };
  /** A lunar nodal cycle from a date (PGDA) or a span of years (Gläser et al. 2018). */
  period: { from: string; years: number } | { from: string; to: string };
  reference: { name: string; table: number | null; url: string; detail: string };
  unit: 'pp' | 'h';
  points: number;
  bias: number;
  rms: number;
  maxAbs: number;
  issue: number;
  /** The context of the trailing parenthesis of the row: how much the reference products differ between themselves
   *  (PGDA 60 m against 240 m) or how much the sun fraction strays at the same site. */
  note?: { kind: 'productGap'; resolutionM: number; otherResolutionM: number; rms: number } | { kind: 'sunFraction'; bias: number }
    | { kind: 'nearGround'; radiusM: number; minPercent: number; maxPercent: number };
}

/** A number as VALIDATION.md writes it (Spanish: decimal comma, «−» for minus). */
const mdNumber = (cell: string): number => {
  const x = Number(cell.trim().replace('−', '-').replace(',', '.'));
  if (!Number.isFinite(x)) throw new Error(`VALIDATION.md: «${cell}» no es un número`);
  return x;
};
/** Cells of a row of a markdown table, keeping the escaped pipes (\|) inside a cell. */
const mdCells = (line: string): string[] => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());

const METRICS: [RegExp, KnownDiscrepancy['metric']][] = [
  [/^Fracción de tiempo con la Tierra/, 'earthFraction'],
  [/^(Fracción de tiempo|% del tiempo) con Sol/, 'sunFraction'],
  [/^Iluminación media/, 'meanIllumination'],
  [/^Sombra continua más larga/, 'longestShadow'],
];

const SUBJECTS: Record<string, KnownDiscrepancy['subject']> = { panel: 'panel', antena: 'antenna', observador: 'observer' };

/** The context of a ⚠️ row (its trailing parenthesis, or the sentence after its sites), in structured form; undefined if it
 * has a shape this parser does not know. */
function noteOf(text: string): KnownDiscrepancy['note'] {
  const gap = text.match(/^el producto de (\d+) m difiere del de (\d+) m (−?[\d,]+) pp RMS$/);
  if (gap) return { kind: 'productGap', resolutionM: Number(gap[1]), otherResolutionM: Number(gap[2]), rms: mdNumber(gap[3]) };
  const sun = text.match(/^la fracción con Sol solo se desvía (−?[\d,]+) pp$/);
  if (sun) return { kind: 'sunFraction', bias: mdNumber(sun[1]) };
  const near = text.match(/^A ras de suelo el resultado cambia decenas de puntos en metros: a ±(\d+) m el % con Sol va de (\d+) a (\d+) %$/);
  if (near) return { kind: 'nearGround', radiusM: Number(near[1]), minPercent: Number(near[2]), maxPercent: Number(near[3]) };
  return undefined;
}

/** One ⚠️ row of VALIDATION.md, in structured form; throws if the row has a shape this parser does not know. */
function knownRow(line: string): KnownDiscrepancy {
  const [whatCell, referenceCell, n, bias, , rms, , max, , , status] = mdCells(line);
  const fail = (what: string): never => { throw new Error(`VALIDATION.md: no sé leer ${what} de la fila ⚠️ «${whatCell}»`); };
  const unit = whatCell.match(/\((pp|h)\)$/)?.[1] as KnownDiscrepancy['unit'] | undefined ?? fail('la unidad');
  const what = whatCell.replace(/\s*\((pp|h)\)$/, '');
  const metric = METRICS.find(([re]) => re.test(what))?.[1] ?? fail('la métrica');
  const height = what.match(/(antena|panel|observador) a (\d+) m/) ?? fail('la altura');
  const subject = SUBJECTS[height[1]], heightM = Number(height[2]);
  const south = what.match(/al sur de (\d+)°S/);
  const sites = what.match(/; ([A-Z]\d?(?:, [A-Z]\d?)* y [A-Z]\d?)(?: \(|\. |$)/);
  const site = what.match(/ en ([A-Z]\d?) \((−?[\d,]+)°, (−?[\d,]+)°\)/);
  const where = south ? { southOfDeg: Number(south[1]) }
    : sites ? { sites: sites[1].split(/, | y /) }
    : site ? { sites: [site[1]], lat: mdNumber(site[2]), lon: mdNumber(site[3]) }
    : fail('el lugar');
  const nodal = what.match(/(\d+,\d) años desde (\d{4}-\d{2}-\d{2})/), span = what.match(/\b(\d{4})–(\d{4})\b/);
  const period = nodal ? { from: nodal[2], years: mdNumber(nodal[1]) } : span ? { from: span[1], to: span[2] } : fail('el periodo');
  const ref = referenceCell.match(/^\[([^\]]+)\]\((https?:[^)]+)\)\s*(?:\(([^)]*)\))?/) ?? fail('la referencia');
  const table = ref[1].match(/^(.*), tabla (\d+)$/);
  const issue = Number(status.match(/#(\d+)/)?.[1] ?? fail('la issue'));
  // The context: a trailing parenthesis or, after a list of sites, a sentence (#86).
  const trailing = what.match(/ \(([^()]*)\)$/)?.[1] ?? (sites ? what.match(/ y [A-Z]\d?\. (.+)$/)?.[1] : undefined);
  // The ±N m range of the #86 rows comes in the status cell: «⚠️ [#86](…) (a ±10 m el % con Sol va de 41,0 a 84,6 %)».
  const near = status.match(/\(a ±(\d+) m el % con Sol va de (−?[\d,]+) a (−?[\d,]+) %\)/);
  const note = trailing !== undefined ? noteOf(trailing) ?? fail('la nota del final')
    : near ? { kind: 'nearGround' as const, radiusM: Number(near[1]), minPercent: mdNumber(near[2]), maxPercent: mdNumber(near[3]) }
    : undefined;
  return {
    what, metric, subject, heightM, where, period,
    reference: { name: table ? table[1] : ref[1], table: table ? Number(table[2]) : null, url: ref[2], detail: ref[3] ?? '' },
    unit, points: mdNumber(n), bias: mdNumber(bias), rms: mdNumber(rms), maxAbs: mdNumber(max), issue,
    ...(note ? { note } : {}),
  };
}

/** Rows of the validation matrix (VALIDATION.md) marked ⚠️: where the engine strays from the reference, with its issue. */
export function knownDiscrepancies(markdown = readFileSync(VALIDATION_URL, 'utf8')): KnownDiscrepancy[] {
  return markdown.split('\n').filter((l) => l.startsWith('|') && mdCells(l).at(-1)!.startsWith('⚠️')).map(knownRow);
}

interface SiteEvents { siteId: string; body: Body; seconds: number[]; equivalentDeg: number; missing: number; extra: number }

/** Rises and sets of one site against Horizons, the three modes together (runs in a worker). */
function siteEvents(siteId: string): SiteEvents[] {
  const [startMs, endMs] = [Date.parse(eventsReference.start), Date.parse(eventsReference.end)];
  const perMode = MODES.map((mode) => compareEvents(siteId, mode, startMs, endMs));
  return BODIES.map((body) => {
    const pairs = perMode.flatMap((m) => m[body].pairs);
    return {
      siteId, body,
      seconds: pairs.map((p) => Math.abs(p.errorSeconds)),
      equivalentDeg: Math.max(0, ...pairs.map((p) => p.equivalentDeg)),
      missing: perMode.reduce((n, m) => n + m[body].missing.length, 0),
      extra: perMode.reduce((n, m) => n + m[body].extra.length, 0),
    };
  });
}

/** Rises and sets against Horizons: every catalogue site, mode and year of fixtures/horizons-events.json, by band. */
export async function eventsSummary() {
  const queue = eventsReference.sites.map((s) => s.id);
  const results: SiteEvents[] = [];
  const runNext = async (): Promise<void> => {
    for (let siteId = queue.shift(); siteId; siteId = queue.shift()) {
      results.push(...await new Promise<SiteEvents[]>((resolve, reject) => {
        new Worker(new URL(import.meta.url), { workerData: { validationSummarySite: siteId } }).once('message', resolve).once('error', reject);
      }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), queue.length) }, runNext));

  const absLat = (id: string): number => Math.abs(eventsReference.sites.find((s) => s.id === id)!.lat);
  const bandOf = (id: string): string => BANDS.find((b) => absLat(id) <= b.maxAbsLat)!.id;
  const groups = BANDS.flatMap((band) => BODIES.map((body) => {
    const rows = results.filter((r) => r.body === body && bandOf(r.siteId) === band.id);
    const siteIds = eventsReference.sites.map((s) => s.id).filter((id) => bandOf(id) === band.id); // fixture order: stable
    const seconds = rows.flatMap((r) => r.seconds).sort((a, b) => a - b);
    const worst = rows.reduce((a, b) => (Math.max(0, ...b.seconds) > Math.max(0, ...a.seconds) ? b : a));
    return {
      band: band.id, body, sites: siteIds,
      minAbsLat: round(Math.min(...siteIds.map(absLat)), 2), maxAbsLat: round(Math.max(...siteIds.map(absLat)), 2),
      events: seconds.length,
      missing: rows.reduce((n, r) => n + r.missing, 0), extra: rows.reduce((n, r) => n + r.extra, 0),
      ...(seconds.length ? {
        medianSeconds: Math.round(percentile(seconds, 0.5)), p99Seconds: Math.round(percentile(seconds, 0.99)),
        maxSeconds: Math.round(seconds.at(-1)!), worstSite: worst.siteId,
        maxEquivalentDeg: round(Math.max(...rows.map((r) => r.equivalentDeg)), 4),
      } : {}),
    };
  }));
  return {
    sourceUrl: 'https://ssd.jpl.nasa.gov/horizons/',
    reference: eventsReference.source,
    fetchedAt: eventsReference.fetchedAt,
    from: eventsReference.start.slice(0, 10), to: eventsReference.end.slice(0, 10),
    modes: MODES, budgetDeg: BUDGET_DEG.max,
    groups,
  };
}

export async function buildSummary() {
  return {
    generatedBy: 'cd data && npm run validation-summary -- --write',
    horizons: { direction: directionSummary(), events: await eventsSummary() },
    pgda: pgdaSummary(),
    knownDiscrepancies: knownDiscrepancies(),
  };
}

if (!isMainThread && (workerData as { validationSummarySite?: string } | null)?.validationSummarySite) {
  parentPort!.postMessage(siteEvents((workerData as { validationSummarySite: string }).validationSummarySite));
} else if (import.meta.main) {
  const text = JSON.stringify(await buildSummary(), null, 2) + '\n';
  console.log(text);
  if (process.argv.includes('--write')) writeFileSync(SUMMARY_URL, text);
  if (process.argv.includes('--check') && readFileSync(SUMMARY_URL, 'utf8') !== text) {
    console.error('✖ web/assets/validation-summary.json no coincide: regenéralo con `npm run validation-summary -- --write`');
    process.exitCode = 1;
  }
}
