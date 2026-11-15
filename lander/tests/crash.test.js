import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crashEffects, CRASH_CARD_S } from '../src/sim/crash.js';

const samples = (opts) => Array.from({ length: Math.round(CRASH_CARD_S * 60) }, (_, i) => crashEffects(i / 60, opts));

test('estrellarse se nota: destello, sacudida, chispas, cristal roto, humo y luces de emergencia', () => {
  const s = samples();
  assert.ok(Math.max(...s.map(e => e.flash)) > 0.95, 'destello casi blanco');
  assert.ok(s[1].shake > 0.9, 'sacudida fuerte al principio');
  assert.ok(s.at(-1).shake < s[1].shake / 3, 'y se calma antes de la tarjeta');
  assert.ok(s.some(e => e.sparks) && !s.at(-1).sparks, 'chispas solo al principio');
  assert.equal(s.at(-1).cracks, 1);
  assert.ok(s.at(-1).smoke > 0.5, 'la cabina se llena de humo');
  const lamps = new Set(s.slice(60).map(e => e.emergency));
  assert.ok(lamps.has(1) && [...lamps].some(v => v < 0.5), 'las luces rojas parpadean');
});

test('con movimiento reducido: sin sacudida, sin parpadeo y el destello es un fundido', () => {
  const s = samples({ reduced: true });
  assert.ok(s.every(e => e.shake === 0), 'nada se sacude');
  assert.ok(s.every(e => !e.sparks), 'sin chispas');
  for (let i = 1; i < s.length; i++) {
    for (const k of ['flash', 'emergency', 'smoke', 'cracks']) {
      assert.ok(Math.abs(s[i][k] - s[i - 1][k]) < 0.05, `${k} cambia sin saltos (fotograma ${i})`);
    }
  }
  assert.ok(s.at(-1).emergency > 0.5, 'la luz de emergencia queda fija');
  assert.ok(Math.max(...s.map(e => e.flash)) < 0.6, 'destello suave');
});

test('antes del impacto no hay efectos', () => {
  assert.deepEqual(crashEffects(-1), { flash: 0, shake: 0, smoke: 0, emergency: 0, cracks: 0, sparks: false });
  assert.deepEqual(crashEffects(NaN), crashEffects(-1));
});
