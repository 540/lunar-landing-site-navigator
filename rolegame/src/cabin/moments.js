// Light and moments of the cabin (J12.5 #301, J12.7 #303): the pure decisions behind the blue zones on the ground,
// the headlights, the Earth rising, the rover's own shadow and the postcard. No three.js and no DOM here.

/** The rover's height that casts its shadow (antenna mast included), metres. */
export const ROVER_HEIGHT_M = 2.4;
/** Longest shadow drawn, metres (a Sun at 0.3° would give ~460 m; past this it is lost in the relief anyway). */
export const MAX_SHADOW_M = 320;
/** How long the «Earth rises» moment lasts, ms, and how much it slows the car meanwhile. */
export const RISE_MS = 2600;
export const RISE_SLOW = 0.35;

/**
 * Texels of the «Earth visible» layer laid on the ground: an n × n RGBA texture over the game grid, R = the cell sees
 * the Earth now, G = it will within the forecast hours (and does not now). Row y of the grid is row y of the texture.
 * `now` and `soon` are lists of cell indices (earthCells / earthForecastCells).
 */
export function earthGroundTexels(n, now = [], soon = []) {
  const out = new Uint8Array(n * n * 4);
  for (const i of soon) out[i * 4 + 1] = 255;
  for (const i of now) { out[i * 4] = 255; out[i * 4 + 1] = 0; }
  for (let i = 0; i < n * n; i++) out[i * 4 + 3] = 255;
  return out;
}

/** The headlights are on when the rover's cell is in shadow, the same threshold as the engine (sunFrac ≤ 0.5). */
export const headlightsOn = (sunFrac) => !(sunFrac > 0.5);

/** The Earth comes into sight from the rover's cell: it did not see it before and does now. */
export const earthRises = (before, now) => before === false && now === true;

/**
 * Factor on the car's time while the «Earth rises» moment plays: slowed for a moment and easing back to 1.
 * `sinceMs` since the moment started (null when none); none with reduced motion.
 */
export function riseSlowdown(sinceMs, reduced = false) {
  if (reduced || sinceMs === null || sinceMs < 0 || sinceMs >= RISE_MS) return 1;
  const k = sinceMs / RISE_MS;
  return RISE_SLOW + (1 - RISE_SLOW) * k * k;
}

/** Brightness 0 … 1 of the Earth's flash at `sinceMs`: a quick rise and a slow fade (no flash with reduced motion). */
export function riseFlash(sinceMs, reduced = false) {
  if (reduced || sinceMs === null || sinceMs < 0 || sinceMs >= RISE_MS) return 0;
  const k = sinceMs / RISE_MS;
  return k < 0.12 ? k / 0.12 : Math.pow(1 - (k - 0.12) / 0.88, 2);
}

/**
 * The rover's own shadow on the ground: length (m) and the bearing it points to (degrees from north, clockwise, away
 * from the Sun). null when the Sun is down or the rover is in shadow (no shadow of its own to see).
 */
export function roverShadow(sun, lit, heightM = ROVER_HEIGHT_M) {
  if (!lit || !(sun.el > 0)) return null;
  const length = Math.min(MAX_SHADOW_M, heightM / Math.tan((sun.el * Math.PI) / 180));
  return { length, az: (((sun.az + 180) % 360) + 360) % 360 };
}

/**
 * Where the head has to turn to look at a bearing: degrees relative to where the rover faces (positive to the right),
 * within the head's reach `limit`. The shadow behind the rover is then seen over the shoulder, as far as the head goes.
 */
export function lookAtBearing(az, headingDeg, limit = 110) {
  const d = ((((az - headingDeg) % 360) + 540) % 360) - 180;
  return Math.max(-limit, Math.min(limit, d));
}

/**
 * Caption of the postcard from the figures of the end (endSummary of end.js) and the scenario's name:
 * «Día 9 · 14:00 · 32 % · 3 paquetes · Mons Mouton». `texts.postcardCaption` words it in each language.
 */
export const postcardCaption = (summary, place, texts) => texts.postcardCaption({ ...summary, place });

/** File name of the postcard: varados-dia-9-1400.png (ASCII only). */
export const postcardFile = (summary) => `varados-dia-${summary.day}-${String(summary.hour).padStart(2, '0')}00.png`;

/** Half the rover's width (m): how wide its own shadow is. */
export const ROVER_HALF_WIDTH_M = 0.95;

/**
 * Share of the Sun's light that the rover's own shadow leaves at a point of the ground, 0 … 1 (1: outside it). The point
 * is (dx, dz) metres from the rover (x east, z south, as the scene); `shadow` from roverShadow, or null. A strip away from
 * the Sun as wide as the rover, with the penumbra of the Sun's 0.53° disc widening with distance, fainter at its end.
 * The cabin draws it per pixel on the ground (ownShadowGlsl, the same numbers), over the light of the map.
 */
export function ownShadowAt(dx, dz, shadow, halfWidthM = ROVER_HALF_WIDTH_M) {
  if (!shadow) return 1;
  const a = (shadow.az * Math.PI) / 180, ux = Math.sin(a), uz = -Math.cos(a); // along the shadow (north is −z)
  const along = dx * ux + dz * uz;
  if (along < -halfWidthM || along > shadow.length) return 1;
  const across = Math.abs(dx * -uz + dz * ux);
  const pen = 0.0093 * Math.max(0, along) + 0.1;
  const edge = 1 - Math.min(1, Math.max(0, (across - (halfWidthM - pen / 2)) / pen)); // 1 inside, 0 outside
  if (edge <= 0) return 1;
  const fade = 1 - Math.pow(Math.max(0, along) / shadow.length, 3) * 0.6;
  return 1 - edge * fade;
}

/** The uniforms of ownShadowGlsl for the rover at `at` (km) and `shadow` (roverShadow, or null: none). */
export function ownShadowUniforms(at, shadow) {
  if (!shadow) return { at: [at.x, at.z], dir: [0, 0], length: 0 };
  const a = (shadow.az * Math.PI) / 180;
  return { at: [at.x, at.z], dir: [Math.sin(a), -Math.cos(a)], length: shadow.length };
}

/**
 * ownShadowAt in GLSL: `float ownShadow(vec2 xzKm)` over the uniforms uOwnAt (rover, km), uOwnDir (along the shadow)
 * and uOwnLen (m; 0: no shadow).
 */
export function ownShadowGlsl(halfWidthM = ROVER_HALF_WIDTH_M) {
  const hw = halfWidthM.toFixed(3);
  return `uniform vec2 uOwnAt, uOwnDir;
uniform float uOwnLen;
float ownShadow(vec2 xzKm) {
  if (uOwnLen <= 0.0) return 1.0;
  vec2 d = (xzKm - uOwnAt) * 1000.0;
  float along = dot(d, uOwnDir);
  if (along < -${hw} || along > uOwnLen) return 1.0;
  float across = abs(dot(d, vec2(-uOwnDir.y, uOwnDir.x)));
  float pen = 0.0093 * max(0.0, along) + 0.1;
  float edge = 1.0 - clamp((across - (${hw} - pen * 0.5)) / pen, 0.0, 1.0);
  float fade = 1.0 - pow(max(0.0, along) / uOwnLen, 3.0) * 0.6;
  return 1.0 - edge * fade;
}`;
}
