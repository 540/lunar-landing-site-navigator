// Landing timeline of Plan (#132): span, positions, keyboard, day verdicts and the Sun area.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  timelineSpan, fractionOf, missionWindow, landingAt, landingForKey, dayVerdict, dayLanding, verdictRuns,
  sunHeights, areaPath, visibleRuns, reasonStart, firstReason,
} from '../js/common/timeline.js';

const H = 36e5, D = 864e5, NOV1 = Date.UTC(2026, 10, 1);

test('la línea cubre la ventana buscada más una misión, desde el primer día a las 00:00', () => {
  const span = timelineSpan({ from: NOV1, to: NOV1 + 9 * D + 12 * H, days: 10 });
  assert.equal(span.start, NOV1);
  assert.equal(span.landingDays, 10);
  assert.equal(span.totalHours, 20 * 24);
  assert.equal(span.lastLanding, NOV1 + 10 * D - H);
});

test('si el aterrizaje en pantalla cae fuera de la ventana, la línea se estira hasta él', () => {
  const span = timelineSpan({ from: NOV1, to: NOV1 + 2 * D, days: 5, t0: NOV1 + 6 * D + 3 * H });
  assert.equal(span.landingDays, 7);
  assert.equal(span.lastLanding, NOV1 + 7 * D - H);
});

test('una posición da el aterrizaje a la hora en punto, dentro de los días de aterrizaje', () => {
  const span = timelineSpan({ from: NOV1, to: NOV1 + 9 * D, days: 10 });
  assert.equal(fractionOf(NOV1 + 48 * H, span), 0.1);
  assert.equal(landingAt(0.1, span), NOV1 + 48 * H);
  assert.equal(landingAt(0.1 + 0.4 / span.totalHours, span), NOV1 + 48 * H);
  assert.equal(landingAt(-0.2, span), NOV1);
  assert.equal(landingAt(0.9, span), span.lastLanding, 'la cola de la misión no admite aterrizajes');
});

test('la ventana de la misión va del aterrizaje al final de la misión y no se sale de la línea en los extremos', () => {
  const span = timelineSpan({ from: NOV1, to: NOV1 + 9 * D, days: 10 });
  assert.deepEqual(missionWindow(NOV1 + 48 * H, 10, span), { x: 0.1, w: 0.5 });
  assert.deepEqual(missionWindow(NOV1, 10, span), { x: 0, w: 0.5 }, 'primer día: empieza en el borde izquierdo');
  const last = missionWindow(span.lastLanding, 10, span);
  assert.ok(last.x + last.w <= 1, 'último aterrizaje: cabe entera');
  assert.equal(last.w, 0.5);
  const past = missionWindow(span.start + span.totalHours * H - 24 * H, 10, span);
  assert.ok(past.x + past.w <= 1 && past.w > 0, 'una vista previa más allá de la ventana se recorta al final');
  assert.deepEqual(missionWindow(NOV1 - 5 * D, 10, span), { x: 0, w: 0.5 }, 'antes del inicio, en el borde');
});

test('flechas, hora a hora; con Mayús, día a día; Inicio y Fin, primer y último aterrizaje', () => {
  const span = timelineSpan({ from: NOV1, to: NOV1 + 9 * D, days: 10 }), t0 = NOV1 + 3 * D;
  assert.equal(landingForKey(t0, 'ArrowRight', false, span), t0 + H);
  assert.equal(landingForKey(t0, 'ArrowLeft', false, span), t0 - H);
  assert.equal(landingForKey(t0, 'ArrowUp', true, span), t0 + D);
  assert.equal(landingForKey(t0, 'ArrowDown', true, span), t0 - D);
  assert.equal(landingForKey(t0, 'Home', false, span), NOV1);
  assert.equal(landingForKey(t0, 'End', false, span), span.lastLanding);
  assert.equal(landingForKey(NOV1, 'ArrowLeft', true, span), NOV1);
  assert.equal(landingForKey(t0, 'Enter', false, span), null);
});

test('el veredicto del día es el del selector de fechas: vale si vale alguna hora; si no, justo si alguna es justa', () => {
  const slots = codes => codes.map((code, i) => ({ t: NOV1 + i * 6 * H, code }));
  const own = codes => ({ slots: slots(codes), viable: codes.filter(c => c === 'viable').length, marginal: codes.filter(c => c === 'marginal').length });
  assert.equal(dayVerdict(own(['not_viable', 'viable', 'marginal', 'not_viable'])), 'viable');
  assert.equal(dayVerdict(own(['not_viable', 'marginal', 'not_viable', 'not_viable'])), 'marginal');
  assert.equal(dayVerdict(own(['not_viable', 'not_viable', 'not_viable', 'not_viable'])), 'not_viable');
  assert.equal(dayVerdict(undefined), null);
  assert.equal(dayLanding(own(['marginal', 'not_viable', 'viable', 'viable'])), NOV1 + 12 * H, 'pulsar el día aterriza a la primera hora que vale');
  assert.equal(dayLanding(own(['not_viable', 'marginal', 'not_viable', 'not_viable'])), NOV1 + 6 * H);
  assert.equal(dayLanding(own(['not_viable', 'not_viable', 'not_viable', 'not_viable'])), NOV1);
});

test('los días seguidos con el mismo veredicto se agrupan en tramos', () => {
  assert.deepEqual(verdictRuns(['viable', 'viable', 'marginal', 'not_viable', 'not_viable', 'viable']), [
    { code: 'viable', from: 0, to: 1 }, { code: 'marginal', from: 2, to: 2 }, { code: 'not_viable', from: 3, to: 4 }, { code: 'viable', from: 5, to: 5 },
  ]);
  assert.deepEqual(verdictRuns([]), []);
});

test('el área del Sol es su altura sobre el relieve y queda vacía cuando las ventanas dicen que no hay Sol', () => {
  const sky = margins => margins.map(margin => ({ sun: { margin } }));
  assert.deepEqual(sunHeights([1, 1, 0, 1], sky([2.5, 0.02, 3, -0.1])), [2.5, 0.1, 0, 0.1]);
  assert.deepEqual(sunHeights(new Uint8Array([0, 1]), null), [0, 0.1], 'sin el cielo hora a hora, el Sol sale al mínimo');
});

test('el área se dibuja por horas enteras y no pinta las horas sin Sol', () => {
  assert.equal(areaPath([0, 2, 1, 0, 0], 10, 2), 'M1 10L1 0L2 0L2 5L3 5L3 10Z');
  assert.equal(areaPath([4, 0, 1], 10, 2), 'M0 10L0 0L1 0L1 10ZM2 10L2 5L3 5L3 10Z', 'lo que pasa del tope se recorta');
  assert.equal(areaPath([0, 0], 10, 2), '');
});

test('las horas con la Tierra a la vista se agrupan en barras', () => {
  assert.deepEqual(visibleRuns([1, 1, 0, 0, 1, 0, 1]), [[0, 2], [4, 5], [6, 7]]);
  assert.deepEqual(visibleRuns(new Uint8Array(3)), []);
});

test('el motivo de una sombra o de un hueco sin Tierra dice cuándo empieza', () => {
  const r = { longestShadowStart: 1, longestEarthOutageStart: 2 };
  assert.equal(reasonStart('Por poco: Hueco más largo sin Tierra: 26 h (máximo 24 h)', r), 2);
  assert.equal(reasonStart('Sombra más larga: 80 h (la batería aguanta 72 h)', r), 1);
  assert.equal(reasonStart('El Sol no se ve al aterrizar', r), null);
  assert.equal(reasonStart('Sombra más larga: 80 h (la batería aguanta 72 h); Hueco más largo sin Tierra: 26 h (máximo 24 h)', r), null, 'con varios motivos no se sabe de cuál es la fecha');
});

test('de varios motivos se queda el primero y cuenta los demás', () => {
  assert.deepEqual(firstReason('A; B; C'), { text: 'A', more: 2 });
  assert.deepEqual(firstReason('El Sol no se ve al aterrizar'), { text: 'El Sol no se ve al aterrizar', more: 0 });
});
