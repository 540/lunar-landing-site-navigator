// The real sky over the site (#396): where each star of the catalogue stands seen from a place of the Moon at a moment,
// and how bright and of what colour it looks. Pure: numbers in, numbers out, no three.js.
//
// The stars are those of the Yale Bright Star Catalogue (BSC5, Hoffleit & Warren 1991; public domain): the 9110 stars to
// magnitude 6.5, what the eye sees. Their directions are J2000 (ICRF). The Moon turns under them as the IAU says
// (Archinal et al. 2018, the rotation of the Moon in its Mean Earth / polar axis frame, the one of the LOLA maps), so
// from the pole the sky turns once a sidereal month about a point near the zenith. There is no air: the stars do not
// twinkle and do not dim towards the horizon.

const RAD = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const DAY_MS = 86400e3;

/** Days since J2000.0 (UTC is close enough to TDB for the sky: 69 s are 0.01° of the Moon's turn). */
export const daysSinceJ2000 = date => (date.getTime() - J2000_MS) / DAY_MS;

/**
 * Orientation of the Moon at d days since J2000 (IAU, Archinal et al. 2018): the right ascension and declination of
 * its north pole and the angle of its prime meridian, in degrees.
 */
export function moonOrientation(d) {
  const T = d / 36525;
  const E = [0,
    125.045 - 0.0529921 * d, 250.089 - 0.1059842 * d, 260.008 + 13.0120009 * d, 176.625 + 13.3407154 * d,
    357.529 + 0.9856003 * d, 311.589 + 26.4057084 * d, 134.963 + 13.0649930 * d, 276.617 + 0.3287146 * d,
    34.226 + 1.7484877 * d, 15.134 - 0.1589763 * d, 119.743 + 0.0036096 * d, 239.961 + 0.1643573 * d,
    25.053 + 12.9590088 * d,
  ].map(v => v * RAD);
  const s = i => Math.sin(E[i]), c = i => Math.cos(E[i]);
  const ra = 269.9949 + 0.0031 * T - 3.8787 * s(1) - 0.1204 * s(2) + 0.0700 * s(3) - 0.0172 * s(4) + 0.0072 * s(6) - 0.0052 * s(10) + 0.0043 * s(13);
  const dec = 66.5392 + 0.0130 * T + 1.5419 * c(1) + 0.0239 * c(2) - 0.0278 * c(3) + 0.0068 * c(4) - 0.0029 * c(6) + 0.0009 * c(7) + 0.0008 * c(10) - 0.0009 * c(13);
  const W = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.5610 * s(1) + 0.1208 * s(2) - 0.0642 * s(3) + 0.0158 * s(4) + 0.0252 * s(5)
    - 0.0066 * s(6) - 0.0047 * s(7) - 0.0046 * s(8) + 0.0028 * s(9) + 0.0052 * s(10) + 0.0040 * s(11) + 0.0019 * s(12) - 0.0044 * s(13);
  return { ra, dec, W };
}

/** A unit vector of the ICRF from a right ascension and a declination (degrees). */
export const fromRaDec = (ra, dec) => {
  const a = ra * RAD, b = dec * RAD;
  return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (...vs) => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);

/**
 * The axes of the place on the Moon, as ICRF vectors: east, north and up (the local vertical of the sphere) at
 * selenographic latitude and longitude `site` (degrees, east positive) and at a moment.
 * @returns {{east:number[], north:number[], up:number[]}}
 */
export function siteAxes(site, date) {
  const { ra, dec, W } = moonOrientation(daysSinceJ2000(date));
  // the Moon's frame in the ICRF: Z its pole; X its prime meridian, W along its equator from the node of the equator
  const Z = fromRaDec(ra, dec);
  const node = [-Math.sin(ra * RAD), Math.cos(ra * RAD), 0]; // ascending node of the Moon's equator on the ICRF equator
  const Q = cross(Z, node);
  const w = W * RAD;
  const X = add(scale(node, Math.cos(w)), scale(Q, Math.sin(w))), Y = cross(Z, X);
  const lat = site.lat * RAD, lon = site.lon * RAD;
  const body = v => add(scale(X, v[0]), scale(Y, v[1]), scale(Z, v[2]));
  const up = body([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]);
  const east = body([-Math.sin(lon), Math.cos(lon), 0]);
  return { east, north: cross(up, east), up };
}

/** Azimuth (° from the local north towards the east) and elevation (°) of an ICRF direction at the site. */
export function azElAt(axes, v) {
  const e = dot(v, axes.east), n = dot(v, axes.north), u = dot(v, axes.up);
  return { az: ((Math.atan2(e, n) / RAD) + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, u))) / RAD };
}

/**
 * The rotation from the ICRF to the scene (x east, y up, z south: azimuth 0° towards −z, core/direction.js), as the 9
 * numbers of a row-major 3 × 3 matrix: a star at ICRF direction v is at R·v in the scene.
 */
export function icrfToScene(site, date) {
  const { east, north, up } = siteAxes(site, date);
  return [...east, ...up, ...scale(north, -1)];
}

/**
 * The Sun's direction from the Earth–Moon system, J2000 (a low-precision solar ephemeris, about 0.01°): to check the
 * frame against the series of the API, which sees the Sun from the site.
 */
export function sunIcrf(date) {
  const n = daysSinceJ2000(date), T = n / 36525;
  const L = 280.460 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * RAD;
  // ecliptic longitude of date, back to the equinox of J2000 (1.397° a century of precession)
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g) - 1.3970 * T) * RAD;
  const eps = 23.4393 * RAD; // obliquity of J2000
  return [Math.cos(lambda), Math.cos(eps) * Math.sin(lambda), Math.sin(eps) * Math.sin(lambda)];
}

/**
 * How a star looks to the eye. Its flux relative to a star of `limit` (magnitudes are a log scale: 5 magnitudes are a
 * factor 100), and its colour from its B−V index: the temperature (Ballesteros 2012) and an approximate RGB of a black
 * body at it, normalised so the brightest channel is 1.
 */
export const starFlux = (mag, limit) => 10 ** (-0.4 * (mag - limit));
export function bvToTemperature(bv) {
  const b = Math.max(-0.4, Math.min(2, bv));
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}
export function temperatureToRgb(t) {
  // Tanner Helland's fit of the CIE colours of a black body, 1000–40000 K
  const k = t / 100;
  const r = k <= 66 ? 255 : 329.698727446 * (k - 60) ** -0.1332047592;
  const g = k <= 66 ? 99.4708025861 * Math.log(k) - 161.1195681661 : 288.1221695283 * (k - 60) ** -0.0755148492;
  const b = k >= 66 ? 255 : k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  const c = [r, g, b].map(v => Math.max(0, Math.min(255, v)) / 255);
  const m = Math.max(...c) || 1;
  return c.map(v => v / m);
}

/**
 * How faint a star the eye sees: with the Sun over the horizon and the sunlit regolith in view the eye is not adapted to
 * the dark (as the Apollo crews said, few stars show), with the Sun under it all of the catalogue does.
 * @param {number} sunEl elevation of the Sun (°)
 */
export const limitingMagnitude = sunEl => 6.5 - 2.5 * Math.max(0, Math.min(1, (sunEl + 1) / 1.5));

/**
 * Parses BSC5 (the fixed-column text of the catalogue, J2000) into [ra°, dec°, Vmag, B−V] per star, skipping the few
 * entries with no position (novae and clusters removed from the catalogue).
 */
export function parseBsc5(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (line.length < 107 || !line.slice(75, 77).trim()) continue;
    const ra = (+line.slice(75, 77) + +line.slice(77, 79) / 60 + +line.slice(79, 83) / 3600) * 15;
    const dec = (line[83] === '-' ? -1 : 1) * (+line.slice(84, 86) + +line.slice(86, 88) / 60 + +line.slice(88, 90) / 3600);
    const mag = +line.slice(102, 107);
    const bv = line.slice(109, 114).trim() === '' ? 0.6 : +line.slice(109, 114);
    if (Number.isFinite(ra) && Number.isFinite(dec) && Number.isFinite(mag)) out.push([ra, dec, mag, bv]);
  }
  return out;
}
