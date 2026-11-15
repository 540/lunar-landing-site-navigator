// J7: the end with the figures of the game and the link to the Mirador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endSummary, endAnnouncement, viewpointUrl } from '../src/end.js';
import { texts } from '../src/texts.js';
import { regionFromSearch, dayFromSearch } from '../../viewpoint/src/core/regions.js';
import { startFromSearch, WINDOW_DAYS } from '../../viewpoint/src/core/timeline.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const levels = JSON.parse(readFileSync(join(root, 'data/levels.json'), 'utf8'));
const scenario = JSON.parse(readFileSync(join(root, 'data/procedural-shackleton/scenario.json'), 'utf8'));
const ES = texts('es');
const EN = texts('en');
const ended = (over, t, battery, extra = {}) => ({ over, t, battery, sent: 3, level: levels.beg, ...extra });
const why = (s, T = ES) => T.end[s.over].why(endSummary(s));

// ---- J7.1 ----

test('ganar: día, hora, batería y paquetes con el reloj del panel', () => {
  const s = ended('win', 206.5, 32.7);
  assert.deepEqual(endSummary(s), { over: 'win', day: 9, hour: 14, battery: 32, sent: 3, need: 3, packetsDone: true, deadlineDay: 14, minBat: 15 });
  assert.equal(why(s), 'Llegaste el día 9 · 14:00 con 32 % de batería y 3 paquetes enviados. Control de misión recibió tu informe y autorizó el despegue.');
});

test('sin batería: el día y la hora en que se quedó sin energía', () => {
  assert.equal(why(ended('battery', 99, 0)), 'El rover se quedó sin energía el día 5 · 03:00. En sombra, la calefacción vacía la batería aunque no te muevas.');
});

test('sin tiempo: faltan paquetes, o los envió y no llegó con batería suficiente', () => {
  assert.equal(why(ended('time', 336, 40, { sent: 2 })), 'Se acabaron los 14 días con 2 de 3 paquetes enviados: sin tu informe completo, control de misión no autorizó el despegue.');
  assert.equal(why(ended('time', 336, 10)), 'Se acabaron los 14 días sin llegar a ASCENSO con al menos 15 % de batería.');
});

test('sin paquetes en el estado, ningún texto los menciona', () => {
  for (const over of ['win', 'battery', 'time']) {
    const s = ended(over, 50, 20, { sent: undefined });
    assert.equal(endSummary(s).sent, null);
    assert.doesNotMatch(why(s), /paquete/);
    assert.doesNotMatch(why(s, EN), /packet/);
  }
});

test('los textos usan las cifras del nivel', () => {
  assert.match(why(ended('time', 240, 10, { level: levels.exp, sent: 5 })), /^Se acabaron los 10 días sin llegar a ASCENSO con al menos 25 % de batería\.$/);
  assert.match(why(ended('time', 240, 10, { level: levels.exp, sent: 1 })), /1 de 5 paquetes/);
  assert.equal(why(ended('win', 30, 50, { sent: 1 })), 'Llegaste el día 2 · 06:00 con 50 % de batería y 1 paquete enviado. Control de misión recibió tu informe y autorizó el despegue.');
});

test('el anuncio es título y explicación, también en inglés', () => {
  const s = ended('win', 206.5, 32.7);
  assert.equal(endAnnouncement(s, ES), 'Despegue confirmado. Llegaste el día 9 · 14:00 con 32 % de batería y 3 paquetes enviados. Control de misión recibió tu informe y autorizó el despegue.');
  assert.equal(endAnnouncement(s, EN), 'Lift-off confirmed. You arrived on day 9 · 14:00 with 32% battery and 3 packets sent. Mission control got your report and cleared the lift-off.');
});

// ---- J7.4 ----

const sc = (extra = {}) => ({ siteId: 'shackleton-rim', startUtc: '2027-08-21T10:00:00.000Z', ...extra });

test('viewpointUrl: región, día de inicio y el instante del final', () => {
  assert.equal(viewpointUrl(sc(), 38), '../viewpoint/?region=shackleton-rim&start=2027-08-21&day=2');
  assert.equal(viewpointUrl(sc(), 0), '../viewpoint/?region=shackleton-rim&start=2027-08-21&day=0.417');
  assert.equal(viewpointUrl(scenario, 0), `../viewpoint/?region=${scenario.siteId}&start=${scenario.startUtc.slice(0, 10)}&day=0.417`);
});

test('viewpointUrl: null con una región que el Mirador no tiene o una fecha fuera de su rango', () => {
  assert.equal(viewpointUrl(sc({ siteId: 'mons-mouton' }), 10), null);
  assert.equal(viewpointUrl(sc({ startUtc: '2028-03-01T00:00:00.000Z' }), 10), null);
  assert.equal(viewpointUrl(sc({ startUtc: 'no es una fecha' }), 10), null);
});

test('lo que genera viewpointUrl lo leen igual las funciones del Mirador', () => {
  const search = viewpointUrl(sc(), 38).split('?')[1];
  assert.equal(regionFromSearch(`?${search}`, () => assert.fail('región desconocida')), 'shackleton-rim');
  assert.equal(startFromSearch(`?${search}`, 'fallback'), '2027-08-21');
  assert.equal(dayFromSearch(`?${search}`, WINDOW_DAYS), 2);
});
