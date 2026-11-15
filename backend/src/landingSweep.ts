// Landing-date sweep: for one site, how a mission of N days turns out depending on the landing date, and which are the
// best landing windows.
//
// Why: the variable that decides the energy of a mission the most is the landing date relative to local sunrise. Landing
// at sunrise gives ~14 days of Sun; landing at sunset, a mission almost in the dark. At the pole the season and the
// Earth's libration matter too. This lets the tool choose the pair (site, window), not only the site.
//
// How (performance): the Sun/Earth vectors and the per-sample flags (Sun visible, Earth visible, night, energy) are
// computed ONCE over [first date, last date + mission] (plus the full-night look-around when `fullNight` is on). Each
// candidate date is then a sliding window over those samples:
//   - counts (Sun, Earth, both) come from prefix sums (integers: exact);
//   - energy, the Sun elevation range and the longest streaks are recomputed over the window only, in the same order as
//     evaluateCell, so every date gives exactly what evaluateCell gives over sampleVectors(date, date + mission, step).
// Cost: one ephemeris evaluation per sample (the expensive part) plus dates × samples-per-mission cheap operations.
//
// The result of each date is built with search.ts → cellResult, the same function evaluateCell uses.
import { moonFixedVectors, siteFrame, topocentric } from './ephemeris.ts';
import { fastModeWarning, isCatalogMask, refineText, resolveTerrain } from './horizon.ts';
import { discEdge, fractionEdgeY, fractionOver, horizonAt, margin, marginOver } from './visibility.ts';
import { panelFactor, panelOption } from './panel.ts';
import { BATTERY_DEFAULTS, NIGHT_EXTENSION_LIMIT_DAYS } from './night.ts';
import { CONSTRAINTS, constraintViolations } from './constraints.ts';
import { cellMasks, cellResult, heightsText, normalizeWeights, resolveNightOptions, resolveSlope } from './search.ts';
import { siteSlope } from './terrain/slope.ts';
import type {
  Cell, CellResult, HorizonMask, LandingDate, LatLon, Terrain, LandingSweep, LandingSweepOptions, LandingWindow, Panel, RangeStats, SlopeRequest,
} from './types.ts';

const HOUR_MS = 3600e3;
const DAY_MS = 86400e3;
const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;
const iso = (ms: number): string => new Date(ms).toISOString();

/** Without constraints nor minScore, a date is "good" when it reaches this fraction of the best score of the sweep. */
export const DEFAULT_GOOD_FRACTION_OF_BEST = 0.9;

/** Engine limits (the HTTP layers may be stricter). */
export const SWEEP_LIMITS = {
  maxRangeDays: 400,
  maxDates: 10000,
  minDateStepMs: HOUR_MS,
  maxMissionDays: 60,
  /** dates × samples per mission: the cheap part, but it grows fast with a 1 h date step and a fine sample step. */
  maxWork: 20e6,
};

/** Invalid sweep option (the HTTP layers answer it with a 400). */
export class SweepOptionError extends Error {}
const fail = (msg: string): never => { throw new SweepOptionError(msg); };

/** Validates the constraints (same names as the evals scenarios). */
function checkConstraintNames(c: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(c)) {
    if (!CONSTRAINTS[k]) fail(`Restricción desconocida: ${k}. Válidas: ${Object.keys(CONSTRAINTS).join(', ')}`);
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(`La restricción ${k} debe ser un número`);
  }
}

const statsOf = (xs: readonly number[], d: number): RangeStats => ({
  min: round(Math.min(...xs), d),
  mean: round(xs.reduce((a, b) => a + b, 0) / xs.length, d),
  max: round(Math.max(...xs), d),
});

/**
 * Sweeps the candidate landing dates [startMs, endMs] every `dateStepMs` for a mission of `missionDays` sampled every
 * `stepMs`. `dateStepMs` and the mission length must be multiples of `stepMs` (every window then falls on the same grid
 * of samples, and each date matches evaluateCell exactly).
 */
export function sweepLandingDates(site: Cell, o: LandingSweepOptions): LandingSweep {
  const t0 = performance.now();
  const { startMs, endMs, dateStepMs, stepMs, missionDays, mode } = o;
  const earthMode = o.earthMode ?? mode;
  const earthMinElevationDeg = o.earthMinElevationDeg ?? 0;
  const constraints = o.constraints ?? {};
  checkConstraintNames(constraints);
  const hasConstraints = Object.keys(constraints).length > 0;
  const minScore = o.minScore ?? null;
  if (minScore !== null && !(Number.isFinite(minScore) && minScore >= 0 && minScore <= 100)) fail('minScore debe ser un número entre 0 y 100');
  const top = o.top ?? 10;
  if (!Number.isInteger(top) || top < 1 || top > 100) fail('top debe ser un entero entre 1 y 100');

  if (!(Number.isFinite(startMs) && Number.isFinite(endMs)) || endMs < startMs) fail('end debe ser igual o posterior a start');
  if (endMs - startMs > SWEEP_LIMITS.maxRangeDays * DAY_MS) fail(`El rango de fechas de alunizaje es de ${SWEEP_LIMITS.maxRangeDays} días como máximo`);
  if (!(Number.isInteger(stepMs) && stepMs > 0)) fail('step debe ser un número entero de milisegundos mayor que 0');
  if (!(dateStepMs >= SWEEP_LIMITS.minDateStepMs)) fail(`dateStep debe ser de al menos ${SWEEP_LIMITS.minDateStepMs / HOUR_MS} h`);
  if (dateStepMs % stepMs !== 0) fail('dateStep debe ser múltiplo de step (paso de muestreo)');
  if (!(missionDays > 0 && missionDays <= SWEEP_LIMITS.maxMissionDays)) fail(`days (duración de la misión) debe estar entre 0 y ${SWEEP_LIMITS.maxMissionDays} días`);
  const missionMs = missionDays * DAY_MS;
  if (missionMs % stepMs !== 0) fail('La duración de la misión (days) debe ser múltiplo de step');
  const nDates = Math.floor((endMs - startMs) / dateStepMs) + 1;
  if (nDates > SWEEP_LIMITS.maxDates) fail(`Demasiadas fechas (${nDates}); el máximo es ${SWEEP_LIMITS.maxDates}. Aumenta dateStep o reduce el rango`);
  const n = missionMs / stepMs + 1; // samples per mission, endpoint included (as sampleVectors)
  if (nDates * n > SWEEP_LIMITS.maxWork) fail(`Demasiado cálculo (${nDates} fechas × ${n} muestras por misión); aumenta dateStep o step, o acorta la misión o el rango`);

  const weights = normalizeWeights(o.weights);
  const terrain = resolveTerrain(o.terrain, 'precise');
  // maxBatteryKg turns the battery on with its defaults (as in the evals scenarios).
  const night = resolveNightOptions({ ...o, battery: o.battery ?? (constraints.maxBatteryKg !== undefined ? { ...BATTERY_DEFAULTS } : undefined) });
  const panelOpt = panelOption(o.panel);
  const panel: Panel = panelOpt.panel ?? 'tracking';
  const tracking = panel === 'tracking';
  const nightMinSunFraction = night.opts.nightMinSunFraction ?? 0;
  const fullNight = night.opts.fullNight === true;
  // Slope of the site (the same for every date). maxSlopeDeg turns it on with the default baseline.
  let slopeReq: SlopeRequest | null;
  try {
    slopeReq = resolveSlope(o.slope ?? (constraints.maxSlopeDeg !== undefined ? {} : null));
  } catch (e) { return fail((e as Error).message); }
  const slope = slopeReq ? siteSlope(site.lat, site.lon, { baselineM: slopeReq.baselineM, ...(constraints.maxSlopeDeg !== undefined ? { maxSlopeDeg: constraints.maxSlopeDeg } : {}) }) : null;
  const slopeMetric = slope?.slopeDeg != null ? { slopeDeg: slope.slopeDeg } : {};

  // ---- 1. Samples, once: [first date − ext, last date + mission + ext] ----
  const frame = siteFrame(site);
  const { sun: mask, earth: earthMask } = cellMasks(site, terrain); // panel height (Sun) and antenna height (Earth)
  const ext = fullNight ? Math.floor((NIGHT_EXTENSION_LIMIT_DAYS * DAY_MS) / stepMs) : 0;
  const dateStride = dateStepMs / stepMs;
  const total = ext + (nDates - 1) * dateStride + n + ext;
  const origin = startMs - ext * stepMs;
  const e = new Float64Array(total), el = new Float64Array(total);
  const sunVis = new Uint8Array(total), earthVis = new Uint8Array(total), isNight = new Uint8Array(total);
  const tS = performance.now();
  const fracY = fractionEdgeY(nightMinSunFraction); // as evaluateCell: one Sun horizon per sample (hybrid horizon)
  for (let k = 0; k < total; k++) {
    const v = moonFixedVectors(new Date(origin + k * stepMs));
    const sun = topocentric(frame, v.sun, 'sun');
    const earth = topocentric(frame, v.earth, 'earth');
    const hSun = horizonAt(sun, mask, discEdge(sun, mode), sun.el + fracY * sun.radiusDeg);
    const sv = marginOver(sun, hSun, mode) > 0;
    const sunFrac = fractionOver(sun, hSun);
    sunVis[k] = sv ? 1 : 0;
    earthVis[k] = margin(earth, earthMask, earthMode, earthMinElevationDeg) > 0 ? 1 : 0;
    isNight[k] = (nightMinSunFraction > 0 ? sunFrac >= nightMinSunFraction : sv) ? 0 : 1;
    e[k] = tracking ? sunFrac : sunFrac * panelFactor(panel, sun.el);
    el[k] = sun.el;
  }
  const samplingMs = performance.now() - tS;

  // ---- 2. Prefix sums, night runs and next Sun change ----
  const sunCum = new Int32Array(total + 1), earthCum = new Int32Array(total + 1), bothCum = new Int32Array(total + 1);
  for (let k = 0; k < total; k++) {
    sunCum[k + 1] = sunCum[k] + sunVis[k];
    earthCum[k + 1] = earthCum[k] + earthVis[k];
    bothCum[k + 1] = bothCum[k] + (sunVis[k] & earthVis[k]);
  }
  // Night run ending at k (backwards from k) and starting at k (forwards): the full-night look-around of each window.
  const runEnd = new Int32Array(total), runStart = new Int32Array(total);
  if (fullNight) {
    for (let k = 0; k < total; k++) runEnd[k] = isNight[k] ? (k > 0 ? runEnd[k - 1] : 0) + 1 : 0;
    for (let k = total - 1; k >= 0; k--) runStart[k] = isNight[k] ? (k < total - 1 ? runStart[k + 1] : 0) + 1 : 0;
  }
  const nextSunChange = new Int32Array(total); // first index > k whose Sun visibility differs from k's (total = none)
  nextSunChange[total - 1] = total;
  for (let k = total - 2; k >= 0; k--) nextSunChange[k] = sunVis[k + 1] !== sunVis[k] ? k + 1 : nextSunChange[k + 1];

  // ---- 3. One window per landing date ----
  const h = stepMs / HOUR_MS;
  const opts = { stepMs, weights, terrain, fullNight, battery: night.opts.battery ?? null };
  const dates: LandingDate[] = [];
  let siteResult: CellResult | null = null;
  for (let i = 0; i < nDates; i++) {
    const s = ext + i * dateStride, end = s + n; // samples [s, end)
    let energy = 0, minSunEl = Infinity, maxSunEl = -Infinity;
    let nightRun = 0, maxNight = 0, noEarth = 0, maxNoEarth = 0, both = 0, maxBoth = 0, leadingNight = 0, leadingOpen = true;
    for (let k = s; k < end; k++) {
      energy += e[k];
      if (el[k] < minSunEl) minSunEl = el[k];
      if (el[k] > maxSunEl) maxSunEl = el[k];
      if (isNight[k]) {
        nightRun++;
        if (nightRun > maxNight) maxNight = nightRun;
        if (leadingOpen) leadingNight++;
      } else { nightRun = 0; leadingOpen = false; }
      if (earthVis[k]) noEarth = 0; else if (++noEarth > maxNoEarth) maxNoEarth = noEarth;
      if (sunVis[k] & earthVis[k]) { if (++both > maxBoth) maxBoth = both; } else both = 0;
    }
    const r = cellResult(site, mask, {
      n, energy, sunN: sunCum[end] - sunCum[s], earthN: earthCum[end] - earthCum[s], bothN: bothCum[end] - bothCum[s],
      maxNight, maxNoEarth, maxBoth, minSunEl, maxSunEl, leadingNight, trailingNight: nightRun,
    }, opts, (dir) => Math.min(ext, dir < 0 ? runEnd[s - 1] : runStart[end]));
    siteResult ??= r;
    const change = nextSunChange[s];
    // An uncertified slope never meets maxSlopeDeg (constraintViolations).
    const violations = hasConstraints ? constraintViolations({ ...r.metrics, ...slopeMetric }, constraints, slope) : [];
    dates.push({
      date: iso(startMs + i * dateStepMs),
      score: r.score,
      ...(hasConstraints ? { feasible: violations.length === 0, violations } : {}),
      metrics: r.metrics,
      ...(r.nightTruncated ? { nightTruncated: true as const } : {}),
      sun: { visibleAtLanding: sunVis[s] === 1, hoursToChange: change < end ? round((change - s) * h, 3) : null },
    });
  }

  // ---- 4. Summary: best and worst, good windows, statistics ----
  const byScore = dates.map((d, i) => ({ d, i })).sort((a, b) => b.d.score - a.d.score || a.i - b.i);
  const best = byScore.slice(0, top).map(({ d }, k) => ({ rank: k + 1, ...d }));
  const worst = byScore.slice(-top).reverse().map(({ d }, k) => ({ rank: dates.length - k, ...d }));
  const bestScore = byScore[0].d.score;
  const relativeToBest = !hasConstraints && minScore === null ? DEFAULT_GOOD_FRACTION_OF_BEST : null;
  const threshold = minScore ?? (relativeToBest !== null ? round(relativeToBest * bestScore, 2) : null);
  const isGood = (d: LandingDate): boolean => (d.feasible ?? true) && (threshold === null || d.score >= threshold);
  const goodWindows: LandingWindow[] = [];
  let open: LandingWindow | null = null;
  for (const d of dates) {
    if (!isGood(d)) { open = null; continue; }
    if (!open) {
      open = { start: d.date, end: d.date, durationDays: 0, dates: 0, best: { date: d.date, score: d.score } };
      goodWindows.push(open);
    }
    open.end = d.date;
    open.dates++;
    open.durationDays = round((Date.parse(open.end) - Date.parse(open.start)) / DAY_MS, 3);
    if (d.score > open.best.score) open.best = { date: d.date, score: d.score };
  }
  const goodCount = dates.filter(isGood).length;
  const r0 = siteResult!;
  return {
    kind: 'landing-dates',
    site: { lat: r0.lat, lon: r0.lon, ...(r0.id ? { id: r0.id, name: r0.name } : {}), ...(r0.horizon ? { horizon: r0.horizon } : {}), ...(r0.heightM !== undefined ? { heightM: r0.heightM } : {}), ...(r0.horizonSource ? { horizonSource: r0.horizonSource } : {}) },
    start: iso(startMs),
    end: dates.at(-1)!.date,
    dateStepHours: dateStepMs / HOUR_MS,
    missionDays,
    stepMinutes: stepMs / 60e3,
    mode,
    earthMode,
    weights,
    ...(hasConstraints ? { constraints } : {}),
    goodCriterion: { constraints: hasConstraints, minScore: threshold, relativeToBest },
    stats: {
      dates: dates.length,
      score: statsOf(dates.map((d) => d.score), 2),
      energy: statsOf(dates.map((d) => d.metrics.energy), 4),
      ...(hasConstraints ? { feasibleFraction: round(dates.filter((d) => d.feasible).length / dates.length, 4) } : {}),
      goodFraction: round(goodCount / dates.length, 4),
    },
    best,
    worst,
    goodWindows,
    dates,
    ...(terrain ? { terrain } : {}),
    ...night.echo,
    ...panelOpt,
    ...(slope ? { slope } : {}),
    note: sweepNote(terrain, mask, panel, site),
    timingMs: { total: Math.round(performance.now() - t0), sampling: Math.round(samplingMs) },
    samples: total,
  };
}

function sweepNote(terrain: Terrain | null, mask: HorizonMask | null, panel: Panel, site: LatLon): string {
  const warning = fastModeWarning(terrain, [site]);
  const split = terrain?.panelHeightM !== undefined;
  const horizon = !terrain
    ? 'Sin relieve: horizonte de Luna lisa a 0° (en los polos, optimista).'
    : isCatalogMask(mask) && !mask!.refine ? `Con relieve LOLA (máscara de horizonte precalculada del catálogo${split ? `; ${heightsText(terrain)}` : ''}; sin DEM en caché, sin rayo directo).`
      : mask ? `Con relieve LOLA (máscara de horizonte del punto${split ? `; ${heightsText(terrain)}` : ''}; ${refineText(terrain)}).${warning ? ` ${warning}` : ''}`
      : 'Se pidió relieve, pero el punto no tiene DEM: horizonte a 0°.';
  const energy = panel === 'tracking'
    ? 'La energía supone un panel que sigue al Sol (incidencia normal); usa panel para otra orientación.'
    : `La energía usa un panel ${panel} (factor de incidencia en cada paso).`;
  return `${horizon} ${energy} Cada fecha es una misión que empieza al alunizar; métricas con la resolución del paso de muestreo. Sol y Tierra se tratan como discos.`;
}
