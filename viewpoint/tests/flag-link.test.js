// «Comparar en el planificador» (E10.1, #492): the Plan URL of the flag with the period in view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flagPlanUrl } from '../src/core/flag-link.js';
import { parseMission, MISSION_KEYS } from '../src/core/mission-link.js';
import { parseCoords, CUSTOM_SITE_ID } from '../../web/js/common/custom-site.js';

const START = new Date('2027-03-01T00:00:00Z');
const base = { lat: -89.54, lon: 129.78, regionId: 'shackleton-rim', start: START, days: 30 };
const queryOf = url => new URLSearchParams(url.slice(url.indexOf('?'), url.indexOf('#')));

test('the flag at the site: the link carries the site of the region and the period', () => {
  const url = flagPlanUrl({ ...base, moved: false });
  assert.ok(url.startsWith('../web/?') && url.endsWith('#plan'));
  const q = queryOf(url);
  assert.equal(q.get('site'), 'shackleton-rim');
  assert.equal(q.get('lat'), null);
  assert.equal(q.get('t0'), '2027-03-01T00:00:00.000Z');
  assert.equal(q.get('days'), '30');
  for (const key of ['site', 't0', 'days']) assert.ok(MISSION_KEYS.includes(key));
  assert.equal(parseMission(q).siteId, 'shackleton-rim');
});

test('the flag moved: the link carries lat and lon (east positive), which Plan reads as a point of its own', () => {
  const url = flagPlanUrl({ ...base, moved: true, lat: -89.123456, lon: 129.987654 });
  const q = queryOf(url);
  assert.equal(q.get('site'), CUSTOM_SITE_ID);
  assert.equal(q.get('lat'), '-89.1235');
  assert.equal(q.get('lon'), '129.9877');
  assert.deepEqual(parseCoords(q.get('lat'), q.get('lon')), { lat: -89.1235, lon: 129.9877 });
  const plan = parseMission(q);
  assert.equal(plan.siteId, CUSTOM_SITE_ID);
  assert.deepEqual([plan.lat, plan.lon], [-89.1235, 129.9877]);
});

test('the link keeps the language, ?data= and ?api=', () => {
  const url = flagPlanUrl({ ...base, moved: false, search: '?data=fake&api=http://x.test&debug=1&lang=es', lang: 'en' });
  const q = queryOf(url);
  assert.equal(q.get('lang'), 'en');
  assert.equal(q.get('data'), 'fake');
  assert.equal(q.get('api'), 'http://x.test');
  assert.equal(q.get('debug'), null);
  assert.ok(url.endsWith('#plan'));
});

test('the 60 days in view become the most days Plan reads, so the link is never refused', () => {
  const q = queryOf(flagPlanUrl({ ...base, moved: false, days: 60 }));
  assert.equal(q.get('days'), '30');
  assert.ok(!parseMission(q).error);
});
