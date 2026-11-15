// The ⤢ of the sky (#130) and «Ver en 3D» open the same viewer: a site of the catalogue or a point of one's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewerLink } from '../js/common/viewer-link.js';
import { parseMission } from '../../viewpoint/src/core/mission-link.js';

const plan = { t0: Date.parse('2027-03-29T12:00:00Z'), days: 10, batteryHours: 12, minEarthPct: 60 };
const read = url => parseMission(url.slice(url.indexOf('?')));

test('a site of the catalogue goes by its id, at the instant of the cursor and on foot', () => {
  const at = plan.t0 + 5 * 36e5;
  const p = read(viewerLink({ id: 'shackleton-rim', lat: -89.44, lon: -137.13 }, plan, '?data=fake', { at, foot: true }));
  assert.equal(p.siteId, 'shackleton-rim');
  assert.equal(p.atMs, at);
  assert.equal(p.foot, true);
});

test('a point of one\'s own goes by its coordinates; without `open`, at the landing and from the drone', () => {
  const p = read(viewerLink({ id: 'custom', own: true, lat: -89.3, lon: 120.5 }, plan, ''));
  assert.equal(p.siteId, 'custom');
  assert.deepEqual([p.lat, p.lon], [-89.3, 120.5]);
  assert.equal(p.atMs, undefined);
  assert.equal(p.foot, undefined);
});
