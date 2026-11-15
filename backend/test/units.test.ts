// Unit tests: parameters, horizon, visible fraction and window intersection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, parseDate, parseDuration, parseMode, parseRange, parseSite, parseSiteList } from '../src/params.ts';
import { horizonElevation, registerMask, getMask } from '../src/horizon.ts';
import { eventsToWindows, intersectWindows, visibleFraction } from '../src/visibility.ts';
import type { VisibilityEvent } from '../src/types.ts';

const q = (o: Record<string, string>): URLSearchParams => new URLSearchParams(o);
const isHttp = (status: number) => (err: unknown): boolean => err instanceof HttpError && err.status === status;

test('parseDuration convierte unidades y rechaza formatos malos', () => {
  assert.equal(parseDuration('30s', 'step'), 30e3);
  assert.equal(parseDuration('10m', 'step'), 600e3);
  assert.equal(parseDuration('1.5h', 'step'), 5400e3);
  assert.equal(parseDuration('2d', 'step'), 172800e3);
  for (const v of ['', '10', 'm', '1w', '-1h', undefined]) assert.throws(() => parseDuration(v, 'step'), isHttp(400));
});

test('parseDate: sin zona horaria es UTC, respeta offsets y el + convertido en espacio', () => {
  assert.equal(parseDate('2027-01-01', 'date'), Date.UTC(2027, 0, 1));
  assert.equal(parseDate('2027-01-01T12:00', 'date'), Date.UTC(2027, 0, 1, 12));
  assert.equal(parseDate('2027-01-01T12:00:00Z', 'date'), Date.UTC(2027, 0, 1, 12));
  assert.equal(parseDate('2027-01-01T12:00:00+02:00', 'date'), Date.UTC(2027, 0, 1, 10));
  assert.equal(parseDate('2027-01-01T12:00:00 02:00', 'date'), Date.UTC(2027, 0, 1, 10));
  assert.equal(parseDate(undefined, 'date', 123), 123);
  assert.throws(() => parseDate('yesterday', 'date'), isHttp(400));
  assert.throws(() => parseDate('', 'date'), isHttp(400));
});

test('parseSite: id, coordenadas, longitudes 0..360 y errores', () => {
  assert.equal(parseSite(q({ site: 'apollo11' })).id, 'apollo11');
  const s = parseSite(q({ lat: '-89.5', lon: '270', heightKm: '1.2' }));
  assert.equal(s.lon, -90);
  assert.equal(s.heightKm, 1.2);
  assert.throws(() => parseSite(q({ site: 'atlantida' })), isHttp(404));
  assert.throws(() => parseSite(q({ lat: '10' })), isHttp(400));
  assert.throws(() => parseSite(q({ lat: '91', lon: '0' })), isHttp(400));
  assert.throws(() => parseSite(q({ lat: 'x', lon: '0' })), isHttp(400));
});

test('parseSiteList, parseMode y parseRange', () => {
  const list = parseSiteList('apollo11, -89.5:0');
  assert.deepEqual(list.map((s) => s.id), ['apollo11', 'custom:-89.5,0']);
  assert.throws(() => parseSiteList(''), isHttp(400));
  assert.throws(() => parseSiteList(Array(11).fill('apollo11').join(',')), isHttp(400));
  assert.equal(parseMode(undefined), 'limb');
  assert.equal(parseMode('center'), 'center');
  assert.throws(() => parseMode('middle'), isHttp(400));
  const r = parseRange(q({ start: '2027-01-01' }), { maxDays: 400, defaultDays: 30 });
  assert.equal(r.end - r.start, 30 * 86400e3);
  assert.throws(() => parseRange(q({ start: '2027-01-02', end: '2027-01-01' }), { maxDays: 400, defaultDays: 30 }), isHttp(400));
  assert.throws(() => parseRange(q({ start: '2027-01-01', end: '2028-03-01' }), { maxDays: 400, defaultDays: 30 }), isHttp(400));
});

test('horizonElevation: esfera, interpolación lineal y salto 360→0', () => {
  assert.equal(horizonElevation(null, 123), 0);
  const el = new Array(360).fill(0);
  el[10] = 2; el[11] = 4; el[359] = 6; el[0] = 2;
  registerMask('unit-test', { stepDeg: 1, el, source: 'test' });
  const mask = getMask('unit-test');
  assert.equal(horizonElevation(mask, 10), 2);
  assert.equal(horizonElevation(mask, 10.25), 2.5);
  assert.equal(horizonElevation(mask, 359.5), 4); // between 359 (6) and 0 (2)
  assert.equal(horizonElevation(mask, 360), 2);
  assert.equal(horizonElevation(mask, -0.5), 4);
  assert.equal(horizonElevation(mask, 720.25), 1.5);
  assert.throws(() => registerMask('bad', { stepDeg: 1, el: [0, 1], source: 'x' }));
});

test('visibleFraction: 0, 0.5 y 1', () => {
  assert.equal(visibleFraction({ az: 0, el: -1, radiusDeg: 0.27 }, null), 0);
  assert.equal(visibleFraction({ az: 0, el: 0, radiusDeg: 0.27 }, null), 0.5);
  assert.equal(visibleFraction({ az: 0, el: 1, radiusDeg: 0.27 }, null), 1);
  const f = visibleFraction({ az: 0, el: 0.1, radiusDeg: 0.27 }, null);
  assert.ok(f > 0.5 && f < 1);
});

test('intersectWindows y eventsToWindows', () => {
  assert.deepEqual(intersectWindows([[0, 10], [20, 30]], [[5, 25]]), [[5, 10], [20, 25]]);
  assert.deepEqual(intersectWindows([[0, 10]], [[10, 20]]), []);
  assert.deepEqual(intersectWindows([], [[0, 1]]), []);
  assert.deepEqual(intersectWindows([[0, 100]], [[10, 20], [30, 40]]), [[10, 20], [30, 40]]);
  const ev: VisibilityEvent[] = [{ type: 'set', time: 5 }, { type: 'rise', time: 8 }];
  assert.deepEqual(eventsToWindows(ev, true, 0, 10), [[0, 5], [8, 10]]);
  assert.deepEqual(eventsToWindows([], false, 0, 10), []);
});
