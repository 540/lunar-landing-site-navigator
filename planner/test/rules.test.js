import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { intersect } from '../src/intervals.js';
import { PROFILES } from '../src/profiles.js';
import { VERDICT, evaluate, evaluateAt, evaluateRange, fromApi, landingWindows, launchDate, nextViable } from '../src/rules.js';

const H = 3600e3;
const T0 = Date.parse('2027-01-01T00:00:00Z');
const at = (hours) => T0 + hours * H;
const iso = (hours) => new Date(at(hours)).toISOString();

// Ventanas hechas a mano, en horas desde T0. Por defecto, la Tierra se ve siempre.
function windows({ sun, earth, hours = 400, site = {} }) {
  const toMs = (list) => list.map(([a, b]) => [at(a), at(b)]);
  const s = toMs(sun), e = toMs(earth ?? [[0, hours]]);
  return {
    site: { id: 'test', name: 'Sitio de prueba', latDeg: 10, lonDeg: 20, horizonModel: 'sphere', ...site },
    startMs: at(0), endMs: at(hours), sunMode: 'full', earthMode: 'full',
    sun: s, earth: e, sunAndEarth: intersect(s, e),
  };
}

// Misión de 1 día con solo R1 y R4 (batería de 8 h) activas, para aislar cada caso.
function profile(changes = {}, rules = {}) {
  return {
    durationDays: 1, marginalMargin: 0.1, toleranceDays: 0, transitDays: 5,
    rules: {
      R1: { active: true }, R2: { active: false },
      R3: { active: false, threshold: 0 }, R4: { active: true, threshold: 8 },
      R5: { active: false, threshold: 0 }, R6: { active: false, threshold: 0 }, R7: { active: false, threshold: 0 },
      ...rules,
    },
    ...changes,
  };
}
const rule = (r, id) => r.rules.find((x) => x.id === id);

test('R4 falla si la sombra más larga supera la autonomía de la batería', () => {
  const r = evaluate(windows({ sun: [[0, 4], [14, 400]] }), profile(), at(0));
  assert.equal(r.metrics.longestShadowHours, 10);
  assert.equal(r.metrics.longestShadowStart, iso(4));
  assert.equal(r.verdict, VERDICT.NOT_VIABLE);
  assert.equal(r.limiting.id, 'R4');
});

test('la sombra que empezó antes del aterrizaje o sigue tras la misión solo cuenta dentro de ella', () => {
  const antes = evaluateAt(windows({ sun: [[20, 400]] }), profile(), at(14));
  assert.equal(antes.metrics.longestShadowHours, 6);
  const despues = evaluateAt(windows({ sun: [[0, 20]] }), profile(), at(0));
  assert.equal(despues.metrics.longestShadowHours, 4, 'de la hora 20 al final de la misión, en la 24');
});

test('cumplir con menos de un 10 % de margen da veredicto marginal', () => {
  const p = profile({}, { R4: { active: true, threshold: 10.5 } });
  const r = evaluate(windows({ sun: [[0, 1], [11, 400]] }), p, at(0));
  assert.equal(r.verdict, VERDICT.MARGINAL);
  assert.equal(r.limiting.id, 'R4');
  assert.ok(Math.abs(r.limiting.margin - 0.5 / 10.5) < 1e-12);
});

test('aterrizar a oscuras falla R1 y dice cuánto falta para que salga el Sol', () => {
  const r = evaluate(windows({ sun: [[1, 400]] }), profile(), at(0));
  assert.equal(rule(r, 'R1').passes, false);
  assert.equal(r.verdict, VERDICT.NOT_VIABLE);
  assert.equal(r.metrics.hoursToSunrise, 1);
  assert.match(rule(r, 'R1').reason, /sale en 1 h/);
});

test('una regla desactivada se informa, pero no cambia el veredicto', () => {
  const r = evaluate(windows({ sun: [[0, 400]], earth: [] }), profile(), at(0));
  assert.equal(rule(r, 'R2').passes, false);
  assert.equal(rule(r, 'R2').active, false);
  assert.equal(r.verdict, VERDICT.VIABLE);
});

test('si el periodo consultado no cubre la misión, el veredicto es «sin datos» y no «no viable»', () => {
  const w = windows({ sun: [[0, 30]], hours: 30 });
  assert.equal(evaluate(w, profile(), at(10)).verdict, VERDICT.NO_DATA);
  assert.equal(evaluate(w, profile(), at(-1)).verdict, VERDICT.NO_DATA);
  assert.equal(evaluate(w, profile(), at(6)).verdict, VERDICT.VIABLE, 'la misión acaba justo donde acaban los datos');
});

test('una ventana que llega al final de los datos da un mínimo de luz, no su duración real', () => {
  const p = profile({}, { R3: { active: true, threshold: 48 } });
  const abierta = evaluate(windows({ sun: [[0, 400]] }), p, at(0));
  assert.equal(abierta.metrics.sunlightAfterLandingHours, 400);
  assert.equal(abierta.metrics.sunlightAfterLandingOpen, true);
  assert.match(rule(abierta, 'R3').reason, /^Al menos/);
  const cerrada = evaluate(windows({ sun: [[0, 100]] }), profile({}, { R3: { active: true, threshold: 48 }, R4: { active: false, threshold: 8 } }), at(0));
  assert.equal(cerrada.metrics.sunlightAfterLandingOpen, false);
  assert.equal(cerrada.metrics.sunlightAfterLandingHours, 100);
});

test('las fracciones de sol y de sol con Tierra se miden sobre la misión', () => {
  const p = profile({}, { R4: { active: false, threshold: 8 }, R5: { active: true, threshold: 0.5 }, R7: { active: true, threshold: 0.25 } });
  const r = evaluate(windows({ sun: [[0, 18]], earth: [[12, 400]] }), p, at(0));
  assert.equal(r.metrics.sunFraction, 0.75);
  assert.equal(r.metrics.sunAndEarthFraction, 0.25);
  assert.equal(r.verdict, VERDICT.MARGINAL, 'R7 se cumple justo en el umbral: margen 0');
  assert.equal(r.limiting.id, 'R7');
});

test('R6 mide el hueco más largo sin Tierra dentro de la misión', () => {
  const p = profile({}, { R4: { active: false, threshold: 8 }, R6: { active: true, threshold: 5 } });
  const r = evaluate(windows({ sun: [[0, 400]], earth: [[0, 3], [10, 400]] }), p, at(0));
  assert.equal(r.metrics.longestEarthOutageHours, 7);
  assert.equal(r.verdict, VERDICT.NOT_VIABLE);
  assert.equal(r.limiting.id, 'R6');
});

test('con tolerancia de fecha manda el peor aterrizaje dentro del margen', () => {
  const w = windows({ sun: [[7, 400]] });
  const p = profile({ toleranceDays: 0.25 });
  assert.equal(evaluateAt(w, p, at(12)).verdict, VERDICT.VIABLE);
  const r = evaluate(w, p, at(12));
  assert.equal(r.verdict, VERDICT.NOT_VIABLE);
  assert.equal(r.worstCase.t0, iso(6), 'seis horas antes aún es de noche');
  assert.equal(r.t0, iso(12), 'el resultado sigue hablando de la fecha pedida');
  assert.equal(evaluate(w, p, at(18)).worstCase, null);
});

test('evaluateRange y landingWindows agrupan las fechas candidatas por veredicto', () => {
  const w = windows({ sun: [[13, 400]] });
  const grupos = landingWindows(evaluateRange(w, profile(), at(0), at(48)));
  assert.deepEqual(grupos.map((g) => [g.verdict, g.firstT0, g.lastT0, g.count]), [
    [VERDICT.NOT_VIABLE, iso(0), iso(12), 3],
    [VERDICT.VIABLE, iso(18), iso(42), 5],
  ]);
});

test('nextViable salta lo que no cumple y, si no hay nada viable, da lo marginal', () => {
  assert.equal(nextViable(windows({ sun: [[13, 400]] }), profile(), at(0), 2).t0, iso(18));
  const justo = profile({}, { R4: { active: true, threshold: 10.5 } });
  const r = nextViable(windows({ sun: [[0, 1], [11, 30]], hours: 30 }), justo, at(0), 1);
  assert.equal(r.verdict, VERDICT.MARGINAL);
  assert.equal(nextViable(windows({ sun: [] }), profile(), at(0), 2), null);
});

test('sin relieve, todo veredicto es provisional y lleva su aviso; con máscara, no', () => {
  const liso = evaluate(windows({ sun: [[0, 400]] }), profile(), at(0));
  assert.equal(liso.provisional, true);
  assert.equal(liso.warnings[0].code, 'no-terrain');
  assert.match(liso.warnings[0].message, /Lejos de los polos/);
  const polar = evaluate(windows({ sun: [[0, 400]], site: { latDeg: -89.45 } }), profile(), at(0));
  assert.match(polar.warnings[0].message, /optimista/);
  const conRelieve = evaluate(windows({ sun: [[0, 400]], site: { horizonModel: 'mask' } }), profile(), at(0));
  assert.equal(conRelieve.provisional, false);
  assert.deepEqual(conRelieve.warnings, []);
});

test('launchDate resta el viaje del perfil', () => {
  assert.equal(launchDate('2027-01-15T00:00:00.000Z', { transitDays: 5 }), '2027-01-10T00:00:00.000Z');
});

// ── Contra respuestas reales de la API de datos, grabadas en test/fixtures ──────────────────────────────────────
// Para regrabarlas, con la API arrancada (npm start en data/). test/integration.test.js comprueba que siguen al día:
//   curl 'localhost:3100/v1/windows?site=<id>&start=2027-01-01&end=2027-07-01&mode=<mode>' | python3 -m json.tool

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const FIXTURES = ['windows-apollo11-full', 'windows-im1-full', 'windows-shackleton-rim-full', 'windows-shackleton-rim-center'];
const clps = PROFILES['clps-lunar-day'];

test('fromApi entiende las respuestas reales y su cruce coincide con el sunAndEarth de la API', () => {
  for (const name of FIXTURES) {
    const api = fixture(name);
    const w = fromApi(api);
    assert.equal(w.sun.length, api.sun.summary.count, name);
    assert.equal(w.earth.length, api.earth.summary.count, name);
    assert.equal(w.sunAndEarth.length, api.sunAndEarth.windows.length, name);
    w.sunAndEarth.forEach(([a, b], k) => {
      assert.ok(Math.abs(a - Date.parse(api.sunAndEarth.windows[k].start)) <= 1000, `${name}: inicio de la ventana ${k}`);
      assert.ok(Math.abs(b - Date.parse(api.sunAndEarth.windows[k].end)) <= 1000, `${name}: fin de la ventana ${k}`);
    });
  }
});

test('fromApi cruza dos respuestas con distinto mode y rechaza las que no casan', () => {
  const w = fromApi(fixture('windows-shackleton-rim-center'), fixture('windows-shackleton-rim-full'));
  assert.equal(w.sunMode, 'center');
  assert.equal(w.earthMode, 'full');
  assert.equal(w.sun.length, 1);
  assert.deepEqual(w.sunAndEarth, intersect(w.sun, w.earth));
  assert.throws(() => fromApi(fixture('windows-apollo11-full'), fixture('windows-im1-full')), /mismo sitio/);
  assert.throws(() => fromApi({ site: {} }), /forma de \/v1\/windows/);
});

test('fromApi lleva earthDsn (dsn=1, API 1.24.0) solo si la respuesta lo trae, y no cambia el veredicto', () => {
  const api = fixture('windows-apollo11-full');
  assert.ok(!('earthDsn' in fromApi(api)));
  const earthDsn = { summary: { count: 1, totalHours: 1, fractionOfTime: 0, longestWindowHours: 1 }, windows: [{ start: api.start, end: new Date(Date.parse(api.start) + H).toISOString() }] };
  const w = fromApi({ ...api, earthDsn });
  assert.deepEqual(w.earthDsn, [[Date.parse(api.start), Date.parse(api.start) + H]]);
  const t = Date.parse('2027-01-13T12:00:00Z');
  assert.deepEqual(evaluate(w, clps, t), evaluate(fromApi(api), clps, t));
});

test('Apollo 11: aterrizar al amanecer es viable; a mitad del día lunar, la noche llega antes de acabar', () => {
  const w = fromApi(fixture('windows-apollo11-full'));
  // El Sol sale (disco entero) el 13 de enero a las 07:23 y se pone el 28 a las 02:07.
  const amanecer = evaluate(w, clps, Date.parse('2027-01-13T12:00:00Z'));
  assert.equal(amanecer.verdict, VERDICT.VIABLE);
  assert.equal(amanecer.metrics.longestShadowHours, 0);

  const mitad = evaluate(w, clps, Date.parse('2027-01-20T00:00:00Z'));
  assert.equal(mitad.verdict, VERDICT.NOT_VIABLE);
  assert.equal(mitad.limiting.id, 'R4');
  const esperado = (Date.parse('2027-02-01T00:00:00Z') - Date.parse('2027-01-28T02:07:14.619Z')) / H;
  assert.ok(Math.abs(mitad.metrics.longestShadowHours - esperado) < 1e-6, 'del ocaso al final de la misión');
});

test('Apollo 11: en cada día lunar hay una ventana de aterrizaje, y empieza con el amanecer', () => {
  const w = fromApi(fixture('windows-apollo11-full'));
  const hasta = w.endMs - clps.durationDays * 24 * H;
  const viables = landingWindows(evaluateRange(w, clps, w.startMs, hasta)).filter((g) => g.verdict === VERDICT.VIABLE);
  assert.equal(viables.length, 6, 'seis amaneceres entre enero y junio');
  for (const g of viables) {
    const dia = w.sun.find(([a, b]) => a <= Date.parse(g.firstT0) && Date.parse(g.firstT0) < b);
    assert.ok(dia, 'la ventana cae dentro de un día lunar');
    assert.ok(Date.parse(g.firstT0) - dia[0] < 6 * H, 'se abre en la primera fecha candidata tras el orto');
    // Con 12 días de misión y 36 h de batería, la última fecha válida deja como mucho 36 h de noche al final.
    assert.ok(Date.parse(g.lastT0) + clps.durationDays * 24 * H <= dia[1] + clps.rules.R4.threshold * H);
  }
});

test('borde de Shackleton en invierno: no viable, y el aviso de relieve es el de los polos', () => {
  const w = fromApi(fixture('windows-shackleton-rim-full'));
  const r = evaluate(w, clps, Date.parse('2027-01-15T00:00:00Z'));
  assert.equal(r.verdict, VERDICT.NOT_VIABLE);
  assert.equal(r.limiting.id, 'R4');
  assert.equal(r.provisional, true);
  assert.match(r.warnings[0].message, /cerca del polo/);
});

test('R8 falla si la Tierra se ve menos parte de la misión que el umbral', () => {
  const p = profile({}, { R1: { active: false }, R4: { active: false, threshold: 8 }, R8: { active: true, threshold: 0.5 } });
  const r = evaluate(windows({ sun: [[0, 400]], earth: [[0, 6], [20, 400]] }), p, at(0));
  assert.equal(r.metrics.earthFraction, 10 / 24);
  assert.equal(r.verdict, VERDICT.NOT_VIABLE);
  assert.equal(r.limiting.id, 'R8');
  assert.match(r.limiting.reason, /Tierra visible el 42 % de la misión \(mínimo 50 %\)/);
});

test('una regla que el perfil no nombra se informa sin umbral, no con «NaN»', () => {
  // The bundled profiles do not name R8: its threshold is undefined and the reason used to say '(mínimo NaN %)'.
  const r = evaluate(windows({ sun: [[0, 400]], earth: [[0, 12], [20, 400]] }), profile(), at(0));
  const r8 = rule(r, 'R8');
  assert.equal(r8.active, false);
  assert.equal(r8.reason, 'Tierra visible el 67 % de la misión');
  for (const x of r.rules) assert.doesNotMatch(x.reason, /NaN/, x.id);
});

describe('R9 · pendiente, con lo que da la API (slope=1, maxSlopeDeg)', () => {
  const p = profile({}, { R9: { active: true, threshold: 10 } });
  const conPendiente = (slope) => ({ ...windows({ sun: [[0, 400]] }), slope });
  const fina = { slopeDeg: 3.03, slopeBaselineM: 100, requestedBaselineM: 100, demResolutionM: 20, underestimated: false, meetsMaxSlope: true };

  test('certificada con el DEM fino: cumple con su margen', () => {
    const r = evaluate(conPendiente(fina), p, at(0));
    assert.equal(rule(r, 'R9').passes, true);
    assert.ok(Math.abs(rule(r, 'R9').margin - (10 - 3.03) / 10) < 1e-12);
    assert.equal(rule(r, 'R9').reason, 'Pendiente de 3° en 100 m (máximo 10°)');
    assert.equal(r.verdict, VERDICT.VIABLE);
  });

  test('por encima del máximo falla, también si está subestimada', () => {
    assert.equal(evaluate(conPendiente({ ...fina, slopeDeg: 12.5, meetsMaxSlope: false }), p, at(0)).verdict, VERDICT.NOT_VIABLE);
    const gruesa = { ...fina, slopeDeg: 13.5, slopeBaselineM: 687, demResolutionM: 240, underestimated: true, meetsMaxSlope: false };
    assert.equal(evaluate(conPendiente(gruesa), p, at(0)).verdict, VERDICT.NOT_VIABLE);
  });

  test('subestimada (DEM grueso) o sin datos: sin certificar, nunca apta', () => {
    const gruesa = { ...fina, slopeDeg: 3.7, slopeBaselineM: 674, demResolutionM: 240, underestimated: true, meetsMaxSlope: true };
    for (const slope of [gruesa, { ...fina, slopeDeg: null, meetsMaxSlope: null }, null]) {
      const r = evaluate(conPendiente(slope), p, at(0));
      assert.equal(rule(r, 'R9').passes, null);
      assert.equal(r.verdict, VERDICT.MARGINAL, 'no puede ser viable');
      assert.equal(r.limiting.id, 'R9');
      assert.equal(r.provisional, true);
      assert.ok(r.warnings.some((w) => w.code === 'uncertified'));
    }
    assert.match(rule(evaluate(conPendiente(gruesa), p, at(0)), 'R9').reason, /DEM de 240 m\/px no se puede certificar en 100 m/);
  });
});

test('el resultado dice con qué horizonte se calculó y solo es firme con relieve', () => {
  const liso = evaluate(windows({ sun: [[0, 400]] }), profile(), at(0));
  assert.deepEqual(liso.horizon, { model: 'sphere' });
  const w = { ...windows({ sun: [[0, 400]], site: { horizonModel: 'mask' } }), terrain: { observerHeightM: 2, panelHeightM: 2, antennaHeightM: 10, applied: true } };
  const r = evaluate(w, profile(), at(0));
  assert.deepEqual(r.horizon, { model: 'mask', panelHeightM: 2, antennaHeightM: 10 });
  assert.equal(r.provisional, false);
  const pedido = evaluate({ ...windows({ sun: [[0, 400]] }), terrain: { applied: false, note: 'Fuera del DEM.' } }, profile(), at(0));
  assert.match(pedido.warnings[0].message, /Se pidió relieve, pero la API no lo aplicó: Fuera del DEM\./);
});

test('los avisos de la API pasan a la salida, sin repetir el de Luna lisa', () => {
  const api = fixture('windows-shackleton-rim-full');
  assert.equal(api.warnings[0].code, 'smooth_moon_polar');
  const otro = { code: 'outside_validated_dates', message: 'Fuera de 2026–2030.' };
  const w = fromApi({ ...api, warnings: [...api.warnings, otro] }, { ...fixture('windows-shackleton-rim-full'), warnings: [otro] });
  assert.deepEqual(w.apiWarnings, [otro], 'smooth_moon_polar ya lo da «no-terrain», y el repetido sale una vez');
  const r = evaluate(w, clps, Date.parse('2027-01-15T00:00:00Z'));
  assert.deepEqual(r.warnings.map((x) => x.code), ['no-terrain', 'api:outside_validated_dates']);
  assert.equal(r.warnings[1].message, 'API · Fuera de 2026–2030.');
});
