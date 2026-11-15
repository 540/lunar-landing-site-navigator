// Any place and date with the live API (E10.2, #508): the adapter, the choice of source, the limits and the notices.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seriesFromSamples, loadLiveSeries, chooseSeries, chunkPeriod, seriesFits, originOf, maskFromSky, pointFromSearch, startSearch, liveErrorText, withTimeout, noticeKey, startAction, snapLive, liveDisabledError, TRACK_MAX_POINTS } from '../src/core/live-series.js';
import { sampleAt } from '../src/core/series.js';
import { fractionAt, periodMetrics, sunState } from '../src/core/sky-state.js';
import { clampStart, instantAt, startFromSearch, isStartInRange } from '../src/core/timeline.js';
import { regionSearch } from '../src/core/regions.js';
import { TEXTS, texts } from '../src/texts.js';

const HOUR = 3600e3, DAY = 24 * HOUR;
// Responses of loadSky (web/js/adapters/visibility-api.js) against the real API: shackleton-rim and a point without region, 2 days from 2028-03-01.
const FX = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/live-sky.json', import.meta.url)), 'utf8'));
const asSky = f => ({ series: f.series, horizon: { mask: Float32Array.from(f.horizon.mask), heightM: f.horizon.heightM } });
const START_2027 = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../data/shackleton-rim/series-2027.json', import.meta.url)), 'utf8'));

test('the adapter turns an API response into a series with the shape of series-2027.json', () => {
  const { series, mask, origin } = (() => {
    const sky = asSky(FX.rim);
    return { series: seriesFromSamples({ samples: sky.series, fromMs: FX.rim.fromMs, ...FX.rim.where, origin: originOf(sky) }), mask: maskFromSky(sky), origin: originOf(sky) };
  })();
  for (const key of Object.keys(START_2027)) if (key !== 'siteId') assert.ok(key in series, `«${key}» is missing`);
  assert.deepEqual(Object.keys(series.sun), ['az', 'el', 'visibleFraction']);
  assert.equal(series.count, 49);
  assert.equal(series.sun.az.length, 49);
  assert.equal(series.stepMinutes, 60);
  assert.equal(series.start, '2028-03-01T00:00:00.000Z');
  assert.equal(origin, 'terrain');
  assert.equal(mask.el.length * mask.stepDeg, 360);
  for (const f of [...series.sun.visibleFraction, ...series.earth.visibleFraction]) assert.ok(f >= 0 && f <= 1);
});

test('periodMetrics, fractionAt and sampleAt work over a live series', () => {
  const sky = asSky(FX.point);
  const series = seriesFromSamples({ samples: sky.series, fromMs: FX.point.fromMs, ...FX.point.where, origin: originOf(sky) });
  const start = new Date(FX.point.fromMs);
  const m = periodMetrics(series, start, 2);
  for (const k of ['meanSunDiskFraction', 'sunTimeFraction', 'earthTimeFraction', 'sunAndEarthTimeFraction', 'longestNightHours', 'longestEarthOutageHours']) assert.ok(Number.isFinite(m[k]), k);
  const noon = new Date(FX.point.fromMs + 5.5 * HOUR);
  assert.ok(fractionAt(series, 'sun', noon) >= 0);
  assert.ok(['visible', 'partial', 'hidden'].includes(sunState(fractionAt(series, 'sun', noon))));
  assert.ok(Number.isFinite(sampleAt(series, noon).sun.az));
  assert.throws(() => sampleAt(series, new Date(FX.point.fromMs + 3 * DAY)), RangeError);
});

test('the origin says relief or smooth Moon by the height of the ground the API gives', () => {
  assert.equal(originOf(asSky(FX.rim)), 'terrain');
  assert.equal(originOf(asSky(FX.point)), 'flat');
  assert.equal(noticeKey('terrain'), 'terrain');
  assert.equal(noticeKey('flat'), 'flat');
});

test('the fraction of the disc follows the horizon the API gives for each body', () => {
  const mk = (el, horizon) => ({ az: 0, el, horizon, radius: 0.27 });
  const { series } = { series: seriesFromSamples({ samples: [{ sun: mk(5, 0), earth: mk(-3, 0) }, { sun: mk(0, 0), earth: mk(0.5, 0) }], fromMs: 0, lat: -89, lon: 0, origin: 'flat' }) };
  assert.deepEqual(series.sun.visibleFraction.map(f => Math.round(f * 100) / 100), [1, 0.5]);
  assert.equal(series.earth.visibleFraction[0], 0);
});

test('a period that does not fit in one request is cut in pieces without repeating samples', () => {
  const from = Date.UTC(2028, 0, 1), to = from + 200 * DAY;
  const pieces = chunkPeriod(from, to);
  assert.ok(pieces.length > 1);
  const points = pieces.map(p => (p.toMs - p.fromMs) / HOUR + 1);
  for (const n of points) assert.ok(n <= TRACK_MAX_POINTS);
  assert.equal(points.reduce((a, b) => a + b), (to - from) / HOUR + 1);
  for (let i = 1; i < pieces.length; i++) assert.equal(pieces[i].fromMs, pieces[i - 1].toMs + HOUR);
  assert.deepEqual(chunkPeriod(from, from + 60 * DAY), [{ fromMs: from, toMs: from + 60 * DAY }]);
});

test('loadLiveSeries asks for each piece with a client of its own and joins them', async () => {
  const calls = [];
  const sky = async (fromMs, toMs) => {
    calls.push([fromMs, toMs]);
    const n = (toMs - fromMs) / HOUR + 1;
    const s = { az: 1, el: 2, horizon: 0, radius: 0.27 };
    return { series: Array.from({ length: n }, () => ({ sun: s, earth: s })), horizon: { mask: new Float32Array(360), heightM: null } };
  };
  const startMs = Date.UTC(2028, 0, 1);
  const got = await loadLiveSeries({ sky, lat: -89, lon: 10, startMs, days: 130 });
  assert.ok(calls.length > 1);
  assert.equal(got.series.count, 130 * 24 + 1);
  assert.equal(got.origin, 'flat');
  await assert.rejects(loadLiveSeries({ sky: async () => ({ series: [], horizon: { mask: [], heightM: null } }), lat: 0, lon: 0, startMs, days: 1 }), /expected/);
});

const makeSources = ({ liveFails = false } = {}) => {
  const log = { live: [] };
  return {
    log,
    loadStatic: async () => START_2027,
    loadStaticMask: async () => ({ stepDeg: 0.5, el: [] }),
    clamp: clampStart,
    live: async q => {
      log.live.push(q);
      if (liveFails) throw Object.assign(new Error('x'), { code: 'overloaded' });
      return { series: { start: new Date(q.startMs).toISOString(), count: 2, stepMinutes: 60 }, mask: { stepDeg: 1, el: [] }, origin: 'terrain' };
    },
  };
};

test('a date inside the precomputed series does not call the API; one outside does', async () => {
  const inside = makeSources();
  const a = await chooseSeries({ start: '2027-03-01', days: 60, point: null, ...inside });
  assert.equal(inside.log.live.length, 0);
  assert.equal(a.series, START_2027);
  assert.equal(a.origin, null);
  const outside = makeSources();
  const b = await chooseSeries({ start: '2028-03-01', days: 60, point: null, ...outside });
  assert.equal(outside.log.live.length, 1);
  assert.equal(b.origin, 'terrain');
  assert.deepEqual([outside.log.live[0].lat, outside.log.live[0].lon], [START_2027.lat, START_2027.lon]);
  assert.equal(outside.log.live[0].startMs, Date.UTC(2028, 2, 1));
});

test('a period that starts inside 2027 but ends after it asks the API', async () => {
  const src = makeSources();
  await chooseSeries({ start: '2027-12-15', days: 60, point: null, ...src });
  assert.equal(src.log.live.length, 1);
  assert.equal(seriesFits(START_2027, Date.UTC(2027, 10, 1), 60), true);
  assert.equal(seriesFits(START_2027, Date.UTC(2027, 10, 2), 60), false);
});

test('a point without region always asks the API, with the coordinates of the link', async () => {
  const src = makeSources();
  const got = await chooseSeries({ start: '2027-03-01', days: 60, point: { lat: -88.5, lon: 20 }, ...src });
  assert.deepEqual(src.log.live.map(q => [q.lat, q.lon]), [[-88.5, 20]]);
  assert.equal(got.origin, 'terrain');
});

test('if the API fails the region keeps the precomputed series, in range, and the failure is told', async () => {
  const got = await chooseSeries({ start: '2028-03-01', days: 60, point: null, ...makeSources({ liveFails: true }) });
  assert.equal(got.series, START_2027);
  assert.equal(got.origin, null);
  assert.ok(isStartInRange(got.start));
  assert.equal(got.failure.code, 'overloaded');
  assert.equal(instantAt(got.start, 0).getUTCFullYear(), 2027);
  const point = await chooseSeries({ start: '2028-03-01', days: 60, point: { lat: -88, lon: 1 }, ...makeSources({ liveFails: true }) });
  assert.equal(point.series, null);
  assert.ok(point.failure);
});

test('an API that takes too long counts as a failure with its own code', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), { code: 'timeout' });
  assert.equal(await withTimeout(Promise.resolve(3), 10), 3);
  const got = await chooseSeries({ start: '2028-03-01', days: 60, point: null, ...makeSources(), live: () => withTimeout(new Promise(() => {}), 10) });
  assert.equal(got.failure.code, 'timeout');
  assert.equal(got.series, START_2027);
});

test('API errors are shown by their code, never by their message', () => {
  const T = TEXTS.live;
  assert.equal(liveErrorText({ code: 'rate_limited', message: 'texto interno' }, T), T.errors.rate_limited);
  assert.equal(liveErrorText({ code: 'raro', message: 'texto interno' }, T), T.errorGeneric);
  assert.equal(liveErrorText(new TypeError('Failed to fetch'), T), T.unreachable);
  assert.ok(!liveErrorText({ code: 'overloaded', message: 'secreto' }, T).includes('secreto'));
});

test('links and requests use the names of the API parameters', () => {
  assert.deepEqual(pointFromSearch('?lat=-88.5&lon=20'), { lat: -88.5, lon: 20 });
  assert.equal(pointFromSearch('?region=shackleton-rim'), null);
  assert.ok(pointFromSearch('?lat=abc&lon=20').error);
  assert.ok(pointFromSearch('?lat=-88').error);
  const q = new URLSearchParams(startSearch('?lat=-88.5&lon=20&foo=1', { start: '2028-03-01', offsetDays: 4.25 }));
  assert.deepEqual([q.get('lat'), q.get('lon'), q.get('start'), q.get('day'), q.get('foo')], ['-88.5', '20', '2028-03-01', '4.25', '1']);
  const region = new URLSearchParams(regionSearch('?lat=-88.5&lon=20&start=2028-03-01', 'im2-objetivo', { start: '2028-03-01', offsetDays: 0 }));
  assert.equal(region.get('lat'), null);
  assert.equal(region.get('lon'), null);
  assert.equal(region.get('region'), 'im2-objetivo');
  // ?start= of another year is only accepted with the check of the live range
  assert.equal(startFromSearch('?start=2028-03-01', 'X'), 'X');
  assert.equal(startFromSearch('?start=2028-03-01', 'X', () => true), '2028-03-01');
});

test('the 2027 behaviour of the timeline does not change', () => {
  assert.equal(instantAt('2027-03-01', 1).toISOString(), '2027-03-02T00:00:00.000Z');
  assert.equal(instantAt('2030-01-01', 0).toISOString(), '2027-11-01T00:00:00.000Z');
  assert.equal(instantAt('2030-01-01', 0, t => t).toISOString(), '2030-01-01T00:00:00.000Z');
});

test('every origin notice uses the common vocabulary, in both languages', () => {
  for (const lang of ['es', 'en']) {
    const T = texts(lang).live;
    assert.deepEqual(Object.keys(T.notice).sort(), ['flat', 'terrain']);
    assert.match(T.notice.terrain, lang === 'es' ? /API en directo · relieve LOLA/ : /Live API · LOLA relief/);
    assert.match(T.notice.flat, lang === 'es' ? /Luna lisa \(sin relieve\)/ : /smooth Moon \(no terrain\)/);
    assert.match(T.notice.flat, lang === 'es' ? /optimistas/ : /optimistic/);
  }
  // the notice a series gets is the one of its origin: nothing comes from the API without it
  for (const origin of ['terrain', 'flat']) assert.ok(TEXTS.live.notice[noticeKey(origin)]);
  assert.deepEqual(Object.keys(texts('en').live.errors), Object.keys(TEXTS.live.errors));
});

test('startAction: in place inside the precomputed year, reload when the numbers must come from the API', () => {
  const base = { current: '2027-03-01', origin: null, point: null, liveEnabled: true, inRange: isStartInRange };
  assert.equal(startAction({ ...base, next: '2027-03-01' }), 'none');
  assert.equal(startAction({ ...base, next: '2027-04-01' }), 'in-place');
  assert.equal(startAction({ ...base, next: '2028-03-01' }), 'reload');
  assert.equal(startAction({ ...base, next: '2027-04-01', origin: 'flat' }), 'reload'); // live period: sampleAt would throw outside it
  assert.equal(startAction({ ...base, next: '2027-04-01', point: { lat: -88, lon: 20 } }), 'reload');
  assert.equal(startAction({ ...base, next: '2019-01-01' }), 'none'); // outside the live range
  assert.equal(startAction({ ...base, next: '2028-03-01', liveEnabled: false }), 'none'); // ?data=fake
  assert.equal(startAction({ ...base, next: '2027-04-01', liveEnabled: false }), 'in-place');
});

test('startAction: a guided-visit chapter (2027 start) with a live series is never applied in place', () => {
  const live = { current: '2028-03-01', origin: 'terrain', point: null, liveEnabled: true, inRange: isStartInRange };
  assert.equal(startAction({ ...live, next: '2027-01-15' }), 'reload');
  assert.equal(startAction({ ...live, origin: 'flat', next: '2027-01-15' }), 'reload');
});

test('snapLive keeps a date inside the live range', () => {
  assert.equal(snapLive('2010-05-05'), '2020-01-01');
  assert.equal(snapLive('2099-05-05'), '2050-12-31');
  assert.equal(snapLive('2028-05-05'), '2028-05-05');
});

test('a failure is told by its code: unreachable only for a network error', async () => {
  const T = TEXTS.live;
  assert.equal(liveErrorText(new TypeError('fetch failed'), T), T.unreachable);
  assert.equal(liveErrorText(Object.assign(new Error('x'), { code: 'http_502' }), T), T.errorGeneric);
  assert.equal(liveErrorText(new Error('x'), T), T.errorGeneric);
  assert.equal(liveErrorText(liveDisabledError(), T), T.errors.disabled);
  const wrong = { sky: async () => ({ series: [], horizon: { mask: new Float32Array(360), heightM: null } }) };
  const err = await loadLiveSeries({ ...wrong, lat: -89, lon: 0, startMs: 0, days: 1 }).catch(e => e);
  assert.equal(err.code, 'bad_response');
  assert.equal(liveErrorText(err, T), T.errors.bad_response);
  const failure = await chooseSeries({ start: '2028-01-01', days: 1, point: { lat: -89, lon: 0 }, loadStatic: async () => null, loadStaticMask: async () => null, clamp: t => t, live: async () => { throw liveDisabledError(); } });
  assert.equal(failure.failure.code, 'disabled');
});
