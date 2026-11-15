// FAKE model of the lunar south pole (ported from prototipo/js/modelo.js).
// It mimics the shape of the real data (ephemeris + terrain) so the UI can be built now.
// The data engine will replace it with:
//   - ephemeris(): data API v1 (astronomy-engine), JPL Horizons or SPICE
//   - elevation() / computeHorizon(): a LOLA DEM (PGDA, product 78)
// The function signatures are the contract: if they return the same shape, the UI does not change.

import { t, fmtNum, fmtPct, fmtHours as dh } from '../common/i18n.js';

export const MOON_RADIUS_KM = 1737.4;
export const KM_PER_DEGREE = (Math.PI / 180) * MOON_RADIUS_KM; // ~30.3 km per degree of latitude
export const OBSERVER_HEIGHT_KM = 0.002; // 2 m: lander panels and antenna
const RAD = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12);

// ---------- Polar map projection (azimuthal equidistant centred on the south pole) ----------
// x, y in km; meridian 0° (Earth-facing side) points up.
export function toMap(lat, lon) {
  const r = (90 + lat) * KM_PER_DEGREE;
  return { x: r * Math.sin(lon * RAD), y: r * Math.cos(lon * RAD) };
}
export function fromMap(x, y) {
  const r = Math.hypot(x, y);
  let lon = Math.atan2(x, y) / RAD;
  if (lon > 180) lon -= 360;
  return { lat: -90 + r / KM_PER_DEGREE, lon };
}

// ---------- Invented terrain (stand-in for the LOLA DEM) ----------
// Craters and mountains with real names and approximate positions; shapes and heights are invented.
// Cabeus and Mons Mouton (#344): their labels were off on the LOLA relief, now placed from cited sources.
//   - Cabeus: centre from the IAU/USGS Gazetteer of Planetary Nomenclature (planetarynames.wr.usgs.gov, feature 953:
//     85.33°S, 42.13°W). The deepest point of its floor, on the LOLA DEM, is 23 km from it (85.48°S, 51.25°W).
//   - Mons Mouton: the Gazetteer (feature 16070: 84.60°S, 31.00°E) gives the centre of a 130 km massif, not its top;
//     the label goes on the summit, measured on the LOLA DEM LDEM_60S_240MPP_ADJ (PGDA/GSFC, 240 m): 84.67°S, 39.34°E.
const CRATERS = [
  { name: 'Shackleton', lat: -89.67, lon: 129.8, r: 10.5, depth: 3.0, rim: 0.6 },
  { name: 'de Gerlache', lat: -88.5, lon: -87.1, r: 16, depth: 2.5, rim: 0.5 },
  { name: 'Shoemaker', lat: -88.1, lon: 44.9, r: 25, depth: 2.5, rim: 0.4 },
  { name: 'Haworth', lat: -87.45, lon: -5.0, r: 25, depth: 2.8, rim: 0.4 },
  { name: 'Faustini', lat: -87.3, lon: 77.0, r: 20, depth: 2.0, rim: 0.3 },
  { name: 'Sverdrup', lat: -88.3, lon: -152, r: 16, depth: 2.0, rim: 0.3 },
  { name: 'Cabeus', lat: -85.33, lon: -42.13, r: 45, depth: 2.5, rim: 0.3 },
].map(c => ({ ...c, ...toMap(c.lat, c.lon) }));
const MOUNTAINS = [
  { name: t('common.feature.malapert'), lat: -86.0, lon: 0.0, s: 18, h: 4.5 },
  { name: 'Mons Mouton', lat: -84.67, lon: 39.34, s: 22, h: 5.5 },
  { name: t('common.feature.connectingRidge'), lat: -89.45, lon: -137.3, s: 7, h: 1.2 },
  { name: t('common.feature.connectingRidge'), lat: -89.05, lon: -112, s: 8, h: 0.9 },
].map(m => ({ ...m, ...toMap(m.lat, m.lon) }));
export const FEATURES = { craters: CRATERS, mountains: MOUNTAINS };

export function elevation(x, y) {
  let h = 0.25 * Math.sin(x / 23) * Math.cos(y / 31) + 0.15 * Math.sin((x + y) / 13);
  for (const c of CRATERS) {
    const d = Math.hypot(x - c.x, y - c.y) / c.r;
    if (d < 1) h += -c.depth * (1 - d * d) + c.rim;
    else if (d < 2.2) h += c.rim * Math.exp(-(((d - 1) / 0.35) ** 2));
  }
  for (const m of MOUNTAINS) {
    const d2 = ((x - m.x) ** 2 + (y - m.y) ** 2) / (m.s * m.s);
    if (d2 < 9) h += m.h * Math.exp(-d2);
  }
  return h;
}

// Terrain horizon: for each direction (0..359°), the highest angle blocked by the
// terrain, accounting for the Moon's curvature. Same computation that will run on LOLA.
const DISTANCES = (() => { const d = []; for (let x = 0.3; x < 220; x *= 1.09) d.push(x); return d; })();
export function horizonInDirection(x0, y0, h0, lat, lon, az) {
  const n = { x: Math.sin(lon * RAD), y: Math.cos(lon * RAD) };     // away from the pole = local north
  const e = { x: Math.cos(lon * RAD), y: -Math.sin(lon * RAD) };    // local east
  const dx = Math.cos(az * RAD) * n.x + Math.sin(az * RAD) * e.x;
  const dy = Math.cos(az * RAD) * n.y + Math.sin(az * RAD) * e.y;
  let max = -90;
  for (const d of DISTANCES) {
    const dh = elevation(x0 + dx * d, y0 + dy * d) - h0 - (d * d) / (2 * MOON_RADIUS_KM);
    const ang = Math.atan2(dh, d) / RAD;
    if (ang > max) max = ang;
  }
  return max;
}
export function computeHorizon(site) {
  if (site.offMap) return flatHorizon(site);
  const { x, y } = toMap(site.lat, site.lon);
  const h0 = elevation(x, y) + OBSERVER_HEIGHT_KM;
  const mask = new Float32Array(360);
  for (let az = 0; az < 360; az++) mask[az] = horizonInDirection(x, y, h0, site.lat, site.lon, az);
  return { mask, heightKm: h0 - OBSERVER_HEIGHT_KM };
}
function flatHorizon(s) {
  const m = new Float32Array(360);
  for (let a = 0; a < 360; a++) m[a] = 0.3 + 0.4 * Math.sin(a * RAD * 3 + s.lat) + 0.2 * Math.sin(a * RAD * 7);
  return { mask: m, heightKm: 0 };
}
export const horizonAt = (mask, az) => mask[((Math.round(az) % 360) + 360) % 360];

// ---------- Invented ephemeris (stand-in for Horizons / SPICE) ----------
// Subpoint = the place on the Moon that has the Sun (or the Earth) straight overhead.
export function subpoints(ms) {
  const d = (ms - J2000) / 864e5;
  const phase = ((((d - 5.26) / 29.530589) % 1) + 1) % 1; // 29.5-day cycle: the "lunar day"
  return {
    sun: { lon: 180 - 360 * phase, lat: 1.54 * Math.sin(2 * Math.PI * (d - 40) / 346.62) }, // ±1.54°: "seasons"
    earth: {
      lon: 7.9 * Math.sin(2 * Math.PI * (d - 10) / 27.5546),  // libration in longitude
      lat: 6.68 * Math.sin(2 * Math.PI * (d - 3) / 27.2122),  // libration in latitude
    },
  };
}
// Direction (azimuth, 0 = north) and elevation of a body seen from the site, without terrain.
export function altAz(lat, lon, sub) {
  const f = lat * RAD, b = sub.lat * RAD, dL = (sub.lon - lon) * RAD;
  const el = Math.asin(Math.sin(f) * Math.sin(b) + Math.cos(f) * Math.cos(b) * Math.cos(dL)) / RAD;
  const az = Math.atan2(Math.sin(dL) * Math.cos(b), Math.cos(f) * Math.sin(b) - Math.sin(f) * Math.cos(b) * Math.cos(dL)) / RAD;
  return { el, az: (az + 360) % 360 };
}
export function ephemeris(site, ms) {
  const p = subpoints(ms);
  const sun = altAz(site.lat, site.lon, p.sun);
  const earth = altAz(site.lat, site.lon, p.earth);
  earth.el -= 0.26 * Math.cos(earth.el * RAD); // parallax: the Earth is "close"
  return { sun, earth };
}

// ---------- Sky with terrain, and metrics ----------
export function sky(site, ms) {
  const { sun, earth } = ephemeris(site, ms);
  sun.horizon = horizonAt(site.horizon.mask, sun.az);
  earth.horizon = horizonAt(site.horizon.mask, earth.az);
  sun.margin = sun.el - sun.horizon;       // margin over the terrain: > 0 visible, < 0 blocked
  earth.margin = earth.el - earth.horizon;
  return { sun, earth };
}

export function evaluate(site, t0, days, stepHours = 1) {
  const n = Math.round((days * 24) / stepHours);
  const series = [];
  let hoursSun = null, hoursEarth = null, nSun = 0, nEarth = 0, maxSunEl = -90;
  let darkRun = 0, maxDarkHours = 0, noEarthRun = 0, maxNoEarthHours = 0;
  for (let i = 0; i <= n; i++) {
    const c = sky(site, t0 + i * stepHours * 36e5);
    series.push(c);
    if (c.sun.margin > 0) { nSun++; darkRun = 0; }
    else if (i > 0) { darkRun += stepHours; maxDarkHours = Math.max(maxDarkHours, darkRun); }
    if (c.earth.margin > 0) { nEarth++; noEarthRun = 0; }
    else if (i > 0) { noEarthRun += stepHours; maxNoEarthHours = Math.max(maxNoEarthHours, noEarthRun); }
    if (c.sun.el > maxSunEl) maxSunEl = c.sun.el;
    if (hoursSun === null && c.sun.margin <= 0) hoursSun = i * stepHours;
    if (hoursEarth === null && c.earth.margin <= 0) hoursEarth = i * stepHours;
  }
  const total = n * stepHours;
  return {
    t0, days, step: stepHours, series,
    hoursSun: hoursSun ?? total, sunPersists: hoursSun === null,
    hoursEarth: hoursEarth ?? total, earthPersists: hoursEarth === null,
    maxDarkHours, maxNoEarthHours,
    pctSun: (100 * nSun) / (n + 1), pctEarth: (100 * nEarth) / (n + 1), maxSunEl,
    sunAtLanding: series[0].sun.margin > 0, earthAtLanding: series[0].earth.margin > 0,
  };
}

// Decision rule. The lander is solar: it needs the Sun during the WHOLE mission and only
// survives in the dark as long as its battery lasts (req.batteryHours).
// Also returns the trace for explanation mode.
// req: { batteryHours, minEarthPct, maxEarthGapHours? } (without maxEarthGapHours, long Earth gaps do not count)
export function verdict(r, req) {
  const darkOk = r.maxDarkHours <= req.batteryHours;
  const earthOk = r.pctEarth >= req.minEarthPct;
  const gapLimit = Number.isFinite(req.maxEarthGapHours) ? req.maxEarthGapHours : Infinity;
  const gapOk = r.maxNoEarthHours <= gapLimit;
  // Results built from visibility windows carry no hourly series: the trace says visible or blocked.
  const atLanding = (body, ok) => (r.series[0] ? t('common.fake.margin', { deg: fmtNum(r.series[0][body].margin, 2) }) : t(ok ? 'common.fake.visible' : 'common.fake.blocked'));
  const trace = [
    { rule: t('common.fake.ruleSun'), ok: r.sunAtLanding, value: atLanding('sun', r.sunAtLanding) },
    { rule: t('common.fake.ruleEarth'), ok: r.earthAtLanding, value: atLanding('earth', r.earthAtLanding) },
    { rule: t('common.fake.ruleDark', { h: fmtNum(req.batteryHours) }), ok: darkOk, value: r.maxDarkHours ? dh(r.maxDarkHours) : t('common.fake.neverDark') },
    { rule: t('common.fake.ruleEarthPct', { pct: fmtNum(req.minEarthPct) }), ok: earthOk, value: fmtPct(r.pctEarth) },
    ...(gapLimit < Infinity ? [{ rule: t('common.fake.ruleGap', { h: fmtNum(gapLimit) }), ok: gapOk, value: r.maxNoEarthHours ? dh(r.maxNoEarthHours) : t('common.fake.neverLost') }] : []),
  ];
  if (!r.sunAtLanding) return { code: 'not_viable', title: t('common.verdict.not_viable'), reason: t('common.fake.sunBlocked'), trace };
  if (!r.earthAtLanding) return { code: 'not_viable', title: t('common.verdict.not_viable'), reason: t('common.fake.earthBlocked'), trace };
  if (darkOk && earthOk && gapOk) return { code: 'viable', title: t('common.verdict.viable'), reason: r.maxDarkHours ? t('common.fake.okDark', { dh: dh(r.maxDarkHours) }) : t('common.fake.okSun'), trace };
  const problems = [];
  if (!darkOk) problems.push(t('common.fake.dark', { sets: dh(r.hoursSun), dark: dh(r.maxDarkHours), h: fmtNum(req.batteryHours) }));
  if (!earthOk) problems.push(t('common.fake.earth', { pct: fmtNum(r.pctEarth, 0), min: fmtNum(req.minEarthPct) }));
  if (!gapOk) problems.push(t('common.fake.gap', { dh: dh(r.maxNoEarthHours), h: fmtNum(gapLimit) }));
  const text = problems.join(t('common.fake.and'));
  const close = r.maxDarkHours <= Math.max(2 * req.batteryHours, 6) && r.pctEarth >= 0.8 * req.minEarthPct && r.maxNoEarthHours <= 1.2 * gapLimit;
  return close
    ? { code: 'marginal', title: t('common.verdict.marginal'), reason: t('common.fake.close') + text, trace }
    : { code: 'not_viable', title: t('common.verdict.not_viable'), reason: text.charAt(0).toUpperCase() + text.slice(1), trace };
}

// Visibility at any point of the map (for the shadow layer).
export function visibleAtPoint(x, y, subpoint) {
  const { lat, lon } = fromMap(x, y);
  const { el, az } = altAz(lat, lon, subpoint);
  if (el < -3) return -1;
  const h0 = elevation(x, y) + OBSERVER_HEIGHT_KM;
  return el - horizonInDirection(x, y, h0, lat, lon, az);
}
