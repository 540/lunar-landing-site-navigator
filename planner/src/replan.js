// Replanificar tras un retraso o un cambio de nave. Funciones puras sobre las ventanas de visibilidad (la misma
// forma `w` que usa rules.js), así que valen igual con el motor simulado de la interfaz, con /v1/windows o con un
// JSON precalculado.
//
// Hay un plan original (el aprobado), un plan vigente (el último adoptado; al principio, el original) y un cambio:
// la nave no puede aterrizar antes de `notBeforeMs` ni después de `notAfterMs`, o el perfil ha cambiado. Se
// comparan tres salidas:
//   A · mismo sitio, otra fecha: la primera fecha viable del sitio vigente dentro de la ventana;
//   B · otro sitio, misma fecha: el mejor sitio de la región en la fecha retrasada;
//   C · otro sitio y otra fecha: el sitio de la región que antes vuelve a ser viable, si mejora a A.
// La región son los sitios a `radiusKm` o menos del sitio ORIGINAL (el reto habla de sitios de la misma región).
import { evaluate, VERDICT, SCAN_STEP_HOURS } from './rules.js';
import { gaps } from './intervals.js';

const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;
const STEP_MS = SCAN_STEP_HOURS * HOUR_MS;
const MOON_RADIUS_KM = 1737.4;
const SEVERITY = { [VERDICT.VIABLE]: 0, [VERDICT.MARGINAL]: 1, [VERDICT.NOT_VIABLE]: 2, [VERDICT.NO_DATA]: 3 };

/** Radio por defecto de la región, en km: con él entra de Gerlache (52 km) desde la cresta de Shackleton. */
export const DEFAULT_RADIUS_KM = 60;
/** Hasta cuántos días de retraso extra se mide el margen de una opción viable. */
export const MARGIN_CAP_DAYS = 15;
/** Cuántos días más allá de la fecha límite se buscan fechas para sugerir ampliarla. */
export const SUGGESTION_EXTRA_DAYS = 60;
/** Radio máximo que se sugiere: más allá ya no es «la misma región» (un sitio ecuatorial no es alternativa). */
export const MAX_SUGGESTED_RADIUS_KM = 250;

const RAD = Math.PI / 180;

/** Distancia por la superficie de la Luna entre dos sitios `{ latDeg, lonDeg }`, en km. */
export function distanceKm(a, b) {
  const p1 = a.latDeg * RAD, p2 = b.latDeg * RAD, dp = p2 - p1, dl = (b.lonDeg - a.lonDeg) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * MOON_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cuántos días se puede retrasar más un aterrizaje viable sin dejar de serlo: fechas consecutivas viables a partir
 * de t0, cada SCAN_STEP_HOURS. `open` indica que se llegó al tope (o al final de los datos) sin dejar de serlo.
 */
export function marginDays(w, profile, t0, capDays = MARGIN_CAP_DAYS) {
  const max = Math.round((capDays * 24) / SCAN_STEP_HOURS);
  let k = 0;
  while (k < max) {
    const r = evaluate(w, profile, t0 + (k + 1) * STEP_MS);
    if (r.verdict === VERDICT.NO_DATA) return { days: (k * SCAN_STEP_HOURS) / 24, open: true };
    if (r.verdict !== VERDICT.VIABLE) break;
    k++;
  }
  return { days: (k * SCAN_STEP_HOURS) / 24, open: k === max };
}

/** Primera fecha viable de [fromMs, toMs] y, por si no la hay, la primera marginal. */
function firstAcceptable(w, profile, fromMs, toMs) {
  let marginal = null;
  for (let t = fromMs; t <= toMs; t += STEP_MS) {
    const r = evaluate(w, profile, t);
    if (r.verdict === VERDICT.VIABLE) return { t, verdict: r.verdict };
    if (r.verdict === VERDICT.MARGINAL && !marginal) marginal = { t, verdict: r.verdict };
    if (r.verdict === VERDICT.NO_DATA) break; // los datos no vuelven más adelante
  }
  return marginal;
}

/**
 * Orden de las opciones: primero el veredicto; entre las que no valen, la que falla por menos; después la
 * prioridad de la misión (la que eligió el planificador en Planificar), y como desempate fijo: menor retraso
 * total, menor sombra, más Tierra y más cerca.
 */
export function compareOptions(priority) {
  return (x, y) => {
    const s = SEVERITY[x.verdict] - SEVERITY[y.verdict];
    if (s) return s;
    if (x.verdict !== VERDICT.VIABLE) {
      const nx = x.evaluation.limiting?.normalized ?? -Infinity, ny = y.evaluation.limiting?.normalized ?? -Infinity;
      if (nx !== ny) return ny - nx;
    }
    const mx = x.evaluation.metrics, my = y.evaluation.metrics;
    const byPriority = {
      energy: () => (mx.longestShadowHours - my.longestShadowHours) || (my.sunFraction - mx.sunFraction),
      comms: () => my.earthFraction - mx.earthFraction,
      early: () => x.landingMs - y.landingMs,
      delays: () => (y.margin?.days ?? 0) - (x.margin?.days ?? 0),
    }[priority];
    const p = byPriority ? byPriority() : 0;
    if (p) return p;
    return (x.landingMs - y.landingMs)
      || (mx.longestShadowHours - my.longestShadowHours)
      || (my.earthFraction - mx.earthFraction)
      || (x.distanceKm - y.distanceKm);
  };
}

const worse = (x, y) => SEVERITY[x.verdict] > SEVERITY[y.verdict];

/**
 * Opciones de replanificación.
 *
 * input = {
 *   windowsBySite: { [siteId]: w },            ventanas de cada sitio (forma de rules.js)
 *   sites: [{ id, name, latDeg, lonDeg }],     catálogo
 *   profile,                                   perfil de misión de rules.js (ya con los cambios de nave)
 *   original: { siteId, landingMs },           plan aprobado: de él salen el retraso total y la región
 *   plan: { siteId, landingMs },               plan vigente (por defecto, el original)
 *   notBeforeMs, notAfterMs,                   ventana en la que puede aterrizar ahora
 *   radiusKm = DEFAULT_RADIUS_KM,
 *   priority = null,                           'energy' | 'comms' | 'early' | 'delays'
 * }
 *
 * Devuelve { current, needed, a, b, c, recommended, leastBad, suggestions, region }. Cada opción es
 * { kind, site, landingMs, verdict, evaluation, margin: { days, open }, totalDelayDays, distanceKm }; C trae
 * además `improvesOnA`. Si el plan sigue siendo viable, `needed` es false y no se proponen salidas.
 */
export function replanOptions(input) {
  const { windowsBySite, sites, profile, original, notAfterMs, radiusKm = DEFAULT_RADIUS_KM, priority = null } = input;
  const plan = input.plan ?? original;
  const byId = Object.fromEntries(sites.map((s) => [s.id, s]));
  const originalSite = byId[original.siteId], planSite = byId[plan.siteId];
  if (!originalSite || !planSite) throw new Error('El plan original y el vigente deben ser sitios del catálogo');
  const order = compareOptions(priority);

  const option = (kind, site, landingMs, withMargin = true) => {
    const w = windowsBySite[site.id];
    const evaluation = evaluate(w, profile, landingMs);
    return {
      kind, site, landingMs, verdict: evaluation.verdict, evaluation,
      margin: withMargin && evaluation.verdict === VERDICT.VIABLE ? marginDays(w, profile, landingMs) : { days: 0, open: false },
      totalDelayDays: (landingMs - original.landingMs) / DAY_MS,
      distanceKm: distanceKm(originalSite, site),
    };
  };
  const usable = (o) => o && o.verdict !== VERDICT.NO_DATA;
  const acceptable = (o) => o && (o.verdict === VERDICT.VIABLE || o.verdict === VERDICT.MARGINAL);

  const landing = Math.max(plan.landingMs, input.notBeforeMs ?? plan.landingMs);
  const current = option('current', planSite, landing);
  const region = sites.filter((s) => s.id !== planSite.id && windowsBySite[s.id] && distanceKm(originalSite, s) <= radiusKm);
  if (current.verdict === VERDICT.VIABLE) {
    return { current, needed: false, a: null, b: null, c: null, recommended: null, leastBad: null, suggestions: [], region };
  }

  // A · mismo sitio, la primera fecha que vuelve a valer dentro de la ventana.
  const firstA = firstAcceptable(windowsBySite[planSite.id], profile, landing + STEP_MS, notAfterMs);
  const a = firstA ? option('a', planSite, firstA.t) : null;

  // B · otro sitio de la región, en la fecha retrasada.
  const bCandidates = region.map((s) => option('b', s, landing)).filter(usable).sort(order);
  const b = bCandidates.find(acceptable) ?? null;

  // C · otro sitio y otra fecha. Solo los sitios que no valen ya en la fecha de B (si valen, son una B con menos
  // retraso). De cada uno, su primera fecha aceptable; gana la de menor retraso total.
  const validAtB = new Set(bCandidates.filter((o) => o.verdict === VERDICT.VIABLE).map((o) => o.site.id));
  const cCandidates = region
    .filter((s) => !validAtB.has(s.id))
    .map((s) => {
      const f = firstAcceptable(windowsBySite[s.id], profile, landing + STEP_MS, notAfterMs);
      return f ? option('c', s, f.t) : null;
    })
    .filter(usable)
    .sort((x, y) => (SEVERITY[x.verdict] - SEVERITY[y.verdict]) || (x.landingMs - y.landingMs) || order(x, y));
  let c = cCandidates[0] ?? null;
  if (c) c = { ...c, improvesOnA: !a || worse(a, c) || (!worse(c, a) && c.landingMs < a.landingMs) };

  const viable = [a, b, c && c.improvesOnA ? c : null].filter((o) => o && o.verdict === VERDICT.VIABLE);
  const recommended = viable.sort(order)[0] ?? null;

  let leastBad = null, suggestions = [];
  if (![a, b, c].some((o) => o && o.verdict === VERDICT.VIABLE)) {
    leastBad = [current, a, b, c, ...bCandidates, ...cCandidates].filter(usable).sort(order)[0] ?? current;
    suggestions = suggest({ windowsBySite, sites, profile, planSite, originalSite, region, landing, notAfterMs, radiusKm });
  }
  return { current, needed: true, a, b, c, recommended, leastBad, suggestions, region };
}

// Qué cambiar para que haya una salida viable: ampliar la fecha límite (la primera fecha viable después de ella,
// en el sitio vigente o en la región) o ampliar el radio (el sitio más cercano de fuera que vale en la ventana, sin
// pasar de MAX_SUGGESTED_RADIUS_KM).
function suggest({ windowsBySite, sites, profile, planSite, originalSite, region, landing, notAfterMs, radiusKm }) {
  const out = [];
  let firstLater = null;
  for (const s of [planSite, ...region]) {
    const w = windowsBySite[s.id];
    for (let t = notAfterMs + STEP_MS; t <= notAfterMs + SUGGESTION_EXTRA_DAYS * DAY_MS && (!firstLater || t < firstLater.untilMs); t += STEP_MS) {
      const r = evaluate(w, profile, t);
      if (r.verdict === VERDICT.NO_DATA) break;
      if (r.verdict === VERDICT.VIABLE) { firstLater = { kind: 'extend-deadline', untilMs: t, site: s }; break; }
    }
  }
  if (firstLater) out.push(firstLater);

  const outside = sites
    .filter((s) => s.id !== planSite.id && windowsBySite[s.id] && !region.includes(s))
    .map((s) => ({ s, d: distanceKm(originalSite, s) }))
    .filter(({ d }) => d > radiusKm && d <= MAX_SUGGESTED_RADIUS_KM)
    .sort((x, y) => x.d - y.d);
  for (const { s, d } of outside) {
    const w = windowsBySite[s.id];
    let found = false;
    for (let t = landing; t <= notAfterMs && !found; t += STEP_MS) found = evaluate(w, profile, t).verdict === VERDICT.VIABLE;
    if (found) { out.push({ kind: 'widen-radius', radiusKm: Math.ceil(d / 10) * 10, site: s }); break; }
  }
  return out;
}

/**
 * Barrido de retraso: el veredicto de cada sitio si se aterriza `fromMs + d días`, para d = 0 … days.
 * Con `{ wholeDays: true }` cada d es un día UTC entero (el de fromMs más d) y su veredicto es el mejor de las
 * fechas candidatas de ese día (cada SCAN_STEP_HOURS): responde a «¿se puede aterrizar ese día?».
 * Devuelve { [siteId]: [{ t, verdict, reason }] }, con `t` la fecha que da ese veredicto.
 */
export function delaySweep(windowsBySite, siteIds, profile, fromMs, days, { wholeDays = false } = {}) {
  const dayStart = Math.floor(fromMs / DAY_MS) * DAY_MS, slots = wholeDays ? Math.round(24 / SCAN_STEP_HOURS) : 1;
  const out = {};
  for (const id of siteIds) {
    out[id] = Array.from({ length: days + 1 }, (_, d) => {
      let best = null;
      for (let k = 0; k < slots; k++) {
        const t = wholeDays ? dayStart + d * DAY_MS + k * STEP_MS : fromMs + d * DAY_MS;
        const r = evaluate(windowsBySite[id], profile, t);
        if (!best || SEVERITY[r.verdict] < SEVERITY[best.verdict]) best = { t, verdict: r.verdict, reason: r.limiting?.reason ?? '' };
      }
      return best;
    });
  }
  return out;
}

/**
 * La misión hora a hora, para enseñarla como una simulación: si hay Sol y Tierra a la vista y cuánta batería le
 * queda a la nave. La batería es la misma regla que R4: a oscuras gasta una hora de autonomía por hora, y con Sol
 * vuelve a estar llena. Los tramos a oscuras son los mismos que mide R4 (`gaps` de las ventanas del Sol, exactos y no
 * muestreados), así que se vacía si y solo si la sombra más larga supera `batteryHours`; `emptyAtMs` es el instante
 * exacto en que se agota (el inicio de esa sombra más `batteryHours`).
 * Devuelve { steps: [{ t, sun, earth, battery }], emptyAtMs, minBattery }, con battery entre 0 y 1.
 */
export function missionTimeline(w, t0, durationMs, batteryHours, stepMs = HOUR_MS) {
  const end = t0 + durationMs;
  const inside = (list, t) => list.some(([a, b]) => a <= t && t < b);
  const dark = gaps(w.sun, t0, end);
  const limitMs = batteryHours * HOUR_MS;
  const emptyGap = dark.find(([a, b]) => b - a > limitMs);
  const steps = [];
  let minBattery = 1;
  for (let t = t0; t <= end; t += stepMs) {
    const sun = inside(w.sun, t), earth = inside(w.earth, t);
    const gap = sun ? null : dark.find(([a, b]) => a <= t && (t < b || b === end));
    const darkHours = gap ? (t - gap[0]) / HOUR_MS : 0; // horas a oscuras hasta ahora
    const battery = batteryHours > 0 ? Math.max(0, 1 - darkHours / batteryHours) : (sun ? 1 : 0);
    minBattery = Math.min(minBattery, battery);
    steps.push({ t, sun, earth, battery });
  }
  if (emptyGap) minBattery = 0;
  return { steps, emptyAtMs: emptyGap ? emptyGap[0] + limitMs : null, minBattery };
}
