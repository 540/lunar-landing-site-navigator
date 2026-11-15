// Backdrop of the map (J4.1): the relief under the routes, the rover and the layers. With WebGL on real hardware,
// the pipeline textures lit from where the Sun is (map-gl.js) on #map-gl, under a transparent #map, with the shadows
// per pixel once the horizon of the quality level arrives (J4.2, J4.3); otherwise, or if the context is lost, the
// light map of J10.4 (map-2d.js): map.png and a veil from the Sun fraction of each cell, on #map.
import { sampleAt } from '../../viewpoint/src/core/series.js';
import { readSignals, pixelRatio, decodeStored, decodeStoredTooSlow, STORAGE_KEY } from '../../shared/render/quality.js';
import { sunGrid } from './map-light.js';
import { mapContext, createMapGl } from './map-gl.js';
import { createMap2d } from './map-2d.js';
import { chooseMapMode } from './map-mode.js';
import { mapQuality } from './map-quality.js';
import { qualityParams } from './settings.js';

/**
 * canvas: #map (2D, on top). glCanvas: #map-gl (under it) or null. series: series.json. images: { map } loaded and
 * load(url) → image, for the textures. onLost(): called when WebGL is lost and the 2D drawing takes over; redraw():
 * when the horizon per pixel arrives (J4.2) and the relief has to be painted again.
 * Returns { mode, quality, paint(ctx, hour), toLight() }: paint draws the backdrop of an hour (in 'gl', only when the
 * hour or the size changes; the 2D canvas is cleared so the relief shows through).
 */
// savedMode (J10.4): 'light', 'full' or null, from the header switch; it decides with chooseMapMode.
// savedQuality (J13.3): the quality picked in «Ajustes» ('alto' or 'bajo'), behind ?q= and ahead of the home calibration.
export async function createBackdrop({ canvas, glCanvas, scenario, tables, series, images, load, data, onLost, redraw, savedMode = null,
  savedQuality = null }) {
  const n = tables.n;
  const startMs = Date.parse(scenario.startUtc);
  const paint2d = createMap2d({ canvas, tables, images }).paint;

  // toLight() (J10.4): the light mode chosen by hand drops WebGL in place, through the same path as a lost context.
  const backdrop = { mode: '2d', paint: paint2d, quality: null, toLight: () => {} };
  const gl = glCanvas ? mapContext(glCanvas) : null;
  let signals = {};
  try { if (gl) signals = readSignals(gl, navigator); } catch { /* without the extension, real hardware is assumed */ }
  const stored = storedQuality(gl);
  // Level of the map (J4.3): ?q=, then the choice of «Ajustes» (J13.3), then the one the home page measured.
  const quality = mapQuality({ params: qualityParams(location.search, savedQuality), signals, ...stored, webgl: Boolean(gl) });
  backdrop.quality = quality;
  if (chooseMapMode({ webgl: Boolean(gl), softwareRenderer: signals.softwareRenderer, tooSlow: stored.tooSlow, saved: savedMode }) !== 'full') {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return backdrop;
  }

  let relief = null;
  try {
    const [normals, albedo, ao] = await Promise.all([
      load(`${data}${scenario.files.normals.file}`),
      load(`${data}${scenario.files.albedo.file}`),
      load(`${data}${scenario.files.ao.file}`),
    ]);
    relief = createMapGl(glCanvas, gl, { normals, albedo, ao, aoRange: [scenario.files.ao.min, scenario.files.ao.max], n });
  } catch { relief = null; }
  if (!relief) return backdrop;

  // Horizon per pixel (J4.2), only the one of the level (J4.3): until it arrives, the Sun of each cell.
  let horizonReady = false;
  let lastKey = null;
  const meta = scenario.files[quality.horizon === 'low' ? 'horizonLow' : 'horizon'];
  load(`${data}${meta.file}`).then((image) => {
    if (backdrop.mode !== 'gl') return;
    relief.setHorizon(image, meta, { penumbra: quality.penumbra });
    horizonReady = true;
    lastKey = null;
    redraw?.();
  }).catch(() => { /* the per-cell Sun stays */ });

  function paintGl(ctx, hour) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const css = glCanvas.clientWidth;
    const side = Math.max(1, Math.round(css * pixelRatio(quality.level, css, css, window.devicePixelRatio || 1)));
    const key = `${hour}|${side}`;
    if (key === lastKey) return;
    lastKey = key;
    relief.resize(side, side);
    const t = Math.min(Math.max(hour, 0), series.count - 1);
    const at = sampleAt(series, new Date(startMs + t * 3600e3));
    relief.draw({ sunAz: at.sun.az, sunEl: at.sun.el, grid: horizonReady ? null : sunGrid(tables, hour) });
  }

  glCanvas.hidden = false;
  canvas.classList.add('map--gl');
  glCanvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    glCanvas.hidden = true;
    canvas.classList.remove('map--gl');
    backdrop.mode = '2d';
    backdrop.paint = paint2d;
    onLost?.();
  });
  backdrop.mode = 'gl';
  backdrop.paint = paintGl;
  backdrop.toLight = () => gl.getExtension('WEBGL_lose_context')?.loseContext();
  return backdrop;
}

// The level the home page stored for this renderer and whether it said the device cannot render continuously
// (#143, #144). In private mode storage may throw: then there is none.
function storedQuality(gl) {
  if (!gl) return { stored: null, tooSlow: false };
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    const raw = localStorage.getItem(STORAGE_KEY), now = Date.now();
    return { stored: decodeStored(raw, { renderer, now }), tooSlow: decodeStoredTooSlow(raw, { renderer, now }) };
  } catch { return { stored: null, tooSlow: false }; }
}
