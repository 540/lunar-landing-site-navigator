// South-pole relief shared by the maps of Advanced and Replan: the LOLA image and the shaded relief of the simulated engine.
import * as M from '../engine/model.js';
import { POLAR_MAP_RADIUS_KM } from '../engine/catalog.js';
import { createReliefLoader } from './relief-image.js';
import { fmtDeg } from './i18n.js';

const MAP = { size: 360, radiusKm: POLAR_MAP_RADIUS_KM };
MAP.scale = MAP.size / 2 / MAP.radiusKm;
const toKm = (px, py) => ({ x: (px - MAP.size / 2) / MAP.scale, y: (MAP.size / 2 - py) / MAP.scale });

// Real relief (LOLA), shaded by backend/scripts/build-web-relief.ts, shared by the Advanced and Replan maps (#331).
// Loaded once, on first use (common/relief-image.js). `state` is 'loading' | 'ready' | 'failed'; until it is 'ready'
// the maps draw the invented relief of getTerrain(), and common/relief-note.js says which one is on screen.
const RELIEF_SRC = 'assets/south-pole-relief.png';
/** The shared LOLA relief: { img, state }. Pass `onChange` to hear when its state changes (returns an unsubscribe). */
export const reliefImage = createReliefLoader(RELIEF_SRC, ({ onload, onerror }) => {
  const img = new Image();
  img.onload = onload;
  img.onerror = onerror;
  return img;
});

let terrainImg = null;
export const resetTerrain = () => { terrainImg = null; };
// For the maps that reuse the terrain (the top-3 map in Advanced, Replan): the shaded image and the radius it covers.
export const MAP_RADIUS_KM = MAP.radiusKm;
export function getTerrain() { if (!terrainImg) buildTerrain(); return terrainImg; }
function buildTerrain() {
  const cv = document.createElement('canvas'); cv.width = cv.height = MAP.size;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(MAP.size, MAP.size);
  for (let py = 0; py < MAP.size; py++) for (let px = 0; px < MAP.size; px++) {
    const { x, y } = toKm(px, py);
    if (Math.hypot(x, y) > MAP.radiusKm) continue;
    const h = M.elevation(x, y), hx = M.elevation(x + 1, y) - h, hy = M.elevation(x, y + 1) - h;
    const shade = Math.max(0, Math.min(1, 0.55 - 1.6 * hx + 1.6 * hy + h * 0.04));
    const g = 38 + shade * 95;
    const i = (py * MAP.size + px) * 4;
    img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g + 4; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  terrainImg = cv;
}

// ---------------- Base layer of the south-pole maps (#344) ----------------
// Advanced and Replan draw the same base: relief, hatching where the relief image ends, latitude rings and, if asked,
// the names of the craters and mountains. Each view then draws only its own markers on top. The note that goes with
// it (relief source, hatching, orientation) is baseMapNote() in common/relief-note.js.

/** Degrees between latitude rings for a frame of `radiusKm`: 2° for the whole pole, 1° for a region, 0.5° up close. */
export const ringStepDeg = radiusKm => (radiusKm >= 150 ? 2 : radiusKm >= 80 ? 1 : 0.5);

/** The latitude rings (degrees from the pole) that cross a frame of `radiusKm` around `centre` (km in the map). */
export function ringsFor(centre, radiusKm) {
  const step = ringStepDeg(radiusKm), d = Math.hypot(centre.x, centre.y);
  const from = Math.max(step, Math.ceil((d - radiusKm) / M.KM_PER_DEGREE / step) * step), to = (d + radiusKm) / M.KM_PER_DEGREE;
  const rings = [];
  for (let g = from; g <= to + 1e-9; g += step) rings.push(Math.round(g * 10) / 10);
  return { step, rings };
}

/** Whether a round frame of `radiusKm` around `centre` reaches beyond the relief image (the square ±MAP_RADIUS_KM). */
export const outsideRelief = (centre, radiusKm) =>
  Math.abs(centre.x) + radiusKm > MAP_RADIUS_KM + 1e-9 || Math.abs(centre.y) + radiusKm > MAP_RADIUS_KM + 1e-9;

/** The named features labelled on the maps: the craters, Malapert and Mons Mouton (not the unnamed ridges). */
export const NAMED_FEATURES = [...M.FEATURES.craters, ...M.FEATURES.mountains.slice(0, 2)];

/**
 * Draws the base of a south-pole map on `ctx` (already scaled to CSS pixels) and returns what the views need on top.
 * - size: side of the canvas (px); centre: km in the map at the middle of the canvas; radius: km from the middle to the edge
 * - th: theme() colours and fonts; names: label the craters and mountains (too much text on a small map)
 * - beneath(ctx, px): optional, drawn over the relief and under the rings (the light map of Advanced)
 * Returns { px, relief, uncovered }: px turns km in the map into canvas pixels, relief is the state of the LOLA image
 * and uncovered says that part of the frame is hatched (the note must say so).
 */
export function drawBaseMap(ctx, { size, centre, radius, th, names = true, beneath = null }) {
  const C = size / 2, k = C / radius;
  const px = p => ({ x: C + (p.x - centre.x) * k, y: C - (p.y - centre.y) * k });
  // Relief: the image covers ±MAP_RADIUS_KM around the pole; until the LOLA one loads, the invented one.
  const relief = reliefImage(), real = relief.state === 'ready', img = real ? relief.img : getTerrain();
  const q = (real ? relief.img.naturalWidth : img.width) / (2 * MAP_RADIUS_KM);
  ctx.save(); ctx.beginPath(); ctx.arc(C, C, C, 0, 2 * Math.PI); ctx.clip();
  ctx.fillStyle = th.mapBg; ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (centre.x - radius + MAP_RADIUS_KM) * q, (MAP_RADIUS_KM - centre.y - radius) * q, 2 * radius * q, 2 * radius * q, 0, 0, size, size);
  // Beyond the relief image, hatched, so it does not read as dark terrain.
  const uncovered = outsideRelief(centre, radius);
  if (uncovered) {
    const tl = px({ x: -MAP_RADIUS_KM, y: MAP_RADIUS_KM }), side = 2 * MAP_RADIUS_KM * k;
    const tile = document.createElement('canvas'); tile.width = tile.height = 8;
    const tc = tile.getContext('2d'); tc.strokeStyle = th.mapLine; tc.beginPath(); tc.moveTo(0, 8); tc.lineTo(8, 0); tc.stroke();
    ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.rect(tl.x, tl.y, side, side);
    ctx.fillStyle = th.mapBg; ctx.fill('evenodd'); ctx.fillStyle = ctx.createPattern(tile, 'repeat'); ctx.fill('evenodd');
  }
  if (beneath) beneath(ctx, px);
  // Latitude rings around the pole; labelled only when the whole pole is on screen.
  const pole = px({ x: 0, y: 0 }), { step, rings } = ringsFor(centre, radius);
  ctx.strokeStyle = th.mapLine; ctx.fillStyle = th.mapText; ctx.lineWidth = 1; ctx.font = '9px ' + th.fontData; ctx.textAlign = 'start';
  for (const g of rings) {
    const rr = g * M.KM_PER_DEGREE * k;
    ctx.beginPath(); ctx.arc(pole.x, pole.y, rr, 0, 2 * Math.PI); ctx.stroke();
    if (step >= 2) ctx.fillText(fmtDeg(-90 + g, 0), pole.x + rr * 0.7071 + 2, pole.y + rr * 0.7071 - 2);
  }
  if (names) {
    ctx.font = 'italic 9px ' + th.fontBody; ctx.textAlign = 'center';
    for (const f of NAMED_FEATURES) { const p = px(f); ctx.fillText(f.name, p.x, p.y + 3); }
  }
  ctx.restore();
  return { px, relief, uncovered };
}
