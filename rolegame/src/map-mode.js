// Map mode (J10.4, #245): the light map (map.png and a shade veil per cell, map-2d.js) or the full one (WebGL relief
// of J4, map-gl.js). Pure: the caller reads WebGL, the renderer, the stored calibration and the saved choice.

export const MAP_KEY = 'llsn.gameMap';
export const MAP_MODES = ['light', 'full'];

// Without WebGL, always 'light'; otherwise the saved choice if there is one; otherwise 'light' with a software
// renderer or when the home page calibration said the device is too slow (#144), and 'full' in any other case.
export function chooseMapMode({ webgl = false, softwareRenderer = false, tooSlow = false, saved = null } = {}) {
  if (!webgl) return 'light';
  if (MAP_MODES.includes(saved)) return saved;
  return softwareRenderer || tooSlow ? 'light' : 'full';
}

// What the header switch saves when pressed: the opposite of the mode in use.
export const toggledMapMode = (modeNow) => (modeNow === 'light' ? 'full' : 'light');

// Files the light map needs before the first drawing (game.js fetches them; no textures, no map-horizon.bin).
export const LIGHT_FILES = ['scenario.json', 'sun.bin', 'cells.bin', 'earth.bin', 'masks.bin', 'series.json', 'map.png'];
