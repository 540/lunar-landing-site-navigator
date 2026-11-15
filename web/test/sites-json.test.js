// One catalogue of sites: the web reads backend/src/sites.ts through web/data/sites.json (web/scripts/build-sites.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sitesJson, OUT } from '../scripts/build-sites.mjs';
import { SITES as BACKEND } from '../../backend/src/sites.ts';
import { SITES, SITE_GROUPS, POLAR_MAP_RADIUS_KM, siteGroups } from '../js/engine/catalog.js';
import { canonicalSiteId } from '../js/engine/site-ids.js';
import { parseMission } from '../../viewpoint/src/core/mission-link.js';
import { missionEntry } from '../js/common/mission-history.js';

const KM_PER_DEGREE = (Math.PI / 180) * 1737.4;

test('web/data/sites.json is up to date with backend/src/sites.ts (regenerate it: node web/scripts/build-sites.mjs)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), sitesJson());
});

test('every backend site is in the web with the same id and coordinates, and has its web metadata', () => {
  for (const b of BACKEND) {
    const s = SITES.find(x => x.id === b.id);
    assert.ok(s, `${b.id} missing in the web`);
    assert.deepEqual([s.lat, s.lon, s.verified], [b.lat, b.lon, b.verified], b.id);
    assert.ok(s.note, `${b.id}: without its web metadata (short name and note) in web/js/engine/catalog.js`);
  }
});

test('the sites the backend lacks are marked approximate, and ids are unique', () => {
  const extra = SITES.filter(s => !BACKEND.some(b => b.id === s.id));
  assert.deepEqual(extra.map(s => s.id), ['ridge-slope', 'malapert', 'gerlache']);
  for (const s of extra) assert.equal(s.approximate, true, s.id);
  assert.equal(new Set(SITES.map(s => s.id)).size, SITES.length);
});

test('every site has a group, and the pickers show them grouped in order', () => {
  for (const s of SITES) assert.ok(SITE_GROUPS.some(g => g.id === s.group), s.id);
  assert.deepEqual(siteGroups().map(g => g.id), ['south-pole', 'clps', 'apollo', 'other']);
  assert.deepEqual(siteGroups().flatMap(g => g.sites), SITES);
  assert.equal(SITES.find(s => s.id === 'apollo11').group, 'apollo');
  assert.equal(SITES.find(s => s.id === 'chandrayaan3').group, 'other');
});

test('only the sites inside the polar map are on it', () => {
  for (const s of SITES) assert.equal(s.offMap, (90 + s.lat) * KM_PER_DEGREE > POLAR_MAP_RADIUS_KM, s.id);
  assert.deepEqual(SITES.filter(s => !s.offMap).map(s => s.id), ['shackleton-rim', 'ridge-slope', 'malapert', 'gerlache', 'im2-objetivo', 'im2-alunizaje']);
});

test('old ids still open: links and the history take the site that replaced them (#94)', () => {
  assert.equal(canonicalSiteId('connecting-ridge'), 'shackleton-rim');
  assert.equal(canonicalSiteId('mouton'), 'im2-objetivo');
  assert.equal(canonicalSiteId('malapert'), 'malapert');
  assert.equal(parseMission('?site=connecting-ridge&t0=2027-03-29T12:00:00Z&days=10').siteId, 'shackleton-rim');
  const m = missionEntry({ siteId: 'connecting-ridge', searchSiteId: 'mouton', t0: 1, days: 10 });
  assert.deepEqual([m.siteId, m.searchSiteId], ['shackleton-rim', 'im2-objetivo']);
});
