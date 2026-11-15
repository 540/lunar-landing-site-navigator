import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { buildSeries, describeSource, OBSERVER_HEIGHT_M, OUT_FILE, outFileFor, TERRAIN_DIR, serialize } from '../ephemeris.mjs';
import { series } from '../../backend/src/service.ts';
import { getSite } from '../../backend/src/sites.ts';
import { loadCatalogMasks } from '../../backend/src/horizon.ts';
import { routes } from '../../data/src/v1.ts';

// Same explicit load as the generator: the engine turns the terrain off under `node --test`.
loadCatalogMasks(TERRAIN_DIR, OBSERVER_HEIGHT_M);

const doc = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
const HOUR_MS = 3600e3;
const indexOf = (iso) => (Date.parse(iso) - Date.parse(doc.start)) / HOUR_MS;

test('header and lengths are consistent', () => {
  assert.equal(doc.version, 1);
  assert.equal(doc.siteId, 'shackleton-rim');
  assert.equal(doc.start, '2027-01-01T00:00:00.000Z');
  assert.equal(doc.stepMinutes, 60);
  assert.equal(doc.count, 8760);
  for (const b of ['sun', 'earth']) {
    assert.equal(doc[b].az.length, doc.count);
    assert.equal(doc[b].el.length, doc.count);
    assert.equal(doc[b].visibleFraction.length, doc.count);
  }
});

test('parity with /v1/sun-earth on 2027-01-15T00:00Z (data/README.md example)', () => {
  const i = indexOf('2027-01-15T00:00:00Z');
  assert.equal(i, 336);
  assert.ok(Math.abs(doc.sun.az[i] - 229.7233) <= 0.01, `sun az ${doc.sun.az[i]}`);
  assert.ok(Math.abs(doc.sun.el[i] - 0.3834) <= 0.01, `sun el ${doc.sun.el[i]}`);
  assert.ok(Math.abs(doc.earth.el[i] - 4.8044) <= 0.01, `earth el ${doc.earth.el[i]}`);
});

test('recorded horizon model matches what series() reports', () => {
  const t0 = Date.parse(doc.start);
  const s = series(getSite(doc.siteId), t0, t0 + HOUR_MS, HOUR_MS);
  assert.equal(doc.source, describeSource(s.site.horizon));
});

test('visibleFraction matches the API series on the sampled weeks', () => {
  const t0 = Date.parse(doc.start) + 4000 * HOUR_MS;
  const s = series(getSite(doc.siteId), t0, t0 + 167 * HOUR_MS, HOUR_MS);
  for (const b of ['sun', 'earth']) assert.deepEqual(doc[b].visibleFraction.slice(4000, 4168), s[b].visibleFraction);
});

test('header records the observer height and the output ignores LUNAR_OBSERVER_HEIGHT_M', () => {
  assert.equal(doc.observerHeightM, 2);
  const prev = process.env.LUNAR_OBSERVER_HEIGHT_M;
  process.env.LUNAR_OBSERVER_HEIGHT_M = '10';
  try {
    const part = buildSeries({ startIso: doc.start, endExclusiveIso: '2027-01-16T00:00:00.000Z' });
    assert.equal(part.observerHeightM, 2);
    assert.equal(part.sun.visibleFraction[336 - 1], doc.sun.visibleFraction[336 - 1]);
    assert.deepEqual(part.sun.visibleFraction, doc.sun.visibleFraction.slice(0, part.count));
  } finally {
    if (prev === undefined) delete process.env.LUNAR_OBSERVER_HEIGHT_M; else process.env.LUNAR_OBSERVER_HEIGHT_M = prev;
    loadCatalogMasks(TERRAIN_DIR, OBSERVER_HEIGHT_M);
  }
});

test('parity with the real /v1/sun-earth handler (terrain=1) at index 336', () => {
  const q = new URLSearchParams({ site: doc.siteId, date: '2027-01-15T00:00:00Z', terrain: '1' });
  const api = routes['/v1/sun-earth'](q);
  const i = 336;
  assert.equal(doc.sun.visibleFraction[i], api.sun.visibleFraction);
  assert.equal(doc.earth.visibleFraction[i], api.earth.visibleFraction);
  assert.ok(Math.abs(doc.earth.az[i] - api.earth.azimuthDeg) <= 0.01, `earth az ${doc.earth.az[i]} vs ${api.earth.azimuthDeg}`);
  assert.ok(Math.abs(doc.sun.az[i] - api.sun.azimuthDeg) <= 0.01);
  assert.ok(Math.abs(doc.earth.el[i] - api.earth.elevationDeg) <= 0.01);
});

test('file weighs less than 400 KB', () => {
  assert.ok(statSync(OUT_FILE).size < 400 * 1024);
});

test('regenerating a sample gives exactly the committed content (deterministic)', () => {
  // First week, a mid-year week and the last day.
  for (const [from, n] of [[0, 168], [4000, 168], [8760 - 24, 24]]) {
    const startIso = new Date(Date.parse(doc.start) + from * HOUR_MS).toISOString();
    const endIso = new Date(Date.parse(startIso) + n * HOUR_MS).toISOString();
    const part = buildSeries({ startIso, endExclusiveIso: endIso });
    assert.equal(part.count, n);
    for (const b of ['sun', 'earth']) {
      for (const k of ['az', 'el', 'visibleFraction']) assert.deepEqual(part[b][k], doc[b][k].slice(from, from + n));
    }
  }
});

test('full regeneration serializes to the committed file', () => {
  assert.equal(serialize(buildSeries()), readFileSync(OUT_FILE, 'utf8'));
});

// ---- IM-2 Athena target (Mons Mouton), E9.3 ----
const im2 = JSON.parse(readFileSync(outFileFor('im2-objetivo'), 'utf8'));
const im2Index = (iso) => (Date.parse(iso) - Date.parse(im2.start)) / HOUR_MS;

test('im2-objetivo: header, lengths and size are those of Shackleton', () => {
  assert.equal(im2.siteId, 'im2-objetivo');
  assert.equal([im2.lat, im2.lon].join(), [getSite('im2-objetivo').lat, getSite('im2-objetivo').lon].join());
  assert.equal(im2.start, doc.start);
  assert.equal(im2.count, 8760);
  assert.equal(im2.observerHeightM, 2);
  for (const b of ['sun', 'earth']) for (const k of ['az', 'el', 'visibleFraction']) assert.equal(im2[b][k].length, im2.count);
  assert.ok(statSync(outFileFor('im2-objetivo')).size < 400 * 1024);
});

test('im2-objetivo: the series matches the engine (series() with terrain) at 3 instants of 2027', () => {
  const site = getSite('im2-objetivo');
  for (const iso of ['2027-01-15T00:00:00Z', '2027-05-20T13:00:00Z', '2027-10-03T22:00:00Z']) {
    const t = Date.parse(iso);
    const s = series(site, t, t, HOUR_MS);
    assert.equal(s.site.horizon.type, 'mask');
    const i = im2Index(iso);
    for (const b of ['sun', 'earth']) {
      assert.ok(Math.abs(im2[b].az[i] - s[b].az[0]) <= 0.0001, `${iso} ${b} az`);
      assert.ok(Math.abs(im2[b].el[i] - s[b].el[0]) <= 0.0001, `${iso} ${b} el`);
      assert.equal(im2[b].visibleFraction[i], s[b].visibleFraction[0], `${iso} ${b} visibleFraction`);
    }
  }
});

test('im2-objetivo: regenerating a sample gives the committed content, and an unknown site is rejected', () => {
  const part = buildSeries({ siteId: 'im2-objetivo', startIso: im2.start, endExclusiveIso: '2027-01-08T00:00:00.000Z' });
  for (const b of ['sun', 'earth']) for (const k of ['az', 'el', 'visibleFraction']) assert.deepEqual(part[b][k], im2[b][k].slice(0, part.count));
  assert.equal(part.source, im2.source);
  assert.throws(() => buildSeries({ siteId: 'no-existe' }), /catálogo/);
});
