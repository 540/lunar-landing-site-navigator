import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intersect } from '../src/intervals.js';
import { VERDICT, missionMetrics } from '../src/rules.js';
import { DEFAULT_RADIUS_KM, delaySweep, distanceKm, marginDays, missionTimeline, replanOptions } from '../src/replan.js';

const H = 3600e3;
const T0 = Date.parse('2027-01-01T00:00:00Z');
const at = (hours) => T0 + hours * H;
const HOURS = 2400;

// Cuatro sitios con las coordenadas del catálogo de la interfaz: a 4, 52 y 134 km de la cresta.
const SITES = [
  { id: 'ridge', name: 'Cresta', latDeg: -89.45, lonDeg: -137.3 },
  { id: 'slope', name: 'Ladera', latDeg: -89.463, lonDeg: -151.2 },
  { id: 'gerlache', name: 'de Gerlache', latDeg: -87.97, lonDeg: -87.1 },
  { id: 'malapert', name: 'Malapert', latDeg: -86.0, lonDeg: 0.0 },
];

// Ventanas hechas a mano, en horas desde T0. Por defecto, la Tierra se ve siempre.
function windows(site, sun, earth = [[0, HOURS]]) {
  const toMs = (list) => list.map(([a, b]) => [at(a), at(b)]);
  const s = toMs(sun), e = toMs(earth);
  return { site: { ...site, horizonModel: 'simulated-terrain' }, startMs: at(0), endMs: at(HOURS), sun: s, earth: e, sunAndEarth: intersect(s, e) };
}
const DARK = [[HOURS - 1, HOURS]];

// Misión de 1 día: Sol y Tierra al aterrizar (R1, R2), batería de 8 h (R4) y Tierra ≥ 50 % (R8).
const PROFILE = {
  durationDays: 1, marginalMargin: 0.1, toleranceDays: 0, transitDays: 5,
  rules: { R1: { active: true }, R2: { active: true }, R4: { active: true, threshold: 8 }, R8: { active: true, threshold: 0.5 } },
};

function input(sun, changes = {}) {
  const windowsBySite = Object.fromEntries(SITES.map((s) => [s.id, windows(s, sun[s.id] ?? DARK, sun[s.id + 'Earth'])]));
  return {
    windowsBySite, sites: SITES, profile: PROFILE,
    original: { siteId: 'ridge', landingMs: at(0) },
    notBeforeMs: at(12), notAfterMs: at(200),
    ...changes,
  };
}

test('las distancias del catálogo: la ladera y de Gerlache entran en el radio por defecto y Malapert no', () => {
  const [ridge, slope, gerlache, malapert] = SITES;
  assert.ok(distanceKm(ridge, slope) < 5);
  assert.ok(distanceKm(ridge, gerlache) > 50 && distanceKm(ridge, gerlache) < DEFAULT_RADIUS_KM);
  assert.ok(distanceKm(ridge, malapert) > 130);
});

test('si el plan sigue siendo viable con el retraso, no se propone cambiarlo', () => {
  const r = replanOptions(input({ ridge: [[0, HOURS]] }));
  assert.equal(r.current.verdict, VERDICT.VIABLE);
  assert.equal(r.needed, false);
  assert.equal(r.a, null); assert.equal(r.b, null); assert.equal(r.c, null);
  assert.equal(r.current.totalDelayDays, 0.5, 'el retraso total se cuenta desde el plan original');
});

test('plan roto: A es el mismo sitio en su siguiente fecha, B otro sitio en la misma fecha y C el que antes vuelve', () => {
  const r = replanOptions(input({
    ridge: [[0, 10], [40, HOURS]],   // se apaga a las 10 h y vuelve a las 40 h
    slope: [[0, HOURS]],             // vale ya
    gerlache: [[30, HOURS]],         // vuelve a las 30 h: antes que la cresta
    malapert: [[0, HOURS]],          // vale, pero está fuera de la región
  }));
  assert.equal(r.needed, true);
  assert.notEqual(r.current.verdict, VERDICT.VIABLE);
  assert.equal(r.current.landingMs, at(12));

  assert.equal(r.a.site.id, 'ridge');
  assert.equal(r.a.landingMs, at(42), 'primera fecha candidata (cada 6 h desde las 12 h) con Sol');
  assert.equal(r.a.verdict, VERDICT.VIABLE);

  assert.equal(r.b.site.id, 'slope');
  assert.equal(r.b.landingMs, at(12));

  assert.equal(r.c.site.id, 'gerlache', 'la ladera ya vale en la fecha de B: no es una C');
  assert.equal(r.c.landingMs, at(30));
  assert.equal(r.c.improvesOnA, true);
  assert.equal(r.c.totalDelayDays, 30 / 24);

  assert.ok(!r.region.some((s) => s.id === 'malapert'));
  assert.equal(r.leastBad, null);
  assert.deepEqual(r.suggestions, []);
});

test('C no mejora a A si vuelve a valer más tarde', () => {
  const r = replanOptions(input({ ridge: [[0, 10], [40, HOURS]], gerlache: [[60, HOURS]] }));
  assert.equal(r.c.site.id, 'gerlache');
  assert.equal(r.c.improvesOnA, false);
  assert.equal(r.recommended.kind, 'a');
});

test('el radio decide qué sitios cuentan como región', () => {
  const sun = { ridge: DARK, malapert: [[0, HOURS]] };
  assert.equal(replanOptions(input(sun)).b, null);
  assert.equal(replanOptions(input(sun, { radiusKm: 150 })).b.site.id, 'malapert');
});

test('si nada vale, da la menos mala y sugiere ampliar la fecha límite o el radio', () => {
  const r = replanOptions(input({ ridge: [[300, HOURS]], malapert: [[0, HOURS]] }));
  assert.equal(r.a, null); assert.equal(r.b, null); assert.equal(r.c, null);
  assert.ok(r.leastBad);
  const deadline = r.suggestions.find((s) => s.kind === 'extend-deadline');
  assert.equal(deadline.site.id, 'ridge');
  assert.equal(deadline.untilMs, at(302), 'primera candidata con Sol tras la fecha límite (200 h + múltiplos de 6 h)');
  const radius = r.suggestions.find((s) => s.kind === 'widen-radius');
  assert.equal(radius.site.id, 'malapert');
  assert.equal(radius.radiusKm, 140);
});

test('no sugiere radios que ya no son la misma región', () => {
  const far = { id: 'apollo15', name: 'Apolo 15', latDeg: 26.13, lonDeg: 3.63 };
  const base = input({ ridge: [[300, HOURS]] });
  const r = replanOptions({ ...base, sites: [...SITES, far], windowsBySite: { ...base.windowsBySite, apollo15: windows(far, [[0, HOURS]]) } });
  assert.equal(r.suggestions.some((s) => s.kind === 'widen-radius'), false);
});

test('el margen cuenta cuántos días más se puede retrasar sin dejar de ser viable', () => {
  const w = windows(SITES[0], [[0, 60]]);
  // Misión de 24 h y batería de 8 h: vale mientras la misión acabe antes de las 68 h, es decir, hasta T0 = 42 h.
  assert.deepEqual(marginDays(w, PROFILE, at(0)), { days: 42 / 24, open: false });
  assert.equal(marginDays(windows(SITES[0], [[0, HOURS]]), PROFILE, at(0)).open, true);
});

test('la prioridad de la misión desempata entre opciones viables', () => {
  // Las dos valen. La ladera no tiene sombra pero pierde 1 h de Tierra; de Gerlache ve siempre la Tierra pero
  // tiene 2 h de sombra.
  const sun = {
    ridge: DARK,
    slope: [[0, HOURS]], slopeEarth: [[0, 15], [16, HOURS]],
    gerlache: [[0, 14], [16, HOURS]], gerlacheEarth: [[0, HOURS]],
  };
  assert.equal(replanOptions(input(sun)).b.site.id, 'slope', 'sin prioridad: a igual fecha, menos sombra');
  assert.equal(replanOptions(input(sun, { priority: 'energy' })).b.site.id, 'slope');
  assert.equal(replanOptions(input(sun, { priority: 'comms' })).b.site.id, 'gerlache');
});

test('cambiar el perfil (batería peor) puede romper un plan que valía', () => {
  const sun = { ridge: [[0, 20], [26, HOURS]] }; // 6 h de sombra en mitad de la misión
  assert.equal(replanOptions(input(sun, { notBeforeMs: at(0) })).needed, false);
  const weak = { ...PROFILE, rules: { ...PROFILE.rules, R4: { active: true, threshold: 4 } } };
  const r = replanOptions(input(sun, { notBeforeMs: at(0), profile: weak }));
  assert.equal(r.needed, true);
  assert.equal(r.current.evaluation.limiting.id, 'R4');
});

test('el barrido da un veredicto por sitio y día de retraso', () => {
  const { windowsBySite } = input({ ridge: [[0, 10], [40, HOURS]] });
  const s = delaySweep(windowsBySite, ['ridge'], PROFILE, at(0), 3);
  assert.equal(s.ridge.length, 4);
  assert.equal(s.ridge[0].verdict, VERDICT.NOT_VIABLE);
  assert.equal(s.ridge[2].verdict, VERDICT.VIABLE);
});

test('con días enteros, el barrido da el mejor veredicto de cada día UTC', () => {
  const { windowsBySite } = input({ ridge: [[0, 10], [42, HOURS]] }); // vuelve el Sol a las 18:00 del día 1
  const atNoon = delaySweep(windowsBySite, ['ridge'], PROFILE, at(12), 2);
  assert.equal(atNoon.ridge[1].verdict, VERDICT.NOT_VIABLE, 'a las 12:00 del día 1 aún no hay Sol');
  const whole = delaySweep(windowsBySite, ['ridge'], PROFILE, at(12), 2, { wholeDays: true });
  assert.equal(whole.ridge[1].verdict, VERDICT.VIABLE, 'pero a las 18:00 de ese día, sí');
  assert.equal(whole.ridge[1].t, at(42));
});

test('missionTimeline: la batería se vacía si y solo si la sombra más larga supera la autonomía', () => {
  // Sol hasta la hora 10, sombra de 10 a 22 (12 h) y Sol otra vez. Misión de 1 día desde T0.
  const w = windows(SITES[2], [[0, 10], [22, HOURS]]);
  const shadow = missionMetrics(w, at(0), 24 * H).longestShadowHours;
  assert.equal(shadow, 12);

  const short = missionTimeline(w, at(0), 24 * H, 8); // 8 h de batería: no llega
  assert.equal(short.emptyAtMs, at(18));              // justo 8 h después de que empiece la sombra (hora 10)
  assert.equal(short.minBattery, 0);
  assert.equal(short.steps.at(-1).battery, 1);        // con el Sol de vuelta, llena

  const enough = missionTimeline(w, at(0), 24 * H, 12); // 12 h: justo la aguanta
  assert.equal(enough.emptyAtMs, null);
  assert.equal(enough.steps.find((s) => s.t === at(15)).battery, 1 - 5 / 12);
  assert.equal(enough.steps.length, 25);
  assert.ok(enough.steps.every((s) => s.earth));
});

test('missionTimeline: con bordes fuera de la hora en punto, se vacía igual que falla R4', () => {
  // Sombra de 10:30 a 22:50 (12 h 20 min): ninguna muestra horaria pasa de 12 h a oscuras, pero R4 falla con 12 h.
  const w = windows(SITES[2], [[0, 10.5], [22 + 50 / 60, HOURS]]);
  const tl = missionTimeline(w, at(0), 24 * H, 12);
  assert.equal(tl.emptyAtMs, at(22.5));
  assert.equal(tl.minBattery, 0);
  assert.equal(missionTimeline(w, at(0), 24 * H, 12.5).emptyAtMs, null); // 12,5 h sí la aguanta
});
