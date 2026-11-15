// Generates the game scenario "procedural-shackleton" into rolegame/data/ (see docs/arquitectura-juego.md).
// Relief, masks, sunFrac and earthVis are ported from the prototype (docs/juego-rol/index.html, lines 192-230).
// The Sun and Earth az/el do NOT come from the prototype's toy ephemeris: they come hour by hour from series()
// of backend/src/ for shackleton-rim, like pipeline/ephemeris.mjs.
// J9.2: every scenario is an entry of pipeline/game-scenarios.json. `source: 'procedural'` is the relief above;
// `source: 'lola'` reads heights and horizon masks from the LOLA DEM of backend/src/terrain/ (lolaWorld).
// Usage: node pipeline/game-scenario.mjs [--scenario <id>]   (or: npm run pipeline:game-scenario)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { series } from '../backend/src/service.ts';
import { getSite } from '../backend/src/sites.ts';
import { R_MOON_KM } from '../backend/src/ephemeris.ts';
import { bilinear, configureDem, covers, layersFor, llToXY } from '../backend/src/terrain/dem.ts';
import { buildMask } from '../backend/src/terrain/horizonMask.ts';
import { createSceneFrame } from '../viewpoint/src/core/scene-frame.js';
import { toCenterAxes } from './mask-grid.mjs';
import { LOLA_CITATION, DEFAULT_DEM_DIR } from './relief.mjs';
import { createTables } from '../rolegame/src/engine/index.js';
import { solveLevels, assertSolvable, solverJson, marginsTable } from './game-solver.mjs';

export const SCENARIO_ID = 'procedural-shackleton';
export const SITE_ID = 'shackleton-rim';
export const N = 48;
export const CELL_M = 250;
export const AZB = 72;
export const RM = 1737400;
export const START_CELL = { x: 24, y: 31 };
export const PAD_CELL = { x: 34, y: 11 };
export const HILL_CELL = { x: 14, y: 18 };
export const HOURS = 336;
export const SEED = 11;
export const MAP_SIZE = 512;
export const SUN_MIN_EL = 0.5;
export const SEARCH_START = '2027-01-01T00:00:00.000Z';
export const SEARCH_END_EXCLUSIVE = '2028-01-01T00:00:00.000Z';
export const HOUR_MS = 3600e3;
/** Extra hours of series.json after the mission (the orbit of one period in J8, #213). */
export const SERIES_EXTRA_H = 720;
export const OUT_DIR = new URL('../rolegame/data/', import.meta.url);
export const scenarioDir = (id) => new URL(`${id}/`, OUT_DIR);
export const SCENARIO_DIR = scenarioDir(SCENARIO_ID);
export const OBSERVER_HEIGHT_M = 2;

/** Configuration of every scenario (J9.2): pipeline/game-scenarios.json, data rather than code. */
export const SCENARIOS_FILE = new URL('./game-scenarios.json', import.meta.url);
export const scenarioConfigs = () => JSON.parse(readFileSync(SCENARIOS_FILE, 'utf8'));
export function scenarioConfig(id) {
  const cfg = scenarioConfigs().find((c) => c.id === id);
  if (!cfg) throw new Error(`No hay escenario «${id}» en pipeline/game-scenarios.json`);
  return cfg;
}

// Copied from the prototype, plus slopeCost (J1.1), hints (J6.5) and the event figures (J6.4), which the
// prototype wrote in its code (newGame and pass): equilibrium is data, not code.
export const LEVELS = {
  beg: { need: 3, bat0: 85, deadline: 14 * 24, charge: 5, loadSun: 0.7, loadDark: 1.2, moveE: 1.6, txE: 2, txT: 1, txMinKm: 1, minBat: 15, event: false, panelMin: 0, maxSlope: 26, slopeCost: 12, earth: 'on', hints: true },
  mid: { need: 4, bat0: 66, deadline: 12 * 24, charge: 4, loadSun: 1, loadDark: 2, moveE: 2.2, txE: 3, txT: 2, txMinKm: 1, minBat: 20, event: true, panelMin: 0, maxSlope: 24, slopeCost: 12, earth: 'toggle', hints: true, eventFrom: 70, eventSpan: 70, spikeE: 12, antennaH: 24 },
  exp: { need: 5, bat0: 70, deadline: 10 * 24, charge: 3.8, loadSun: 1.1, loadDark: 2.3, moveE: 2.3, txE: 3, txT: 2, txMinKm: 1, minBat: 25, event: true, panelMin: 0.5, maxSlope: 22, slopeCost: 12, earth: 'none', hints: false, eventFrom: 70, eventSpan: 70, spikeE: 12, antennaH: 24 },
};

/**
 * Levels of a scenario (#313): the common LEVELS with the fields that its entry of game-scenarios.json overrides
 * (`levels: { beg: { deadline: 192 } }`). Only existing levels and fields: a typo throws instead of being ignored.
 */
export function scenarioLevels(cfg, base = LEVELS) {
  const over = cfg.levels ?? {};
  for (const [id, fields] of Object.entries(over)) {
    if (!base[id]) throw new Error(`El escenario «${cfg.id}» cambia el nivel «${id}», que no existe`);
    for (const k of Object.keys(fields)) {
      if (!(k in base[id])) throw new Error(`El escenario «${cfg.id}» cambia «${k}» en ${id}, que no es un campo de los niveles`);
    }
  }
  return Object.fromEntries(Object.entries(base).map(([id, level]) => [id, { ...level, ...(over[id] ?? {}) }]));
}

export const idx = (x, y) => y * N + x;

export function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Procedural relief of the grid (heights H) and 72-azimuth horizon masks M (degrees), curvature d²/2R. */
export function makeWorld(seed = SEED) {
  const r = rng(seed), H = new Float32Array(N * N), G = 7, lat = [];
  for (let i = 0; i < (G + 2) * (G + 2); i++) lat.push(r() * 2 - 1);
  const sm = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const gx = x / N * G, gy = y / N * G, ix = Math.floor(gx), iy = Math.floor(gy), u = sm(gx - ix), v = sm(gy - iy);
    const L = (a, b) => lat[(((b % (G + 2)) + (G + 2)) % (G + 2)) * (G + 2) + (((a % (G + 2)) + (G + 2)) % (G + 2))];
    const a = L(ix, iy), b = L(ix + 1, iy), c = L(ix, iy + 1), d = L(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const craters = [{ x: 24, y: 37.5, R: 9, D: 520, rim: 200 }];
  const keep = [START_CELL, PAD_CELL, HILL_CELL];
  while (craters.length < 10) {
    const c = { x: 3 + r() * 42, y: 3 + r() * 42, R: 1.6 + r() * 2.8, D: 90 + r() * 150, rim: 30 + r() * 40 };
    if (keep.every((k) => Math.hypot(k.x - c.x, k.y - c.y) > c.R + 4) && Math.hypot(c.x - 24, c.y - 37.5) > 12) craters.push(c);
  }
  const hills = [{ x: HILL_CELL.x, y: HILL_CELL.y, A: 620, s: 3.6 }, { x: 36, y: 4.5, A: 950, s: 4.2 }, { x: 5, y: 41, A: 480, s: 5 }, { x: 44, y: 30, A: 380, s: 4 }, { x: 26, y: 8, A: 260, s: 3 }];
  const heightAt = (x, y) => {
    let h = 22 * noise(x, y) + 8 * noise(x * 2.7 + 3, y * 2.7 + 5);
    for (const c of craters) {
      const d = Math.hypot(x - c.x, y - c.y), q = d / c.R;
      if (q < 1) h -= c.D * (1 - q * q);
      h += c.rim * Math.exp(-(((d - c.R) / (c.R * 0.25 + 0.8)) ** 2));
    }
    for (const k of hills) h += k.A * Math.exp(-((x - k.x) ** 2 + (y - k.y) ** 2) / (2 * k.s * k.s));
    return h;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[idx(x, y)] = heightAt(x, y);
  // Bilinear height of the grid at cell coordinates (outside the grid, 0), like hb of the prototype.
  const hb = (x, y) => {
    if (x < 0 || y < 0 || x > N - 1 || y > N - 1) return 0;
    const ix = Math.min(N - 2, Math.floor(x)), iy = Math.min(N - 2, Math.floor(y)), fx = x - ix, fy = y - iy;
    const a = H[idx(ix, iy)], b = H[idx(ix + 1, iy)], c = H[idx(ix, iy + 1)], d = H[idx(ix + 1, iy + 1)];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const M = new Float32Array(N * N * AZB);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h0 = H[idx(x, y)] + 2;
    for (let b = 0; b < AZB; b++) {
      const az = b * 360 / AZB * Math.PI / 180, dx = Math.sin(az), dy = -Math.cos(az);
      let m = -90;
      for (let k = 1; k <= 60; k++) {
        const d = k * CELL_M, a = Math.atan2(hb(x + dx * k, y + dy * k) - h0 - d * d / (2 * RM), d);
        if (a > m) m = a;
      }
      M[idx(x, y) * AZB + b] = m * 180 / Math.PI;
    }
  }
  // exactAt: the analytic relief the grid samples (round craters, smooth slopes); only the detail textures read it (#309).
  return { H, M, heightAt: hb, exactAt: heightAt };
}

// ---------- Detail relief of the map (J4.1): port of Terrain.build and blur of the prototype (l. 259-284) ----------
export const DETAIL_SIZE = 1024;
export const DETAIL_SEED = 77;
export const AO_MIN = 0.55;
export const AO_MAX = 1.12;

function hash(i, j, s) {
  let h = (i * 374761393 + j * 668265263 + s * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v - 0.5;
}

/** Box blur of radius r in both directions (prototype blur). */
export function blur(src, n, r) {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * n + Math.min(n - 1, Math.max(0, x))];
    for (let x = 0; x < n; x++) { tmp[y * n + x] = acc / (2 * r + 1); acc += src[y * n + Math.min(n - 1, x + r + 1)] - src[y * n + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(n - 1, Math.max(0, y)) * n + x];
    for (let y = 0; y < n; y++) { out[y * n + x] = acc / (2 * r + 1); acc += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x]; }
  }
  return out;
}

/** Detail relief at size²: height (m), albedo (0..1) and ambient occlusion (AO_MIN..AO_MAX). Deterministic. */
/**
 * Height of the grid H (N × N, cell centres on whole numbers) at any point, bicubic Catmull-Rom (#309). The detail
 * relief uses the analytic relief (exactAt) when the world has one; this is the fallback for a world with a grid only. Unlike the
 * bilinear heightAt of makeWorld, its slope does not jump at the cell edges: with the bilinear base the normals of the
 * detail relief changed in steps every cell and the low Sun drew stripes 1/48 of the map wide across the whole map.
 */
export function smoothHeight(H, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), tx = x - ix, ty = y - iy;
  const at = (cx, cy) => H[idx(Math.max(0, Math.min(N - 1, cx)), Math.max(0, Math.min(N - 1, cy)))];
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (cy) => cr(at(ix - 1, cy), at(ix, cy), at(ix + 1, cy), at(ix + 2, cy), tx);
  return cr(row(iy - 1), row(iy), row(iy + 1), row(iy + 2), ty);
}

export function detailRelief(W, size = DETAIL_SIZE) {
  const s = N / size, height = new Float32Array(size * size), albedo = new Float32Array(size * size);
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) {
    // Clamped to the grid: outside it the relief is unknown and the edge would show a false cliff (a bright line).
    const x = Math.min(N - 1, Math.max(0, (u + 0.5) * s - 0.5)), y = Math.min(N - 1, Math.max(0, (v + 0.5) * s - 0.5)), i = v * size + u;
    height[i] = (W.exactAt ? W.exactAt(x, y) : smoothHeight(W.H, x, y)) + 5 * vnoise(u / 48, v / 48, 1) + 2.4 * vnoise(u / 17, v / 17, 2) + 1.1 * vnoise(u / 6, v / 6, 3) + 0.5 * vnoise(u / 2.5, v / 2.5, 4);
    albedo[i] = 0.6 + 0.12 * vnoise(u / 90, v / 90, 5) + 0.05 * vnoise(u / 12, v / 12, 6);
  }
  // Detail craters, visual only (shallow): they do not cast shadows in the rules.
  let seed = DETAIL_SEED;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const k = size / 1024; // the prototype's sizes are in pixels of a 1024 map
  for (let c = 0; c < 420; c++) {
    const cx = rnd() * size, cy = rnd() * size, rr = (2 + Math.pow(rnd(), 2.2) * 26) * k, dep = rr / k * 1.1, rim = dep * 0.35, fresh = rnd() < 0.18;
    const ext = Math.ceil(rr * (fresh ? 3.2 : 1.8));
    for (let v = Math.max(0, Math.floor(cy - ext)); v < Math.min(size, cy + ext); v++) for (let u = Math.max(0, Math.floor(cx - ext)); u < Math.min(size, cx + ext); u++) {
      const d = Math.sqrt((u - cx) * (u - cx) + (v - cy) * (v - cy)), q = d / rr, i = v * size + u;
      if (q < 1) height[i] -= dep * (1 - q * q);
      height[i] += rim * Math.exp(-(((q - 1) / 0.28) ** 2));
      if (fresh && q > 0.8) albedo[i] += 0.16 * Math.exp(-(q - 1) * 1.2) * (0.6 + 0.4 * vnoise(Math.atan2(v - cy, u - cx) * 6, q, 9) * 2);
      else if (fresh && q <= 0.8) albedo[i] += 0.08;
    }
  }
  const bl = blur(height, size, Math.round(14 * k)), ao = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) ao[i] = Math.max(AO_MIN, Math.min(AO_MAX, 1 + (height[i] - bl[i]) / 70));
  return { height, albedo, ao };
}

// ---------- Horizon per pixel of the map (J4.2, J4.3) ----------
// Same relief and same tracing as the masks of makeWorld (bilinear grid height, 60 steps of CELL_M, curvature,
// observer 2 m up), but from the centre of each map pixel, so the shadows of the map agree with sun.bin.
// Stored as a grey PNG atlas: the tile of direction d sits at column d % cols and row floor(d / cols).
// 48 directions (not 32) and 24 in the low one (not 16): with fewer, the map and sun.bin agree in less than 99 %
// and 97 % of the cell-hour pairs (measured: 32 → 98.5 %, 16 → 95.4 %).
export const HORIZON = { size: 256, directions: 48, cols: 8, offset: -2, step: 0.05 };
export const HORIZON_LOW = { size: 128, directions: 24, cols: 6, offset: -2, step: 0.05 };

/** Horizon elevation (degrees) of size² map points and `directions` azimuths, as Uint8 (offset + value × step), in an atlas. */
export function horizonAtlas(W, { size, directions, cols, offset, step }) {
  const rows = Math.ceil(directions / cols), width = cols * size;
  const out = new Uint8Array(width * rows * size);
  const dirs = [];
  for (let d = 0; d < directions; d++) {
    const az = (d * 360 / directions) * Math.PI / 180;
    dirs.push([Math.sin(az), -Math.cos(az)]);
  }
  const s = N / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Pixel centre in cell coordinates, clamped to the grid (outside it heightAt is 0).
    const gx = Math.min(N - 1, Math.max(0, (x + 0.5) * s - 0.5)), gy = Math.min(N - 1, Math.max(0, (y + 0.5) * s - 0.5));
    const h0 = W.heightAt(gx, gy) + 2;
    for (let d = 0; d < directions; d++) {
      const [dx, dy] = dirs[d];
      let m = -90;
      for (let k = 1; k <= 60; k++) {
        const dist = k * CELL_M, a = Math.atan2(W.heightAt(gx + dx * k, gy + dy * k) - h0 - dist * dist / (2 * RM), dist);
        if (a > m) m = a;
      }
      const deg = m * 180 / Math.PI;
      out[(Math.floor(d / cols) * size + y) * width + (d % cols) * size + x] = Math.max(0, Math.min(255, Math.round((deg - offset) / step)));
    }
  }
  return out;
}

/** Description of a horizon atlas in scenario.json. */
export const horizonFile = (file, h) => ({
  file, size: h.size, directions: h.directions, cols: h.cols, rows: Math.ceil(h.directions / h.cols), offset: h.offset, step: h.step,
  encoding: 'grey PNG: degrees = offset + value × step', layout: 'tile d at column d % cols, row floor(d / cols); azimuth d × 360 / directions from north towards east; pixel (x, y) of a tile = map point (x, y), centres at (x + 0.5) / size',
});

/** Horizon atlas as a grey PNG (sub filter). */
export function horizonPng(W, h) {
  const rows = Math.ceil(h.directions / h.cols);
  return encodePng(horizonAtlas(W, h), h.cols * h.size, rows * h.size, { filter: 1 });
}

/** Unit normals of a height map (central differences, pixel step px metres), as RGB bytes (n + 1) / 2 × 255. */
export function normalBytes(height, size, px) {
  const out = new Uint8Array(size * size * 3);
  for (let v = 0; v < size; v++) {
    const vm = Math.max(1, Math.min(size - 2, v));
    for (let u = 0; u < size; u++) {
      const um = Math.max(1, Math.min(size - 2, u));
      const gx = (height[vm * size + um + 1] - height[vm * size + um - 1]) / (2 * px);
      const gy = (height[(vm + 1) * size + um] - height[(vm - 1) * size + um]) / (2 * px);
      const nl = Math.sqrt(gx * gx + gy * gy + 1), o = (v * size + u) * 3;
      out[o] = Math.round(((-gx / nl + 1) / 2) * 255);
      out[o + 1] = Math.round(((-gy / nl + 1) / 2) * 255);
      out[o + 2] = Math.round(((1 / nl + 1) / 2) * 255);
    }
  }
  return out;
}

/** Floats lo..hi → bytes 0..255. */
export function toBytes(values, lo, hi) {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, (values[i] - lo) / (hi - lo))) * 255);
  return out;
}

export function maskAt(W, i, az) {
  const f = ((az % 360) + 360) % 360 / (360 / AZB), b0 = Math.floor(f) % AZB, b1 = (b0 + 1) % AZB, t = f - Math.floor(f);
  return W.M[i * AZB + b0] * (1 - t) + W.M[i * AZB + b1] * t;
}

/** Fraction of the 0.53° solar disc above the mask, 0 to 1. */
export const sunFrac = (W, i, sun) => Math.max(0, Math.min(1, (sun.el - maskAt(W, i, sun.az)) / 0.53 + 0.5));
/** Earth counts as visible with a 0.3° margin over the mask. */
export const earthVis = (W, i, earth) => earth.el - maskAt(W, i, earth.az) > 0.3;

/** Hourly az/el of Sun and Earth for `count` hours from `startMs`, from the engine (no terrain). */
export function hourlySeries(startMs, count, siteId = SITE_ID) {
  const s = series(getSite(siteId), startMs, startMs + (count - 1) * HOUR_MS, HOUR_MS);
  return { sunAz: s.sun.az, sunEl: s.sun.el, earthAz: s.earth.az, earthEl: s.earth.el };
}

/**
 * First hourly instant of 2027 where the Sun, without terrain, stays above SUN_MIN_EL for the whole mission
 * and the Earth is above the horizon at some hour. Throws if none exists.
 */
export function pickStart(siteId = SITE_ID, { search = [SEARCH_START, SEARCH_END_EXCLUSIVE], sunMinEl = SUN_MIN_EL } = {}) {
  const t0 = Date.parse(search[0]);
  const total = Math.round((Date.parse(search[1]) - t0) / HOUR_MS);
  const s = hourlySeries(t0, total, siteId);
  const need = total - HOURS + 1;
  let sunRun = 0; // consecutive hours with Sun above the threshold, counted from the right
  const ok = new Array(total).fill(false);
  for (let i = total - 1; i >= 0; i--) { sunRun = s.sunEl[i] > sunMinEl ? sunRun + 1 : 0; ok[i] = sunRun >= HOURS; }
  for (let i = 0; i < need; i++) {
    if (!ok[i]) continue;
    let earth = false;
    for (let h = i; h < i + HOURS; h++) if (s.earthEl[h] > 0) { earth = true; break; }
    if (earth) return new Date(t0 + i * HOUR_MS).toISOString();
  }
  throw new Error(`Ninguna fecha entre ${search[0]} y ${search[1]} mantiene el Sol por encima de ${sunMinEl}° durante ${HOURS} h en ${siteId} con la Tierra asomando en alguna; no se baja el umbral a escondidas.`);
}

/** Grey hill-shading of the relief at MAP_SIZE², bilinear upsample of the grid, light from the north-west. */
export function shadeMap(H) {
  const h = (x, y) => H[idx(Math.max(0, Math.min(N - 1, x)), Math.max(0, Math.min(N - 1, y)))];
  const at = (fx, fy) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    return (h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx) * (1 - ty) + (h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx) * ty;
  };
  const scale = N / MAP_SIZE; // grid cells per map pixel; at() takes grid coordinates, so slopes span 2 cells = 2 * CELL_M metres
  const out = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const lx = -0.5, ly = -0.5, lz = Math.SQRT1_2; // unit-ish light vector (from NW, 45° high)
  for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) {
    const fx = (x + 0.5) * scale - 0.5, fy = (y + 0.5) * scale - 0.5;
    const dzx = (at(fx + 1, fy) - at(fx - 1, fy)) / (2 * CELL_M), dzy = (at(fx, fy + 1) - at(fx, fy - 1)) / (2 * CELL_M);
    const nl = Math.hypot(dzx, dzy, 1);
    const dot = (-dzx * lx - dzy * ly + lz) / nl;
    out[y * MAP_SIZE + x] = Math.round(Math.max(0, Math.min(1, 0.15 + 0.85 * dot)) * 255);
  }
  return out;
}

/** Same light as shadeMap, from heights in metres per pixel (size², rows north to south) `pixelM` apart (LOLA, J9.2). */
export function shadePixels(hp, size, pixelM) {
  const h = (x, y) => hp[Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x))];
  const out = new Uint8Array(size * size);
  const lx = -0.5, ly = -0.5, lz = Math.SQRT1_2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dzx = (h(x + 1, y) - h(x - 1, y)) / (2 * pixelM), dzy = (h(x, y + 1) - h(x, y - 1)) / (2 * pixelM);
    const nl = Math.hypot(dzx, dzy, 1);
    const dot = (-dzx * lx - dzy * ly + lz) / nl;
    out[y * size + x] = Math.round(Math.max(0, Math.min(1, 0.15 + 0.85 * dot)) * 255);
  }
  return out;
}

/**
 * LOLA relief of a scenario (J9.2): n × n cells of cellM metres centred on the site, in the scene frame of its centre
 * (createSceneFrame; x east, z south, so the north is −y of the grid). For every cell centre: the DEM height (bilinear on the
 * finest grid of layersFor 'precise', no curvature, as relief.mjs reads it) and the horizon mask of buildMask, turned to the axes
 * of the centre with toCenterAxes and resampled to AZB azimuths (rounded to 0.01°, the precision of masks.bin). The map is
 * shaded from the DEM at every pixel, and so are the detail textures. Throws, naming the cell, when no DEM covers it.
 * `center` (optional) replaces the site of the catalogue and `grids` the DEM folder (tests).
 */
export const LOLA_ALBEDO = 0.6;
/** Cells beyond the grid that the per-pixel horizon traces (horizonAtlas: 60 steps of CELL_M). */
export const HORIZON_REACH = 60;
export function lolaWorld({ siteId, center }, { demDir = DEFAULT_DEM_DIR, grids, n = N, cellM = CELL_M, mapSize = MAP_SIZE, detailSize = DETAIL_SIZE } = {}) {
  const c = center ?? (() => { const site = getSite(siteId); return { lat: site.lat, lon: site.lon }; })();
  const version = grids ? configureDem({ grids }) : configureDem({ dir: demDir });
  if (!version) throw new Error(`No hay DEM LOLA en ${demDir}cache. Descárgalo una vez: cd backend && node scripts/fetch-dem.ts && node scripts/fetch-dem.ts --near ${c.lat},${c.lon} --half-km 22`);
  const frame = createSceneFrame({ radiusKm: R_MOON_KM, centerLat: c.lat, centerLon: c.lon });
  const halfKm = (n * cellM) / 2000;
  const used = new Set();
  const heightAt = (xKm, zKm) => {
    const { lat, lon } = frame.fromScene(xKm, zKm);
    const [px, py] = llToXY(lat, lon);
    for (const { g } of layersFor(lat, lon, 'precise')?.layers ?? []) {
      if (!covers(g, px, py)) continue;
      const h = bilinear(g, px, py);
      if (Number.isFinite(h)) { used.add(`${g.product}@${g.res}m`); return { h, lat, lon }; }
    }
    return { h: NaN, lat, lon };
  };
  const H = new Float32Array(n * n);
  const M = new Float32Array(n * n * AZB);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    const p = heightAt(-halfKm + ((x + 0.5) * cellM) / 1000, -halfKm + ((y + 0.5) * cellM) / 1000);
    const mask = Number.isFinite(p.h) ? buildMask(p.lat, p.lon, { observerHeightM: OBSERVER_HEIGHT_M, resolution: 'precise' }) : null;
    if (!mask) throw new Error(`Ningún DEM cubre la celda (${x}, ${y}) del escenario (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})`);
    H[i] = p.h;
    const el = toCenterAxes(mask.el, { lat: p.lat, lon: p.lon }, c, AZB);
    for (let k = 0; k < AZB; k++) M[i * AZB + k] = Math.round(el[k] * 100) / 100;
  }
  const pixelM = (n * cellM) / mapSize;
  const hp = new Float64Array(mapSize * mapSize);
  for (let y = 0; y < mapSize; y++) for (let x = 0; x < mapSize; x++) {
    const p = heightAt(-halfKm + ((x + 0.5) * pixelM) / 1000, -halfKm + ((y + 0.5) * pixelM) / 1000);
    if (!Number.isFinite(p.h)) throw new Error(`Ningún DEM cubre el píxel (${x}, ${y}) del mapa (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})`);
    hp[y * mapSize + x] = p.h;
  }
  // Height at any grid coordinate (cell centres on whole numbers), as makeWorld's heightAt: the per-pixel horizon of
  // J4.2 (horizonAtlas) traces 60 cells beyond the grid, so a raster of half cells covers that reach from the DEM.
  const reach = HORIZON_REACH, rN = 2 * (n - 1 + 2 * reach) + 1;
  const raster = new Float64Array(rN * rN);
  for (let j = 0; j < rN; j++) for (let i = 0; i < rN; i++) {
    const gx = -reach + i / 2, gy = -reach + j / 2;
    const p = heightAt(-halfKm + ((gx + 0.5) * cellM) / 1000, -halfKm + ((gy + 0.5) * cellM) / 1000);
    if (!Number.isFinite(p.h)) throw new Error(`Ningún DEM cubre el punto (${gx}, ${gy}) del horizonte por píxel (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})`);
    raster[j * rN + i] = p.h;
  }
  const rasterAt = (gx, gy) => {
    const fx = Math.min(rN - 1, Math.max(0, (gx + reach) * 2)), fy = Math.min(rN - 1, Math.max(0, (gy + reach) * 2));
    const i = Math.min(rN - 2, Math.floor(fx)), j = Math.min(rN - 2, Math.floor(fy)), tx = fx - i, ty = fy - j;
    const a = raster[j * rN + i], b = raster[j * rN + i + 1], c2 = raster[(j + 1) * rN + i], d = raster[(j + 1) * rN + i + 1];
    return a + (b - a) * tx + (c2 - a) * ty + (a - b - c2 + d) * tx * ty;
  };
  // Detail textures (J4.1) from the DEM too: real heights for the normals and the occlusion, flat albedo.
  const height = new Float32Array(detailSize * detailSize);
  const detailM = (n * cellM) / detailSize;
  for (let y = 0; y < detailSize; y++) for (let x = 0; x < detailSize; x++) {
    const p = heightAt(-halfKm + ((x + 0.5) * detailM) / 1000, -halfKm + ((y + 0.5) * detailM) / 1000);
    if (!Number.isFinite(p.h)) throw new Error(`Ningún DEM cubre el píxel (${x}, ${y}) de las texturas (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)})`);
    height[y * detailSize + x] = p.h;
  }
  const bl = blur(height, detailSize, Math.round((14 * detailSize) / 1024));
  const ao = new Float32Array(detailSize * detailSize);
  for (let i = 0; i < ao.length; i++) ao[i] = Math.max(AO_MIN, Math.min(AO_MAX, 1 + (height[i] - bl[i]) / 70));
  const detail = { height, albedo: new Float32Array(detailSize * detailSize).fill(LOLA_ALBEDO), ao };
  return { H, M, heightAt: rasterAt, map: shadePixels(hp, mapSize, pixelM), detail, center: c, source: { type: 'lola', products: [...used].sort(), demVersion: version, citation: LOLA_CITATION } };
}

/**
 * Minimal 8-bit PNG with zlib from Node (deterministic): greyscale (channels 1, colour type 0) or RGB (channels 3,
 * colour type 2). filter 0 (none) or 1 (sub: each byte minus the one of the previous pixel, smaller for noisy maps).
 */
export function encodePng(pixels, w, h, { channels = 1, filter = 0 } = {}) {
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1);
    raw[row] = filter;
    for (let x = 0; x < stride; x++) {
      const b = pixels[y * stride + x];
      raw[row + 1 + x] = filter === 1 && x >= channels ? (b - pixels[y * stride + x - channels]) & 255 : b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = channels === 3 ? 2 : 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Relief of a scenario: { H, M, map, source? } from makeWorld (procedural) or the LOLA DEM. */
export function scenarioWorld(cfg, options = {}) {
  if (cfg.source === 'procedural') { const W = makeWorld(cfg.seed); return { H: W.H, M: W.M, heightAt: W.heightAt, map: shadeMap(W.H), detail: detailRelief(W, DETAIL_SIZE) }; }
  if (cfg.source === 'lola') return lolaWorld(cfg, options);
  throw new Error(`source debe ser «procedural» o «lola», no «${cfg.source}»`);
}

/**
 * Builds every file of a scenario in memory: { 'scenario.json': Buffer, ... }. `world` (optional) is a relief already
 * computed with scenarioWorld (the LOLA masks take minutes); `config` overrides fields of the entry (to try start and pad
 * candidates); the rest of `options` goes to lolaWorld.
 */
/**
 * Figures of a scenario for the texts (J9.4), computed here so the client only reads them from scenario.json:
 * - earthFirstDay / earthLastDay: first and last mission day (floor(h / 24) + 1) with the Earth in sight from some
 *   cell (earth.bin); null when it never shows up.
 * - sunMaxElDeg: highest Sun elevation of the mission without relief, one decimal.
 * - sunAzPer48hDeg: mean advance of the Sun's azimuth in 48 h over the mission, one decimal.
 * - earthElRangeDeg: lowest and highest Earth elevation of the mission without relief, one decimal.
 * - padKm: straight distance from the exit to the pad (padDistanceKm of rolegame/src/hint.js).
 * - startMaskNorthDeg: highest horizon of the exit cell between azimuths 315° and 45°, one decimal.
 * `series` has sunAz, sunEl and earthEl (at least `hours` rows); `earth` is the earth.bin bits; `M` the masks in
 * degrees (n × n × azb).
 */
export function scenarioFacts({ series: s, earth, n, hours, start, pad, cellM, M, azb = AZB }) {
  const r1 = (v) => Math.round(v * 10) / 10;
  const cells = n * n;
  let first = null, last = null;
  for (let h = 0; h < hours; h++) {
    let any = false;
    for (let i = 0; i < cells && !any; i++) { const o = h * cells + i; any = (earth[o >> 3] & (1 << (o & 7))) !== 0; }
    if (any) { if (first === null) first = h; last = h; }
  }
  let sunMax = -Infinity, eMin = Infinity, eMax = -Infinity, turn = 0;
  for (let h = 0; h < hours; h++) {
    sunMax = Math.max(sunMax, s.sunEl[h]);
    eMin = Math.min(eMin, s.earthEl[h]); eMax = Math.max(eMax, s.earthEl[h]);
    if (h > 0) turn += ((s.sunAz[h] - s.sunAz[h - 1] + 540) % 360) - 180;
  }
  const startCell = start.y * n + start.x;
  let north = -Infinity;
  for (let k = 0; k < azb; k++) {
    const az = (k * 360) / azb;
    if (az >= 315 || az <= 45) north = Math.max(north, M[startCell * azb + k]);
  }
  return {
    earthFirstDay: first === null ? null : Math.floor(first / 24) + 1,
    earthLastDay: last === null ? null : Math.floor(last / 24) + 1,
    sunMaxElDeg: r1(sunMax),
    sunAzPer48hDeg: r1(Math.abs(turn / (hours - 1)) * 48),
    earthElRangeDeg: [r1(eMin), r1(eMax)],
    padKm: (Math.hypot(pad.x - start.x, pad.y - start.y) * cellM) / 1000,
    startMaskNorthDeg: r1(north),
  };
}

export function buildScenario(id = SCENARIO_ID, { world, config, ...options } = {}) {
  const cfg = { ...scenarioConfig(id), ...config };
  const startUtc = cfg.startUtc ?? pickStart(cfg.siteId, cfg.startRule);
  const t0 = Date.parse(startUtc);
  const W = world ?? scenarioWorld(cfg, options);
  // The series runs SERIES_EXTRA_H hours past the mission; sun.bin and earth.bin use its first HOURS rows.
  const s = hourlySeries(t0, HOURS + SERIES_EXTRA_H, cfg.siteId);
  const cells = Buffer.from(W.H.buffer, W.H.byteOffset, W.H.byteLength); // Float32Array, little-endian on every supported host
  const sun = Buffer.alloc(HOURS * N * N);
  const earth = Buffer.alloc(Math.ceil(HOURS * N * N / 8));
  for (let h = 0; h < HOURS; h++) {
    const sunH = { az: s.sunAz[h], el: s.sunEl[h] }, earthH = { az: s.earthAz[h], el: s.earthEl[h] };
    for (let i = 0; i < N * N; i++) {
      const o = h * N * N + i;
      sun[o] = Math.round(sunFrac(W, i, sunH) * 255);
      if (earthVis(W, i, earthH)) earth[o >> 3] |= 1 << (o & 7);
    }
  }
  // Horizon mask of each cell (J3.4): Int16 little-endian, hundredths of a degree, masks[i * AZB + k] for az k * 5°.
  const masks = Buffer.alloc(N * N * AZB * 2);
  for (let k = 0; k < N * N * AZB; k++) masks.writeInt16LE(Math.round(W.M[k] * 100), k * 2);
  // Detail textures of the map (J4.1): normals (RGB), albedo and ambient occlusion (grey), DETAIL_SIZE².
  const detail = W.detail;
  const detailPx = (N * CELL_M) / DETAIL_SIZE;
  const png = (bytes, channels) => encodePng(bytes, DETAIL_SIZE, DETAIL_SIZE, { channels, filter: 1 });
  const seriesDoc = {
    version: 1,
    siteId: cfg.siteId,
    start: startUtc,
    stepMinutes: 60,
    count: HOURS + SERIES_EXTRA_H,
    source: `backend/src (astronomy-engine), sin relieve: azimut y elevación del Sol y de la Tierra para ${cfg.siteId}. El relieve de cada celda está en masks.bin.`,
    sun: { az: s.sunAz, el: s.sunEl },
    earth: { az: s.earthAz, el: s.earthEl },
  };
  const facts = scenarioFacts({ series: s, earth, n: N, hours: HOURS, start: cfg.start, pad: cfg.pad, cellM: CELL_M, M: W.M });
  const lola = cfg.source === 'lola';
  const files = {
      cells: { file: 'cells.bin', type: 'float32', endian: 'little', unit: 'm', length: N * N, layout: 'cells[i], i = y * n + x' },
      sun: { file: 'sun.bin', type: 'uint8', scale: 255, length: HOURS * N * N, layout: 'sun[h * n * n + i]' },
      earth: { file: 'earth.bin', type: 'bits', bitOrder: 'lsb-first', length: HOURS * N * N, layout: 'bit h * n * n + i' },
      masks: { file: 'masks.bin', type: 'int16', endian: 'little', scale: 100, unit: 'deg', length: N * N * AZB, azimuths: AZB, layout: 'masks[i * 72 + k], azimuth k * 5° from north towards east' },
      series: { file: 'series.json', format: 'viewpoint series (version, siteId, start, stepMinutes, count, source, sun: { az, el }, earth: { az, el })', stepMinutes: 60, count: HOURS + SERIES_EXTRA_H, layout: 'row h = startUtc + h hours; the game uses the first hours rows' },
      map: { file: 'map.png', width: MAP_SIZE, height: MAP_SIZE },
      normals: { file: 'map-normals.png', width: DETAIL_SIZE, height: DETAIL_SIZE, encoding: 'RGB = (n + 1) / 2 × 255; x east, y south (image down), z up', pixelM: detailPx },
      albedo: { file: 'map-albedo.png', width: DETAIL_SIZE, height: DETAIL_SIZE, encoding: 'grey 0..255 = albedo 0..1' },
      horizon: horizonFile('map-horizon.png', HORIZON),
      horizonLow: horizonFile('map-horizon-low.png', HORIZON_LOW),
      ao: { file: 'map-ao.png', width: DETAIL_SIZE, height: DETAIL_SIZE, encoding: `grey 0..255 = occlusion ${AO_MIN}..${AO_MAX}`, min: AO_MIN, max: AO_MAX },
  };
  const dateRule = cfg.startUtc
    ? `Fecha de inicio: fija en pipeline/game-scenarios.json (${cfg.startUtc}).`
    : `Fecha de inicio: el primer instante horario de 2027 en que el Sol, sin relieve, está por encima de ${cfg.startRule?.sunMinEl ?? SUN_MIN_EL}° durante ${HOURS} h y la Tierra asoma (elevación > 0) en alguna. Elegida por el script, para revisar con el resolutor en J9.1.`;
  const ephemeris = `Efemérides: series() de backend/src (astronomy-engine) para ${cfg.siteId}, hora a hora desde startUtc.`;
  // The procedural scenario keeps exactly the shape it had before J9.2 (same bytes); LOLA adds source and name in two languages.
  const scenario = lola
    ? {
      version: 1, id: cfg.id, name: cfg.name, siteId: cfg.siteId, source: W.source, center: W.center,
      grid: { n: N, cellM: CELL_M }, start: { ...cfg.start }, pad: { ...cfg.pad }, startUtc, hours: HOURS, facts,
      // #313: the level fields this scenario changes; the game merges them over levels.json, as the solver does.
      ...(cfg.levels ? { levels: cfg.levels } : {}),
      files,
      sources: [
        `Relieve: LOLA (${W.source.products.join(', ')}, demVersion ${W.source.demVersion}), ${LOLA_CITATION}. Alturas en el centro de cada celda y máscaras del horizonte con buildMask (observador a ${OBSERVER_HEIGHT_M} m, preciso), giradas a los ejes del centro y remuestreadas a ${AZB} azimuts.`,
        `Texturas del mapa: normales y oclusión de las alturas del DEM a ${DETAIL_SIZE} × ${DETAIL_SIZE} píxeles; albedo uniforme (${LOLA_ALBEDO}), porque LOLA no da reflectancia.`,
        ephemeris,
        dateRule,
        cfg.positionsNote ?? 'Salida y plataforma: provisionales, elegidas a mano y validadas por el resolutor (J9.2); las elige el resolutor en J9.3.',
      ],
    }
    : {
      version: 1, id: cfg.id, name: cfg.name.es, siteId: cfg.siteId, grid: { n: N, cellM: CELL_M }, start: { ...cfg.start }, pad: { ...cfg.pad },
      startUtc, hours: HOURS, seed: cfg.seed, facts, files,
      sources: [
        `Relieve: procedural, portado de makeWorld del prototipo (docs/juego-rol/index.html), semilla ${cfg.seed}, máscaras de 72 azimuts. Demo · relieve simulado.`,
        'Texturas del mapa (map-normals.png, map-albedo.png, map-ao.png): relieve de detalle portado de Terrain.build del prototipo (ruido de valor y 420 cráteres de detalle, semilla 77), solo visual: las sombras de las reglas salen del relieve de la rejilla.',
        ephemeris,
        dateRule,
      ],
    };
  // J9.1: the solver plays every level with the engine before anything is written; it throws if one cannot be
  // won or is trivial (no threshold is lowered behind the scenes).
  const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  const tables = createTables(ab(sun), scenario, ab(cells), ab(earth));
  const levels = scenarioLevels(cfg);
  const solved = solveLevels({ scenario, levels, tables });
  assertSolvable(solved, levels);
  return {
    'scenario.json': Buffer.from(JSON.stringify(scenario, null, 2) + '\n'),
    'solver.json': Buffer.from(solverJson(solved)),
    'cells.bin': cells,
    'sun.bin': sun,
    'earth.bin': earth,
    'masks.bin': masks,
    'series.json': Buffer.from(JSON.stringify(seriesDoc) + '\n'),
    'map.png': encodePng(W.map, MAP_SIZE, MAP_SIZE),
    'map-normals.png': png(normalBytes(detail.height, DETAIL_SIZE, detailPx), 3),
    'map-albedo.png': png(toBytes(detail.albedo, 0, 1), 1),
    'map-ao.png': png(toBytes(detail.ao, AO_MIN, AO_MAX), 1),
    'map-horizon.png': horizonPng(W, HORIZON),
    'map-horizon-low.png': horizonPng(W, HORIZON_LOW),
  };
}

export const levelsJson = () => JSON.stringify(LEVELS, null, 2) + '\n';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--scenario');
  const id = i > 0 ? process.argv[i + 1] : SCENARIO_ID;
  const t0 = Date.now();
  const files = buildScenario(id);
  const dir = scenarioDir(id);
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (const [name, buf] of Object.entries(files)) { writeFileSync(new URL(name, dir), buf); bytes += buf.length; }
  writeFileSync(new URL('levels.json', OUT_DIR), levelsJson());
  const { startUtc } = JSON.parse(files['scenario.json']);
  console.log(marginsTable(JSON.parse(files['solver.json'])));
  console.log(`Escenario ${id} escrito en rolegame/data/ (${(bytes / 1024).toFixed(0)} KB, inicio ${startUtc}, ${Math.round((Date.now() - t0) / 1000)} s)`);
}
