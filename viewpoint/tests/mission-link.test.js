// Link between Plan and the 3D viewer (V1.1, #72): the URL carries the plan both ways and can be shared.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMission, viewerUrl, planUrl, regionFor, linkSearch, MISSION_KEYS } from '../src/core/mission-link.js';
import { SITES } from '../../web/js/engine/catalog.js';

const plan = { siteId: 'shackleton-rim', t0: Date.parse('2027-03-29T12:00:00Z'), days: 10, batteryHours: 12, minEarthPct: 60, maxEarthGapHours: 48, transitDays: 8, profile: 'small-robotic' };
const searchOf = url => url.slice(url.indexOf('?'), url.includes('#') ? url.indexOf('#') : undefined);

test('the viewer URL carries site, t0 and days, and reads back the same plan', () => {
  const url = viewerUrl(plan);
  assert.match(url, /^\.\.\/viewpoint\/\?site=shackleton-rim&t0=2027-03-29T12%3A00%3A00\.000Z&days=10&/);
  assert.deepEqual(parseMission(searchOf(url)), plan);
});

test('the ⤢ of the sky opens the viewer at the instant of the cursor and on foot (#130)', () => {
  const at = plan.t0 + 30 * 36e5;
  const url = viewerUrl(plan, '', { at, foot: true });
  const q = new URLSearchParams(searchOf(url));
  assert.equal(q.get('at'), '2027-03-30T18:00:00.000Z');
  assert.equal(q.get('view'), 'foot');
  assert.deepEqual(parseMission(q), { ...plan, atMs: at, foot: true });
  // An instant outside the mission is ignored: the viewer opens at the landing.
  q.set('at', '2027-05-01T00:00:00Z');
  assert.equal(parseMission(q).atMs, undefined);
  // «Volver» does not carry them to Plan.
  const back = new URLSearchParams(searchOf(planUrl(parseMission(searchOf(url)))));
  assert.equal(back.get('at'), null);
  assert.equal(back.get('view'), null);
});

test('«Volver» goes to Plan with the same plan', () => {
  const url = planUrl(plan);
  assert.ok(url.startsWith('../web/?') && url.endsWith('#plan'));
  assert.deepEqual(parseMission(searchOf(url)), plan);
});

test('?data= and ?api= go along, so both screens read the same data', () => {
  const url = viewerUrl(plan, '?data=fake&debug=1');
  assert.equal(new URLSearchParams(searchOf(url)).get('data'), 'fake');
  assert.equal(new URLSearchParams(searchOf(url)).get('debug'), null);
});

test('?q=, ?pr= and ?shadow= go along both ways, so both screens render at the same quality level (#145)', () => {
  for (const url of [viewerUrl(plan, '?q=bajo&pr=1&shadow=1024'), planUrl(plan, '?q=bajo&pr=1&shadow=1024')]) {
    const q = new URLSearchParams(searchOf(url));
    assert.equal(q.get('q'), 'bajo');
    assert.equal(q.get('pr'), '1');
    assert.equal(q.get('shadow'), '1024');
    assert.deepEqual(parseMission(q), plan);
  }
});

test('without ?site= it is not a mission link; with bad dates or days, an error', () => {
  assert.equal(parseMission(''), null);
  assert.deepEqual(parseMission('?site=shackleton-rim&t0=nope&days=10'), { error: 'bad-t0' });
  assert.deepEqual(parseMission('?site=shackleton-rim&t0=2027-03-29T12:00:00Z&days=0'), { error: 'bad-days' });
});

test('«Volver» of a link that cannot be read goes to Plan, keeping only the data and quality parameters', () => {
  for (const search of ['?site=connecting-ridge&t0=nope&days=10', '?site=connecting-ridge&t0=2027-03-29T12:00:00Z&days=40']) {
    assert.equal(planUrl(parseMission(search)), '../web/#plan');
    assert.equal(planUrl(parseMission(search), `${search}&api=http://x&q=bajo`), '../web/?api=http%3A%2F%2Fx&q=bajo#plan');
  }
});

test('missing thresholds take those of the small robotic lander, and no ?gap= leaves R6 off', () => {
  const p = parseMission('?site=shackleton-rim&t0=2027-03-29T12:00:00Z&days=10');
  assert.deepEqual([p.batteryHours, p.minEarthPct, p.maxEarthGapHours], [12, 60, undefined]);
  assert.ok(!viewerUrl({ ...plan, maxEarthGapHours: undefined }).includes('gap='));
});

test('the transit goes along when the plan has one; without ?transit= the plan takes its spacecraft\'s (#67)', () => {
  assert.equal(new URLSearchParams(searchOf(viewerUrl(plan))).get('transit'), '8');
  const { transitDays, ...noTransit } = plan;
  assert.ok(!viewerUrl(noTransit).includes('transit='));
  assert.ok(!('transitDays' in parseMission(searchOf(viewerUrl(noTransit)))));
});

test('every polar site has a relief region in viewpoint/data, and only the equatorial one has none (V2.2, #77)', async () => {
  const fs = await import('node:fs');
  assert.equal(regionFor('shackleton-rim'), 'shackleton-rim'); // real LOLA relief (V2.4, #82)
  assert.equal(regionFor('apollo15'), null);
  for (const s of SITES) {
    const id = regionFor(s.id);
    if (s.offMap) { assert.equal(id, null, s.id); continue; }
    assert.ok(id, `${s.id} has no region`);
    const meta = JSON.parse(fs.readFileSync(new URL(`../data/${id}/meta.json`, import.meta.url), 'utf8'));
    // the region is centred on the site of the catalogue (the backend one for the LOLA ridge, a few hundred metres away)
    if (meta.source.type === 'simulated') assert.deepEqual(meta.center, { lat: s.lat, lon: s.lon }, s.id);
  }
});

test('the search goes along both ways: the window and «El mejor de la zona» come back as they were', () => {
  const searched = { ...plan, from: '2027-03-28', to: '2027-03-30', pickBest: true };
  assert.deepEqual(parseMission(searchOf(planUrl(searchFromViewer(searched)))), searched);
  const fixed = { ...plan, from: '2027-03-28', to: '2027-03-30' };
  assert.ok(!viewerUrl(fixed).includes('pick='));
  assert.deepEqual(parseMission(searchOf(viewerUrl(fixed))), fixed);
});
const searchFromViewer = p => parseMission(searchOf(viewerUrl(p)));

test('a link without a window, or with a bad one, reads as before: Plan makes a window around the landing', () => {
  assert.ok(!('from' in parseMission(searchOf(viewerUrl(plan)))));
  const bad = parseMission('?site=shackleton-rim&t0=2027-03-29T12:00:00Z&days=10&from=2027-03-30&to=2027-03-28');
  assert.ok(!('from' in bad) && !('to' in bad));
  assert.ok(!('from' in parseMission('?site=shackleton-rim&t0=2027-03-29T12:00:00Z&days=10&from=nope&to=2027-03-28')));
});

test('linkSearch takes the window and the choice of site from the search of Plan', () => {
  const conditions = { profile: 'small-robotic', from: Date.parse('2026-11-18T00:00:00Z'), to: Date.parse('2026-11-19T12:00:00Z') };
  assert.deepEqual(linkSearch({ conditions }), { profile: 'small-robotic', from: '2026-11-18', to: '2026-11-19', pickBest: true });
  assert.equal(linkSearch({ conditions, fixedSite: true }).pickBest, false);
  assert.deepEqual(linkSearch(null), { profile: null });
});

test('Plan cleans every parameter the link writes from its URL', () => {
  const full = viewerUrl({ ...plan, from: '2027-03-28', to: '2027-03-30', pickBest: true }, '?data=fake');
  const left = [...new URLSearchParams(searchOf(full)).keys()].filter(k => !MISSION_KEYS.includes(k));
  assert.deepEqual(left, ['data']);
});
