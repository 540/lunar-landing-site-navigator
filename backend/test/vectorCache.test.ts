// withVectorCache (ephemeris.ts): the memo of the Sun/Earth vectors that the GraphQL layer uses per request. The results
// must be bit-identical with and without it, and a scope must not leak outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moonFixedVectors, vectorCacheStats, withVectorCache } from '../src/ephemeris.ts';
import { sweepLandingDates } from '../src/landingSweep.ts';
import { windows } from '../src/service.ts';
import { getSite } from '../src/sites.ts';

const HOUR = 3600e3, DAY = 86400e3, T0 = Date.UTC(2027, 0, 1);

test('mismos resultados con y sin la caché de vectores; dentro, cada instante se calcula una vez', () => {
  const im1 = getSite('im1')!, apollo = getSite('apollo11')!;
  const sweep = (site: typeof im1) => sweepLandingDates(site, { startMs: T0, endMs: T0 + 20 * DAY, dateStepMs: DAY, missionDays: 7, stepMs: HOUR, mode: 'limb' });
  const strip = ({ timingMs: _t, ...r }: ReturnType<typeof sweep>) => r;
  const plain = [strip(sweep(im1)), strip(sweep(apollo)), windows(im1, T0, T0 + 10 * DAY)];
  const before = vectorCacheStats();
  const cached = withVectorCache(() => [strip(sweep(im1)), strip(sweep(apollo)), windows(im1, T0, T0 + 10 * DAY)]);
  const after = vectorCacheStats();
  assert.deepEqual(cached, plain);
  const misses = after.misses - before.misses, hits = after.hits - before.hits;
  assert.equal(misses, 20 * 24 + 7 * 24 + 1 + 10 * 96 - 10 * 24, 'una vez por instante distinto (las horas en punto de windows ya estaban)');
  assert.ok(hits >= 27 * 24, `apollo11 reutiliza los instantes de im1 (${hits})`);
});

test('fuera de un ámbito no hay caché; los ámbitos se anidan', () => {
  const d = new Date(T0);
  const a = withVectorCache(() => {
    const x = moonFixedVectors(d);
    assert.equal(moonFixedVectors(d), x, 'mismo objeto dentro del ámbito');
    const inner = withVectorCache(() => moonFixedVectors(d));
    assert.notEqual(inner, x, 'el ámbito interior empieza vacío');
    assert.deepEqual(inner, x);
    assert.equal(moonFixedVectors(d), x, 'al salir del interior vuelve el exterior');
    return x;
  });
  assert.notEqual(moonFixedVectors(d), a);
  assert.deepEqual(moonFixedVectors(d), a);
  assert.deepEqual(withVectorCache(() => moonFixedVectors(d), 0), a, 'con 0 entradas no guarda nada');
});
