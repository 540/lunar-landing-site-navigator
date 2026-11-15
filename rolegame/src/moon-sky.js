// The sky of the 3D Moon panel (J8.1, #234): where the Sun and the Earth are seen from the south pole, their trail
// over the next days and their apparent orbit of one period. Pure, no three.js: positions are { x, y, z }.
// Read from the scenario series (series.json, hours from startUtc) with sampleAt of the Mirador, as the prototype
// did with its toy ephemeris (docs/juego-rol/index.html, Moon3D, l. 305-349).
import { sampleAt } from '../../viewpoint/src/core/series.js';

const D2R = Math.PI / 180;
const HOUR_MS = 3600e3;

/** Synodic month (one turn of the Sun in the lunar sky) and the Earth's period, in hours. */
export const SYNODIC_H = 29.53 * 24;
export const EARTH_PERIOD_H = 27.55 * 24;
/** Distance of the Sun and the Earth from the centre of the Moon in the scene (prototype, l. 343). Not to scale. */
export const SUN_RADIUS = 3.4;
export const EARTH_RADIUS = 2.3;
/** Trail: the next 96 h every 2 h (49 points); orbit: 160 segments (161 points); chevrons on each orbit. */
export const TRAIL = { hours: 96, step: 2 };
export const ORBIT_POINTS = 160;
export const SUN_CHEVRONS = 12;
export const EARTH_CHEVRONS = 6;

/** Unit direction of an azimuth and elevation seen from the south pole (prototype dir, l. 305): lat = −el, lon = az. */
export function poleDir(az, el) {
  const lat = -el * D2R, lon = az * D2R;
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: -Math.cos(lat) * Math.sin(lon) };
}

const scale = (v, r) => ({ x: v.x * r, y: v.y * r, z: v.z * r });

/** Sun and Earth at game hour `t`: { sun: { az, el, pos }, earth: { az, el, pos } } (pos at their scene radius). */
export function skyAt(series, startMs, t) {
  const s = sampleAt(series, new Date(startMs + t * HOUR_MS));
  return {
    sun: { ...s.sun, pos: scale(poleDir(s.sun.az, s.sun.el), SUN_RADIUS) },
    earth: { ...s.earth, pos: scale(poleDir(s.earth.az, s.earth.el), EARTH_RADIUS) },
  };
}

/** Positions of the Sun and the Earth from `t` to `t + hours`, every `step` hours: { sun: [...], earth: [...] }. */
export function trail(series, startMs, t, { hours = TRAIL.hours, step = TRAIL.step } = {}) {
  const sun = [], earth = [];
  for (let h = 0; h <= hours + 1e-9; h += step) {
    const s = skyAt(series, startMs, t + h);
    sun.push(s.sun.pos); earth.push(s.earth.pos);
  }
  return { sun, earth };
}

/** One period of the apparent orbit of a body ('sun' or 'earth') from `t`: points + 1 positions at its radius. */
export function orbitPath(series, startMs, t, periodH, points = ORBIT_POINTS, body = 'sun') {
  const r = body === 'sun' ? SUN_RADIUS : EARTH_RADIUS;
  const out = [];
  for (let k = 0; k <= points; k++) {
    const s = sampleAt(series, new Date(startMs + (t + (periodH * k) / points) * HOUR_MS))[body];
    out.push(scale(poleDir(s.az, s.el), r));
  }
  return out;
}

/** `count` positions spread along a path, each with the unit direction towards the next point (prototype, l. 347-348). */
export function chevrons(path, count) {
  const n = path.length - 1;
  const out = [];
  for (let j = 0; j < count; j++) {
    const k = Math.round(((j + 0.5) * n) / count);
    const a = path[k], b = path[Math.min(n, k + 1)];
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    out.push({ pos: a, dir: { x: d.x / len, y: d.y / len, z: d.z / len } });
  }
  return out;
}

/** Last game hour from which the series still holds a whole orbit of the Sun. */
export const orbitFits = (series, hours) => hours + SYNODIC_H <= series.count - 1;
