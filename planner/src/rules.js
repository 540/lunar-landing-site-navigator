// Evaluador de viabilidad de un aterrizaje. Funciones puras: reciben las ventanas de visibilidad que da la API
// de datos (/v1/windows) y un perfil de misión, y devuelven un veredicto con el porqué.
//
// Un aterrizaje en T0 es viable si cumple TODAS las reglas activas durante la misión [T0, T0 + duración]. Son
// condiciones necesarias, no una nota ponderada: una sombra más larga que la batería tumba la misión aunque el
// resto sea excelente.
import { clip, containing, gaps, intersect, longest, nextAfter, totalMs } from './intervals.js';

const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;

export const VERDICT = { VIABLE: 'viable', MARGINAL: 'marginal', NOT_VIABLE: 'not-viable', NO_DATA: 'no-data' };
const SEVERITY = { viable: 0, marginal: 1, 'not-viable': 2, 'no-data': 3 };

/** Paso entre fechas de aterrizaje candidatas, y con el que se barre la tolerancia de fecha. */
export const SCAN_STEP_HOURS = 6;

// kind: 'instant' = se cumple o no en T0; 'min' = la métrica debe llegar al umbral; 'max' = no debe pasarlo;
// 'site' = depende solo del lugar (la pendiente), no de la fecha.
export const RULES = [
  { id: 'R1', name: 'Sol al aterrizar', kind: 'instant', body: 'sun', why: 'Energía y navegación óptica durante el descenso.' },
  { id: 'R2', name: 'Tierra al aterrizar', kind: 'instant', body: 'earth', why: 'Telemetría en directo del aterrizaje (comunicación directa).' },
  { id: 'R3', name: 'Luz para arrancar', kind: 'min', metric: 'sunlightAfterLandingHours', unit: 'hours', why: 'Horas de sol seguidas tras aterrizar, para desplegarse y cargar baterías.' },
  { id: 'R4', name: 'Sobrevivir a la sombra', kind: 'max', metric: 'longestShadowHours', unit: 'hours', why: 'La sombra seguida más larga no puede superar la autonomía de la batería.' },
  { id: 'R5', name: 'Energía total', kind: 'min', metric: 'sunFraction', unit: 'fraction', why: 'Parte de la misión con sol.' },
  { id: 'R6', name: 'Sin quedarse incomunicado', kind: 'max', metric: 'longestEarthOutageHours', unit: 'hours', why: 'Hueco seguido más largo sin la Tierra a la vista.' },
  { id: 'R7', name: 'Tiempo operativo', kind: 'min', metric: 'sunAndEarthFraction', unit: 'fraction', why: 'Parte de la misión con sol y Tierra a la vez.' },
  { id: 'R8', name: 'Tierra suficiente', kind: 'min', metric: 'earthFraction', unit: 'fraction', why: 'Parte de la misión con la Tierra a la vista (comunicación directa).' },
  { id: 'R9', name: 'Pendiente segura', kind: 'site', metric: 'slopeDeg', unit: 'degrees', why: 'Pendiente del terreno en una base de 100 m (el alunizaje tripulado de Artemis pide menos de 10°).' },
];

// API warnings the evaluator already gives in its own words: `smooth_moon_polar` and, since API 1.13.0,
// `terrain_not_applied` (terrain asked for and not applied) are the 'no-terrain' warning.
const API_WARNINGS_COVERED = new Set(['smooth_moon_polar', 'terrain_not_applied']);

/** Warnings (`warnings`, API 1.9.0 or later) of one or two responses, without repeats. */
function apiWarnings(responses) {
  const seen = new Map();
  for (const r of responses) for (const w of r.warnings ?? []) {
    if (!API_WARNINGS_COVERED.has(w.code)) seen.set(`${w.code}|${w.parameter ?? ''}|${w.message}`, w);
  }
  return [...seen.values()];
}

const toIntervals = (set) => set.windows.map((w) => [Date.parse(w.start), Date.parse(w.end)]);

/**
 * `horizonBand` of /v1/windows (API 1.18.0, horizonBandDeg) → the same windows with the horizon raised and lowered:
 * { deg, raised: { sun, earth, sunAndEarth }, lowered: { … } }. The Sun from the first response, the Earth from the second.
 */
function horizonBand(sunBand, earthBand) {
  const side = (k) => {
    const sun = toIntervals(sunBand[k].sun), earth = toIntervals(earthBand[k].earth);
    return { sun, earth, sunAndEarth: intersect(sun, earth) };
  };
  return { deg: sunBand.deg, raised: side('raised'), lowered: side('lowered') };
}

/**
 * Convierte respuestas de /v1/windows en lo que usa el evaluador. Se pueden pasar dos respuestas del mismo sitio
 * e intervalo pedidas con distinto `mode`: de la primera se toma el Sol y de la segunda la Tierra. Los tramos con
 * los dos a la vez se calculan aquí cruzando ambos, así que no dependen de que el `mode` coincida.
 * También se guardan, si vienen, el relieve aplicado (`terrain`), la pendiente (`slope`, de la primera respuesta),
 * los avisos de la API (`apiWarnings`) y, si las respuestas se pidieron con `horizonBandDeg`, la banda de robustez del
 * horizonte (`horizonBand`: las ventanas con el horizonte subido y bajado).
 */
export function fromApi(sunResponse, earthResponse = sunResponse) {
  for (const r of [sunResponse, earthResponse]) {
    if (!r?.site || !r.start || !r.end || !r.sun?.windows || !r.earth?.windows) throw new Error('La respuesta no tiene la forma de /v1/windows');
  }
  if (sunResponse.site.id !== earthResponse.site.id || sunResponse.start !== earthResponse.start || sunResponse.end !== earthResponse.end) {
    throw new Error('Las dos respuestas deben ser del mismo sitio y del mismo intervalo');
  }
  const sun = toIntervals(sunResponse.sun), earth = toIntervals(earthResponse.earth);
  return {
    site: sunResponse.site,
    startMs: Date.parse(sunResponse.start),
    endMs: Date.parse(sunResponse.end),
    sunMode: sunResponse.mode,
    earthMode: earthResponse.mode,
    sun,
    earth,
    sunAndEarth: intersect(sun, earth),
    terrain: sunResponse.terrain ?? null,
    slope: sunResponse.slope ?? earthResponse.slope ?? null,
    apiWarnings: apiWarnings(sunResponse === earthResponse ? [sunResponse] : [sunResponse, earthResponse]),
    ...(sunResponse.horizonBand && earthResponse.horizonBand ? { horizonBand: horizonBand(sunResponse.horizonBand, earthResponse.horizonBand) } : {}),
    // Modo DSN (dsn=1, API 1.24.0): la Tierra visible y la Luna sobre alguna estación de la DSN; solo informa, ninguna regla lo usa.
    ...(earthResponse.earthDsn ? { earthDsn: toIntervals(earthResponse.earthDsn) } : {}),
  };
}

export function formatHours(h) {
  if (!Number.isFinite(h)) return '—';
  const total = Math.round(h);
  const d = Math.floor(total / 24), r = total - d * 24;
  if (d === 0) return `${r} h`;
  return r ? `${d} d ${r} h` : `${d} d`;
}
const formatDegrees = (deg) => `${(Math.round(deg * 10) / 10).toLocaleString('es-ES')}°`;
function formatValue(value, unit) {
  if (unit === 'hours') return formatHours(value);
  if (unit === 'degrees') return formatDegrees(value);
  return `${Math.round(value * 100)} %`;
}

// Tiempo visible seguido desde t. `open` indica que la ventana llega al final de los datos pedidos: el valor es
// entonces un mínimo, no la duración real.
function visibleFrom(intervals, t, endMs) {
  const iv = containing(intervals, t);
  if (!iv) return { hours: 0, open: false };
  return { hours: (iv[1] - t) / HOUR_MS, open: iv[1] >= endMs };
}

/** Métricas de la misión [t0, t0 + duración]. Los tramos sin sol o sin Tierra se recortan a la misión. */
export function missionMetrics(w, t0, durationMs) {
  const end = t0 + durationMs;
  if (t0 < w.startMs || end > w.endMs) return { noData: true };
  const shadow = longest(gaps(w.sun, t0, end));
  const outage = longest(gaps(w.earth, t0, end));
  const sunlight = visibleFrom(w.sun, t0, w.endMs);
  const earthlight = visibleFrom(w.earth, t0, w.endMs);
  const nextSun = nextAfter(w.sun, t0), nextEarth = nextAfter(w.earth, t0);
  return {
    noData: false,
    sunAtLanding: containing(w.sun, t0) !== null,
    earthAtLanding: containing(w.earth, t0) !== null,
    hoursToSunrise: nextSun ? (nextSun[0] - t0) / HOUR_MS : null,
    hoursToEarthrise: nextEarth ? (nextEarth[0] - t0) / HOUR_MS : null,
    sunlightAfterLandingHours: sunlight.hours,
    sunlightAfterLandingOpen: sunlight.open,
    earthAfterLandingHours: earthlight.hours,
    earthAfterLandingOpen: earthlight.open,
    longestShadowHours: shadow ? (shadow[1] - shadow[0]) / HOUR_MS : 0,
    longestShadowStart: shadow ? new Date(shadow[0]).toISOString() : null,
    longestEarthOutageHours: outage ? (outage[1] - outage[0]) / HOUR_MS : 0,
    longestEarthOutageStart: outage ? new Date(outage[0]).toISOString() : null,
    sunFraction: totalMs(clip(w.sun, t0, end)) / durationMs,
    sunAndEarthFraction: totalMs(clip(w.sunAndEarth, t0, end)) / durationMs,
    earthFraction: totalMs(clip(w.earth, t0, end)) / durationMs,
  };
}

function reason(def, passes, value, threshold, m, slope) {
  const v = formatValue(value, def.unit);
  // A rule the profile does not name has no threshold: report the value without the '(mínimo …)' part.
  const limit = (label) => (Number.isFinite(threshold) ? ` (${label} ${formatValue(threshold, def.unit)})` : '');
  switch (def.id) {
    case 'R1':
      if (passes) return 'El Sol se ve al aterrizar';
      return m.hoursToSunrise === null ? 'El Sol no se ve al aterrizar ni vuelve a salir en el periodo consultado' : `El Sol no se ve al aterrizar; sale en ${formatHours(m.hoursToSunrise)}`;
    case 'R2':
      if (passes) return 'La Tierra se ve al aterrizar';
      return m.hoursToEarthrise === null ? 'La Tierra no se ve al aterrizar ni vuelve a salir en el periodo consultado' : `La Tierra no se ve al aterrizar; sale en ${formatHours(m.hoursToEarthrise)}`;
    case 'R3': return `${m.sunlightAfterLandingOpen ? 'Al menos ' : ''}${v} de sol tras aterrizar${limit('mínimo')}`;
    case 'R4': return `Sombra más larga: ${v}${limit('la batería aguanta')}`;
    case 'R5': return `${v} de la misión con sol${limit('mínimo')}`;
    case 'R6': return `Hueco más largo sin Tierra: ${v}${limit('máximo')}`;
    case 'R7': return `${v} de la misión con sol y Tierra${limit('mínimo')}`;
    case 'R8': return `Tierra visible el ${v} de la misión${limit('mínimo')}`;
    case 'R9': return slopeReason(slope, passes, limit('máximo'));
  }
}

function relativeMargin(kind, value, threshold) {
  if (threshold > 0) return kind === 'min' ? (value - threshold) / threshold : (threshold - value) / threshold;
  const passes = kind === 'min' ? value >= threshold : value <= threshold;
  return passes ? Infinity : -Infinity;
}

function slopeReason(slope, passes, limit) {
  if (!slope) return 'Sin datos de pendiente: no se pidió a la API';
  if (slope.slopeDeg === null) return 'Sin datos de pendiente: el punto queda fuera del DEM o el servidor no lo tiene';
  const at = `Pendiente de ${formatDegrees(slope.slopeDeg)} en ${slope.slopeBaselineM} m${limit}`;
  if (passes === null) return `${at}; con el DEM de ${slope.demResolutionM} m/px no se puede certificar en ${slope.requestedBaselineM} m`;
  return at;
}

/**
 * Slope (R9), from what the API says (`slope=1`, `maxSlopeDeg`). It only passes if the API certifies it:
 * `meetsMaxSlope: true` measured on the requested baseline. With `underestimated: true` (coarse DEM: a baseline of
 * ~480 m or more) the slope over 100 m can be steeper, and the 160 or 240 m/px DEM lets slopes over 10° through:
 * uncertified (`passes: null`), never a pass. If even so it exceeds the maximum, it fails.
 */
function slopeVerdict(slope) {
  if (!slope || slope.meetsMaxSlope === null || slope.meetsMaxSlope === undefined) return null;
  if (slope.meetsMaxSlope === false) return false;
  return slope.underestimated ? null : true;
}

// Avisos que acompañan al veredicto. Con Luna lisa los resultados son optimistas, sobre todo cerca de los polos,
// donde un cerro basta para tapar el Sol o la Tierra. Se pide el relieve con `terrain=1` (src/api.js); si la API no
// tiene máscara para el punto, responde con la esfera y lo explica en `terrain.note`.
function warningsFor(w) {
  const out = [];
  if (w.site.horizonModel === 'sphere') {
    const polar = Math.abs(w.site.latDeg) >= 80;
    const asked = w.terrain && !w.terrain.applied ? ` Se pidió relieve, pero la API no lo aplicó: ${w.terrain.note}` : '';
    out.push({
      code: 'no-terrain',
      message: (polar
        ? 'Sin relieve: el horizonte es el de una Luna lisa. Este sitio está cerca del polo, donde el relieve puede tapar el Sol o la Tierra: el veredicto es optimista.'
        : 'Sin relieve: el horizonte es el de una Luna lisa. Lejos de los polos el efecto suele ser pequeño.') + asked,
    });
  }
  for (const a of w.apiWarnings ?? []) out.push({ code: `api:${a.code}`, message: `API · ${a.message}` });
  return out;
}

/** Which horizon was used: LOLA terrain (`mask`, with the panel and antenna heights) or a smooth Moon. */
function horizonOf(w) {
  if (w.site.horizonModel !== 'mask') return { model: w.site.horizonModel };
  const t = w.terrain ?? {};
  return { model: 'mask', panelHeightM: t.panelHeightM ?? t.observerHeightM ?? null, antennaHeightM: t.antennaHeightM ?? t.observerHeightM ?? null };
}

/** Reglas y veredicto de un aterrizaje en t0 (ms), sin tolerancia de fecha. */
export function evaluateAt(w, profile, t0) {
  const durationMs = profile.durationDays * DAY_MS;
  const warnings = warningsFor(w);
  const horizon = horizonOf(w);
  // Provisional: computed without terrain, or with an active rule left uncertified (set further down).
  const common = { t0: new Date(t0).toISOString(), missionEnd: new Date(t0 + durationMs).toISOString(), horizon, provisional: horizon.model !== 'mask', warnings };
  const metrics = missionMetrics(w, t0, durationMs);
  if (metrics.noData) {
    const r0 = { id: 'R0', name: 'Datos suficientes', active: true, passes: false, normalized: -Infinity, reason: 'El periodo consultado no cubre toda la misión' };
    return { ...common, verdict: VERDICT.NO_DATA, rules: [r0], limiting: r0, metrics };
  }

  const rules = RULES.map((def) => {
    const conf = profile.rules[def.id] ?? { active: false };
    let value, threshold, passes, margin;
    if (def.kind === 'instant') {
      passes = def.body === 'sun' ? metrics.sunAtLanding : metrics.earthAtLanding;
      // Se ve o no se ve: no hay «por poco». La fragilidad ante un cambio de fecha la mide la tolerancia.
      margin = passes ? Infinity : -Infinity;
    } else if (def.kind === 'site') {
      value = w.slope?.slopeDeg ?? null;
      threshold = conf.threshold;
      passes = slopeVerdict(w.slope);
      margin = passes === null ? null : passes ? relativeMargin('max', value, threshold) : -Infinity;
    } else {
      value = metrics[def.metric];
      threshold = conf.threshold;
      passes = def.kind === 'min' ? value >= threshold : value <= threshold;
      margin = relativeMargin(def.kind, value, threshold);
    }
    // Uncertified (passes: null): it does not fail, but the verdict cannot be better than 'marginal'.
    const normalized = margin === null ? 0 : margin / profile.marginalMargin;
    return { ...def, active: Boolean(conf.active), passes, value, threshold, margin, normalized, reason: reason(def, passes, value, threshold, metrics, w.slope) };
  });

  const active = rules.filter((r) => r.active);
  let verdict = VERDICT.VIABLE;
  if (active.some((r) => r.passes === false)) verdict = VERDICT.NOT_VIABLE;
  else if (active.some((r) => r.passes === null || r.normalized < 1)) verdict = VERDICT.MARGINAL;
  const uncertain = active.filter((r) => r.passes === null);
  for (const r of uncertain) warnings.push({ code: 'uncertified', message: `${r.id} sin certificar: ${r.reason.charAt(0).toLowerCase()}${r.reason.slice(1)}. No cuenta como apta.` });
  // La regla que más aprieta: la de menor margen entre las activas. Entre varias que fallan sin margen medible
  // (R1, R2), gana la primera del catálogo.
  const limiting = active.reduce((worst, r) => (!worst || r.normalized < worst.normalized ? r : worst), null);
  return { ...common, provisional: common.provisional || uncertain.length > 0, verdict, rules, limiting, metrics };
}

function worseThan(a, b) {
  if (SEVERITY[a.verdict] !== SEVERITY[b.verdict]) return SEVERITY[a.verdict] > SEVERITY[b.verdict];
  return (a.limiting?.normalized ?? Infinity) < (b.limiting?.normalized ?? Infinity);
}

/**
 * Veredicto de un aterrizaje en t0 (ms). Con `toleranceDays` > 0 se evalúan también las fechas dentro de ese
 * margen (cada SCAN_STEP_HOURS) y manda la peor: «viable» significa entonces «viable aunque la fecha se mueva».
 * `worstCase` trae la evaluación de esa fecha peor, o null si es la propia t0.
 */
export function evaluate(w, profile, t0) {
  const base = evaluateAt(w, profile, t0);
  const k = Math.round(((profile.toleranceDays ?? 0) * 24) / SCAN_STEP_HOURS);
  if (!k) return { ...base, worstCase: null };
  let worst = base;
  for (let j = -k; j <= k; j++) {
    if (!j) continue;
    const r = evaluateAt(w, profile, t0 + j * SCAN_STEP_HOURS * HOUR_MS);
    if (worseThan(r, worst)) worst = r;
  }
  if (worst === base) return { ...base, worstCase: null };
  return { ...base, verdict: worst.verdict, limiting: worst.limiting, worstCase: worst };
}

/** Evalúa todas las fechas de aterrizaje candidatas de [fromMs, toMs), cada SCAN_STEP_HOURS. */
export function evaluateRange(w, profile, fromMs, toMs) {
  const out = [];
  for (let t = fromMs; t < toMs; t += SCAN_STEP_HOURS * HOUR_MS) out.push(evaluate(w, profile, t));
  return out;
}

/** Agrupa las fechas candidatas consecutivas con el mismo veredicto: las «ventanas de aterrizaje». */
export function landingWindows(results) {
  const out = [];
  for (const r of results) {
    const last = out.at(-1);
    if (last && last.verdict === r.verdict) { last.lastT0 = r.t0; last.count++; } else out.push({ verdict: r.verdict, firstT0: r.t0, lastT0: r.t0, count: 1 });
  }
  return out;
}

/**
 * Primera fecha viable a partir de fromMs. Si no hay ninguna viable en el periodo, la primera marginal; si
 * tampoco, null. Sirve para replanificar tras un retraso.
 */
export function nextViable(w, profile, fromMs, maxDays = 120) {
  let marginal = null;
  const limit = Math.min(fromMs + maxDays * DAY_MS, w.endMs);
  for (let t = fromMs; t < limit; t += SCAN_STEP_HOURS * HOUR_MS) {
    const r = evaluate(w, profile, t);
    if (r.verdict === VERDICT.VIABLE) return r;
    if (r.verdict === VERDICT.MARGINAL && !marginal) marginal = r;
    if (r.verdict === VERDICT.NO_DATA && t > fromMs) break;
  }
  return marginal;
}

/** Fecha de lanzamiento que corresponde a un aterrizaje, con el viaje del perfil. */
export const launchDate = (t0Iso, profile) => new Date(Date.parse(t0Iso) - profile.transitDays * DAY_MS).toISOString();
