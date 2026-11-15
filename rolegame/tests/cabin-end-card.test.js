// The cabin's end card (#398): in full screen the end panel beside the map is not seen, so the cabin says the end itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endCard, endCardDelay, endCardLabel, END_CARD_MS } from '../src/cabin/end-card.js';
import { LAUNCH_MS } from '../src/cabin/launch.js';
import { texts } from '../src/texts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = texts('es');
const TE = texts('en');
const summary = { day: 3, hour: 14, battery: 42, sent: 3, need: 3, packetsDone: true, deadlineDay: 14, minBat: 15 };

test('tarjeta del final: sin final no hay tarjeta', () => {
  assert.equal(endCardDelay({ over: null, plan: null }), null);
  assert.equal(endCardDelay({ over: undefined, plan: 'play' }), null);
});

test('tarjeta del final: al ganar sale cuando el despegue ha terminado, no encima de la cuenta atrás', () => {
  const ms = endCardDelay({ over: 'win', plan: 'play' });
  assert.ok(ms >= LAUNCH_MS, 'la tarjeta no tapa la nave antes de que se pierda en el cielo');
  assert.ok(ms <= LAUNCH_MS + 2000, 'ni tarda tanto que el jugador crea que no ha pasado nada');
});

test('tarjeta del final: con «Reducir movimiento» sale tras ver la imagen fija, y al perder casi en seguida', () => {
  assert.equal(endCardDelay({ over: 'win', plan: 'still' }), END_CARD_MS.still);
  assert.equal(endCardDelay({ over: 'win', plan: null }), END_CARD_MS.still);
  assert.ok(END_CARD_MS.still < LAUNCH_MS);
  for (const over of ['battery', 'time']) assert.equal(endCardDelay({ over, plan: null }), END_CARD_MS.lost);
  assert.ok(END_CARD_MS.lost <= 1500);
});

test('tarjeta del final: victoria con «¡Misión cumplida!», resumen y acciones en orden', () => {
  const card = endCard('win', summary, T);
  assert.equal(card.kind, 'win');
  assert.equal(card.kicker, '¡Misión cumplida!');
  assert.equal(card.title, T.end.win.title);
  assert.equal(card.why, T.end.win.why(summary));
  assert.match(card.why, /día 3 · 14:00/);
  assert.deepEqual(card.actions, ['result', 'replay', 'again', 'close']);
  assert.deepEqual(card.actions.map((a) => endCardLabel(a, T)), ['Ver el resultado', 'Ver el despegue', 'Jugar otra vez', 'Seguir mirando']);
});

test('tarjeta del final: la derrota se entera igual, sin «Ver el despegue»', () => {
  for (const over of ['battery', 'time']) {
    const card = endCard(over, summary, T);
    assert.equal(card.kind, 'lost');
    assert.equal(card.kicker, 'Misión fallida');
    assert.equal(card.title, T.end[over].title);
    assert.ok(!card.actions.includes('replay'));
    assert.equal(card.actions[0], 'result', 'el botón principal lleva al resultado');
  }
});

test('tarjeta del final: también en inglés, con todos los textos', () => {
  for (const over of ['win', 'battery', 'time']) {
    const card = endCard(over, summary, TE);
    for (const v of [card.kicker, card.title, card.why, ...card.actions.map((a) => endCardLabel(a, TE))]) assert.ok(typeof v === 'string' && v.length > 0, `${over}: ${v}`);
  }
  assert.equal(endCard('win', summary, TE).kicker, 'Mission accomplished!');
});

test('tarjeta del final: vive dentro de la pila que pasa a pantalla completa y se lleva el foco', () => {
  const src = readFileSync(join(root, 'src/cabin/panel.js'), 'utf8');
  assert.match(src, /stack\.append\([^)]*endBox[^)]*\)/, 'la tarjeta está en .map-stack, el elemento en pantalla completa');
  assert.match(src, /endActions\.querySelector\('button'\)\?\.focus/, 'el foco va al botón principal');
  assert.match(src, /'aria-labelledby', 'cabin-end-title'/);
  assert.match(src, /'aria-describedby', 'cabin-end-why'/);
});

test('al ganar, tras el despegue la cabina sale al resultado; al perder enseña la tarjeta', async () => {
  const { endStep } = await import('../src/cabin/end-card.js');
  assert.equal(endStep('win'), 'result');
  assert.equal(endStep('battery'), 'card');
  assert.equal(endStep('deadline'), 'card');
});
