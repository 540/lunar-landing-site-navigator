// The real sky over the site (#396): the IAU rotation of the Moon checked against the API's Sun, the catalogue, the colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { siteAxes, azElAt, sunIcrf, icrfToScene, fromRaDec, bvToTemperature, temperatureToRgb, limitingMagnitude, starFlux, parseBsc5 } from '../src/core/star-sky.js';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);
const read = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));

test('star sky: the IAU rotation of the Moon puts the Sun where the API does, within 0.3° over all of 2027', () => {
  for (const id of ['shackleton-rim', 'im2-objetivo']) {
    const s = read(`../data/${id}/series-2027.json`);
    let worst = 0;
    for (let i = 0; i < s.count; i += 53) {
      const date = new Date(Date.parse(s.start) + i * s.stepMinutes * 60e3);
      const p = azElAt(siteAxes({ lat: s.lat, lon: s.lon }, date), sunIcrf(date));
      const daz = ((p.az - s.sun.az[i] + 540) % 360) - 180;
      worst = Math.max(worst, Math.hypot(daz * Math.cos(p.el * Math.PI / 180), p.el - s.sun.el[i]));
    }
    assert.ok(worst < 0.3, `${id}: ${worst.toFixed(3)}°`);
  }
});

test('star sky: the matrix to the scene is a rotation, with the scene\'s azimuth (0° towards −z, 90° towards +x)', () => {
  const site = { lat: -89.44, lon: -137.13 }, date = new Date('2027-01-15T00:00:00Z');
  const r = icrfToScene(site, date);
  const row = i => r.slice(i * 3, i * 3 + 3), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(dot(row(i), row(j)), i === j ? 1 : 0, 1e-9);
  // the Sun in the scene, against its azimuth and elevation at the site
  const v = sunIcrf(date), p = azElAt(siteAxes(site, date), v);
  const sc = [dot(row(0), v), dot(row(1), v), dot(row(2), v)];
  close(Math.atan2(sc[0], -sc[2]) * 180 / Math.PI, p.az > 180 ? p.az - 360 : p.az, 1e-6);
  close(Math.asin(sc[1]) * 180 / Math.PI, p.el, 1e-6);
  // from the south pole the Moon's south celestial pole is near the zenith
  const southPole = fromRaDec(269.9949 + 180, -66.5392);
  assert.ok(azElAt(siteAxes(site, date), southPole).el > 85);
});

test('star sky: the catalogue holds the 9096 stars of BSC5, the brightest first (Sirius), J2000', () => {
  const buf = fs.readFileSync(new URL('../assets/stars-bsc5.bin', import.meta.url));
  assert.equal(buf.length, 9096 * 8);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.length);
  close(dv.getUint16(0, true) / 100, 101.29, 0.02); // Sirius: RA 6h 45m 09s
  close(dv.getInt16(2, true) / 100, -16.72, 0.02);
  close(dv.getInt16(4, true) / 100, -1.46, 0.001);
  // a line of BSC5 (Vega)
  const vega = '7001  3Alp LyrBD+38 3238 172167 67174 699I  11510  Alp Lyr  183333.1+384126183656.3+384701 67.44 19.24 0.03   0.00 -0.01 -0.03   A0Va';
  const [ra, dec, mag, bv] = parseBsc5(vega)[0];
  close(ra, 279.2346, 1e-3); close(dec, 38.7836, 1e-3); close(mag, 0.03, 1e-9); close(bv, 0, 1e-9);
});

test('star sky: colours from B−V (hot blue-white, cool orange) and brightness from magnitudes', () => {
  close(bvToTemperature(0.65), 5800, 250); // the Sun
  const hot = temperatureToRgb(bvToTemperature(-0.2)), cool = temperatureToRgb(bvToTemperature(1.6));
  assert.ok(hot[2] >= hot[0], 'a B star is bluish');
  assert.ok(cool[0] > cool[2] * 1.5, 'an M star is orange');
  close(starFlux(1, 6), 100, 1e-9); // five magnitudes, a hundred times
  assert.equal(limitingMagnitude(-5), 6.5, 'Sun down: the whole catalogue');
  assert.equal(limitingMagnitude(2), 4, 'Sun up and sunlit ground: only the brighter stars');
});
