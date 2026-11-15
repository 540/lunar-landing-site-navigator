// The real Earth for the 3D skies (#487): NASA's Blue Marble (day) next to the other Earth textures of the home page.
// The procedural map of earth.js is what a texture shows while the image loads and if it fails, so a scene never waits
// for the image to draw and never ends up without an Earth. No three.js here: the texture is any object with `image`,
// `needsUpdate` and (optionally) `dispose`, and the loader is injectable (tests run without network or DOM).

/** The Earth textures of NASA, in shared/render/tex/ (the home page loads all four; the shared globe, the day one). */
export const EARTH_TEX = {
  day: new URL('tex/earth-day-2k.jpg', import.meta.url).href,
  night: new URL('tex/earth-night-2k.jpg', import.meta.url).href,
  clouds: new URL('tex/earth-clouds-2k.jpg', import.meta.url).href,
  water: new URL('tex/earth-water-1k.jpg', import.meta.url).href,
};

/** Default loader: url → Promise of an HTMLImageElement. Rejects when the image fails. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`no se pudo cargar ${url}`));
    img.src = url;
  });
}

/**
 * Puts the Blue Marble on `texture` (the one that already shows the procedural map) once it loads. If the load fails the
 * texture keeps what it had. Resolves to true when the real image is in, false when not; never rejects.
 * `load` is url → Promise of an image (injectable); `onChange` runs after the swap (to wake a render loop).
 */
export async function useRealEarth(texture, { load = loadImage, url = EARTH_TEX.day, onChange } = {}) {
  try {
    const image = await load(url);
    // three.js (WebGL2) allocates fixed-size storage on the first upload (the 512×256 procedural canvas) and later only
    // sub-uploads into it: a bigger image would fail with INVALID_VALUE. dispose() makes the next use reallocate it.
    if (typeof texture.dispose === 'function') texture.dispose();
    texture.image = image;
    texture.needsUpdate = true;
    if (onChange) onChange(texture);
    return true;
  } catch {
    return false;
  }
}
