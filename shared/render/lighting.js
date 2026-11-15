// Light and colour of the regolith shared by the three.js scenes (G1, #339): the Mirador (viewpoint/src/scene.js), the
// game's cabin (rolegame/src/cabin/scene.js) and the 3D sky of the planner (web/js/common/sky3d.js) take their lights from
// here and only choose their exposure. The home keeps its own lights (its render bench must give the same picture) and
// only imports the colours that already match: the Sun and the ambient.
// Pure: numbers only (colours as 0xRRGGBB in sRGB, intensities of three.js r160 physical lights), no three.js.

/** Reference albedo of the polar regolith: the mean of the home's colour texture around the pole. Each view may adjust
 * its own material, starting from this one. */
export const REGOLITH = 0xadaaa3;

/** The Sun: warm white. 30 because the polar Sun grazes the ground and a flat surface gets only sin(el) of it. */
export const SUN = Object.freeze({ color: 0xfff4e6, intensity: 30 });

/** Faint fill of the whole sky, a little blue, so what no light reaches is not pure black. */
export const AMBIENT = Object.freeze({ color: 0xbfc8d6, intensity: 0.05 });

/** The sunlight that the lit slopes scatter back into the shadows: from the side opposite to the Sun, above the horizon. */
export const BOUNCE = Object.freeze({ color: 0xd8d2c8, intensity: 0.8, elevationDeg: 35 });

/** Earthshine: much brighter than the real one so the relief in shadow has shape, from the Earth's side of the sky.
 * It comes from the Earth's azimuth raised to at least minElevationDeg, so it reaches the slopes, and it fades in over
 * the first fadeDeg of the Earth's real elevation: off with the Earth under the horizon, no jump when it rises or sets. */
export const EARTH = Object.freeze({ color: 0x9fb8e8, intensity: 0.3, minElevationDeg: 25, fadeDeg: 2 });

/** Intensity of the Earth's light with the Earth at `elDeg` of real elevation: 0 under the horizon, full past fadeDeg. */
export const earthLightIntensity = (elDeg) => EARTH.intensity * Math.min(1, Math.max(0, elDeg / EARTH.fadeDeg));

/** Elevation (degrees) the Earth's light comes from with the Earth at `elDeg`. */
export const earthLightElevation = (elDeg) => Math.max(elDeg, EARTH.minElevationDeg);

/** Tone mapping of every scene (the name of the three.js constant): only the exposure changes from one view to another. */
export const TONE_MAPPING = 'ACESFilmicToneMapping';
