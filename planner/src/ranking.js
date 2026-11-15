// Mejores aterrizajes: para cada sitio, el mejor aterrizaje de una ventana de fechas, y los sitios ordenados.
// Funciones puras sobre las ventanas de visibilidad (la misma forma `w` de rules.js). Las usan la API pública
// (/v1/best-landings, en data/) y la interfaz (web/, con el motor simulado cuando no hay API), así que el servidor y
// el navegador ordenan igual.
//
// Cada aterrizaje se juzga con las reglas de rules.js (R1, R2, R4, R6 si hay umbral, R8 y R9: el perfil de la interfaz) y se puntúa:
//   la mitad, el veredicto (viable 1, justo 0,3, no viable 0);
//   la otra mitad, la suma ponderada según la prioridad de energía, comunicación, aterrizar antes y margen ante retrasos.
import { evaluate, VERDICT } from './rules.js';
import { marginDays } from './replan.js';

const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;

/** Pendiente máxima para posarse, en una base de 100 m: la del alunizaje tripulado de Artemis (R9). */
export const SAFE_SLOPE_DEG = 10;
/** Tránsito de la Tierra a la Luna cuando la misión no da el suyo (el de profiles.js). */
export const DEFAULT_TRANSIT_DAYS = 5;
/** Cada cuántas horas se prueba un aterrizaje dentro de la ventana. */
export const RANK_STEP_HOURS = 12;
/** Días que se miran después de la ventana para medir la racha de fechas viables y la siguiente ventana. */
export const LOOKAHEAD_DAYS = 15;

/** Prioridades: pesos de energía (e), comunicación (c), aterrizar antes (a) y margen ante retrasos (r). */
export const PRIORITIES = [
  { id: 'energy', name: 'Más margen de energía', weights: { e: 0.5, c: 0.2, a: 0.1, r: 0.2 } },
  { id: 'comms', name: 'Más comunicación', weights: { e: 0.2, c: 0.5, a: 0.1, r: 0.2 } },
  { id: 'early', name: 'Aterrizar antes', weights: { e: 0.2, c: 0.2, a: 0.45, r: 0.15 } },
  { id: 'delays', name: 'Aguantar retrasos', weights: { e: 0.2, c: 0.2, a: 0.1, r: 0.5 } },
];
const BASE = { [VERDICT.VIABLE]: 1, [VERDICT.MARGINAL]: 0.3, [VERDICT.NOT_VIABLE]: 0, [VERDICT.NO_DATA]: 0 };

/**
 * Misión de la interfaz → perfil de rules.js: Sol y Tierra al aterrizar (R1, R2), batería (R4), corte de Tierra más
 * largo (R6, solo si la misión da maxEarthGapHours), parte mínima con la Tierra (R8) y pendiente para posarse (R9,
 * SAFE_SLOPE_DEG). R9 lee la pendiente de las ventanas (`w.slope`, la de /v1/windows con slope=1 y maxSlopeDeg igual a
 * SAFE_SLOPE_DEG): sin pendiente certificada el aterrizaje no pasa de «justo». R3, R5 y R7 quedan apagadas: la interfaz
 * no tiene umbrales para ellas. `transitDays` (opcional, DEFAULT_TRANSIT_DAYS si falta) es el viaje de la Tierra a la Luna de
 * la nave: no cambia ningún veredicto, solo traduce la fecha de aterrizaje a la de lanzamiento (launchDate de rules.js).
 */
export function missionProfile({ days, batteryHours, minEarthPct, maxEarthGapHours, transitDays }) {
  return {
    durationDays: days, marginalMargin: 0.1, toleranceDays: 0,
    transitDays: Number.isFinite(transitDays) && transitDays >= 0 ? transitDays : DEFAULT_TRANSIT_DAYS,
    rules: {
      R1: { active: true },
      R2: { active: true },
      R4: { active: true, threshold: batteryHours },
      R6: { active: Number.isFinite(maxEarthGapHours), threshold: maxEarthGapHours ?? 0 },
      R8: { active: true, threshold: minEarthPct / 100 },
      R9: { active: true, threshold: SAFE_SLOPE_DEG },
    },
  };
}

/** Periodo de ventanas que necesita bestLandings: la ventana, la racha y la misión del último aterrizaje que mira. */
export function rankingRange({ from, to, days }) {
  return { fromMs: from, toMs: to + (LOOKAHEAD_DAYS + days + 1) * DAY_MS };
}

const dh = (h) => { const d = Math.floor(h / 24), r = Math.round(h % 24); return d ? (r ? `${d} d ${r} h` : `${d} d`) : `${r} h`; };
const fmtDays = (d) => (d === Math.floor(d) ? d : d.toFixed(1).replace('.', ',')) + (d === 1 ? ' día' : ' días');

/**
 * Veredicto de una evaluación de rules.js en una frase y con su traza (qué regla se cumple y por qué).
 * `noData` se cuenta como no viable: sin datos no se puede aterrizar a ciegas.
 */
export function describe(e) {
  if (e.metrics.noData) {
    const reason = 'Sin datos de visibilidad para toda la misión';
    return { verdict: VERDICT.NOT_VIABLE, reason, trace: [{ rule: 'Datos suficientes', ok: false, value: reason }] };
  }
  const active = e.rules.filter((x) => x.active), failing = active.filter((x) => !x.passes);
  const verdict = e.verdict === VERDICT.NO_DATA ? VERDICT.NOT_VIABLE : e.verdict;
  const reason = verdict === VERDICT.NOT_VIABLE ? failing.map((x) => x.reason).join('; ')
    : verdict === VERDICT.MARGINAL ? `Por poco: ${e.limiting.reason}`
    : `Cumple todas las reglas. La que más aprieta: ${e.limiting.reason.charAt(0).toLowerCase()}${e.limiting.reason.slice(1)}`;
  return { verdict, reason, trace: active.map((x) => ({ rule: `${x.id} · ${x.name}`, ok: x.passes, value: x.reason })) };
}

/** Cifras de una evaluación que usa la puntuación (0 sin datos). */
function figures(e) {
  const m = e.metrics;
  return m.noData
    ? { shadowHours: 0, sunPct: 0, earthPct: 0 }
    : { shadowHours: m.longestShadowHours, sunPct: 100 * m.sunFraction, earthPct: 100 * m.earthFraction };
}

/** Los motivos de un aterrizaje, en frases cortas: los de un viable, o el porqué de que no lo sea. */
export function landingReasons({ verdict, reason, shadowHours, earthPct, robustDays }, mission) {
  if (verdict !== VERDICT.VIABLE) return [reason];
  return [
    shadowHours ? `Mayor sombra ${dh(shadowHours)}: tu batería aguanta ${mission.batteryHours} h` : 'Sol durante toda la misión',
    `Tierra visible el ${Math.round(earthPct)} % del tiempo (pides ${mission.minEarthPct} %)`,
    robustDays >= 0.5 ? `Sigue siendo viable aunque te retrases hasta ${fmtDays(robustDays)}` : 'Poco margen: con medio día de retraso ya no vale',
  ];
}

/**
 * El mejor aterrizaje de cada sitio en [from, to] y los sitios ordenados por puntuación.
 *  windowsBySite: { [siteId]: w } con ventanas que cubran rankingRange({ from, to, days }).
 *  sites: [{ id, … }] en el orden que se quiera; mission: { days, batteryHours, minEarthPct }; priority: id de PRIORITIES.
 * Devuelve { stepHours, tested, options } y, en cada opción: siteId, landing (ms), verdict, reason, trace, metrics
 * (las de rules.js), reasons, score (0–2), parts (0–1 por criterio), robustness { maxDelayDays, nextWindow },
 * viableInWindow y landings (cada fecha probada: { t, verdict, reason, streak }).
 */
export function bestLandings({ windowsBySite, sites, from, to, mission, priority }) {
  const profile = missionProfile(mission);
  const weights = (PRIORITIES.find((p) => p.id === priority) ?? PRIORITIES[0]).weights;
  const stepMs = RANK_STEP_HOURS * HOUR_MS;
  const n = Math.max(1, Math.floor((to - from) / stepMs) + 1);
  const extra = Math.ceil((LOOKAHEAD_DAYS * 24) / RANK_STEP_HOURS);
  const options = sites.map((site) => {
    const w = windowsBySite[site.id];
    // 1. Cada aterrizaje posible de la ventana, y unos días más para medir la racha.
    const cand = [];
    for (let i = 0; i < n + extra; i++) {
      const t = from + i * stepMs, e = evaluate(w, profile, t);
      cand.push({ t, e, ...describe(e) });
    }
    // 2. Racha: cuántos aterrizajes seguidos siguen siendo viables desde cada uno.
    for (let i = cand.length - 1; i >= 0; i--) cand[i].streak = cand[i].verdict === VERDICT.VIABLE ? 1 + (cand[i + 1]?.streak ?? 0) : 0;
    // 3. Puntuación de los de la ventana; se queda el mejor (el primero, si empatan).
    let best = null;
    for (let i = 0; i < n; i++) {
      const k = cand[i], f = figures(k.e);
      const robustDays = Math.max(0, ((k.streak - 1) * RANK_STEP_HOURS) / 24);
      const parts = {
        energy: 0.5 * (1 - Math.min(1, f.shadowHours / Math.max(1, mission.batteryHours))) + 0.5 * f.sunPct / 100,
        comms: f.earthPct / 100,
        early: 1 - i / Math.max(1, n - 1),
        delays: Math.min(1, robustDays / 7),
      };
      const score = BASE[k.verdict] + weights.e * parts.energy + weights.c * parts.comms + weights.a * parts.early + weights.r * parts.delays;
      if (!best || score > best.score) best = { ...k, i, f, score, parts };
    }
    // 4. Siguiente aterrizaje viable cuando se acaba esta racha.
    let next = null;
    for (let j = best.i + Math.max(1, best.streak); j < cand.length; j++) if (cand[j].verdict === VERDICT.VIABLE) { next = cand[j].t; break; }
    // El margen ante retrasos, el de replan.js (cada 6 h): el mismo número que da Replanificar.
    const maxDelayDays = best.verdict === VERDICT.VIABLE ? marginDays(w, profile, best.t).days : 0;
    return {
      siteId: site.id,
      landing: best.t,
      verdict: best.verdict,
      reason: best.reason,
      trace: best.trace,
      metrics: best.e.metrics,
      reasons: landingReasons({ verdict: best.verdict, reason: best.reason, shadowHours: best.f.shadowHours, earthPct: best.f.earthPct, robustDays: maxDelayDays }, mission),
      score: best.score,
      parts: best.parts,
      robustness: { maxDelayDays, nextWindow: next },
      viableInWindow: cand.slice(0, n).filter((x) => x.verdict === VERDICT.VIABLE).length,
      landings: cand.slice(0, n).map((x) => ({ t: x.t, verdict: x.verdict, reason: x.reason, streak: x.streak })),
    };
  });
  options.sort((a, b) => b.score - a.score);
  return { stepHours: RANK_STEP_HOURS, tested: n * sites.length, options };
}
