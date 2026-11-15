// Live series (E10.2, #508): the sky of any place and date, asked to the public API, in the shape of series-2027.json so the
// panel, the clock, the labels and the timeline do not change. Pure: no fetch and no DOM; the API client is injected
// (`sky(fromMs, toMs)` is `loadSky` of web/js/adapters/visibility-api.js).
import { fractionOver } from './mask-grid.js';
import { APPARENT_RADIUS_DEG } from './flag-drag.js';
import { parseDay } from './timeline.js';
import { parseCoords } from '../../../web/js/common/custom-site.js';

const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;
/** Most points the API answers in one `/v1/track` (LIMITS.trackMaxPoints of the API): a longer period is asked in pieces. */
export const TRACK_MAX_POINTS = 3000;
/** Dates the live exploration accepts as the start of the period. */
export const LIVE_START_MIN = '2020-01-01';
export const LIVE_START_MAX = '2050-12-31';

/** True when [start, start + days] fits inside the precomputed series (the API is not needed). */
export function seriesFits(series, startMs, days) {
  if (!series) return false;
  const first = Date.parse(series.start);
  const last = first + (series.count - 1) * series.stepMinutes * 60e3;
  return startMs >= first && startMs + days * DAY_MS <= last;
}

/** A start date (YYYY-MM-DD) the live exploration can ask for. */
export function isLiveStart(text) {
  const d = parseDay(text);
  return d !== null && d >= parseDay(LIVE_START_MIN) && d <= parseDay(LIVE_START_MAX);
}

/**
 * The period split into requests of at most `maxPoints` hourly samples. Consecutive pieces do not share a sample: each one
 * starts an hour after the previous ends.
 * @returns {{fromMs: number, toMs: number}[]}
 */
export function chunkPeriod(fromMs, toMs, maxPoints = TRACK_MAX_POINTS) {
  const span = (maxPoints - 1) * HOUR_MS;
  const pieces = [];
  for (let from = fromMs; from <= toMs; from += span + HOUR_MS) pieces.push({ fromMs: from, toMs: Math.min(from + span, toMs) });
  return pieces;
}

/** The horizon of the API (one value per degree) in the shape of mask.json, which the ring draws. */
export const maskFromSky = sky => ({ stepDeg: 1, el: Array.from(sky.horizon.mask) });

/** Where the numbers come from: relief (the API had LOLA there) or a smooth Moon. */
export const originOf = sky => (sky?.horizon?.heightM === null || sky?.horizon?.heightM === undefined ? 'flat' : 'terrain');

/**
 * The API samples (one per hour from `fromMs`) as a series. `visibleFraction` is the share of the disc over the horizon of
 * each body, with the radius the API gives (the mean radius if it does not).
 */
export function seriesFromSamples({ samples, fromMs, lat, lon, observerHeightM = 2, origin }) {
  const body = (key, fallback) => {
    const az = [], el = [], visibleFraction = [];
    for (const s of samples) {
      const b = s[key];
      az.push(b.az); el.push(b.el);
      visibleFraction.push(fractionOver(b.el, b.radius > 0 ? b.radius : fallback, b.horizon));
    }
    return { az, el, visibleFraction };
  };
  return {
    version: 1,
    siteId: 'live',
    lat, lon,
    start: new Date(fromMs).toISOString(),
    stepMinutes: 60,
    count: samples.length,
    observerHeightM,
    source: `API en directo, horizonModel: ${origin === 'terrain' ? 'mask' : 'sphere'}`,
    sun: body('sun', APPARENT_RADIUS_DEG.sun),
    earth: body('earth', APPARENT_RADIUS_DEG.earth),
  };
}

/**
 * The series of [startMs, startMs + days] at a point, from the API. Several requests if the period does not fit in one.
 * @param {{ sky: (fromMs: number, toMs: number) => Promise<{series: object[], horizon: {mask: ArrayLike<number>, heightM: number|null}}> }} api
 * @returns {Promise<{series: object, mask: {stepDeg: number, el: number[]}, origin: 'terrain'|'flat'}>}
 */
export async function loadLiveSeries({ sky, lat, lon, startMs, days }) {
  const pieces = chunkPeriod(startMs, startMs + days * DAY_MS);
  const results = [];
  for (const p of pieces) results.push(await sky(p.fromMs, p.toMs)); // one at a time: the API queues heavy requests
  const samples = results.flatMap(r => r.series);
  const expected = Math.round(days * 24) + 1;
  if (samples.length !== expected) throw Object.assign(new Error(`The API gave ${samples.length} samples, ${expected} were expected`), { code: 'bad_response' });
  const origin = originOf(results[0]);
  return { series: seriesFromSamples({ samples, fromMs: startMs, lat, lon, origin }), mask: maskFromSky(results[0]), origin };
}

/** `?lat=…&lon=…` (the names of the API, east positive): a point without region. null when there is none, `{ error }` when it is wrong. */
export function pointFromSearch(search) {
  const q = new URLSearchParams(search);
  if (!q.has('lat') && !q.has('lon')) return null;
  const where = parseCoords(q.get('lat'), q.get('lon'));
  return where.errors ? { error: where.errors } : where;
}

/** The text key of the origin notice, one per origin; every figure that comes from the API is painted with one of them. */
export const noticeKey = origin => (origin === 'terrain' ? 'terrain' : 'flat');

/** Longest wait for the API before the precomputed series is used instead. */
export const LIVE_TIMEOUT_MS = 30000;

/** Rejects with `{ code: 'timeout' }` if `promise` takes more than `ms`. */
export function withTimeout(promise, ms = LIVE_TIMEOUT_MS) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** The text of an API failure, chosen by its `code` (never by its `message`); `T` is `UI.live`. */
export const liveErrorText = (err, T) => T.errors[err?.code] ?? (err instanceof TypeError ? T.unreachable : T.errorGeneric);

/** The error of a live request that was never made (`?data=fake`). */
export const liveDisabledError = () => Object.assign(new Error('live data is off (?data=fake)'), { code: 'disabled' });

/** Start date taken inside the dates the live exploration accepts. */
export const snapLive = text => (text < LIVE_START_MIN ? LIVE_START_MIN : text > LIVE_START_MAX ? LIVE_START_MAX : text);

/**
 * What a new start date asks of the screen: 'none' (same date, or one the screen does not accept), 'in-place' (the
 * precomputed year holds it) or 'reload' (the numbers must come from the API: ?start= and ?day= and a new start-up).
 * @param {{next: string, current: string, origin: string|null, point: object|null, liveEnabled: boolean, inRange: (t:string)=>boolean}} p
 *   `inRange`: the date is inside the precomputed range
 */
export function startAction({ next, current, origin, point, liveEnabled, inRange }) {
  if (next === current || !(liveEnabled ? isLiveStart(next) : inRange(next))) return 'none';
  return origin || point || !inRange(next) ? 'reload' : 'in-place';
}

/**
 * Which series the exploration draws (E10.2). A region whose precomputed series holds the period never calls the API; a
 * period outside it, or a point without region, asks the API; if it fails the region keeps the precomputed series and says why.
 * @param {object} p
 * @param {string} p.start   start date as typed (YYYY-MM-DD)
 * @param {number} p.days    length of the period
 * @param {{lat:number, lon:number}|null} p.point  `?lat&lon`, a place without region
 * @param {() => Promise<object|null>} p.loadStatic  series-2027.json of the region (null if it has none)
 * @param {() => Promise<object|null>} p.loadStaticMask
 * @param {(q:{lat:number, lon:number, startMs:number, days:number}) => Promise<{series:object, mask:object, origin:string}>} p.live
 * @param {(text:string) => string} p.clamp  start date taken inside the precomputed range
 * @returns {Promise<{series: object|null, mask: object|null, origin: 'terrain'|'flat'|null, start: string, failure: Error|null}>}
 *   `origin` null: the numbers are the precomputed ones. `failure`: the API was needed and did not give it.
 */
export async function chooseSeries({ start, days, point, loadStatic, loadStaticMask, live, clamp }) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const fromApi = async (where, fallback) => {
    try {
      const got = await live({ ...where, startMs, days });
      return { ...got, start, failure: null };
    } catch (failure) {
      return { ...fallback, start: fallback.series ? clamp(start) : start, origin: null, failure };
    }
  };
  if (point) return fromApi(point, { series: null, mask: null });
  const series = await loadStatic().catch(() => null);
  if (series && seriesFits(series, startMs, days)) return { series, mask: await loadStaticMask(), origin: null, start, failure: null };
  if (!series) return { series: null, mask: null, origin: null, start, failure: new Error('no series') };
  return fromApi({ lat: series.lat, lon: series.lon }, { series, mask: await loadStaticMask() });
}

/** Query string for another start date (a period the screen cannot show in place): the day of the timeline and the rest stay. */
export function startSearch(search, { start, offsetDays }) {
  const params = new URLSearchParams(search);
  params.set('start', start);
  params.set('day', String(Math.round(offsetDays * 1000) / 1000));
  return `?${params}`;
}
